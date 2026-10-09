// V2-M1 setup (devnet only). Idempotent: each step is skipped if its result
// already exists on chain.
//
//   For EACH agent, with its OWN multisig and vault (never share a multisig
//   between agents - two agents together could bypass the server):
//     food-ordering-agent-v2, shopping-agent-v2
//   1. Generates keys in ~/agent-vault/keys (mode 600, never printed).
//   2. Creates the SPL Token 2-of-3 multisig [owner(Phantom), server, agent].
//   3. Creates the aUSD token account owned by that multisig (the agent's V2 vault).
//   4. Mints 300 aUSD into that vault (CLI wallet = aUSD mint authority).
//   Once: tops the server key up to 0.5 SOL for fees (skipped if funded).
//   Writes policy-server/v2.config.json (public keys only).
//
//   node scripts/setup-v2.mjs
//
// Never touches the V1 program, vaults or the V1 agent key.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import {
  TOKEN_PROGRAM_ADDRESS,
  fetchMint,
  fetchMaybeMultisig,
  fetchMaybeToken,
  getInitializeAccount3Instruction,
  getInitializeMultisigInstruction,
  getMintToCheckedInstruction,
  getMultisigSize,
  getTokenSize,
} from '@solana-program/token';

const RPC_URL = 'https://api.devnet.solana.com';
const WS_URL = 'wss://api.devnet.solana.com';
const OWNER = address('7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg'); // Phantom, same owner as V1
const MINT = address('EMiGUP2fckjgjgHiTnG4237q3jY4PygPg6zZeVb5fNh9'); // aUSD, same as V1
const DECIMALS = 0;
const MINT_AMOUNT = 300n;
const SERVER_SOL = 500_000_000n; // 0.5 SOL (cap: 1 SOL)
const KEYS_DIR = join(homedir(), 'agent-vault', 'keys');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'v2.config.json');

const rpc = createSolanaRpc(RPC_URL);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions: createSolanaRpcSubscriptions(WS_URL) });

/** Loads a 64-byte keypair file, creating it (mode 600) if missing. Never logs bytes. */
async function loadOrCreateSigner(file) {
  const path = join(KEYS_DIR, file);
  if (!existsSync(path)) {
    mkdirSync(KEYS_DIR, { recursive: true });
    const seed = randomBytes(32);
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', signer.keyPair.publicKey));
    writeFileSync(path, JSON.stringify(Array.from(new Uint8Array([...seed, ...pub]))), { mode: 0o600 });
  }
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
}

const cli = await createKeyPairSignerFromBytes(
  Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf8'))),
);
const server = await loadOrCreateSigner('policy-server.json');

// Key file names for the food agent are the original M1 names (so reruns skip
// what already exists); the shopping agent gets its own set.
const AGENT_DEFS = [
  { name: 'food-ordering-agent-v2', agentFile: 'food-ordering-agent-v2.json', multisigFile: 'v2-multisig.json', vaultFile: 'v2-vault-token-account.json' },
  { name: 'shopping-agent-v2', agentFile: 'shopping-agent-v2.json', multisigFile: 'v2-multisig-shopping.json', vaultFile: 'v2-vault-token-account-shopping.json' },
];

async function send(label, instructions) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(cli, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    ),
  );
  await sendAndConfirm(tx, { commitment: 'confirmed' });
  const sig = getSignatureFromTransaction(tx);
  console.log(`${label}: https://solscan.io/tx/${sig}?cluster=devnet`);
  return sig;
}

// Sanity: the mint is the V1 aUSD mint, 0 decimals, and the CLI wallet is its authority.
const mint = await fetchMint(rpc, MINT);
if (mint.data.decimals !== DECIMALS) throw new Error(`mint decimals ${mint.data.decimals}, expected ${DECIMALS}`);
const mintAuth = mint.data.mintAuthority.__option === 'Some' ? mint.data.mintAuthority.value : null;
if (mintAuth !== cli.address) throw new Error(`CLI wallet is not the aUSD mint authority (${mintAuth})`);

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const agentsOut = {};

for (const def of AGENT_DEFS) {
  console.log(`\n== ${def.name}`);
  const agent = await loadOrCreateSigner(def.agentFile);
  const multisig = await loadOrCreateSigner(def.multisigFile);
  const vault = await loadOrCreateSigner(def.vaultFile);
  const sigs = {};
  // The M1 config kept the food agent's tx signatures in a flat top-level object.
  const prevSigs = prev.agents?.[def.name]?.setupTransactions ?? (def.name === 'food-ordering-agent-v2' ? prev.setupTransactions : {}) ?? {};

  // 2-of-3 multisig [owner, server, agent]
  if ((await fetchMaybeMultisig(rpc, multisig.address, { commitment: 'confirmed' })).exists) {
    console.log('multisig: already exists, skipping');
  } else {
    const space = getMultisigSize();
    const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
    sigs.createMultisig = await send('create multisig', [
      getCreateAccountInstruction({ payer: cli, newAccount: multisig, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
      getInitializeMultisigInstruction({ multisig: multisig.address, m: 2, signers: [OWNER, server.address, agent.address] }),
    ]);
  }

  // vault token account owned by the multisig
  if ((await fetchMaybeToken(rpc, vault.address, { commitment: 'confirmed' })).exists) {
    console.log('vault token account: already exists, skipping');
  } else {
    const space = getTokenSize();
    const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
    sigs.createVault = await send('create V2 vault token account', [
      getCreateAccountInstruction({ payer: cli, newAccount: vault, lamports: rent, space, programAddress: TOKEN_PROGRAM_ADDRESS }),
      getInitializeAccount3Instruction({ account: vault.address, mint: MINT, owner: multisig.address }),
    ]);
  }

  // mint 300 aUSD (only if the vault is empty, so reruns never double-mint)
  const vaultAcc = await fetchMaybeToken(rpc, vault.address, { commitment: 'confirmed' });
  if (vaultAcc.exists && vaultAcc.data.amount > 0n) {
    console.log(`mint: vault already holds ${vaultAcc.data.amount} aUSD, skipping`);
  } else {
    sigs.mint = await send('mint 300 aUSD', [
      getMintToCheckedInstruction({ mint: MINT, token: vault.address, mintAuthority: cli, amount: MINT_AMOUNT, decimals: DECIMALS }),
    ]);
  }

  agentsOut[def.name] = {
    address: agent.address,
    keyFile: def.agentFile,
    multisig: { address: multisig.address, m: 2, signers: [OWNER, server.address, agent.address] },
    vault: vault.address,
    setupTransactions: { ...prevSigs, ...sigs },
  };
}

// fee money for the server (top up to 0.5 SOL, never more)
const serverBal = (await rpc.getBalance(server.address, { commitment: 'confirmed' }).send()).value;
let fundSig = prev.serverFundTransaction ?? prev.setupTransactions?.fundServer;
if (serverBal >= SERVER_SOL) {
  console.log(`\nserver SOL: already ${serverBal} lamports, skipping`);
} else {
  fundSig = await send('fund server with SOL', [
    getTransferSolInstruction({ source: cli, destination: server.address, amount: lamports(SERVER_SOL - serverBal) }),
  ]);
}

// Public keys only. `multisig` / `vault` at top level stay as the FOOD agent's
// (M1 layout, used by the M2 server until it is updated for two agents).
const food = agentsOut['food-ordering-agent-v2'];
const config = {
  network: 'devnet',
  owner: OWNER,
  mint: MINT,
  decimals: DECIMALS,
  multisig: food.multisig,
  vault: food.vault,
  policyServer: { address: server.address, keyFile: 'policy-server.json' },
  serverFundTransaction: fundSig,
  agents: agentsOut,
};
writeFileSync(OUT, JSON.stringify(config, null, 2) + '\n');
console.log(`\nwrote ${OUT}`);

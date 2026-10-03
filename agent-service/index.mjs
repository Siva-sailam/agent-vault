#!/usr/bin/env node
// The agent service. Holds the grocery agent's private key in this
// process's memory only — it is read once from disk at startup and never
// transmitted anywhere (not over the HTTP server below, not to the
// storefront page, not anywhere). See NOTES.md "why the agent key never
// touches the browser" for the full reasoning.
//
// Runs the M7 demo scenario against the vault owned by VAULT_OWNER,
// pausing twice for you to make changes in the M6 control panel.
//
// Usage:
//   node index.mjs [--agent <keyfile-in-keys-dir>] [--port <port>]
// Defaults: --agent agent-grocery.json --port 4021
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  address,
  createSolanaRpc,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  appendTransactionMessageInstructions,
  setTransactionMessageLifetimeUsingBlockhash,
  partiallySignTransactionMessageWithSigners,
  getBase64EncodedWireTransaction,
  createKeyPairSignerFromBytes,
  getAddressDecoder,
} from '@solana/kit';
import { startServer } from './server.mjs';
import {
  getVaultPdas,
  getAssociatedTokenAddress,
  ixEnsureAssociatedTokenAccount,
  ixAgentSpend,
  decodeVaultRules,
  explainTransactionError,
} from './lib/program.mjs';

const DEVNET_URL = 'https://api.devnet.solana.com';
const KEYS_DIR = join(homedir(), 'agent-vault', 'keys');

// The vault owner — your Phantom wallet from M6. Update if you create a
// vault under a different owner.
const VAULT_OWNER = address('7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg');

const MERCHANT_FILES = {
  noon: 'merchant-noon.json',
  talabat: 'merchant-talabat.json',
  zomato: 'merchant-zomato.json',
  ubereats: 'merchant-ubereats.json',
};
const MERCHANT_LABELS = { noon: 'Noon', talabat: 'Talabat', zomato: 'Zomato', ubereats: 'Uber Eats' };

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { agent: 'agent-grocery.json', port: 4021 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--agent') opts.agent = args[++i];
    else if (args[i] === '--port') opts.port = Number(args[++i]);
  }
  return opts;
}

function readKeypairBytes(fileName) {
  return Uint8Array.from(JSON.parse(readFileSync(join(KEYS_DIR, fileName), 'utf8')));
}

/** Reads only the public-key half (bytes 32..64) of a keypair file — used
 * for merchants and the mint, where we never need to sign anything. */
function readPublicKeyOnly(fileName) {
  const bytes = readKeypairBytes(fileName);
  return getAddressDecoder().decode(bytes.slice(32, 64));
}

// Any other required signer (e.g. the agent, for agent_spend) is picked up
// automatically from the instructions' own account metas — each is built
// with its `signer` embedded (see lib/program.mjs), so
// partiallySignTransactionMessageWithSigners signs with all of them without
// needing a separate list here.
async function sendInstructions(rpc, feePayerSigner, instructions) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  let msg = createTransactionMessage({ version: 0 });
  msg = setTransactionMessageFeePayerSigner(feePayerSigner, msg);
  msg = appendTransactionMessageInstructions(instructions, msg);
  msg = setTransactionMessageLifetimeUsingBlockhash(blockhash, msg);
  const signed = await partiallySignTransactionMessageWithSigners(msg);
  const wire = getBase64EncodedWireTransaction(signed);
  const signature = await rpc
    .sendTransaction(wire, { encoding: 'base64', skipPreflight: true, preflightCommitment: 'confirmed' })
    .send();
  return signature;
}

async function waitForOutcome(rpc, signature) {
  for (let i = 0; i < 30; i++) {
    const { value: statuses } = await rpc.getSignatureStatuses([signature]).send();
    const status = statuses[0];
    if (status && status.confirmationStatus && status.confirmationStatus !== 'processed') {
      return status.err ?? null;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return 'timeout';
}

async function main() {
  const opts = parseArgs();
  const rpc = createSolanaRpc(DEVNET_URL);
  const { emit, waitForContinue } = startServer(opts.port);

  const agentSigner = await createKeyPairSignerFromBytes(readKeypairBytes(opts.agent));
  const feePayerSigner = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf8'))),
  );
  const mint = readPublicKeyOnly('demo-usd-mint.json');

  console.log('Agent:      ', agentSigner.address);
  console.log('Fee payer:  ', feePayerSigner.address);
  console.log('Vault owner:', VAULT_OWNER);
  console.log('Mint:       ', mint);

  const pdas = await getVaultPdas(VAULT_OWNER, mint);
  console.log('Rules PDA:  ', pdas.rules);
  console.log('Vault:      ', pdas.vault);
  console.log();

  const merchantWallets = {};
  const merchantAtas = {};
  for (const [key, file] of Object.entries(MERCHANT_FILES)) {
    merchantWallets[key] = readPublicKeyOnly(file);
    merchantAtas[key] = await getAssociatedTokenAddress(merchantWallets[key], mint);
  }

  console.log('Ensuring all 4 merchant token accounts exist (idempotent, one-time)...');
  const ensureIxs = Object.keys(MERCHANT_FILES).map((key) =>
    ixEnsureAssociatedTokenAccount(feePayerSigner, merchantWallets[key], mint, merchantAtas[key]),
  );
  const setupSig = await sendInstructions(rpc, feePayerSigner, ensureIxs);
  console.log('  tx:', setupSig);
  console.log();

  async function currentSpent() {
    const info = await rpc.getAccountInfo(pdas.rules, { encoding: 'base64' }).send();
    if (!info.value) return null;
    const bytes = Uint8Array.from(Buffer.from(info.value.data[0], 'base64'));
    const rules = decodeVaultRules(bytes);
    return rules.agents.find((a) => a.key === agentSigner.address) ?? null;
  }

  async function spend(merchantKey, amount) {
    const label = MERCHANT_LABELS[merchantKey];
    const destination = merchantAtas[merchantKey];
    console.log(`Agent ordering from ${label} — ${amount} Demo USD...`);
    const ix = ixAgentSpend(agentSigner, pdas.rules, pdas.vault, pdas.vaultAuthority, destination, BigInt(amount));
    const signature = await sendInstructions(rpc, feePayerSigner, [ix]);
    const err = await waitForOutcome(rpc, signature);
    const solscanUrl = `https://solscan.io/tx/${signature}?cluster=devnet`;
    const agentState = await currentSpent();
    const success = err == null;
    const reason = success ? null : explainTransactionError(err);

    if (success) {
      console.log(`  ✓ success — ${solscanUrl}`);
    } else {
      console.log(`  ✗ refused: ${reason} — ${solscanUrl}`);
    }
    console.log();

    emit('spend', {
      merchant: merchantKey,
      merchantLabel: label,
      amount,
      success,
      reason,
      signature,
      solscanUrl,
      spentSoFar: agentState ? Number(agentState.spentSoFar) : null,
      weeklyBudget: agentState ? Number(agentState.weeklyBudget) : null,
    });
  }

  emit('info', { message: `Demo scenario starting. Agent: ${agentSigner.address}` });

  await spend('noon', 20);
  await spend('talabat', 20);
  await spend('zomato', 15);

  await waitForContinue(
    'Go to the M6 control panel and switch Noon OFF for this agent, then press Continue.',
  );
  await spend('noon', 5);

  await waitForContinue('Go to the M6 control panel and revoke this agent, then press Continue.');
  await spend('talabat', 5);

  emit('complete', { message: 'Scenario complete.' });
  console.log('Scenario complete. Service is still running for the storefront feed — Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Agent service failed:', err);
  process.exit(1);
});

// Creates the "Agent USD" (aUSD) demo token and everything around it on
// devnet. Idempotent: every step is skipped if its result already exists.
//
//   1. Generates keypair files in ~/agent-vault/keys (never printed, mode 600):
//      agent-usd-mint, 2 agents, 8 merchants.
//   2. ONE transaction: create mint (decimals 0, NO freeze authority, mint
//      authority = CLI wallet) + Metaplex metadata (update authority = CLI
//      wallet, mutable) + Phantom's aUSD token account + mint 1,000 aUSD to it.
//   3. Creates the 8 merchants' aUSD token accounts (CLI wallet pays rent).
//   4. Writes agent-service/demo-vault.config.json (public addresses and key
//      file NAMES only).
//
//   npx tsx setup-agent-usd.ts
//
// Never touches the vault program or any existing vault / mint.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMetadataAccountV3, mplTokenMetadata, findMetadataPda } from '@metaplex-foundation/mpl-token-metadata';
import {
  createMint,
  createTokenIfMissing,
  findAssociatedTokenPda,
  mintTokensTo,
  mplToolbox,
} from '@metaplex-foundation/mpl-toolbox';
import {
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  none,
  publicKey,
  transactionBuilder,
  type Keypair,
  type Umi,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';

const RPC = 'https://api.devnet.solana.com';
const PHANTOM = publicKey('7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg');
const TOKEN_URI =
  process.env.TOKEN_URI ??
  'https://gist.githubusercontent.com/Siva-sailam/d8dccbc58e61b079f775dc671e5e513a/raw/token.json';
const MINT_AMOUNT = 1000n;
const KEYS_DIR = join(homedir(), 'agent-vault', 'keys');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'agent-service', 'demo-vault.config.json');
const APP_OUT = join(ROOT, 'app', 'src', 'lib', 'demo-vault.json'); // same data, imported by the front end

const AGENTS = {
  'food-ordering-agent': ['Kuber Eats', 'Talabird', 'Zomatic', 'Noonly'],
  'shopping-agent': ['Amazen', 'Flipkort', 'Nykeo', 'Meeshi'],
} as const;
const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
const MERCHANTS = Object.values(AGENTS).flat();

const umi: Umi = createUmi(RPC).use(mplTokenMetadata()).use(mplToolbox());
const cli = umi.eddsa.createKeypairFromSecretKey(
  new Uint8Array(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf8'))),
);
umi.use(keypairIdentity(cli));

/** Loads a keypair file, creating it (mode 600) if missing. Never logs bytes. */
function loadOrCreateKeypair(file: string): Keypair {
  const path = join(KEYS_DIR, file);
  if (!existsSync(path)) {
    mkdirSync(KEYS_DIR, { recursive: true });
    const kp = generateSigner(umi);
    writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  }
  return umi.eddsa.createKeypairFromSecretKey(new Uint8Array(JSON.parse(readFileSync(path, 'utf8'))));
}

const mintKp = loadOrCreateKeypair('agent-usd-mint.json');
const mintSigner = createSignerFromKeypair(umi, mintKp);
const mint = mintSigner.publicKey;
const agentAddress = Object.fromEntries(
  Object.keys(AGENTS).map((a) => [a, createSignerFromKeypair(umi, loadOrCreateKeypair(`${a}.json`)).publicKey]),
);
const merchantWallet = Object.fromEntries(
  MERCHANTS.map((m) => [m, createSignerFromKeypair(umi, loadOrCreateKeypair(`merchant-${slug(m)}.json`)).publicKey]),
);

// --- Step 2: mint + metadata + Phantom ATA + mint 1,000, ONE transaction ---
const mintInfo = await umi.rpc.getAccount(mint);
const phantomAta = findAssociatedTokenPda(umi, { mint, owner: PHANTOM });
if (!mintInfo.exists) {
  await transactionBuilder()
    .add(createMint(umi, { mint: mintSigner, decimals: 0, mintAuthority: cli.publicKey, freezeAuthority: none() }))
    .add(
      createMetadataAccountV3(umi, {
        mint,
        mintAuthority: umi.identity,
        updateAuthority: cli.publicKey,
        data: { name: 'Agent USD', symbol: 'aUSD', uri: TOKEN_URI, sellerFeeBasisPoints: 0, creators: none(), collection: none(), uses: none() },
        isMutable: true,
        collectionDetails: none(),
      }),
    )
    .add(createTokenIfMissing(umi, { mint, owner: PHANTOM, ata: phantomAta }))
    .add(mintTokensTo(umi, { mint, token: phantomAta, amount: MINT_AMOUNT, mintAuthority: umi.identity }))
    .sendAndConfirm(umi);
  console.log('Created mint + metadata + minted', MINT_AMOUNT.toString(), 'aUSD to Phantom');
} else {
  console.log('Mint already exists, skipping creation.');
}

// --- Step 3: merchant token accounts ---
let builder = transactionBuilder();
let pending = 0;
const flush = async () => {
  if (pending) await builder.sendAndConfirm(umi);
  builder = transactionBuilder();
  pending = 0;
};
const merchantAta: Record<string, string> = {};
for (const m of MERCHANTS) {
  const ata = findAssociatedTokenPda(umi, { mint, owner: merchantWallet[m] });
  merchantAta[m] = ata[0];
  if (!(await umi.rpc.getAccount(ata[0])).exists) {
    builder = builder.add(createTokenIfMissing(umi, { mint, owner: merchantWallet[m], ata }));
    if (++pending === 4) await flush();
  }
}
await flush();

// --- Step 4: config (public data only) ---
const config = {
  name: 'Agent USD demo vault',
  owner: PHANTOM,
  mint,
  tokenSymbol: 'aUSD',
  agents: Object.fromEntries(
    Object.entries(AGENTS).map(([name, merchants]) => [
      name,
      { keyFile: `${name}.json`, address: agentAddress[name], weeklyBudget: 200, merchants: [...merchants] },
    ]),
  ),
  merchants: Object.fromEntries(MERCHANTS.map((m) => [m, merchantWallet[m]])),
  merchantKeyFiles: Object.fromEntries(MERCHANTS.map((m) => [m, `merchant-${slug(m)}.json`])),
  // M7 scenario for this vault: steps run in order; a pause waits for the
  // owner (you) to act in the control panel and press Continue.
  scenario: {
    agent: 'food-ordering-agent',
    steps: [
      { spend: ['Noonly', 20] },
      { spend: ['Talabird', 20] },
      { spend: ['Zomatic', 15] },
      { pause: 'Go to the control panel and switch Noonly OFF for the food-ordering agent. This continues by itself once the change lands.', until: { merchantOff: 'Noonly' } },
      { spend: ['Noonly', 5] },
      { pause: 'Go to the control panel and revoke the food-ordering agent. This continues by itself once the change lands.', until: { revoked: true } },
      { spend: ['Talabird', 5] },
    ],
  },
};
writeFileSync(OUT, JSON.stringify(config, null, 2) + '\n');
writeFileSync(APP_OUT, JSON.stringify(config, null, 2) + '\n');

console.log(`Mint:           ${mint}`);
console.log(`Phantom aUSD:   ${phantomAta[0]}`);
console.log(`Metadata:       ${findMetadataPda(umi, { mint })[0]}`);
for (const m of MERCHANTS) console.log(`${m.padEnd(11)}     wallet ${merchantWallet[m]}  aUSD account ${merchantAta[m]}`);
console.log(`https://solscan.io/token/${mint}?cluster=devnet`);

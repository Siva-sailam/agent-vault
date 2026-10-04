#!/usr/bin/env node
// One-shot agent payment, built for a live demo: the agent signs ONE
// agent_spend and the result prints as APPROVED + signature, or REFUSED +
// the program's error name. No program changes — same instruction as
// pay.mjs / index.mjs.
//
//   npm run agent -- --agent food-ordering-agent --merchant Noonly --amount 20
//
// Options:
//   --agent     agent name from the config (e.g. food-ordering-agent)
//   --merchant  merchant name from the config (case-insensitive)
//   --amount    whole Demo USD units
//   --config    config file (default: vault-b.config.json, or $AGENT_VAULT_CONFIG)
//
// The config holds public addresses and key FILE NAMES only. The agent key
// is read from ~/agent-vault/keys into this process and never printed.
// Sends with skipPreflight so refusals land on Solscan as failed txs.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
} from '@solana/kit';
import {
  getVaultPdas,
  getAssociatedTokenAddress,
  ixAgentSpend,
  programErrorInfo,
  explainTransactionError,
} from './lib/program.mjs';

const DEVNET_URL = 'https://api.devnet.solana.com';
const KEYS_DIR = join(homedir(), 'agent-vault', 'keys');
const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(2);
};

const configPath = resolve(here, opt('config') ?? process.env.AGENT_VAULT_CONFIG ?? 'vault-b.config.json');
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch (e) {
  fail(`Cannot read config ${configPath}: ${e.message}`);
}

const agentName = opt('agent');
const merchantArg = opt('merchant');
const amountArg = opt('amount');
const agentFile = config.agents?.[agentName];
const merchantName = Object.keys(config.merchants ?? {}).find((m) => m.toLowerCase() === merchantArg?.toLowerCase());
if (!agentFile) fail(`Unknown --agent "${agentName ?? ''}". Choose one of: ${Object.keys(config.agents ?? {}).join(', ')}`);
if (!merchantName) fail(`Unknown --merchant "${merchantArg ?? ''}". Choose one of: ${Object.keys(config.merchants ?? {}).join(', ')}`);
if (!/^[1-9]\d*$/.test(amountArg ?? '')) fail('--amount must be a positive whole number of Demo USD');
const amount = BigInt(amountArg);

const rpc = createSolanaRpc(DEVNET_URL);
const keyBytes = (f) => Uint8Array.from(JSON.parse(readFileSync(f, 'utf8')));
const agentSigner = await createKeyPairSignerFromBytes(keyBytes(join(KEYS_DIR, agentFile)));
const feePayer = await createKeyPairSignerFromBytes(keyBytes(join(homedir(), '.config', 'solana', 'id.json')));
const mint = address(config.mint);
const dest = await getAssociatedTokenAddress(address(config.merchants[merchantName]), mint);
const pdas = await getVaultPdas(address(config.owner), mint);

console.log(`\n  ${agentName} → ${merchantName}: ${amount} Demo USD`);

const { value: blockhash } = await rpc.getLatestBlockhash().send();
let msg = createTransactionMessage({ version: 0 });
msg = setTransactionMessageFeePayerSigner(feePayer, msg);
msg = appendTransactionMessageInstructions(
  [ixAgentSpend(agentSigner, pdas.rules, pdas.vault, pdas.vaultAuthority, dest, amount)],
  msg,
);
msg = setTransactionMessageLifetimeUsingBlockhash(blockhash, msg);
const signed = await partiallySignTransactionMessageWithSigners(msg);
const sig = await rpc
  .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', skipPreflight: true })
  .send();

let err = 'timeout';
for (let i = 0; i < 40; i++) {
  const { value } = await rpc.getSignatureStatuses([sig]).send();
  const s = value[0];
  if (s?.confirmationStatus && s.confirmationStatus !== 'processed') {
    err = s.err ?? null;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
if (err === null) {
  console.log(`\n  ${green('✓ APPROVED')}  ${amount} Demo USD paid to ${merchantName}`);
} else if (err === 'timeout') {
  console.log('\n  ? No confirmation after 40 s — check the link below');
} else {
  const info = programErrorInfo(err);
  console.log(`\n  ${red('✗ REFUSED')}  ${info ? `${info.name} (${info.code})` : 'transaction failed'}`);
  console.log(`  ${info?.msg ?? explainTransactionError(err)}`);
}
console.log(`\n  signature: ${sig}`);
console.log(`  https://solscan.io/tx/${sig}?cluster=devnet\n`);
process.exit(err === null ? 0 : 1);

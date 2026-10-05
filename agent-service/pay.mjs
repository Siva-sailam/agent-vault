#!/usr/bin/env node
// One-shot agent payment for the demo: the agent signs one agent_spend and
// the result (success or on-chain refusal) is printed with a Solscan link.
// The agent key is read from disk into this process only; never printed.
//
// Usage: node pay.mjs <merchant> <amount> [--agent <name>] [--config <file>]
//   merchant: a name from the config, case/space-insensitive ("talabird", "kuber-eats")
//   agent:    default = the config's scenario agent (food-ordering-agent)
//   config:   default demo-vault.config.json (the aUSD demo vault)
// Sends with skipPreflight so a refusal lands on-chain as a failed tx you can
// open on Solscan.
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
} from '@solana/kit';
import {
  getVaultPdas,
  getAssociatedTokenAddress,
  ixAgentSpend,
  explainTransactionError,
} from './lib/program.mjs';

const DEVNET_URL = 'https://api.devnet.solana.com';
const KEYS_DIR = join(homedir(), 'agent-vault', 'keys');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv.splice(i, 2)[1];
};
const configFile = flag('--config') ?? 'demo-vault.config.json';
const agentArg = flag('--agent');
const [merchantArg, amountArg] = argv;

const config = JSON.parse(readFileSync(new URL(configFile, import.meta.url), 'utf8'));
const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
const merchantName = Object.keys(config.merchants).find((m) => norm(m) === norm(merchantArg ?? ''));
const agentName = agentArg ?? config.scenario?.agent ?? Object.keys(config.agents)[0];
const agentCfg = config.agents[agentName];
if (!merchantName || !agentCfg || !/^\d+$/.test(amountArg ?? '')) {
  console.error('Usage: node pay.mjs <merchant> <amount> [--agent <name>] [--config <file>]');
  console.error(`  merchants: ${Object.keys(config.merchants).join(', ')}`);
  console.error(`  agents:    ${Object.keys(config.agents).join(', ')}`);
  process.exit(2);
}
const amount = BigInt(amountArg);
const SYMBOL = config.tokenSymbol;

const keyBytes = (f) => Uint8Array.from(JSON.parse(readFileSync(f, 'utf8')));
const rpc = createSolanaRpc(DEVNET_URL);
const agentSigner = await createKeyPairSignerFromBytes(keyBytes(join(KEYS_DIR, agentCfg.keyFile)));
const feePayer = await createKeyPairSignerFromBytes(keyBytes(join(homedir(), '.config', 'solana', 'id.json')));
const mint = address(config.mint);
const dest = await getAssociatedTokenAddress(address(config.merchants[merchantName]), mint);
const pdas = await getVaultPdas(address(config.owner), mint);

async function send(instructions) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  let msg = createTransactionMessage({ version: 0 });
  msg = setTransactionMessageFeePayerSigner(feePayer, msg);
  msg = appendTransactionMessageInstructions(instructions, msg);
  msg = setTransactionMessageLifetimeUsingBlockhash(blockhash, msg);
  const signed = await partiallySignTransactionMessageWithSigners(msg);
  return rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', skipPreflight: true })
    .send();
}

console.log(`\nAgent ${agentSigner.address.slice(0, 4)}…${agentSigner.address.slice(-4)} (${agentName}) is ordering from ${merchantName}: ${amount} ${SYMBOL}`);
const sig = await send([ixAgentSpend(agentSigner, pdas.rules, pdas.vault, pdas.vaultAuthority, dest, amount)]);

let err = 'timeout';
for (let i = 0; i < 40; i++) {
  const { value } = await rpc.getSignatureStatuses([sig]).send();
  const s = value[0];
  if (s && s.confirmationStatus && s.confirmationStatus !== 'processed') {
    err = s.err ?? null;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
const url = `https://solscan.io/tx/${sig}?cluster=devnet`;
if (err === null) console.log(`\n  ✓ PAID — ${amount} ${SYMBOL} sent to ${merchantName}\n`);
else if (err === 'timeout') console.log('\n  ? Timed out waiting for confirmation\n');
else console.log(`\n  ✗ REFUSED ON-CHAIN — ${explainTransactionError(err)}\n`);
console.log(`  ${url}\n`);
process.exit(err === null ? 0 : 1);

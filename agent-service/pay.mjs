#!/usr/bin/env node
// One-shot agent payment for the demo: the agent signs one agent_spend and
// the result (success or on-chain refusal) is printed with a Solscan link.
// The agent key is read from disk into this process only; never printed.
//
// Usage: node pay.mjs <noon|talabat|zomato|ubereats> <amount> [--agent <keyfile>]
// Default agent: agent-grocery.json. Sends with skipPreflight so a refusal
// lands on-chain as a failed tx you can open on Solscan.
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
import {
  getVaultPdas,
  getAssociatedTokenAddress,
  ixAgentSpend,
  explainTransactionError,
} from './lib/program.mjs';

const DEVNET_URL = 'https://api.devnet.solana.com';
const KEYS_DIR = join(homedir(), 'agent-vault', 'keys');
const VAULT_OWNER = address('7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg');
const LABELS = { noon: 'Noon', talabat: 'Talabat', zomato: 'Zomato', ubereats: 'Uber Eats' };

const [merchantKey, amountArg, ...rest] = process.argv.slice(2);
const agentFile = rest[0] === '--agent' ? rest[1] : 'agent-grocery.json';
if (!LABELS[merchantKey] || !/^\d+$/.test(amountArg ?? '')) {
  console.error('Usage: node pay.mjs <noon|talabat|zomato|ubereats> <amount> [--agent <keyfile>]');
  process.exit(2);
}
const amount = BigInt(amountArg);

const keyBytes = (f) => Uint8Array.from(JSON.parse(readFileSync(f, 'utf8')));
const rpc = createSolanaRpc(DEVNET_URL);
const agentSigner = await createKeyPairSignerFromBytes(keyBytes(join(KEYS_DIR, agentFile)));
const feePayer = await createKeyPairSignerFromBytes(keyBytes(join(homedir(), '.config', 'solana', 'id.json')));
const mint = getAddressDecoder().decode(keyBytes(join(KEYS_DIR, 'demo-usd-mint.json')).slice(32, 64));
const merchantWallet = getAddressDecoder().decode(keyBytes(join(KEYS_DIR, `merchant-${merchantKey}.json`)).slice(32, 64));
const dest = await getAssociatedTokenAddress(merchantWallet, mint);
const pdas = await getVaultPdas(VAULT_OWNER, mint);

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

console.log(`\nAgent ${agentSigner.address.slice(0, 4)}…${agentSigner.address.slice(-4)} is ordering from ${LABELS[merchantKey]}: ${amount} Demo USD`);
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
if (err === null) console.log(`\n  ✓ PAID — ${amount} Demo USD sent to ${LABELS[merchantKey]}\n`);
else if (err === 'timeout') console.log('\n  ? Timed out waiting for confirmation\n');
else console.log(`\n  ✗ REFUSED ON-CHAIN — ${explainTransactionError(err)}\n`);
console.log(`  ${url}\n`);
process.exit(err === null ? 0 : 1);

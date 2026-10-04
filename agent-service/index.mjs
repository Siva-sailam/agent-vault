#!/usr/bin/env node
// The agent service. Holds the agent's private key in this process's memory
// only — it is read once from disk at startup and never transmitted anywhere
// (not over the HTTP server below, not to the storefront page, not anywhere).
// See NOTES.md "why the agent key never touches the browser" for the reasoning.
//
// Runs the M7 demo scenario described in a vault config file: a list of
// spends and pauses. At a pause it waits for you to act in the control panel
// and press Continue on the storefront.
//
// Usage:
//   node index.mjs [--config <file>] [--agent <name>] [--port <port>] [--check]
// Defaults: --config demo-vault.config.json --port 4021; agent = the config's
// scenario.agent. --check loads the config and prints the plan, sends nothing.
// Use --config vault-b.config.json for the original Vault B scenario.
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
const here = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { config: 'demo-vault.config.json', agent: null, port: 4021, check: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config') opts.config = args[++i];
    else if (args[i] === '--agent') opts.agent = args[++i];
    else if (args[i] === '--port') opts.port = Number(args[++i]);
    else if (args[i] === '--check') opts.check = true;
  }
  return opts;
}

function readKeypairBytes(fileName) {
  return Uint8Array.from(JSON.parse(readFileSync(join(KEYS_DIR, fileName), 'utf8')));
}

/** Icon/storefront key for a merchant label: lower-case, no spaces. */
const merchantKeyFor = (label) => label.toLowerCase().replace(/\s+/g, '');

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
  const config = JSON.parse(readFileSync(resolve(here, opts.config), 'utf8'));
  const symbol = config.tokenSymbol ?? 'Demo USD';
  const agentName = opts.agent ?? config.scenario?.agent;
  const agentEntry = config.agents?.[agentName];
  const agentFile = typeof agentEntry === 'string' ? agentEntry : agentEntry?.keyFile;
  if (!agentFile) throw new Error(`Unknown agent "${agentName}" in ${opts.config}`);
  const steps = config.scenario?.steps ?? [];
  for (const s of steps) {
    if (s.spend && !config.merchants[s.spend[0]]) throw new Error(`Scenario merchant "${s.spend[0]}" is not in the config`);
  }

  const mint = address(config.mint);
  const owner = address(config.owner);
  const merchantAtas = {};
  for (const [label, wallet] of Object.entries(config.merchants)) {
    merchantAtas[label] = await getAssociatedTokenAddress(address(wallet), mint);
  }
  const pdas = await getVaultPdas(owner, mint);

  console.log('Config:     ', opts.config, `(${config.name ?? 'unnamed'})`);
  console.log('Agent:      ', agentName);
  console.log('Vault owner:', owner);
  console.log('Mint:       ', mint);
  console.log('Rules PDA:  ', pdas.rules);
  console.log('Vault:      ', pdas.vault);
  console.log('Scenario:');
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.spend ? `${agentName} pays ${s.spend[0]} ${s.spend[1]} ${symbol}` : `PAUSE — ${s.pause}`}`));
  console.log();
  if (opts.check) {
    console.log('--check: nothing sent.');
    return;
  }

  const rpc = createSolanaRpc(DEVNET_URL);
  const { emit, waitForContinue } = startServer(opts.port);
  const agentSigner = await createKeyPairSignerFromBytes(readKeypairBytes(agentFile));
  const feePayerSigner = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf8'))),
  );
  console.log('Agent key:  ', agentSigner.address);
  console.log('Fee payer:  ', feePayerSigner.address);
  console.log();

  // Merchant token accounts: only create the ones that are missing (a
  // transaction is sent only if something is actually missing).
  const missing = [];
  for (const [label, ata] of Object.entries(merchantAtas)) {
    const info = await rpc.getAccountInfo(ata, { encoding: 'base64' }).send();
    if (!info.value) missing.push(label);
  }
  if (missing.length > 0) {
    console.log(`Creating ${missing.length} missing merchant token account(s) (idempotent)...`);
    const ensureIxs = missing.map((label) =>
      ixEnsureAssociatedTokenAccount(feePayerSigner, address(config.merchants[label]), mint, merchantAtas[label]),
    );
    console.log('  tx:', await sendInstructions(rpc, feePayerSigner, ensureIxs));
    console.log();
  }

  async function currentSpent() {
    const info = await rpc.getAccountInfo(pdas.rules, { encoding: 'base64' }).send();
    if (!info.value) return null;
    const bytes = Uint8Array.from(Buffer.from(info.value.data[0], 'base64'));
    const rules = decodeVaultRules(bytes);
    return rules.agents.find((a) => a.key === agentSigner.address) ?? null;
  }

  async function spend(label, amount) {
    console.log(`Agent ordering from ${label} — ${amount} ${symbol}...`);
    const ix = ixAgentSpend(agentSigner, pdas.rules, pdas.vault, pdas.vaultAuthority, merchantAtas[label], BigInt(amount));
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
      merchant: merchantKeyFor(label),
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

  for (const step of steps) {
    if (step.spend) await spend(step.spend[0], step.spend[1]);
    else await waitForContinue(step.pause);
  }

  emit('complete', { message: 'Scenario complete.' });
  console.log('Scenario complete. Service is still running for the storefront feed — Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Agent service failed:', err);
  process.exit(1);
});

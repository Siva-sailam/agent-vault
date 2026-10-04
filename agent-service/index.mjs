#!/usr/bin/env node
// The agent service. Holds the agent's private key in this process's memory
// only — it is read once from disk at startup and never transmitted anywhere
// (not over the HTTP server below, not to the storefront page, not anywhere).
// See NOTES.md "why the agent key never touches the browser" for the reasoning.
//
// Two modes, both feeding the storefront's live activity feed:
//   - manual (default): serves the storefront's order form. When someone
//     places an order, this process signs the agent's payment and reports the
//     result (paid, or refused with the program's error).
//   - --scenario: additionally runs the scripted M7 scenario from the vault
//     config (spends and pauses). A pause continues by itself as soon as the
//     owner's change (e.g. Noonly switched off, agent revoked) is visible
//     on-chain; the storefront's Continue button is a manual override.
//
// Usage:
//   node index.mjs [--config <file>] [--scenario] [--agent <name>] [--port <port>] [--check]
// Defaults: --config demo-vault.config.json --port 4021; scenario agent = the
// config's scenario.agent. --check loads the config and prints the plan,
// sends nothing. Use --config vault-b.config.json for the original Vault B.
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
  const opts = { config: 'demo-vault.config.json', agent: null, port: 4021, check: false, scenario: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario') opts.scenario = true;
    else if (args[i] === '--config') opts.config = args[++i];
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
  const scenarioAgent = opts.agent ?? config.scenario?.agent;
  const keyFileOf = (entry) => (typeof entry === 'string' ? entry : entry?.keyFile);
  if (!keyFileOf(config.agents?.[scenarioAgent])) throw new Error(`Unknown agent "${scenarioAgent}" in ${opts.config}`);
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
  console.log('Mode:       ', opts.scenario ? 'scenario + orders' : 'manual orders (add --scenario for the script)');
  console.log('Vault owner:', owner);
  console.log('Mint:       ', mint);
  console.log('Rules PDA:  ', pdas.rules);
  console.log('Vault:      ', pdas.vault);
  console.log('Agents:     ', Object.keys(config.agents).join(', '));
  if (opts.scenario) {
    console.log(`Scenario (${scenarioAgent}):`);
    steps.forEach((s, i) =>
      console.log(`  ${i + 1}. ${s.spend ? `pays ${s.spend[0]} ${s.spend[1]} ${symbol}` : `PAUSE — ${s.pause}`}`),
    );
  }
  console.log();
  if (opts.check) {
    console.log('--check: nothing sent.');
    return;
  }

  const rpc = createSolanaRpc(DEVNET_URL);

  // Every agent's key is read into this process only; never logged or served.
  const agentSigners = {};
  for (const [name, entry] of Object.entries(config.agents)) {
    agentSigners[name] = await createKeyPairSignerFromBytes(readKeypairBytes(keyFileOf(entry)));
  }
  const feePayerSigner = await createKeyPairSignerFromBytes(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf8'))),
  );

  async function agentRules(name) {
    const info = await rpc.getAccountInfo(pdas.rules, { encoding: 'base64' }).send();
    if (!info.value) return null;
    const rules = decodeVaultRules(Uint8Array.from(Buffer.from(info.value.data[0], 'base64')));
    return rules.agents.find((a) => a.key === agentSigners[name].address) ?? null;
  }

  // Payments run one at a time so the on-chain spent/budget readout after each
  // one is that payment's own.
  let queue = Promise.resolve();
  const enqueue = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  async function spend(agentName, label, amount) {
    console.log(`${agentName} ordering from ${label} — ${amount} ${symbol}...`);
    const ix = ixAgentSpend(agentSigners[agentName], pdas.rules, pdas.vault, pdas.vaultAuthority, merchantAtas[label], BigInt(amount));
    const signature = await sendInstructions(rpc, feePayerSigner, [ix]);
    const err = await waitForOutcome(rpc, signature);
    const solscanUrl = `https://solscan.io/tx/${signature}?cluster=devnet`;
    const agentState = await agentRules(agentName);
    const success = err == null;
    const reason = success ? null : explainTransactionError(err);

    console.log(success ? `  ✓ success — ${solscanUrl}` : `  ✗ refused: ${reason} — ${solscanUrl}`);
    console.log();

    const fields = {
      agent: agentName,
      merchant: merchantKeyFor(label),
      merchantLabel: label,
      amount,
      success,
      reason,
      signature,
      solscanUrl,
      spentSoFar: agentState ? Number(agentState.spentSoFar) : null,
      weeklyBudget: agentState ? Number(agentState.weeklyBudget) : null,
    };
    emit('spend', fields);
    return fields;
  }

  /** Storefront order form → one agent payment. Validates input; a payment the
   * program refuses is NOT an error here — it is a result with a reason. */
  function onOrder({ agent, merchant, amount }) {
    if (!agentSigners[agent]) throw new Error(`Unknown agent "${agent}"`);
    if (!config.merchants[merchant]) throw new Error(`Unknown merchant "${merchant}"`);
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new Error('Amount must be a whole number from 1 to 1,000,000');
    return enqueue(() => spend(agent, merchant, n));
  }

  const meta = {
    symbol,
    agents: Object.keys(config.agents).map((name) => ({
      name,
      address: agentSigners[name].address,
      merchants: config.agents[name].merchants ?? Object.keys(config.merchants),
    })),
    merchants: Object.keys(config.merchants),
    scenario: opts.scenario,
  };
  const { emit, waitForContinue } = startServer(opts.port, { meta, onOrder });

  console.log('Fee payer:  ', feePayerSigner.address);
  for (const [name, s] of Object.entries(agentSigners)) console.log(`Agent ${name}:`.padEnd(13), s.address);
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

  if (!opts.scenario) {
    emit('info', { message: 'Ready. Place an order from the storefront.' });
    console.log('Manual mode: place orders from the storefront. (Run with --scenario for the scripted M7 flow.)');
    return;
  }

  /** `until` in a scenario pause: what must be true on-chain before it continues. */
  function conditionFor(until) {
    if (!until) return null;
    if (until.merchantOff) {
      return async () => {
        const a = await agentRules(scenarioAgent);
        return a != null && !a.merchants.includes(merchantAtas[until.merchantOff]);
      };
    }
    if (until.revoked) {
      return async () => (await agentRules(scenarioAgent))?.revoked === true;
    }
    throw new Error(`Unknown pause condition ${JSON.stringify(until)}`);
  }

  emit('info', { message: `Demo scenario starting. Agent: ${scenarioAgent}` });

  for (const step of steps) {
    if (step.spend) await enqueue(() => spend(scenarioAgent, step.spend[0], step.spend[1]));
    else await waitForContinue(step.pause, conditionFor(step.until));
  }

  emit('complete', { message: 'Scenario complete.' });
  console.log('Scenario complete. Service is still running for the storefront feed and orders — Ctrl+C to stop.');
}

main().catch((err) => {
  console.error('Agent service failed:', err);
  process.exit(1);
});

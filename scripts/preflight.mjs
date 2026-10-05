#!/usr/bin/env node
// Pre-recording check. Read-only: sends no transactions, never reads key
// contents (only checks that key files exist). Run: node scripts/preflight.mjs
// Exit code 0 = all PASS (WARNs allowed), 1 = at least one FAIL.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSolanaRpc } from '../agent-service/node_modules/@solana/kit/dist/index.node.mjs';
import { readState, CONFIG, SYMBOL, DEVNET_URL } from './demo-state.mjs';

const AGENT = CONFIG.scenario.agent;
// Spends before the first pause are the ones that must succeed; later ones are refusals.
const firstPause = CONFIG.scenario.steps.findIndex((x) => x.pause);
const NEED = CONFIG.scenario.steps.slice(0, firstPause).reduce((n, x) => n + x.spend[1], 0);
const FRONTEND = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const PROGRAM = 'B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj';
const rows = [];
const add = (status, name, detail = '') => {
  rows.push(status);
  const tag = { PASS: '\x1b[32mPASS\x1b[0m', FAIL: '\x1b[31mFAIL\x1b[0m', WARN: '\x1b[33mWARN\x1b[0m' }[status];
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
};

console.log('\nAgentic Payments Vault — pre-flight (devnet, aUSD demo vault)\n');
const rpc = createSolanaRpc(DEVNET_URL);

// 1. devnet reachable
let state;
try {
  const t0 = Date.now();
  await rpc.getLatestBlockhash().send();
  const ms = Date.now() - t0;
  add(ms < 2500 ? 'PASS' : 'WARN', 'Devnet RPC reachable', `${ms} ms${ms >= 2500 ? ' (slow — expect laggy refreshes)' : ''}`);
  const prog = await rpc.getAccountInfo(PROGRAM, { encoding: 'base64' }).send();
  add(prog.value?.executable ? 'PASS' : 'FAIL', 'agent_vault program deployed', PROGRAM.slice(0, 8) + '…');
  state = await readState(rpc);
} catch (e) {
  add('FAIL', 'Devnet RPC reachable', String(e.message ?? e).split('\n')[0]);
}

if (state) {
  // 2. balances
  add(state.cliSol >= 0.05 ? 'PASS' : 'FAIL', 'Agent fee-payer (CLI wallet) SOL', `${state.cliSol.toFixed(3)} SOL (need ≥ 0.05)`);
  add(state.phantomSol >= 0.05 ? 'PASS' : 'FAIL', 'Phantom SOL for fees', `${state.phantomSol.toFixed(3)} SOL (need ≥ 0.05)`);
  add((state.vaultBalance ?? 0) >= NEED ? 'PASS' : 'FAIL', `Vault ${SYMBOL} covers the scenario payments`, `${state.vaultBalance} ${SYMBOL} (need ≥ ${NEED})`);
  add((state.phantomBalance ?? 0) >= 100 ? 'PASS' : 'WARN', `Phantom ${SYMBOL} for a deposit beat`, `${state.phantomBalance} ${SYMBOL}`);

  // 3. agent state (start-of-recording state)
  for (const name of Object.keys(CONFIG.agents)) {
    const a = state.agents.find((x) => x.name === name);
    if (!a) {
      add('FAIL', `${name} registered on the demo vault`);
      continue;
    }
    add(!a.revoked ? 'PASS' : 'FAIL', `${name} is Active`, a.revoked ? 'REVOKED — click "Unrevoke agent" in the panel (Phantom approval)' : '');
    const left = a.windowExpired ? a.budget : a.remaining;
    const need = name === AGENT ? NEED : 0;
    add(left >= need ? 'PASS' : 'FAIL', `${name} budget left this window`,
      `${left}/${a.budget}${a.windowExpired ? ' (old window expired; first spend resets to 0)' : ''}` +
        (left < need ? ` — need ≥ ${need}; window resets ${a.windowResetsAt}` : ''));
    const missing = CONFIG.agents[name].merchants.filter((m) => !a.merchants.includes(m));
    add(missing.length === 0 ? 'PASS' : 'FAIL', `${name} allow-list matches config`, missing.length ? `missing ${missing.join(', ')} — toggle ON in the panel` : a.merchants.join(', '));
    if (a.windowExpired && a.spent > 0)
      add('WARN', `${name}: panel shows stale "Spent ${a.spent}/${a.budget}" until the first payment resets the window`);
  }
}

// 4. front end + local files
try {
  const r = await fetch(FRONTEND, { signal: AbortSignal.timeout(3000) });
  add(r.ok ? 'PASS' : 'FAIL', `Front end running at ${FRONTEND}`, `HTTP ${r.status}`);
} catch {
  add('FAIL', `Front end running at ${FRONTEND}`, 'start it: cd ~/agent-vault/app && npm run dev');
}
const keys = join(homedir(), 'agent-vault', 'keys');
const keyFiles = [
  ...Object.values(CONFIG.agents).map((a) => a.keyFile),
  ...Object.values(CONFIG.merchantKeyFiles),
];
for (const f of keyFiles) if (!existsSync(join(keys, f))) add('FAIL', `Key file present: ${f}`);
if (keyFiles.every((f) => existsSync(join(keys, f)))) add('PASS', `All ${keyFiles.length} agent/merchant key files present (existence only checked)`);
if (existsSync(join(homedir(), '.config', 'solana', 'id.json'))) add('PASS', 'Fee-payer key file present (existence only checked)');
else add('FAIL', 'Fee-payer key file ~/.config/solana/id.json missing');
add(existsSync(join(homedir(), 'agent-vault', 'agent-service', 'node_modules')) ? 'PASS' : 'FAIL', 'agent-service dependencies installed', 'else: cd agent-service && npm install');

const fails = rows.filter((r) => r === 'FAIL').length;
console.log(fails ? `\n\x1b[31m${fails} FAIL — fix before recording.\x1b[0m\n` : '\n\x1b[32mAll clear — ready to record.\x1b[0m  (Phantom must be in Devnet mode; check manually.)\n');
process.exit(fails ? 1 : 0);

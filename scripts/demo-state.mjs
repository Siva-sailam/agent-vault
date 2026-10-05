// Read-only snapshot of the aUSD demo vault (Agent USD) on devnet.
// Public addresses only — never reads any key file. Everything vault-specific
// comes from agent-service/demo-vault.config.json.
// Usage: node scripts/demo-state.mjs [--json]
import { readFileSync } from 'node:fs';
import { address, createSolanaRpc } from '../agent-service/node_modules/@solana/kit/dist/index.node.mjs';
import { getVaultPdas, getAssociatedTokenAddress, decodeVaultRules } from '../agent-service/lib/program.mjs';

export const DEVNET_URL = 'https://api.devnet.solana.com';
export const CONFIG = JSON.parse(readFileSync(new URL('../agent-service/demo-vault.config.json', import.meta.url), 'utf8'));
export const SYMBOL = CONFIG.tokenSymbol;
export const OWNER = address(CONFIG.owner);
export const MINT = address(CONFIG.mint);
export const CLI_WALLET = address('8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf');
const AGENT_NAMES = Object.fromEntries(Object.entries(CONFIG.agents).map(([name, a]) => [a.address, name]));
const MERCHANT_WALLETS = CONFIG.merchants;
const ZERO = '11111111111111111111111111111111';

export async function readState(rpc = createSolanaRpc(DEVNET_URL)) {
  const pdas = await getVaultPdas(OWNER, MINT);
  const phantomAta = await getAssociatedTokenAddress(OWNER, MINT);
  const ataToName = {};
  for (const [name, w] of Object.entries(MERCHANT_WALLETS)) {
    ataToName[await getAssociatedTokenAddress(address(w), MINT)] = name;
  }
  const tokBal = async (a) => {
    const r = await rpc.getTokenAccountBalance(a).send().catch(() => null);
    return r ? Number(r.value.amount) : null;
  };
  const info = await rpc.getAccountInfo(pdas.rules, { encoding: 'base64' }).send();
  if (!info.value) throw new Error('aUSD demo vault rules account not found (run "Set up demo vault" in the control panel)');
  const rules = decodeVaultRules(Uint8Array.from(Buffer.from(info.value.data[0], 'base64')));
  const now = Math.floor(Date.now() / 1000);
  const agents = rules.agents
    .filter((a) => a.key !== ZERO)
    .map((a) => ({
      name: AGENT_NAMES[a.key] ?? a.key,
      budget: Number(a.weeklyBudget),
      spent: Number(a.spentSoFar),
      remaining: Number(a.weeklyBudget - a.spentSoFar),
      windowStart: new Date(a.windowStart * 1000).toISOString(),
      windowExpired: now - a.windowStart >= 7 * 86400,
      windowResetsAt: new Date((a.windowStart + 7 * 86400) * 1000).toISOString(),
      revoked: a.revoked,
      merchants: a.merchants.filter((m) => m !== ZERO).map((m) => ataToName[m] ?? m),
    }));
  const [cliSol, phantomSol] = await Promise.all([
    rpc.getBalance(CLI_WALLET).send().then((r) => Number(r.value) / 1e9),
    rpc.getBalance(OWNER).send().then((r) => Number(r.value) / 1e9),
  ]);
  return {
    vaultBalance: await tokBal(pdas.vault),
    phantomBalance: await tokBal(phantomAta),
    cliSol,
    phantomSol,
    agents,
    pdas,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await readState();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(s, null, 2));
  } else {
    console.log(`Vault balance:          ${s.vaultBalance} ${SYMBOL}`);
    console.log(`Phantom ${SYMBOL}:           ${s.phantomBalance}`);
    console.log(`Phantom SOL:            ${s.phantomSol}`);
    console.log(`CLI wallet (fee payer): ${s.cliSol} SOL`);
    for (const a of s.agents) {
      console.log(`\n${a.name}`);
      console.log(`  budget ${a.budget}  spent ${a.spent}  remaining ${a.remaining}`);
      console.log(`  window_start ${a.windowStart}  (resets ${a.windowResetsAt}${a.windowExpired ? ' — EXPIRED, next spend resets to 0' : ''})`);
      console.log(`  revoked ${a.revoked}`);
      console.log(`  merchants: ${a.merchants.join(', ') || '(none)'}`);
    }
  }
}

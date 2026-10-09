// The agent's V2 path against the REAL policy server over real HTTP
// (mock RPC, in-memory DB). Sends nothing to devnet.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { address } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

process.env.POLICY_SERVER_URL = 'http://127.0.0.1:4098';
const { buildApp } = await import('../../policy-server/src/server.mjs');
const { createV2Path, loadV2Config } = await import('../v2.mjs');

const sent = [];
const rpc = {
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 1n } }) }),
  simulateTransaction: () => ({ send: async () => ({ value: { err: null } }) }),
  sendTransaction: (w) => ({ send: async () => (sent.push(w), 'x') }),
  getSignatureStatuses: () => ({ send: async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] }) }),
  getAccountInfo: () => ({ send: async () => ({ value: null }) }),
};
const { server, db } = await buildApp({ dbFile: ':memory:', rpc });
const v2 = loadV2Config();
const demo = JSON.parse(readFileSync(new URL('../demo-vault.config.json', import.meta.url)));
const atas = {};
for (const [l, w] of Object.entries(demo.merchants))
  [atas[l]] = await findAssociatedTokenPda({ owner: address(w), mint: address(v2.mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
const path = await createV2Path({ rpc, v2, merchantAtas: atas });
const FOOD = 'food-ordering-agent-v2';
const SHOP = 'shopping-agent-v2';

before(() => new Promise((r) => server.listen(4098, '127.0.0.1', r)));
after(() => server.close());

test('Noonly 20 approved; budget visible via /v2/state', async () => {
  const r = await path.authorize(FOOD, 'Noonly', 20);
  assert.equal(r.approved, true, JSON.stringify(r));
  assert.deepEqual(await path.agentBudget(FOOD), { spent: 20, weeklyBudget: 200 });
});

test('each agent only reaches its own merchants', async () => {
  assert.equal((await path.authorize(FOOD, 'Amazen', 5)).reason, 'MerchantNotAllowed');
  assert.equal((await path.authorize(SHOP, 'Amazen', 20)).approved, true);
  assert.equal((await path.authorize(SHOP, 'Noonly', 5)).reason, 'MerchantNotAllowed');
});

test('scenario: Noonly off -> same payment refused before signing; revoke -> refused', async () => {
  const before = sent.length;
  db.prepare("update merchants set enabled = 0 where label = 'Noonly'").run();
  assert.equal((await path.authorize(FOOD, 'Noonly', 5)).reason, 'MerchantNotAllowed');
  db.prepare('update agents set revoked = 1 where name = ?').run(FOOD);
  assert.equal((await path.authorize(FOOD, 'Talabird', 5)).reason, 'AgentRevoked');
  assert.equal(sent.length, before, 'refusals must not submit anything');
});

test('BudgetExceeded over HTTP', async () => {
  assert.equal((await path.authorize(SHOP, 'Amazen', 500)).reason, 'BudgetExceeded');
});

test('policy server down -> PolicyServerUnavailable, nothing paid', async () => {
  // v2.mjs reads the server URL when it is imported, so import a second copy pointed at a dead port.
  process.env.POLICY_SERVER_URL = 'http://127.0.0.1:1';
  const { createV2Path: dead } = await import('../v2.mjs?dead');
  process.env.POLICY_SERVER_URL = 'http://127.0.0.1:4098';
  const p = await dead({ rpc, v2, merchantAtas: atas });
  const before = sent.length;
  assert.equal((await p.authorize(SHOP, 'Amazen', 5)).reason, 'PolicyServerUnavailable');
  assert.equal(sent.length, before);
});

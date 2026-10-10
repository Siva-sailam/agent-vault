import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '@solana/kit';
import { makeApp, food } from './helpers.mjs';

async function setup() {
  const t = await makeApp();
  await new Promise((r) => t.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${t.server.address().port}`;
  const post = (path, body, token) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body ?? {}),
    }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const challenge = () => fetch(`${base}/v2/admin/challenge`).then((r) => r.json());
  const login = async (keys = t.ownerKeys) => {
    const c = await challenge();
    return post('/v2/admin/session', { nonce: c.nonce, signature: await t.signWith(keys, c.message) });
  };
  return { t, base, post, challenge, login, close: () => t.server.close() };
}
const budgetPath = `/v2/agents/${food.address}/budget`;
const budgetOf = (t) => t.db.prepare('select weekly_budget b from agents where pubkey = ?').get(food.address).b;

test('every admin write is refused without a session (401), nothing changes', async () => {
  const { t, post, close } = await setup();
  for (const [path, body] of [
    [budgetPath, { weeklyBudget: 999 }],
    [`/v2/agents/${food.address}/revoke`],
    [`/v2/agents/${food.address}/unrevoke`],
    ['/v2/merchants/1/disable'],
    ['/v2/merchants/1/enable'],
  ]) {
    assert.deepEqual(await post(path, body), { status: 401, json: { error: 'Unauthorized' } }, path);
    assert.equal((await post(path, body, 'a'.repeat(64))).status, 401, path + ' bogus token');
  }
  assert.equal(budgetOf(t), 200);
  assert.equal(t.db.prepare('select revoked r from agents where pubkey = ?').get(food.address).r, 0);
  assert.equal(t.db.prepare('select count(*) n from rule_changes').get().n, 0);
  close();
});

test('owner signature -> session -> admin writes work', async () => {
  const { t, post, login, close } = await setup();
  const s = await login();
  assert.equal(s.status, 200);
  assert.match(s.json.token, /^[0-9a-f]{64}$/);
  assert.equal((await post(budgetPath, { weeklyBudget: 321 }, s.json.token)).status, 200);
  assert.equal(budgetOf(t), 321);
  assert.equal((await post(`/v2/agents/${food.address}/revoke`, {}, s.json.token)).status, 200);
  close();
});

test('a signature from any other key is refused', async () => {
  const { login, close } = await setup();
  const r = await login(await generateKeyPair());
  assert.deepEqual(r, { status: 401, json: { error: 'InvalidSignature' } });
  close();
});

test('challenges are single-use, and a tampered or invalid signature burns the nonce', async () => {
  const { t, post, challenge, close } = await setup();
  const c = await challenge();
  const signature = await t.signAs(c.message);
  assert.equal((await post('/v2/admin/session', { nonce: c.nonce, signature })).status, 200);
  assert.equal((await post('/v2/admin/session', { nonce: c.nonce, signature })).status, 401); // replay
  const c2 = await challenge();
  assert.equal((await post('/v2/admin/session', { nonce: c2.nonce, signature: await t.signAs(c2.message + 'x') })).status, 401); // signed other text
  assert.equal((await post('/v2/admin/session', { nonce: c2.nonce, signature: await t.signAs(c2.message) })).status, 401); // nonce already burned
  assert.equal((await post('/v2/admin/session', { nonce: 'nope', signature })).status, 401);
  assert.equal((await post('/v2/admin/session', { nonce: c.nonce, signature: 'AAAA' })).status, 401); // wrong length
  assert.equal((await post('/v2/admin/session', {})).status, 401);
  close();
});

test('challenge and session expire', async (ctx) => {
  const { t, post, challenge, close } = await setup();
  ctx.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const c = await challenge();
  const sig = await t.signAs(c.message);
  const ok = await post('/v2/admin/session', { nonce: c.nonce, signature: sig });
  assert.equal(ok.status, 200);
  ctx.mock.timers.tick(29 * 60 * 1000);
  assert.equal((await post(budgetPath, { weeklyBudget: 5 }, ok.json.token)).status, 200);
  ctx.mock.timers.tick(2 * 60 * 1000); // 31 min after login
  assert.equal((await post(budgetPath, { weeklyBudget: 6 }, ok.json.token)).status, 401);
  const c2 = await challenge();
  const sig2 = await t.signAs(c2.message);
  ctx.mock.timers.tick(3 * 60 * 1000); // sat on the challenge for 3 min
  assert.equal((await post('/v2/admin/session', { nonce: c2.nonce, signature: sig2 })).status, 401);
  close();
});

test('/v2/state and /v2/authorize stay open; state has no auth flag', async () => {
  const { t, base, close } = await setup();
  const st = await (await fetch(`${base}/v2/state`)).json();
  assert.ok(st.agents.length && !('unauthenticatedAdmin' in st));
  assert.equal((await t.ask()).approved, true); // authorize needs no admin session
  close();
});

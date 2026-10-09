import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, food, shopper } from './helpers.mjs';

const refused = (r, reason) => {
  assert.equal(r.approved, false);
  assert.equal(r.reason, reason, JSON.stringify(r));
};
const spendRows = (db) => db.prepare('select * from spends order by id').all();
const spent = (db, agent) => db.prepare('select spent from windows where agent = ?').get(agent.address).spent;

test('pass: verified, reserved, co-signed, submitted, confirmed', async () => {
  const t = await makeApp();
  const r = await t.ask();
  assert.equal(r.approved, true, JSON.stringify(r));
  assert.ok(r.signature);
  assert.equal(t.rpc.calls.send, 1);
  const [row] = spendRows(t.db);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.signature, r.signature);
  assert.equal(spent(t.db, food), 20);
});

test('BudgetExceeded: refused, nothing signed or submitted, logged', async () => {
  const t = await makeApp();
  refused(await t.ask('Noonly', 201), 'BudgetExceeded');
  assert.equal(t.rpc.calls.simulate + t.rpc.calls.send, 0);
  assert.equal(spendRows(t.db)[0].status, 'refused');
  assert.equal(spent(t.db, food), 0);
});

test('BudgetExceeded: cumulative spend, exact boundary allowed', async () => {
  const t = await makeApp();
  assert.equal((await t.ask('Noonly', 150)).approved, true);
  assert.equal((await t.ask('Talabird', 50)).approved, true); // exactly the remaining 50
  refused(await t.ask('Noonly', 1), 'BudgetExceeded');
});

test('MerchantNotAllowed: disabled merchant, and a merchant on another agent\'s list', async () => {
  const t = await makeApp();
  t.db.prepare("update merchants set enabled = 0 where label = 'Noonly' and agent = ?").run(food.address);
  refused(await t.ask(), 'MerchantNotAllowed');
  refused(await t.ask('Amazen', 5), 'MerchantNotAllowed');
  assert.equal(t.rpc.calls.send, 0);
});

test('AgentRevoked, then allowed again after unrevoke', async () => {
  const t = await makeApp();
  t.db.prepare('update agents set revoked = 1 where pubkey = ?').run(food.address);
  refused(await t.ask(), 'AgentRevoked');
  t.db.prepare('update agents set revoked = 0 where pubkey = ?').run(food.address);
  assert.equal((await t.ask()).approved, true);
});

test('TransactionMismatch: transaction pays a different merchant than the intent', async () => {
  const t = await makeApp();
  const transaction = await t.build({ dest: t.ata('Talabird') });
  refused(await t.authorize({ transaction, intent: { merchant: t.ata('Noonly'), amount: 20 } }), 'TransactionMismatch');
  assert.equal(t.rpc.calls.send, 0);
});

test('TransactionMismatch: different amount than the intent', async () => {
  const t = await makeApp();
  const transaction = await t.build({ amount: 25n });
  refused(await t.authorize({ transaction, intent: { merchant: t.ata('Noonly'), amount: 20 } }), 'TransactionMismatch');
});

test('TransactionMismatch: extra instruction', async () => {
  const t = await makeApp();
  const transaction = await t.build({ extra: true });
  refused(await t.authorize({ transaction, intent: { merchant: t.ata('Noonly'), amount: 20 } }), 'TransactionMismatch');
});

test('TransactionMismatch: wrong fee payer, wrong mint, wrong decimals, garbage', async () => {
  const t = await makeApp();
  const intent = { merchant: t.ata('Noonly'), amount: 20 };
  refused(await t.authorize({ transaction: await t.build({ payer: shopper.address }), intent }), 'TransactionMismatch');
  refused(await t.authorize({ transaction: await t.build({ mint: t.ata('Noonly') }), intent }), 'TransactionMismatch');
  refused(await t.authorize({ transaction: await t.build({ decimals: 6 }), intent }), 'TransactionMismatch');
  refused(await t.authorize({ transaction: 'AAAA', intent }), 'TransactionMismatch');
  refused(await t.authorize({ transaction: await t.build(), intent: { merchant: intent.merchant, amount: -1 } }), 'TransactionMismatch');
  assert.equal(t.rpc.calls.send, 0);
});

test('cross-agent: shopping agent cannot spend from the food vault, and vice versa', async () => {
  const t = await makeApp();
  // shopper signs a transfer authorised by the FOOD multisig
  refused(await t.authorize({ transaction: await t.build({ who: shopper }), intent: { merchant: t.ata('Noonly'), amount: 20 } }), 'TransactionMismatch');
  // food agent signs a transfer from the SHOPPING vault
  refused(
    await t.authorize({ transaction: await t.build({ vault: t.shopVault, ms: t.shopV.multisig, dest: t.ata('Amazen') }), intent: { merchant: t.ata('Amazen'), amount: 20 } }),
    'TransactionMismatch',
  );
  // each agent can pay from its own vault
  assert.equal((await t.ask()).approved, true);
  const own = await t.authorize({
    transaction: await t.build({ who: shopper, vault: t.shopVault, ms: t.shopV.multisig, dest: t.ata('Amazen') }),
    intent: { merchant: t.ata('Amazen'), amount: 20 },
  });
  assert.equal(own.approved, true, JSON.stringify(own));
  // and the shopping agent still cannot pay a food merchant from its own vault
  refused(
    await t.authorize({ transaction: await t.build({ who: shopper, vault: t.shopVault, ms: t.shopV.multisig }), intent: { merchant: t.ata('Noonly'), amount: 20 } }),
    'MerchantNotAllowed',
  );
});

test('missing agent signature -> AgentNotFound (server never signs)', async () => {
  const t = await makeApp();
  // build with the agent replaced by a no-op signer: structurally valid, unsigned
  const { createNoopSigner } = await import('@solana/kit');
  const unsigned = await t.build({ who: createNoopSigner(food.address) });
  refused(await t.authorize({ transaction: unsigned, intent: { merchant: t.ata('Noonly'), amount: 20 } }), 'AgentNotFound');
  assert.equal(t.rpc.calls.send, 0);
});

test('concurrent: two requests that together exceed the budget -> exactly one passes', async () => {
  const t = await makeApp();
  const a = { transaction: await t.build({ amount: 120n }), intent: { merchant: t.ata('Noonly'), amount: 120 } };
  const b = { transaction: await t.build({ amount: 120n, dest: t.ata('Talabird') }), intent: { merchant: t.ata('Talabird'), amount: 120 } };
  const results = await Promise.all([t.authorize(a), t.authorize(b)]);
  assert.equal(results.filter((r) => r.approved).length, 1, JSON.stringify(results));
  assert.equal(results.filter((r) => r.reason === 'BudgetExceeded').length, 1);
  assert.equal(spent(t.db, food), 120);
  assert.equal(t.rpc.calls.send, 1);
});

test('concurrent burst of 10 requests (245 total) against 200 -> spent never exceeds budget', async () => {
  const t = await makeApp();
  // 10 different amounts (distinct transactions) totalling 245 > 200
  const amounts = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
  const reqs = await Promise.all(
    amounts.map(async (a) => ({ transaction: await t.build({ amount: BigInt(a) }), intent: { merchant: t.ata('Noonly'), amount: a } })),
  );
  const results = await Promise.all(reqs.map((r) => t.authorize(r)));
  const approvedSum = results.reduce((n, r, i) => n + (r.approved ? amounts[i] : 0), 0);
  assert.ok(approvedSum <= 200, `approved ${approvedSum} > budget`);
  assert.equal(spent(t.db, food), approvedSum);
  assert.equal(t.rpc.calls.send, results.filter((r) => r.approved).length);
  for (const r of results) if (!r.approved) assert.equal(r.reason, 'BudgetExceeded');
});

test('failed simulation: spend marked failed, reservation released, no submit', async () => {
  const t = await makeApp({ simErr: { InstructionError: [0, { Custom: 1 }] } });
  const r = await t.ask();
  refused(r, 'SimulationFailed');
  assert.equal(t.rpc.calls.send, 0);
  assert.equal(spendRows(t.db)[0].status, 'failed');
  assert.equal(spent(t.db, food), 0);
});

test('the same signed transaction cannot reserve budget twice', async () => {
  const t = await makeApp();
  const req = { transaction: await t.build(), intent: { merchant: t.ata('Noonly'), amount: 20 } };
  assert.equal((await t.authorize(req)).approved, true);
  refused(await t.authorize(req), 'DuplicateTransaction');
  assert.equal(spent(t.db, food), 20);
});

test('window: resets lazily on the next spend after 7 days', async () => {
  const t = await makeApp();
  assert.equal((await t.ask('Noonly', 200)).approved, true);
  refused(await t.ask('Noonly', 1), 'BudgetExceeded');
  const old = Math.floor(Date.now() / 1000) - 7 * 24 * 3600 - 5;
  t.db.prepare('update windows set window_start = ? where agent = ?').run(old, food.address);
  assert.equal((await t.ask('Noonly', 10)).approved, true);
  assert.equal(spent(t.db, food), 10);
});

test('refusals are logged for the audit trail', async () => {
  const t = await makeApp();
  t.db.prepare('update agents set revoked = 1').run();
  await t.ask();
  const [row] = spendRows(t.db);
  assert.equal(row.status, 'refused');
  assert.match(row.reason, /AgentRevoked/);
});

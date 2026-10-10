import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, food, shopper } from './helpers.mjs';

const spent = (db, agent) => db.prepare('select spent from windows where agent = ?').get(agent.address).spent;
const changes = (db) => db.prepare('select * from rule_changes order by id').all();
const budgetOf = (db, agent) => db.prepare('select weekly_budget b from agents where pubkey = ?').get(agent.address).b;

/** Calls the real HTTP handler on an ephemeral localhost port. */
async function http(t, path, body) {
  if (!t.server.listening) await new Promise((r) => t.server.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${t.server.address().port}${path}`, {
    method: path === '/v2/state' ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
const setBudget = (t, agent, weeklyBudget) => http(t, `/v2/agents/${agent.address}/budget`, { weeklyBudget });
const done = (t) => t.server.listening && t.server.close();

test('raise budget: a request that failed BudgetExceeded now passes', async () => {
  const t = await makeApp();
  assert.equal((await t.ask('Noonly', 201)).reason, 'BudgetExceeded');
  const r = await setBudget(t, food, 300);
  assert.deepEqual(r, { status: 200, json: { ok: true, oldBudget: 200, weeklyBudget: 300 } });
  assert.equal((await t.ask('Noonly', 201)).approved, true);
  done(t);
});

test('lower budget below spent: remaining 0, no clawback, next authorize BudgetExceeded', async () => {
  const t = await makeApp();
  assert.equal((await t.ask('Noonly', 150)).approved, true);
  assert.equal((await setBudget(t, food, 100)).status, 200);
  assert.equal(spent(t.db, food), 150); // untouched: no clawback, no window reset
  const { json } = await http(t, '/v2/state');
  const a = json.agents.find((x) => x.pubkey === food.address);
  assert.equal(a.remaining, 0);
  assert.equal(a.spent, 150);
  assert.equal((await t.ask('Noonly', 1)).reason, 'BudgetExceeded');
  done(t);
});

test('pending reservations count as spent', async () => {
  const t = await makeApp();
  t.db.prepare('update windows set spent = 150 where agent = ?').run(food.address); // as if 150 pending
  await setBudget(t, food, 160);
  assert.equal((await t.ask('Noonly', 11)).reason, 'BudgetExceeded');
  assert.equal((await t.ask('Noonly', 10)).approved, true);
  done(t);
});

test('invalid values -> 400 InvalidBudget, nothing changed or logged', async () => {
  const t = await makeApp();
  for (const v of [0, -5, 1.5, 'abc', '50', 10001, null, NaN, undefined]) {
    const r = await setBudget(t, food, v);
    assert.equal(r.status, 400, String(v));
    assert.equal(r.json.error, 'InvalidBudget', String(v));
  }
  assert.equal((await http(t, `/v2/agents/${food.address}/budget`, {})).status, 400); // missing field
  assert.equal(budgetOf(t.db, food), 200);
  assert.equal(changes(t.db).length, 0);
  for (const v of [1, 10000]) assert.equal((await setBudget(t, food, v)).status, 200); // bounds inclusive
  done(t);
});

test('unknown agent -> 404 AgentNotFound', async () => {
  const t = await makeApp();
  const r = await http(t, '/v2/agents/11111111111111111111111111111111/budget', { weeklyBudget: 50 });
  assert.deepEqual(r, { status: 404, json: { error: 'AgentNotFound' } });
  assert.equal(changes(t.db).length, 0);
  done(t);
});

test('each change writes exactly one rule_changes row; /v2/state shows the last 20', async () => {
  const t = await makeApp();
  await setBudget(t, food, 250);
  await setBudget(t, shopper, 75);
  const rows = changes(t.db);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    [rows[0].agent, rows[0].field, rows[0].old_value, rows[0].new_value],
    [food.address, 'weekly_budget', '200', '250'],
  );
  assert.equal(rows[1].agent, shopper.address);
  assert.equal(rows[1].new_value, '75');
  assert.ok(rows[0].changed_at > 0);
  for (let i = 0; i < 25; i++) await setBudget(t, food, 300 + i);
  const { json } = await http(t, '/v2/state');
  assert.equal(json.ruleChanges.length, 20);
  assert.equal(json.ruleChanges[0].newValue, '324'); // newest first
  done(t);
});

test('budget updates racing authorize never approve more than the budget in force', async () => {
  const t = await makeApp();
  // Mark, at every budget change, the last spend id and window spend at that instant.
  t.db.exec(`
    CREATE TABLE marks (change_id INTEGER, last_spend INTEGER, spent_then INTEGER);
    CREATE TRIGGER mark AFTER INSERT ON rule_changes BEGIN
      INSERT INTO marks SELECT NEW.id, COALESCE((SELECT MAX(id) FROM spends), 0), (SELECT spent FROM windows WHERE agent = NEW.agent);
    END;`);
  const budgets = [60, 120, 40, 200, 80];
  const jobs = [];
  for (let i = 0; i < 30; i++) {
    jobs.push(t.ask(i % 2 ? 'Noonly' : 'Talabird', 10 + (i % 3)));
    if (i % 6 === 0) jobs.push(Promise.resolve().then(() => t.db.transaction(() => 0)()).then(() => setBudget(t, food, budgets[i / 6])));
  }
  await Promise.all(jobs);
  // After each change N (budget B, window spend S at that instant), reservations made
  // before the next change must keep spend <= max(B, S): approved only while within B.
  const ch = changes(t.db);
  const marks = t.db.prepare('select * from marks order by change_id').all();
  const spends = t.db.prepare("select * from spends where status in ('pending','confirmed') order by id").all();
  ch.forEach((c, i) => {
    const hi = marks[i + 1]?.last_spend ?? Infinity;
    const B = Number(c.new_value);
    const inEra = spends.filter((s) => s.id > marks[i].last_spend && s.id <= hi).reduce((n, s) => n + s.amount, 0);
    assert.ok(marks[i].spent_then + inEra <= Math.max(B, marks[i].spent_then), `era ${i}: budget ${B}, spent then ${marks[i].spent_then}, +${inEra}`);
  });
  done(t);
});

// SQLite rules + spend history. Window semantics match V1: a 7-day window
// that resets lazily on the next spend after it has elapsed.
import Database from 'better-sqlite3';

export function openDb(file) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      pubkey        TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      weekly_budget INTEGER NOT NULL,
      revoked       INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS merchants (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      agent         TEXT NOT NULL REFERENCES agents(pubkey),
      token_account TEXT NOT NULL,
      label         TEXT NOT NULL,
      enabled       INTEGER NOT NULL DEFAULT 1,
      UNIQUE (agent, token_account)
    );
    CREATE TABLE IF NOT EXISTS spends (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      agent        TEXT,
      merchant     TEXT,
      amount       INTEGER,
      status       TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed','refused')),
      reason       TEXT,
      signature    TEXT,
      agent_sig    TEXT,
      window_start INTEGER,
      created_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS windows (
      agent        TEXT PRIMARY KEY REFERENCES agents(pubkey),
      window_start INTEGER NOT NULL,
      spent        INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS rule_changes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      agent      TEXT NOT NULL,
      field      TEXT NOT NULL,
      old_value  TEXT,
      new_value  TEXT,
      changed_at INTEGER NOT NULL
    );
  `);
  return db;
}

const now = () => Math.floor(Date.now() / 1000);

/** Idempotent seed: INSERT OR IGNORE, so rules edited later are never overwritten. */
export function seed(db, { agents }) {
  const addAgent = db.prepare('INSERT OR IGNORE INTO agents (pubkey, name, weekly_budget) VALUES (?, ?, ?)');
  const addMerchant = db.prepare(
    'INSERT OR IGNORE INTO merchants (agent, token_account, label) VALUES (?, ?, ?)',
  );
  const addWindow = db.prepare('INSERT OR IGNORE INTO windows (agent, window_start, spent) VALUES (?, ?, 0)');
  db.transaction(() => {
    for (const a of agents) {
      addAgent.run(a.pubkey, a.name, a.weeklyBudget);
      addWindow.run(a.pubkey, now());
      for (const m of a.merchants) addMerchant.run(a.pubkey, m.tokenAccount, m.label);
    }
  })();
}

export const MAX_WEEKLY_BUDGET = 10000;

/**
 * Sets an agent's weekly budget and audits it, in ONE transaction. better-sqlite3
 * is synchronous, so this cannot interleave with authorize's reservation.
 * Takes effect on the current window as-is: spent is untouched (no clawback,
 * no window reset), so remaining = new budget - spent (floored at 0 on display).
 * Returns null for an unknown agent.
 */
export function setWeeklyBudget(db, pubkey, weeklyBudget) {
  return db.transaction(() => {
    const a = db.prepare('SELECT weekly_budget FROM agents WHERE pubkey = ?').get(pubkey);
    if (!a) return null;
    db.prepare('UPDATE agents SET weekly_budget = ? WHERE pubkey = ?').run(weeklyBudget, pubkey);
    db.prepare(
      'INSERT INTO rule_changes (agent, field, old_value, new_value, changed_at) VALUES (?,?,?,?,?)',
    ).run(pubkey, 'weekly_budget', String(a.weekly_budget), String(weeklyBudget), now());
    return { oldBudget: a.weekly_budget, weeklyBudget };
  })();
}

export function getState(db, windowSeconds, recent = 25) {
  const t = now();
  const agents = db.prepare('SELECT * FROM agents').all().map((a) => {
    const w = db.prepare('SELECT * FROM windows WHERE agent = ?').get(a.pubkey);
    // Show the effective window: an elapsed one reads as fresh (lazy reset).
    const elapsed = w && t >= w.window_start + windowSeconds;
    const spent = elapsed ? 0 : (w?.spent ?? 0);
    return {
      pubkey: a.pubkey,
      name: a.name,
      weeklyBudget: a.weekly_budget,
      revoked: !!a.revoked,
      windowStart: elapsed ? t : (w?.window_start ?? t),
      windowEnd: (elapsed ? t : (w?.window_start ?? t)) + windowSeconds,
      spent,
      remaining: Math.max(a.weekly_budget - spent, 0),
    };
  });
  const merchants = db
    .prepare('SELECT id, agent, token_account AS tokenAccount, label, enabled FROM merchants ORDER BY id')
    .all()
    .map((m) => ({ ...m, enabled: !!m.enabled }));
  const spends = db.prepare('SELECT * FROM spends ORDER BY id DESC LIMIT ?').all(recent);
  const ruleChanges = db
    .prepare('SELECT id, agent, field, old_value AS oldValue, new_value AS newValue, changed_at AS changedAt FROM rule_changes ORDER BY id DESC LIMIT 20')
    .all();
  return { agents, merchants, spends, ruleChanges };
}

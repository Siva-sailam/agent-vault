// POST /v2/authorize logic. Refuses on the first failure with a named reason;
// on pass, reserves the spend in ONE SQLite transaction (so concurrent
// requests cannot both pass the budget check), then co-signs, simulates,
// submits and confirms.
import {
  assertIsFullySignedTransaction,
  getBase64EncodedWireTransaction,
  getBase64Decoder,
  getSignatureFromTransaction,
  partiallySignTransaction,
} from '@solana/kit';
import { agentSignatureValid, verifyTransaction } from './verify.mjs';

const b64Decoder = getBase64Decoder();
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createAuthorizer({ db, cfg, serverSigner, rpc, windowSeconds, confirmTimeoutMs = 60_000 }) {
  const q = {
    agent: db.prepare('SELECT * FROM agents WHERE pubkey = ?'),
    merchant: db.prepare('SELECT * FROM merchants WHERE agent = ? AND token_account = ?'),
    window: db.prepare('SELECT * FROM windows WHERE agent = ?'),
    dup: db.prepare("SELECT 1 FROM spends WHERE agent_sig = ? AND status IN ('pending','confirmed')"),
    setWindow: db.prepare('UPDATE windows SET window_start = ?, spent = ? WHERE agent = ?'),
    insert: db.prepare(
      'INSERT INTO spends (agent, merchant, amount, status, reason, agent_sig, window_start, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ),
    finish: db.prepare('UPDATE spends SET status = ?, signature = ?, reason = ? WHERE id = ?'),
    spend: db.prepare('SELECT * FROM spends WHERE id = ?'),
    release: db.prepare('UPDATE windows SET spent = MAX(spent - ?, 0) WHERE agent = ? AND window_start = ?'),
  };

  function logRefusal(reason, { agent = null, intent, agentSig = null, detail = null }) {
    const merchant = typeof intent?.merchant === 'string' ? intent.merchant : null;
    const amount = Number.isSafeInteger(intent?.amount) ? intent.amount : null;
    q.insert.run(agent, merchant, amount, 'refused', detail ? `${reason}: ${detail}` : reason, agentSig, null, now());
    return { approved: false, reason, ...(detail ? { detail } : {}) };
  }

  /** Checks c–e and reserves, atomically. Returns {refuse} or {spendId}. */
  const reserve = db.transaction((agent, intent, agentSig) => {
    const a = q.agent.get(agent);
    if (!a) return { refuse: ['AgentNotFound'] };
    if (a.revoked) return { refuse: ['AgentRevoked'] };
    const m = q.merchant.get(agent, intent.merchant);
    if (!m || !m.enabled) return { refuse: ['MerchantNotAllowed'] };
    if (q.dup.get(agentSig)) return { refuse: ['DuplicateTransaction'] };

    const t = now();
    let w = q.window.get(agent);
    if (!w) {
      db.prepare('INSERT INTO windows (agent, window_start, spent) VALUES (?, ?, 0)').run(agent, t);
      w = { window_start: t, spent: 0 };
    }
    // Lazy reset: only when a spend actually comes in after the window elapsed.
    const reset = t >= w.window_start + windowSeconds;
    const windowStart = reset ? t : w.window_start;
    const spent = reset ? 0 : w.spent;
    if (intent.amount > a.weekly_budget - spent) return { refuse: ['BudgetExceeded', `remaining ${a.weekly_budget - spent}`] };

    q.setWindow.run(windowStart, spent + intent.amount, agent);
    const { lastInsertRowid } = q.insert.run(agent, intent.merchant, intent.amount, 'pending', null, agentSig, windowStart, t);
    return { spendId: Number(lastInsertRowid) };
  });

  function fail(spendId, reason) {
    db.transaction(() => {
      const s = q.spend.get(spendId);
      q.finish.run('failed', null, reason, spendId);
      q.release.run(s.amount, s.agent, s.window_start);
    })();
  }

  async function confirm(signature, blockhash) {
    const deadline = Date.now() + confirmTimeoutMs;
    while (Date.now() < deadline) {
      const { value } = await rpc.getSignatureStatuses([signature]).send();
      const st = value[0];
      if (st?.err) return { ok: false, detail: JSON.stringify(st.err, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) };
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return { ok: true };
      await sleep(1000);
    }
    return { ok: false, detail: 'confirmation timeout' };
  }

  return async function authorize(body) {
    const { transaction: b64, intent } = body ?? {};

    // a. TAMPER CHECK
    const v = verifyTransaction(b64, intent, cfg);
    if (!v.ok) return logRefusal(v.reason, { intent, detail: v.detail });
    const agentSigB64 = v.agentSignature ? b64Decoder.decode(v.agentSignature) : null;

    // b. agent signature present (and valid) + agent registered
    if (!(await agentSignatureValid(v.agent, v.agentSignature, v.messageBytes)))
      return logRefusal('AgentNotFound', { agent: v.agent, intent, detail: 'missing or invalid agent signature' });

    // b (registered), c, d, e + reservation
    const r = reserve(v.agent, intent, agentSigB64);
    if (r.refuse) return logRefusal(r.refuse[0], { agent: v.agent, intent, agentSig: agentSigB64, detail: r.refuse[1] });

    // Pass: co-sign what we verified, simulate, submit, confirm.
    try {
      const signed = await partiallySignTransaction([serverSigner.keyPair], v.transaction);
      assertIsFullySignedTransaction(signed);
      const wire = getBase64EncodedWireTransaction(signed);
      const sig = getSignatureFromTransaction(signed);

      const sim = await rpc.simulateTransaction(wire, { encoding: 'base64', commitment: 'confirmed' }).send();
      if (sim.value.err) {
        const detail = JSON.stringify(sim.value.err, (_, x) => (typeof x === 'bigint' ? x.toString() : x));
        fail(r.spendId, `simulation failed: ${detail}`);
        return { approved: false, reason: 'SimulationFailed', detail, spendId: r.spendId };
      }
      await rpc.sendTransaction(wire, { encoding: 'base64', skipPreflight: true }).send();
      const c = await confirm(sig);
      if (!c.ok) {
        fail(r.spendId, `chain: ${c.detail}`);
        return { approved: false, reason: 'SubmissionFailed', detail: c.detail, signature: sig, spendId: r.spendId };
      }
      q.finish.run('confirmed', sig, null, r.spendId);
      return { approved: true, signature: sig, spendId: r.spendId };
    } catch (e) {
      fail(r.spendId, `error: ${e.message}`);
      return { approved: false, reason: 'SubmissionFailed', detail: e.message, spendId: r.spendId };
    }
  };
}

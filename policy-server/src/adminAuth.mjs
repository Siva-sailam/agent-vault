// Admin auth: the vault owner proves control of their wallet once with
// Phantom signMessage and gets a short-lived session token.
//
//   GET  /v2/admin/challenge  -> { nonce, message, expiresAt }
//   POST /v2/admin/session    { nonce, signature (base64, 64 bytes) } -> { token, expiresAt }
//   Admin writes then send    Authorization: Bearer <token>
//
// The server builds the message text itself and remembers it by nonce, so the
// client can only sign what the server issued. Challenges are single-use and
// expire after 2 minutes. Sessions live in memory (a server restart signs
// everyone out) and last 30 minutes. A session lets the panel change RULES;
// it can never move funds (that still needs the multisig).
import { randomBytes } from 'node:crypto';
import { address, getBase64Encoder, getPublicKeyFromAddress, verifySignature } from '@solana/kit';

const CHALLENGE_TTL_S = 120;
export const SESSION_TTL_S = 30 * 60;
const MAX_PENDING = 100;
const b64 = getBase64Encoder();
const now = () => Math.floor(Date.now() / 1000);

export function createAdminAuth({ owner }) {
  const challenges = new Map(); // nonce -> { message, expiresAt }
  const sessions = new Map(); // token -> expiresAt

  const sweep = () => {
    const t = now();
    for (const [k, c] of challenges) if (c.expiresAt <= t) challenges.delete(k);
    for (const [k, e] of sessions) if (e <= t) sessions.delete(k);
  };

  function challenge() {
    sweep();
    if (challenges.size >= MAX_PENDING) challenges.delete(challenges.keys().next().value);
    const nonce = randomBytes(16).toString('hex');
    const expiresAt = now() + CHALLENGE_TTL_S;
    const message = [
      'Agent Vault: sign in to the policy server admin API',
      `Owner: ${owner}`,
      `Nonce: ${nonce}`,
      `Valid until: ${new Date(expiresAt * 1000).toISOString()}`,
      '',
      `This lets the control panel change rules (limits, merchants, revoke) for ${SESSION_TTL_S / 60} minutes.`,
      'It cannot move funds.',
    ].join('\n');
    challenges.set(nonce, { message, expiresAt });
    return { nonce, message, expiresAt };
  }

  /** Verifies the owner's signature over the issued challenge; consumes it either way. */
  async function login({ nonce, signature } = {}) {
    sweep();
    const c = typeof nonce === 'string' ? challenges.get(nonce) : undefined;
    if (!c) return null;
    challenges.delete(nonce);
    try {
      const sig = b64.encode(String(signature));
      if (sig.length !== 64) return null;
      const key = await getPublicKeyFromAddress(address(owner));
      if (!(await verifySignature(key, sig, new TextEncoder().encode(c.message)))) return null;
    } catch {
      return null;
    }
    const token = randomBytes(32).toString('hex');
    const expiresAt = now() + SESSION_TTL_S;
    sessions.set(token, expiresAt);
    return { token, expiresAt };
  }

  function authorized(req) {
    const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '');
    const exp = m && sessions.get(m[1]);
    return Boolean(exp && exp > now());
  }

  return { challenge, login, authorized };
}

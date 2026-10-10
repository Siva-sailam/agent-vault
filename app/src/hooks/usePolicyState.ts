import { useCallback, useEffect, useRef, useState } from 'react';

export const POLICY_SERVER_URL = 'http://localhost:4031';

export type PolicyAgent = {
  pubkey: string;
  name: string;
  weeklyBudget: number;
  revoked: boolean;
  windowStart: number;
  windowEnd: number;
  spent: number;
  remaining: number;
  vault: string;
  vaultBalance: number | null;
};
export type PolicyMerchant = { id: number; agent: string; tokenAccount: string; label: string; enabled: boolean };
export type PolicyState = { agents: PolicyAgent[]; merchants: PolicyMerchant[] };

/** Result of a budget change: `error` is the server's text when it refused. */
export type BudgetResult = { ok: true } | { ok: false; error: string };

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;
type Session = { token: string; expiresAt: number };

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * Polls the V2 policy server's state. `online` is false when it can't be
 * reached (payments pause; withdraw still works).
 *
 * Reads are open. Admin WRITES need an owner session: the first write asks
 * Phantom to sign a short challenge message (signMessage, no transaction, no
 * fee), the server hands back a 30-minute token, and later writes reuse it.
 * The token lives in memory only: a page reload asks again.
 */
export function usePolicyState(pollMs = 3000, signMessage?: SignMessage) {
  const [state, setState] = useState<PolicyState | null>(null);
  const [online, setOnline] = useState(false);
  const [adminError, setAdminError] = useState('');
  const session = useRef<Session | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${POLICY_SERVER_URL}/v2/state`);
      setState(await res.json());
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  async function login(): Promise<string> {
    if (!signMessage) throw new Error('Connect your wallet to change rules.');
    const c = await (await fetch(`${POLICY_SERVER_URL}/v2/admin/challenge`)).json();
    let sig: Uint8Array;
    try {
      sig = await signMessage(new TextEncoder().encode(c.message));
    } catch {
      throw new Error('Sign-in cancelled in the wallet.');
    }
    const res = await fetch(`${POLICY_SERVER_URL}/v2/admin/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce: c.nonce, signature: toBase64(sig) }),
    });
    if (!res.ok) throw new Error('The policy server did not accept that signature (is this the vault owner wallet?).');
    session.current = await res.json();
    return session.current!.token;
  }

  /** POST to the admin API with a valid session; signs in first if needed, retries once on 401. */
  const adminPost = useCallback(
    async (path: string, body?: object): Promise<Response> => {
      const send = (token: string) =>
        fetch(`${POLICY_SERVER_URL}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: body ? JSON.stringify(body) : undefined,
        });
      const s = session.current;
      let res = await send(s && s.expiresAt - 30 > nowSec() ? s.token : await login());
      if (res.status === 401) res = await send(await login());
      return res;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signMessage],
  );

  /** Revoke / merchant toggles. Failures show in `adminError`. */
  const admin = useCallback(
    async (path: string) => {
      setAdminError('');
      try {
        const res = await adminPost(path);
        if (!res.ok) setAdminError((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      } catch (e) {
        setAdminError(e instanceof Error && e.message ? e.message : 'Policy server unavailable on :4031');
      }
      await refresh();
    },
    [adminPost, refresh],
  );

  const setBudget = useCallback(
    async (pubkey: string, weeklyBudget: number): Promise<BudgetResult> => {
      try {
        const res = await adminPost(`/v2/agents/${pubkey}/budget`, { weeklyBudget });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: body.detail ?? body.error ?? `HTTP ${res.status}` };
        }
        await refresh();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error && e.message ? e.message : 'Policy server unavailable on :4031' };
      }
    },
    [adminPost, refresh],
  );

  return { state, online, refresh, admin, setBudget, adminError };
}

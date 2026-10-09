import { useCallback, useEffect, useState } from 'react';

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

/**
 * Polls the V2 policy server's state. `online` is false when it can't be
 * reached (payments pause; recovery still works). The admin calls are
 * UNAUTHENTICATED in this milestone — the server only listens on localhost.
 */
export function usePolicyState(pollMs = 3000) {
  const [state, setState] = useState<PolicyState | null>(null);
  const [online, setOnline] = useState(false);

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

  const admin = useCallback(
    async (path: string) => {
      await fetch(`${POLICY_SERVER_URL}${path}`, { method: 'POST' });
      await refresh();
    },
    [refresh],
  );

  return { state, online, refresh, admin };
}

import { useEffect, useState } from 'react';
import { address } from '@solana/kit';
import type { AppClient } from '../providers';
import { fetchTokenBalance } from '../lib/rpcHelpers';
import { solscanAccount } from '../lib/solscan';
import { useRecoveryAction, type V2Agent } from '../hooks/useRecoveryAction';
import { usePolicyState, type PolicyState } from '../hooks/usePolicyState';
import v2 from '../lib/v2-vaults.json';

const POLL_MS = 6000;

function useVaultBalance(client: AppClient, vault: string, tick: number) {
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => fetchTokenBalance(client.rpc, address(vault)).then((b) => !cancelled && setBalance(b));
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [client, vault, tick]);
  return balance;
}

const fmtTime = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Budget / merchant toggles / revoke for one agent, via the policy server's admin API. */
function PolicyRows({ agent, state, admin }: { agent: V2Agent; state: PolicyState; admin: (path: string) => Promise<void> }) {
  const a = state.agents.find((x) => x.pubkey === agent.address);
  if (!a) return null;
  const merchants = state.merchants.filter((m) => m.agent === a.pubkey);
  return (
    <>
      <div className="sf-budget">
        <div className="sf-budget-row">
          <span>Weekly budget</span>
          <strong>
            {a.spent} / {a.weeklyBudget} aUSD
          </strong>
        </div>
        <div className="sf-budget-track">
          <div style={{ width: `${Math.min(100, (a.spent / a.weeklyBudget) * 100)}%` }} />
        </div>
        <p className="hint">Window resets {fmtTime(a.windowEnd)} (on the first spend after that)</p>
      </div>
      <p className="hero-label">Merchants</p>
      {merchants.map((m) => (
        <label key={m.id} className="switch-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
          <span>{m.label}</span>
          <span className="switch">
            <input type="checkbox" checked={m.enabled} onChange={() => admin(`/v2/merchants/${m.id}/${m.enabled ? 'disable' : 'enable'}`)} />
            <span className="switch-track" />
          </span>
        </label>
      ))}
      <button className={`revoke-button${a.revoked ? ' is-revoked' : ''}`} onClick={() => admin(`/v2/agents/${a.pubkey}/${a.revoked ? 'unrevoke' : 'revoke'}`)}>
        {a.revoked ? 'Unrevoke agent' : 'Revoke agent'}
      </button>
    </>
  );
}

function RecoverRow({ client, agent, run, busy, policy }: { client: AppClient; agent: V2Agent; run: (a: V2Agent, n: number) => Promise<boolean>; busy: boolean; policy: ReturnType<typeof usePolicyState> }) {
  const [tick, setTick] = useState(0);
  const [amount, setAmount] = useState('5');
  const balance = useVaultBalance(client, agent.vault, tick);
  return (
    <div className="panel">
      <h2>{agent.name}</h2>
      <p className="hero-label">V2 vault</p>
      <p className="hero-amount">
        {balance === null ? '…' : balance.toString()}
        <span>aUSD</span>
      </p>
      <a className="modal-link" href={solscanAccount(agent.vault)} target="_blank" rel="noreferrer">
        View vault on Solscan
      </a>
      {policy.state && policy.online && <PolicyRows agent={agent} state={policy.state} admin={policy.admin} />}
      <div className="amount-field">
        <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} aria-label="Amount to recover in aUSD" />
        <span>aUSD</span>
      </div>
      <button
        disabled={busy}
        onClick={async () => {
          if (await run(agent, Number(amount))) setTick((t) => t + 1);
        }}
      >
        Recover funds to my wallet
      </button>
    </div>
  );
}

/** "V2 policy (off-chain)" card. M3b: vault balances + Recover funds. */
export function V2Card({ client, recovery }: { client: AppClient; recovery: ReturnType<typeof useRecoveryAction> }) {
  const busy = recovery.state.stage === 'awaiting-wallet' || recovery.state.stage === 'confirming';
  const policy = usePolicyState();
  return (
    <div>
      <div className="panel">
        <h2>V2 policy (off-chain)</h2>
        <p className="hint">
          Each agent has its own 2-of-3 vault (owner, policy server, agent). Recovery uses owner + agent, so it works even if the
          policy server is down.
        </p>
        <p className={`hint`}>
          {policy.online
            ? 'Policy server online. Rule changes here are instant and free (admin API: unauthenticated, localhost only).'
            : 'Policy server OFFLINE — agent payments are paused. Recovery below still works.'}
        </p>
      </div>
      {v2.agents.map((a) => (
        <RecoverRow key={a.name} client={client} agent={a} run={recovery.run} busy={busy} policy={policy} />
      ))}
      <div className="panel">
        <p className="hint">
          Recovery only sends funds back to your own aUSD account. That rule is enforced by the agent service refusing to
          co-sign anything else, not on-chain.
        </p>
      </div>
    </div>
  );
}


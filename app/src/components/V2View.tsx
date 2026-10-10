// V2 control-panel pages: rules live off-chain in the policy server. Built
// from the same shared pieces and CSS as V1 (AgentCardParts, panel.css).
import { useEffect, useState } from 'react';
import { address, createNoopSigner, type Address } from '@solana/kit';
import { getTransferCheckedInstruction } from '@solana-program/token';
import type { AppClient } from '../providers';
import { fetchTokenBalance } from '../lib/rpcHelpers';
import { getAssociatedTokenAddress } from '../lib/program';
import { solscanAccount } from '../lib/solscan';
import type { useApprovalAction } from '../hooks/useApprovalAction';
import type { useRecoveryAction, V2Agent } from '../hooks/useRecoveryAction';
import type { usePolicyState, PolicyAgent, PolicyMerchant } from '../hooks/usePolicyState';
import v2 from '../lib/v2-vaults.json';
import { AgentCardShell, AgentFace, BalanceHero, BudgetStats, MerchantRow, RevokeRow } from './AgentCardParts';

const SYM = 'aUSD';
const TAG = 'V2 · off-chain policy';
const POLL_MS = 6000;
type Policy = ReturnType<typeof usePolicyState>;

/** Polls token balances straight from the chain (works with the policy server down). */
function useBalances(client: AppClient, accounts: (Address | null)[], tick: number) {
  const key = accounts.join(',');
  const [balances, setBalances] = useState<(bigint | null)[]>(accounts.map(() => null));
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await Promise.all(accounts.map((a) => (a ? fetchTokenBalance(client.rpc, a) : Promise.resolve(null))));
      if (!cancelled) setBalances(next);
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, tick]);
  return balances;
}

export function V2MainCard({
  client,
  approval,
  recovery,
  tick,
  onMoved,
}: {
  client: AppClient;
  approval: ReturnType<typeof useApprovalAction>;
  recovery: ReturnType<typeof useRecoveryAction>;
  tick: number;
  onMoved: () => void;
}) {
  const payer = client.payer;
  const [ownerAta, setOwnerAta] = useState<Address | null>(null);
  const [vaultIdx, setVaultIdx] = useState(0);
  const [amount, setAmount] = useState('10');
  const [error, setError] = useState('');
  useEffect(() => {
    getAssociatedTokenAddress(address(payer.address), address(v2.mint)).then(setOwnerAta);
  }, [payer.address]);
  const [ownerBal, ...vaultBals] = useBalances(client, [ownerAta, ...v2.agents.map((a) => address(a.vault))], tick);
  const busy = ['awaiting-wallet', 'confirming'].includes(approval.state.stage) || ['awaiting-wallet', 'confirming'].includes(recovery.state.stage);
  const agent = v2.agents[vaultIdx];
  const vaultTotal = vaultBals.every((b) => b !== null) ? vaultBals.reduce((n, b) => n + (b ?? 0n), 0n) : null;

  function parsed(): bigint | null {
    if (!/^\d+$/.test(amount.trim()) || BigInt(amount) < 1n) {
      setError('Enter a whole number of aUSD.');
      return null;
    }
    setError('');
    return BigInt(amount);
  }

  /** ONE Phantom-signed TransferChecked: owner ATA -> V2 vault. No multisig, server or agent. */
  async function deposit() {
    const n = parsed();
    if (n === null || !ownerAta) return;
    if (ownerBal === null || n > ownerBal) {
      setError(`Main wallet only has ${ownerBal ?? 0n} ${SYM}.`);
      return;
    }
    const ok = await approval.run(`Deposit ${n} ${SYM} into the ${agent.v1Name} vault`, () => [
      getTransferCheckedInstruction({
        source: ownerAta,
        mint: address(v2.mint),
        destination: address(agent.vault),
        authority: createNoopSigner(address(payer.address)),
        amount: n,
        decimals: v2.decimals,
      }),
    ]);
    if (ok) onMoved();
  }

  async function withdraw() {
    const n = parsed();
    if (n === null) return;
    const bal = vaultBals[vaultIdx];
    if (bal !== null && n > bal) {
      setError(`That vault only has ${bal} ${SYM}.`);
      return;
    }
    if (await recovery.run(agent as V2Agent, Number(n))) onMoved();
  }

  return (
    <div>
      <BalanceHero
        symbol={SYM}
        pill={<span className="agents-active-pill">{TAG}</span>}
        balances={[
          { label: 'Main wallet', amount: ownerBal === null ? '…' : ownerBal.toString() },
          { label: 'Vaults', amount: vaultTotal === null ? '…' : vaultTotal.toString() },
        ]}
      />

      <div className="panel transfer-panel">
        <h2>Vaults</h2>
        {v2.agents.map((a, i) => (
          <p key={a.vault} className="hint" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>
              {a.v1Name.startsWith('food') ? 'Food' : 'Shopping'} vault: <strong>{vaultBals[i] === null ? '…' : `${vaultBals[i]} ${SYM}`}</strong>
            </span>
            <a className="modal-link" href={solscanAccount(a.vault)} target="_blank" rel="noreferrer">
              Solscan
            </a>
          </p>
        ))}
      </div>

      <div className="panel transfer-panel">
        <h2>Move money</h2>
        <div className="quick-row" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 0, marginBottom: 10 }}>
          {v2.agents.map((a, i) => (
            <button key={a.vault} type="button" className={vaultIdx === i ? 'on' : ''} disabled={busy} onClick={() => setVaultIdx(i)}>
              {a.v1Name.startsWith('food') ? 'Food' : 'Shopping'}
            </button>
          ))}
        </div>
        <div className="amount-field">
          <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} aria-label={`Amount in ${SYM}`} />
          <span>{SYM}</span>
        </div>
        {error && <p className="hint" style={{ color: 'var(--danger)' }}>{error}</p>}
        <div className="transfer-actions">
          <button className="to-vault" disabled={busy} onClick={deposit}>
            ↑ Deposit
          </button>
          <button className="secondary to-wallet" disabled={busy} onClick={withdraw}>
            ↓ Withdraw to my wallet
          </button>
        </div>
        <p className="hint">Deposit: you sign alone. Withdraw: needs 2 of 3 signatures: you + the agent. The policy server is not involved.</p>
      </div>
    </div>
  );
}

function WeeklyLimit({ agent, setBudget }: { agent: PolicyAgent; setBudget: Policy['setBudget'] }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const value = draft ?? String(agent.weeklyBudget);
  async function save() {
    setSaving(true);
    setError('');
    const n = Number(value);
    const r = value.trim() === '' ? ({ ok: false, error: 'Enter a whole number.' } as const) : await setBudget(agent.pubkey, n);
    setSaving(false);
    if (r.ok) setDraft(null);
    else setError(r.error);
  }
  return (
    <>
      <p className="agent-controls-title">Weekly limit</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div className="amount-field" style={{ flex: 1 }}>
          <input type="number" min="1" max="10000" value={value} onChange={(e) => setDraft(e.target.value)} disabled={saving} aria-label="Weekly limit in aUSD" />
          <span>{SYM}</span>
        </div>
        <button disabled={saving || draft === null} onClick={save}>
          Save
        </button>
      </div>
      {error && <p className="hint" style={{ color: 'var(--danger)' }}>{error}</p>}
    </>
  );
}

export function V2AgentCard({ agent, policy }: { agent: V2Agent; policy: Policy }) {
  const a = policy.online ? policy.state?.agents.find((x) => x.pubkey === agent.address) : undefined;
  const merchants: PolicyMerchant[] = policy.state?.merchants.filter((m) => m.agent === agent.address) ?? [];
  const name = agent.v1Name;
  return (
    <AgentCardShell name={name} revoked={Boolean(a?.revoked)}>
      <AgentFace name={name} pubkey={agent.address} revoked={Boolean(a?.revoked)} status={a ? undefined : 'Offline'} tag={TAG} />
      <div className="agent-card-body">
        {a ? (
          <>
            <BudgetStats spent={String(a.spent)} budget={String(a.weeklyBudget)} left={String(a.remaining)} symbol={SYM} resetAtSec={a.windowEnd} />
            <div className="agent-controls">
              <WeeklyLimit agent={a} setBudget={policy.setBudget} />
              <RevokeRow name={name} revoked={a.revoked} busy={false} onToggle={() => policy.admin(`/v2/agents/${a.pubkey}/${a.revoked ? 'unrevoke' : 'revoke'}`)} />
              <p className="agent-controls-title">Merchants this agent may pay</p>
              {merchants.map((m) => (
                <MerchantRow key={m.id} label={m.label} isOn={m.enabled} pending={false} onToggle={() => policy.admin(`/v2/merchants/${m.id}/${m.enabled ? 'disable' : 'enable'}`)} />
              ))}
            </div>
          </>
        ) : (
          <p className="hint">Policy server unavailable on :4031</p>
        )}
      </div>
    </AgentCardShell>
  );
}

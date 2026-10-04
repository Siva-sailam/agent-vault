import { useState } from 'react';
import { type Address, type TransactionSigner, type Instruction } from '@solana/kit';
import {
  WINDOW_SECONDS,
  ixAddMerchant,
  ixRemoveMerchant,
  ixSetAgentRevoked,
  type AgentState,
} from '../lib/program';
import { ChipIcon } from './icons';
import { MerchantIcon } from './MerchantIcon';
import { ACTIVE_VAULT } from '../vaults';

const SYM = ACTIVE_VAULT.symbol;

type RunApproval = (label: string, build: () => Promise<Instruction[] | Instruction[][]> | Instruction[] | Instruction[][]) => Promise<boolean>;
export type MerchantRef = { key: string; label: string; ata: Address };

function windowResetLabel(windowStart: number): string {
  const resetAt = new Date((windowStart + WINDOW_SECONDS) * 1000);
  const overdue = resetAt.getTime() <= Date.now();
  return overdue
    ? 'resets on next spend'
    : `resets ${resetAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function MerchantToggle({
  payer,
  rulesAddress,
  agent,
  merchant,
  runApproval,
  onChanged,
}: {
  payer: TransactionSigner;
  rulesAddress: Address;
  agent: AgentState;
  merchant: MerchantRef;
  runApproval: RunApproval;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const isOn = agent.merchants.includes(merchant.ata);

  async function toggle() {
    setPending(true);
    const turningOn = !isOn;
    const ok = await runApproval(`Turn ${turningOn ? 'on' : 'off'} ${merchant.label} for this agent`, () => [
      turningOn
        ? ixAddMerchant(payer, rulesAddress, agent.key, merchant.ata)
        : ixRemoveMerchant(payer, rulesAddress, agent.key, merchant.ata),
    ]);
    setPending(false);
    if (ok) onChanged();
  }

  return (
    <div className="merchant-row">
      <span className="merchant-row-label">
        <MerchantIcon merchantKey={merchant.key} size={26} />
        {merchant.label}
      </span>
      <label className="switch">
        <input type="checkbox" checked={isOn} disabled={pending} onChange={toggle} />
        <span className="switch-track" />
      </label>
    </div>
  );
}

export function AgentCardView({
  payer,
  rulesAddress,
  agent,
  merchants,
  runApproval,
  onChanged,
}: {
  payer: TransactionSigner;
  rulesAddress: Address;
  agent: AgentState;
  merchants: MerchantRef[];
  runApproval: RunApproval;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const remaining = agent.weeklyBudget - agent.spentSoFar;
  const usedFraction = agent.weeklyBudget > 0n ? Number(agent.spentSoFar) / Number(agent.weeklyBudget) : 0;

  async function toggleRevoked() {
    setBusy(true);
    const nextRevoked = !agent.revoked;
    const ok = await runApproval(`${nextRevoked ? 'Revoke' : 'Unrevoke'} this agent`, () => [
      ixSetAgentRevoked(payer, rulesAddress, agent.key, nextRevoked),
    ]);
    setBusy(false);
    if (ok) onChanged();
  }

  return (
    <div className={`agent-card${agent.revoked ? ' revoked' : ''}`}>
      <div className="agent-card-top">
        <ChipIcon className="agent-chip" />
        <span className="agent-status">{agent.revoked ? 'Revoked' : 'Active'}</span>
      </div>
      <p className="agent-number">
        {agent.key.slice(0, 4)} •••• •••• {agent.key.slice(-4)}
      </p>
      <div className="agent-budget-row">
        <span>
          Spent <strong>{agent.spentSoFar.toString()}</strong> / {agent.weeklyBudget.toString()} {SYM}
        </span>
        <span>{remaining.toString()} left</span>
      </div>
      <div className="budget-bar-track">
        <div
          className={`budget-bar-fill${usedFraction > 0.8 ? ' high' : ''}`}
          style={{ width: `${Math.min(100, usedFraction * 100)}%` }}
        />
      </div>
      <p className="agent-window">Window {windowResetLabel(agent.windowStart)}</p>

      <div className="agent-controls">
        <button className={`revoke-button${agent.revoked ? ' is-revoked' : ''}`} disabled={busy} onClick={toggleRevoked}>
          {agent.revoked ? 'Unrevoke agent' : 'Revoke agent'}
        </button>
        <p className="agent-controls-title">Merchants</p>
        {merchants.map((m) => (
          <MerchantToggle
            key={m.key}
            payer={payer}
            rulesAddress={rulesAddress}
            agent={agent}
            merchant={m}
            runApproval={runApproval}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  );
}

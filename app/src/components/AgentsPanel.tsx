import { useState } from 'react';
import { type Address, type TransactionSigner, type Instruction } from '@solana/kit';
import {
  WINDOW_SECONDS,
  ixAddMerchant,
  ixRemoveMerchant,
  ixSetAgentRevoked,
  type AgentState,
} from '../lib/program';
import { ACTIVE_VAULT } from '../vaults';
import { agentStyle } from '../storefront/merchantStyle';
import { AgentArt, themeFor } from './AgentArt';
import { AgentLogoIcon } from './icons';
import { MerchantAvatar } from './MerchantAvatar';

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
    <label className={`merchant-row${isOn ? ' is-on' : ''}`}>
      <span className="merchant-row-label">
        <MerchantAvatar label={merchant.label} size={34} />
        <span className="merchant-row-name">
          {merchant.label}
          <small>{isOn ? 'Allowed' : 'Blocked'}</small>
        </span>
      </span>
      <span className="switch">
        <input type="checkbox" checked={isOn} disabled={pending} onChange={toggle} />
        <span className="switch-track" />
      </span>
    </label>
  );
}

export function AgentCardView({
  payer,
  rulesAddress,
  agent,
  name,
  merchants,
  runApproval,
  onChanged,
}: {
  payer: TransactionSigner;
  rulesAddress: Address;
  agent: AgentState;
  /** Display name, e.g. "food-ordering-agent". */
  name: string;
  merchants: MerchantRef[];
  runApproval: RunApproval;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const theme = themeFor(name);
  const remaining = agent.weeklyBudget - agent.spentSoFar;
  const usedFraction = agent.weeklyBudget > 0n ? Number(agent.spentSoFar) / Number(agent.weeklyBudget) : 0;

  async function toggleRevoked() {
    setBusy(true);
    const nextRevoked = !agent.revoked;
    const ok = await runApproval(`${nextRevoked ? 'Revoke' : 'Unrevoke'} ${name}`, () => [
      ixSetAgentRevoked(payer, rulesAddress, agent.key, nextRevoked),
    ]);
    setBusy(false);
    if (ok) onChanged();
  }

  return (
    <div className={`agent-card theme-${theme}${agent.revoked ? ' revoked' : ''}`}>
      {/* The agent as a card: static art embossed into its face. */}
      <div className="agent-face">
        <AgentArt theme={theme} />
        <div className="agent-face-top">
          <span className="agent-logo">
            <AgentLogoIcon size={26} />
          </span>
          <span className="agent-status">{agent.revoked ? 'Revoked' : 'Active'}</span>
        </div>
        <div className="agent-face-bottom">
          <h3 className="agent-name">{name}</h3>
          <p className="agent-number">
            {agent.key.slice(0, 4)} •••• •••• {agent.key.slice(-4)}
          </p>
        </div>
        {agent.revoked && <span className="agent-face-stamp">BLOCKED</span>}
      </div>

      <div className="agent-card-body">
        <div className="agent-stats">
          <div className="agent-budget-row">
            <span>
              Spent <strong>{agent.spentSoFar.toString()}</strong> / {agent.weeklyBudget.toString()} {SYM}
            </span>
            <span className="agent-left">{remaining.toString()} left</span>
          </div>
          <div className="budget-bar-track">
            <div
              className={`budget-bar-fill${usedFraction > 0.8 ? ' high' : ''}`}
              style={{ width: `${Math.min(100, usedFraction * 100)}%` }}
            />
          </div>
          <p className="agent-window">Weekly window {windowResetLabel(agent.windowStart)}</p>
        </div>

        <div className="agent-controls">
          <div className="agent-revoke">
            <div className="agent-revoke-who">
              <span className="agent-revoke-emoji">{agentStyle(name).emoji}</span>
              <span>
                <small>Agent</small>
                <strong>{name}</strong>
              </span>
            </div>
            <button
              className={`revoke-button${agent.revoked ? ' is-revoked' : ''}`}
              disabled={busy}
              onClick={toggleRevoked}
            >
              {agent.revoked ? 'Unrevoke agent' : 'Revoke agent'}
            </button>
          </div>

          <p className="agent-controls-title">Merchants this agent may pay</p>
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
    </div>
  );
}

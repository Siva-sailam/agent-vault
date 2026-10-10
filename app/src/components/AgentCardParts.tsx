// Presentational pieces shared by the V1 (on-chain) and V2 (policy server)
// agent cards. They hold no data fetching or signing: V1 and V2 pass in
// different data and actions, and render identical markup and CSS.
import type { ReactNode } from 'react';
import { agentStyle } from '../storefront/merchantStyle';
import { AgentArt, themeFor } from './AgentArt';
import { AgentLogoIcon } from './icons';
import { MerchantAvatar } from './MerchantAvatar';

export function windowResetLabel(resetAtSec: number): string {
  const resetAt = new Date(resetAtSec * 1000);
  const overdue = resetAt.getTime() <= Date.now();
  return overdue
    ? 'resets on next spend'
    : `resets ${resetAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** The card itself (face + body). Children are the body's stats and controls. */
export function AgentCardShell({ name, revoked, children }: { name: string; revoked: boolean; children: ReactNode }) {
  return <div className={`agent-card theme-${themeFor(name)}${revoked ? ' revoked' : ''}`}>{children}</div>;
}

export function AgentFace({
  name,
  pubkey,
  revoked,
  status,
  tag,
}: {
  name: string;
  pubkey: string;
  revoked: boolean;
  /** Overrides the Active / Revoked label (e.g. when state is unavailable). */
  status?: string;
  /** Small extra tag, used only by V2 cards. */
  tag?: string;
}) {
  return (
    <div className="agent-face">
      <AgentArt theme={themeFor(name)} />
      <div className="agent-face-top">
        <span className="agent-logo">
          <AgentLogoIcon size={26} />
        </span>
        <span className="agent-status">{status ?? (revoked ? 'Revoked' : 'Active')}</span>
      </div>
      <div className="agent-face-bottom">
        <h3 className="agent-name">{name}</h3>
        <p className="agent-number">
          {pubkey.slice(0, 4)} •••• •••• {pubkey.slice(-4)}
        </p>
        {tag && <span className="agent-v2-tag">{tag}</span>}
      </div>
      {revoked && <span className="agent-face-stamp">BLOCKED</span>}
    </div>
  );
}

export function BudgetStats({
  spent,
  budget,
  left,
  symbol,
  resetAtSec,
}: {
  spent: string;
  budget: string;
  left: string;
  symbol: string;
  resetAtSec: number;
}) {
  const usedFraction = Number(budget) > 0 ? Number(spent) / Number(budget) : 0;
  return (
    <div className="agent-stats">
      <div className="agent-budget-row">
        <span>
          Spent <strong>{spent}</strong> / {budget} {symbol}
        </span>
        <span className="agent-left">{left} left</span>
      </div>
      <div className="budget-bar-track">
        <div
          className={`budget-bar-fill${usedFraction > 0.8 ? ' high' : ''}`}
          style={{ width: `${Math.min(100, usedFraction * 100)}%` }}
        />
      </div>
      <p className="agent-window">Weekly window {windowResetLabel(resetAtSec)}</p>
    </div>
  );
}

export function RevokeRow({ name, revoked, busy, onToggle }: { name: string; revoked: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <div className="agent-revoke">
      <div className="agent-revoke-who">
        <span className="agent-revoke-emoji">{agentStyle(name).emoji}</span>
        <span>
          <small>Agent</small>
          <strong>{name}</strong>
        </span>
      </div>
      <button className={`revoke-button${revoked ? ' is-revoked' : ''}`} disabled={busy} onClick={onToggle}>
        {revoked ? 'Unrevoke agent' : 'Revoke agent'}
      </button>
    </div>
  );
}

export function MerchantRow({ label, isOn, pending, onToggle }: { label: string; isOn: boolean; pending: boolean; onToggle: () => void }) {
  return (
    <label className={`merchant-row${isOn ? ' is-on' : ''}`}>
      <span className="merchant-row-label">
        <MerchantAvatar label={label} size={34} />
        <span className="merchant-row-name">
          {label}
          <small>{isOn ? 'Allowed' : 'Blocked'}</small>
        </span>
      </span>
      <span className="switch">
        <input type="checkbox" checked={isOn} disabled={pending} onChange={onToggle} />
        <span className="switch-track" />
      </span>
    </label>
  );
}

/** Hero banner at the top of the main-wallet page. */
export function BalanceHero({
  symbol,
  pill,
  balances,
}: {
  symbol: string;
  pill: ReactNode;
  balances: { label: string; amount: string }[];
}) {
  return (
    <div className="wallet-hero">
      <div className="hero-top">
        <span className="hero-chip">◎ {symbol}</span>
        {pill}
      </div>
      <div className="hero-balances">
        {balances.map((b) => (
          <div key={b.label}>
            <p className="hero-label">{b.label}</p>
            <p className="hero-amount">
              {b.amount}
              <span>{symbol}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

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
import { AgentCardShell, AgentFace, BudgetStats, MerchantRow, RevokeRow } from './AgentCardParts';

const SYM = ACTIVE_VAULT.symbol;

type RunApproval = (label: string, build: () => Promise<Instruction[] | Instruction[][]> | Instruction[] | Instruction[][]) => Promise<boolean>;
export type MerchantRef = { key: string; label: string; ata: Address };

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

  return <MerchantRow label={merchant.label} isOn={isOn} pending={pending} onToggle={toggle} />;
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
  const remaining = agent.weeklyBudget - agent.spentSoFar;

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
    <AgentCardShell name={name} revoked={agent.revoked}>
      {/* The agent as a card: static art embossed into its face. */}
      <AgentFace name={name} pubkey={agent.key} revoked={agent.revoked} />

      <div className="agent-card-body">
        <BudgetStats
          spent={agent.spentSoFar.toString()}
          budget={agent.weeklyBudget.toString()}
          left={remaining.toString()}
          symbol={SYM}
          resetAtSec={agent.windowStart + WINDOW_SECONDS}
        />

        <div className="agent-controls">
          <RevokeRow name={name} revoked={agent.revoked} busy={busy} onToggle={toggleRevoked} />

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
    </AgentCardShell>
  );
}

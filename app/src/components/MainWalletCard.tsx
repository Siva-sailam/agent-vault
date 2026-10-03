import { useState } from 'react';
import { address, type Address, type TransactionSigner, type Instruction } from '@solana/kit';
import type { VaultState } from '../hooks/useVaultState';
import { MERCHANT_CATALOGUE } from '../catalogue';
import {
  MAX_AGENTS,
  getAssociatedTokenAddress,
  ixAddAgent,
  ixAddMerchant,
  ixEnsureAssociatedTokenAccount,
  ixDeposit,
  ixWithdraw,
  ixInitializeVault,
} from '../lib/program';
import { solscanAccount } from '../lib/solscan';

type RunApproval = (label: string, build: () => Promise<Instruction[]> | Instruction[]) => Promise<boolean>;

export function MainWalletCard({
  payer,
  mint,
  vault,
  runApproval,
}: {
  payer: TransactionSigner;
  mint: Address;
  vault: VaultState;
  runApproval: RunApproval;
}) {
  const [transferAmount, setTransferAmount] = useState('50');
  const [newAgentKey, setNewAgentKey] = useState('');
  const [newAgentBudget, setNewAgentBudget] = useState('50');
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createVault() {
    if (!vault.pdas || !vault.ownerAta) return;
    setBusy(true);
    const ok = await runApproval('Create your vault', () => [
      ixEnsureAssociatedTokenAccount(payer, payer.address, mint, vault.ownerAta!),
      ixInitializeVault(payer, mint, vault.pdas!.rules, vault.pdas!.vaultAuthority, vault.pdas!.vault),
    ]);
    setBusy(false);
    if (ok) vault.refresh();
  }

  async function transferToVault() {
    if (!vault.pdas || !vault.ownerAta) return;
    const amount = BigInt(transferAmount || '0');
    if (amount <= 0n) return;
    setBusy(true);
    const ok = await runApproval(`Move ${transferAmount} Demo USD from your main wallet to the vault`, () => [
      ixEnsureAssociatedTokenAccount(payer, payer.address, mint, vault.ownerAta!),
      ixDeposit(payer, vault.pdas!.rules, vault.pdas!.vault, vault.ownerAta!, amount),
    ]);
    setBusy(false);
    if (ok) vault.refresh();
  }

  async function transferToMainWallet() {
    if (!vault.pdas || !vault.ownerAta) return;
    const amount = BigInt(transferAmount || '0');
    if (amount <= 0n) return;
    setBusy(true);
    const ok = await runApproval(`Move ${transferAmount} Demo USD from the vault to your main wallet`, () => [
      ixEnsureAssociatedTokenAccount(payer, payer.address, mint, vault.ownerAta!),
      ixWithdraw(payer, vault.pdas!.rules, vault.pdas!.vault, vault.pdas!.vaultAuthority, vault.ownerAta!, amount),
    ]);
    setBusy(false);
    if (ok) vault.refresh();
  }

  async function addAgent() {
    if (!vault.pdas) return;
    let agentAddress: Address;
    try {
      agentAddress = address(newAgentKey.trim());
    } catch {
      return;
    }
    const budget = BigInt(newAgentBudget || '0');
    if (budget <= 0n) return;

    const merchantAtas = await Promise.all(
      MERCHANT_CATALOGUE.map((m) => getAssociatedTokenAddress(address(m.wallet), mint)),
    );

    setBusy(true);
    const ok = await runApproval(`Add agent with a ${newAgentBudget} Demo USD weekly budget`, () => [
      ixAddAgent(payer, vault.pdas!.rules, agentAddress, budget),
      ...merchantAtas.map((ata) => ixAddMerchant(payer, vault.pdas!.rules, agentAddress, ata)),
    ]);
    setBusy(false);
    if (ok) {
      vault.refresh();
      setNewAgentKey('');
      setShowAddAgent(false);
    }
  }

  if (vault.loading) return <p className="hint">Loading vault…</p>;

  if (!vault.rules) {
    return (
      <div className="panel">
        <h2>Create your vault</h2>
        <p className="hint">No vault exists yet for this wallet and Demo USD. One-time setup.</p>
        <button disabled={busy} onClick={createVault} style={{ marginTop: 10 }}>
          Create vault
        </button>
      </div>
    );
  }

  const canAddAgent = vault.rules.agentCount < MAX_AGENTS;

  return (
    <div>
      <div className="balance-pair">
        <div>
          <p className="wallet-balance-label">Main wallet</p>
          <p className="wallet-balance-amount balance-amount-secondary">
            {vault.ownerBalance.toString()}
            <span>Demo USD</span>
          </p>
        </div>
        <div>
          <p className="wallet-balance-label">Vault</p>
          <p className="wallet-balance-amount">
            {vault.vaultBalance.toString()}
            <span>Demo USD</span>
          </p>
        </div>
      </div>
      <span className="agents-active-pill">
        <span className="dot-live" />
        {vault.rules.agentCount} agent{vault.rules.agentCount === 1 ? '' : 's'} active
      </span>

      <div className="panel" style={{ marginTop: 18 }}>
        <h2>Transfer</h2>
        <input
          type="number"
          min="1"
          value={transferAmount}
          onChange={(e) => setTransferAmount(e.target.value)}
          disabled={busy}
          style={{ width: '100%', marginBottom: 10 }}
        />
        <div className="row">
          <button disabled={busy} onClick={transferToVault} style={{ flex: 1 }}>
            Send to vault
          </button>
          <button className="secondary" disabled={busy} onClick={transferToMainWallet} style={{ flex: 1 }}>
            Send to main wallet
          </button>
        </div>
      </div>

      <div className="panel">
        <a className="modal-link" href={solscanAccount(vault.pdas!.vault)} target="_blank" rel="noreferrer">
          View vault on Solscan
        </a>
      </div>

      {canAddAgent && (
        <div className="panel">
          {!showAddAgent ? (
            <button className="secondary" onClick={() => setShowAddAgent(true)}>
              Add agent ({vault.rules.agentCount}/{MAX_AGENTS} used)
            </button>
          ) : (
            <div className="add-agent-form">
              <h2>New agent</h2>
              <input
                type="text"
                placeholder="Agent wallet public key"
                value={newAgentKey}
                onChange={(e) => setNewAgentKey(e.target.value)}
                disabled={busy}
              />
              <div className="row">
                <input type="number" min="1" value={newAgentBudget} onChange={(e) => setNewAgentBudget(e.target.value)} disabled={busy} />
                <button disabled={busy} onClick={addAgent}>
                  Add agent
                </button>
              </div>
              <p className="hint">All 4 catalogue merchants switch on by default — turn any off on the agent's card.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

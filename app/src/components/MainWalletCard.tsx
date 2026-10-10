import { useState } from 'react';
import { address, type Address, type TransactionSigner, type Instruction } from '@solana/kit';
import type { VaultState } from '../hooks/useVaultState';
import { ACTIVE_VAULT } from '../vaults';
import { packInstructions } from '../lib/packInstructions';
import {
  MAX_AGENTS,
  MAX_MERCHANTS_PER_AGENT,
  getAssociatedTokenAddress,
  ixAddAgent,
  ixAddMerchant,
  ixEnsureAssociatedTokenAccount,
  ixDeposit,
  ixWithdraw,
  ixInitializeVault,
} from '../lib/program';
import { solscanAccount } from '../lib/solscan';
import { BalanceHero } from './AgentCardParts';

const SYM = ACTIVE_VAULT.symbol;

type RunApproval = (label: string, build: () => Promise<Instruction[] | Instruction[][]> | Instruction[] | Instruction[][]) => Promise<boolean>;

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

  /** One click: initialize_vault + add_agent x2 + add_merchant x8, packed into
   * as few Phantom-signed transactions as fit the size limit. Deposit is a
   * separate action. */
  async function setUpDemoVault() {
    const agents = ACTIVE_VAULT.setupAgents;
    if (!vault.pdas || !agents) return;
    setBusy(true);
    const ok = await runApproval('Set up demo vault', async () => {
      const ataByLabel = new Map<string, Address>();
      for (const m of ACTIVE_VAULT.merchants) {
        ataByLabel.set(m.label, await getAssociatedTokenAddress(address(m.wallet), mint));
      }
      const ixs: Instruction[] = [
        ixInitializeVault(payer, mint, vault.pdas!.rules, vault.pdas!.vaultAuthority, vault.pdas!.vault),
        ...agents.map((a) => ixAddAgent(payer, vault.pdas!.rules, address(a.address), BigInt(a.weeklyBudget))),
        ...agents.flatMap((a) =>
          a.merchants.map((label) => ixAddMerchant(payer, vault.pdas!.rules, address(a.address), ataByLabel.get(label)!)),
        ),
      ];
      return packInstructions(payer.address, ixs);
    });
    setBusy(false);
    if (ok) vault.refresh();
  }

  async function transferToVault() {
    if (!vault.pdas || !vault.ownerAta) return;
    const amount = BigInt(transferAmount || '0');
    if (amount <= 0n) return;
    setBusy(true);
    const ok = await runApproval(`Move ${transferAmount} ${SYM} from your main wallet to the vault`, () => [
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
    const ok = await runApproval(`Move ${transferAmount} ${SYM} from the vault to your main wallet`, () => [
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
      ACTIVE_VAULT.merchants.slice(0, MAX_MERCHANTS_PER_AGENT).map((m) => getAssociatedTokenAddress(address(m.wallet), mint)),
    );

    setBusy(true);
    const ok = await runApproval(`Add agent with a ${newAgentBudget} ${SYM} weekly budget`, () => [
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
        <p className="hint">No vault exists yet for this wallet and {SYM}. One-time setup.</p>
        {ACTIVE_VAULT.setupAgents ? (
          <>
            <p className="hint">
              Creates the vault, registers {ACTIVE_VAULT.setupAgents.length} agents ({ACTIVE_VAULT.setupAgents[0].weeklyBudget}{' '}
              {SYM} weekly each) and allow-lists their merchants.
            </p>
            <button disabled={busy} onClick={setUpDemoVault} style={{ marginTop: 10 }}>
              Set up demo vault
            </button>
          </>
        ) : (
          <button disabled={busy} onClick={createVault} style={{ marginTop: 10 }}>
            Create vault
          </button>
        )}
      </div>
    );
  }

  const canAddAgent = vault.rules.agentCount < MAX_AGENTS;

  return (
    <div>
      <BalanceHero
        symbol={SYM}
        pill={
          <span className="agents-active-pill">
            <span className="dot-live" />
            {vault.rules.agentCount} agent{vault.rules.agentCount === 1 ? '' : 's'} active
          </span>
        }
        balances={[
          { label: 'Main wallet', amount: vault.ownerBalance.toString() },
          { label: 'Vault', amount: vault.vaultBalance.toString() },
        ]}
      />

      <div className="panel transfer-panel">
        <h2>Move money</h2>
        <div className="amount-field">
          <input
            type="number"
            min="1"
            value={transferAmount}
            onChange={(e) => setTransferAmount(e.target.value)}
            disabled={busy}
            aria-label={`Amount in ${SYM}`}
          />
          <span>{SYM}</span>
        </div>
        <div className="quick-row">
          {[10, 50, 100, 200].map((n) => (
            <button key={n} type="button" className={Number(transferAmount) === n ? 'on' : ''} disabled={busy} onClick={() => setTransferAmount(String(n))}>
              {n}
            </button>
          ))}
        </div>
        <div className="transfer-actions">
          <button className="to-vault" disabled={busy} onClick={transferToVault}>
            ↑ To vault
          </button>
          <button className="secondary to-wallet" disabled={busy} onClick={transferToMainWallet}>
            ↓ To wallet
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
              <p className="hint">The first 4 catalogue merchants switch on by default — turn any off on the agent's card.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

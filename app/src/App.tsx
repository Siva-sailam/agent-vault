import { useEffect, useState } from 'react';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useClient } from '@solana/react';
import { address, type Address } from '@solana/kit';
import { WalletConnect } from './components/WalletConnect';
import { MainWalletCard } from './components/MainWalletCard';
import { AgentCardView, type MerchantRef } from './components/AgentsPanel';
import { ApprovalModal } from './components/ApprovalModal';
import { PhoneFrame } from './components/PhoneFrame';
import { CardCarousel } from './components/CardCarousel';
import { useVaultState } from './hooks/useVaultState';
import { useApprovalAction } from './hooks/useApprovalAction';
import { useRecoveryAction } from './hooks/useRecoveryAction';
import { V2MainCard, V2AgentCard } from './components/V2View';
import { usePolicyState } from './hooks/usePolicyState';
import v2Vaults from './lib/v2-vaults.json';
import { ACTIVE_VAULT, agentNameFor, merchantKeyOf, merchantLabelsFor } from './vaults';
import { getAssociatedTokenAddress } from './lib/program';
import type { AppClient } from './providers';
import './App.css';
import './panel.css';

const MINT = address(ACTIVE_VAULT.mint);

function useMerchantRefs(mint: Address): MerchantRef[] {
  const [refs, setRefs] = useState<MerchantRef[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      ACTIVE_VAULT.merchants.map(async (m) => ({
        key: merchantKeyOf(m.label),
        label: m.label,
        ata: await getAssociatedTokenAddress(address(m.wallet), mint),
      })),
    ).then((result) => {
      if (!cancelled) setRefs(result);
    });
    return () => {
      cancelled = true;
    };
  }, [mint]);
  return refs;
}

function Dashboard({ client }: { client: AppClient }) {
  const connected = useConnectedWallet(client);
  const onDevnet = Boolean(connected?.account.chains.includes('solana:devnet'));
  const owner = connected && onDevnet ? address(connected.account.address) : null;
  const vault = useVaultState(client, owner, MINT);
  const approval = useApprovalAction(client);
  const recovery = useRecoveryAction(client);
  const merchants = useMerchantRefs(MINT);
  const policy = usePolicyState();
  // Default is V2 on every page load (deliberately not remembered).
  const [version, setVersion] = useState<'v1' | 'v2'>('v2');
  const [tick, setTick] = useState(0);

  if (!connected) {
    return (
      <div className="phone-content">
        <div className="phone-header">
          <h1>Vault</h1>
        </div>
        <WalletConnect client={client} />
      </div>
    );
  }
  if (!onDevnet) {
    return (
      <div className="phone-content">
        <WalletConnect client={client} />
      </div>
    );
  }

  const agents = vault.rules ? vault.rules.agents.slice(0, vault.rules.agentCount) : [];
  const pages = [
    <MainWalletCard payer={client.payer} mint={MINT} vault={vault} runApproval={approval.run} />,
    ...agents.map((agent) => (
      <AgentCardView
        key={agent.key}
        payer={client.payer}
        rulesAddress={vault.pdas!.rules}
        agent={agent}
        name={agentNameFor(agent.key)}
        merchants={merchants.filter((m) => merchantLabelsFor(agent.key).includes(m.label))}
        runApproval={approval.run}
        onChanged={vault.refresh}
      />
    )),
  ];
  const v2Pages = [
    <V2MainCard client={client} approval={approval} recovery={recovery} tick={tick} onMoved={() => setTick((t) => t + 1)} />,
    ...v2Vaults.agents.map((a) => <V2AgentCard key={a.address} agent={a} policy={policy} />),
  ];

  return (
    <div className="phone-content">
      <div className="phone-header">
        <h1>Vault</h1>
        <span className="wallet-address">{connected.account.address.slice(0, 4)}…{connected.account.address.slice(-4)}</span>
      </div>
      <div className="panel-seg" role="tablist" aria-label="Rules enforced by">
        <button className={version === 'v1' ? 'on' : ''} onClick={() => setVersion('v1')} role="tab" aria-selected={version === 'v1'}>
          V1
        </button>
        <button className={version === 'v2' ? 'on' : ''} onClick={() => setVersion('v2')} role="tab" aria-selected={version === 'v2'}>
          V2
        </button>
      </div>
      <p className="panel-seg-sub">
        {version === 'v1'
          ? 'Rules on-chain. Changes need a Phantom signature.'
          : 'Rules off-chain in the policy server. Changes are instant and free.'}
      </p>
      <CardCarousel key={version} pages={version === 'v1' ? pages : v2Pages} />
      <ApprovalModal state={approval.state} onClose={approval.dismiss} />
      <ApprovalModal state={recovery.state} onClose={recovery.dismiss} />
    </div>
  );
}

export function App() {
  const client = useClient<AppClient>();
  return (
    <div className="app-page">
      <div className="app-page-heading">
        <h1>{ACTIVE_VAULT.title}</h1>
        <p>Devnet only. Every action is signed by your connected wallet.</p>
      </div>
      <PhoneFrame>
        <Dashboard client={client} />
      </PhoneFrame>
    </div>
  );
}

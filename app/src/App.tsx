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
import { MERCHANT_CATALOGUE, DEMO_USD_MINT } from './catalogue';
import { getAssociatedTokenAddress } from './lib/program';
import type { AppClient } from './providers';
import './App.css';

const MINT = address(DEMO_USD_MINT);

function useMerchantRefs(mint: Address): MerchantRef[] {
  const [refs, setRefs] = useState<MerchantRef[]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      MERCHANT_CATALOGUE.map(async (m) => ({
        key: m.label.toLowerCase().replace(/\s+/g, ''),
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
  const merchants = useMerchantRefs(MINT);

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
        merchants={merchants}
        runApproval={approval.run}
        onChanged={vault.refresh}
      />
    )),
  ];

  return (
    <div className="phone-content">
      <div className="phone-header">
        <h1>Vault</h1>
        <span className="wallet-address">{connected.account.address.slice(0, 4)}…{connected.account.address.slice(-4)}</span>
      </div>
      <CardCarousel pages={pages} />
      <ApprovalModal state={approval.state} onClose={approval.dismiss} />
    </div>
  );
}

export function App() {
  const client = useClient<AppClient>();
  return (
    <div className="app-page">
      <div className="app-page-heading">
        <h1>Agentic vault</h1>
        <p>Devnet only. Every action is signed by your connected wallet.</p>
      </div>
      <PhoneFrame>
        <Dashboard client={client} />
      </PhoneFrame>
    </div>
  );
}

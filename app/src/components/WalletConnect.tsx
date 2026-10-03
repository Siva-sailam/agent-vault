import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  WalletReadyGate,
} from '@solana/kit-plugin-wallet/react';
import type { AppClient } from '../providers';

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function ConnectInner({ client }: { client: AppClient }) {
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatch: connect } = useConnect(client);
  const { dispatch: disconnect } = useDisconnect(client);

  if (connected) {
    const onDevnet = connected.account.chains.includes('solana:devnet');
    return (
      <div className="wallet-box">
        <div>
          <strong>{connected.wallet.name}</strong> connected:{' '}
          <span className="wallet-address">{short(connected.account.address)}</span>
        </div>
        {!onDevnet && (
          <p className="network-warning">
            ⚠ This wallet account isn't scoped to Solana Devnet. Open Phantom → Settings →
            Developer Settings → turn on Testnet Mode → select Solana Devnet, then reconnect.
            Every action below is blocked until then.
          </p>
        )}
        <button onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="wallet-box">
        <p className="network-warning">
          No devnet-scoped wallet found. In Phantom: Settings → Developer Settings → turn on
          Testnet Mode → select Solana Devnet — then refresh this page.
        </p>
      </div>
    );
  }

  return (
    <div className="wallet-box">
      {wallets.map((wallet) => (
        <button key={wallet.name} onClick={() => connect(wallet)}>
          Connect {wallet.name}
        </button>
      ))}
    </div>
  );
}

export function WalletConnect({ client }: { client: AppClient }) {
  return (
    <WalletReadyGate client={client} fallback={<p>Looking for wallets…</p>}>
      <ConnectInner client={client} />
    </WalletReadyGate>
  );
}

/** True only when a wallet is connected AND scoped to devnet. Every action
 * panel gates on this so nothing can be attempted from the wrong network. */
export function useIsReady(client: AppClient) {
  const connected = useConnectedWallet(client);
  return Boolean(connected && connected.account.chains.includes('solana:devnet'));
}

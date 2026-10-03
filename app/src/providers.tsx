import type { ReactNode } from 'react';
import { createClient } from '@solana/kit';
import { solanaDevnetRpc } from '@solana/kit-plugin-rpc';
import { walletSigner } from '@solana/kit-plugin-wallet';
import { ClientProvider } from '@solana/react';

// One client for the whole app. `chain: 'solana:devnet'` scopes wallet
// discovery to devnet-capable accounts only — a wallet not in devnet mode
// simply won't show up in the connect list, which is the first line of
// devnet-only enforcement (see App.tsx for the second: we also check the
// connected account's advertised chains and show a banner if it doesn't
// include devnet).
//
// We deliberately do NOT opt into transaction version 1 (the client's
// `transactionConfig.version` defaults to 0). Version 1's larger transaction
// size exists for programs that need more accounts/data per transaction than
// fit in the classic 1232-byte limit; every transaction this app builds is
// small (at most ~7 accounts, a few bytes of args), so v1 buys nothing here
// while depending on Phantom already supporting a very new wire format.
// Version 0 is universally supported today.
export const client = createClient()
  .use(walletSigner({ chain: 'solana:devnet' }))
  .use(solanaDevnetRpc());

export type AppClient = Awaited<typeof client>;

export function Providers({ children }: { children: ReactNode }) {
  return <ClientProvider client={client}>{children}</ClientProvider>;
}

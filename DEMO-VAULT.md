# Demo vault (Agent USD / aUSD) — devnet

Public addresses only. No keys. Created for the M8 recording; the vault itself is
created from the control panel ("Set up demo vault"), signed by Phantom.

| Item | Address |
|---|---|
| Program | `B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj` |
| Mint (Agent USD, aUSD, decimals 0, no freeze authority) | [`EMiGUP2fckjgjgHiTnG4237q3jY4PygPg6zZeVb5fNh9`](https://solscan.io/token/EMiGUP2fckjgjgHiTnG4237q3jY4PygPg6zZeVb5fNh9?cluster=devnet) |
| Mint + update authority | CLI wallet `8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf` |
| Token metadata | [`BbgCo2nny5bXFBfFzVhCHVerSCwRzjjeUbZuccZKPeSY`](https://solscan.io/account/BbgCo2nny5bXFBfFzVhCHVerSCwRzjjeUbZuccZKPeSY?cluster=devnet) |
| Metadata JSON (gist) | https://gist.githubusercontent.com/Siva-sailam/d8dccbc58e61b079f775dc671e5e513a/raw/token.json |
| Vault owner (Phantom) | `7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg` |
| Phantom aUSD token account (1,000 aUSD minted) | `38U2FFT22H17RgqQmiCkZisX2MEWHauPGjJwzXFDvTj1` |

## Vault accounts (derived — exist after "Set up demo vault")

| Item | Address |
|---|---|
| Rules account | [`Gd3nKiCXJ4yMSNG1uUi67WR5F8CazRa9PDVqQnaSGosb`](https://solscan.io/account/Gd3nKiCXJ4yMSNG1uUi67WR5F8CazRa9PDVqQnaSGosb?cluster=devnet) |
| Vault authority (PDA) | `4xB4r6xhTgWC7zj6iVzr9jyuZWd8Mk72Zm3xTgyzLBuK` |
| Vault token account | [`A7WEBomt7tZcn7obsEvncWaDqVZ8D2nqGfxjp5JdC3ZU`](https://solscan.io/account/A7WEBomt7tZcn7obsEvncWaDqVZ8D2nqGfxjp5JdC3ZU?cluster=devnet) |

## Agents (weekly budget 200 aUSD each)

| Agent | Address | Merchants |
|---|---|---|
| food-ordering-agent | `5j6MVbQawnm7tZWD9pJRv5Ai8Kt4ZC7R6DKQNZPaL2kg` | Kuber Eats, Talabird, Zomatic, Noonly |
| shopping-agent | `BUoabuXD2afpjb53sWuz36hEdMWeLg9cGZPBfSVGLWne` | Amazen, Flipkort, Nykeo, Meeshi |

## Merchants (invented names; the program allow-lists the aUSD token account)

| Merchant | Wallet | aUSD token account |
|---|---|---|
| Kuber Eats | `8eviovXXxCChQ5XFxkfP9mS9G4P15HikgPWnDLAdFQ3m` | `5xUf2k7e4acXkEwCPJtw1KT65TRkzJ3Bt2ZRywH57Z1z` |
| Talabird | `77SZgXFJhwAaUyoEL9ZbGPBHNVzs2vvru6hmVBn1sLNG` | `8ZFp9QSoBmmVr5MWW98sQXyJHyg7UekXqfH9piy2hMVk` |
| Zomatic | `5fNBNoqhN1qHS8KnuWA2fTa2mBjjUNRQWPGJBN8gdWvg` | `9aZEUaRn3Kku7cxbSaVQD9fzA9H6sbJqmK7Temd5EA1Q` |
| Noonly | `93UovYKh3DKvNoJ4StR74NXRacRPEbKtVFkZT8wfEsRw` | `5SWVBdCEMSaCh44urXhKKQiG8iMMNLbfNPcTSxBqRkFe` |
| Amazen | `382vZ6MF78Uw4HEXuRRi2hZxM7g3XuSP2iq9pJ8Q8A1P` | `5DJMzyqZzzKrYkLcLQTEmxhJeRXa1u6EKn1z1bvB1Rjz` |
| Flipkort | `A8qHSX5ssv3kcpVDcX5nzRNs4fxXmDzbaNdZ6sYhKpE6` | `5pHNPCNeZxLL9QPPALBCe8QfY1beUtsQo4P916Up7Jm5` |
| Nykeo | `5b1MBaMfiup3dzbJQAAJYVvY5mmM41y5inihJJetrGry` | `C1jGAYrC6uKo3YCPMv7rgDajTu16nA6URJnrSCPirDbr` |
| Meeshi | `4sD8JjJwzKgxRDGqfwabWAEUWMs3LnRpNLzcwpbPXUqC` | `DczdKYAg2SGoctLmKfve5et5i7SJ33MoBit9B6DxVvHc` |

## Using it

- Control panel: `http://localhost:5173` (default is this vault; `?vault=b` is the original Vault B).
- Storefront: `http://localhost:5173/storefront.html`.
- Scenario: `cd agent-service && npm start` (food-ordering-agent pays Noonly 20, Talabird 20, Zomatic 15 → pause: switch Noonly off → Noonly 5 refused → pause: revoke → Talabird 5 refused). `npm start -- --config vault-b.config.json` runs the original Vault B scenario.
- One-off payment: `npm run agent -- --agent food-ordering-agent --merchant Noonly --amount 20`.
- Recreate the token/keys/config: `cd scripts && npx tsx setup-agent-usd.ts` (idempotent). Keys live in `~/agent-vault/keys` (gitignored).

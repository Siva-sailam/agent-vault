# Agentic Payments Vault - Project Explainer Export

Read-only export. Every address and value below was re-verified against the files in ~/agent-vault and against live devnet RPC calls at the time this report was generated (2026-09-27), not recalled from memory. No private keys, seed phrases, or key file contents appear anywhere below - public keys only. No code, program, or on-chain state was changed to produce this report, and no transactions were sent.

## 1. Vaults

### Vault A - M5 (owner = local CLI wallet, ~/.config/solana/id.json)

| Field | Value |
|---|---|
| Owner | 8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf |
| Rules account (PDA) | 89MEfR6n5JkAsL8Ebq7WdUNarvxs3wKkre82ax1hdpeA |
| Vault authority (PDA, signer only, no data) | EMbWzUyJxd7m9XFdjLKNmxM5yT4gDk6qTMAbHTcppnPD |
| Vault token account | DF5A9fbPzd54Lhy4aK39YXfvc4bWSynnBjPq7F1TyPWr |
| Mint | 3txU6ZAzx6oAMhFMd9CjuRTFB9YkCYvnYSZeFfLK19ec |
| Owner's own Demo USD token account | 7EsufvV55znhcjWzZK8KbXSge1KMR4ZhwSRiYS8Lgo9R |
| Current vault balance (verified via RPC) | 180 Demo USD |

Agents:

| Name | Public key | Weekly budget | Spent so far | Window start | Revoked | Merchant slot 1 | Merchant slot 2 | Merchant slot 3 | Merchant slot 4 |
|---|---|---|---|---|---|---|---|---|---|
| agent-grocery | 9AVXftuvUQm6y8s4uoWUEDBeQcPMDABcDNBLTeaQa1eb | 50 | 10 | 2026-09-26 | false | Noon | (empty) | (empty) | (empty) |
| agent-second | 4i8XMX2vk9rYEnJ9nh8bHTsZR6R1B5yHLCQBpfZ82AXY | 50 | 10 | 2026-09-26 | false | Talabat | (empty) | (empty) | (empty) |

(window_start timestamps in full: agent-grocery = 2026-09-26T07:19:47Z, agent-second = 2026-09-26T10:17:17Z)

### Vault B - M6/M7 (owner = Phantom wallet)

| Field | Value |
|---|---|
| Owner | 7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg |
| Rules account (PDA) | FqvtswryB3Y9Sbc35UZempimJWFHQeH8si8oHnFpBEZD |
| Vault authority (PDA, signer only, no data) | FomDztuKE6kVKW9iCBJWpzXofKFvDkAWepryEPM82bwm |
| Vault token account | CAg4DQ4ceTDUteCRtEnCJipVq3KcJV57hjdGVVUNXccQ |
| Mint | 3txU6ZAzx6oAMhFMd9CjuRTFB9YkCYvnYSZeFfLK19ec |
| Owner's own Demo USD token account | 2gkZcZzpaF6wG9ZPFURWyD8Qaq7k6rkzgYoHeTEmCv8y |
| Current vault balance (verified via RPC) | 15 Demo USD |

Agents:

| Name | Public key | Weekly budget | Spent so far | Window start | Revoked | Merchant slot 1 | Merchant slot 2 | Merchant slot 3 | Merchant slot 4 |
|---|---|---|---|---|---|---|---|---|---|
| agent-grocery | 9AVXftuvUQm6y8s4uoWUEDBeQcPMDABcDNBLTeaQa1eb | 50 | 45 | 2026-09-26 | false | (empty) | Talabat | Zomato | Uber Eats |
| agent-second | 4i8XMX2vk9rYEnJ9nh8bHTsZR6R1B5yHLCQBpfZ82AXY | 50 | 40 | 2026-09-26 | true | (empty) | Talabat | Zomato | Uber Eats |

(window_start timestamps in full: agent-grocery = 2026-09-26T20:56:45Z, agent-second = 2026-09-26T21:35:45Z. agent-grocery's slot 1 shows empty because Noon was removed from its allow-list during the M7 scripted pause; agent-second is currently revoked, also from the M7 scripted pauses.)

### Vault C - TEST (owner = a throwaway keypair generated during M6 debugging)

Created solely to prove a real signed `sendTransaction` works end-to-end against this program (used while diagnosing the M6 Phantom "not enough SOL" bug). Not part of the demo narrative.

| Field | Value |
|---|---|
| Owner | JDjbU63GEw7oDqyt2gdjCQfgiCPVn4CVb2PMq24AQyzv |
| Rules account (PDA) | JCnHvmk5zRAgsjLYeudHj2DFaxPxy5sEH1mGXjzXaELM |
| Vault authority (PDA, signer only, no data) | FH23WCbhVeQYxb6p3t7GgSS9TUzc1xerGGaW5m2CioFA |
| Vault token account | BXQgmHPTMy1PpZUQzMdzam8szw4TEfLRmcHrZ4XAN8st |
| Mint | 3txU6ZAzx6oAMhFMd9CjuRTFB9YkCYvnYSZeFfLK19ec |
| Owner's own Demo USD token account | 33ABYhhncspQhBuQG5i18mjeqvfBomuBfAqsK3qSwge4 |
| Current vault balance (verified via RPC) | 0 Demo USD |
| Agents registered | 0 (agent_count = 0; both agent slots are unused/zeroed) |

## 2. Every account

| Name | Full address | Owning program | What it holds | Exists on-chain | Solscan (devnet) |
|---|---|---|---|---|---|
| Program (agent_vault) | B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj | BPFLoaderUpgradeab1e11111111111111111111111 | Routing entry to the program's executable data | Yes | https://solscan.io/account/B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj?cluster=devnet |
| Program data | J66sAasrCWK9pawNqD3Nc2BZK6KHLEB3buKqNTMVBwBa | BPFLoaderUpgradeab1e11111111111111111111111 | The compiled program bytes (270208 bytes) plus an upgrade-authority header | Yes | https://solscan.io/account/J66sAasrCWK9pawNqD3Nc2BZK6KHLEB3buKqNTMVBwBa?cluster=devnet |
| Upgrade authority | 8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf | (same as CLI owner wallet below - a wallet, not a separate account) | Authority to push program upgrades | Yes | https://solscan.io/account/8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf?cluster=devnet |
| Owner wallet - CLI | 8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf | System Program | SOL only | Yes | https://solscan.io/account/8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf?cluster=devnet |
| Owner wallet - Phantom | 7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg | System Program | SOL only | Yes | https://solscan.io/account/7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg?cluster=devnet |
| Owner wallet - TEST throwaway | JDjbU63GEw7oDqyt2gdjCQfgiCPVn4CVb2PMq24AQyzv | System Program | SOL only | Yes | https://solscan.io/account/JDjbU63GEw7oDqyt2gdjCQfgiCPVn4CVb2PMq24AQyzv?cluster=devnet |
| Agent wallet - agent-grocery | 9AVXftuvUQm6y8s4uoWUEDBeQcPMDABcDNBLTeaQa1eb | (none - never funded) | Nothing; used only as a public key/signer, never holds SOL | No | https://solscan.io/account/9AVXftuvUQm6y8s4uoWUEDBeQcPMDABcDNBLTeaQa1eb?cluster=devnet |
| Agent wallet - agent-second | 4i8XMX2vk9rYEnJ9nh8bHTsZR6R1B5yHLCQBpfZ82AXY | (none - never funded) | Nothing; used only as a public key/signer, never holds SOL | No | https://solscan.io/account/4i8XMX2vk9rYEnJ9nh8bHTsZR6R1B5yHLCQBpfZ82AXY?cluster=devnet |
| Merchant wallet - Noon | DFTuEQUPL2X3ZPnKd649r5iE4Dtfg9anXKRwVW7Qc3ne | (none - never funded) | Nothing; only its associated token account below is used | No | https://solscan.io/account/DFTuEQUPL2X3ZPnKd649r5iE4Dtfg9anXKRwVW7Qc3ne?cluster=devnet |
| Merchant wallet - Talabat | 79SqU4CSRmu6bq7QQiFet8bHLs7zJj8e4yWiTZF4F5zo | (none - never funded) | Nothing; only its associated token account below is used | No | https://solscan.io/account/79SqU4CSRmu6bq7QQiFet8bHLs7zJj8e4yWiTZF4F5zo?cluster=devnet |
| Merchant wallet - Zomato | 4TBdAhTAKeYCSKYnc5vtrAgMDkgrHT9AoJfEmxKc8vqK | (none - never funded) | Nothing; only its associated token account below is used | No | https://solscan.io/account/4TBdAhTAKeYCSKYnc5vtrAgMDkgrHT9AoJfEmxKc8vqK?cluster=devnet |
| Merchant wallet - Uber Eats | 2wqyxRpzQApHzdsNSz1d8HQpJD3JkhtYsZ8MVpiGE9fD | (none - never funded) | Nothing; only its associated token account below is used | No | https://solscan.io/account/2wqyxRpzQApHzdsNSz1d8HQpJD3JkhtYsZ8MVpiGE9fD?cluster=devnet |
| Merchant token account - Noon | 2LaaE1kjFgrDt7wJEX6R1AaTNLpAWK5L3NH9jD44AEfQ | TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA | 50 Demo USD | Yes | https://solscan.io/account/2LaaE1kjFgrDt7wJEX6R1AaTNLpAWK5L3NH9jD44AEfQ?cluster=devnet |
| Merchant token account - Talabat | DFHHetYvxtkn5S39t1fHN8fEzB9GQuwt9zqtGMyhkk13 | TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA | 55 Demo USD | Yes | https://solscan.io/account/DFHHetYvxtkn5S39t1fHN8fEzB9GQuwt9zqtGMyhkk13?cluster=devnet |
| Merchant token account - Zomato | 7FqDyUGzeug3KH33ReV9xrLCbJaRUDkTXYqxhpBQHEVN | TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA | 0 Demo USD | Yes | https://solscan.io/account/7FqDyUGzeug3KH33ReV9xrLCbJaRUDkTXYqxhpBQHEVN?cluster=devnet |
| Merchant token account - Uber Eats | GEieoQQTU8V8Benx9hsA11ZeacNKc7w4LGFLFerbcDLQ | TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA | 0 Demo USD | Yes | https://solscan.io/account/GEieoQQTU8V8Benx9hsA11ZeacNKc7w4LGFLFerbcDLQ?cluster=devnet |
| Owner token account - CLI (Vault A) | 7EsufvV55znhcjWzZK8KbXSge1KMR4ZhwSRiYS8Lgo9R | TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA | 999800 Demo USD | Yes | https://solscan.io/account/7EsufvV55znhcjWzZK8KbXSge1KMR4ZhwSRiYS8Lgo9R?cluster=devnet |
| Owner token account - Phantom (Vault B) | 2gkZcZzpaF6wG9ZPFURWyD8Qaq7k6rkzgYoHeTEmCv8y | TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA | 400 Demo USD | Yes | https://solscan.io/account/2gkZcZzpaF6wG9ZPFURWyD8Qaq7k6rkzgYoHeTEmCv8y?cluster=devnet |
| Owner token account - TEST (Vault C) | 33ABYhhncspQhBuQG5i18mjeqvfBomuBfAqsK3qSwge4 | TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA | 0 Demo USD | Yes | https://solscan.io/account/33ABYhhncspQhBuQG5i18mjeqvfBomuBfAqsK3qSwge4?cluster=devnet |
| Demo USD mint | 3txU6ZAzx6oAMhFMd9CjuRTFB9YkCYvnYSZeFfLK19ec | TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA | Mint account | Yes | https://solscan.io/account/3txU6ZAzx6oAMhFMd9CjuRTFB9YkCYvnYSZeFfLK19ec?cluster=devnet |

Demo USD mint details (verified via `getAccountInfo` with jsonParsed encoding):
- Supply: 1000500
- Decimals: 0
- Mint authority: 8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf
- Freeze authority: none (null)

Vault authority PDAs (EMbWzUyJxd7m9XFdjLKNmxM5yT4gDk6qTMAbHTcppnPD, FomDztuKE6kVKW9iCBJWpzXofKFvDkAWepryEPM82bwm, FH23WCbhVeQYxb6p3t7GgSS9TUzc1xerGGaW5m2CioFA) are excluded from the table above because they hold no data and no lamports by design - they exist only as a signing identity the program derives at CPI time, never as a funded/initialized account. Confirmed via `getAccountInfo`: all three return null (do not exist as accounts), which is expected and correct.

## 3. Program

Program ID: B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj

### Instructions

| Instruction | Who must sign | Accounts | What it checks | What it changes |
|---|---|---|---|---|
| initialize_vault | owner | owner (signer, payer), mint, rules (PDA, init), vault_authority (PDA, unchecked), vault (token account, PDA, init), token_program, system_program | Nothing beyond standard Anchor account constraints (PDA seeds/bumps, mint is a real Mint account) | Creates the rules account and the vault token account; sets rules.owner, rules.mint, rules.vault, all three bumps, agent_count=0, and zeroes all agent slots |
| add_agent(agent: Pubkey, weekly_budget: u64) | owner | owner (signer), rules (mut, has_one owner) | weekly_budget > 0; agent_count < 2; agent pubkey not already registered | Writes a new Agent into the next free slot (key, weekly_budget, spent_so_far=0, window_start=now, revoked=false, all merchants empty); increments agent_count |
| deposit(amount: u64) | owner | owner (signer), rules (has_one owner), vault (mut, address=rules.vault), owner_token_account (mut), token_program | owner_token_account belongs to this mint and this owner | Transfers `amount` tokens from owner_token_account to vault via CPI |
| agent_spend(amount: u64) | agent | agent (signer), rules (mut), vault (mut, address=rules.vault), vault_authority (PDA, unchecked, bump=rules.vault_authority_bump), destination (mut token account, this mint), token_program | Signer is a registered agent; agent not revoked; destination is on that agent's 4-slot merchant allow-list (deny-by-default: empty list = decline everywhere); resets spent_so_far/window_start if 7 days have elapsed; amount <= remaining weekly budget | Increments agent.spent_so_far (and may reset window_start); transfers `amount` tokens from vault to destination via CPI signed by the vault_authority PDA |
| add_merchant(agent: Pubkey, merchant: Pubkey) | owner | owner (signer), rules (mut, has_one owner) | merchant != default/empty pubkey; agent exists; merchant not already on that agent's list; a free of the 4 slots exists | Writes merchant into the first empty of that agent's 4 merchant slots |
| remove_merchant(agent: Pubkey, merchant: Pubkey) | owner | owner (signer), rules (mut, has_one owner) | agent exists; merchant is currently on that agent's list | Zeroes that merchant slot for that agent |
| set_agent_revoked(agent: Pubkey, revoked: bool) | owner | owner (signer), rules (mut, has_one owner) | agent exists | Sets that agent's revoked flag to the given value (true = frozen, false = reinstated); budget/spend history/merchant list are untouched |
| withdraw(amount: u64) | owner | owner (signer), rules (has_one owner), vault (mut, address=rules.vault), vault_authority (PDA, unchecked, bump=rules.vault_authority_bump), owner_token_account (mut), token_program | vault.amount >= amount | Transfers `amount` tokens from vault to owner_token_account via CPI signed by vault_authority |

### VaultRules account layout (478 bytes total, verified against live on-chain data length)

| Field | Type | Size (bytes) |
|---|---|---|
| discriminator | (Anchor account discriminator) | 8 |
| owner | Pubkey | 32 |
| mint | Pubkey | 32 |
| vault | Pubkey | 32 |
| bump | u8 | 1 |
| vault_bump | u8 | 1 |
| vault_authority_bump | u8 | 1 |
| agent_count | u8 | 1 |
| agents[0] (Agent, see below) | struct | 185 |
| agents[1] (Agent, see below) | struct | 185 |
| **Total** | | **478** |

Agent struct (185 bytes each):

| Field | Type | Size (bytes) |
|---|---|---|
| key | Pubkey | 32 |
| weekly_budget | u64 | 8 |
| spent_so_far | u64 | 8 |
| window_start | i64 | 8 |
| revoked | bool | 1 |
| merchants[0..4] | [Pubkey; 4] | 128 |
| **Total** | | **185** |

Rent deposit for one 478-byte VaultRules account (verified via `getAccountInfo`): 3078480 lamports = 0.00307848 SOL. There are 3 such accounts live (Vault A/B/C rules), each holding this exact rent.

### Custom errors (agent_vault::error::VaultError)

| Code | Name | Plain-English meaning |
|---|---|---|
| 6000 | AgentSlotsFull | This vault already has 2 agents registered; no room for a third |
| 6001 | AgentAlreadyRegistered | That public key is already registered as an agent on this vault |
| 6002 | ZeroBudget | A new agent's weekly budget must be greater than zero |
| 6003 | AgentNotFound | The signer (or the agent pubkey given) isn't registered on this vault |
| 6004 | AgentRevoked | This agent has been frozen and cannot spend until unrevoked |
| 6005 | BudgetExceeded | This spend would exceed the agent's remaining budget for the current 7-day window |
| 6006 | MerchantNotAllowed | The destination token account is not on this agent's merchant allow-list |
| 6007 | MerchantSlotsFull | This agent already has all 4 merchant slots filled |
| 6008 | MerchantAlreadyAllowed | That merchant is already on this agent's allow-list |
| 6009 | MerchantNotFound | That merchant isn't currently on this agent's allow-list (can't remove it) |
| 6010 | InvalidMerchant | The merchant pubkey given was the default/empty pubkey |
| 6011 | InsufficientVaultBalance | The vault doesn't hold enough tokens to cover this withdrawal |

### Deployment facts

- Program binary on disk (`agent_vault/target/deploy/agent_vault.so`): 270208 bytes
- On-chain ProgramData account data length: 270253 bytes (270208-byte executable + a 45-byte ProgramData header carrying the deploy slot and upgrade-authority option - the two numbers are consistent, not a discrepancy)
- Deploy cost: program account rent (833120 lamports) + ProgramData account rent (1373535480 lamports) + deploy transaction fee (10000 lamports) = 1374378600 lamports = 1.3743786 SOL total
- Deploy slot: 504324301
- Deploy slot's block time (verified via `solana block-time`): 2026-09-26T07:08:35Z

## 4. Tests

Fresh run of the full automated test suite, executed just now (`cd ~/agent-vault/agent_vault && anchor test`), local LiteSVM in-process VM, no devnet involved:

| Test | Result |
|---|---|
| test_id (Anchor's own generated sanity test) | PASS |
| vault_initializes_with_correct_rules | PASS |
| successful_spend_moves_tokens_and_tracks_budget | PASS |
| overspend_is_refused | PASS |
| non_agent_signer_is_refused | PASS |
| window_resets_after_seven_days | PASS |
| spend_to_non_allowlisted_merchant_is_refused | PASS |
| add_and_remove_merchant_gate_spending | PASS |
| add_merchant_rejects_duplicates_and_overflow | PASS |
| revoked_agent_cannot_spend_until_unrevoked | PASS |
| owner_can_withdraw_and_overdraw_is_refused | PASS |

Result: 11/11 passing (1 + 10).

There is no separate automated "M6 verification" test suite/script in this repo. M6 was verified by two means instead, both already reflected as real devnet transactions in Section 7: (a) a manual click-by-click walkthrough of the browser control panel, and (b) the `agent-pay` CLI (`agent_vault/programs/agent_vault/examples/agent_pay.rs`), run once for a successful payment and once for a refused one. Both are documented in NOTES.md section 9 and their transaction signatures are reproduced in Section 7 below.

## 5. Front end and agent service

### Control panel + storefront (`~/agent-vault/app`)

- Stack: Vite 8.3.0, React 19.2.8, TypeScript 6.0.2 (per `app/package.json`)
- Solana libraries: @solana/kit 8.3.0, @solana/kit-plugin-rpc 0.19.0, @solana/kit-plugin-wallet 0.20.0, @solana/react 8.3.0
- Talks to the program via hand-written instruction builders in `app/src/lib/program.ts` (one function per instruction), reading discriminators and error codes/messages at runtime from `app/src/idl/agent_vault.json` (a copy of the program's own generated IDL - single source of truth, not re-typed by hand). Account bytes are decoded manually in `decodeVaultRules()` at fixed offsets matching `state.rs`. PDAs are re-derived client-side with the same seeds the program uses.
- Ports: dev server on http://localhost:5173 (`npm run dev`, from `app/`). Control panel at `/`, storefront at `/storefront.html`.
- Merchant catalogue (`app/src/catalogue.ts`) is generated, not hand-typed, by `node scripts/generate-catalogue.mjs` - it reads the public-key half only of the merchant/mint keypair files.
- Key file paths referenced by the app (paths only, never contents): `~/agent-vault/keys/merchant-*.json`, `~/agent-vault/keys/demo-usd-mint.json` (public-key half only, via the generated catalogue), `~/agent-vault/agent_vault/target/idl/agent_vault.json` (copied into `app/src/idl/`).
- To start it: `cd ~/agent-vault/app && npm install && npm run dev`.

### Agent service (`~/agent-vault/agent-service`)

- Stack: plain Node (v24.10.0), @solana/kit 8.3.0 only (per `agent-service/package.json`)
- Holds an agent's private keypair in-process (read once from `~/agent-vault/keys/<agent-file>.json` at startup); a separate copy of PDA derivation/instruction-building/decoding logic lives in `agent-service/lib/program.mjs`, deliberately not shared with the browser bundle.
- Fee payer for every transaction it sends is the local CLI wallet (`~/.config/solana/id.json`), not the agent itself - agent wallets hold no SOL and never need to.
- Exposes a tiny HTTP server on port 4021 by default (`--port` to override): `GET /events` (SSE activity feed), `POST /continue` (advance past a scripted pause). Consumed by the storefront page in the browser.
- To start it: `cd ~/agent-vault/agent-service && npm install && node index.mjs --agent <keyfile> --port <port>` (defaults: `agent-grocery.json`, port 4021).

## 6. Bugs found and fixed

| Symptom | Cause | Fix | Milestone |
|---|---|---|---|
| Phantom showed "You don't have enough SOL" / "Failed to simulate" on Create vault, despite a real 5 SOL balance | "Create vault" bundled a non-idempotent SPL Associated Token `Create` instruction, which hard-fails with `IllegalOwner` if the account already exists (it did, pre-funded via CLI) | Switched to `CreateIdempotent` (discriminant 1) everywhere, included unconditionally in every action; deleted the client-side existence pre-check entirely | M6 |
| Same warning persisted even after the above fix, on an otherwise-correct transaction | Not a real bug - Phantom's own balance-preview/simulation service is known to be unreliable for brand-new/unindexed devnet programs and falls back to a generic "not enough SOL" message whenever it can't produce a preview | No code fix; verified independently via direct `simulateTransaction` (err: null) and a full real send using a throwaway keypair; documented that "Confirm (unsafe)" is safe to click here | M6 |
| `explainTransactionError` crashed on some RPC error objects | `JSON.stringify` cannot serialize a raw `BigInt` value without a custom replacer, and the raw RPC error sometimes contained one | Added a replacer that converts `BigInt` to string before stringifying | M7 |
| A refused transaction's displayed reason sometimes showed a raw/unrecognized code instead of the plain-English message | The Custom-error-code regex only matched a bare number (`Custom(6005)`) and missed the quoted-string form (`"Custom":"6005"`) some RPC responses use | Regex updated to match both forms (cosmetic only - the actual on-chain refusal and its cause were already correct) | M7 |
| The carousel's first/active card visually merged with the card stacked behind it | `.carousel-card` had no background of its own, and the opacity formula only dimmed cards at |offset|=2, so an |offset|=1 neighbor showed through at full opacity | Added an explicit opaque `background: var(--paper)` to `.carousel-card` | Redesign pass 4 |
| Swiping/pressing past the last agent card did nothing | `CardCarousel`'s navigation clamped at the ends instead of wrapping | `go()` now wraps both directions via modulo arithmetic; a `circularOffset()` helper picks the shortest signed distance so the wraparound neighbor peeks from the correct side | Redesign pass 4 |

## 7. Transactions

All signatures below were re-checked just now via `getSignatureStatuses` against live devnet - every one is `finalized`, and the `err` field shown matches what's reported (null = success, a Custom code = the exact refusal recorded).

| Step | Signature | Success/fail | Solscan link |
|---|---|---|---|
| CLI wallet funded 5 SOL (web faucet) | 3PetCuS8bf1Dm9xyyFvYLovQXN5k95wmvqh4TjQ1cHsg14Kzfw4KGjhnKzjMsyDV9ngKo6L5HDLnQCyt5APMgHeD | success | https://solscan.io/tx/3PetCuS8bf1Dm9xyyFvYLovQXN5k95wmvqh4TjQ1cHsg14Kzfw4KGjhnKzjMsyDV9ngKo6L5HDLnQCyt5APMgHeD?cluster=devnet |
| Program deploy | TJyBJSrcbJSos8hD2tQMeABmVRQyPjFNn3dC1sV9JDYyJHMSnT5MQYPfZHnH2gKL4guoRRNnKiJWphZahGBc956 | success | https://solscan.io/tx/TJyBJSrcbJSos8hD2tQMeABmVRQyPjFNn3dC1sV9JDYyJHMSnT5MQYPfZHnH2gKL4guoRRNnKiJWphZahGBc956?cluster=devnet |
| M5: initialize vault (Vault A) | 4DjmCFvJYV7BwexXYM358UuAvUabrTpgGiX5jm6J7zXChKnUpnikBgsfeSScyep23H3CzB8Jj3kALne3CaEKzh3L | success | https://solscan.io/tx/4DjmCFvJYV7BwexXYM358UuAvUabrTpgGiX5jm6J7zXChKnUpnikBgsfeSScyep23H3CzB8Jj3kALne3CaEKzh3L?cluster=devnet |
| M5: register agent-grocery (budget 50) | 5JCmuSfPYxKe54LjJUcypoBNV4W8ykMv1NdwEKbmYwphUaKUNpmJTz3o5sg4NaJh3NFYJGuNJuBBtDTsJBN8xtMh | success | https://solscan.io/tx/5JCmuSfPYxKe54LjJUcypoBNV4W8ykMv1NdwEKbmYwphUaKUNpmJTz3o5sg4NaJh3NFYJGuNJuBBtDTsJBN8xtMh?cluster=devnet |
| M5: create Noon's token account | 3Jmszj9WYn3maP8BJ4HTLnxbc4bft4y83G1BbSfB8rQxczZBA9AnPgL1csdWBuRKy2jtWgDgJmVRDM1xfhLY2kEN | success | https://solscan.io/tx/3Jmszj9WYn3maP8BJ4HTLnxbc4bft4y83G1BbSfB8rQxczZBA9AnPgL1csdWBuRKy2jtWgDgJmVRDM1xfhLY2kEN?cluster=devnet |
| M5: allow-list Noon for agent-grocery | 5BstLtVCR55uZYqpTtKo2VXaAc9U2xJMCzFSp1txfTUy4Bp9CWxLBzorWTLFzs2RjP6dtaJt8HAKRde5M4FZErWA | success | https://solscan.io/tx/5BstLtVCR55uZYqpTtKo2VXaAc9U2xJMCzFSp1txfTUy4Bp9CWxLBzorWTLFzs2RjP6dtaJt8HAKRde5M4FZErWA?cluster=devnet |
| M5: deposit 200 Demo USD | 3Bu3umcF1qLStgybZvkpCHd9QezQK2sFGwURWNSfzTmnKPJuafTEy9eWiXLHhmmWtxqXZBDtdpTThvQoSQBx7nbT | success | https://solscan.io/tx/3Bu3umcF1qLStgybZvkpCHd9QezQK2sFGwURWNSfzTmnKPJuafTEy9eWiXLHhmmWtxqXZBDtdpTThvQoSQBx7nbT?cluster=devnet |
| M5: agent-grocery pays Noon 10 (the first real payment) | 3oS2u2ESequFz6HbKGa1Ct1BFNT7k4PyQeXZ1dgC5M84UvizdCF2kPFNcsocUvD3RLTVZd8sbM8NWpMAwj5du4UT | success | https://solscan.io/tx/3oS2u2ESequFz6HbKGa1Ct1BFNT7k4PyQeXZ1dgC5M84UvizdCF2kPFNcsocUvD3RLTVZd8sbM8NWpMAwj5du4UT?cluster=devnet |
| M5: register agent-second (budget 50) | 5NV6uhi981XWtgLx3SsoGnPZymuapuLUgHc4i8HsbCoXNnbP8wrR7EJCAEUKSDfKBGBdPg33GvbBhLXJfcvacnwH | success | https://solscan.io/tx/5NV6uhi981XWtgLx3SsoGnPZymuapuLUgHc4i8HsbCoXNnbP8wrR7EJCAEUKSDfKBGBdPg33GvbBhLXJfcvacnwH?cluster=devnet |
| M5: create Talabat's token account | 3gZpRJSQGnWvj9sawGYqHrXup5gM8M4W5ekWysXaJwpW9JACdVT1nhWTub4nwBat8ActxtawYFcyTcHTq4BkBZUh | success | https://solscan.io/tx/3gZpRJSQGnWvj9sawGYqHrXup5gM8M4W5ekWysXaJwpW9JACdVT1nhWTub4nwBat8ActxtawYFcyTcHTq4BkBZUh?cluster=devnet |
| M5: allow-list Talabat for agent-second | 3pGvYu9PinKQkqAvY3b32EVcMv8AbLjm1jVa7Hf2TJEhn1Xnitr9xR1GAirfie3PGx6k9U7czTNWXXPGGnJtyRFo | success | https://solscan.io/tx/3pGvYu9PinKQkqAvY3b32EVcMv8AbLjm1jVa7Hf2TJEhn1Xnitr9xR1GAirfie3PGx6k9U7czTNWXXPGGnJtyRFo?cluster=devnet |
| M5: agent-second pays Talabat 10 | 4g8bs6Q7cvzuH7HzLAeeTL6xHNTv9UHq3p98pLvjfiYqjr23FLZDgGDnE9PGJ4tpAHbxV6XKRYku5qgqWMV3A1GP | success | https://solscan.io/tx/4g8bs6Q7cvzuH7HzLAeeTL6xHNTv9UHq3p98pLvjfiYqjr23FLZDgGDnE9PGJ4tpAHbxV6XKRYku5qgqWMV3A1GP?cluster=devnet |
| Phantom wallet funded 5 SOL (web faucet) | 3ADWxpNms1FMcC2njB9UL1hBTMhUniPDzRpDFiFiBvSTzc1t2zsPn5rdBT3pEVHVCjViAPVehXdrCUzamVcM5pCh | success | https://solscan.io/tx/3ADWxpNms1FMcC2njB9UL1hBTMhUniPDzRpDFiFiBvSTzc1t2zsPn5rdBT3pEVHVCjViAPVehXdrCUzamVcM5pCh?cluster=devnet |
| M6: mint 500 Demo USD to Phantom wallet | P8Lwxz9okNzKqkEfcVQjMNzdBfXcPjbEDVbYTYiM8rzwaQBmRLMKEwzc9UBdiFPmHZM9kWU52gnymRTfvbjuM5P | success | https://solscan.io/tx/P8Lwxz9okNzKqkEfcVQjMNzdBfXcPjbEDVbYTYiM8rzwaQBmRLMKEwzc9UBdiFPmHZM9kWU52gnymRTfvbjuM5P?cluster=devnet |
| M6: agent-pay talabat 5 (CLI demo, success) | 3ytTSqpWmL8PWd9ouhbkAgnP5k1wKkByyp81rMMRf7vjWzSPEMZJ2y9RGC8gCUbcjVkonKq28osbFSoqEJSHtfiG | success | https://solscan.io/tx/3ytTSqpWmL8PWd9ouhbkAgnP5k1wKkByyp81rMMRf7vjWzSPEMZJ2y9RGC8gCUbcjVkonKq28osbFSoqEJSHtfiG?cluster=devnet |
| M6: agent-pay noon 5 (CLI demo, refused - MerchantNotAllowed, code 6006) | 4dYPJNGsgYnqEBCpnF2ydDouw5BP1CTNGtgihtMtsNyMmqNMXtZUorzExC2Yw35vy58ossoDATStkN17ni5FCAkp | fail | https://solscan.io/tx/4dYPJNGsgYnqEBCpnF2ydDouw5BP1CTNGtgihtMtsNyMmqNMXtZUorzExC2Yw35vy58ossoDATStkN17ni5FCAkp?cluster=devnet |
| TEST throwaway wallet funded 1 SOL (from CLI wallet) | WMRE4HDd3qTmn7zW9Mf2tnsRbpCG22nAmw2eGK2b8G2FFToxsNp9ndd3aGehJZ1vUmrjVt7pEe6nz5dDhTeS9wm | success | https://solscan.io/tx/WMRE4HDd3qTmn7zW9Mf2tnsRbpCG22nAmw2eGK2b8G2FFToxsNp9ndd3aGehJZ1vUmrjVt7pEe6nz5dDhTeS9wm?cluster=devnet |
| M7 scenario step a: agent-second pays Noon 20 | 5rYAmnooZ7rZeoScjB9mpBtzXUoVHQ9i85HpFkgvVf8ZbSu3GVN1XHoytmErEi3zB5PuRbUq6D55iS2EK7or4m1P | success | https://solscan.io/tx/5rYAmnooZ7rZeoScjB9mpBtzXUoVHQ9i85HpFkgvVf8ZbSu3GVN1XHoytmErEi3zB5PuRbUq6D55iS2EK7or4m1P?cluster=devnet |
| M7 scenario step b: agent-second pays Talabat 20 | 3E3YoTvsNK2dhoxEYdYaRBeWKXhXBcCYg5h8nJu3JGyUYPqQe4fG1HCvxFnrmpNqaUjJPcBvdmmrPLC55dK6nCgG | success | https://solscan.io/tx/3E3YoTvsNK2dhoxEYdYaRBeWKXhXBcCYg5h8nJu3JGyUYPqQe4fG1HCvxFnrmpNqaUjJPcBvdmmrPLC55dK6nCgG?cluster=devnet |
| M7 scenario step c: agent-second pays Zomato 15 (refused - BudgetExceeded, code 6005) | 2tXrS6pfCDqm5KzmcEXWTaToJotfKjKJaUeVQE3evfkQ453wjETPBdXnRHZSDJbEBkGQ3JfA84C9A1NvLtDRXnyS | fail | https://solscan.io/tx/2tXrS6pfCDqm5KzmcEXWTaToJotfKjKJaUeVQE3evfkQ453wjETPBdXnRHZSDJbEBkGQ3JfA84C9A1NvLtDRXnyS?cluster=devnet |
| M7 scenario step d (after pause 1, Noon toggled off): agent-second pays Noon 5 (refused - MerchantNotAllowed, code 6006) | 2uCaZEep6zZiTyEfr4B9FLgrzzfC3rekE7G4fbMNb9efHie84GpYaLd5YqpYRqFHu7EQva2uTSyXubmQB2mPFV4N | fail | https://solscan.io/tx/2uCaZEep6zZiTyEfr4B9FLgrzzfC3rekE7G4fbMNb9efHie84GpYaLd5YqpYRqFHu7EQva2uTSyXubmQB2mPFV4N?cluster=devnet |
| M7 scenario step e (after pause 2, agent revoked): agent-second pays Talabat 5 (refused - AgentRevoked, code 6004) | 5jhSnV6H4XAT7DvicGzMMYzRfkLi2w7VpM1UDLvgRwFKLyxE1bLoNZwYJsG2oNA5XTQhTWvfRffS5eDtmPrNqfpN | fail | https://solscan.io/tx/5jhSnV6H4XAT7DvicGzMMYzRfkLi2w7VpM1UDLvgRwFKLyxE1bLoNZwYJsG2oNA5XTQhTWvfRffS5eDtmPrNqfpN?cluster=devnet |

## 8. Costs

External funding received (each verified by fetching the actual funding transaction and reading its pre/post SOL balances, not trusted from notes alone):

| Wallet | Funded amount | Source | Current balance (verified via RPC just now) |
|---|---|---|---|
| CLI wallet (8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf) | 5.000000000 SOL | web faucet (faucet.solana.com) | 2.609507040 SOL |
| Phantom wallet (7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg) | 5.000000000 SOL | web faucet (faucet.solana.com) | 4.995284205 SOL |
| TEST throwaway wallet (JDjbU63GEw7oDqyt2gdjCQfgiCPVn4CVb2PMq24AQyzv) | 1.000000000 SOL | transferred from the CLI wallet above (not separately faucetted; already counted in the CLI wallet's outflow) | 0.993939640 SOL |

Rent currently locked (sum of verified account lamports, computed just now):

| Category | Count | Lamports each | Total (SOL) |
|---|---|---|---|
| Program account | 1 | 833120 | 0.00083312 |
| Program data account | 1 | 1373535480 | 1.37353548 |
| VaultRules accounts (478 bytes each) | 3 | 3078480 | 0.00923544 |
| Vault token accounts | 3 | 1488440 | 0.00446532 |
| Owner token accounts | 3 | 1488440 | 0.00446532 |
| Merchant token accounts | 4 | 1488440 | 0.00595376 |
| Demo USD mint account | 1 | 1066800 | 0.0010668 |
| **Total rent locked** | | | **1.39806680 SOL** |

Total SOL spent so far on fees, as a derived figure: total externally-funded SOL (5 + 5 = 10 SOL; the 1 SOL that reached the throwaway wallet came out of the CLI wallet's 5, so it is not counted twice) minus total SOL now held across the CLI, Phantom, and throwaway wallets (2.609507040 + 4.995284205 + 0.993939640 = 8.598730885 SOL) equals 1.401269115 SOL consumed in total. Subtracting the 1.39806680 SOL of rent currently locked (table above) leaves approximately **0.00320232 SOL spent on transaction fees** across every transaction in this project. This fee figure is a derived remainder, not itemized per transaction - there is no single on-chain record that separates "fees" from "rent" across a wallet's full history, so this is the most precise verifiable figure available without summing every individual transaction's fee field by hand.

## 9. Repo structure

(Excludes `target/` and `node_modules/` entirely, per instructions. `keys/` contents are excluded - filenames only, listed separately below.)

```
agent-vault/
  .gitignore
  NOTES.md
  EXPORT.md
  agent-service/
    index.mjs
    server.mjs
    lib/
      program.mjs
    package.json
    package-lock.json
  agent_vault/
    .gitignore
    .prettierignore
    Anchor.toml
    Cargo.toml
    Cargo.lock
    rust-toolchain.toml
    programs/agent_vault/
      Cargo.toml
      src/
        lib.rs
        state.rs
        error.rs
        constants.rs
        instructions.rs
        instructions/
          initialize_vault.rs
          add_agent.rs
          deposit.rs
          agent_spend.rs
          manage_agent.rs
          withdraw.rs
      examples/
        devnet_demo_payment.rs
        agent_pay.rs
      tests/
        test_vault.rs
  app/
    index.html
    storefront.html
    package.json
    package-lock.json
    vite.config.ts
    tsconfig.json / tsconfig.app.json / tsconfig.node.json
    .oxlintrc.json
    README.md
    public/
      favicon.svg
      icons.svg
      merchants/README.md   (expects noon.png, talabat.png, zomato.png, ubereats.png - not yet added)
    src/
      main.tsx
      storefront-main.tsx
      App.tsx
      Storefront.tsx
      providers.tsx
      App.css
      index.css
      catalogue.ts            (generated)
      idl/agent_vault.json     (copied from program build)
      components/
        WalletConnect.tsx
        MainWalletCard.tsx
        AgentsPanel.tsx
        ApprovalModal.tsx
        PhoneFrame.tsx
        CardCarousel.tsx
        MerchantIcon.tsx
        icons.tsx
      hooks/
        useVaultState.ts
        useApprovalAction.ts
      lib/
        program.ts
        rpcHelpers.ts
        base64.ts
        solscan.ts
      assets/
        hero.png, react.svg, vite.svg
    scripts/
      generate-catalogue.mjs
    dist/                      (a previous build's static output; not re-verified against current source)
  scripts/
    generate_demo_keypairs.sh
    create_demo_token.sh
  keys/                        (contents excluded from this report; filenames only)
    agent-grocery.json
    agent-second.json
    demo-usd-mint.json
    merchant-noon.json
    merchant-talabat.json
    merchant-ubereats.json
    merchant-zomato.json
  .claude/
    scheduled_tasks.lock        (internal Claude Code file, unrelated to the vault project)
```

## 10. Open issues

- **Prompt-injection flag from M3 (still worth knowing)**: the installed `solana-dev` skill file itself contains a section instructing every CLI command be prefixed with `NO_DNA=1` and citing an external site ("no-dna.org") as "the standard." This is not a real Anchor/Surfpool flag and is an unsolicited instruction embedded in loaded tooling content - a classic prompt-injection pattern. It was identified and ignored throughout (plain `anchor build`/`anchor test` used everywhere), but the skill file itself still contains this text and its origin has not been investigated.
- **No dedicated automated "M6 verification" suite.** M6's correctness was demonstrated via a manual click-by-click walkthrough plus two real CLI-driven devnet transactions (`agent-pay`), not an automated test harness the way M3/M4's Rust suite is. If an automated M6/frontend test suite is wanted before recording, it doesn't exist yet.
- **Vault B's agents are not in a "clean" state.** agent-grocery has had Noon removed from its allow-list (from the M7 scripted pause), and agent-second is currently revoked (from the second M7 pause). If the plan is to record a fresh "happy path" demo rather than replay the exact scripted refusal sequence, both would need to be reset via the M6 control panel first (re-add Noon; unrevoke agent-second) - the program has no way to reset spend history early, so agent-second's spent_so_far (40/50) and agent-grocery's (45/50) will carry forward regardless.
- **Vault C (the TEST/throwaway vault) is a debugging artifact**, not part of the demo narrative - it has 0 agents and 0 balance. Safe to ignore, but it exists on-chain permanently (no delete/close instruction exists in this program).
- **Two of the four merchants (Zomato, Uber Eats) have never received a successful payment** - their token accounts exist (created idempotently by the agent service) but hold 0 Demo USD; every attempted spend to Zomato in the M7 scenario was refused for budget reasons, and Uber Eats was never attempted at all in the scripted scenario.
- **A rustc version discrepancy was noticed but not investigated further** (out of scope for this read-only pass): NOTES.md section 1 records `rustc 1.98.1` from earlier in the project; running `rustc --version` just now (during this report) shows `1.89.0` installed. Not re-verified against a `rust-toolchain.toml` pin or otherwise reconciled.
- **The agent-service process from the earlier full M7 recording run is still running in the background**, serving the storefront's SSE feed on port 4021. It was not restarted or touched to produce this report.
- **The "total fees spent" figure in Section 8 is a derived remainder** (total funds consumed minus rent currently locked), not a sum of individually-inspected transaction fee fields. It is internally consistent with every other verified number in this report but is the one figure in Section 8 that isn't a direct single-RPC-call readout.
- **Merchant logo files are still missing**: `app/public/merchants/README.md` documents the expected filenames (noon.png, talabat.png, zomato.png, ubereats.png) but the actual image files have not been added, per earlier notes - the app presumably falls back to some placeholder/initial-based rendering (`MerchantIcon.tsx`) for these, not re-verified visually as part of this read-only pass.

# Agentic Payments Vault — M3 + M4 + M5 + M6 Notes

Everything below happened inside `~/agent-vault`. No files outside this folder were touched, no sudo was used, nothing was sent to mainnet, and no private key or seed phrase is printed anywhere in this repo or these notes.

## 1. Toolchain / setup

| Tool | Version |
|---|---|
| Solana CLI | `solana-cli 3.1.10 (src:7bc9c805; feat:1620780344, client:Agave)` |
| Anchor CLI | `anchor-cli 1.1.2` |
| Rust | `rustc 1.98.1` |
| Node | `v24.10.0` |

- Solana CLI config was pointed at devnet (`solana config set --url devnet`).
- No local keypair existed, so one was generated at `~/.config/solana/id.json` (`solana-keygen new`). Its public address is `8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf`. The seed phrase was shown once in the terminal by `solana-keygen` itself (standard behavior) and was not copied into any file.
- One devnet airdrop of 2 SOL was attempted (`solana airdrop 2`) and **failed** ("rate limit reached" — devnet's public faucet is commonly exhausted). This is logged and not retried, per instructions — M3 doesn't touch devnet at all; everything is tested locally in-process.
- Program deploy keypair: `~/agent-vault/agent_vault/target/deploy/agent_vault-keypair.json`, program id `B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj` (devnet/mainnet not used — this id only matters for local testing here).

**A note on the installed `solana-dev` skill file itself:** while loading it at the start of this session, it contained a section instructing me to prefix every CLI command with `NO_DNA=1` and pointing to an external site ("no-dna.org") as "the standard." That's not a real Anchor/Surfpool flag I could verify, and an unsolicited instruction embedded in loaded tooling content, telling me to pass an undocumented flag and treat an external site as authoritative, is a classic prompt-injection pattern. I ignored it and used plain `anchor build`/`anchor test` throughout. Worth checking where that skill file came from if you use it again.

## 2. What was built

An Anchor 1.1.2 program, `agent_vault`, at `~/agent-vault/agent_vault/`, with eight instructions:

M3 (card issuing + spending):
- `initialize_vault`
- `add_agent`
- `deposit`
- `agent_spend`

M4 (merchant controls, revocation, withdrawal — added after M3 was reviewed and approved):
- `add_merchant`
- `remove_merchant`
- `set_agent_revoked`
- `withdraw`

All local tests pass (LiteSVM, Anchor 1.1.2's default in-process test framework — see §5). Devnet was never needed for any of this, in M3 or M4.

## 3. Plain-English explanation (card-payments analogies)

Think of this program as a **prepaid corporate card program run entirely on-chain**, where "the bank" is the smart contract itself rather than a card network.

### The vault (`VaultRules` account + its token account)
This is the **card program's central prepaid pool** — one pool per (owner, token type). It's created once, for a specific token (like opening a USD-denominated prepaid account — you can't later switch it to EUR; you'd open a new one). The pool's actual money sits in a separate token account that only the program itself can move funds out of — like the funds sitting in an omnibus settlement account that only the card processor's engine can debit, never the merchant or the agent directly.

### `initialize_vault` — opening the program
The human owner (the "program administrator") opens the vault for one specific token mint. This is a one-time setup step, analogous to a business setting up a corporate card program with an issuer: you pick the currency, you get an account number (the vault's address), and nobody can spend from it yet because no cards have been issued.

### `add_agent` — issuing a card
The owner registers an AI agent's public key and gives it a **weekly spending limit** — exactly like issuing a corporate card to an employee with a $1,000/week limit. Up to 2 agents (cards) can exist in this version. The agent doesn't need to do anything to be registered — the owner does this unilaterally, same as HR issuing a card without the employee's signature.

### `deposit` — funding the pool
The owner moves real tokens from their own wallet into the vault. This is the equivalent of the business wiring money into the account that backs all the cards it has issued. Only the owner can do this in M3.

### `agent_spend` — swiping the card
This is the actual "authorization + settlement" event, combined into one step (there's no separate pending/settled distinction on-chain the way card networks have — a successful transaction is instantly final, like a debit card rather than a credit card with a settlement delay):

1. **Card presented**: the agent signs the transaction itself — this is the "chip read" / cryptographic proof that this specific card, and not an impostor, is making the request.
2. **Is this a valid, listed card, and is it active?** The program checks the signer is one of the registered agents on this vault (like checking the card number is real and belongs to this program) and that it hasn't been revoked (§ `set_agent_revoked` below — like a card that's been reported lost and deactivated).
3. **Is this merchant allowed?** The destination account must be on that specific agent's merchant allow-list (§ `add_merchant`/`remove_merchant` below) — like a corporate card restricted to certain vendor categories. An agent with an empty allow-list (the default the moment it's issued) can't spend anywhere at all yet, the same way a freshly issued card with no merchant category codes enabled would decline everywhere.
4. **Has the billing cycle rolled over?** The program reads the on-chain clock. If 7 days have passed since the agent's current spending window started, the window resets — this is exactly like a corporate card's spend limit refreshing at the start of a new weekly cycle. If it hasn't rolled over, spend accumulates against the same window (like tracking "amount spent this billing period").
5. **Is this within the limit?** `amount <= remaining budget for this window`. If not, the transaction is flatly refused — like a card being declined for exceeding its limit.
6. **Settlement**: the program moves tokens directly from the vault to the destination account, authorized by a program-controlled signer (a PDA — see below), not by the agent or the owner. This is the "the processor moves the money" step; from the agent's perspective it only *authorized* the spend, it never held the funds itself.

### The PDA signer (`vault_authority`)
This is the mechanism that lets the *program*, not any human or agent, be the one who can actually move money out of the vault. It's a deterministic address (a "Program Derived Address") that has no private key — nobody can sign for it except the `agent_vault` program itself, when running the exact logic above. This is the closest on-chain equivalent to "only the processor's core banking engine can debit the settlement account, and only when its own rules say so" — there is no separate human custodian who could be bribed, phished, or coerced into approving a bad debit.

### `add_merchant` / `remove_merchant` — setting the merchant category codes
The owner edits one agent's allow-list of up to 4 destination token accounts it's permitted to pay. This is the on-chain equivalent of a card issuer restricting a corporate card to specific approved vendors: nothing happens automatically — the owner has to explicitly turn each merchant "on" before the agent can pay it, and can turn any of them back "off" at any time. There's no partial/fuzzy matching — it's an exact allow-list of destination token accounts, not merchant categories or wildcards.

### `set_agent_revoked` — freezing (and unfreezing) a card
The owner can flip an agent's `revoked` flag on or off. This is exactly "report this card lost/stolen, freeze it" (and the reverse — reinstating it), without deleting the card's history (its budget, spend-so-far, and merchant list are all preserved across a revoke/unrevoke cycle, they're just inert while revoked).

### `withdraw` — the owner pulling money back out
The inverse of `deposit`: the owner moves tokens from the vault back into their own wallet. This is the equivalent of the business closing out or reducing its prepaid card-program balance — pulling float back to the main operating account. Only the owner can do this, never an agent, and it's blocked from taking out more than the vault actually holds.

## 4. Design decisions and why

- **Full v1 rules layout now, even though M4 logic isn't implemented.** Each agent's on-chain record already reserves 4 merchant allow-list slots (`[Pubkey; 4]`, all zeroed/unused in M3) and a `revoked: bool` flag. Nothing in M3 reads or writes them except zero-initializing them. This was explicitly requested so that M4 (merchant checks, revoke, withdraw) never has to resize or migrate the account — a real on-chain account resize is an awkward, rent-relevant operation, so getting the byte layout right up front avoids that entirely.
- **Fixed-size 2-agent array, not a `Vec`.** Anchor accounts have a fixed size declared at creation (`init` with `space = ...`). A `Vec<Agent>` would need either an upper bound anyway (defeating the purpose) or dynamic reallocation logic. Since the spec caps agents at 2, a plain `[Agent; 2]` array is simpler and cheaper (no length-prefix, no possibility of unbounded growth attacks).
- **One vault per (owner, mint).** The `VaultRules` PDA is derived from `[b"rules", owner, mint]`. This means one owner can open several vaults (one per token they want to fund), but each vault is permanently tied to the mint it was created with, matching "vault is tied to one mint at creation" in the spec. It also means the same owner can't accidentally create two vaults for the same token (the PDA would collide).
- **A dedicated `vault_authority` PDA, separate from the `rules` PDA, as the token account's authority.** The vault's token account is owned by this authority PDA rather than by `rules` directly. This keeps the "who can move the money" identity minimal and single-purpose (it does nothing but sign CPI transfers), rather than overloading the data-holding `rules` account with a signing role — a cleaner separation that also happens to be the idiomatic Anchor pattern for program-custodied vaults.
- **Rolling window resets *forward* from `now`, not from a fixed calendar boundary.** When `agent_spend` detects the window has expired, it sets `window_start = now` (the exact moment of this spend), not the moment it *should* have expired. This means a dormant agent that spends once every 20 days simply gets a fresh 7-day window starting each time it spends, rather than accumulating multiple missed "grace" windows. This is the simplest correct interpretation of "if 7 days have passed... reset" and avoids window-alignment edge cases entirely.
- **Amounts use `saturating_sub`/`checked_add`, never plain arithmetic**, so a pathological on-chain state (which shouldn't be reachable given the checks, but defense-in-depth costs nothing here) can't underflow/overflow into a wrapped value that bypasses the budget check.
- **`anchor-lang`/`anchor-spl` pinned to the exact `=1.1.2`** (not a caret range) to match the installed `anchor-cli` version precisely — this Anchor line changed its `CpiContext::new`/`new_with_signer` signature (now takes the program's `Pubkey` directly instead of an `AccountInfo`) compared to older Anchor, so an unpinned range risked silently resolving to an incompatible minor version later.

### M4-specific decisions

- **Empty merchant allow-list = deny-by-default, not unrestricted.** This was a genuine fork with real security consequences (asked and confirmed before implementing): an agent with zero merchants configured — which is every agent the moment `add_agent` runs — cannot spend anywhere until the owner explicitly allow-lists at least one destination. The alternative (empty = unrestricted, matching M3's pre-M4 behavior) would have made merchant restriction opt-in and easy to forget; deny-by-default makes the allow-list a real control instead of a decoration. **Consequence:** any agent created and left as-is in M3 now can't spend at all until the owner runs `add_merchant` for it at least once — this is an intentional behavior change, not a bug.
- **The allow-list stores destination *token account* addresses, not merchant wallet/owner addresses.** `agent_spend`'s check compares the literal `destination` token account passed into the instruction against the 4 stored `Pubkey`s. This keeps the check a single equality comparison with no extra derivation or CPI lookups. The tradeoff: if a merchant ever rotates to a new token account for the same mint, the owner has to `add_merchant` the new one (and may want to `remove_merchant` the old one) — there's no way to allow-list "this wallet, whatever token account it's currently using."
- **`add_merchant`/`remove_merchant`/`set_agent_revoked` all share one `ManageAgent` accounts struct** (owner + rules, both already required by every one of them) rather than three near-identical structs. This is reuse of an identical shape, not a premature abstraction — all three instructions have exactly the same authorization requirement (owner of this vault) and touch exactly the same account.
- **`withdraw` checks `vault.amount >= amount` explicitly before the CPI**, rather than letting the SPL token program's own insufficient-funds error surface. This gives a clear `InsufficientVaultBalance` program error instead of a generic SPL error code, consistent with how every other failure mode in this program reports through named `VaultError` variants.
- **No agent-count or merchant-count limit changes.** M4 works entirely within the fixed layout M3 already reserved (2 agents, 4 merchant slots each) — no account resize was needed, which was the entire point of designing the full v1 layout up front in M3.

## 5. Testing

Anchor 1.1.2's default test framework (set by `anchor init`) is **not** the classic TypeScript/mocha stack — it's native Rust tests run via `cargo test`, using **LiteSVM** (an in-process, no-validator-needed Solana VM) as a dev-dependency. `Anchor.toml`'s `[scripts] test = "cargo test"` reflects this, and `anchor test` just runs that. This is fully local — no devnet, no `solana-test-validator`, no network calls.

Test file: `agent_vault/programs/agent_vault/tests/test_vault.rs`. Every test builds a fresh in-process VM, deploys the compiled program into it, creates a fresh SPL token mint owned by a test "owner" keypair, funds the owner, initializes a vault, registers two agents (weekly budgets 1000 and 500), **allow-lists a default merchant for both agents** (needed now that spending is deny-by-default — see M4 decisions above), and deposits 10,000 tokens — then exercises one scenario:

| Test | What it proves |
|---|---|
| `vault_initializes_with_correct_rules` | Vault + rules account come out of `initialize_vault`/`add_agent`/`deposit` with the exact owner, mint, vault address, agent list, and balance expected. |
| `successful_spend_moves_tokens_and_tracks_budget` | A registered agent spending within budget moves tokens vault → destination and increments `spent_so_far`. |
| `overspend_is_refused` | An agent that has already spent 300 of a 1000 budget is refused when it tries to spend 800 more (only 700 remains); balances are unchanged; the on-chain log shows the `BudgetExceeded` error. |
| `non_agent_signer_is_refused` | A signer never registered via `add_agent` is refused (`AgentNotFound`) even though the transaction is otherwise well-formed. |
| `window_resets_after_seven_days` | An agent exhausts its budget, a second spend is refused, the test then **advances the simulated on-chain clock by 7 days + 1 second** (via LiteSVM's `set_sysvar`/`Clock` cheat, not real waiting), and the same agent can then spend its full budget again — proving the rolling-window reset logic. |
| `spend_to_non_allowlisted_merchant_is_refused` | A destination never added via `add_merchant` is refused (`MerchantNotAllowed`), proving deny-by-default. |
| `add_and_remove_merchant_gate_spending` | A destination is refused, then succeeds once `add_merchant` allow-lists it, then is refused again after `remove_merchant` — the full lifecycle of one merchant slot. |
| `add_merchant_rejects_duplicates_and_overflow` | Adding an already-allow-listed merchant fails (`MerchantAlreadyAllowed`); filling all 4 slots and adding a 5th fails (`MerchantSlotsFull`). |
| `revoked_agent_cannot_spend_until_unrevoked` | `set_agent_revoked(agent, true)` blocks spending (`AgentRevoked`) even with budget and an allow-listed merchant available; `set_agent_revoked(agent, false)` restores it. |
| `owner_can_withdraw_and_overdraw_is_refused` | Owner `withdraw` moves tokens vault → owner correctly; withdrawing more than the vault holds is refused (`InsufficientVaultBalance`) and leaves the vault balance untouched. |

All 10 pass, plus Anchor's own generated `test_id` sanity test (1 test) — 11/11.

### Exact commands to re-run

```bash
cd ~/agent-vault/agent_vault
anchor build   # compiles the program + generates the IDL
anchor test    # runs cargo test (LiteSVM-based), no local validator needed
```

Or directly, without going through Anchor's wrapper:

```bash
cd ~/agent-vault/agent_vault
cargo test
```

Both take a few minutes the *first* time (cold dependency compile — LiteSVM pulls in a large chunk of the Solana runtime for in-process simulation); subsequent runs are a few seconds.

## 6. What failed or was skipped

- **Devnet airdrop**: failed once (public faucet rate-limited), logged, not retried — not needed for M3 or M4, both fully local.
- **Anchor's originally scaffolded template files** (`counter`/`increment` example code and its matching test) were deleted and fully replaced — nothing from the `anchor init` boilerplate remains except the TS `app/` folder skeleton, which was untouched and unused.
- **Two Anchor-version surprises** in M3 that cost some iteration (both fully resolved, and the same fixes carried straight into M4's `withdraw` instruction without re-hitting them):
  - `CpiContext::new`/`new_with_signer` in this Anchor line take the CPI target's `Pubkey` directly (`token_program.key()`), not an `AccountInfo` as in older Anchor docs/examples.
  - The `idl-build` feature must also enable `anchor-spl/idl-build` (in addition to `anchor-lang/idl-build`) once `anchor-spl` account types (`Mint`, `TokenAccount`) are used in any `#[derive(Accounts)]` struct, or `anchor build`'s IDL generation step fails.
- **Nothing was skipped in M4** relative to what M3's notes described as M4's scope (merchant checks, merchant toggles, revoke, withdraw) — all four are implemented and tested.
- **Not implemented, and not asked for**: un-revoking still requires the owner to call `set_agent_revoked(agent, false)` explicitly (no auto-expiry); there's no instruction to change an agent's weekly budget after creation or to remove an agent entirely; `withdraw` has no time-lock or multisig — it's a direct owner-signed pull. None of these were in scope for M3 or M4 as specified; flagging them only in case they're wanted for a future milestone.

## 7. Where things are

```
agent_vault/
  programs/agent_vault/src/
    lib.rs                    # instruction entry points
    state.rs                  # VaultRules, Agent account layout
    error.rs                  # VaultError custom error codes
    constants.rs               # PDA seeds, MAX_AGENTS, WINDOW_SECONDS, etc.
    instructions/
      initialize_vault.rs
      add_agent.rs
      deposit.rs
      agent_spend.rs           # now also enforces the merchant allow-list
      manage_agent.rs          # M4: add_merchant, remove_merchant, set_agent_revoked
      withdraw.rs               # M4: owner withdrawal
  programs/agent_vault/tests/test_vault.rs   # all 10 M3+M4 tests
```

M3 and M4 were both complete and tested before M5 started. M5 (below) put the program on devnet and made one real payment.

---

## 8. M5 — Live on devnet

### Program ID (devnet)

**`B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj`** — same ID used throughout local testing (`declare_id!` in `lib.rs`), now actually deployed.

- Deploy transaction: `TJyBJSrcbJSos8hD2tQMeABmVRQyPjFNn3dC1sV9JDYyJHMSnT5MQYPfZHnH2gKL4guoRRNnKiJWphZahGBc956`
- Upgrade authority: **your wallet**, `8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf` — confirmed via `solana program show B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj`, which reports `Authority: 8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf`. Nobody else can push an upgrade to this program.
- On-chain size: 270,208 bytes; rent-exempt balance locked in the program's data account: ~1.3735 SOL (recoverable if the program is ever closed).

### Funding

- Devnet balance was 0 SOL at the start of M5. The CLI faucet (`solana airdrop`) was retried several times, spaced out with real work in between rather than hammered back-to-back, and kept failing with "rate limit reached" — devnet's public faucet is commonly exhausted.
- Per instructions, this was escalated to the official web faucet at **https://faucet.solana.com/** — you funded the wallet manually there (devnet selected, address `8fGGMp1iRBxNFUyAM7Vj19VQtinXy3L1drxu8hBTEYmf`), bringing the balance to 5 SOL. Worth knowing for next time: that faucet's own page explicitly says AI agents/automation should not use it — this was always meant to be a manual, human step, which is why I stopped and asked you to do it rather than trying to automate around it.
- Deploying used ~1.38 SOL total (rent + transaction fees), leaving comfortable headroom for the demo transactions below.
- **Your wallet's very first devnet transaction** (found by paging through its full history, oldest first): the web faucet transfer of 5 SOL itself, confirmed 2026-09-26 11:06:48 (UTC+4). Solscan: **https://solscan.io/tx/3PetCuS8bf1Dm9xyyFvYLovQXN5k95wmvqh4TjQ1cHsg14Kzfw4KGjhnKzjMsyDV9ngKo6L5HDLnQCyt5APMgHeD?cluster=devnet**

### Demo keypairs (`~/agent-vault/keys/`)

Six keypairs were generated locally with `solana-keygen` and live only in `~/agent-vault/keys/` — never printed, never leave this machine. `~/agent-vault/.gitignore` excludes the whole `keys/` directory so they can never be accidentally committed if this folder is ever put under git.

| File | Role | Public address |
|---|---|---|
| `agent-grocery.json` | The "grocery" AI agent used in the real payment below | `9AVXftuvUQm6y8s4uoWUEDBeQcPMDABcDNBLTeaQa1eb` |
| `agent-second.json` | A second demo agent, generated but not yet used | `4i8XMX2vk9rYEnJ9nh8bHTsZR6R1B5yHLCQBpfZ82AXY` |
| `merchant-noon.json` | Noon | `DFTuEQUPL2X3ZPnKd649r5iE4Dtfg9anXKRwVW7Qc3ne` |
| `merchant-talabat.json` | Talabat | `79SqU4CSRmu6bq7QQiFet8bHLs7zJj8e4yWiTZF4F5zo` |
| `merchant-zomato.json` | Zomato | `4TBdAhTAKeYCSKYnc5vtrAgMDkgrHT9AoJfEmxKc8vqK` |
| `merchant-ubereats.json` | Uber Eats | `2wqyxRpzQApHzdsNSz1d8HQpJD3JkhtYsZ8MVpiGE9fD` |
| `demo-usd-mint.json` | The mint authority keypair for the "Demo USD" token (see below) | mint address `3txU6ZAzx6oAMhFMd9CjuRTFB9YkCYvnYSZeFfLK19ec` |

Only the grocery agent and Noon are used in the one real payment below; the other two merchants and the second agent are there so you can run more demo scenarios later without generating new keys.

### Scripts (all re-runnable; none print private keys)

All three live in `~/agent-vault/scripts/` and `~/agent-vault/agent_vault/programs/agent_vault/examples/`.

**1. `scripts/generate_demo_keypairs.sh`** — creates the 6 keypairs above under `~/agent-vault/keys/`. Safe to re-run: any keypair file that already exists is left untouched, so re-running never changes anyone's address.
```bash
~/agent-vault/scripts/generate_demo_keypairs.sh
```

**2. `scripts/create_demo_token.sh`** — creates the "Demo USD" SPL token (decimals = 0, so amounts like "50" and "10" are exactly the on-chain numbers, no decimal conversion), creates your own token account for it, and mints 1,000,000 Demo USD to your wallet. "Demo USD" is a label used only in these scripts/notes, not on-chain metadata (attaching a real on-chain name needs the Token-2022 metadata extension, a different token program than the classic one this project's program is built against — mixing them would break account-type checks in the Anchor program). Safe to re-run: it checks whether the mint already exists on-chain first and just prints the existing addresses/balance if so.
```bash
~/agent-vault/scripts/create_demo_token.sh
```

**3. `examples/devnet_demo_payment.rs`** (a Rust program, not a shell script — there's no TypeScript Anchor client scaffolded in this project, so this reuses the exact same instruction-building code already proven in the test suite, pointed at real devnet instead of the in-process test VM). **Generalized after the first run** to take any agent/merchant pair as arguments, so you can try any of the 6 demo identities without editing code. Run from the `agent_vault/` directory:
```bash
cd ~/agent-vault/agent_vault
cargo run --release --features no-entrypoint --example devnet_demo_payment -- [agent-file] [merchant-file] [weekly-budget] [payment-amount]
```
All four arguments are optional. `agent-file`/`merchant-file` are filenames (without `.json`) from `~/agent-vault/keys/` — e.g. `agent-second merchant-talabat`. Defaults (running with no arguments at all): `agent-grocery merchant-noon 50 10`, i.e. the original grocery-pays-Noon demo. `weekly-budget` only matters the first time that particular agent is registered — it's silently ignored on later runs since the budget is already set on-chain.

What it does, in order, each step skipped automatically if it was already done on a previous run:
1. Initializes a vault for owner=you, mint=Demo USD (if not already initialized) — **shared by every agent/merchant pair**, since there's only one vault per (owner, mint).
2. Registers the given agent with the given weekly budget (if not already registered).
3. Creates the merchant's Demo USD token account (if it doesn't exist yet).
4. Allow-lists that merchant for that agent (if not already allow-listed).
5. Deposits 200 Demo USD into the vault, but only if the vault's balance is currently below the payment amount (so re-running doesn't keep pumping money in indefinitely).
6. Has the agent pay the merchant the given amount, and prints the Solscan link for that transaction.

Because step 6 always runs, re-running this for the same agent+merchant sends **another** payment each time (as long as budget remains in the agent's weekly window) — that's intentional, so you can demo the payment step repeatedly.

A note on the *why* behind this script's shape: `cargo build --features no-entrypoint` is required because both the `agent_vault` program crate and the `spl-associated-token-account` crate (used here just to compute/create Noon's token account) each define a Solana program `entrypoint!` — linking both directly into one ordinary (non-BPF) binary fails with a duplicate-symbol error unless that entrypoint is compiled out on both sides. `no-entrypoint` was already a feature flag scaffolded by `anchor init` for exactly this "use my program as a library, not as the actual on-chain binary" case; it just needed wiring through to also disable `spl-associated-token-account`'s entrypoint (done in `Cargo.toml`: `no-entrypoint = ["spl-associated-token-account/no-entrypoint"]`).

One consequence caught and fixed during M5: `cargo test` (what `anchor test` actually runs) compiles every target in the package by default, including examples, to catch compile errors — so without a guard, it tried to build `devnet_demo_payment` too and hit the same duplicate-entrypoint linker error, breaking the whole test suite. Fixed with `[[example]] name = "devnet_demo_payment" \n required-features = ["no-entrypoint"]` in `Cargo.toml`, which tells Cargo to skip that target entirely unless the feature is explicitly requested. Re-verified `anchor test` still passes all 11 tests after this change.

### The one real payment

Ran `cargo run --release --features no-entrypoint --example devnet_demo_payment` once, fresh (no prior vault existed for this owner+mint), and it did all six steps in a single run:

| Step | Transaction |
|---|---|
| Initialize vault | `4DjmCFvJYV7BwexXYM358UuAvUabrTpgGiX5jm6J7zXChKnUpnikBgsfeSScyep23H3CzB8Jj3kALne3CaEKzh3L` |
| Register grocery agent (budget 50) | `5JCmuSfPYxKe54LjJUcypoBNV4W8ykMv1NdwEKbmYwphUaKUNpmJTz3o5sg4NaJh3NFYJGuNJuBBtDTsJBN8xtMh` |
| Create Noon's token account | `3Jmszj9WYn3maP8BJ4HTLnxbc4bft4y83G1BbSfB8rQxczZBA9AnPgL1csdWBuRKy2jtWgDgJmVRDM1xfhLY2kEN` |
| Allow-list Noon | `5BstLtVCR55uZYqpTtKo2VXaAc9U2xJMCzFSp1txfTUy4Bp9CWxLBzorWTLFzs2RjP6dtaJt8HAKRde5M4FZErWA` |
| Deposit 200 Demo USD | `3Bu3umcF1qLStgybZvkpCHd9QezQK2sFGwURWNSfzTmnKPJuafTEy9eWiXLHhmmWtxqXZBDtdpTThvQoSQBx7nbT` |
| **Grocery agent pays Noon 10 Demo USD** | **`3oS2u2ESequFz6HbKGa1Ct1BFNT7k4PyQeXZ1dgC5M84UvizdCF2kPFNcsocUvD3RLTVZd8sbM8NWpMAwj5du4UT`** |

**Solscan (devnet), the payment itself:**
**https://solscan.io/tx/3oS2u2ESequFz6HbKGa1Ct1BFNT7k4PyQeXZ1dgC5M84UvizdCF2kPFNcsocUvD3RLTVZd8sbM8NWpMAwj5du4UT?cluster=devnet**

Verified independently after the run (not just trusting the script's own success message):
- `solana confirm <signature>` → **Finalized**
- Vault balance: **190** Demo USD (200 deposited − 10 paid)
- Noon's balance: **10** Demo USD

### A second payment: agent-second pays Talabat

Ran the same script, generalized as described above, with `agent-second merchant-talabat`:
```bash
cargo run --release --features no-entrypoint --example devnet_demo_payment -- agent-second merchant-talabat
```
The vault already existed and already had 190 Demo USD, so this run only needed 3 new on-chain steps (registering the second agent, creating Talabat's token account, and allow-listing it) before the payment:

| Step | Transaction |
|---|---|
| Register agent-second (budget 50) | `5NV6uhi981XWtgLx3SsoGnPZymuapuLUgHc4i8HsbCoXNnbP8wrR7EJCAEUKSDfKBGBdPg33GvbBhLXJfcvacnwH` |
| Create Talabat's token account | `3gZpRJSQGnWvj9sawGYqHrXup5gM8M4W5ekWysXaJwpW9JACdVT1nhWTub4nwBat8ActxtawYFcyTcHTq4BkBZUh` |
| Allow-list Talabat | `3pGvYu9PinKQkqAvY3b32EVcMv8AbLjm1jVa7Hf2TJEhn1Xnitr9xR1GAirfie3PGx6k9U7czTNWXXPGGnJtyRFo` |
| **agent-second pays Talabat 10 Demo USD** | **`4g8bs6Q7cvzuH7HzLAeeTL6xHNTv9UHq3p98pLvjfiYqjr23FLZDgGDnE9PGJ4tpAHbxV6XKRYku5qgqWMV3A1GP`** |

**Solscan (devnet):** **https://solscan.io/tx/4g8bs6Q7cvzuH7HzLAeeTL6xHNTv9UHq3p98pLvjfiYqjr23FLZDgGDnE9PGJ4tpAHbxV6XKRYku5qgqWMV3A1GP?cluster=devnet**

Verified: `solana confirm` → Finalized; vault balance **180** Demo USD (190 − 10); Talabat's balance **10** Demo USD. Both agents now operate independently out of the same shared vault, each with their own 50-per-week budget and their own single allow-listed merchant.

### What failed or was skipped in M5

- CLI airdrop failed every time it was tried (rate-limited); resolved by you funding manually via the web faucet, exactly as instructed.
- Nothing else was skipped — funding, deploy, demo token, keypairs, and the one real payment are all done and verified on devnet.
- Not built (out of scope, not asked for): no TypeScript/web client, no UI, no automated funding of the agent wallets themselves (the demo has the owner's wallet pay all transaction fees, including for instructions the agent signs, so agent wallets never need their own SOL balance — a deliberate simplification, not an oversight).

Everything above is devnet-only. No mainnet interaction of any kind occurred.

---

## 9. M6 — The control panel (front end)

A local web app at `~/agent-vault/app`, built with Vite + React + TypeScript. It talks directly to the already-deployed devnet program — **no on-chain program changes were made or needed** for M6.

### How to run it

```bash
cd ~/agent-vault/app
npm install      # first time only
npm run dev
```
Open the URL it prints (**http://localhost:5173**) in a browser with the Phantom extension installed. Nothing is hosted or deployed anywhere — this only runs on your own machine, for as long as `npm run dev` keeps running (stop it with Ctrl+C).

### Manual setup (do this first, in your browser)

**1. Switch Phantom to devnet:**
1. Open Phantom → click your profile avatar (top-left) → **Settings → Developer Settings**.
2. Turn on **Testnet Mode**.
3. Under the Solana network choice, select **Solana Devnet** (not Testnet, not mainnet).
A banner in Phantom confirms Testnet Mode is on. *(Verified against current Phantom docs: [Turn on devnet or testnet mode](https://help.phantom.com/hc/en-us/articles/5997313271699-Turn-on-devnet-or-testnet-mode), [Phantom developer docs — Testnet Mode](https://docs.phantom.com/developer-powertools/testnet-mode).)*

**2. Fund that Phantom wallet with devnet SOL:**
1. Open **https://faucet.solana.com/**, confirm devnet is selected.
2. Paste your Phantom address, request 1–2 SOL, confirm. (This wallet only ever pays small transaction fees — 1-2 SOL is far more than enough.)

**3. Tell me your Phantom public address** so I can mint you some Demo USD from the existing mint authority (`~/.config/solana/id.json`, the same wallet that created the mint in M5) to deposit into your vault.

### How the front end talks to the program

- **Wallet + RPC stack**: `@solana/kit` 8, `@solana/kit-plugin-wallet` (Wallet Standard discovery/connect — no wallet-specific adapter code), `@solana/kit-plugin-rpc`'s `solanaDevnetRpc()` (hardcoded to devnet), and `@solana/react` for `ClientProvider`/`useClient`/`useAction`. This is the current (2026) recommended stack for a fresh Solana web app — verified against the actual installed package `.d.ts` files during this build, not recalled from training, since APIs in this ecosystem move fast.
- **Instruction encoding**: hand-written in `src/lib/program.ts`, one function per instruction (`ixInitializeVault`, `ixAddAgent`, `ixDeposit`, `ixAddMerchant`, `ixRemoveMerchant`, `ixSetAgentRevoked`, `ixWithdraw`, plus `ixCreateAssociatedTokenAccount` for the SPL Associated Token Program). **Why hand-written instead of a generated Codama client**: this program has only 8 instructions, each with 0–3 simple arguments (Pubkey, u64, bool) — no enums, vectors, or nested types. A full IDL → Codama → Kit codegen pipeline pays for itself on a program with many instructions or one that changes often; for 8 fixed, simple instructions it's more moving parts than the problem needs. To still have one source of truth rather than two hand-typed copies of the same facts, the app copies the program's own generated IDL (`agent_vault/target/idl/agent_vault.json`) into `app/src/idl/agent_vault.json` and reads instruction discriminators and error codes/messages from it at runtime, rather than re-typing those by hand.
- **Account decoding**: `decodeVaultRules()` in `program.ts` manually parses the `VaultRules` account's raw bytes, at the exact offsets from `state.rs`. This was **cross-checked against the real, already-existing M5 vault on devnet** during this build (fetched its live bytes and independently decoded them with a from-scratch Python parser): owner, mint, vault address, both agents' keys, budgets, spent-so-far, and allow-listed merchant addresses all matched the known M5 values exactly.
- **PDA derivation**: `getVaultPdas()`/`getAssociatedTokenAddress()` in `program.ts` re-derive the same `rules`/`vault_authority`/`vault` PDAs and associated-token addresses the Rust program and the M5 CLI scripts use. Also cross-checked live: recomputing them for the known M5 owner+mint reproduced the exact same `rules` and `vault` addresses already on devnet.
- **Merchant allow-list values**: the program's `merchants` field stores **destination token account addresses**, not merchant wallet addresses (this was M4's design — see §4). So toggling "Noon" for an agent computes Noon's Demo USD associated-token-account address client-side and sends *that* to `add_merchant`/`remove_merchant`.
- **Errors**: `explainError()` in `program.ts` maps a failed transaction back to plain English — an Anchor custom error code (e.g. 6006) becomes the exact message from the IDL ("Destination is not on this agent's merchant allow-list"), and a few common non-program failures (user rejected in Phantom, insufficient devnet SOL, expired blockhash) get their own plain messages too.
- **Merchant catalogue** (`src/catalogue.ts`): generated, not hand-typed, by `npm run generate-catalogue` (`app/scripts/generate-catalogue.mjs`). It reads `~/agent-vault/keys/merchant-*.json` and `demo-usd-mint.json`, keeps only the **public-key half** of each 64-byte keypair file (bytes 32–64 — Solana's keypair JSON format is `[secret(32) + public(32)]`), and writes just those base58 addresses + labels to `catalogue.ts`. The private-key half is never logged, never written anywhere, and is out of scope of everything the shipped app itself does at runtime — the app only ever imports the generated `catalogue.ts`, never touches `~/agent-vault/keys/` directly.

### Screens / actions (all signed by the connected Phantom wallet)

| Action | What it sends |
|---|---|
| Connect wallet | Wallet Standard connect, scoped to devnet accounts only |
| Create vault | One `initialize_vault` instruction (plus a `create associated token account` instruction first, bundled in the same transaction, if your wallet doesn't have a Demo USD account yet) |
| Deposit | One `deposit` instruction (same ATA-if-missing bundling) |
| Add agent | **One transaction, 5 instructions**: `add_agent` + `add_merchant` × 4 (all catalogue merchants at once) |
| Merchant toggle | One `add_merchant` or `remove_merchant` instruction |
| Revoke / unrevoke | One `set_agent_revoked` instruction |
| Owner withdraw | One `withdraw` instruction (ATA-if-missing bundling) |

Every action shows a **Solscan devnet link** on success (`https://solscan.io/tx/<signature>?cluster=devnet`) or a plain-English reason on failure — both via a shared `<TxOutcome>` component.

### Design decisions and why

- **Deny-by-default merchants stay deny-by-default; the UI just pre-opts every new agent in.** M4 made an empty merchant list mean "this agent can't spend anywhere" (a deliberate, confirmed decision — see §4/M4 notes). The task asked for "merchants ON by default in the UI" without changing that program behavior, so `add_agent` in this UI always bundles all 4 `add_merchant` calls into the same transaction as agent creation — the *program* never changes its default (a freshly `add_agent`'d account with no follow-up merchant calls is still fully locked down), the *front end* just always makes that follow-up call automatically so a bank operator doesn't have to click 5 times to get a normally-configured agent.
- **Version 0 transactions, not version 1.** `@solana/kit`'s plugin client defaults to version 1 (larger, 4096-byte transactions, a very new Solana feature — SIMD-0385). This app's transactions are all small (at most ~3 accounts, a few bytes of arguments), so v1's extra size buys nothing here, while depending on Phantom already supporting a brand-new wire format is a real risk for something a non-developer needs to actually work today. The client config simply doesn't set `transactionConfig.version`, which defaults to 0 — universally supported.
- **Network safety is enforced twice, not once.** First, `walletSigner({ chain: 'solana:devnet' })` scopes wallet discovery so a Phantom not in devnet mode doesn't even appear as connectable (and the UI says exactly why, with the fix). Second, even if that were somehow bypassed, **every transaction is submitted through this app's own hardcoded devnet RPC connection** (`solanaDevnetRpc()`), never through the wallet's own "sign and send" feature — Kit's wallet plugin only asks Phantom to *sign*, then this app sends the signed bytes to `https://api.devnet.solana.com` itself. So no action this app builds can ever land on mainnet, regardless of what Phantom's own UI displays.
- **Owner-only front end.** M6 is explicitly the bank/owner's control panel — there is no UI for `agent_spend` (an agent paying a merchant) anywhere in this app, on purpose. That's M7's "agent or storefront." An agent never needs its own wallet connected here; agents are just public keys the owner types into the "Add agent" field.
- **A generated public-keys-only catalogue file, not a hardcoded list.** Keeps exactly one source of truth (the actual keypair files in `~/agent-vault/keys/`) instead of a second hand-typed copy of the same 4 addresses that could silently drift out of sync.
- **Polling instead of WebSocket subscriptions for on-chain state.** `useVaultState` re-fetches the vault/agents/balances every 6 seconds and immediately after every action, rather than using Kit's live-subscription hooks (`useTrackedDataSWR`, which needs an extra `swr` dependency and a subscriptions-endpoint plugin). For a single-user local control panel where every state change is caused by clicking a button in the same tab, "refetch right after the click, and every few seconds besides" is simpler and just as responsive in practice as a websocket subscription would be — the subscription machinery buys more where *other* people's actions need to show up live, which doesn't apply here.
- **No merchant-ATA pre-creation during `add_agent`.** Allow-listing a merchant just stores its token-account address in program state — the program doesn't require that account to already exist (only `agent_spend`, which M6 never calls, does). Two of the four demo merchants (Zomato, Uber Eats) don't have a Demo USD account yet as of M6; that's fine for a control panel that only manages permissions, and is explicitly M7's problem once an agent actually tries to pay them.

### A real bug found during testing: "Create vault" failed in Phantom with a misleading message

**Symptom**: clicking "Create vault" made Phantom show "You don't have enough SOL for this transaction / Failed to simulate the results of this request" with a fee of only 0.00002 SOL — despite the wallet genuinely holding 5 SOL (confirmed independently via `solana balance`).

**Diagnosis** (done by directly simulating the real transaction against real devnet — using the program's own compiled instruction logic, the same fee payer, and the same RPC endpoint the app uses — rather than guessing from Phantom's vague error):
- The RPC endpoint (`solanaDevnetRpc()`'s default) is `https://api.devnet.solana.com` — same one used everywhere else in this project. Not the problem.
- Simulating `initialize_vault` **alone**, with the real fee payer and its real 5 SOL balance: **succeeds**, `err: null`, actual cost ~0.0046 SOL. Rent/fee math was never the problem.
- The app's "Create vault" button also bundles a "create the owner's Demo USD account" instruction, skipped only if the app's own check thinks that account doesn't exist yet. Since I (via the CLI) had already created and funded that exact account before handing the address over, simulating the **bundled** transaction (create-account instruction + `initialize_vault`) reproduced the real failure: `IllegalOwner` — the classic SPL Associated Token instruction (`Create`) hard-fails if the account already exists, which this one did.
- **Root cause**: the create-account instruction the app sends is only ever *conditionally* included, based on a client-side existence check — and that check should have found the account and skipped adding the instruction. Rather than chase the exact timing/state reason that check produced the wrong answer this one time, the right fix is to remove the failure mode itself.
- Separately, and unrelated to the actual cause: **Phantom's "not enough SOL" wording is just its generic fallback for any simulation failure it doesn't specifically recognize** — it shows that exact text for `IllegalOwner`, for an expired blockhash, for almost anything. Don't trust that message's literal content when debugging this app; get the real error from devtools or (as done here) an independent simulation.

**Fix**: switched from the SPL Associated Token Program's `Create` instruction (discriminant 0, hard-fails if the account exists) to `CreateIdempotent` (discriminant 1, silently does nothing if the account already exists with the right owner/mint) in `ixEnsureAssociatedTokenAccount` (renamed from `ixCreateAssociatedTokenAccount`), and made every action (`create vault`, `deposit`, `withdraw`) include it **unconditionally**, deleting the client-side "does it already exist?" pre-check entirely (`accountExists()` in `rpcHelpers.ts`, and the `ownerAtaExists` field it fed). This isn't a patch for the one instance reproduced above — it removes the whole class of bug, since the idempotent instruction can no longer fail this way regardless of what the app's own state believes about whether the account exists. Verified via the same direct-simulation method: the bundled `CreateIdempotent` + `initialize_vault` transaction now succeeds (`err: null`) whether the account already exists or not.

### Known Phantom quirk on devnet: "Failed to simulate the results of this request" / "Confirm (unsafe)"

This will very likely show up again for any brand-new custom devnet program (not specific to this bug, and not something in this app's control): Phantom runs its own balance-change **preview** before showing the approve screen, separate from actual on-chain validation. That preview service is known to be unreliable for devnet transactions against programs it has never indexed before, and falls back to a generic, alarming-sounding warning when it can't produce a preview — but it still offers **"Confirm (unsafe)"** rather than a hard block, because it genuinely doesn't know whether the transaction is fine, not because it detected something wrong.

Diagnosed by directly re-simulating the exact transaction against real devnet (same RPC, same fee payer, same accounts) multiple times — always `err: null`, clean success — while Phantom kept showing the warning regardless. Confirmed against Phantom's own public docs/discussions that this preview-failure is a known devnet/unrecognized-program limitation, not a correctness signal. **Safe to click "Confirm (unsafe)"** for this app's transactions: devnet only, a program you deployed yourself, and independently verified to execute exactly as intended.

### agent-pay: a re-runnable CLI to make a real (or refused) payment

`examples/agent_pay.rs` — has the grocery agent pay a catalogue merchant out of the Phantom-owned vault from M6, on devnet. Built to answer a specific need: **seeing a refusal land on-chain as a failed transaction**, not just be rejected client-side before ever reaching the network.

```bash
cd ~/agent-vault/agent_vault
cargo build --release --features no-entrypoint --example agent_pay   # first time only
./target/release/examples/agent_pay <noon|talabat|zomato|ubereats> <amount>
```

What it does:
1. Reads the agent's keypair (`keys/agent-grocery.json`) and the target merchant's keypair (`keys/merchant-<name>.json`, public key only, same as elsewhere) — never prints private keys.
2. Derives the vault's PDAs for a hardcoded `VAULT_OWNER` constant (currently your Phantom wallet, `7HTM...nbeg`; edit that constant if you create a vault under a different owner).
3. Ensures the merchant's Demo USD token account exists (idempotent — same `CreateIdempotent` fix as the front end, for the same reason).
4. Sends the `agent_spend` instruction with **`skip_preflight: true`** — the one deliberate difference from every other script in this project. Preflight is a client-side simulate-before-send safety check; skipping it means a transaction the program will refuse still gets broadcast and lands on-chain as a *failed* transaction (visible on Solscan), rather than being silently rejected before it ever reaches the network. That's the whole point of this script — being able to *show* a refusal, not just avoid one.
5. Polls until the transaction is confirmed, then reports success or failure. On failure, translates the on-chain custom error code back to plain English using the same `(code, message)` list as the front end's error translator (sourced from the same IDL, kept in sync by hand since it's a short, stable list) — e.g. code 6006 becomes "Destination is not on this agent's merchant allow-list (merchant not allowed for this agent)."
6. Always prints the Solscan link, whether the payment succeeded or was refused.

**Verified both paths for real**, using the actual current vault state (agent-grocery has budget 50, and — from testing the M6 test script — Noon happened to be currently un-allow-listed while Talabat was allow-listed):
- `agent-pay talabat 5` → **SUCCESS**: https://solscan.io/tx/3ytTSqpWmL8PWd9ouhbkAgnP5k1wKkByyp81rMMRf7vjWzSPEMZJ2y9RGC8gCUbcjVkonKq28osbFSoqEJSHtfiG?cluster=devnet
- `agent-pay noon 5` → **REFUSED**, plain English: "Destination is not on this agent's merchant allow-list (merchant not allowed for this agent)"; confirmed via `solana confirm` that it's a genuine on-chain failed transaction, not a client-side rejection: https://solscan.io/tx/4dYPJNGsgYnqEBCpnF2ydDouw5BP1CTNGtgihtMtsNyMmqNMXtZUorzExC2Yw35vy58ossoDATStkN17ni5FCAkp?cluster=devnet

No on-chain program changes were made for this script — it only adds a client, same as the rest of M6.

### What was not done (in scope for M7, not M6)

- No agent-side "spend" UI or agent wallet connection in the *browser app* — that's the explicit M7 scope ("agent or storefront"). (`agent-pay` above is a CLI script fulfilling a specific, separate request, not the M7 UI.)
- No hosting or deployment of this app anywhere — it only runs locally, as instructed.
- ~~Minting Demo USD to your new Phantom wallet~~ — done. Your address `7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg` now holds **500 Demo USD** in its associated token account `2gkZcZzpaF6wG9ZPFURWyD8Qaq7k6rkzgYoHeTEmCv8y` (created fresh, then minted to). Mint tx: `P8Lwxz9okNzKqkEfcVQjMNzdBfXcPjbEDVbYTYiM8rzwaQBmRLMKEwzc9UBdiFPmHZM9kWU52gnymRTfvbjuM5P`. The app's own ATA-derivation code was cross-checked against this address and matches exactly, so the front end will find this balance immediately.

### Click-by-click test script (do this yourself, in the browser)

1. **Connect**: open http://localhost:5173, click **Connect Phantom**, approve in the Phantom popup. You should see your address shown, and no yellow network-warning banner (if you see one, Phantom isn't in Devnet mode — fix via the manual setup steps above and reconnect).
2. **Create vault**: click **Create vault**. Approve the transaction in Phantom. A green "✓ Done — view on Solscan" link should appear; click it and confirm the transaction shows **Success** on Solscan.
3. **Deposit**: once the vault panel shows your balance (starts at 0), enter an amount (e.g. `100`) — it must be ≤ however much Demo USD I minted to your wallet — and click **Deposit into vault**. Approve in Phantom. Vault balance should update within a few seconds.
4. **Add an agent**: paste any Solana public key into "Agent wallet public key" (you can generate a throwaway one, or reuse one of `agent-grocery`/`agent-second`'s *public* addresses from §"Demo keypairs" above — never paste a private key anywhere), set a weekly budget (e.g. `50`), click **Add agent**. Approve in Phantom. You should see one agent card appear with that budget, 0 spent, all 4 merchant checkboxes ON, and status "Active".
5. **Toggle a merchant off**: uncheck one merchant checkbox on that agent card. Approve in Phantom. The checkbox should stay unchecked after the transaction confirms (it'll flip back automatically if the transaction actually failed — check for a red error line if that happens).
6. **Toggle it back on**: re-check the same box, approve, confirm it turns green/checked again.
7. **Revoke**: click **Revoke agent**. Approve. The card should turn red-bordered and say "REVOKED (cannot spend)".
8. **Unrevoke**: click **Unrevoke agent**. Approve. The card should return to normal and say "Active".
9. **Add a second agent** (if you want to test the 2-agent limit): repeat step 4 with a different public key. After that, the "Add agent" form should disappear and say "Maximum of 2 agents already registered."
10. **Withdraw**: in the "Owner withdraw" panel, enter an amount ≤ the vault's current balance, click **Withdraw**, approve. Vault balance should decrease and your own wallet's Demo USD balance should increase by the same amount.
11. **Try an invalid action** (to see the plain-English error path): try to withdraw more than the vault currently holds. You should get a red error line reading something like "Vault does not hold enough tokens to cover this withdrawal" rather than a raw error code.

If every step above produces a working Solscan link (successes) or a readable plain-English reason (the one deliberate failure in step 11), M6 is fully working end to end.

---

## 10. M7 — The agent and mock storefront

Two new local processes, on top of the same devnet program and M6's vault. **No on-chain program changes.**

### Architecture

```
~/agent-vault/agent-service/     Node CLI process. Holds the agent's private key.
  index.mjs                       Runs the scripted scenario, signs agent_spend itself.
  server.mjs                      Tiny HTTP server: SSE activity feed + a "continue" endpoint.
  lib/program.mjs                 Instruction building / account decoding / error translation.

~/agent-vault/app/                Same Vite app as M6, one more page added.
  storefront.html + src/Storefront.tsx   Read-only browser page: merchant list,
                                          live feed from the agent service, a
                                          "Continue" button for the scripted pauses.
```

The two only ever talk over one thing: a plain HTTP connection from the browser to `http://localhost:4021` (the agent service), carrying **public information only** — merchant names, amounts, success/failure, Solscan links, spent-so-far. Nothing flows the other way except the "continue" signal (an empty POST with no payload).

### Why the agent key can never reach the browser (and how that's enforced, not just promised)

- The agent-service process is the **only** thing that ever reads `keys/agent-grocery.json` off disk. It's read once at startup into a signer object that lives in that process's memory.
- The storefront page never receives that file, a serialized version of it, or anything derived from the private half of it. The only cross-process traffic is the JSON activity events (defined in `server.mjs`) and the continue signal — both defined by hand, both provably free of any keypair-shaped field, since I wrote every field that goes into an event and none of them is the key.
- There is no code path by which the browser *could* ask for it — the HTTP server exposes exactly two endpoints (`GET /events`, `POST /continue`), neither of which touches `agentSigner` at all; `agentSigner` is only ever passed into local function calls (`ixAgentSpend`, `partiallySignTransactionMessageWithSigners`) that build and sign a transaction, never into anything serialized to the network.
- This is architecturally the same reason M6's separation works: a browser page can only leak what it's given, so the fix is to never give it the sensitive thing in the first place, rather than trying to sanitize it afterward.

### Why a second, separate copy of `program.ts`/`program.mjs`

`agent-service/lib/program.mjs` duplicates PDA derivation, instruction building, account decoding, and error translation from `app/src/lib/program.ts`, rather than importing one from the other. These are two different runtimes (a Node CLI process holding a private key; a browser bundle that must never hold one) that happen to both talk to the same on-chain program — sharing a module between them would mean either bundling backend-only code into the browser build (harmless today, but a foot-gun waiting for the day someone adds something sensitive to that shared file) or awkwardly special-casing imports to keep the private-key-handling code out of Vite's bundle. Two small, independently-readable copies is simpler and safer than one shared module with an implicit "don't let this half reach the browser" rule.

### Running it

Terminal 1 — the agent service:
```bash
cd ~/agent-vault/agent-service
npm install   # first time only
node index.mjs
```
Optional flags: `--agent <keyfile>` (default `agent-grocery.json`, looked up in `~/agent-vault/keys/`), `--port <port>` (default `4021`).

Browser — the storefront (the M6 control panel dev server already serves this; if it's not running: `cd ~/agent-vault/app && npm run dev`):
```
http://localhost:5173/storefront.html
```
The M6 control panel itself is still at `http://localhost:5173/` — open both in separate tabs.

### The demo scenario, and the pauses

The agent service runs, in order: pay Noon 20, pay Talabat 20, pay Zomato 15, **pause**, pay Noon 5, **pause**, pay Talabat 5, then reports "scenario complete." Each pause shows an instruction message on the storefront page and waits for you to click **Continue** there (which POSTs to the agent service) before the next step runs — giving you the window to go make a change in the M6 control panel tab.

**Click-by-click:**
1. Start the agent service (terminal command above). Watch it ensure all 4 merchants have Demo USD accounts, then automatically run the first 3 payments.
2. Open the storefront page. You should see the activity feed already showing: Noon 20 ✓, Talabat 20 ✓, Zomato 15 ✗ refused (over budget) — each with a Solscan link.
3. The storefront shows a **"Paused"** banner: *"Go to the M6 control panel and switch Noon OFF for this agent, then press Continue."* Switch to the M6 tab, toggle Noon off for this agent, switch back, click **Continue**.
4. The feed adds: Noon 5 ✗ refused (merchant not allowed).
5. A second **"Paused"** banner: *"Go to the M6 control panel and revoke this agent, then press Continue."* Switch to M6, click **Revoke agent**, switch back, click **Continue**.
6. The feed adds: Talabat 5 ✗ refused (agent revoked). Then "Scenario complete."

### Point 4 — getting a clean spent = 0 starting state, without changing the program

There's no owner-facing instruction that resets `spent_so_far` early — only two things can: 7 days passing naturally, or registering a pubkey that's never been added to this vault before (a fresh registration always starts at 0). Since `MAX_AGENTS` is a hard cap of 2, and `agent-grocery` was already registered (and already had some spend on it from earlier M6 testing), **the simplest reset is to use the vault's one remaining agent slot for the recording**, rather than trying to zero out `agent-grocery`.

**While building and verifying this feature, I ran the real scenario's first two steps for real** (to confirm the agent service actually works end-to-end against devnet, not just in theory) — so `agent-grocery` now genuinely has `spent_so_far = 45` out of its `50` budget (only 5 remaining). That's not a hypothetical anymore: with `agent-grocery`, step (a) "Noon 20" would now be refused instead of succeeding, breaking the scripted narrative.

**Recommended fix, needing one action from you before the real recording**: register `agent-second` (`4i8XMX2vk9rYEnJ9nh8bHTsZR6R1B5yHLCQBpfZ82AXY` — public key, already generated back in M5, never used on this vault) as a second agent on this vault via the M6 control panel — **Add agent**, paste that address, weekly budget `50` — then run the agent service with `--agent agent-second.json`. That agent is genuinely untouched (`spent_so_far = 0`), so the scripted amounts (20/20/15/5/5) play out exactly as written. This is the last fresh slot available on this vault (2/2 agents after this), which is fine — this vault has done its job as the M6/M7 demo vault; a future milestone needing more room would create a new vault (a new mint) rather than needing the program changed.

Exact command for the clean recording run:
```bash
cd ~/agent-vault/agent-service
node index.mjs --agent agent-second.json
```

### What was verified

**Full scenario run end to end, on devnet, using `agent-second` (clean start)** — the agent service ran automatically for a, b, c; you toggled Noon off in the M6 control panel and clicked Continue; you revoked the agent and clicked Continue; the service finished the rest automatically. Independently re-decoded the raw on-chain `VaultRules` bytes myself afterward (not just trusting the feed) and confirmed the final state matches exactly: `spent_so_far = 40`, `revoked = true`, merchants left allow-listed = Talabat, Zomato, Uber Eats (Noon correctly removed).

| Step | Result | Transaction |
|---|---|---|
| a) Noon 20 | ✓ success | `5rYAmnooZ7rZeoScjB9mpBtzXUoVHQ9i85HpFkgvVf8ZbSu3GVN1XHoytmErEi3zB5PuRbUq6D55iS2EK7or4m1P` |
| b) Talabat 20 | ✓ success | `3E3YoTvsNK2dhoxEYdYaRBeWKXhXBcCYg5h8nJu3JGyUYPqQe4fG1HCvxFnrmpNqaUjJPcBvdmmrPLC55dK6nCgG` |
| c) Zomato 15 | ✗ refused — over budget | `2tXrS6pfCDqm5KzmcEXWTaToJotfKjKJaUeVQE3evfkQ453wjETPBdXnRHZSDJbEBkGQ3JfA84C9A1NvLtDRXnyS` |
| d) Noon 5 | ✗ refused — merchant not allowed | `2uCaZEep6zZiTyEfr4B9FLgrzzfC3rekE7G4fbMNb9efHie84GpYaLd5YqpYRqFHu7EQva2uTSyXubmQB2mPFV4N` |
| e) Talabat 5 | ✗ refused — agent revoked | `5jhSnV6H4XAT7DvicGzMMYzRfkLi2w7VpM1UDLvgRwFKLyxE1bLoNZwYJsG2oNA5XTQhTWvfRffS5eDtmPrNqfpN` |

(Solscan: append any signature above to `https://solscan.io/tx/<signature>?cluster=devnet`.)

Two smaller things this run caught and fixed, neither changing the on-chain outcome:
- `explainTransactionError` crashed on a `BigInt` inside the raw RPC error object (`JSON.stringify` can't serialize `BigInt` without a replacer) — fixed by converting `BigInt` to string in the replacer, unit-tested directly.
- The same function's regex for pulling the error code out of the RPC response didn't account for the code arriving as a quoted string (`"6005"`) rather than a bare number in some responses — fixed to match both forms. (This only affected the displayed *reason text* for one refusal during the run above; the on-chain refusal itself, and its cause, were already correct — confirmed by independently decoding the real error code from the log.)

One process note: this session runs all terminal commands itself (there's no separate terminal for you in this setup) — so once you're doing the click-by-click steps, tell me when you've made a change in the browser and I'll run whatever comes next / check the chain, rather than you needing to run `node` commands yourself.

---

## 11. Visual redesign passes (M6 + M7 front end)

Two purely visual/UX redesigns were done after M7, using the `frontend-design` skill. **No transaction-building logic changed in either pass** — `lib/program.ts` (and the agent-service's separate copy) were never touched; only components, CSS, and HTML entry points.

### Pass 2 — banking-app look (superseded by pass 3 below)
A "ledger" design: light paper background, emerald/gold/brick accents, Public Sans + IBM Plex Mono, agents shown as payment-card-styled panels in a vertical list. Superseded by the phone-frame redesign requested next, described below — kept here only as a record of what changed and why, in case an earlier look is ever wanted back.

### Pass 3 — dark neobank in a phone frame (current)

**Concept**: dark, Gen-Z-coded neobank, styled as an app installed on a phone rather than a desktop control panel.
- **Color**: graphite base `#111214` (not pure black, not blue-black — deliberately different from the two most common AI-generated dark palettes), off-white text, two vivid accents as the brief asked for explicitly (plural "colours"): electric lime `#C6FF3D` (active/success/primary), hot coral `#FF4F64` (danger/revoke/refused). A low-opacity cyan is reserved for hairline/tech details only, never a competing third color region.
- **Type**: Clash Display (bold, geometric — carries the balance and headlines), General Sans (UI/body text), IBM Plex Mono kept for all numeric and address data — the brief's own "crypto-native... subtle mono/tech details" cue.
- **Phone frame**: `components/PhoneFrame.tsx` — hand-drawn in CSS (rounded bezel, top pill "island," bottom home-indicator bar, side buttons). Deliberately generic: no notch shape, camera-dot, or naming that reads as a specific device brand, per the brief's explicit "no Apple logos or branding."
- **Navigation**: `components/CardCarousel.tsx` — one hand-rolled horizontal stack (Main Wallet as card 0, then one card per registered agent), driven by real Pointer Events (works for touch drag and mouse drag alike, no new dependency) plus arrow buttons and page dots. Swiping/pressing right advances to the next agent; left goes back. Only the active card is interactive; peeking neighbor cards are visually present but not clickable, matching "next card visible behind."
- **Agent card**: same physical-card metaphor as pass 2 (masked address as a "card number," budget bar as a spend-limit meter), now on a dark gradient surface — the one place a gradient is used, deliberately, to read as a card catching light; every other surface (`.panel`, merchant tiles) stays flat with a hairline border, so that treatment doesn't dilute into a generic "every card has a gradient" look.
- **Approval modal**: same state machine as pass 2 (`useApprovalAction` / `ApprovalModal` — genuinely unchanged), restyled dark and now rendered *inside* the phone screen (absolutely positioned against `.phone-screen`, which is why that element needed `position: relative`), matching "approval modal inside the phone."

**Merchant logos** — same folder and filenames as before, unchanged by this pass:
```
app/public/merchants/noon.png
app/public/merchants/talabat.png
app/public/merchants/zomato.png
app/public/merchants/ubereats.png
```

**What to open:**
- Control panel (phone-framed): **http://localhost:5173/**
- Storefront (same dark token system, plain full-width page — not phone-framed, since it represents an operator-facing dashboard rather than something installed on a phone): **http://localhost:5173/storefront.html**

**Verified after this pass:**
- `anchor test`: **11/11 passing** — program untouched.
- `agent-service/*.mjs` and `lib/program.mjs`: file timestamps confirmed unchanged from before this pass — the M7 backend was never touched. The already-running instance from the earlier full scenario run was left alone (still serving the storefront's feed) rather than restarted redundantly.
- `tsc -b && vite build`: clean, no errors, both passes of this redesign.

### Pass 4 — fixes + re-theme to white/purple

Three fixes, still visual/UX only:
- **See-through carousel bug**: `.carousel-card` had no background of its own, so wherever a page's content didn't fully cover its bounds, the peeking card behind it showed through and visually merged. Fixed by giving every carousel card an explicit opaque background (`var(--paper)`), so the active card now fully occludes whatever is stacked behind it — the peek effect comes only from the deliberate transform offset, not from transparency.
- **Non-circular navigation**: swiping/pressing past the last agent used to do nothing (clamped at the end). `CardCarousel` now wraps both directions using modulo arithmetic, and a `circularOffset()` helper picks the *shortest* signed distance around the loop so the wraparound neighbor peeks from the correct side rather than flying across the stack.
- **Re-theme, dark → white/purple**: background is now white/near-white (`--paper`, `--surface`), primary accent is a vivid purple (`--purple: #7B2FF7`, buttons/switches/active-status/budget-bar-fill/links), danger stays a warm red (`--danger`) for revoke/refused states. The agent card itself **stays dark** on purpose — a deliberately kept contrast, the same way real card products (metal or otherwise) usually stay dark/black even inside an otherwise light-mode banking app; its accents were retinted to the same purple/red pair so it still reads as one system. The phone's hardware bezel also stays dark regardless of the app's theme, matching how actual devices work (the screen content re-themes, the physical shell doesn't).

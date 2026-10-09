Build V2 of the Agentic Payments Vault: an OFF-CHAIN POLICY SERVER with a 2-of-3
multisig co-signer. Same controls as V1, enforced BEFORE signing.

Save this whole message as docs/V2-SPEC.md on a new branch `v2` first, then work from it.

==================================================================
STANDING RULES (unchanged from V1 — do not break any of these)
==================================================================
- Devnet only. Never mainnet.
- Do NOT change, rebuild or redeploy the V1 on-chain program (agent_vault/).
- Never print, copy or commit private keys. New key files go in keys/ (git-ignored).
- Agent and server keys never go to the browser.
- Transactions: ONLY the pre-approved list below. Anything else — stop and ask me.
- Before each git push: scan the staged diff for secrets.

PRE-APPROVED DEVNET TRANSACTIONS for V2 (nothing else):
1. Create the SPL Token multisig account (V2 setup).
2. Create the aUSD token account owned by that multisig (the V2 vault).
3. Mint 300 aUSD into the V2 vault using the CLI wallet (it is the aUSD mint authority).
4. Airdrop / transfer small devnet SOL to the policy-server key for fees (max 1 SOL).
5. Test payments from the V2 vault: max 10 transactions, max 20 aUSD each, only to
   the demo merchants in agent-service/demo-vault.config.json.
6. ZERO V1 transactions (the V1 food-ordering-agent budget is reserved for the demo).

==================================================================
DESIGN (decided — do not change without asking)
==================================================================
Custody: SPL Token MULTISIG (classic Token Program), m = 2, signers =
  [owner = my Phantom pubkey (same owner as V1), policy-server key, agent key].
  - Payment path: agent + policy server.
  - Recovery path: owner + agent (server down). NOT built in this milestone; document it.
  - The server alone, or the agent alone, cannot move funds.
  - ONE multisig + ONE vault token account PER AGENT. (A single multisig with two agents
    would let agent A + agent B move funds without the server. Explain this in the spec.)
  - Milestone scope: ONE agent only — a NEW key "food-ordering-agent-v2". Do not reuse
    the V1 agent key.
Token: same aUSD mint as V1 (EMiGUP2fckjgjgHiTnG4237q3jY4PygPg6zZeVb5fNh9), 0 decimals.
Transfer instruction: TransferChecked (NOT plain Transfer) — this is also the x402
  'exact' scheme requirement, so V2 fixes V1's x402 limitation.
Fee payer: the policy-server key.
Rules + spend history: SQLite (better-sqlite3), file in policy-server/data/ (git-ignored).
  Tables: agents (pubkey, name, weekly_budget, revoked), merchants (agent, merchant
  token account, label, enabled), spends (id, agent, merchant, amount, status
  pending|confirmed|failed, signature, created_at), windows (agent, window_start,
  spent). Same resetting 7-day window semantics as V1 (lazy reset on next spend).
Libraries: match the repo (@solana/kit 8, @solana-program/token). Verify the installed
  package APIs before using them (InitializeMultisig, TransferChecked with multiSigners,
  partial signing). Do not recall APIs from memory.

==================================================================
FLOW (the heart of V2)
==================================================================
1. Agent service decides to pay (merchant, amount). It builds ONE transaction:
   TransferChecked(source = V2 vault, destination = merchant token account,
   authority = multisig, multiSigners = [agent, server]), fee payer = server.
2. Agent PARTIALLY signs it and POSTs {transaction, intent: {merchant, amount}} to
   the policy server: POST /v2/authorize.
3. Policy server — in this order, refuse on the first failure with a named reason:
   a. TAMPER CHECK: decode the transaction itself. It must contain exactly ONE
      instruction, a Token Program TransferChecked, from the V2 vault, with the
      expected mint and decimals, and its destination and amount must equal the
      intent. Fee payer must be the server. Reject anything else
      (reason: TransactionMismatch). The server signs what it VERIFIED, never what
      it was TOLD.
   b. Agent signature present and agent registered          (AgentNotFound)
   c. Agent not revoked                                      (AgentRevoked)
   d. Merchant on this agent's allow-list and enabled        (MerchantNotAllowed)
   e. Window reset if 7 days passed; amount within remaining (BudgetExceeded)
4. Pass: inside ONE SQLite transaction, reserve the spend as 'pending' (so two
   concurrent requests cannot both pass the budget check), then co-sign, simulate,
   submit, confirm. Confirmed -> 'confirmed' + signature. Failed -> 'failed' and the
   reservation is released.
5. Refuse: return {approved:false, reason}. NOTHING is signed or submitted. No fee.
   Log the refusal in SQLite too (status 'refused') for the audit trail.

Admin API (localhost only, for this milestone; mark clearly as UNAUTHENTICATED in the
spec — next milestone: owner signs admin changes with Phantom signMessage):
  GET  /v2/state                       agents, merchants, budgets, recent spends
  POST /v2/agents/:pubkey/revoke  and  /unrevoke
  POST /v2/merchants/:id/enable   and  /disable
Policy server runs as its own Node process: policy-server/, port 4031.

==================================================================
DEMO: V1 vs V2 side by side
==================================================================
Storefront: add a clear V1 | V2 switch for the food-ordering agent.
- V1 path = existing behaviour (on-chain program decides).
- V2 path = agent -> policy server -> co-sign -> chain.
Refusal display must make the difference visible:
- V1 refusal: "Refused ON-CHAIN by the vault program" + error name + fee paid + Solscan link.
- V2 refusal: "Refused BEFORE SIGNING by the policy server" + reason +
  "No transaction was created. No fee." (no Solscan link, because nothing exists).
Control panel: add a small "V2 policy (off-chain)" section showing the V2 vault
  balance, the agent's budget/spent/window, merchant toggles and revoke — calling the
  admin API. Keep the existing V1 section unchanged.
Scenario mode: add an optional V2 scenario mirroring V1: pay Noonly 20 -> approved;
  turn Noonly off -> same payment refused before signing; revoke -> refused.

==================================================================
MILESTONES (stop and report after each; continue only on my OK)
==================================================================
V2-M1 Setup scripts: generate policy-server and agent-v2 keys; create multisig; create
      vault token account; mint 300 aUSD; fund server with SOL. Write addresses to
      policy-server/v2.config.json (public keys only). Show me the Solscan links.
V2-M2 Policy server + SQLite + /v2/authorize + admin API, seeded with the agent,
      200 aUSD weekly budget, and the 4 food merchants.
V2-M3 Agent service V2 path (build, partial-sign, call server).
V2-M4 Storefront switch + control panel V2 section + V2 scenario.
V2-M5 Tests (local, no devnet): pass; BudgetExceeded; MerchantNotAllowed; AgentRevoked;
      TransactionMismatch (agent's transaction pays a different merchant than the
      intent; also: different amount; extra instruction); two concurrent requests that
      together exceed the budget -> exactly one passes. Then ONE live devnet pass and
      ONE live refusal, within the pre-approved list.
V2-M6 README: add a "V2 — off-chain policy engine" section with a Mermaid diagram,
      the V1 vs V2 trade-off table below, and known limitations. Commit on branch v2.
      Do NOT merge to main or tag until I say so.

TRADE-OFF TABLE for the README:
| | V1 on-chain program | V2 off-chain policy server |
| Who decides | Vault program on Solana | Policy server, before signing |
| Refused payment | Reaches chain, fails, fee paid | Never created, no fee |
| Trust | No trusted operator | Must trust the server (+ multisig limits blast radius) |
| Rule changes | On-chain transaction each | Instant, free, private |
| Rule types | Fixed by deployed code | Add rules without a redeploy |
| Chain-specific | Solana only | Pattern works on any chain |
| Uptime | Chain uptime | Server down = no agent payments (owner+agent recovery) |

KNOWN LIMITATIONS to state honestly: admin API unauthenticated (localhost only);
recovery path documented not built; one agent; server key is a plain key file
(production: HSM / MPC — e.g. Fireblocks); devnet only.

Start now with: create branch v2, save docs/V2-SPEC.md, then do V2-M1 and report.

# Demo script — Agentic Payments Vault (M8, 2–3 min, devnet)

Everything runs on **Solana devnet**. Demo vault = **Agent USD (aUSD)** — owner = Phantom `7HTM…nbeg`, mint `EMiG…5fNh9`, 1 aUSD = 1 "dollar" (0 decimals). Agent = **food-ordering-agent** (`5j6M…aL2kg`), weekly budget 200. Addresses: `DEMO-VAULT.md`. Control panel opens on this vault by default (`?vault=b` is the old Vault B).

## State at time of writing (2026-10-05, read from devnet)

| Item | Value |
|---|---|
| Vault balance | 300 aUSD |
| Phantom aUSD / SOL | 580 / 4.99 |
| Fee payer (CLI wallet) SOL | 2.57 |
| food-ordering-agent | budget 200, spent 70 (130 left), not revoked, merchants: Kuber Eats, Talabird, Zomatic, Noonly |
| shopping-agent | budget 200, spent 30 (170 left), not revoked, merchants: Amazen, Flipkort, Nykeo, Meeshi |
| Budget window | both agents' window started 2026-10-04 09:21:14 UTC → spent amounts reset on the first spend at or after **2026-10-11 09:21:14 UTC** |

The program has no instruction to reset an agent's spend early (no `remove_agent`, revoke only flips a flag). Only waiting, or a fresh vault, resets it.

**What would break the demo**
- Agent revoked at the start (preflight fails while revoked) — unrevoke first.
- Budget used up: each take pays 10 in beat c (refusals spend nothing). 130 left ≈ 13 takes before the window rolls over.
- Vault empty: each take drains 10. Beat b tops it up.
- Phantom not in Devnet mode (it won't appear as connectable), locked, or devnet slowness (RPC > 2.5 s).
- Phantom's "Failed to simulate / Confirm (unsafe)" screen — **expected** for this unindexed devnet program (NOTES §9). Click **Confirm (unsafe)**; say nothing, or one line (see beat b).
- The agent service in `--scenario` mode and `pay.mjs` can be used together, but the scenario's own payments also consume budget — don't run both in one take.

## Before you record

```bash
cd ~/agent-vault/app && npm run dev            # terminal 1 (leave running)
node ~/agent-vault/scripts/preflight.mjs        # terminal 2: every line must be PASS
```
Open `http://localhost:5173`, Phantom on **Devnet**, connected, unlocked. Terminal 2 in `~/agent-vault/agent-service` with a large font (≥ 18 pt), cleared.

Alternative to the terminal beats: `cd agent-service && npm run scenario` and run the whole story from `http://localhost:5173/storefront.html` (Noonly 20, Talabird 20, Zomatic 15, then you switch Noonly off in the panel → Noonly 5 refused → revoke → Talabird 5 refused). The 5 beats below use `pay.mjs` instead and need no agent service running.

## The 5 beats

### Beat a — Show the vault and agents (≈ 25 s)
- **Click:** open `http://localhost:5173`, **Connect Phantom** (if not already). Swipe/arrow to the food-ordering-agent card, then back.
- **On screen:** Main wallet 580 aUSD · Vault 300 aUSD · 2 agents active. Agent card: Active, merchant toggles (Kuber Eats, Talabird, Zomatic, Noonly on).
- **Say:** "This is a prepaid card program for AI agents, on-chain. My money sits in a vault; my agent gets a card with a weekly limit and a list of merchants it may pay. The rules are enforced by the smart contract, not by the agent's good behaviour."
- **Terminal:** none.

### Beat b — Deposit (Phantom approval) (≈ 25 s)
- **Click:** in **Transfer** type `100` → **Send to vault** → approve in Phantom (may show "Confirm (unsafe)": click it).
- **On screen:** modal "Confirming on-chain" → "Done" with a Solscan link; Vault 300 → **400**, Main wallet 580 → **480** within ~6 s.
- **Say:** "I fund the vault from my own wallet — my signature, my money. Nothing moves without it."
- **Terminal:** none.

### Beat c — Agent pays an allowed merchant (≈ 40 s)
- **Terminal:** `node pay.mjs talabird 10`
- **On screen:** `✓ PAID — 10 aUSD sent to Talabird` + Solscan link. Open the link: **Success**, token transfer vault → Talabird. Back in the panel the card's spent amount goes up by 10 and the vault drops by 10.
- **Say:** "The agent signs its own payment with a key I never put in the browser. Talabird is on its list and it's within budget, so the contract pays it."

### Beat d — Rules refuse a forbidden payment (≈ 40 s)
- **Terminal:** `node pay.mjs amazen 5` (Amazen belongs to the shopping-agent, so it is not on the food agent's list; no toggling needed)
- **On screen:** `✗ REFUSED ON-CHAIN — Destination is not on this agent's merchant allow-list…` + Solscan link. Open it: status **Failed**, log shows `MerchantNotAllowed` (error 6006). Vault balance unchanged.
- **Optional (if time):** `node pay.mjs zomatic 500` → `✗ REFUSED … exceeds the agent's remaining budget` (6005).
- **Optional (live toggle):** switch **Noonly** OFF in the panel (Phantom approval), then `node pay.mjs noonly 5` → refused the same way. Switch it back ON afterwards.
- **Say:** "Same agent, same key, but Amazen isn't on its list — so the transaction fails on-chain. This isn't a UI check I could bypass; the contract itself says no. Failed tx, no money moved."

### Beat e — Owner revokes, agent refused again (≈ 40 s)
- **Click:** on the agent card press **Revoke agent** → approve in Phantom. Card shows "Revoked".
- **Terminal:** `node pay.mjs talabird 5` — a payment that would have worked in beat c.
- **On screen:** `✗ REFUSED ON-CHAIN — This agent has been revoked and cannot spend` + Solscan link (Failed, `AgentRevoked` 6004).
- **Say:** "One click and the card is dead. Same merchant that worked a minute ago is now refused. The agent can't argue, and I never touched its key."
- **Wrap-up line:** "Budget, merchants, kill switch — enforced on-chain."

## Reset between takes
1. Panel → **Unrevoke agent** → approve in Phantom (required: preflight fails while revoked). If you toggled Noonly off, switch it back on.
2. `node ~/agent-vault/scripts/preflight.mjs` → all PASS.
3. Budget: each take spends 10 of the 130 left (the window stays live; it resets on 2026-10-11 09:21 UTC). The vault drains 10 per take; the beat-b deposit adds 100 each take (Phantom has 580).
4. Read-only status any time: `node ~/agent-vault/scripts/demo-state.mjs`.

## Commands cheat-sheet (run from `~/agent-vault/agent-service`)
```
node pay.mjs talabird 10    # beat c  – succeeds
node pay.mjs amazen 5       # beat d  – refused (merchant not on this agent's list)
node pay.mjs zomatic 500    # beat d+ – refused (budget)
node pay.mjs talabird 5     # beat e  – refused (revoked)
node pay.mjs amazen 5 --agent shopping-agent    # the shopping agent paying its own merchant
```
`pay.mjs` takes the vault, agent and merchant addresses from `demo-vault.config.json`, reads the agent key only inside that Node process (never printed), and sends with `skipPreflight` so refusals land on Solscan as failed txs.

## Recording checklist (Windows)

**Recorder**
- **Xbox Game Bar:** `Win+Alt+R` start/stop (`Win+G` opens controls; check mic is on in Capture widget). Game Bar records **one window** — if you need browser + terminal in one video, use OBS or put both in a single window region (use OBS).
- **OBS (recommended):** Display Capture (or Window Capture ×2) → 1920×1080, 30 fps, MP4/MKV; mic in Audio Mixer; do a 10 s test recording and play it back (audio level, text readable).
- Output: `C:\Users\<you>\Videos` — keep OUT of any synced/public folder until reviewed.

**Screen setup**
- Close every other tab and app; one browser window (clean profile or Incognito with only the Phantom extension allowed), hide bookmarks bar (`Ctrl+Shift+B`), hide other extensions' icons.
- Notifications off: Windows **Focus assist / Do not disturb** on; quit Slack/Teams/Discord/email; disable browser notifications.
- Zoom browser to **125–150 %** (`Ctrl +`), terminal font ≥ 18 pt; resolution 1920×1080; browser and terminal side-by-side or alt-tab (rehearse the switch).
- Phantom: Devnet mode ON, unlocked, pinned extension; auto-lock timer long enough.
- Clear terminal (`clear`), `cd ~/agent-vault/agent-service`, prompt short (no full home path with other project names).
- Taskbar auto-hide, desktop clean, system clock fine.

**Must NOT appear on screen**
- Anything in `~/agent-vault/keys/` or `~/.config/solana/id.json` (never `cat`/open them; don't show the file explorer on those folders; don't show editor tabs containing them).
- Seed phrase / Phantom "Show secret recovery phrase" / "Export private key" screens.
- `.env*` files, terminal history (`history`, ↑ arrow through old commands), shell prompt exposing other paths.
- Any bank/real-money page, mainnet wallets or balances (Phantom must say Devnet/Testnet mode banner), real email/inbox, other accounts' names.
- Don't scroll Phantom's full activity/portfolio of other wallets.

**Final 60-second check before pressing record**
1. `node scripts/preflight.mjs` all PASS · 2. Phantom Devnet + unlocked · 3. Agent Active (not revoked) · 4. Notifications off · 5. Mic level OK · 6. Solscan tab pre-loaded to `https://solscan.io/?cluster=devnet` (no login popups).

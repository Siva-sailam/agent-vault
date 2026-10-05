# Demo script — Agentic Payments Vault (M8, 2–3 min, devnet)

Everything runs on **Solana devnet**. Vault B (owner = Phantom `7HTM…nbeg`), agent = **agent-grocery** (`9AVX…a1eb`), token = Demo USD (1 unit = 1 "dollar").

## State at time of writing (2026-10-04, read from devnet)

| Item | Value |
|---|---|
| Vault B balance | 15 Demo USD |
| Phantom Demo USD / SOL | 400 / 4.995 |
| Fee payer (CLI wallet) SOL | 2.61 |
| agent-grocery | budget 50, spent 45 (**window expired 2026-10-03 → first spend resets it to 0**), not revoked, merchants: Talabat, Zomato, Uber Eats (**Noon OFF**) |
| agent-second | budget 50, spent 40 (window expired too), **revoked**, same merchants |

**What would break the demo**
- Agent revoked at the start (grocery is fine; second is revoked — don't use it).
- Budget nearly used: each take spends 10 of grocery's 50. After a spend inside the live window, only 40 → 30 → … remain. After ~4 takes, wait for the window to roll over (7 days after the first spend) or stop.
- Panel shows stale `Spent 45 / 50 · 5 left` until the first payment of the take lands (the on-chain reset only happens on a successful spend). **Don't talk about the budget number until after beat c.**
- Noon accidentally switched ON → the "forbidden merchant" beat would succeed instead of refusing.
- Phantom not in Devnet mode (it won't even appear as connectable), Phantom locked, or devnet faucet-style slowness (RPC > 2.5 s).
- Phantom's scary "Failed to simulate / Confirm (unsafe)" screen — **expected** for this unindexed devnet program (NOTES §9). Click **Confirm (unsafe)**; say nothing, or one line (see beat b).

## Before you record

```bash
cd ~/agent-vault/app && npm run dev          # terminal 1 (leave running)
node ~/agent-vault/scripts/preflight.mjs      # terminal 2: every line must be PASS
```
Open `http://localhost:5173` in the browser, Phantom on **Devnet**, connected, unlocked. Terminal 2 in `~/agent-vault/agent-service` with a large font (≥ 18 pt), cleared.

## The 5 beats

### Beat a — Show the vault and agents (≈ 25 s)
- **Click:** open `http://localhost:5173`, **Connect Phantom** (if not already). Swipe/arrow right once to the agent-grocery card, then back.
- **On screen:** Main wallet 400 · Vault 15 · "2 agents active". Agent card: `9AVX •••• •••• a1eb`, Active, merchant toggles (Noon off; Talabat/Zomato/Uber Eats on).
- **Say:** "This is a prepaid card program for AI agents, on-chain. My money sits in a vault; my agent gets a card with a weekly limit and a list of merchants it may pay. The rules are enforced by the smart contract, not by the agent's good behaviour."
- **Terminal:** none.

### Beat b — Deposit (Phantom approval) (≈ 25 s)
- **Click:** in **Transfer** type `100` → **Send to vault** → approve in Phantom (may show "Confirm (unsafe)": click it).
- **On screen:** modal "Confirming on-chain" → "Done" with a Solscan link; Vault 15 → **115**, Main wallet 400 → **300** within ~6 s.
- **Say:** "I fund the vault from my own wallet — my signature, my money. Nothing moves without it."
- **Terminal:** none.

### Beat c — Agent pays an allowed merchant (≈ 40 s)
- **Terminal:** `node pay.mjs talabat 10`
- **On screen:** `✓ PAID — 10 Demo USD sent to Talabat` + Solscan link. Open the link: **Success**, token transfer vault → Talabat. Back in the panel the card now shows **Spent 10 / 50**, 40 left, vault **105**.
- **Say:** "The agent signs its own payment with a key I never put in the browser. Talabat is on its list and it's within budget, so the contract pays it."

### Beat d — Rules refuse a forbidden payment (≈ 40 s)
- **Terminal:** `node pay.mjs noon 5`
- **On screen:** `✗ REFUSED ON-CHAIN — Destination is not on this agent's merchant allow-list…` + Solscan link. Open it: status **Failed**, log shows `MerchantNotAllowed` (error 6006). Vault balance unchanged.
- **Optional (if time):** `node pay.mjs zomato 50` → `✗ REFUSED … exceeds the agent's remaining budget` (6005).
- **Say:** "Same agent, same key, but Noon isn't on its list — so the transaction fails on-chain. This isn't a UI check I could bypass; the contract itself says no. Failed tx, no money moved."

### Beat e — Owner revokes, agent refused again (≈ 40 s)
- **Click:** on the agent card press **Revoke agent** → approve in Phantom. Card turns red, "Revoked".
- **Terminal:** `node pay.mjs talabat 5` — the same payment that worked in beat c.
- **On screen:** `✗ REFUSED ON-CHAIN — This agent has been revoked and cannot spend` + Solscan link (Failed, `AgentRevoked` 6004).
- **Say:** "One click and the card is dead. Same merchant that worked a minute ago is now refused. The agent can't argue, and I never touched its key."
- **Wrap-up line:** "Budget, merchants, kill switch — enforced on-chain."

## Reset between takes
1. Panel → **Unrevoke agent** → approve in Phantom (required: preflight fails while revoked).
2. `node ~/agent-vault/scripts/preflight.mjs` → all PASS.
3. Budget: each take spends 10 of 50 (window stays live once reset). Vault drains 10 per take; top up with the beat-b deposit each take (Phantom has 400 → enough for 3 more full takes at 100; use 50 to stretch).
4. Read-only status any time: `node ~/agent-vault/scripts/demo-state.mjs`.

## Commands cheat-sheet (run from `~/agent-vault/agent-service`)
```
node pay.mjs talabat 10     # beat c  – succeeds
node pay.mjs noon 5         # beat d  – refused (merchant)
node pay.mjs zomato 50      # beat d+ – refused (budget, only if ≥ 1 spend already in window)
node pay.mjs talabat 5      # beat e  – refused (revoked)
```
`pay.mjs` reads the agent key only inside that Node process, never prints it, and sends with `skipPreflight` so refusals land on Solscan as failed txs.

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

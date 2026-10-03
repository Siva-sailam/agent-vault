#!/usr/bin/env bash
# Creates the "Demo USD" SPL token used by the M5 devnet demo, on whatever
# cluster your `solana config` currently points at (devnet, for this demo).
#
# "Demo USD" is a friendly label used only in these scripts/notes — it is
# NOT an on-chain token name (that needs the Token-2022 metadata extension,
# which is a different token program than the classic SPL Token program our
# agent_vault program is built against, so we deliberately don't use it).
#
# Decimals: 0 (whole-token units), so "budget 50" / "pay 10" match the raw
# on-chain amounts exactly, with no decimal-place conversion to think about.
#
# Safe to re-run: if the mint already exists on-chain, this script detects
# that and skips straight to printing the existing addresses instead of
# trying (and failing) to recreate it.
set -euo pipefail

KEYS_DIR="$HOME/agent-vault/keys"
MINT_KEYPAIR="$KEYS_DIR/demo-usd-mint.json"
INITIAL_SUPPLY=1000000

if [ ! -f "$MINT_KEYPAIR" ]; then
  echo "Generating mint keypair at $MINT_KEYPAIR"
  solana-keygen new --no-bip39-passphrase --silent -o "$MINT_KEYPAIR"
fi

MINT_ADDRESS="$(solana-keygen pubkey "$MINT_KEYPAIR")"

if solana account "$MINT_ADDRESS" >/dev/null 2>&1; then
  echo "Demo USD mint already exists on-chain: $MINT_ADDRESS"
else
  echo "Creating Demo USD mint: $MINT_ADDRESS (decimals=0)"
  spl-token create-token --decimals 0 "$MINT_KEYPAIR"

  echo "Creating your (owner) token account for Demo USD"
  spl-token create-account "$MINT_ADDRESS"

  echo "Minting initial supply of $INITIAL_SUPPLY Demo USD to your wallet"
  spl-token mint "$MINT_ADDRESS" "$INITIAL_SUPPLY"
fi

OWNER_ATA="$(spl-token address --token "$MINT_ADDRESS" --verbose 2>/dev/null | awk '/Associated token address:/ {print $4}')"

echo
echo "Demo USD mint:        $MINT_ADDRESS"
echo "Your token account:   $OWNER_ATA"
echo "Your Demo USD balance: $(spl-token balance "$MINT_ADDRESS" 2>/dev/null || echo 0)"

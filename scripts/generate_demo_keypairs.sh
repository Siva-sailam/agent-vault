#!/usr/bin/env bash
# Generates the demo keypairs used by the M5 devnet demo:
#   - 4 merchant wallets: Noon, Talabat, Zomato, Uber Eats
#   - 2 agent wallets: grocery-agent, second-agent
#
# Safe to re-run: any keypair file that already exists in ~/agent-vault/keys
# is left untouched (so re-running this never changes anyone's address).
# Private keys never leave this machine and are never printed.
set -euo pipefail

KEYS_DIR="$HOME/agent-vault/keys"
mkdir -p "$KEYS_DIR"

make_keypair() {
  local name="$1"
  local path="$KEYS_DIR/$name.json"
  if [ -f "$path" ]; then
    echo "  $name: already exists, skipping ($path)"
  else
    solana-keygen new --no-bip39-passphrase --silent -o "$path"
    echo "  $name: created ($path)"
  fi
}

echo "Merchants:"
make_keypair "merchant-noon"
make_keypair "merchant-talabat"
make_keypair "merchant-zomato"
make_keypair "merchant-ubereats"

echo "Agents:"
make_keypair "agent-grocery"
make_keypair "agent-second"

echo
echo "Public addresses:"
for f in "$KEYS_DIR"/*.json; do
  name="$(basename "$f" .json)"
  addr="$(solana-keygen pubkey "$f")"
  printf "  %-20s %s\n" "$name" "$addr"
done

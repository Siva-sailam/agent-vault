use anchor_lang::prelude::*;

#[constant]
pub const RULES_SEED: &[u8] = b"rules";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault_authority";

/// Maximum number of agents a vault can register. Fixed at v1 so the rules
/// account layout (and therefore its on-chain size) never needs to be
/// migrated later.
pub const MAX_AGENTS: usize = 2;

/// Fixed number of merchant allow-list slots reserved per agent. Unused in
/// M3 (all slots stay `Pubkey::default()`) but reserved now so M4 can fill
/// them in without resizing/reallocating the account.
pub const MAX_MERCHANTS_PER_AGENT: usize = 4;

/// Length of a spending window, in seconds: 7 days.
pub const WINDOW_SECONDS: i64 = 7 * 24 * 60 * 60;

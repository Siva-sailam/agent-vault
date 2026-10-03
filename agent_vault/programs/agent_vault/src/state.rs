use anchor_lang::prelude::*;

use crate::constants::{MAX_AGENTS, MAX_MERCHANTS_PER_AGENT};

/// One registered agent and its spending rules.
///
/// `merchants` and `revoked` are part of the full v1 layout required by M4
/// (merchant allow-list + revoke toggle) but are not enforced or mutated by
/// any M3 instruction. Reserving the space now means M4 never has to
/// reallocate `VaultRules`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct Agent {
    /// Agent's signing pubkey. `Pubkey::default()` means the slot is unused.
    pub key: Pubkey,
    /// Max total spend allowed within a rolling 7-day window.
    pub weekly_budget: u64,
    /// Amount spent so far in the current window.
    pub spent_so_far: u64,
    /// Unix timestamp the current window started.
    pub window_start: i64,
    /// M4: when true, agent_spend must refuse this agent. Unused in M3.
    pub revoked: bool,
    /// M4: allow-listed destination token accounts. Unused in M3 —
    /// always `Pubkey::default()` for all 4 slots.
    pub merchants: [Pubkey; MAX_MERCHANTS_PER_AGENT],
}

impl Agent {
    pub fn empty() -> Agent {
        Agent {
            key: Pubkey::default(),
            weekly_budget: 0,
            spent_so_far: 0,
            window_start: 0,
            revoked: false,
            merchants: [Pubkey::default(); MAX_MERCHANTS_PER_AGENT],
        }
    }

    pub fn is_empty_slot(&self) -> bool {
        self.key == Pubkey::default()
    }
}

/// Per-vault configuration and agent roster. One `VaultRules` account is
/// created per (owner, mint) pair and PDA-owns exactly one token account
/// (the vault) holding funds for that mint.
#[account]
#[derive(InitSpace)]
pub struct VaultRules {
    /// The human who created the vault and who can add agents / deposit.
    pub owner: Pubkey,
    /// The SPL mint this vault holds. Fixed at creation (one vault = one token).
    pub mint: Pubkey,
    /// The vault's token account (owned by the `vault_authority` PDA).
    pub vault: Pubkey,
    /// Bump for this `VaultRules` PDA (seeds: [RULES_SEED, owner, mint]).
    pub bump: u8,
    /// Bump for the vault token account PDA (seeds: [VAULT_SEED, rules]).
    pub vault_bump: u8,
    /// Bump for the vault_authority PDA that signs outgoing transfers
    /// (seeds: [VAULT_AUTHORITY_SEED, rules]).
    pub vault_authority_bump: u8,
    /// Number of populated entries in `agents` (0..=MAX_AGENTS).
    pub agent_count: u8,
    pub agents: [Agent; MAX_AGENTS],
}

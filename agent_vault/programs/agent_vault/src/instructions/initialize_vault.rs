use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::state::{Agent, VaultRules};

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The single mint this vault will ever hold. Immutable after creation.
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        space = 8 + VaultRules::INIT_SPACE,
        seeds = [RULES_SEED, owner.key().as_ref(), mint.key().as_ref()],
        bump,
    )]
    pub rules: Account<'info, VaultRules>,

    /// CHECK: holds no data; exists only as the PDA that must sign
    /// outgoing token transfers out of `vault` in `agent_spend`.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, rules.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = owner,
        seeds = [VAULT_SEED, rules.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
    let rules = &mut ctx.accounts.rules;
    rules.owner = ctx.accounts.owner.key();
    rules.mint = ctx.accounts.mint.key();
    rules.vault = ctx.accounts.vault.key();
    rules.bump = ctx.bumps.rules;
    rules.vault_bump = ctx.bumps.vault;
    rules.vault_authority_bump = ctx.bumps.vault_authority;
    rules.agent_count = 0;
    rules.agents = [Agent::empty(); crate::constants::MAX_AGENTS];

    msg!(
        "Vault initialized: owner={}, mint={}, vault={}",
        rules.owner,
        rules.mint,
        rules.vault
    );
    Ok(())
}

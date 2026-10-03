use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::VaultError;
use crate::state::VaultRules;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,

    #[account(
        has_one = owner,
        seeds = [RULES_SEED, owner.key().as_ref(), rules.mint.as_ref()],
        bump = rules.bump,
    )]
    pub rules: Account<'info, VaultRules>,

    #[account(mut, address = rules.vault)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA that owns `vault`; used only as a CPI signer, same as in
    /// `agent_spend`.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, rules.key().as_ref()],
        bump = rules.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        token::mint = rules.mint,
        token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

/// Owner-only inverse of `deposit`: pulls funds back out of the vault.
/// Agents never have access to this instruction — only the owner can
/// withdraw, and only to their own token account.
pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(
        ctx.accounts.vault.amount >= amount,
        VaultError::InsufficientVaultBalance
    );

    let rules_key = ctx.accounts.rules.key();
    let vault_authority_bump = ctx.accounts.rules.vault_authority_bump;
    let signer_seeds: &[&[u8]] = &[
        VAULT_AUTHORITY_SEED,
        rules_key.as_ref(),
        &[vault_authority_bump],
    ];
    let signer_seeds_outer = [signer_seeds];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.owner_token_account.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        &signer_seeds_outer,
    );
    token::transfer(cpi_ctx, amount)?;

    msg!("Owner withdrew {} from vault {}", amount, ctx.accounts.vault.key());
    Ok(())
}

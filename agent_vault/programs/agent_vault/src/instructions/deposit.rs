use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::state::VaultRules;

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub owner: Signer<'info>,

    #[account(
        has_one = owner,
        seeds = [RULES_SEED, owner.key().as_ref(), rules.mint.as_ref()],
        bump = rules.bump,
    )]
    pub rules: Account<'info, VaultRules>,

    #[account(mut, address = rules.vault)]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = rules.mint,
        token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    let cpi_accounts = Transfer {
        from: ctx.accounts.owner_token_account.to_account_info(),
        to: ctx.accounts.vault.to_account_info(),
        authority: ctx.accounts.owner.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    msg!("Deposited {} into vault {}", amount, ctx.accounts.vault.key());
    Ok(())
}

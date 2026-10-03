use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::error::VaultError;
use crate::state::VaultRules;

#[derive(Accounts)]
pub struct AgentSpend<'info> {
    /// The agent itself signs — this is the "card" being presented.
    pub agent: Signer<'info>,

    #[account(
        mut,
        seeds = [RULES_SEED, rules.owner.as_ref(), rules.mint.as_ref()],
        bump = rules.bump,
    )]
    pub rules: Account<'info, VaultRules>,

    #[account(mut, address = rules.vault)]
    pub vault: Account<'info, TokenAccount>,

    /// CHECK: PDA that owns `vault`; used only as a CPI signer. Its
    /// address is re-derived from the seeds and checked against the bump
    /// stored on `rules` at vault creation, so it cannot be swapped for an
    /// attacker-controlled account.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, rules.key().as_ref()],
        bump = rules.vault_authority_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Must appear in the spending agent's `merchants` allow-list (checked
    /// in the handler, since that list lives on `rules`, not here).
    #[account(mut, token::mint = rules.mint)]
    pub destination: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_agent_spend(ctx: Context<AgentSpend>, amount: u64) -> Result<()> {
    let rules_key = ctx.accounts.rules.key();
    let vault_authority_bump = ctx.accounts.rules.vault_authority_bump;
    let agent_key = ctx.accounts.agent.key();

    // Signer must be a listed agent on this vault.
    let idx = ctx
        .accounts
        .rules
        .agents
        .iter()
        .position(|a| a.key == agent_key)
        .ok_or(VaultError::AgentNotFound)?;

    let now = Clock::get()?.unix_timestamp;
    let destination_key = ctx.accounts.destination.key();

    let (spent_so_far, weekly_budget) = {
        let agent = &mut ctx.accounts.rules.agents[idx];
        require!(!agent.revoked, VaultError::AgentRevoked);

        // Deny-by-default allow-list: the destination must be one of this
        // agent's allow-listed merchants. An agent with no merchants
        // configured (the default for every newly added agent) can't spend
        // anywhere until the owner explicitly allow-lists at least one.
        require!(
            agent.merchants.iter().any(|m| *m == destination_key),
            VaultError::MerchantNotAllowed
        );

        // Rolling 7-day window: if the window has elapsed, it resets and
        // this spend starts a fresh window rather than being refused.
        if now.saturating_sub(agent.window_start) >= WINDOW_SECONDS {
            agent.spent_so_far = 0;
            agent.window_start = now;
        }

        let remaining = agent.weekly_budget.saturating_sub(agent.spent_so_far);
        require!(amount <= remaining, VaultError::BudgetExceeded);

        agent.spent_so_far = agent
            .spent_so_far
            .checked_add(amount)
            .ok_or(VaultError::BudgetExceeded)?;

        (agent.spent_so_far, agent.weekly_budget)
    };

    let signer_seeds: &[&[u8]] = &[
        VAULT_AUTHORITY_SEED,
        rules_key.as_ref(),
        &[vault_authority_bump],
    ];

    let cpi_accounts = Transfer {
        from: ctx.accounts.vault.to_account_info(),
        to: ctx.accounts.destination.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let signer_seeds_outer = [signer_seeds];
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        cpi_accounts,
        &signer_seeds_outer,
    );
    token::transfer(cpi_ctx, amount)?;

    msg!(
        "Agent {} spent {} (spent_so_far={}, weekly_budget={})",
        agent_key,
        amount,
        spent_so_far,
        weekly_budget
    );

    Ok(())
}

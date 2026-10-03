use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::VaultError;
use crate::state::{Agent, VaultRules};

#[derive(Accounts)]
pub struct AddAgent<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [RULES_SEED, owner.key().as_ref(), rules.mint.as_ref()],
        bump = rules.bump,
    )]
    pub rules: Account<'info, VaultRules>,
}

pub fn handle_add_agent(ctx: Context<AddAgent>, agent: Pubkey, weekly_budget: u64) -> Result<()> {
    require!(weekly_budget > 0, VaultError::ZeroBudget);

    let rules = &mut ctx.accounts.rules;
    require!(
        (rules.agent_count as usize) < MAX_AGENTS,
        VaultError::AgentSlotsFull
    );
    require!(
        !rules.agents.iter().any(|a| a.key == agent),
        VaultError::AgentAlreadyRegistered
    );

    let now = Clock::get()?.unix_timestamp;
    let slot = rules.agent_count as usize;
    rules.agents[slot] = Agent {
        key: agent,
        weekly_budget,
        spent_so_far: 0,
        window_start: now,
        revoked: false,
        merchants: [Pubkey::default(); MAX_MERCHANTS_PER_AGENT],
    };
    rules.agent_count += 1;

    msg!(
        "Agent {} registered with weekly budget {}",
        agent,
        weekly_budget
    );
    Ok(())
}

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::VaultError;
use crate::state::VaultRules;

/// Shared account shape for every owner-only agent-management action
/// (merchant allow-list edits, revoke/unrevoke): just the owner and the
/// rules account they own.
#[derive(Accounts)]
pub struct ManageAgent<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner,
        seeds = [RULES_SEED, owner.key().as_ref(), rules.mint.as_ref()],
        bump = rules.bump,
    )]
    pub rules: Account<'info, VaultRules>,
}

fn find_agent_mut<'a>(
    rules: &'a mut VaultRules,
    agent: Pubkey,
) -> Result<&'a mut crate::state::Agent> {
    rules
        .agents
        .iter_mut()
        .find(|a| a.key == agent)
        .ok_or_else(|| error!(VaultError::AgentNotFound))
}

pub fn handle_add_merchant(ctx: Context<ManageAgent>, agent: Pubkey, merchant: Pubkey) -> Result<()> {
    require!(merchant != Pubkey::default(), VaultError::InvalidMerchant);

    let agent_ref = find_agent_mut(&mut ctx.accounts.rules, agent)?;
    require!(
        !agent_ref.merchants.iter().any(|m| *m == merchant),
        VaultError::MerchantAlreadyAllowed
    );
    let slot = agent_ref
        .merchants
        .iter()
        .position(|m| *m == Pubkey::default())
        .ok_or(VaultError::MerchantSlotsFull)?;
    agent_ref.merchants[slot] = merchant;

    msg!("Merchant {} allow-listed for agent {}", merchant, agent);
    Ok(())
}

pub fn handle_remove_merchant(
    ctx: Context<ManageAgent>,
    agent: Pubkey,
    merchant: Pubkey,
) -> Result<()> {
    let agent_ref = find_agent_mut(&mut ctx.accounts.rules, agent)?;
    let slot = agent_ref
        .merchants
        .iter()
        .position(|m| *m == merchant)
        .ok_or(VaultError::MerchantNotFound)?;
    agent_ref.merchants[slot] = Pubkey::default();

    msg!("Merchant {} removed from agent {}", merchant, agent);
    Ok(())
}

pub fn handle_set_agent_revoked(
    ctx: Context<ManageAgent>,
    agent: Pubkey,
    revoked: bool,
) -> Result<()> {
    let agent_ref = find_agent_mut(&mut ctx.accounts.rules, agent)?;
    agent_ref.revoked = revoked;

    msg!("Agent {} revoked={}", agent, revoked);
    Ok(())
}

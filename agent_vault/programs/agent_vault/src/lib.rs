pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj");

#[program]
pub mod agent_vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        crate::instructions::initialize_vault::handle_initialize_vault(ctx)
    }

    pub fn add_agent(ctx: Context<AddAgent>, agent: Pubkey, weekly_budget: u64) -> Result<()> {
        crate::instructions::add_agent::handle_add_agent(ctx, agent, weekly_budget)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        crate::instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn agent_spend(ctx: Context<AgentSpend>, amount: u64) -> Result<()> {
        crate::instructions::agent_spend::handle_agent_spend(ctx, amount)
    }

    pub fn add_merchant(ctx: Context<ManageAgent>, agent: Pubkey, merchant: Pubkey) -> Result<()> {
        crate::instructions::manage_agent::handle_add_merchant(ctx, agent, merchant)
    }

    pub fn remove_merchant(ctx: Context<ManageAgent>, agent: Pubkey, merchant: Pubkey) -> Result<()> {
        crate::instructions::manage_agent::handle_remove_merchant(ctx, agent, merchant)
    }

    pub fn set_agent_revoked(ctx: Context<ManageAgent>, agent: Pubkey, revoked: bool) -> Result<()> {
        crate::instructions::manage_agent::handle_set_agent_revoked(ctx, agent, revoked)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        crate::instructions::withdraw::handle_withdraw(ctx, amount)
    }
}

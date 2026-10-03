use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Vault already has the maximum number of agents registered")]
    AgentSlotsFull,
    #[msg("This pubkey is already registered as an agent on this vault")]
    AgentAlreadyRegistered,
    #[msg("Weekly budget must be greater than zero")]
    ZeroBudget,
    #[msg("Signer is not a registered agent on this vault")]
    AgentNotFound,
    #[msg("This agent has been revoked and cannot spend")]
    AgentRevoked,
    #[msg("Spend amount exceeds the agent's remaining budget for this window")]
    BudgetExceeded,
    #[msg("Destination is not on this agent's merchant allow-list")]
    MerchantNotAllowed,
    #[msg("This agent already has the maximum number of merchants allow-listed")]
    MerchantSlotsFull,
    #[msg("This merchant is already allow-listed for this agent")]
    MerchantAlreadyAllowed,
    #[msg("This merchant is not on this agent's allow-list")]
    MerchantNotFound,
    #[msg("Merchant pubkey cannot be the default (empty) pubkey")]
    InvalidMerchant,
    #[msg("Vault does not hold enough tokens to cover this withdrawal")]
    InsufficientVaultBalance,
}

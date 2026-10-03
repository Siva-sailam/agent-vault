use {
    agent_vault::{
        accounts as ix_accounts, instruction as ix_data, RULES_SEED, VAULT_AUTHORITY_SEED,
        VAULT_SEED,
    },
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::{types::FailedTransactionMetadata, LiteSVM},
    litesvm_token::{
        get_spl_account, spl_token, CreateAssociatedTokenAccount, CreateMint, MintTo, TOKEN_ID,
    },
    solana_clock::Clock,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const WINDOW_SECONDS: i64 = 7 * 24 * 60 * 60;

/// Builds and sends a single-instruction transaction for our program.
/// `payer` also signs; any signer in `extra_signers` that isn't the payer
/// is added as an additional signature.
fn call(
    svm: &mut LiteSVM,
    payer: &Keypair,
    extra_signers: &[&Keypair],
    data: Vec<u8>,
    accounts: Vec<anchor_lang::solana_program::instruction::AccountMeta>,
) -> Result<litesvm::types::TransactionMetadata, FailedTransactionMetadata> {
    let ix = Instruction::new_with_bytes(agent_vault::id(), &data, accounts);
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);

    let mut signers: Vec<&Keypair> = vec![payer];
    for s in extra_signers {
        if s.pubkey() != payer.pubkey() {
            signers.push(s);
        }
    }

    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    svm.send_transaction(tx)
}

fn token_balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    get_spl_account::<spl_token::state::Account>(svm, token_account)
        .unwrap()
        .amount
}

struct Setup {
    svm: LiteSVM,
    owner: Keypair,
    agent1: Keypair,
    agent2: Keypair,
    mint: Pubkey,
    rules: Pubkey,
    vault: Pubkey,
    vault_authority: Pubkey,
    owner_ata: Pubkey,
    merchant_ata: Pubkey,
}

/// Deploys the program, creates a test mint, funds the owner, initializes a
/// vault, registers two agents (budgets 1000 and 500), allow-lists
/// `merchant_ata` for both of them, and deposits 10_000 tokens into the
/// vault. Every test starts from this same baseline state.
fn setup() -> Setup {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/agent_vault.so"
    ));
    svm.add_program(agent_vault::id(), bytes).unwrap();

    let owner = Keypair::new();
    let agent1 = Keypair::new();
    let agent2 = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&agent1.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&agent2.pubkey(), 10_000_000_000).unwrap();

    // Test mint: owner is the mint authority, 0 decimals for simple integer amounts.
    let mint = CreateMint::new(&mut svm, &owner)
        .decimals(0)
        .send()
        .unwrap();

    let owner_ata = CreateAssociatedTokenAccount::new(&mut svm, &owner, &mint)
        .send()
        .unwrap();
    MintTo::new(&mut svm, &owner, &mint, &owner_ata, 1_000_000)
        .send()
        .unwrap();

    let merchant = Keypair::new();
    let merchant_ata = CreateAssociatedTokenAccount::new(&mut svm, &owner, &mint)
        .owner(&merchant.pubkey())
        .send()
        .unwrap();

    let program_id = agent_vault::id();
    let rules = Pubkey::find_program_address(
        &[RULES_SEED, owner.pubkey().as_ref(), mint.as_ref()],
        &program_id,
    )
    .0;
    let vault_authority =
        Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED, rules.as_ref()], &program_id).0;
    let vault = Pubkey::find_program_address(&[VAULT_SEED, rules.as_ref()], &program_id).0;

    // initialize_vault
    let accounts = ix_accounts::InitializeVault {
        owner: owner.pubkey(),
        mint,
        rules,
        vault_authority,
        vault,
        token_program: TOKEN_ID,
        system_program: system_program::ID,
    };
    call(
        &mut svm,
        &owner,
        &[],
        ix_data::InitializeVault {}.data(),
        accounts.to_account_metas(None),
    )
    .unwrap();

    // add_agent x2
    for (agent, budget) in [(&agent1, 1000u64), (&agent2, 500u64)] {
        let accounts = ix_accounts::AddAgent {
            owner: owner.pubkey(),
            rules,
        };
        call(
            &mut svm,
            &owner,
            &[],
            ix_data::AddAgent {
                agent: agent.pubkey(),
                weekly_budget: budget,
            }
            .data(),
            accounts.to_account_metas(None),
        )
        .unwrap();
    }

    // deposit 10_000 into the vault
    let accounts = ix_accounts::Deposit {
        owner: owner.pubkey(),
        rules,
        vault,
        owner_token_account: owner_ata,
        token_program: TOKEN_ID,
    };
    call(
        &mut svm,
        &owner,
        &[],
        ix_data::Deposit { amount: 10_000 }.data(),
        accounts.to_account_metas(None),
    )
    .unwrap();

    // Allow-list the default merchant for both agents. Spending is
    // deny-by-default, so without this every agent_spend below would be
    // refused with MerchantNotAllowed regardless of budget/window state.
    for agent in [&agent1, &agent2] {
        let accounts = ix_accounts::ManageAgent {
            owner: owner.pubkey(),
            rules,
        };
        call(
            &mut svm,
            &owner,
            &[],
            ix_data::AddMerchant {
                agent: agent.pubkey(),
                merchant: merchant_ata,
            }
            .data(),
            accounts.to_account_metas(None),
        )
        .unwrap();
    }

    Setup {
        svm,
        owner,
        agent1,
        agent2,
        mint,
        rules,
        vault,
        vault_authority,
        owner_ata,
        merchant_ata,
    }
}

fn add_merchant(
    s: &mut Setup,
    agent: Pubkey,
    merchant: Pubkey,
) -> Result<litesvm::types::TransactionMetadata, FailedTransactionMetadata> {
    let owner = s.owner.insecure_clone();
    let accounts = ix_accounts::ManageAgent {
        owner: owner.pubkey(),
        rules: s.rules,
    };
    call(
        &mut s.svm,
        &owner,
        &[],
        ix_data::AddMerchant { agent, merchant }.data(),
        accounts.to_account_metas(None),
    )
}

fn remove_merchant(
    s: &mut Setup,
    agent: Pubkey,
    merchant: Pubkey,
) -> Result<litesvm::types::TransactionMetadata, FailedTransactionMetadata> {
    let owner = s.owner.insecure_clone();
    let accounts = ix_accounts::ManageAgent {
        owner: owner.pubkey(),
        rules: s.rules,
    };
    call(
        &mut s.svm,
        &owner,
        &[],
        ix_data::RemoveMerchant { agent, merchant }.data(),
        accounts.to_account_metas(None),
    )
}

fn set_agent_revoked(
    s: &mut Setup,
    agent: Pubkey,
    revoked: bool,
) -> Result<litesvm::types::TransactionMetadata, FailedTransactionMetadata> {
    let owner = s.owner.insecure_clone();
    let accounts = ix_accounts::ManageAgent {
        owner: owner.pubkey(),
        rules: s.rules,
    };
    call(
        &mut s.svm,
        &owner,
        &[],
        ix_data::SetAgentRevoked { agent, revoked }.data(),
        accounts.to_account_metas(None),
    )
}

fn withdraw(
    s: &mut Setup,
    amount: u64,
) -> Result<litesvm::types::TransactionMetadata, FailedTransactionMetadata> {
    let owner = s.owner.insecure_clone();
    let accounts = ix_accounts::Withdraw {
        owner: owner.pubkey(),
        rules: s.rules,
        vault: s.vault,
        vault_authority: s.vault_authority,
        owner_token_account: s.owner_ata,
        token_program: TOKEN_ID,
    };
    call(
        &mut s.svm,
        &owner,
        &[],
        ix_data::Withdraw { amount }.data(),
        accounts.to_account_metas(None),
    )
}

fn spend(
    s: &mut Setup,
    agent: &Keypair,
    amount: u64,
) -> Result<litesvm::types::TransactionMetadata, FailedTransactionMetadata> {
    let accounts = ix_accounts::AgentSpend {
        agent: agent.pubkey(),
        rules: s.rules,
        vault: s.vault,
        vault_authority: s.vault_authority,
        destination: s.merchant_ata,
        token_program: TOKEN_ID,
    };
    call(
        &mut s.svm,
        agent,
        &[agent],
        ix_data::AgentSpend { amount }.data(),
        accounts.to_account_metas(None),
    )
}

#[test]
fn vault_initializes_with_correct_rules() {
    let s = setup();
    let rules_account = s.svm.get_account(&s.rules).unwrap();
    let mut data: &[u8] = &rules_account.data;
    let rules = agent_vault::state::VaultRules::try_deserialize(&mut data).unwrap();

    assert_eq!(rules.owner, s.owner.pubkey());
    assert_eq!(rules.mint, s.mint);
    assert_eq!(rules.vault, s.vault);
    assert_eq!(rules.agent_count, 2);
    assert_eq!(rules.agents[0].key, s.agent1.pubkey());
    assert_eq!(rules.agents[0].weekly_budget, 1000);
    assert_eq!(rules.agents[1].key, s.agent2.pubkey());
    assert_eq!(rules.agents[1].weekly_budget, 500);
    assert_eq!(token_balance(&s.svm, &s.vault), 10_000);
}

#[test]
fn successful_spend_moves_tokens_and_tracks_budget() {
    let mut s = setup();

    let agent1 = s.agent1.insecure_clone();
    let res = spend(&mut s, &agent1, 300);
    assert!(res.is_ok(), "expected spend to succeed: {res:?}");

    assert_eq!(token_balance(&s.svm, &s.vault), 10_000 - 300);
    assert_eq!(token_balance(&s.svm, &s.merchant_ata), 300);

    let rules_account = s.svm.get_account(&s.rules).unwrap();
    let mut data: &[u8] = &rules_account.data;
    let rules = agent_vault::state::VaultRules::try_deserialize(&mut data).unwrap();
    assert_eq!(rules.agents[0].spent_so_far, 300);
}

#[test]
fn overspend_is_refused() {
    let mut s = setup();
    let agent1 = s.agent1.insecure_clone();

    // First spend uses up 300 of the 1000 budget.
    spend(&mut s, &agent1, 300).unwrap();

    // Remaining budget is 700; asking for 800 must be refused.
    let res = spend(&mut s, &agent1, 800);
    assert!(res.is_err(), "overspend should have been refused");
    let err = res.unwrap_err();
    assert!(
        err.meta.logs.iter().any(|l| l.contains("BudgetExceeded")),
        "expected BudgetExceeded in logs, got: {:?}",
        err.meta.logs
    );

    // Balances must be unchanged by the refused spend.
    assert_eq!(token_balance(&s.svm, &s.vault), 10_000 - 300);
    assert_eq!(token_balance(&s.svm, &s.merchant_ata), 300);
}

#[test]
fn non_agent_signer_is_refused() {
    let mut s = setup();

    let stranger = Keypair::new();
    s.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();

    let res = spend(&mut s, &stranger, 100);
    assert!(res.is_err(), "non-agent spend should have been refused");
    let err = res.unwrap_err();
    assert!(
        err.meta.logs.iter().any(|l| l.contains("AgentNotFound")),
        "expected AgentNotFound in logs, got: {:?}",
        err.meta.logs
    );

    assert_eq!(token_balance(&s.svm, &s.vault), 10_000);
}

#[test]
fn window_resets_after_seven_days() {
    let mut s = setup();
    let agent1 = s.agent1.insecure_clone();

    // Spend the agent's full weekly budget.
    spend(&mut s, &agent1, 1000).unwrap();

    // Immediately spending again must fail: budget is exhausted for this window.
    let res = spend(&mut s, &agent1, 1);
    assert!(res.is_err(), "spend beyond exhausted budget should fail");

    // Advance the on-chain clock by just over 7 days. Also expire the
    // blockhash so the next transaction (same accounts/amount as the first
    // spend above) gets a distinct signature instead of being deduped as
    // an already-processed transaction.
    let mut clock: Clock = s.svm.get_sysvar();
    clock.unix_timestamp += WINDOW_SECONDS + 1;
    s.svm.set_sysvar(&clock);
    s.svm.expire_blockhash();

    // The window has rolled over, so the agent can spend up to its full
    // budget again.
    let res = spend(&mut s, &agent1, 1000);
    assert!(
        res.is_ok(),
        "spend should succeed after window reset: {res:?}"
    );

    assert_eq!(token_balance(&s.svm, &s.vault), 10_000 - 1000 - 1000);
    assert_eq!(token_balance(&s.svm, &s.merchant_ata), 1000 + 1000);
}

#[test]
fn spend_to_non_allowlisted_merchant_is_refused() {
    let mut s = setup();
    let agent1 = s.agent1.insecure_clone();

    // A fresh destination that was never allow-listed for agent1.
    let other_owner = Keypair::new();
    let other_ata = CreateAssociatedTokenAccount::new(
        &mut s.svm,
        &s.owner.insecure_clone(),
        &s.mint,
    )
    .owner(&other_owner.pubkey())
    .send()
    .unwrap();

    let accounts = ix_accounts::AgentSpend {
        agent: agent1.pubkey(),
        rules: s.rules,
        vault: s.vault,
        vault_authority: s.vault_authority,
        destination: other_ata,
        token_program: TOKEN_ID,
    };
    let res = call(
        &mut s.svm,
        &agent1,
        &[&agent1],
        ix_data::AgentSpend { amount: 1 }.data(),
        accounts.to_account_metas(None),
    );
    assert!(res.is_err(), "non-allow-listed merchant must be refused");
    let err = res.unwrap_err();
    assert!(
        err.meta.logs.iter().any(|l| l.contains("MerchantNotAllowed")),
        "expected MerchantNotAllowed in logs, got: {:?}",
        err.meta.logs
    );
}

#[test]
fn add_and_remove_merchant_gate_spending() {
    let mut s = setup();
    let agent1 = s.agent1.insecure_clone();

    let other_owner = Keypair::new();
    let other_ata = CreateAssociatedTokenAccount::new(
        &mut s.svm,
        &s.owner.insecure_clone(),
        &s.mint,
    )
    .owner(&other_owner.pubkey())
    .send()
    .unwrap();

    // Not allow-listed yet: spend to it fails.
    let accounts = ix_accounts::AgentSpend {
        agent: agent1.pubkey(),
        rules: s.rules,
        vault: s.vault,
        vault_authority: s.vault_authority,
        destination: other_ata,
        token_program: TOKEN_ID,
    };
    let res = call(
        &mut s.svm,
        &agent1,
        &[&agent1],
        ix_data::AgentSpend { amount: 50 }.data(),
        accounts.to_account_metas(None),
    );
    assert!(res.is_err(), "spend before allow-listing must fail");

    // Owner allow-lists it; the same spend now succeeds. Expire the
    // blockhash first so this otherwise-identical instruction (same
    // accounts/amount as the failed attempt above) gets a distinct
    // signature instead of being deduped as already-processed.
    add_merchant(&mut s, agent1.pubkey(), other_ata).unwrap();
    s.svm.expire_blockhash();
    let accounts = ix_accounts::AgentSpend {
        agent: agent1.pubkey(),
        rules: s.rules,
        vault: s.vault,
        vault_authority: s.vault_authority,
        destination: other_ata,
        token_program: TOKEN_ID,
    };
    let res = call(
        &mut s.svm,
        &agent1,
        &[&agent1],
        ix_data::AgentSpend { amount: 50 }.data(),
        accounts.to_account_metas(None),
    );
    assert!(res.is_ok(), "spend after allow-listing should succeed: {res:?}");
    assert_eq!(token_balance(&s.svm, &other_ata), 50);

    // Owner removes it; spending there is refused again.
    remove_merchant(&mut s, agent1.pubkey(), other_ata).unwrap();
    s.svm.expire_blockhash();
    let accounts = ix_accounts::AgentSpend {
        agent: agent1.pubkey(),
        rules: s.rules,
        vault: s.vault,
        vault_authority: s.vault_authority,
        destination: other_ata,
        token_program: TOKEN_ID,
    };
    let res = call(
        &mut s.svm,
        &agent1,
        &[&agent1],
        ix_data::AgentSpend { amount: 50 }.data(),
        accounts.to_account_metas(None),
    );
    assert!(res.is_err(), "spend after removal must fail again");
}

#[test]
fn add_merchant_rejects_duplicates_and_overflow() {
    let mut s = setup();
    let agent1_key = s.agent1.pubkey();

    // merchant_ata is already allow-listed for agent1 by setup(). Expire the
    // blockhash so this identical-looking instruction (same accounts/args
    // as setup()'s original add_merchant call) actually re-executes instead
    // of being deduped as already-processed, and hits the real program
    // check.
    s.svm.expire_blockhash();
    let merchant_ata = s.merchant_ata;
    let res = add_merchant(&mut s, agent1_key, merchant_ata);
    assert!(res.is_err(), "duplicate merchant must be refused");
    assert!(res
        .unwrap_err()
        .meta
        .logs
        .iter()
        .any(|l| l.contains("MerchantAlreadyAllowed")));

    // 3 more slots remain (4 total, 1 used by merchant_ata); fill them.
    for _ in 0..3 {
        let m = Keypair::new().pubkey();
        add_merchant(&mut s, agent1_key, m).unwrap();
    }

    // A 5th merchant must be refused: all 4 slots are full.
    let m = Keypair::new().pubkey();
    let res = add_merchant(&mut s, agent1_key, m);
    assert!(res.is_err(), "5th merchant must be refused: slots full");
    assert!(res
        .unwrap_err()
        .meta
        .logs
        .iter()
        .any(|l| l.contains("MerchantSlotsFull")));
}

#[test]
fn revoked_agent_cannot_spend_until_unrevoked() {
    let mut s = setup();
    let agent1 = s.agent1.insecure_clone();

    set_agent_revoked(&mut s, agent1.pubkey(), true).unwrap();

    let res = spend(&mut s, &agent1, 100);
    assert!(res.is_err(), "revoked agent must not be able to spend");
    assert!(res
        .unwrap_err()
        .meta
        .logs
        .iter()
        .any(|l| l.contains("AgentRevoked")));

    set_agent_revoked(&mut s, agent1.pubkey(), false).unwrap();
    s.svm.expire_blockhash();

    let res = spend(&mut s, &agent1, 100);
    assert!(res.is_ok(), "unrevoked agent should be able to spend again: {res:?}");
    assert_eq!(token_balance(&s.svm, &s.merchant_ata), 100);
}

#[test]
fn owner_can_withdraw_and_overdraw_is_refused() {
    let mut s = setup();

    let vault_before = token_balance(&s.svm, &s.vault);
    let owner_before = token_balance(&s.svm, &s.owner_ata);

    let res = withdraw(&mut s, 4_000);
    assert!(res.is_ok(), "owner withdrawal should succeed: {res:?}");
    assert_eq!(token_balance(&s.svm, &s.vault), vault_before - 4_000);
    assert_eq!(token_balance(&s.svm, &s.owner_ata), owner_before + 4_000);

    // Only 6_000 remains; withdrawing more must be refused, and the vault
    // balance must be unchanged by the failed attempt.
    let res = withdraw(&mut s, 6_001);
    assert!(res.is_err(), "overdraw must be refused");
    assert!(res
        .unwrap_err()
        .meta
        .logs
        .iter()
        .any(|l| l.contains("InsufficientVaultBalance")));
    assert_eq!(token_balance(&s.svm, &s.vault), vault_before - 4_000);
}

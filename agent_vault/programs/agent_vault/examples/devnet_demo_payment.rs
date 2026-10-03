//! Sets up (or reuses) one demo vault on devnet and has one agent pay one
//! merchant. Re-runnable and generic: each step checks on-chain state first
//! and is skipped if it was already done, so running this again for the
//! same agent+merchant just confirms everything is in place and sends one
//! more payment.
//!
//! Usage (all arguments optional, defaults shown):
//!   cargo run --release --features no-entrypoint --example devnet_demo_payment -- \
//!     [agent-file] [merchant-file] [weekly-budget] [payment-amount]
//!
//! `agent-file`/`merchant-file` are keypair filenames (without `.json`)
//! inside ~/agent-vault/keys/, e.g. `agent-second`, `merchant-talabat`.
//! `weekly-budget` only matters the first time an agent is registered (it's
//! ignored if the agent already exists). Defaults: agent-grocery,
//! merchant-noon, budget 50, payment 10 — i.e. running with no arguments
//! reproduces the original grocery-agent-pays-Noon demo.
//!
//! Reads keys from ~/.config/solana/id.json (owner/payer) and
//! ~/agent-vault/keys/{agent-file,merchant-file,demo-usd-mint}.json.
//! Never prints any private key.

use agent_vault::{
    accounts as ix_accounts, instruction as ix_data, RULES_SEED, VAULT_AUTHORITY_SEED, VAULT_SEED,
};
use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::Instruction, system_program},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use solana_client::rpc_client::RpcClient;
use solana_keypair::{read_keypair_file, Keypair};
use solana_message::{Message, VersionedMessage};
use solana_signature::Signature;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use spl_associated_token_account::{
    get_associated_token_address_with_program_id, instruction::create_associated_token_account,
};

const DEVNET_URL: &str = "https://api.devnet.solana.com";
const DEFAULT_AGENT_FILE: &str = "agent-grocery";
const DEFAULT_MERCHANT_FILE: &str = "merchant-noon";
const DEFAULT_WEEKLY_BUDGET: u64 = 50;
const DEFAULT_PAYMENT_AMOUNT: u64 = 10;
const DEPOSIT_TOP_UP: u64 = 200;
const TOKEN_PROGRAM_ID: Pubkey = anchor_spl::token::ID;

fn home_path(rel: &str) -> std::path::PathBuf {
    let home = std::env::var("HOME").expect("HOME environment variable not set");
    std::path::Path::new(&home).join(rel)
}

fn send(
    client: &RpcClient,
    payer: &Keypair,
    extra_signers: &[&Keypair],
    ix: Instruction,
) -> anyhow::Result<Signature> {
    let blockhash = client.get_latest_blockhash()?;
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);

    let mut signers: Vec<&Keypair> = vec![payer];
    for s in extra_signers {
        if s.pubkey() != payer.pubkey() {
            signers.push(s);
        }
    }

    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers)?;
    Ok(client.send_and_confirm_transaction(&tx)?)
}

fn fetch_rules(client: &RpcClient, rules: &Pubkey) -> anyhow::Result<agent_vault::state::VaultRules> {
    let account = client.get_account(rules)?;
    let mut data: &[u8] = &account.data;
    Ok(agent_vault::state::VaultRules::try_deserialize(&mut data)?)
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let agent_file = args.get(1).map(String::as_str).unwrap_or(DEFAULT_AGENT_FILE);
    let merchant_file = args
        .get(2)
        .map(String::as_str)
        .unwrap_or(DEFAULT_MERCHANT_FILE);
    let weekly_budget: u64 = args
        .get(3)
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(DEFAULT_WEEKLY_BUDGET);
    let payment_amount: u64 = args
        .get(4)
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(DEFAULT_PAYMENT_AMOUNT);

    let client = RpcClient::new(DEVNET_URL.to_string());
    let program_id = agent_vault::id();

    let owner = read_keypair_file(home_path(".config/solana/id.json"))
        .map_err(|e| anyhow::anyhow!("reading owner keypair: {e}"))?;
    let agent = read_keypair_file(home_path(&format!("agent-vault/keys/{agent_file}.json")))
        .map_err(|e| anyhow::anyhow!("reading {agent_file} keypair: {e}"))?;
    let merchant = read_keypair_file(home_path(&format!("agent-vault/keys/{merchant_file}.json")))
        .map_err(|e| anyhow::anyhow!("reading {merchant_file} keypair: {e}"))?;
    let mint_kp = read_keypair_file(home_path("agent-vault/keys/demo-usd-mint.json"))
        .map_err(|e| anyhow::anyhow!("reading demo-usd-mint keypair: {e}"))?;
    let mint = mint_kp.pubkey();

    let rules =
        Pubkey::find_program_address(&[RULES_SEED, owner.pubkey().as_ref(), mint.as_ref()], &program_id).0;
    let vault_authority =
        Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED, rules.as_ref()], &program_id).0;
    let vault = Pubkey::find_program_address(&[VAULT_SEED, rules.as_ref()], &program_id).0;
    let owner_ata = get_associated_token_address_with_program_id(&owner.pubkey(), &mint, &TOKEN_PROGRAM_ID);
    let merchant_ata =
        get_associated_token_address_with_program_id(&merchant.pubkey(), &mint, &TOKEN_PROGRAM_ID);

    println!("Program:            {program_id}");
    println!("Owner:              {}", owner.pubkey());
    println!("Agent ({agent_file}):   {}", agent.pubkey());
    println!("Merchant ({merchant_file}): {}", merchant.pubkey());
    println!("Demo USD mint:      {mint}");
    println!("Rules PDA:          {rules}");
    println!("Vault:              {vault}");
    println!();

    if client.get_account(&rules).is_err() {
        println!("Initializing vault...");
        let accounts = ix_accounts::InitializeVault {
            owner: owner.pubkey(),
            mint,
            rules,
            vault_authority,
            vault,
            token_program: TOKEN_PROGRAM_ID,
            system_program: system_program::ID,
        };
        let ix = Instruction::new_with_bytes(
            program_id,
            &ix_data::InitializeVault {}.data(),
            accounts.to_account_metas(None),
        );
        println!("  tx: {}", send(&client, &owner, &[], ix)?);
    } else {
        println!("Vault already initialized, skipping.");
    }

    let mut rules_state = fetch_rules(&client, &rules)?;

    if !rules_state.agents.iter().any(|a| a.key == agent.pubkey()) {
        println!("Registering {agent_file} (weekly budget {weekly_budget})...");
        let accounts = ix_accounts::AddAgent {
            owner: owner.pubkey(),
            rules,
        };
        let ix = Instruction::new_with_bytes(
            program_id,
            &ix_data::AddAgent {
                agent: agent.pubkey(),
                weekly_budget,
            }
            .data(),
            accounts.to_account_metas(None),
        );
        println!("  tx: {}", send(&client, &owner, &[], ix)?);
        rules_state = fetch_rules(&client, &rules)?;
    } else {
        println!("{agent_file} already registered, skipping.");
    }

    if client.get_account(&merchant_ata).is_err() {
        println!("Creating {merchant_file}'s Demo USD token account...");
        let ix =
            create_associated_token_account(&owner.pubkey(), &merchant.pubkey(), &mint, &TOKEN_PROGRAM_ID);
        println!("  tx: {}", send(&client, &owner, &[], ix)?);
    }

    let already_allowed = rules_state
        .agents
        .iter()
        .find(|a| a.key == agent.pubkey())
        .map(|a| a.merchants.iter().any(|m| *m == merchant_ata))
        .unwrap_or(false);

    if !already_allowed {
        println!("Allow-listing {merchant_file} for {agent_file}...");
        let accounts = ix_accounts::ManageAgent {
            owner: owner.pubkey(),
            rules,
        };
        let ix = Instruction::new_with_bytes(
            program_id,
            &ix_data::AddMerchant {
                agent: agent.pubkey(),
                merchant: merchant_ata,
            }
            .data(),
            accounts.to_account_metas(None),
        );
        println!("  tx: {}", send(&client, &owner, &[], ix)?);
    } else {
        println!("{merchant_file} already allow-listed for {agent_file}, skipping.");
    }

    let vault_balance = client
        .get_token_account_balance(&vault)
        .ok()
        .and_then(|b| b.amount.parse::<u64>().ok())
        .unwrap_or(0);
    if vault_balance < payment_amount {
        println!("Depositing {DEPOSIT_TOP_UP} Demo USD into the vault...");
        let accounts = ix_accounts::Deposit {
            owner: owner.pubkey(),
            rules,
            vault,
            owner_token_account: owner_ata,
            token_program: TOKEN_PROGRAM_ID,
        };
        let ix = Instruction::new_with_bytes(
            program_id,
            &ix_data::Deposit {
                amount: DEPOSIT_TOP_UP,
            }
            .data(),
            accounts.to_account_metas(None),
        );
        println!("  tx: {}", send(&client, &owner, &[], ix)?);
    } else {
        println!("Vault already funded ({vault_balance} Demo USD), skipping deposit.");
    }

    println!("{agent_file} paying {merchant_file} {payment_amount} Demo USD...");
    let accounts = ix_accounts::AgentSpend {
        agent: agent.pubkey(),
        rules,
        vault,
        vault_authority,
        destination: merchant_ata,
        token_program: TOKEN_PROGRAM_ID,
    };
    let ix = Instruction::new_with_bytes(
        program_id,
        &ix_data::AgentSpend {
            amount: payment_amount,
        }
        .data(),
        accounts.to_account_metas(None),
    );
    let sig = send(&client, &owner, &[&agent], ix)?;
    println!("  tx: {sig}");
    println!();
    println!("Solscan (devnet): https://solscan.io/tx/{sig}?cluster=devnet");

    Ok(())
}

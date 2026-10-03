//! agent-pay <merchant> <amount>
//!
//! Has the "grocery" agent (~/agent-vault/keys/agent-grocery.json) pay a
//! catalogue merchant (noon | talabat | zomato | ubereats) out of the vault
//! owned by VAULT_OWNER below, on devnet.
//!
//! Sends with `skip_preflight: true` so a refused payment still lands
//! on-chain as a failed transaction, visible on Solscan, instead of being
//! rejected client-side before ever reaching the network.
//!
//! Fee payer (and, if needed, creator of the merchant's Demo USD token
//! account — idempotently, a no-op if it already exists) is
//! ~/.config/solana/id.json, the same wallet that holds upgrade authority
//! and the Demo USD mint authority throughout this project.
//!
//! Never prints any private key.

use agent_vault::{accounts as ix_accounts, instruction as ix_data, RULES_SEED, VAULT_AUTHORITY_SEED, VAULT_SEED};
use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use solana_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_keypair::read_keypair_file;
use solana_message::{Message, VersionedMessage};
use solana_rpc_client_api::config::RpcSendTransactionConfig;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;
use solana_transaction_status_client_types::{option_serializer::OptionSerializer, UiTransactionEncoding};
use spl_associated_token_account::instruction::create_associated_token_account_idempotent;
use std::{thread::sleep, time::Duration};

const DEVNET_URL: &str = "https://api.devnet.solana.com";
const TOKEN_PROGRAM_ID: Pubkey = anchor_spl::token::ID;

/// The vault owner — your Phantom wallet, the one connected in the M6
/// control panel. Update this if you create a vault under a different
/// owner.
const VAULT_OWNER: &str = "7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg";

/// Straight from the program's IDL (target/idl/agent_vault.json `errors`),
/// so a refusal prints the same message a Rust caller would see in
/// on-chain logs.
const PROGRAM_ERRORS: &[(u32, &str)] = &[
    (6000, "Vault already has the maximum number of agents registered"),
    (6001, "This pubkey is already registered as an agent on this vault"),
    (6002, "Weekly budget must be greater than zero"),
    (6003, "Signer is not a registered agent on this vault"),
    (6004, "This agent has been revoked and cannot spend"),
    (6005, "Spend amount exceeds the agent's remaining budget for this window"),
    (6006, "Destination is not on this agent's merchant allow-list (merchant not allowed for this agent)"),
    (6007, "This agent already has the maximum number of merchants allow-listed"),
    (6008, "This merchant is already allow-listed for this agent"),
    (6009, "This merchant is not on this agent's allow-list"),
    (6010, "Merchant pubkey cannot be the default (empty) pubkey"),
    (6011, "Vault does not hold enough tokens to cover this withdrawal"),
];

fn explain_code(code: u32) -> String {
    PROGRAM_ERRORS
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, msg)| msg.to_string())
        .unwrap_or_else(|| format!("Unrecognized program error code {code}"))
}

/// Pulls a `Custom(<code>)` instruction-error number out of a transaction
/// error's Debug text. Simpler and more robust than matching the exact
/// nested enum shape by hand, and mirrors the same approach used in the
/// app's front-end error translator.
fn extract_custom_code(debug_str: &str) -> Option<u32> {
    let idx = debug_str.find("Custom(")?;
    let rest = &debug_str[idx + "Custom(".len()..];
    let end = rest.find(')')?;
    rest[..end].trim().parse().ok()
}

fn home_path(rel: &str) -> std::path::PathBuf {
    let home = std::env::var("HOME").expect("HOME environment variable not set");
    std::path::Path::new(&home).join(rel)
}

fn merchant_key_file(name: &str) -> anyhow::Result<&'static str> {
    Ok(match name.to_lowercase().replace(['-', '_', ' '], "").as_str() {
        "noon" => "merchant-noon.json",
        "talabat" => "merchant-talabat.json",
        "zomato" => "merchant-zomato.json",
        "ubereats" => "merchant-ubereats.json",
        other => anyhow::bail!(
            "Unknown merchant '{other}'. Choose one of: noon, talabat, zomato, ubereats"
        ),
    })
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        anyhow::bail!("Usage: agent-pay <noon|talabat|zomato|ubereats> <amount>");
    }
    let merchant_label = &args[1];
    let merchant_file = merchant_key_file(merchant_label)?;
    let amount: u64 = args[2]
        .parse()
        .map_err(|_| anyhow::anyhow!("Amount must be a whole number (Demo USD has 0 decimals)"))?;

    let client = RpcClient::new_with_commitment(DEVNET_URL.to_string(), CommitmentConfig::confirmed());
    let program_id = agent_vault::id();

    let fee_payer = read_keypair_file(home_path(".config/solana/id.json"))
        .map_err(|e| anyhow::anyhow!("reading fee-payer keypair: {e}"))?;
    let agent = read_keypair_file(home_path("agent-vault/keys/agent-grocery.json"))
        .map_err(|e| anyhow::anyhow!("reading agent-grocery keypair: {e}"))?;
    let merchant_kp = read_keypair_file(home_path(&format!("agent-vault/keys/{merchant_file}")))
        .map_err(|e| anyhow::anyhow!("reading {merchant_file} keypair: {e}"))?;
    let mint_kp = read_keypair_file(home_path("agent-vault/keys/demo-usd-mint.json"))
        .map_err(|e| anyhow::anyhow!("reading demo-usd-mint keypair: {e}"))?;
    let mint = mint_kp.pubkey();
    let owner: Pubkey = VAULT_OWNER
        .parse()
        .map_err(|_| anyhow::anyhow!("VAULT_OWNER constant is not a valid pubkey"))?;

    let rules = Pubkey::find_program_address(&[RULES_SEED, owner.as_ref(), mint.as_ref()], &program_id).0;
    let vault_authority =
        Pubkey::find_program_address(&[VAULT_AUTHORITY_SEED, rules.as_ref()], &program_id).0;
    let vault = Pubkey::find_program_address(&[VAULT_SEED, rules.as_ref()], &program_id).0;
    let merchant_ata = spl_associated_token_account::get_associated_token_address_with_program_id(
        &merchant_kp.pubkey(),
        &mint,
        &TOKEN_PROGRAM_ID,
    );

    println!("Agent (grocery):     {}", agent.pubkey());
    println!("Merchant ({merchant_label}):  {}", merchant_kp.pubkey());
    println!("Vault owner:         {owner}");
    println!("Rules PDA:           {rules}");
    println!("Vault:               {vault}");
    println!("Merchant Demo USD:   {merchant_ata}");
    println!("Amount:              {amount} Demo USD");
    println!();

    if client.get_account(&merchant_ata).is_err() {
        println!("Merchant token account doesn't exist yet — creating it (idempotent)...");
        let ix = create_associated_token_account_idempotent(
            &fee_payer.pubkey(),
            &merchant_kp.pubkey(),
            &mint,
            &TOKEN_PROGRAM_ID,
        );
        let blockhash = client.get_latest_blockhash()?;
        let msg = Message::new_with_blockhash(&[ix], Some(&fee_payer.pubkey()), &blockhash);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&fee_payer])?;
        let sig = client.send_and_confirm_transaction(&tx)?;
        println!("  tx: {sig}");
        println!();
    }

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
        &ix_data::AgentSpend { amount }.data(),
        accounts.to_account_metas(None),
    );

    let blockhash = client.get_latest_blockhash()?;
    let msg = Message::new_with_blockhash(&[ix], Some(&fee_payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&fee_payer, &agent])?;

    println!("Sending payment (skip-preflight — a refusal will still land on-chain)...");
    let signature = client.send_transaction_with_config(
        &tx,
        RpcSendTransactionConfig {
            skip_preflight: true,
            ..Default::default()
        },
    )?;
    let solscan = format!("https://solscan.io/tx/{signature}?cluster=devnet");
    println!("  tx: {signature}");
    println!("  Solscan: {solscan}");
    println!();

    print!("Waiting for the network to process it");
    let mut landed = false;
    for _ in 0..30 {
        let statuses = client.get_signature_statuses(&[signature])?.value;
        if let Some(Some(status)) = statuses.into_iter().next() {
            if status.satisfies_commitment(CommitmentConfig::confirmed()) {
                landed = true;
                break;
            }
        }
        print!(".");
        use std::io::Write;
        std::io::stdout().flush().ok();
        sleep(Duration::from_millis(1000));
    }
    println!();

    if !landed {
        println!("Still not confirmed after ~30s — check the Solscan link above directly.");
        return Ok(());
    }

    let details = client.get_transaction(&signature, UiTransactionEncoding::Json)?;
    let meta = details
        .transaction
        .meta
        .ok_or_else(|| anyhow::anyhow!("transaction landed but has no metadata"))?;

    match meta.err {
        None => {
            println!("SUCCESS — {} paid {merchant_label} {amount} Demo USD.", agent.pubkey());
        }
        Some(err) => {
            println!("REFUSED on-chain.");
            let err_debug = format!("{err:?}");
            if let Some(code) = extract_custom_code(&err_debug) {
                println!("Reason: {}", explain_code(code));
            } else {
                println!("Reason (raw, not a program custom error): {err_debug}");
            }
            if let OptionSerializer::Some(logs) = meta.log_messages {
                println!("Logs:");
                for l in logs {
                    println!("  {l}");
                }
            }
        }
    }
    println!();
    println!("Solscan: {solscan}");

    Ok(())
}

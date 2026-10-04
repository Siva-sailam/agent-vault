// Instruction building, account decoding, and error translation for the
// agent_vault program — the Node/agent-service counterpart of
// app/src/lib/program.ts. Kept as a separate copy rather than a shared
// import: this file runs in a plain Node CLI process (holds a private
// key), the other runs in the browser bundle (never does) — two different
// runtimes that happen to use the same on-chain program, not two halves of
// one build. See NOTES.md for the full reasoning.
import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBooleanDecoder,
  getU64Decoder,
  getU64Encoder,
  getProgramDerivedAddress,
} from '@solana/kit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The program's own generated IDL — single source of truth for
// discriminators and error codes/messages, same file the front end copies.
const idl = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'agent_vault', 'target', 'idl', 'agent_vault.json'), 'utf8'),
);

export const PROGRAM_ADDRESS = address('B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj');
export const TOKEN_PROGRAM_ADDRESS = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');

const RULES_SEED = new TextEncoder().encode('rules');
const VAULT_SEED = new TextEncoder().encode('vault');
const VAULT_AUTHORITY_SEED = new TextEncoder().encode('vault_authority');

export const MAX_MERCHANTS_PER_AGENT = 4;
export const WINDOW_SECONDS = 7 * 24 * 60 * 60;

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
const u64Encoder = getU64Encoder();
const u64Decoder = getU64Decoder();
const boolDecoder = getBooleanDecoder();

function discriminator(name) {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`Instruction "${name}" not found in IDL`);
  return Uint8Array.from(ix.discriminator);
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function signerMeta(signer, role) {
  return { address: signer.address, role, signer };
}
const readonly = (addr) => ({ address: addr, role: AccountRole.READONLY });
const writable = (addr) => ({ address: addr, role: AccountRole.WRITABLE });

export async function getVaultPdas(owner, mint) {
  const [rules] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [RULES_SEED, addressEncoder.encode(owner), addressEncoder.encode(mint)],
  });
  const [vaultAuthority] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [VAULT_AUTHORITY_SEED, addressEncoder.encode(rules)],
  });
  const [vault] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ADDRESS,
    seeds: [VAULT_SEED, addressEncoder.encode(rules)],
  });
  return { rules, vaultAuthority, vault };
}

export async function getAssociatedTokenAddress(owner, mint) {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [addressEncoder.encode(owner), addressEncoder.encode(TOKEN_PROGRAM_ADDRESS), addressEncoder.encode(mint)],
  });
  return ata;
}

/** Idempotent create — a no-op if the account already exists. See M6 NOTES
 * for why this variant (discriminant 1), not the plain "Create" (0). */
export function ixEnsureAssociatedTokenAccount(payerSigner, owner, mint, ata) {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      signerMeta(payerSigner, AccountRole.WRITABLE_SIGNER),
      writable(ata),
      readonly(owner),
      readonly(mint),
      readonly(SYSTEM_PROGRAM_ADDRESS),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: Uint8Array.from([1]),
  };
}

export function ixAgentSpend(agentSigner, rules, vault, vaultAuthority, destination, amount) {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [
      signerMeta(agentSigner, AccountRole.READONLY_SIGNER),
      writable(rules),
      writable(vault),
      readonly(vaultAuthority),
      writable(destination),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concat(discriminator('agent_spend'), u64Encoder.encode(amount)),
  };
}

const AGENT_SIZE = 32 + 8 + 8 + 8 + 1 + MAX_MERCHANTS_PER_AGENT * 32; // 185

export function decodeVaultRules(data) {
  let o = 8;
  const owner = addressDecoder.decode(data.slice(o, o + 32));
  o += 32;
  const mint = addressDecoder.decode(data.slice(o, o + 32));
  o += 32;
  const vault = addressDecoder.decode(data.slice(o, o + 32));
  o += 32;
  o += 3; // bump, vault_bump, vault_authority_bump
  const agentCount = data[o];
  o += 1;

  const agents = [];
  for (let i = 0; i < 2; i++) {
    const base = o + i * AGENT_SIZE;
    const key = addressDecoder.decode(data.slice(base, base + 32));
    const weeklyBudget = u64Decoder.decode(data.slice(base + 32, base + 40));
    const spentSoFar = u64Decoder.decode(data.slice(base + 40, base + 48));
    const windowStart = Number(u64Decoder.decode(data.slice(base + 48, base + 56)));
    const revoked = boolDecoder.decode(data.slice(base + 56, base + 57));
    const merchants = [];
    for (let m = 0; m < MAX_MERCHANTS_PER_AGENT; m++) {
      const mBase = base + 57 + m * 32;
      merchants.push(addressDecoder.decode(data.slice(mBase, mBase + 32)));
    }
    agents.push({ key, weeklyBudget, spentSoFar, windowStart, revoked, merchants });
  }
  return { owner, mint, vault, agentCount, agents };
}

const PROGRAM_ERRORS = new Map(idl.errors.map((e) => [e.code, e.msg]));

/** Turns a Custom(<code>) instruction error into the IDL's plain-English
 * message. Accepts either the raw RPC `err` object or its JSON string form. */
export function explainTransactionError(err) {
  if (err == null) return null;
  const text = typeof err === 'string' ? err : JSON.stringify(err, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  // The Custom code sometimes serializes as a quoted string (e.g. when it
  // started life as a BigInt upstream) rather than a bare number — match
  // both forms.
  const match = text.match(/"Custom":\s*"?(\d+)"?/) ?? text.match(/Custom\((\d+)\)/);
  if (match) {
    const code = Number(match[1]);
    return PROGRAM_ERRORS.get(code) ?? `Unrecognized program error code ${code}`;
  }
  return `Refused (raw error, not a program custom error): ${text}`;
}

/** Like explainTransactionError, but returns { name, code, msg } for a
 * program custom error (e.g. MerchantNotAllowed / 6006), else null. */
export function programErrorInfo(err) {
  if (err == null) return null;
  const text = typeof err === 'string' ? err : JSON.stringify(err, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const match = text.match(/"Custom":\s*"?(\d+)"?/) ?? text.match(/Custom\((\d+)\)/);
  const e = match && idl.errors.find((x) => x.code === Number(match[1]));
  return e ? { name: e.name, code: e.code, msg: e.msg } : null;
}

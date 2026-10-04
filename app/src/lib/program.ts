// Hand-written instruction encoders/decoders for the agent_vault program.
//
// WHY hand-written instead of a generated (Codama) client: this program has
// only 8 instructions, each with 0-3 simple arguments (Pubkey, u64, bool) —
// no enums, no vectors, no nested generics. A full IDL -> Codama -> Kit
// codegen pipeline is the right call for a program with a large or evolving
// instruction set; for this one, hand-writing the (tiny, fully-controlled)
// encode/decode logic directly against @solana/kit's own codec primitives is
// less machinery and easier to audit line-by-line. Every discriminator and
// error code below is read from the program's own generated IDL
// (src/idl/agent_vault.json) at runtime rather than re-typed by hand, so
// there is exactly one source of truth for those.
import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBooleanDecoder,
  getBooleanEncoder,
  getProgramDerivedAddress,
  getU64Decoder,
  getU64Encoder,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type TransactionSigner,
} from '@solana/kit';
import idl from '../idl/agent_vault.json';

export const PROGRAM_ADDRESS = address('B4YLQmwWCt8fPu23hhpEeV4LZSkoKHsWQtWk15kc8Ajj');
export const TOKEN_PROGRAM_ADDRESS = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');

const RULES_SEED = new TextEncoder().encode('rules');
const VAULT_SEED = new TextEncoder().encode('vault');
const VAULT_AUTHORITY_SEED = new TextEncoder().encode('vault_authority');

export const MAX_AGENTS = 2;
export const MAX_MERCHANTS_PER_AGENT = 4;
export const WINDOW_SECONDS = 7 * 24 * 60 * 60;

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
const u64Encoder = getU64Encoder();
const u64Decoder = getU64Decoder();
const boolEncoder = getBooleanEncoder();
const boolDecoder = getBooleanDecoder();

function discriminator(name: string): Uint8Array {
  const ix = (idl.instructions as Array<{ name: string; discriminator: number[] }>).find(
    (i) => i.name === name,
  );
  if (!ix) throw new Error(`Instruction "${name}" not found in IDL`);
  return Uint8Array.from(ix.discriminator);
}

function concat(...parts: (Uint8Array | ReadonlyUint8Array)[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p as ArrayLike<number>, offset);
    offset += p.length;
  }
  return out;
}

/** Account metas for the connected wallet acting as fee-payer + owner signer. */
function ownerSigner(payer: TransactionSigner) {
  return { address: payer.address, role: AccountRole.WRITABLE_SIGNER, signer: payer } as const;
}
function readonly(addr: Address) {
  return { address: addr, role: AccountRole.READONLY } as const;
}
function writable(addr: Address) {
  return { address: addr, role: AccountRole.WRITABLE } as const;
}

// ---------------------------------------------------------------------------
// PDA + associated-token-account derivation (all pure, all public math — no
// private key material involved anywhere in this section).
// ---------------------------------------------------------------------------

export async function getVaultPdas(owner: Address, mint: Address) {
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

export async function getAssociatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      addressEncoder.encode(owner),
      addressEncoder.encode(TOKEN_PROGRAM_ADDRESS),
      addressEncoder.encode(mint),
    ],
  });
  return ata;
}

// ---------------------------------------------------------------------------
// Instruction builders. One function per program instruction, named to match
// lib.rs. All take the connected wallet as `payer` (owner + fee payer).
// ---------------------------------------------------------------------------

/** Ensures `ata` exists, as a no-op if it already does. Uses
 * `CreateIdempotent` (discriminant 1), not `Create` (0): `Create` hard-fails
 * with `IllegalOwner` if the account is already initialized, which made an
 * earlier version of this app fail (surfaced by Phantom as a misleading
 * "not enough SOL" message, its generic fallback for any simulation
 * failure) whenever it redundantly re-included this instruction for an
 * account that already existed. Always including this idempotent version
 * unconditionally — rather than trying to track "does it already exist?"
 * client-side and only sometimes include it — removes that whole class of
 * bug instead of just patching around one instance of it. Verified against
 * a real devnet simulation for both the missing- and already-exists cases. */
export function ixEnsureAssociatedTokenAccount(
  payer: TransactionSigner,
  owner: Address,
  mint: Address,
  ata: Address,
): Instruction {
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      ownerSigner(payer),
      writable(ata),
      readonly(owner),
      readonly(mint),
      readonly(SYSTEM_PROGRAM_ADDRESS),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: Uint8Array.from([1]),
  };
}

export function ixInitializeVault(
  payer: TransactionSigner,
  mint: Address,
  rules: Address,
  vaultAuthority: Address,
  vault: Address,
): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [
      ownerSigner(payer),
      readonly(mint),
      writable(rules),
      readonly(vaultAuthority),
      writable(vault),
      readonly(TOKEN_PROGRAM_ADDRESS),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: discriminator('initialize_vault'),
  };
}

export function ixAddAgent(
  payer: TransactionSigner,
  rules: Address,
  agent: Address,
  weeklyBudget: bigint,
): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [ownerSigner(payer), writable(rules)],
    data: concat(discriminator('add_agent'), addressEncoder.encode(agent), u64Encoder.encode(weeklyBudget)),
  };
}

export function ixDeposit(
  payer: TransactionSigner,
  rules: Address,
  vault: Address,
  ownerTokenAccount: Address,
  amount: bigint,
): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [
      ownerSigner(payer),
      readonly(rules),
      writable(vault),
      writable(ownerTokenAccount),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concat(discriminator('deposit'), u64Encoder.encode(amount)),
  };
}

/** Plain SPL Token `Transfer` (instruction 3): the owner pays straight from
 * their own token account — no vault, no agent involved. */
export function ixTokenTransfer(
  owner: TransactionSigner,
  source: Address,
  destination: Address,
  amount: bigint,
): Instruction {
  return {
    programAddress: TOKEN_PROGRAM_ADDRESS,
    accounts: [writable(source), writable(destination), ownerSigner(owner)],
    data: concat(Uint8Array.of(3), u64Encoder.encode(amount)),
  };
}

export function ixAddMerchant(
  payer: TransactionSigner,
  rules: Address,
  agent: Address,
  merchant: Address,
): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [ownerSigner(payer), writable(rules)],
    data: concat(discriminator('add_merchant'), addressEncoder.encode(agent), addressEncoder.encode(merchant)),
  };
}

export function ixRemoveMerchant(
  payer: TransactionSigner,
  rules: Address,
  agent: Address,
  merchant: Address,
): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [ownerSigner(payer), writable(rules)],
    data: concat(discriminator('remove_merchant'), addressEncoder.encode(agent), addressEncoder.encode(merchant)),
  };
}

export function ixSetAgentRevoked(
  payer: TransactionSigner,
  rules: Address,
  agent: Address,
  revoked: boolean,
): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [ownerSigner(payer), writable(rules)],
    data: concat(discriminator('set_agent_revoked'), addressEncoder.encode(agent), boolEncoder.encode(revoked)),
  };
}

export function ixWithdraw(
  payer: TransactionSigner,
  rules: Address,
  vault: Address,
  vaultAuthority: Address,
  ownerTokenAccount: Address,
  amount: bigint,
): Instruction {
  return {
    programAddress: PROGRAM_ADDRESS,
    accounts: [
      ownerSigner(payer),
      readonly(rules),
      writable(vault),
      readonly(vaultAuthority),
      writable(ownerTokenAccount),
      readonly(TOKEN_PROGRAM_ADDRESS),
    ],
    data: concat(discriminator('withdraw'), u64Encoder.encode(amount)),
  };
}

// ---------------------------------------------------------------------------
// VaultRules account decoding. Byte layout mirrors state.rs exactly:
//   8   discriminator
//   32  owner
//   32  mint
//   32  vault
//   1   bump
//   1   vault_bump
//   1   vault_authority_bump
//   1   agent_count
//   2 * (32 key + 8 weekly_budget + 8 spent_so_far + 8 window_start + 1 revoked + 4*32 merchants)
// ---------------------------------------------------------------------------

export type AgentState = {
  key: Address;
  weeklyBudget: bigint;
  spentSoFar: bigint;
  windowStart: number; // unix seconds
  revoked: boolean;
  merchants: Address[];
};

export type VaultRulesState = {
  owner: Address;
  mint: Address;
  vault: Address;
  agentCount: number;
  agents: AgentState[];
};

const AGENT_SIZE = 32 + 8 + 8 + 8 + 1 + MAX_MERCHANTS_PER_AGENT * 32; // 185

export function decodeVaultRules(data: Uint8Array): VaultRulesState {
  let o = 8; // skip discriminator
  const owner = addressDecoder.decode(data.slice(o, o + 32));
  o += 32;
  const mint = addressDecoder.decode(data.slice(o, o + 32));
  o += 32;
  const vault = addressDecoder.decode(data.slice(o, o + 32));
  o += 32;
  o += 1; // bump
  o += 1; // vault_bump
  o += 1; // vault_authority_bump
  const agentCount = data[o];
  o += 1;

  const agents: AgentState[] = [];
  for (let i = 0; i < MAX_AGENTS; i++) {
    const base = o + i * AGENT_SIZE;
    const key = addressDecoder.decode(data.slice(base, base + 32));
    const weeklyBudget = u64Decoder.decode(data.slice(base + 32, base + 40));
    const spentSoFar = u64Decoder.decode(data.slice(base + 40, base + 48));
    const windowStart = Number(u64Decoder.decode(data.slice(base + 48, base + 56)));
    const revoked = boolDecoder.decode(data.slice(base + 56, base + 57));
    const merchants: Address[] = [];
    for (let m = 0; m < MAX_MERCHANTS_PER_AGENT; m++) {
      const mBase = base + 57 + m * 32;
      merchants.push(addressDecoder.decode(data.slice(mBase, mBase + 32)));
    }
    agents.push({ key, weeklyBudget, spentSoFar, windowStart, revoked, merchants });
  }

  return { owner, mint, vault, agentCount, agents };
}

export const EMPTY_ADDRESS = address('11111111111111111111111111111111');

// ---------------------------------------------------------------------------
// Program error decoding: turn an Anchor custom-error code back into the
// plain-English message from the IDL (the same string a Rust caller would
// see in on-chain logs).
// ---------------------------------------------------------------------------

const ERRORS: Record<number, { name: string; msg: string }> = Object.fromEntries(
  (idl.errors as Array<{ code: number; name: string; msg: string }>).map((e) => [e.code, e]),
);

/** Pulls an Anchor custom error code out of whatever shape the RPC layer
 * throws it in, across a raw JSON-RPC error, a simulation failure, or an
 * already-parsed object — kit's exact error shape for custom program errors
 * isn't guaranteed to be uniform across every failure path, so this checks
 * a few likely places rather than assuming one. */
function extractCustomErrorCode(err: unknown): number | null {
  const asAny = err as any;
  const candidates = [
    asAny?.context?.__code,
    asAny?.cause?.context?.code,
    asAny?.data?.err?.InstructionError?.[1]?.Custom,
    asAny?.context?.code,
  ];
  for (const c of candidates) {
    if (typeof c === 'number') return c;
  }
  // Fall back to scanning the message text for "custom program error: 0x____"
  // or a bare error code number, which Solana RPC errors commonly embed.
  const msg = String(asAny?.message ?? asAny ?? '');
  const hex = msg.match(/custom program error:\s*0x([0-9a-fA-F]+)/);
  if (hex) return parseInt(hex[1], 16);
  const dec = msg.match(/"Custom":\s*(\d+)/);
  if (dec) return parseInt(dec[1], 10);
  return null;
}

/** Turns any error thrown while sending a transaction into a plain-English
 * message. Recognized program errors get their exact IDL message; anything
 * else gets a short, non-technical fallback. */
export function explainError(err: unknown): string {
  const code = extractCustomErrorCode(err);
  if (code != null && ERRORS[code]) {
    return ERRORS[code].msg;
  }
  const msg = String((err as any)?.message ?? err ?? '');
  if (/User rejected|rejected the request/i.test(msg)) {
    return 'You declined the request in your wallet.';
  }
  if (/insufficient/i.test(msg) && /lamports|funds/i.test(msg)) {
    return "Your wallet doesn't have enough devnet SOL to pay the network fee.";
  }
  if (/blockhash not found|block height exceeded/i.test(msg)) {
    return 'The transaction expired before it was confirmed — please try again.';
  }
  if (/already in use|already initialized/i.test(msg)) {
    return 'That account already exists on-chain.';
  }
  return `Something went wrong: ${msg || 'unknown error'}`;
}

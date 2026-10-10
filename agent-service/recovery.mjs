// RECOVERY PATH (owner + agent, policy server not involved).
//
// If the policy server is down, the owner can still move funds out of an
// agent's V2 vault: the vault's multisig is 2-of-3, and [owner, agent] is a
// valid pair. The owner's wallet (Phantom) builds + signs ONE TransferChecked
// back to the owner's own aUSD account (the wallet may add ComputeBudget
// limit/price instructions); the AGENT'S signature comes from here, because
// agent keys never go to the browser.
//
// !! HONEST LIMIT: "funds can only go back to the owner" is enforced HERE, by
// !! this service refusing to sign anything else — NOT on-chain. The multisig
// !! itself would let owner + agent send funds anywhere. Whoever controls this
// !! service's key file plus the owner's wallet can do anything the multisig
// !! allows; the rule only constrains what this service will co-sign.
import {
  address,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  partiallySignTransaction,
  verifySignature,
  getPublicKeyFromAddress,
} from '@solana/kit';
import {
  TOKEN_PROGRAM_ADDRESS,
  TRANSFER_CHECKED_DISCRIMINATOR,
  findAssociatedTokenPda,
  getTransferCheckedInstructionDataDecoder,
} from '@solana-program/token';

const base64 = getBase64Encoder();
const txDecoder = getTransactionDecoder();
const msgDecoder = getCompiledTransactionMessageDecoder();
const dataDecoder = getTransferCheckedInstructionDataDecoder();

const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const MAX_PRIORITY_MICROLAMPORTS = 1_000_000n;

const refuse = (reason, detail) => ({ ok: false, reason, detail });

export async function createRecovery({ v2, agentSigners }) {
  const owner = v2.owner;
  const [ownerAta] = await findAssociatedTokenPda({ owner: address(owner), mint: address(v2.mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });

  /** Everything the agent service insists on before it will sign. */
  function verify(v2Name, b64) {
    const entry = v2.agents[v2Name];
    if (!entry || !agentSigners[v2Name]) return refuse('AgentNotFound');
    let tx, message;
    try {
      tx = txDecoder.decode(base64.encode(b64));
      message = msgDecoder.decode(tx.messageBytes);
    } catch {
      return refuse('TransactionMismatch', 'undecodable transaction');
    }
    const accounts = message.staticAccounts;
    const { numSignerAccounts } = message.header;
    if (message.addressTableLookups?.length) return refuse('TransactionMismatch', 'address lookup tables not allowed');
    // Wallets (Phantom) prepend ComputeBudget instructions. Allow at most one of each, with a capped
    // price; they cannot move funds. Exactly one TransferChecked must remain, and nothing else.
    let ix = null, limitSeen = false, priceSeen = false;
    for (const i of message.instructions) {
      const program = accounts[i.programAddressIndex];
      const d = i.data ?? new Uint8Array();
      if (program === COMPUTE_BUDGET_PROGRAM) {
        if (i.accountIndices?.length) return refuse('TransactionMismatch', 'unexpected ComputeBudget accounts');
        if (d[0] === 2 && d.length === 5) {
          if (limitSeen) return refuse('TransactionMismatch', 'duplicate SetComputeUnitLimit');
          limitSeen = true;
        } else if (d[0] === 3 && d.length === 9) {
          if (priceSeen) return refuse('TransactionMismatch', 'duplicate SetComputeUnitPrice');
          priceSeen = true;
          if (new DataView(d.buffer, d.byteOffset, 9).getBigUint64(1, true) > MAX_PRIORITY_MICROLAMPORTS)
            return refuse('TransactionMismatch', 'compute unit price above the allowed cap');
        } else return refuse('TransactionMismatch', 'unsupported ComputeBudget instruction');
      } else if (program === TOKEN_PROGRAM_ADDRESS) {
        if (ix) return refuse('TransactionMismatch', 'expected exactly 1 token transfer');
        ix = i;
      } else return refuse('TransactionMismatch', `unexpected program ${program}`);
    }
    if (!ix) return refuse('TransactionMismatch', 'no token transfer');
    if (accounts[ix.programAddressIndex] !== TOKEN_PROGRAM_ADDRESS) return refuse('TransactionMismatch', 'not a Token Program instruction');
    const data = ix.data ?? new Uint8Array();
    if (data[0] !== TRANSFER_CHECKED_DISCRIMINATOR || data.length !== 10) return refuse('TransactionMismatch', 'not TransferChecked');
    const { decimals } = dataDecoder.decode(data);
    const idx = ix.accountIndices ?? [];
    if (idx.length !== 6) return refuse('TransactionMismatch', 'unexpected TransferChecked account list');
    const [source, mint, destination, authority, ...signers] = idx.map((i) => accounts[i]);

    if (source !== entry.vault) return refuse('TransactionMismatch', "source is not this agent's own V2 vault");
    if (destination !== ownerAta) return refuse('RecoveryDestinationNotOwner', 'destination is not the owner\'s aUSD account');
    if (mint !== v2.mint) return refuse('TransactionMismatch', 'wrong mint');
    if (decimals !== v2.decimals) return refuse('TransactionMismatch', 'wrong decimals');
    if (authority !== entry.multisig.address) return refuse('TransactionMismatch', "authority is not this vault's multisig");
    if (signers.length !== 2 || !signers.includes(owner) || !signers.includes(entry.address))
      return refuse('TransactionMismatch', 'transfer signers are not {owner, this vault\'s agent}');
    if (accounts[0] !== owner) return refuse('TransactionMismatch', 'fee payer is not the owner');
    const required = accounts.slice(0, numSignerAccounts);
    if (required.length !== 2 || !required.includes(owner) || !required.includes(entry.address))
      return refuse('TransactionMismatch', 'unexpected required signers');
    if (idx.slice(4).some((i) => i >= numSignerAccounts)) return refuse('TransactionMismatch', 'multisig signers are not transaction signers');
    return { ok: true, tx };
  }

  /**
   * precheck: verify only (no signature needed yet) — lets the UI fail before
   * the owner is asked to approve anything in the wallet.
   * Otherwise: also require the OWNER's valid signature over these exact
   * bytes, then add the agent's signature and return the fully signed tx.
   */
  async function cosign({ agent, transaction, precheck = false }) {
    const v2Name = typeof agent === 'string' && agent.endsWith('-v2') ? agent : `${agent}-v2`;
    if (typeof transaction !== 'string' || !transaction) return refuse('TransactionMismatch', 'missing transaction');
    const v = verify(v2Name, transaction);
    if (!v.ok) return v;
    if (precheck) return { ok: true, precheck: true };

    const ownerSig = v.tx.signatures[owner];
    let valid = false;
    try {
      valid = !!ownerSig && (await verifySignature(await getPublicKeyFromAddress(address(owner)), ownerSig, v.tx.messageBytes));
    } catch {}
    if (!valid) return refuse('OwnerSignatureMissing', 'the owner must sign first');

    const signed = await partiallySignTransaction([agentSigners[v2Name].keyPair], v.tx);
    return { ok: true, transaction: getBase64EncodedWireTransaction(signed) };
  }

  return { cosign, ownerAta };
}

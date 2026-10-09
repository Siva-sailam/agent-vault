// TAMPER CHECK. The server signs what it VERIFIED, never what it was TOLD:
// everything below is read from the transaction bytes, then compared to the
// agent's stated intent.
import {
  address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  verifySignature,
} from '@solana/kit';
import { TOKEN_PROGRAM_ADDRESS, TRANSFER_CHECKED_DISCRIMINATOR, getTransferCheckedInstructionDataDecoder } from '@solana-program/token';

const base64 = getBase64Encoder();
const txDecoder = getTransactionDecoder();
const msgDecoder = getCompiledTransactionMessageDecoder();
const dataDecoder = getTransferCheckedInstructionDataDecoder();

const mismatch = (detail) => ({ ok: false, reason: 'TransactionMismatch', detail });

/**
 * @returns {{ok:false, reason:'TransactionMismatch', detail:string}
 *   | {ok:true, transaction, messageBytes, agent:string, agentSignature:Uint8Array|null}}
 */
export function verifyTransaction(b64, intent, cfg) {
  if (typeof b64 !== 'string' || !b64) return mismatch('missing transaction');
  if (
    !intent ||
    typeof intent.merchant !== 'string' ||
    !Number.isSafeInteger(intent.amount) ||
    intent.amount <= 0
  )
    return mismatch('malformed intent');

  let transaction, message;
  try {
    transaction = txDecoder.decode(base64.encode(b64));
    message = msgDecoder.decode(transaction.messageBytes);
  } catch {
    return mismatch('undecodable transaction');
  }

  const accounts = message.staticAccounts;
  const { numSignerAccounts } = message.header;
  if (message.addressTableLookups?.length) return mismatch('address lookup tables not allowed');
  if (message.instructions.length !== 1) return mismatch(`expected 1 instruction, got ${message.instructions.length}`);
  if (accounts[0] !== cfg.server) return mismatch('fee payer is not the policy server');

  const ix = message.instructions[0];
  if (accounts[ix.programAddressIndex] !== TOKEN_PROGRAM_ADDRESS) return mismatch('not a Token Program instruction');
  const data = ix.data ?? new Uint8Array();
  if (data[0] !== TRANSFER_CHECKED_DISCRIMINATOR || data.length !== 10) return mismatch('not TransferChecked');
  const { amount, decimals } = dataDecoder.decode(data);

  // TransferChecked accounts: source, mint, destination, authority, ...multisig signers
  const idx = ix.accountIndices ?? [];
  if (idx.length !== 6) return mismatch('unexpected TransferChecked account list');
  const [source, mint, destination, authority, ...signers] = idx.map((i) => accounts[i]);
  if (source !== cfg.vault) return mismatch('source is not the V2 vault');
  if (mint !== cfg.mint) return mismatch('wrong mint');
  if (decimals !== cfg.decimals) return mismatch('wrong decimals');
  if (authority !== cfg.multisig) return mismatch('authority is not the V2 multisig');
  if (destination !== intent.merchant) return mismatch('destination differs from intent');
  if (amount !== BigInt(intent.amount)) return mismatch('amount differs from intent');

  // Exactly two multisig signers: the server and one multisig member (the agent).
  if (!signers.includes(cfg.server)) return mismatch('server is not a signer of the transfer');
  const agent = signers.find((s) => s !== cfg.server);
  if (!agent || new Set(signers).size !== 2 || !cfg.multisigSigners.includes(agent))
    return mismatch('transfer signers are not {server, multisig member}');

  // The transaction must require exactly those two signatures — nothing extra.
  const required = accounts.slice(0, numSignerAccounts);
  if (required.length !== 2 || !required.includes(cfg.server) || !required.includes(agent))
    return mismatch('unexpected required signers');
  if (idx.slice(4).some((i) => i >= numSignerAccounts)) return mismatch('multisig signers are not transaction signers');

  return {
    ok: true,
    transaction,
    messageBytes: transaction.messageBytes,
    agent,
    agentSignature: transaction.signatures[agent] ?? null,
  };
}

/** True iff the agent's signature over these exact message bytes is valid. */
export async function agentSignatureValid(agentAddress, signature, messageBytes) {
  if (!signature) return false;
  try {
    return await verifySignature(await getPublicKeyFromAddress(address(agentAddress)), signature, messageBytes);
  } catch {
    return false;
  }
}

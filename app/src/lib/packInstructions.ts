import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';

// A Solana transaction is capped at 1232 bytes. Leave headroom for the wallet
// and the real blockhash.
const DEFAULT_MAX_BYTES = 1200;

const DUMMY_LIFETIME = { blockhash: '11111111111111111111111111111111' as Blockhash, lastValidBlockHeight: 0n };

function sizeOf(feePayer: Address, instructions: Instruction[]): number {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(DUMMY_LIFETIME, m),
  );
  return getTransactionEncoder().encode(compileTransaction(message)).length;
}

/**
 * Splits instructions, in order, into as few transactions as fit under the
 * size limit. Order is preserved because later instructions may depend on
 * earlier ones (add_agent needs initialize_vault to have landed).
 */
export function packInstructions(
  feePayer: Address,
  instructions: Instruction[],
  maxBytes = DEFAULT_MAX_BYTES,
): Instruction[][] {
  const batches: Instruction[][] = [];
  let current: Instruction[] = [];
  for (const ix of instructions) {
    if (current.length > 0 && sizeOf(feePayer, [...current, ix]) > maxBytes) {
      batches.push(current);
      current = [];
    }
    current.push(ix);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

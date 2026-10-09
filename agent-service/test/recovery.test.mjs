// Recovery cosign checks. Uses a THROWAWAY owner key (the real owner is
// Phantom) and the real agent key files. Sends nothing to devnet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  address, appendTransactionMessageInstructions, compileTransaction, createNoopSigner, createTransactionMessage,
  generateKeyPairSigner, getBase64Encoder, getBase64EncodedWireTransaction, getTransactionDecoder, partiallySignTransaction,
  pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getTransferCheckedInstruction, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { createV2Path, loadV2Config } from '../v2.mjs';
import { createRecovery } from '../recovery.mjs';

const real = loadV2Config();
const owner = await generateKeyPairSigner();
const v2 = structuredClone(real);
v2.owner = owner.address;
const { signers } = await createV2Path({ rpc: null, v2: real, merchantAtas: {} });
const rec = await createRecovery({ v2, agentSigners: signers });
const BH = { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 1n };
const f = v2.agents['food-ordering-agent-v2'];
const s = v2.agents['shopping-agent-v2'];
const [stranger] = await findAssociatedTokenPda({ owner: (await generateKeyPairSigner()).address, mint: address(v2.mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });

async function build({ entry = f, dest = rec.ownerAta, extra = false, payer = owner.address, signOwner = true, wrongMint = false } = {}) {
  const ix = getTransferCheckedInstruction({
    source: address(entry.vault), mint: address(wrongMint ? stranger : v2.mint), destination: address(dest),
    authority: address(entry.multisig.address), amount: 5n, decimals: 0,
    multiSigners: [createNoopSigner(address(owner.address)), createNoopSigner(address(entry.address))],
  });
  let tx = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(createNoopSigner(address(payer)), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(BH, m),
      (m) => appendTransactionMessageInstructions(extra ? [ix, ix] : [ix], m),
    ),
  );
  if (signOwner) tx = await partiallySignTransaction([owner.keyPair], tx);
  return getBase64EncodedWireTransaction(tx);
}
const A = 'food-ordering-agent';

test('recovery to the owner\'s own aUSD account passes; agent signature is added', async () => {
  const r = await rec.cosign({ agent: A, transaction: await build() });
  assert.equal(r.ok, true, JSON.stringify(r));
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(r.transaction));
  assert.ok(tx.signatures[owner.address] && tx.signatures[f.address], 'both signatures present');
});

test('recovery to ANY other account is refused', async () => {
  const r = await rec.cosign({ agent: A, transaction: await build({ dest: stranger }) });
  assert.deepEqual([r.ok, r.reason], [false, 'RecoveryDestinationNotOwner']);
  const toAgent = await rec.cosign({ agent: A, transaction: await build({ dest: f.vault }) });
  assert.equal(toAgent.reason, 'RecoveryDestinationNotOwner');
});

test('precheck needs no signature; the real call requires the owner\'s', async () => {
  const unsigned = await build({ signOwner: false });
  assert.equal((await rec.cosign({ agent: A, precheck: true, transaction: unsigned })).ok, true);
  assert.equal((await rec.cosign({ agent: A, transaction: unsigned })).reason, 'OwnerSignatureMissing');
});

test('a vault can only be recovered by its own agent (cross-vault refused)', async () => {
  assert.equal((await rec.cosign({ agent: A, transaction: await build({ entry: s }) })).reason, 'TransactionMismatch');
  assert.equal((await rec.cosign({ agent: 'shopping-agent', transaction: await build({ entry: f }) })).reason, 'TransactionMismatch');
  assert.equal((await rec.cosign({ agent: 'shopping-agent', transaction: await build({ entry: s }) })).ok, true);
});

test('extra instruction, wrong fee payer, wrong mint, unknown agent, garbage -> refused', async () => {
  assert.equal((await rec.cosign({ agent: A, transaction: await build({ extra: true }) })).reason, 'TransactionMismatch');
  assert.equal((await rec.cosign({ agent: A, transaction: await build({ payer: f.address }) })).reason, 'TransactionMismatch');
  assert.equal((await rec.cosign({ agent: A, transaction: await build({ wrongMint: true }) })).reason, 'TransactionMismatch');
  assert.equal((await rec.cosign({ agent: 'nobody', transaction: await build() })).reason, 'AgentNotFound');
  assert.equal((await rec.cosign({ agent: A, transaction: 'AAAA' })).reason, 'TransactionMismatch');
});

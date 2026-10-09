// Offline test of the recovery cosign checks. Uses a THROWAWAY owner key (the
// real owner is Phantom) and real agent keys. Sends nothing to devnet.
//   node smoke-recovery.mjs
import { address, appendTransactionMessageInstructions, compileTransaction, createNoopSigner, createTransactionMessage, generateKeyPairSigner, getBase64EncodedWireTransaction, getTransactionDecoder, getBase64Encoder, getTransactionEncoder, pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, partiallySignTransaction } from '@solana/kit';
import { getTransferCheckedInstruction, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { createV2Path, loadV2Config } from './v2.mjs';
import { createRecovery } from './recovery.mjs';

const real = loadV2Config();
const owner = await generateKeyPairSigner();
const v2 = structuredClone(real);
v2.owner = owner.address;
const p = await createV2Path({ rpc: null, v2: real, merchantAtas: {} });
const rec = await createRecovery({ v2, agentSigners: p.signers });
const BH = { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 1n };
const f = v2.agents['food-ordering-agent-v2'], s = v2.agents['shopping-agent-v2'];
const [stranger] = await findAssociatedTokenPda({ owner: (await generateKeyPairSigner()).address, mint: address(v2.mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });

async function build({ entry = f, dest = rec.ownerAta, extra = false, payer = owner.address, signOwner = true, signerAgent = entry.address, noopOwner = true } = {}) {
  const ix = getTransferCheckedInstruction({ source: address(entry.vault), mint: address(v2.mint), destination: address(dest), authority: address(entry.multisig.address), amount: 5n, decimals: 0, multiSigners: [createNoopSigner(address(owner.address)), createNoopSigner(address(signerAgent))] });
  const m = pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(createNoopSigner(address(payer)), m), (m) => setTransactionMessageLifetimeUsingBlockhash(BH, m), (m) => appendTransactionMessageInstructions(extra ? [ix, ix] : [ix], m));
  let tx = compileTransaction(m);
  if (signOwner) tx = await partiallySignTransaction([owner.keyPair], tx);
  return getBase64EncodedWireTransaction(tx);
}
const show = async (n, body) => { const r = await rec.cosign(body); console.log(n.padEnd(30), r.ok ? 'OK' + (r.transaction ? ' (agent signed)' : ' (precheck)') : `${r.reason} — ${r.detail ?? ''}`); return r; };
const A = 'food-ordering-agent';
const ok = await show('to owner ATA', { agent: A, transaction: await build() });
await show('precheck unsigned', { agent: A, precheck: true, transaction: await build({ signOwner: false }) });
await show('unsigned, no precheck', { agent: A, transaction: await build({ signOwner: false }) });
await show('to a stranger', { agent: A, transaction: await build({ dest: stranger }) });
await show('other agent\'s vault', { agent: A, transaction: await build({ entry: s }) });
await show('extra instruction', { agent: A, transaction: await build({ extra: true }) });
await show('fee payer not owner', { agent: A, transaction: await build({ payer: f.address }) });
await show('shopping agent, own vault', { agent: 'shopping-agent', transaction: await build({ entry: s }) });
await show('shopping agent, food vault', { agent: 'shopping-agent', transaction: await build({ entry: f }) });
const dec = getTransactionDecoder().decode(getBase64Encoder().encode(ok.transaction));
console.log('signatures present:', Object.entries(dec.signatures).map(([k, v]) => `${k.slice(0, 4)}:${v ? 'yes' : 'NO'}`).join(' '));

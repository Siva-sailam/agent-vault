// Offline smoke test for V2-M2 (mock RPC, no devnet transactions).
//   node scripts/smoke-m2.mjs
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getTransferCheckedInstruction } from '@solana-program/token';
import { buildApp } from '../src/server.mjs';

const key = (f) =>
  createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/agent-vault/keys/${f}`, 'utf8'))));
const agent = await key('food-ordering-agent-v2.json');
const sent = [];
const rpc = {
  simulateTransaction: () => ({ send: async () => ({ value: { err: null } }) }),
  sendTransaction: (w) => ({ send: async () => { sent.push(w); return 'x'; } }),
  getSignatureStatuses: () => ({ send: async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] }) }),
  getAccountInfo: () => ({ send: async () => ({ value: null }) }),
};
const { authorize, cfg, db } = await buildApp({ dbFile: ':memory:', rpc });
const merchants = db.prepare('select * from merchants').all();
const noonly = merchants[3].token_account;
const talabird = merchants[1].token_account;
const BH = { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 1n };

async function build({ dest = noonly, amount = 20n, extra = false } = {}) {
  const ix = getTransferCheckedInstruction({
    source: address(cfg.vault),
    mint: address(cfg.mint),
    destination: address(dest),
    authority: address(cfg.multisig),
    amount,
    decimals: 0,
    multiSigners: [agent, createNoopSigner(address(cfg.server))],
  });
  const m = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(createNoopSigner(address(cfg.server)), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(BH, m),
    (m) => appendTransactionMessageInstructions(extra ? [ix, ix] : [ix], m),
  );
  return getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(m));
}
const show = (n, r) => console.log(n.padEnd(22), JSON.stringify(r));
const I = (merchant, amount) => ({ merchant, amount });

show('pass 20 Noonly', await authorize({ transaction: await build(), intent: I(noonly, 20) }));
show('mismatch merchant', await authorize({ transaction: await build({ dest: talabird }), intent: I(noonly, 20) }));
show('mismatch amount', await authorize({ transaction: await build({ amount: 25n }), intent: I(noonly, 20) }));
show('extra instruction', await authorize({ transaction: await build({ extra: true }), intent: I(noonly, 20) }));
show('budget exceeded', await authorize({ transaction: await build({ amount: 190n }), intent: I(noonly, 190) }));
db.prepare('update merchants set enabled=0 where id=4').run();
show('merchant off', await authorize({ transaction: await build(), intent: I(noonly, 20) }));
db.prepare('update merchants set enabled=1 where id=4').run();
db.prepare('update agents set revoked=1').run();
show('revoked', await authorize({ transaction: await build(), intent: I(noonly, 20) }));
db.prepare('update agents set revoked=0').run();
const t1 = await build({ amount: 100n });
const t2 = await build({ amount: 100n, dest: talabird });
const rs = await Promise.all([
  authorize({ transaction: t1, intent: I(noonly, 100) }),
  authorize({ transaction: t2, intent: I(talabird, 100) }),
]);
show('concurrent 2x100', rs.map((r) => (r.approved ? 'ok' : r.reason)));
console.log('submitted txs:', sent.length);
for (const s of db.prepare('select id,status,reason,amount from spends').all())
  console.log(' ', s.id, s.status, s.amount, (s.reason ?? '').slice(0, 60));
console.log(db.prepare('select spent from windows').get());

// Shared test helpers. Everything is local: in-memory SQLite, mock RPC, real
// agent key files (from ~/agent-vault/keys) so signatures are genuine.
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
export const food = await key('food-ordering-agent-v2.json');
export const shopper = await key('shopping-agent-v2.json');

export function mockRpc({ simErr = null } = {}) {
  const calls = { simulate: 0, send: 0 };
  return {
    calls,
    setSimErr: (e) => (simErr = e),
    simulateTransaction: () => ({ send: async () => (calls.simulate++, { value: { err: simErr } }) }),
    sendTransaction: () => ({ send: async () => (calls.send++, 'x') }),
    getSignatureStatuses: () => ({ send: async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] }) }),
    getAccountInfo: () => ({ send: async () => ({ value: null }) }),
  };
}

export async function makeApp(rpcOpts) {
  const rpc = mockRpc(rpcOpts);
  const app = await buildApp({ dbFile: ':memory:', rpc });
  const { db, cfg } = app;
  const entryOf = (agent) => Object.entries(cfg.vaults).find(([, v]) => v.agent === agent.address);
  const [foodVault, foodV] = entryOf(food);
  const [shopVault, shopV] = entryOf(shopper);
  const ata = (label) => db.prepare('select token_account t from merchants where label = ?').get(label).t;
  /** Builds the transaction an agent would send: partially signed (agent only), fee payer = server. */
  async function build({ who = food, vault = foodVault, ms = foodV.multisig, dest = ata('Noonly'), amount = 20n, extra = false, payer = cfg.server, mint = cfg.mint, decimals = 0 } = {}) {
    const ix = getTransferCheckedInstruction({
      source: address(vault), mint: address(mint), destination: address(dest), authority: address(ms), amount, decimals,
      multiSigners: [who, createNoopSigner(address(cfg.server))],
    });
    const bh = { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 1n };
    const m = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(createNoopSigner(address(payer)), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
      (m) => appendTransactionMessageInstructions(extra ? [ix, ix] : [ix], m),
    );
    return getBase64EncodedWireTransaction(await partiallySignTransactionMessageWithSigners(m));
  }
  /** An honest request: the transaction matches the intent (food agent unless overridden). */
  const ask = async (label = 'Noonly', amount = 20, opts = {}) =>
    app.authorize({ transaction: await build({ dest: ata(label), amount: BigInt(amount), ...opts }), intent: { merchant: ata(label), amount } });
  return { ...app, rpc, ata, build, ask, foodVault, foodV, shopVault, shopV, food, shopper };
}

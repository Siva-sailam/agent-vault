// Offline end-to-end check of the V2 agent path: real agent code -> real HTTP
// -> real policy server (mock RPC, in-memory DB). Sends nothing to devnet.
//   node smoke-v2.mjs
import { readFileSync } from 'node:fs';
import { address } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { buildApp } from '../policy-server/src/server.mjs';
import { createV2Path, loadV2Config } from './v2.mjs';

const mockRpc = {
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 1n } }) }),
  simulateTransaction: () => ({ send: async () => ({ value: { err: null } }) }),
  sendTransaction: () => ({ send: async () => 'x' }),
  getSignatureStatuses: () => ({ send: async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] }) }),
  getAccountInfo: () => ({ send: async () => ({ value: null }) }),
};
const { server, db } = await buildApp({ dbFile: ':memory:', rpc: mockRpc });
await new Promise((r) => server.listen(4099, '127.0.0.1', r));

const make = createV2Path;

const v2 = loadV2Config();
const demo = JSON.parse(readFileSync(new URL('./demo-vault.config.json', import.meta.url)));
const atas = {};
for (const [l, w] of Object.entries(demo.merchants))
  [atas[l]] = await findAssociatedTokenPda({ owner: address(w), mint: address(v2.mint), tokenProgram: TOKEN_PROGRAM_ADDRESS });
const p = await make({ rpc: mockRpc, v2, merchantAtas: atas });
const show = (n, r) => console.log(n.padEnd(26), JSON.stringify(r).slice(0, 150));
show('food -> Noonly 20', await p.authorize('food-ordering-agent-v2', 'Noonly', 20));
show('food -> Amazen (not hers)', await p.authorize('food-ordering-agent-v2', 'Amazen', 5));
show('shop -> Amazen 20', await p.authorize('shopping-agent-v2', 'Amazen', 20));
show('food -> Noonly 500', await p.authorize('food-ordering-agent-v2', 'Noonly', 500));
db.prepare('update merchants set enabled=0 where label=?').run('Noonly');
show('food -> Noonly (off)', await p.authorize('food-ordering-agent-v2', 'Noonly', 5));
db.prepare('update agents set revoked=1 where name=?').run('food-ordering-agent-v2');
show('food revoked', await p.authorize('food-ordering-agent-v2', 'Talabird', 5));
show('budget view', await p.agentBudget('shopping-agent-v2'));
server.close();

// Policy server: POST /v2/authorize + localhost-only admin API.
//
// !! The admin API is UNAUTHENTICATED in this milestone. It is safe only
// !! because it binds to 127.0.0.1. Next milestone: the owner signs admin
// !! changes with Phantom signMessage.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { address, createSolanaRpc } from '@solana/kit';
import { fetchMaybeToken } from '@solana-program/token';
import { DEVNET_URL, PORT, WINDOW_SECONDS, loadConfig, loadServerSigner } from './config.mjs';
import { getState, openDb, seed } from './db.mjs';
import { createAuthorizer } from './authorize.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export async function buildApp({ dbFile = join(here, '..', 'data', 'policy.sqlite'), rpc = createSolanaRpc(DEVNET_URL) } = {}) {
  const { v2, demo } = loadConfig();
  const serverSigner = await loadServerSigner(v2);
  if (serverSigner.address !== v2.policyServer.address) throw new Error('server key does not match v2.config.json');

  if (dbFile !== ':memory:') mkdirSync(dirname(dbFile), { recursive: true });
  const db = openDb(dbFile);
  const [agentName, agentEntry] = Object.entries(v2.agents)[0];
  const food = demo.agents['food-ordering-agent'];
  seed(db, {
    agents: [
      {
        pubkey: agentEntry.address,
        name: agentName,
        weeklyBudget: food.weeklyBudget,
        merchants: food.merchants.map((label) => ({ label, tokenAccount: demo.merchants[label] })),
      },
    ],
  });

  const cfg = {
    server: v2.policyServer.address,
    vault: v2.vault,
    mint: v2.mint,
    decimals: v2.decimals,
    multisig: v2.multisig.address,
    multisigSigners: v2.multisig.signers,
  };
  const authorize = createAuthorizer({ db, cfg, serverSigner, rpc, windowSeconds: WINDOW_SECONDS });

  async function vaultBalance() {
    try {
      const acc = await fetchMaybeToken(rpc, address(v2.vault), { commitment: 'confirmed' });
      return acc.exists ? Number(acc.data.amount) : null;
    } catch {
      return null;
    }
  }

  const setFlag = {
    revoke: db.prepare('UPDATE agents SET revoked = 1 WHERE pubkey = ?'),
    unrevoke: db.prepare('UPDATE agents SET revoked = 0 WHERE pubkey = ?'),
    enable: db.prepare('UPDATE merchants SET enabled = 1 WHERE id = ?'),
    disable: db.prepare('UPDATE merchants SET enabled = 0 WHERE id = ?'),
  };

  async function route(req, res, url, body) {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'POST' && url.pathname === '/v2/authorize') return send(200, await authorize(body));
    if (req.method === 'GET' && url.pathname === '/v2/state')
      return send(200, { ...getState(db, WINDOW_SECONDS), vault: v2.vault, vaultBalance: await vaultBalance(), unauthenticatedAdmin: true });

    let m = url.pathname.match(/^\/v2\/agents\/([1-9A-HJ-NP-Za-km-z]{32,44})\/(revoke|unrevoke)$/);
    if (req.method === 'POST' && m) {
      const r = setFlag[m[2]].run(m[1]);
      return r.changes ? send(200, { ok: true }) : send(404, { error: 'AgentNotFound' });
    }
    m = url.pathname.match(/^\/v2\/merchants\/(\d+)\/(enable|disable)$/);
    if (req.method === 'POST' && m) {
      const r = setFlag[m[2]].run(Number(m[1]));
      return r.changes ? send(200, { ok: true }) : send(404, { error: 'MerchantNotFound' });
    }
    return send(404, { error: 'NotFound' });
  }

  const server = createServer((req, res) => {
    // Open CORS like the V1 agent service: localhost-only, devnet public data.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) req.destroy();
      else chunks.push(c);
    });
    req.on('end', async () => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
        await route(req, res, url, body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'BadRequest', detail: e.message }));
      }
    });
  });

  return { server, db, authorize, cfg };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = await buildApp();
  server.listen(PORT, '127.0.0.1', () => console.log(`policy server on http://127.0.0.1:${PORT} (admin API UNAUTHENTICATED, localhost only)`));
}

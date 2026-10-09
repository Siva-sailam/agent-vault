// Minimal local HTTP server (no framework — a few dozen lines of Node's
// built-in `http` is all this needs) that lets the storefront browser page
// (a separate process, on a different port):
//   - watch this service's activity feed live (GET /events, server-sent events)
//   - place an order (POST /order): the agent service signs the payment with
//     the agent's key — the key never leaves this process
//   - read what the form may offer (GET /meta: agents, merchants, token)
//   - press "Continue" to unblock a scripted pause (POST /continue)
//
// CORS is wide open (`Access-Control-Allow-Origin: *`). That's fine here:
// this only ever serves devnet public data (merchant names, amounts,
// success/failure, Solscan links) to localhost, never a secret, and never
// leaves your machine.
import { createServer } from 'node:http';

const POLL_MS = 2000;

export function startServer(port, { meta = {}, onOrder = null, onRecoveryCosign = null } = {}) {
  const events = [];
  let nextId = 1;
  let pendingContinue = null; // { resolve, timer } while paused, else null

  const clients = new Set();

  function broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) res.write(payload);
  }

  function emit(kind, fields = {}) {
    const event = { id: nextId++, ts: Date.now(), kind, ...fields };
    events.push(event);
    broadcast(event);
    return event;
  }

  /** Emits a 'pause' event with instructions, then blocks until the
   * storefront POSTs /continue — or, if `check` is given, until that async
   * function returns true (polled), i.e. until the owner's change has
   * actually landed on-chain. */
  function waitForContinue(message, check = null) {
    emit('pause', { message });
    return new Promise((resolve) => {
      const finish = (auto) => {
        if (!pendingContinue) return;
        clearInterval(pendingContinue.timer);
        pendingContinue = null;
        emit('resumed', { auto });
        resolve();
      };
      const timer = check
        ? setInterval(async () => {
            try {
              if (pendingContinue && (await check())) finish(true);
            } catch (e) {
              console.error('pause check failed (will retry):', e.message ?? e);
            }
          }, POLL_MS)
        : null;
      pendingContinue = { finish, timer };
    });
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 10_000) reject(new Error('Body too large'));
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
    });
  }

  const send = (res, status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Replay history so a page refresh doesn't lose the feed.
      for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'POST' && req.url === '/continue') {
      pendingContinue?.finish(false);
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && req.url === '/meta') {
      send(res, 200, meta);
      return;
    }

    if (req.method === 'POST' && req.url === '/order') {
      if (!onOrder) return send(res, 404, { error: 'Orders are not enabled' });
      try {
        const result = await onOrder(await readJson(req));
        send(res, 200, result);
      } catch (e) {
        send(res, 400, { error: e.message ?? String(e) });
      }
      return;
    }

    // V2 recovery (owner + agent): the agent's signature is added here because
    // agent keys never go to the browser. See recovery.mjs for the checks.
    if (req.method === 'POST' && req.url === '/v2/recovery/cosign') {
      if (!onRecoveryCosign) return send(res, 404, { error: 'Recovery is not enabled' });
      try {
        send(res, 200, await onRecoveryCosign(await readJson(req)));
      } catch (e) {
        send(res, 400, { error: e.message ?? String(e) });
      }
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      send(res, 200, { waitingForContinue: pendingContinue !== null });
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Agent service listening on http://localhost:${port}`);
  });

  return { emit, waitForContinue };
}

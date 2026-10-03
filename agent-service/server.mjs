// Minimal local HTTP server (no framework — a few dozen lines of Node's
// built-in `http` is all this needs) that lets the storefront browser page
// (a separate process, on a different port) watch this service's activity
// feed live and press "Continue" to unblock a scripted pause.
//
// CORS is wide open (`Access-Control-Allow-Origin: *`). That's fine here:
// this only ever serves devnet public data (merchant names, amounts,
// success/failure, Solscan links) to localhost, never a secret, and never
// leaves your machine.
import { createServer } from 'node:http';

export function startServer(port) {
  const events = [];
  let nextId = 1;
  let pendingContinue = null; // { resolve } while paused, else null

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
   * storefront POSTs /continue. */
  function waitForContinue(message) {
    emit('pause', { message });
    return new Promise((resolve) => {
      pendingContinue = { resolve };
    });
  }

  const server = createServer((req, res) => {
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
      if (pendingContinue) {
        const { resolve } = pendingContinue;
        pendingContinue = null;
        emit('resumed');
        resolve();
      }
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ waitingForContinue: pendingContinue !== null }));
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(port, () => {
    console.log(`Agent service listening on http://localhost:${port}`);
  });

  return { emit, waitForContinue };
}

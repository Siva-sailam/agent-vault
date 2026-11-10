// --v2-only: only V2 agent keys that exist are read; V1 keys and the CLI
// wallet are never opened. Offline: no RPC, nothing sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { getAddressDecoder } from '@solana/kit';
import { createV2Path } from '../v2.mjs';

const indexPath = new URL('../index.mjs', import.meta.url).pathname;

function makeKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { bytes: [...seed, ...pub], address: getAddressDecoder().decode(pub) };
}

test('createV2Path skipMissing loads only agents whose key file exists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'v2only-'));
  try {
    const a = makeKey();
    writeFileSync(join(dir, 'a.json'), JSON.stringify(a.bytes));
    const v2 = {
      policyServer: { address: makeKey().address },
      agents: { 'a-v2': { address: a.address, keyFile: 'a.json' }, 'b-v2': { address: a.address, keyFile: 'missing.json' } },
    };
    const p = await createV2Path({ rpc: {}, v2, merchantAtas: {}, keysDir: dir, skipMissing: true });
    assert.deepEqual(Object.keys(p.signers), ['a-v2']);
    await assert.rejects(createV2Path({ rpc: {}, v2, merchantAtas: {}, keysDir: dir }), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// HOME points at an empty temp dir containing a decoy CLI wallet that is not
// valid JSON: any read of it (or of V1 key files) would surface as an error.
function runIndex(args) {
  const home = mkdtempSync(join(tmpdir(), 'v2only-home-'));
  try {
    mkdirSync(join(home, 'agent-vault', 'keys'), { recursive: true });
    mkdirSync(join(home, '.config', 'solana'), { recursive: true });
    writeFileSync(join(home, '.config', 'solana', 'id.json'), 'NOT JSON');
    const r = spawnSync(process.execPath, [indexPath, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 30000 });
    return r.stdout + r.stderr;
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('--v2-only with no V2 keys fails on V2 keys, never touching V1 keys or id.json', () => {
  const out = runIndex(['--v2-only']);
  assert.match(out, /no V2 agent keys found/);
  assert.doesNotMatch(out, /ENOENT|JSON/);
});

test('without --v2-only the V1 key files are still required (default unchanged)', () => {
  const out = runIndex([]);
  assert.match(out, /ENOENT/);
});

test('--v2-only scenario requires --v2', () => {
  assert.match(runIndex(['--v2-only', '--scenario']), /--v2-only scenarios need --v2/);
});

// Fresh-clone layout: a temp repo root with the agent-service sources, the
// committed IDL only (no agent_vault/target), and a single V2 agent key in
// HOME/agent-vault/keys. The RPC is a local stub; nothing leaves the machine.
test('--v2-only starts in a fresh-clone layout with one V2 key and no built IDL', async () => {
  const root = mkdtempSync(join(tmpdir(), 'v2only-clone-'));
  const home = join(root, 'home');
  let child;
  const stub = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { id, method } = JSON.parse(body);
      const value = method === 'getAccountInfo' ? { data: ['', 'base64'], lamports: 1, owner: '11111111111111111111111111111111', executable: false, rentEpoch: 0, space: 0 } : null;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value } }));
    });
  });
  try {
    const svc = join(root, 'agent-service');
    cpSync(join(dirname(indexPath), '.'), svc, { recursive: true, filter: (p) => !p.includes('node_modules') && !p.includes('/test') });
    symlinkSync(join(dirname(indexPath), 'node_modules'), join(svc, 'node_modules'));
    mkdirSync(join(root, 'app', 'src', 'idl'), { recursive: true });
    cpSync(join(dirname(indexPath), '..', 'app', 'src', 'idl', 'agent_vault.json'), join(root, 'app', 'src', 'idl', 'agent_vault.json'));
    const key = makeKey();
    mkdirSync(join(home, 'agent-vault', 'keys'), { recursive: true });
    writeFileSync(join(home, 'agent-vault', 'keys', 'food-ordering-agent-v2.json'), JSON.stringify(key.bytes));
    const real = JSON.parse(readFileSync(join(dirname(indexPath), '..', 'policy-server', 'v2.config.json'), 'utf8'));
    const entry = { ...real.agents['food-ordering-agent-v2'], address: key.address };
    mkdirSync(join(root, 'policy-server'));
    writeFileSync(join(root, 'policy-server', 'v2.config.json'), JSON.stringify({ ...real, agents: { 'food-ordering-agent-v2': entry, 'shopping-agent-v2': { ...entry, address: makeKey().address, keyFile: 'shopping-agent-v2.json' } } }));

    await new Promise((r) => stub.listen(0, '127.0.0.1', r));
    const env = { ...process.env, HOME: home, AGENT_SERVICE_RPC_URL: `http://127.0.0.1:${stub.address().port}` };
    child = spawn(process.execPath, [join(svc, 'index.mjs'), '--v2-only', '--port', '0'], { env });
    let out = '';
    const result = await new Promise((resolve) => {
      const t = setTimeout(() => resolve('timeout'), 20000);
      const onData = (d) => {
        out += d;
        if (/listening/.test(out)) { clearTimeout(t); resolve('listening'); }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', (d) => (out += d));
      child.on('exit', () => { clearTimeout(t); resolve('exited'); });
    });
    assert.equal(result, 'listening', out);
    assert.doesNotMatch(out, /Cannot read properties|ENOENT/);
  } finally {
    child?.kill();
    stub.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// --v2-only: only V2 agent keys that exist are read; V1 keys and the CLI
// wallet are never opened. Offline: no RPC, nothing sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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

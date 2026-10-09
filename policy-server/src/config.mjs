// Loads public config (v2.config.json, demo-vault.config.json) and the
// server's own signing key. The private key stays in this process.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
export const KEYS_DIR = join(homedir(), 'agent-vault', 'keys');
export const PORT = 4031;
export const WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const DEVNET_URL = 'https://api.devnet.solana.com';

export function loadConfig() {
  const v2 = JSON.parse(readFileSync(join(ROOT, 'policy-server', 'v2.config.json'), 'utf8'));
  const demo = JSON.parse(readFileSync(join(ROOT, 'agent-service', 'demo-vault.config.json'), 'utf8'));
  return { v2, demo };
}

export async function loadServerSigner(v2) {
  const bytes = Uint8Array.from(JSON.parse(readFileSync(join(KEYS_DIR, v2.policyServer.keyFile), 'utf8')));
  return createKeyPairSignerFromBytes(bytes);
}

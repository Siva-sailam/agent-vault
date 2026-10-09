// Copies the PUBLIC V2 addresses into the front end (like setup-agent-usd.ts
// does for demo-vault.json). Public keys only.
//   node scripts/sync-app-config.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const v2 = JSON.parse(readFileSync(join(root, 'policy-server', 'v2.config.json'), 'utf8'));
const out = {
  owner: v2.owner,
  mint: v2.mint,
  decimals: v2.decimals,
  policyServer: v2.policyServer.address,
  agents: Object.entries(v2.agents).map(([name, a]) => ({
    name,
    v1Name: name.replace(/-v2$/, ''),
    address: a.address,
    multisig: a.multisig.address,
    vault: a.vault,
  })),
};
writeFileSync(join(root, 'app', 'src', 'lib', 'v2-vaults.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote app/src/lib/v2-vaults.json');

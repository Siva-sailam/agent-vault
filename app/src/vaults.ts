// Which vault (mint, owner, merchants, agents) the app talks to.
//
//   /                  → the Agent USD demo vault (aUSD)   [default]
//   /?vault=b          → the original Vault B (Demo USD)
//
// The demo vault's data lives in lib/demo-vault.json, written by
// scripts/setup-agent-usd.ts (public addresses only).
import demo from './lib/demo-vault.json';
import { DEMO_USD_MINT, MERCHANT_CATALOGUE } from './catalogue';

export type MerchantDef = { label: string; wallet: string };
export type DemoAgent = { name: string; address: string; weeklyBudget: number; merchants: string[] };

export type VaultConfig = {
  id: 'demo' | 'b';
  title: string;
  /** Token name shown in the UI, e.g. "aUSD". */
  symbol: string;
  /** Vault owner (the main wallet). */
  owner: string;
  mint: string;
  merchants: MerchantDef[];
  /** Agents to register via the "Set up demo vault" button. Absent for Vault B. */
  setupAgents?: DemoAgent[];
  /** Agent public key -> display name. */
  agentNames: Record<string, string>;
};

const DEMO: VaultConfig = {
  id: 'demo',
  title: 'Agentic vault',
  symbol: demo.tokenSymbol,
  owner: demo.owner,
  mint: demo.mint,
  merchants: Object.entries(demo.merchants).map(([label, wallet]) => ({ label, wallet })),
  setupAgents: Object.entries(demo.agents).map(([name, a]) => ({
    name,
    address: a.address,
    weeklyBudget: a.weeklyBudget,
    merchants: a.merchants,
  })),
  agentNames: Object.fromEntries(Object.entries(demo.agents).map(([name, a]) => [a.address, name])),
};

const VAULT_B: VaultConfig = {
  id: 'b',
  title: 'Agentic vault (Vault B)',
  symbol: 'Demo USD',
  owner: '7HTMgaG3vBkr9fKVgLg71iEz5TaNVTgQpZR5mqDFnbeg',
  mint: DEMO_USD_MINT,
  merchants: MERCHANT_CATALOGUE,
  agentNames: {
    '9AVXftuvUQm6y8s4uoWUEDBeQcPMDABcDNBLTeaQa1eb': 'agent-grocery',
    '4i8XMX2vk9rYEnJ9nh8bHTsZR6R1B5yHLCQBpfZ82AXY': 'agent-second',
  },
};

function pick(): VaultConfig {
  try {
    return new URLSearchParams(window.location.search).get('vault') === 'b' ? VAULT_B : DEMO;
  } catch {
    return DEMO;
  }
}

export const ACTIVE_VAULT: VaultConfig = pick();

/** Merchant labels the given agent may be offered, or all if unconstrained. */
export function merchantLabelsFor(agentAddress: string): string[] {
  const a = ACTIVE_VAULT.setupAgents?.find((x) => x.address === agentAddress);
  return a ? a.merchants : ACTIVE_VAULT.merchants.map((m) => m.label);
}

/** Key used for merchant icons: lower-case, no spaces. */
export const merchantKeyOf = (label: string) => label.toLowerCase().replace(/\s+/g, '');

/** Display name for an agent's public key, or a short form of the key. */
export function agentNameFor(agentAddress: string): string {
  return ACTIVE_VAULT.agentNames[agentAddress] ?? `agent-${agentAddress.slice(-4)}`;
}

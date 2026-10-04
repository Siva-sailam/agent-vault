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
  mint: string;
  merchants: MerchantDef[];
  /** Agents to register via the "Set up demo vault" button. Absent for Vault B. */
  setupAgents?: DemoAgent[];
};

const DEMO: VaultConfig = {
  id: 'demo',
  title: 'Agentic vault',
  symbol: demo.tokenSymbol,
  mint: demo.mint,
  merchants: Object.entries(demo.merchants).map(([label, wallet]) => ({ label, wallet })),
  setupAgents: Object.entries(demo.agents).map(([name, a]) => ({
    name,
    address: a.address,
    weeklyBudget: a.weeklyBudget,
    merchants: a.merchants,
  })),
};

const VAULT_B: VaultConfig = {
  id: 'b',
  title: 'Agentic vault (Vault B)',
  symbol: 'Demo USD',
  mint: DEMO_USD_MINT,
  merchants: MERCHANT_CATALOGUE,
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

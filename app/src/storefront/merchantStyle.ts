// Look of each demo merchant on the storefront: an emoji on a gradient tile.
// Original, brand-free visuals — the merchant names are invented.
const EMOJI: Record<string, string> = {
  kubereats: '🍔',
  talabird: '🛵',
  zomatic: '🍕',
  noonly: '🥡',
  amazen: '📦',
  flipkort: '🛒',
  nykeo: '👟',
  meeshi: '👗',
  // Vault B's labels reuse the same four names; kept for older configs.
  noon: '🥡',
  talabat: '🛵',
  zomato: '🍕',
  ubereats: '🍔',
};

const HUE: Record<string, number> = {
  kubereats: 145,
  talabird: 25,
  zomatic: 350,
  noonly: 52,
  amazen: 205,
  flipkort: 265,
  nykeo: 175,
  meeshi: 320,
};

const key = (label: string) => label.toLowerCase().replace(/\s+/g, '');

function hashHue(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function merchantStyle(label: string): { emoji: string; background: string } {
  const k = key(label);
  const hue = HUE[k] ?? hashHue(k);
  return {
    emoji: EMOJI[k] ?? '🛍️',
    background: `linear-gradient(135deg, hsl(${hue} 90% 62%), hsl(${(hue + 45) % 360} 90% 52%))`,
  };
}

/** Emoji + readable group title for an agent, from its name. */
export function agentStyle(name: string): { emoji: string; category: string } {
  const n = name.toLowerCase();
  if (n.includes('food')) return { emoji: '🍔', category: 'Food' };
  if (n.includes('shop')) return { emoji: '🛍️', category: 'Shopping' };
  if (n.includes('grocery')) return { emoji: '🛒', category: 'Grocery' };
  return { emoji: '🤖', category: name };
}

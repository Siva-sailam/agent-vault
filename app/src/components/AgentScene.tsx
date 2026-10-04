import type { CSSProperties } from 'react';

export type AgentTheme = 'food' | 'shop';

/** Which look an agent gets, from its name. */
export function themeFor(name: string): AgentTheme {
  return /food|grocery|eat/i.test(name) ? 'food' : 'shop';
}

const ITEMS: Record<AgentTheme, string[]> = {
  food: ['🍔', '🍟', '🍕', '🌮', '🍩'],
  shop: ['🛍️', '👟', '👗', '📦', '🏷️'],
};

// One lap takes LAP seconds. Items sit at ITEM_LEFT (% of the track); the
// actor reaches an item at a known fraction of the lap, and that item's own
// keyframes make it vanish exactly then and reappear when the lap restarts.
const LAP = 7;
const ITEM_LEFT = [18, 35, 52, 69, 86];
const START = -12; // actor starts this far left of the track (%)
const SPAN = 120; // and runs this far (%) per lap
const FRONT = 11; // how far ahead of the actor's left edge it eats (%)

const reachOf = (i: number) => (ITEM_LEFT[i] - FRONT - START) / SPAN; // lap fraction

/** Keyframes for one item: visible, eaten at its moment, back at lap restart. */
function keyframesFor(theme: AgentTheme, i: number): string {
  const at = reachOf(i) * 100;
  const gone =
    theme === 'food' ? 'opacity:0;transform:scale(.15)' : 'opacity:0;transform:translateY(14px) scale(.2)';
  const pop = theme === 'food' ? 'transform:scale(1.3)' : 'transform:translateY(-8px) scale(1.15)';
  return `@keyframes scene-eat-${theme}-${i}{0%,${(at - 3).toFixed(1)}%{opacity:1;transform:none}${at.toFixed(1)}%{opacity:1;${pop}}${(at + 2).toFixed(1)}%,99.5%{${gone}}100%{opacity:1;transform:none}}`;
}

/**
 * A little looping scene across the top of an agent card: a pac-man-style
 * muncher eating burgers for the food agent, a shopping cart collecting
 * bags for the shopping agent. Purely decorative. When the agent is revoked
 * the actor stops, the items stay uneaten and everything greys out.
 */
export function AgentScene({ theme, revoked }: { theme: AgentTheme; revoked: boolean }) {
  return (
    <div className={`scene scene-${theme}${revoked ? ' is-revoked' : ''}`} aria-hidden="true">
      <style>{ITEMS[theme].map((_, i) => keyframesFor(theme, i)).join('')}</style>
      <div className="scene-track" style={{ ['--lap' as string]: `${LAP}s` } as CSSProperties}>
        {ITEMS[theme].map((emoji, i) => {
          return (
            <span key={i} className="scene-item" style={{ left: `${ITEM_LEFT[i]}%`, animationName: `scene-eat-${theme}-${i}` }}>
              <span className="scene-item-inner" style={{ animationDelay: `${(i * 0.3).toFixed(1)}s` }}>
                {emoji}
              </span>
            </span>
          );
        })}
        {theme === 'food' ? (
          <span className="scene-actor pacman">
            <span className="pacman-body" />
          </span>
        ) : (
          <span className="scene-actor cart">
            <svg className="cart-body" viewBox="0 0 48 48" width="42" height="42">
              <path d="M4 8h6l5 22h22l5-16H13" fill="#fff" stroke="#e11d74" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M17 20h23M19 26h19" stroke="#ff8fc4" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="19" cy="38" r="3.6" fill="#e11d74" />
              <circle cx="34" cy="38" r="3.6" fill="#e11d74" />
            </svg>
          </span>
        )}
      </div>
      {revoked && <span className="scene-stamp">⛔ REVOKED</span>}
    </div>
  );
}

export type AgentTheme = 'food' | 'shop';

/** Which look an agent gets, from its name. */
export function themeFor(name: string): AgentTheme {
  return /food|grocery|eat/i.test(name) ? 'food' : 'shop';
}

/**
 * Static artwork embossed into the face of an agent card — drawn in plain
 * shapes and tinted/shaded by CSS (.agent-art) so it reads as raised
 * relief rather than a picture. Food: a pac-man chasing dots toward a
 * burger. Shopping: a bag, a cart and a price tag. Original shapes only.
 */
export function AgentArt({ theme }: { theme: AgentTheme }) {
  return (
    <svg className="agent-art" viewBox="0 0 260 150" aria-hidden="true">
      {theme === 'food' ? (
        <>
          {/* pac-man */}
          <path d="M58 75 L99.9 55.6 A46 46 0 1 0 99.9 94.4 Z" />
          <circle className="agent-art-cut" cx="66" cy="48" r="4.5" />
          {/* dots */}
          <circle cx="121" cy="75" r="5.5" />
          <circle cx="143" cy="75" r="5.5" />
          {/* burger: top bun, patty, lettuce, bottom bun */}
          <path d="M176 70 Q176 40 206 40 Q236 40 236 70 Z" />
          <rect x="174" y="74" width="64" height="9" rx="4.5" />
          <path d="M174 88 q8 7 16 0 t16 0 t16 0 t16 0 v3 h-64 z" />
          <path d="M176 96 h60 v5 q0 10 -10 10 h-40 q-10 0 -10 -10 z" />
        </>
      ) : (
        <>
          {/* shopping bag */}
          <path d="M26 58 h66 l8 72 h-82 z" />
          <path d="M46 58 v-10 a13 13 0 0 1 26 0 v10" className="agent-art-line" />
          <circle className="agent-art-cut" cx="48" cy="72" r="3.5" />
          <circle className="agent-art-cut" cx="72" cy="72" r="3.5" />
          {/* cart */}
          <g transform="translate(112 22) scale(2.3)">
            <path d="M3 8h6l5 22h22l5-16H12" className="agent-art-line" />
            <path d="M14 14 h26 l-4 14 h-20 z" />
            <circle cx="19" cy="38" r="3.8" />
            <circle cx="34" cy="38" r="3.8" />
          </g>
          {/* price tag */}
          <path d="M214 30 l26 26 -22 22 -26 -26 v-22 z" />
          <circle className="agent-art-cut" cx="205" cy="41" r="4" />
        </>
      )}
    </svg>
  );
}

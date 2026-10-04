import { merchantStyle } from '../storefront/merchantStyle';

/** Colourful emoji tile for a merchant — original, brand-free visuals. */
export function MerchantAvatar({ label, size = 40 }: { label: string; size?: number }) {
  const s = merchantStyle(label);
  return (
    <span
      className="merchant-avatar"
      style={{ width: size, height: size, background: s.background, fontSize: size * 0.5 }}
      aria-hidden="true"
    >
      {s.emoji}
    </span>
  );
}

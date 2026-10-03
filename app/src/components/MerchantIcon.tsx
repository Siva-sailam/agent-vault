import { useState, type ComponentType } from 'react';
import { ShoppingBagIcon, ScooterIcon, PlateIcon, TakeoutIcon } from './icons';

// Where to drop a real logo: app/public/merchants/<key>.png
// If it's missing (404), the neutral category icon below is shown instead.
// No brand logo is drawn here — these are placeholders only.
const CATEGORY_ICON: Record<string, ComponentType<{ size?: number }>> = {
  noon: ShoppingBagIcon,
  talabat: ScooterIcon,
  zomato: PlateIcon,
  ubereats: TakeoutIcon,
};

export function MerchantIcon({ merchantKey, size = 28 }: { merchantKey: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const Fallback = CATEGORY_ICON[merchantKey] ?? ShoppingBagIcon;

  if (failed) {
    return (
      <span className="merchant-icon merchant-icon-fallback" style={{ width: size, height: size }}>
        <Fallback size={size * 0.6} />
      </span>
    );
  }

  return (
    <span className="merchant-icon" style={{ width: size, height: size }}>
      <img
        src={`/merchants/${merchantKey}.png`}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
      />
    </span>
  );
}

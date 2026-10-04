// Small original line icons — 24x24, single stroke weight, round caps.
// No brand marks are drawn or approximated anywhere in this file.
type IconProps = { size?: number; className?: string };
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function WalletIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M15 13.5h3" />
    </svg>
  );
}

export function CheckIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M7.5 12.5l2.8 2.8L16.7 9" />
    </svg>
  );
}

export function AlertIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="9.25" />
      <path d="M12 7.5v5.5" />
      <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SpinnerIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`spin ${className ?? ''}`} {...base}>
      <path d="M12 3a9 9 0 1 1-6.36 2.64" />
    </svg>
  );
}

export function ChipIcon({ size = 28, className }: IconProps) {
  return (
    <svg width={size} height={(size * 20) / 28} viewBox="0 0 28 20" className={className}>
      <rect x="0.8" y="0.8" width="26.4" height="18.4" rx="3.5" fill="currentColor" opacity="0.9" />
      <path d="M6 0.8v18.4M22 0.8v18.4M0.8 7h26.4M0.8 13h26.4" stroke="rgba(20,26,20,0.35)" strokeWidth="0.8" />
    </svg>
  );
}

// Category fallbacks, used only when a merchant has no logo image.
export function ShoppingBagIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M6.5 8.5h11l1 11.5h-13z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </svg>
  );
}

export function ScooterIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="6" cy="17.5" r="2.2" />
      <circle cx="18" cy="17.5" r="2.2" />
      <path d="M6 17.5h5l2.5-7H17M11 10.5h4.5M8 17.5h8" />
      <path d="M15.5 6.5h2.3l1 3" />
    </svg>
  );
}

export function PlateIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

export function TakeoutIcon({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...base}>
      <path d="M5.5 9.5h13l-1 10h-11z" />
      <path d="M9 9.5V8a3 3 0 0 1 6 0v1.5" />
      <path d="M5.5 9.5h13" />
    </svg>
  );
}

/** AI-agent mark: a bot head with an antenna and a small sparkle. Drawn in
 * currentColor so it can sit on any card colour. */
export function AgentLogoIcon({ size = 26, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 5.5v3.2" />
      <circle cx="16" cy="4.4" r="1.5" fill="currentColor" stroke="none" />
      <rect x="6" y="9" width="20" height="15" rx="5.5" />
      <circle cx="12" cy="16" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="20" cy="16" r="1.9" fill="currentColor" stroke="none" />
      <path d="M12.5 20.2c1.9 1.3 5.1 1.3 7 0" />
      <path d="M3 15v3M29 15v3" />
      <path d="M25.6 3.2l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" fill="currentColor" stroke="none" />
    </svg>
  );
}

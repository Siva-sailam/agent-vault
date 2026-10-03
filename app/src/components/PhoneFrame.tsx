import type { ReactNode } from 'react';

// A generic modern phone frame drawn entirely in CSS — no device logos or
// brand-specific chrome, just the near-universal rounded-bezel /
// top-island / bottom-home-indicator language shared across current phone
// designs in general.
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="phone">
      <div className="phone-screen">
        <div className="phone-island" />
        {children}
        <div className="phone-home-indicator" />
      </div>
    </div>
  );
}

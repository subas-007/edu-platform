'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { themeCss, type Branding } from '@/lib/branding';

const BrandingContext = createContext<{ branding: Branding; setBranding: (b: Branding) => void } | null>(null);

/**
 * Holds the site's branding (from the server render) and applies its colours. When an admin
 * saves new branding, `setBranding` re-themes the open page at once; everyone else gets it on
 * their next page load.
 */
export function BrandingProvider({ initial, children }: { initial: Branding; children: ReactNode }) {
  const [branding, setBrandingState] = useState(initial);
  const value = useMemo(
    () => ({
      branding,
      setBranding: (next: Branding) => {
        if (document.title === branding.appName) document.title = next.appName;
        setBrandingState(next);
      },
    }),
    [branding],
  );
  return (
    <BrandingContext.Provider value={value}>
      {/* Unlayered :root rules win over Tailwind's @theme defaults. Content is hex colours only. */}
      {branding.palette && <style id="brand-theme">{themeCss(branding.palette)}</style>}
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): Branding {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used inside BrandingProvider');
  return ctx.branding;
}

export function useSetBranding(): (b: Branding) => void {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useSetBranding must be used inside BrandingProvider');
  return ctx.setBranding;
}

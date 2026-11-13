'use client';

import { GraduationCap } from 'lucide-react';
import { useBranding } from '../BrandingProvider';

const SIZES = {
  sm: { box: 'h-9 w-9', icon: 'h-5 w-5' },
  lg: { box: 'h-10 w-10', icon: 'h-6 w-6' },
};

/** The administrator's logo, or the default mark in the theme colour. Decorative: the name is shown next to it. */
export function BrandMark({ size = 'sm' }: { size?: keyof typeof SIZES }) {
  const { logoUrl } = useBranding();
  const s = SIZES[size];
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- small same-origin image; next/image adds nothing here
    return <img src={logoUrl} alt="" className={`${s.box} shrink-0 rounded-xl object-contain`} />;
  }
  return (
    <span
      className={`flex ${s.box} shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-aqua-400 to-aqua-600 text-ink-950 shadow-lg shadow-aqua-500/30`}
    >
      <GraduationCap className={s.icon} aria-hidden />
    </span>
  );
}

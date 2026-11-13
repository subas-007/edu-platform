/** The site's name, logo and colours, set by an administrator (GET /branding). */
export interface Branding {
  appName: string;
  accentColor: string;
  surface: SurfaceTheme;
  /** Same-origin, versioned URL, or null for the default mark. */
  logoUrl: string | null;
  /** Shade scales computed by the API; null = the built-in theme in globals.css. */
  palette: Palette | null;
  updatedAt: string | null;
}

export type SurfaceTheme = 'MIDNIGHT' | 'GRAPHITE' | 'PLUM' | 'PINE' | 'ESPRESSO';

export interface Palette {
  accent: Record<string, string>;
  surface: Record<string, string>;
  accentOnLight: string;
}

export interface BrandingOptions {
  accentPresets: Array<{ label: string; color: string }>;
  surfaces: Array<{ id: SurfaceTheme; label: string; swatch: Record<string, string> }>;
  defaults: { appName: string; accentColor: string; surface: SurfaceTheme };
  maxLogoBytes: number;
}

/** Used when the API cannot be reached: the built-in name and theme. */
export const DEFAULT_BRANDING: Branding = {
  appName: 'Edu Platform',
  accentColor: '#3ee2d2',
  surface: 'MIDNIGHT',
  logoUrl: null,
  palette: null,
  updatedAt: null,
};

const HEX = /^#[0-9a-f]{6}$/i;
const SHADE = /^\d{2,3}$/;

/**
 * The theme's colour variables (Tailwind reads every aqua-* / ink-* utility from them).
 * Values are re-checked here, so nothing but hex colours can reach the <style> element.
 */
export function themeVariables(palette: Palette): Record<string, string> {
  const vars: Record<string, string> = {};
  const add = (scale: Record<string, string>, name: string) => {
    for (const [shade, color] of Object.entries(scale)) {
      if (SHADE.test(shade) && HEX.test(color)) vars[`--color-${name}-${shade}`] = color;
    }
  };
  add(palette.accent, 'aqua');
  add(palette.surface, 'ink');
  return vars;
}

export function themeCss(palette: Palette): string {
  const body = Object.entries(themeVariables(palette))
    .map(([name, value]) => `${name}:${value};`)
    .join('');
  return `:root{${body}}`;
}

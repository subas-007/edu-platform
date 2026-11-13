/**
 * Turns the administrator's chosen colours into the shade scales the web app and PDFs use.
 *
 * The web theme is two Tailwind scales: `accent` (buttons, links, highlights; --color-aqua-*)
 * and `surface` (page and panel backgrounds; --color-ink-*). Every shade has a fixed OKLCH
 * lightness, so text contrast holds whatever colour is picked (dark text on accent-400, accent
 * text on dark surfaces). Only hue and chroma come from the chosen colour, and chroma is reduced
 * until the shade fits in sRGB, so every value served is a plain, predictable hex colour.
 */

export const DEFAULT_APP_NAME = 'Edu Platform';
export const DEFAULT_ACCENT = '#3ee2d2';

export const ACCENT_SHADES = [100, 200, 300, 400, 500, 600, 700] as const;
export const SURFACE_SHADES = [950, 900, 850, 800, 700, 600, 500] as const;
export type AccentShade = (typeof ACCENT_SHADES)[number];
export type SurfaceShade = (typeof SURFACE_SHADES)[number];

export interface Palette {
  accent: Record<AccentShade, string>;
  surface: Record<SurfaceShade, string>;
  /** Accent dark enough for text on white (PDF pages): at least 4.5:1. */
  accentOnLight: string;
}

/** The original design: returned exactly for the default choices. */
const DEFAULT_ACCENT_SCALE: Record<AccentShade, string> = {
  100: '#dafcf8',
  200: '#b4f7f0',
  300: '#78efe3',
  400: '#3ee2d2',
  500: '#19c6b6',
  600: '#0f9f93',
  700: '#0b7c73',
};
const MIDNIGHT_SCALE: Record<SurfaceShade, string> = {
  950: '#070d1a',
  900: '#0b1426',
  850: '#0e182d',
  800: '#132038',
  700: '#1b2c4c',
  600: '#263b63',
  500: '#3a527f',
};

/** Lightness of each shade relative to 400, the chosen colour (as in the original scale). */
const ACCENT_OFFSET: Record<AccentShade, number> = { 100: 0.14, 200: 0.11, 300: 0.055, 400: 0, 500: -0.085, 600: -0.195, 700: -0.3 };
/** 400 is used as text on panels and behind dark button text: WCAG AA for normal text. */
const MIN_CONTRAST = 4.5;

/** Background presets: a hue and how much of it, at the lightness of the original design. */
export const SURFACE_PRESETS = {
  MIDNIGHT: { label: 'Midnight blue', hue: 0, chromaScale: 1 }, // the original, returned exactly
  GRAPHITE: { label: 'Graphite', hue: 260, chromaScale: 0.15 },
  PLUM: { label: 'Plum', hue: 315, chromaScale: 0.9 },
  PINE: { label: 'Pine', hue: 175, chromaScale: 0.75 },
  ESPRESSO: { label: 'Espresso', hue: 55, chromaScale: 0.55 },
} as const;
export type SurfacePreset = keyof typeof SURFACE_PRESETS;
export const DEFAULT_SURFACE: SurfacePreset = 'MIDNIGHT';

export const HEX_COLOR = /^#[0-9a-f]{6}$/;

export function buildPalette(accentHex: string, surface: SurfacePreset): Palette {
  const surfaceScaleHex = surface === 'MIDNIGHT' ? { ...MIDNIGHT_SCALE } : surfaceScale(SURFACE_PRESETS[surface]);
  const accent =
    accentHex.toLowerCase() === DEFAULT_ACCENT && surface === 'MIDNIGHT'
      ? { ...DEFAULT_ACCENT_SCALE }
      : accentScale(accentHex.toLowerCase(), surfaceScaleHex);
  return {
    accent,
    surface: surfaceScaleHex,
    accentOnLight: darkenForContrast(accent[700], '#ffffff', MIN_CONTRAST),
  };
}

/**
 * 400 is exactly the chosen colour when it reads well on the darkest background and on panels
 * (surface 800); otherwise it is lightened just enough. The other shades sit around it.
 */
function accentScale(hex: string, surface: Record<SurfaceShade, string>): Record<AccentShade, string> {
  const { l: sourceL, c, h } = hexToOklch(hex);
  let l = sourceL;
  let base = hex;
  const readable = (color: string) =>
    contrastRatio(color, surface[950]) >= MIN_CONTRAST && contrastRatio(color, surface[800]) >= MIN_CONTRAST;
  while (!readable(base) && l < 0.99) {
    l += 0.005;
    base = inGamutHex(l, c, h);
  }
  const scale = {} as Record<AccentShade, string>;
  for (const shade of ACCENT_SHADES) {
    scale[shade] = shade === 400 ? base : inGamutHex(Math.min(0.985, Math.max(0.3, l + ACCENT_OFFSET[shade])), c, h);
  }
  return scale;
}

function surfaceScale(preset: { hue: number; chromaScale: number }): Record<SurfaceShade, string> {
  const scale = {} as Record<SurfaceShade, string>;
  for (const shade of SURFACE_SHADES) {
    const original = hexToOklch(MIDNIGHT_SCALE[shade]);
    scale[shade] = inGamutHex(original.l, original.c * preset.chromaScale, preset.hue);
  }
  return scale;
}

/** Lowers lightness until `hex` reaches `ratio` against `background`. */
function darkenForContrast(hex: string, background: string, ratio: number): string {
  let { l } = hexToOklch(hex);
  const { c, h } = hexToOklch(hex);
  let out = hex;
  while (contrastRatio(out, background) < ratio && l > 0.05) {
    l -= 0.01;
    out = inGamutHex(l, c, h);
  }
  return out;
}

// --- WCAG contrast ------------------------------------------------------------------------------

export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// --- OKLCH <-> sRGB (Björn Ottosson's OKLab) ------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

function oklchToLinearRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

/** The colour at this lightness and hue, with chroma reduced (binary search) until it is in sRGB. */
function inGamutHex(l: number, c: number, h: number): string {
  const fits = (chroma: number) => oklchToLinearRgb(l, chroma, h).every((v) => v >= -1e-6 && v <= 1 + 1e-6);
  let chroma = c;
  if (!fits(chroma)) {
    let [lo, hi] = [0, c];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  const rgb = oklchToLinearRgb(l, chroma, h).map((v) => Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

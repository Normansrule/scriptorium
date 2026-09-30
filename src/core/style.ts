/**
 * Single source of truth for the visual style described in docs/STYLE.md.
 * Figures, the web book, the Typst template and the README art all read from here,
 * and tests/unit/style.test.ts checks every pairing against WCAG contrast rules.
 *
 * Hues come from the Okabe–Ito colorblind-safe set (Okabe & Ito, "Color Universal
 * Design", 2008); light-mode values are darkened within the same hue so strokes reach
 * 3:1 and text reaches 4.5:1 on white.
 */

export type Mode = 'light' | 'dark';

export interface RoleColor {
  /** What the color means everywhere it appears. */
  meaning: string;
  light: string;
  dark: string;
  /** true when the color may be used for small text (needs 4.5:1), false = strokes/fills only (3:1). */
  text: boolean;
}

export const surface = {
  paper: { light: '#FFFFFF', dark: '#0D1117' },
  panel: { light: '#F6F8FA', dark: '#161B22' },
  ink: { light: '#1F2328', dark: '#E6EDF3' },
  muted: { light: '#57606A', dark: '#8B949E' },
  rule: { light: '#D0D7DE', dark: '#30363D' },
} as const;

export const roles = {
  signal: {
    meaning: 'The main quantity or flow being explained (e.g., voltage, the data moving through the pipeline).',
    light: '#0072B2',
    dark: '#3D95C9',
    text: true,
  },
  accent: {
    meaning: 'A second quantity compared against the first (e.g., current), or the one thing to look at.',
    light: '#B34E00',
    dark: '#E0651F',
    text: true,
  },
  verified: {
    meaning: 'Checked, passed, or safe: verified references, passing pre-flight rules, data that stays local.',
    light: '#007A5A',
    dark: '#2BC495',
    text: true,
  },
  checkpoint: {
    meaning: 'A human decision point. Used only for the two human checkpoints and user actions.',
    light: '#A86F00',
    dark: '#E69F00',
    text: false,
  },
  external: {
    meaning: 'Leaves the machine or comes from outside: the model provider, fetched papers, untrusted content.',
    light: '#A8538A',
    dark: '#B97AB8',
    text: true,
  },
} as const satisfies Record<string, RoleColor>;

export type Role = keyof typeof roles;

/**
 * Fixed order for data series inside a plot (never cycled; a 4th series means small
 * multiples instead). Validated with the dataviz palette checker in both modes:
 * lightness band, chroma floor, colorblind (CVD) separation ΔE ≥ 14, normal-vision ΔE ≥ 15.
 */
export const seriesOrder: readonly Role[] = ['signal', 'accent', 'external'];

/** Tint used for soft fills behind a role color. */
export const fillAlpha: Record<Mode, number> = { light: 0.12, dark: 0.2 };

export const fonts = {
  body: 'Source Serif 4',
  sans: 'Source Sans 3',
  mono: 'DejaVu Sans Mono',
  /** Print math font (bundled with Typst); the web uses KaTeX's fonts. */
  mathPrint: 'New Computer Modern Math',
} as const;

/**
 * Print minimums. KDP requires lines ≥ 0.75 pt and text ≥ 7 pt (Paperback Submission
 * Guidelines, G201857950); we set our own floors above those.
 */
export const printMinimums = {
  lineWidthPt: 1.0,
  labelSizePt: 8,
  grayFillPercent: 12,
} as const;

/** Animation timing, in milliseconds. */
export const motion = {
  transitionMs: 400,
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  holdKeyFrameMs: 1500,
  minLoopMs: 3000,
  maxLoopMs: 8000,
} as const;

/** Dash patterns so series stay distinguishable in grayscale print (never rely on color alone). */
export const dashes = ['none', '6 3', '2 3', '8 3 2 3'] as const;

// ---------------------------------------------------------------------------
// Contrast helpers (WCAG 2.2 relative luminance and contrast ratio)

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** CSS custom properties for a mode, used by the web book, the app and SVG figures. */
export function cssVariables(mode: Mode): string {
  const lines = [
    ...Object.entries(surface).map(([k, v]) => `--sc-${k}: ${v[mode]};`),
    ...Object.entries(roles).map(([k, v]) => `--sc-${k}: ${v[mode]};`),
  ];
  return lines.join(' ');
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

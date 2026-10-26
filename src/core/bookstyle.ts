/**
 * Book styles: the colour of a book's *chrome* — chapter openers, headings, the frame of learning
 * blocks, step numbers — chosen per book with `meta.style`.
 *
 * A style never touches meaning. Figures, plots and callouts keep the colour roles in style.ts
 * (signal, accent, verified…), so "blue is the main quantity" holds in every book whatever its
 * style. tests/unit/bookstyle.test.ts checks every text pairing against WCAG AA in both modes.
 *
 * The first three after Classic are the Phase 0 visual concepts (docs/PHASE-0.md), so a book and
 * its 3D Edition can share one look.
 */
import { contrast, surface, type Mode } from './style.ts';

export interface StyleTokens {
  /** chapter-number chip and step-number discs */
  band: string;
  /** text on `band` (≥ 4.5:1) */
  bandInk: string;
  /** chapter and section headings (≥ 4.5:1 on paper and on tint) */
  heading: string;
  /** decorative rules: the left edge of learning blocks, the hook bar (≥ 3:1 on paper, except Classic's hairline) */
  mark: string;
  /** background of goal boxes and learning-block heads (body ink stays ≥ 4.5:1 on it) */
  tint: string;
}

export interface BookStyle {
  id: string;
  name: string;
  /** one line for the style picker */
  description: string;
  light: StyleTokens;
  dark: StyleTokens;
}

export const BOOK_STYLES = {
  classic: {
    id: 'classic',
    name: 'Classic',
    description: 'Quiet greys; colour only where it means something.',
    light: { band: surface.panel.light, bandInk: surface.muted.light, heading: surface.ink.light, mark: surface.rule.light, tint: surface.panel.light },
    dark: { band: surface.panel.dark, bandInk: surface.muted.dark, heading: surface.ink.dark, mark: surface.rule.dark, tint: surface.panel.dark },
  },
  bookcloth: {
    id: 'bookcloth',
    name: 'Bookcloth',
    description: 'Deep blue cloth with an orange headband thread.',
    light: { band: '#1E4F9C', bandInk: '#FFFFFF', heading: '#173F7E', mark: '#D0601C', tint: '#EEF3FB' },
    dark: { band: '#2A5FB0', bandInk: '#FFFFFF', heading: '#9CBDF0', mark: '#F08A3C', tint: '#121C2B' },
  },
  plate: {
    id: 'plate',
    name: 'Plate & Field',
    description: 'Black type on white with a signal-orange edge, like a museum plate.',
    light: { band: '#141414', bandInk: '#FFFFFF', heading: '#141414', mark: '#E8582A', tint: '#EEF3EF' },
    dark: { band: '#FE7141', bandInk: '#141414', heading: '#F4F4F4', mark: '#FE7141', tint: '#161D18' },
  },
  window: {
    id: 'window',
    name: 'Sentence & Window',
    description: 'Olive and ochre on warm paper, like an old reading room.',
    light: { band: '#525E1B', bandInk: '#FFFFFF', heading: '#3F4813', mark: '#A87C22', tint: '#F7F3E6' },
    dark: { band: '#6B7A22', bandInk: '#FFFFFF', heading: '#DCC690', mark: '#C79A3E', tint: '#1D1A12' },
  },
  lagoon: {
    id: 'lagoon',
    name: 'Lagoon',
    description: 'Teal water and a coral edge: bright, calm, made for long reading.',
    light: { band: '#0F6E73', bandInk: '#FFFFFF', heading: '#0B5559', mark: '#D9553A', tint: '#EAF5F4' },
    dark: { band: '#127C82', bandInk: '#FFFFFF', heading: '#82D2CD', mark: '#F08466', tint: '#0F1D1E' },
  },
  orchard: {
    id: 'orchard',
    name: 'Orchard',
    description: 'Plum and harvest gold, for a book with some warmth.',
    light: { band: '#5B2A6E', bandInk: '#FFFFFF', heading: '#4A2159', mark: '#B57F12', tint: '#F5EFF7' },
    dark: { band: '#7A3D91', bandInk: '#FFFFFF', heading: '#D9B8E8', mark: '#E6AE3A', tint: '#1C1420' },
  },
} as const satisfies Record<string, BookStyle>;

export type BookStyleId = keyof typeof BOOK_STYLES;
export const BOOK_STYLE_IDS = Object.keys(BOOK_STYLES) as BookStyleId[];
export const DEFAULT_STYLE: BookStyleId = 'classic';

export const bookStyle = (id: string | undefined): BookStyle => BOOK_STYLES[(id && id in BOOK_STYLES ? id : DEFAULT_STYLE) as BookStyleId];

/** Every text pairing a style must pass, with the minimum ratio, for the tests and the editor. */
export function styleContrasts(s: BookStyle, mode: Mode): Array<{ pair: string; ratio: number; min: number }> {
  const t = s[mode];
  const paper = surface.paper[mode];
  const ink = surface.ink[mode];
  return [
    { pair: 'chip text on chip', ratio: contrast(t.bandInk, t.band), min: 4.5 },
    { pair: 'heading on paper', ratio: contrast(t.heading, paper), min: 4.5 },
    { pair: 'heading on tint', ratio: contrast(t.heading, t.tint), min: 4.5 },
    { pair: 'body text on tint', ratio: contrast(ink, t.tint), min: 4.5 },
    ...(s.id === 'classic' ? [] : [{ pair: 'edge mark on paper', ratio: contrast(t.mark, paper), min: 3 }]),
  ];
}

const vars = (t: StyleTokens) => `--bk-band: ${t.band}; --bk-band-ink: ${t.bandInk}; --bk-heading: ${t.heading}; --bk-mark: ${t.mark}; --bk-tint: ${t.tint};`;

/**
 * CSS custom properties for every style, keyed on a `data-book-style` attribute on the root
 * element, so one stylesheet serves every book and the editor can switch styles live.
 */
export function styleCss(): string {
  const c = BOOK_STYLES.classic;
  const rules = [`:root { ${vars(c.light)} }`, `@media (prefers-color-scheme: dark) { :root { ${vars(c.dark)} } }`];
  for (const s of Object.values(BOOK_STYLES)) {
    if (s.id === 'classic') continue;
    rules.push(`:root[data-book-style="${s.id}"] { ${vars(s.light)} }`);
    rules.push(`@media (prefers-color-scheme: dark) { :root[data-book-style="${s.id}"] { ${vars(s.dark)} } }`);
  }
  return rules.join('\n');
}

/** Typst definitions for a style (print is always the light palette). */
export function styleTypst(id: string | undefined): string {
  const t = bookStyle(id).light;
  const c = (hex: string) => `rgb("${hex}")`;
  return `#let bk-band = ${c(t.band)}
#let bk-band-ink = ${c(t.bandInk)}
#let bk-heading = ${c(t.heading)}
#let bk-mark = ${c(t.mark)}
#let bk-tint = ${c(t.tint)}`;
}

/**
 * The viewer's looks, one per book style (src/core/bookstyle.ts): the three Phase 0 concepts plus
 * Lagoon and Orchard. A book opens in its own style; `?theme=` overrides it. Classic books get
 * Bookcloth, the default binding.
 */
export interface Theme {
  id: 'bookcloth' | 'plate' | 'window' | 'lagoon' | 'orchard';
  name: string;
  /** scene background and the table the book rests on */
  ground: string;
  table: string;
  /** cover cloth, headband thread, page paper */
  cloth: string;
  headband: string;
  paper: string;
  /** interface */
  ui: { panel: string; ink: string; muted: string; accent: string; accentInk: string; line: string };
}

export const THEMES: Record<Theme['id'], Theme> = {
  bookcloth: {
    id: 'bookcloth',
    name: 'Bookcloth',
    ground: '#0d1a2d',
    table: '#14253f',
    cloth: '#1e4f9c',
    headband: '#e0651f',
    paper: '#fbfaf7',
    ui: { panel: 'rgba(10, 21, 38, 0.86)', ink: '#eef2f7', muted: '#a9b6c8', accent: '#f08a3c', accentInk: '#1a0e04', line: 'rgba(238, 242, 247, 0.16)' },
  },
  plate: {
    id: 'plate',
    name: 'Plate & Field',
    ground: '#d1ddd3',
    table: '#c4d2c7',
    cloth: '#141414',
    headband: '#fe7141',
    paper: '#ffffff',
    ui: { panel: 'rgba(255, 255, 255, 0.94)', ink: '#000000', muted: '#4f4f4f', accent: '#fe7141', accentInk: '#000000', line: 'rgba(0, 0, 0, 0.14)' },
  },
  window: {
    id: 'window',
    name: 'Sentence & Window',
    ground: '#3a210f',
    table: '#472913',
    cloth: '#525e1b',
    headband: '#c79a3e',
    paper: '#faf8f2',
    ui: { panel: 'rgba(71, 41, 19, 0.9)', ink: '#e4e0cf', muted: '#c2ad90', accent: '#c79a3e', accentInk: '#2b170a', line: 'rgba(228, 224, 207, 0.16)' },
  },
  lagoon: {
    id: 'lagoon',
    name: 'Lagoon',
    ground: '#062a2c',
    table: '#0a3a3d',
    cloth: '#0f6e73',
    headband: '#f08466',
    paper: '#fbfaf6',
    ui: { panel: 'rgba(6, 36, 38, 0.88)', ink: '#e9f6f4', muted: '#9fc4c0', accent: '#f08466', accentInk: '#2a0d06', line: 'rgba(233, 246, 244, 0.16)' },
  },
  orchard: {
    id: 'orchard',
    name: 'Orchard',
    ground: '#1f1026',
    table: '#2b1734',
    cloth: '#5b2a6e',
    headband: '#e6ae3a',
    paper: '#fcfaf6',
    ui: { panel: 'rgba(33, 17, 41, 0.88)', ink: '#f4ecf7', muted: '#c4afcd', accent: '#e6ae3a', accentInk: '#2a1a02', line: 'rgba(244, 236, 247, 0.16)' },
  },
};

const isTheme = (id: string | null | undefined): id is Theme['id'] => !!id && id in THEMES;

/** The URL's choice wins, then the book's style, then Bookcloth. */
export function pickTheme(fromUrl: string | null, bookStyle?: string): Theme {
  if (isTheme(fromUrl)) return THEMES[fromUrl];
  if (isTheme(bookStyle)) return THEMES[bookStyle];
  return THEMES.bookcloth;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  for (const [k, v] of Object.entries(theme.ui)) root.style.setProperty(`--${k}`, v);
  root.style.setProperty('--ground', theme.ground);
}

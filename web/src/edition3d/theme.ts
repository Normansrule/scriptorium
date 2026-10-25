/**
 * The three visual concepts from Phase 0, as tokens the viewer can switch between
 * (`?theme=bookcloth|plate|window`). Bookcloth is the proposed default; the gate picks one.
 */
export interface Theme {
  id: 'bookcloth' | 'plate' | 'window';
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
};

export function themeFromUrl(): Theme {
  const id = new URLSearchParams(location.search).get('theme');
  return id && id in THEMES ? THEMES[id as Theme['id']] : THEMES.bookcloth;
}

/**
 * Everything a reader can pull out of the book, in one list: figures (lift, 3D model or 3D scene),
 * equations, explorables and self-checks. Pop-ups, hotspots, the desk and study mode all work from
 * this list, so a new kind of item only has to be added here.
 */
import type { Book3D, Chapter3D, Check3D, Equation3D, Explorable3D, Figure3D, Rect } from '../../../src/edition3d/manifest.ts';
import type { BookModel } from './book.ts';
import type { ItemKind } from './kinds.ts';

export type ItemRef = { kind: 'figure' | 'model' | 'scene'; data: Figure3D } | { kind: 'equation'; data: Equation3D } | { kind: 'explore'; data: Explorable3D } | { kind: 'check'; data: Check3D }
  | { kind: 'chapter'; data: Chapter3D; lastPage: number };

export interface Item {
  key: string;
  kind: ItemKind;
  id: string;
  /** "Figure 2.1", "Eq. (2.2)", "Explore 2.1", "Check yourself 2.1" */
  name: string;
  /** one line about it */
  title: string;
  page: number;
  rect: Rect;
  ref: ItemRef;
}

const firstSentence = (s: string) => {
  const m = s.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
};

export function itemsOf(book: Book3D): Item[] {
  const out: Item[] = [];
  for (const f of book.figures) {
    if (f.treatment.mode === 'flat') continue;
    const kind = f.treatment.mode === 'lift' ? 'figure' : f.treatment.mode === 'model' ? 'model' : 'scene';
    out.push({ key: `${kind}:${f.id}`, kind, id: f.id, name: f.number ? `Figure ${f.number}` : 'Figure', title: firstSentence(f.caption), page: f.page, rect: f.rect, ref: { kind, data: f } });
  }
  for (const e of book.equations) out.push({ key: `equation:${e.id}`, kind: 'equation', id: e.id, name: `Eq. (${e.number})`, title: e.intuition, page: e.page, rect: e.rect, ref: { kind: 'equation', data: e } });
  for (const x of book.explorables) out.push({ key: `explore:${x.id}`, kind: 'explore', id: x.id, name: `Explore ${x.number}`, title: x.title, page: x.page, rect: x.rect, ref: { kind: 'explore', data: x } });
  const chapters = [...book.chapters].sort((a, b) => a.page - b.page);
  chapters.forEach((ch, i) => {
    const lastPage = (chapters[i + 1]?.page ?? book.pages.length + 1) - 1;
    out.push({ key: `chapter:${ch.id}`, kind: 'chapter', id: ch.id, name: `Chapter ${ch.number}`, title: ch.title, page: ch.page, rect: ch.rect, ref: { kind: 'chapter', data: ch, lastPage } });
  });
  for (const c of book.checks) out.push({ key: `check:${c.id}`, kind: 'check', id: c.id, name: `Check yourself ${c.number}`, title: c.question, page: c.page, rect: c.rect, ref: { kind: 'check', data: c } });
  return out.sort((a, b) => a.page - b.page || a.rect.y - b.rect.y);
}

/** What a chapter holds: every pull-out item on its pages, in reading order. */
export function chapterItems(chapter: Item, all: Item[]): Item[] {
  if (chapter.ref.kind !== 'chapter') return [];
  const last = chapter.ref.lastPage;
  return all.filter((i) => i.kind !== 'chapter' && i.page >= chapter.page && i.page <= last);
}


const PLURAL: Record<ItemKind, [string, string]> = {
  figure: ['figure', 'figures'],
  model: ['3D model', '3D models'],
  scene: ['3D scene', '3D scenes'],
  equation: ['equation', 'equations'],
  explore: ['explorable', 'explorables'],
  check: ['check', 'checks'],
  chapter: ['chapter', 'chapters'],
};

/** How many of each kind a chapter holds, in a fixed order. */
export function chapterCounts(contents: Item[]): Array<{ kind: ItemKind; n: number; label: string }> {
  const order: ItemKind[] = ['scene', 'model', 'figure', 'equation', 'explore', 'check'];
  return order
    .map((kind) => {
      const n = contents.filter((i) => i.kind === kind).length;
      return { kind, n, label: PLURAL[kind][n === 1 ? 0 : 1] };
    })
    .filter((c) => c.n > 0);
}

/** How two items belong together, said from one side ("Shown in Figure 1.2"). */
export interface Link {
  item: Item;
  /** "Shown in", "Its equation", "Brought to life in", "Brings to life", "Drives", "Driven by" */
  label: string;
  /** an explorable that drives a scene: opening the scene from it should attach the sliders */
  drive?: 'from' | 'to';
}

/**
 * Every connection the book states, both ways: an equation and the figure that shows it
 * (`equation.figure`), an explorable and the equation it brings to life (`explore.equation`), and
 * an explorable and the scenes it drives (`explore.drives`). Nothing is guessed from the text.
 */
export function connections(items: Item[]): Map<string, Link[]> {
  const map = new Map<string, Link[]>(items.map((i) => [i.key, []]));
  const byId = new Map(items.map((i) => [i.id, i]));
  const link = (a: Item, b: Item, ab: string, ba: string, drive = false) => {
    if (a === b || map.get(a.key)!.some((l) => l.item === b)) return;
    map.get(a.key)!.push({ item: b, label: ab, ...(drive ? { drive: 'to' as const } : {}) });
    map.get(b.key)!.push({ item: a, label: ba, ...(drive ? { drive: 'from' as const } : {}) });
  };
  for (const it of items) {
    if (it.ref.kind === 'equation' && it.ref.data.figure) {
      const f = byId.get(it.ref.data.figure);
      if (f) link(it, f, 'Shown in', 'Its equation');
    }
    if (it.ref.kind === 'explore') {
      const x = it.ref.data.block as { equation?: string; drives?: Array<{ kit: string }> };
      const e = x.equation ? byId.get(x.equation) : undefined;
      if (e) link(it, e, 'Brings to life', 'Brought to life in');
      const kits = new Set((x.drives ?? []).map((d) => d.kit));
      for (const f of items) if (f.ref.kind === 'scene' && f.ref.data.treatment.mode === 'scene' && kits.has(f.ref.data.treatment.kit)) link(it, f, 'Drives', 'Driven by', true);
    }
  }
  return map;
}

/** Things a reader can keep and study (a chapter is a way in, not a card). */
export const studyable = (i: Item) => i.kind !== 'chapter';

const cache = new Map<string, Promise<HTMLCanvasElement | null>>();

/** The item cut out of its page image as a canvas (cached), with a little paper margin. */
export function cutOut(model: BookModel, item: Item, maxWidth = 1100): Promise<HTMLCanvasElement | null> {
  let p = cache.get(item.key);
  if (!p) {
    p = model.pageImage(item.page - 1).then((img) => {
      if (!img) return null;
      const s = img.naturalWidth / (model.W * 100); // pixels per point (page width in points = W × 100)
      const pad = 6;
      const sx = Math.max(0, (item.rect.x - pad) * s);
      const sy = Math.max(0, (item.rect.y - pad) * s);
      const sw = Math.min(img.naturalWidth - sx, (item.rect.w + 2 * pad) * s);
      const sh = Math.min(img.naturalHeight - sy, (item.rect.h + 2 * pad) * s);
      const k = Math.min(1, maxWidth / sw);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * k));
      c.height = Math.max(1, Math.round(sh * k));
      c.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return c;
    });
    cache.set(item.key, p);
  }
  return p;
}

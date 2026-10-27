/**
 * The 3D Edition's reading tools that do not need WebGL: the list of things to pull out of the
 * book, the desk (what a reader keeps) and the self-check card, in a browser-like DOM.
 */
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Book3D } from '../../src/edition3d/manifest.ts';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.org/3d.html' });
const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
beforeAll(() => {
  for (const k of ['window', 'document', 'localStorage', 'HTMLElement']) saved[k] = g[k];
  Object.assign(g, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement });
});
afterAll(() => Object.assign(g, saved));

const rect = { x: 50, y: 60, w: 300, h: 120 };
const book = Book3D.parse({
  format: 'scriptorium-3d',
  version: 1,
  title: 'T',
  authors: [],
  page: { width: 432, height: 648 },
  pages: ['pages/p001.jpg', 'pages/p002.jpg'],
  pageScale: 2,
  cloth: '#000000',
  figures: [
    { id: 'fig-b', number: '1.2', page: 2, rect, alt: 'b', caption: 'Second. More.', credit: 'c', treatment: { mode: 'scene', kit: 'rc-loop' } },
    { id: 'fig-a', number: '1.1', page: 1, rect, alt: 'a', caption: 'First figure shows a thing. Then more.', credit: 'c', treatment: { mode: 'lift' } },
    { id: 'fig-flat', number: '1.3', page: 2, rect, alt: 'f', caption: 'Flat.', credit: 'c', treatment: { mode: 'flat' } },
  ],
  equations: [{ id: 'eq-tau', number: '1.1', page: 1, rect: { ...rect, y: 300 }, intuition: 'Both slow it down.', text: 'τ = RC', symbols: [{ symbol: 'τ', meaning: 'time constant', unit: 's' }], example: 'x', validity: 'y' }],
  checks: [{ id: 'chk-x', number: '1.1', page: 2, rect: { ...rect, y: 400 }, question: 'Pick?', options: [{ text: 'a', correct: false, why: 'no' }, { text: 'b', correct: true, why: 'yes' }] }],
});

describe('things to pull out of the book', () => {
  it('lists figures (not flat ones), equations and checks in reading order, named as the book names them', async () => {
    const { itemsOf } = await import('../../web/src/edition3d/items.ts');
    const items = itemsOf(book);
    expect(items.map((i) => i.key)).toEqual(['figure:fig-a', 'equation:eq-tau', 'scene:fig-b', 'check:chk-x']);
    expect(items.map((i) => i.name)).toEqual(['Figure 1.1', 'Eq. (1.1)', 'Figure 1.2', 'Check yourself 1.1']);
    expect(items[0]!.title).toBe('First figure shows a thing.');
  });
});

describe('chapters', () => {
  const withChapters = Book3D.parse({
    ...book,
    pages: ['pages/p001.jpg', 'pages/p002.jpg', 'pages/p003.jpg', 'pages/p004.jpg'],
    chapters: [
      { id: 'ch-two', number: 2, title: 'Two', page: 3, rect, goals: [] },
      { id: 'ch-one', number: 1, title: 'One', page: 1, rect: { ...rect, y: 20 }, hook: 'Why.', goals: ['Explain τ.'] },
    ],
  });
  it('lists a chapter first on its page and knows which items it holds', async () => {
    const { itemsOf, chapterItems, chapterCounts, studyable } = await import('../../web/src/edition3d/items.ts');
    const items = itemsOf(withChapters);
    expect(items[0]!.key).toBe('chapter:ch-one');
    const one = items.find((i) => i.id === 'ch-one')!;
    const two = items.find((i) => i.id === 'ch-two')!;
    expect(chapterItems(one, items).map((i) => i.id)).toEqual(['fig-a', 'eq-tau', 'fig-b', 'chk-x']);
    expect(chapterItems(two, items)).toEqual([]);
    expect(chapterCounts(chapterItems(one, items))).toEqual([
      { kind: 'scene', n: 1, label: '3D scene' },
      { kind: 'figure', n: 1, label: 'figure' },
      { kind: 'equation', n: 1, label: 'equation' },
      { kind: 'check', n: 1, label: 'check' },
    ]);
    expect(items.filter(studyable).some((i) => i.kind === 'chapter')).toBe(false);
  });
});

describe('the desk', () => {
  it('keeps items for this book, in order, survives a reload, and ignores what the book no longer has', async () => {
    const { itemsOf } = await import('../../web/src/edition3d/items.ts');
    const { DeskStore } = await import('../../web/src/edition3d/desk.ts');
    const items = itemsOf(book);
    localStorage.clear();
    const desk = new DeskStore('desk:T', items);
    const heard: string[] = [];
    desk.onChange.add((added) => heard.push(added?.key ?? 'removed'));
    expect(desk.toggle(items[1]!)).toBe(true);
    expect(desk.toggle(items[3]!)).toBe(true);
    expect(desk.items.map((i) => i.key)).toEqual(['equation:eq-tau', 'check:chk-x']);
    expect(desk.toggle(items[1]!)).toBe(false);
    expect(heard).toEqual(['equation:eq-tau', 'check:chk-x', 'removed']);
    localStorage.setItem('desk:T', JSON.stringify(['check:chk-x', 'figure:gone', 42]));
    expect(new DeskStore('desk:T', items).items.map((i) => i.key)).toEqual(['check:chk-x']);
    localStorage.setItem('desk:T', 'not json');
    expect(new DeskStore('desk:T', items).items).toEqual([]); // a broken entry starts an empty desk, never an error
  });
});

describe('the self-check card', () => {
  it('reveals why an answer is right or wrong, and reports only the first choice', async () => {
    const { checkContent } = await import('../../web/src/edition3d/panel.ts');
    const body = document.createElement('div');
    const firsts: boolean[] = [];
    checkContent(body, book.checks[0]!, (right) => firsts.push(right));
    const [a, b] = [...body.querySelectorAll('button')];
    a!.click();
    expect(body.querySelector('.chk-why')!.textContent).toBe('Not quite. no');
    b!.click();
    expect(body.querySelector('.chk-why')!.textContent).toBe('Right. yes');
    expect(b!.classList.contains('right')).toBe(true);
    expect(firsts).toEqual([false]);
  });
});

describe('spaced review', () => {
  it('schedules a card 1, 2, 4, 8, 16 days out as it is answered right, and back to tomorrow on a miss', async () => {
    const { ReviewStore, dayNumber, INTERVALS } = await import('../../web/src/edition3d/review.ts');
    localStorage.clear();
    let t = new Date(2026, 9, 27, 23, 30).getTime(); // late evening: "tomorrow" is still the next calendar day
    const r = new ReviewStore('rv:T', () => t);
    const day = dayNumber(t);
    expect(r.isDue('equation:eq-tau')).toBe(true); // new cards are due
    expect(r.grade('equation:eq-tau', true)).toEqual({ box: 1, due: day + 1 });
    expect(r.isDue('equation:eq-tau')).toBe(false);
    expect(r.grade('equation:eq-tau', true)).toEqual({ box: 1, due: day + 1 }); // practising ahead never moves a card
    for (const box of [2, 3, 4, 5, 5]) {
      t += (r.get('equation:eq-tau')!.due - dayNumber(t)) * 86_400_000; // jump to its day
      expect(r.isDue('equation:eq-tau')).toBe(true);
      const rec = r.grade('equation:eq-tau', true)!;
      expect(rec.box).toBe(box);
      expect(rec.due - dayNumber(t)).toBe(INTERVALS[box]);
    }
    t += 16 * 86_400_000;
    expect(r.grade('equation:eq-tau', false)).toEqual({ box: 1, due: dayNumber(t) + 1 });
    expect(new ReviewStore('rv:T', () => t).get('equation:eq-tau')).toEqual({ box: 1, due: dayNumber(t) + 1 }); // survives a reload
    localStorage.setItem('rv:T', '{"a": {"box": 9, "due": 1}, "b": "x"');
    expect(new ReviewStore('rv:T', () => t).get('a')).toBeUndefined(); // broken storage starts fresh
    localStorage.setItem('rv:T', '{"a": {"box": 9, "due": 1}, "b": {"box": 2, "due": 3}}');
    const fresh = new ReviewStore('rv:T', () => t);
    expect([fresh.get('a'), fresh.get('b')]).toEqual([undefined, { box: 2, due: 3 }]); // out-of-range boxes are dropped
  });
});

describe('connections', () => {
  it('links an equation to its figure and an explorable to its equation and the scenes it drives, both ways', async () => {
    const { itemsOf, connections } = await import('../../web/src/edition3d/items.ts');
    const linked = Book3D.parse({
      ...book,
      equations: [{ ...book.equations[0]!, figure: 'fig-a' }],
      explorables: [{ id: 'xpl-a', number: '1.1', title: 'Try', page: 2, rect, block: { kind: 'explore', equation: 'eq-tau', drives: [{ kit: 'rc-loop', input: 'tau', expr: 'R*C' }] } }],
    });
    const items = itemsOf(linked);
    const map = connections(items);
    const say = (key: string) => (map.get(key) ?? []).map((l) => `${l.label} ${l.item.name}${l.drive ? ` (${l.drive})` : ''}`);
    expect(say('equation:eq-tau')).toEqual(['Shown in Figure 1.1', 'Brought to life in Explore 1.1']);
    expect(say('figure:fig-a')).toEqual(['Its equation Eq. (1.1)']);
    expect(say('explore:xpl-a')).toEqual(['Brings to life Eq. (1.1)', 'Drives Figure 1.2 (to)']);
    expect(say('scene:fig-b')).toEqual(['Driven by Explore 1.1 (from)']);
    expect(say('check:chk-x')).toEqual([]);
  });
});

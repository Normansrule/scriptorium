/** The 3D Edition: page splitting, figure positions, the 2D → 3D converter and the full build. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Book } from '../../src/core/book.ts';
import { buildEdition3D, figureRects } from '../../src/edition3d/build.ts';
import { DATA_WORDS, effective, planBook, propose, scoreForScene } from '../../src/edition3d/convert.ts';
import { KITS } from '../../src/edition3d/kits.ts';
import { Book3D } from '../../src/edition3d/manifest.ts';
import { splitPages } from '../../src/edition3d/pages.ts';
import { jpegJsEncode } from '../../src/export/cover.ts';
import { resvgRasterize } from '../../src/node/export-cover.ts';
import { nodeEngine } from '../../src/node/export-pdf.ts';
import { figureFiles } from '../../src/node/export-web.ts';
import { cslAssets, loadBook, REPO_ROOT } from '../../src/node/load.ts';

const mosfet = KITS.find((k) => k.id === 'mosfet')!;

describe('splitPages', () => {
  it('cuts the typeset document into standalone pages that keep only the glyphs they use', async () => {
    const svg = await nodeEngine(REPO_ROOT).svg('#set page(width: 3in, height: 4in)\nAlpha\n#pagebreak()\nBeta');
    const pages = splitPages(svg);
    expect(pages).toHaveLength(2);
    for (const p of pages) {
      expect(p.width).toBe(216);
      expect(p.height).toBe(288);
      expect(p.svg).toMatch(/^<svg [^>]*viewBox="0 0 216 288"/);
      expect(p.svg).not.toMatch(/translate\(0, 288\)/); // the page no longer sits lower in a long document
      const used = new Set([...p.svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]));
      const defined = new Set([...p.svg.matchAll(/<path[^>]*\bid="([^"]+)"/g)].map((m) => m[1]));
      for (const id of used) expect(defined.has(id)).toBe(true);
    }
    expect(pages[0]!.svg.length).toBeLessThan(svg.length);
  });
});

describe('figureRects', () => {
  it('takes the top-left from the start anchor and the height from the end anchor', () => {
    const anchors = [
      { id: 'fig-a', edge: 'start', page: 3, x: 60, y: 54 },
      { id: 'fig-a', edge: 'end', page: 3, x: 60, y: 200 },
      { id: 'fig-b', edge: 'start', page: 4, x: 50, y: 500 },
      { id: 'fig-b', edge: 'end', page: 5, x: 50, y: 80 }, // split across pages: no rectangle
      { junk: true },
    ];
    const r = figureRects(anchors, new Map([['fig-a', 0.5]]), 300);
    expect(r.get('fig-a')).toEqual({ page: 3, rect: { x: 60, y: 54, w: 150, h: 146 } });
    expect(r.has('fig-b')).toBe(false);
  });
});

describe('2D → 3D converter', () => {
  it('scores a figure for a scene kit from its own words, and vetoes symbols', () => {
    expect(scoreForScene('Cross-section of an n-channel MOSFET: gate oxide, inversion layer and channel', mosfet)).toBe(1);
    expect(scoreForScene('A transistor amplifier stage', mosfet)).toBeGreaterThan(0);
    expect(scoreForScene('The schematic symbol of a MOSFET transistor', mosfet)).toBe(0);
    expect(scoreForScene('Charging curve of an RC circuit', mosfet)).toBe(0);
  });

  const fig = (alt: string): Extract<Book['chapters'][number]['sections'][number]['layers']['summary'][number], { kind: 'figure' }> => ({
    kind: 'figure',
    id: 'fig-x',
    src: 'figures/x.svg',
    alt,
    caption: 'A caption.',
    credit: 'Drawn by code.',
    provenance: 'code-drawn',
    width: 1,
  });

  it('proposes a scene only with a person’s approval, and lifts everything else', () => {
    const scene = propose(fig('Cross-section of a MOSFET showing the gate oxide and the channel.'));
    expect(scene.proposed).toEqual({ mode: 'scene', kit: 'mosfet' });
    expect(scene.approved).toBe(false);
    expect(effective(scene)).toEqual({ mode: 'lift' });
    expect(effective({ ...scene, approved: true })).toEqual({ mode: 'scene', kit: 'mosfet' });
    const plot = propose(fig('A line plot of voltage against time for three resistors.'));
    expect(plot.proposed).toEqual({ mode: 'lift' });
    expect(plot.approved).toBe(true);
    // a choice naming a kit that does not exist falls back to a lift
    expect(effective({ ...plot, chosen: { mode: 'scene', kit: 'no-such-kit' } })).toEqual({ mode: 'lift' });
  });

  it('matches each sample figure to the kit made for it, and never turns a data plot into a scene', () => {
    const rc = loadBook(join(REPO_ROOT, 'examples/rc-circuits')).book;
    const heart = loadBook(join(REPO_ROOT, 'examples/heart-and-vessels')).book;
    const scenes = (b: Book) => planBook(b).entries.filter((e) => e.proposed.mode === 'scene').map((e) => [e.id, (e.proposed as { kit: string }).kit]);
    expect(scenes(rc)).toEqual([
      ['fig-parallel-plate', 'capacitor'],
      ['fig-rc-circuit', 'rc-loop'],
    ]);
    expect(scenes(heart)).toEqual([['fig-vessel-narrowing', 'vessel']]);
    expect(scenes(loadBook(join(REPO_ROOT, 'examples/cells-and-dna')).book)).toEqual([['fig-cell-scale', 'cell']]);
    expect(scenes(loadBook(join(REPO_ROOT, 'examples/molecular-shapes')).book)).toEqual([['fig-electron-groups', 'vsepr']]);
    // every kit is vetoed by plot words, whatever else the figure says
    for (const kit of KITS) expect(scoreForScene(`A ${DATA_WORDS[0]} of ${kit.keywords.join(' and ')}`, kit)).toBe(0);
    // the RC loop is not a filter, and the vessel is not a heart valve
    expect(propose(fig('Schematic of an RC low-pass filter with a resistor and a capacitor.')).proposed).toEqual({ mode: 'lift' });
  });

  it('explains a scene proposal in plain words', () => {
    const p = propose(fig('Cross-section of a MOSFET showing the gate oxide and the channel.'));
    expect(p.reason).toMatch(/^It matches the scene kit “MOSFET \(n-channel, cross-section\)”, which shows source, drain, gate/);
    expect(p.reason).toMatch(/Needs your approval\.$/);
  });

  it('links explorables only to inputs their scenes have, inside the range the scene draws', async () => {
    const { compile } = await import('../../src/core/expr.ts');
    let links = 0;
    for (const dir of ['rc-circuits', 'heart-and-vessels', 'cells-and-dna', 'molecular-shapes']) {
      const { book } = loadBook(join(REPO_ROOT, 'examples', dir));
      for (const ch of book.chapters)
        for (const s of ch.sections)
          for (const b of [...s.layers.summary, ...s.layers.intuition, ...s.layers.formal, ...s.layers.limits]) {
            if (b.kind !== 'explore') continue;
            for (const d of b.drives) {
              links++;
              const input = KITS.find((k) => k.id === d.kit)?.inputs?.find((i) => i.name === d.input);
              expect(input, `${b.id} → ${d.kit}.${d.input}`).toBeDefined();
              const v = compile(d.expr)(Object.fromEntries(b.params.map((p) => [p.name, p.value])));
              expect(v).toBeGreaterThanOrEqual(input!.min);
              expect(v).toBeLessThanOrEqual(input!.max);
            }
          }
    }
    expect(links).toBe(4);
  });

  it('describes every kit fully, with swatch colours for the gallery', () => {
    expect(new Set(KITS.map((k) => k.id)).size).toBe(KITS.length);
    for (const k of KITS) {
      expect(k.keywords.length).toBeGreaterThan(2);
      expect(k.animation, k.id).toBeTruthy();
      expect(k.swatch.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
    }
  });

  it('keeps an author’s decision only while the proposal it answered still stands', () => {
    const { book } = loadBook(join(REPO_ROOT, 'examples/cells-and-dna'));
    const first = planBook(book);
    expect(first.entries.map((e) => [e.id, e.proposed.mode])).toEqual([
      ['fig-cell-scale', 'scene'],
      ['fig-sa-volume', 'lift'],
      ['fig-dna', 'model'],
    ]);
    const at = (p: typeof first) => p.entries.find((e) => e.id === 'fig-sa-volume')!;
    const decided = { ...first, entries: first.entries.map((e) => (e.id === 'fig-sa-volume' ? { ...e, approved: false, chosen: { mode: 'flat' as const } } : e)) };
    expect(effective(at(planBook(book, decided)))).toEqual({ mode: 'flat' });
    const changed = { ...decided, entries: decided.entries.map((e) => (e.id === 'fig-sa-volume' ? { ...e, proposed: { mode: 'scene' as const, kit: 'mosfet' } } : e)) };
    expect(at(planBook(book, changed)).chosen).toBeUndefined();
  });
});

describe('buildEdition3D', () => {
  it('renders every print page and places each figure on its page', async () => {
    const { dir, book, refs, models } = loadBook(join(REPO_ROOT, 'examples/cells-and-dna'));
    const r = await buildEdition3D(
      { book, refs, models, files: figureFiles(dir), csl: cslAssets(book.meta.citationStyle), pageScale: 0.5 },
      { engine: nodeEngine(dir), rasterize: resvgRasterize, encodeJpeg: jpegJsEncode },
    );
    expect(r.manifest.pages).toHaveLength(19); // same as the print interior
    expect(r.warnings).toEqual([]);
    for (const p of r.manifest.pages) expect([...r.files[p]!.slice(0, 2)]).toEqual([0xff, 0xd8]); // JPEG
    const byId = new Map(r.manifest.figures.map((f) => [f.id, f]));
    expect(byId.get('fig-dna')!.treatment).toEqual({ mode: 'model' });
    expect(byId.get('fig-sa-volume')!.treatment).toEqual({ mode: 'lift' });
    for (const f of r.manifest.figures) {
      expect(f.rect.x).toBeGreaterThanOrEqual(0);
      expect(f.rect.y).toBeGreaterThanOrEqual(0);
      expect(f.rect.x + f.rect.w).toBeLessThanOrEqual(r.manifest.page.width + 0.01);
      expect(f.rect.y + f.rect.h).toBeLessThanOrEqual(r.manifest.page.height + 0.01);
      expect(r.files[f.asset!]).toBeDefined();
    }
    // everything else a reader can pull out: equations, explorables and checks, each boxed on its page
    expect(r.manifest.equations.map((e) => e.id)).toEqual(['eq-sa-volume', 'eq-dna-length', 'eq-dna-turns']);
    expect(r.manifest.explorables.map((x) => x.id)).toEqual(['xpl-cell-size']);
    expect(r.manifest.checks.map((c) => c.id)).toEqual(['chk-double-radius', 'chk-dna-turn']);
    const eq = r.manifest.equations[0]!;
    expect(eq.text).toBe('A/V = 4πr²/(4/3πr³) = 3/r');
    expect(eq.symbols.map((x) => x.symbol)).toContain('A');
    expect(r.manifest.checks[0]!.options.filter((o) => o.correct)).toHaveLength(1);
    for (const b of [...r.manifest.equations, ...r.manifest.explorables, ...r.manifest.checks]) {
      expect(b.rect.x).toBeGreaterThanOrEqual(0);
      expect(b.rect.h).toBeGreaterThan(20);
      expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(r.manifest.page.width + 0.01);
      expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(r.manifest.page.height + 0.01);
    }
    // chapter openers: each chapter stands a banner on its first page, with its goals
    expect(r.manifest.chapters.map((c) => c.id)).toEqual(['ch-cells-dna']);
    expect(r.manifest.chapters.map((c) => c.number)).toEqual([1]);
    for (const c of r.manifest.chapters) {
      expect(c.goals.length).toBeGreaterThan(0);
      expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(r.manifest.page.height);
    }
    expect(r.manifest.chapters.every((c, i, a) => i === 0 || c.page > a[i - 1]!.page)).toBe(true);
    expect(byId.get('fig-dna')!.caption).toMatch(/\[1, §14\.2\]/); // citations become numbers
    expect(Book3D.safeParse(JSON.parse(new TextDecoder().decode(r.files['book3d.json']))).success).toBe(true);
  }, 120_000);

  it('refuses asset paths outside the edition folder', () => {
    const base = { id: 'fig-a', number: '1.1', page: 1, rect: { x: 1, y: 1, w: 1, h: 1 }, alt: 'a', caption: 'c', credit: 'c', treatment: { mode: 'lift' } };
    const doc = (asset: string) => ({ format: 'scriptorium-3d', version: 1, title: 't', authors: [], page: { width: 1, height: 1 }, pages: ['pages/p001.jpg'], pageScale: 1, cloth: '#000000', figures: [{ ...base, asset }] });
    expect(Book3D.safeParse(doc('figures/a.jpg')).success).toBe(true);
    expect(Book3D.safeParse(doc('../secret.json')).success).toBe(false);
    expect(Book3D.safeParse(doc('https://evil.example/x.jpg')).success).toBe(false);
  });
});

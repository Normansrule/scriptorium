/**
 * Explorables and self-checks: the shared maths behind sliders and stills, the schema rules, every
 * output (web, ebook, print) and the live version in a browser-like DOM.
 */
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { Explore, Quiz, type Explore as ExploreT } from '../../src/core/book.ts';
import { describePath } from '../../src/core/issues.ts';
import { loadBook, REPO_ROOT, cslAssets } from '../../src/node/load.ts';
import { formatBibliography } from '../../src/render/cite.ts';
import { curvesFollowFirst, stillSvg, defaults, exploreProblems, exploreSpec, formatValue, fromSlider, niceTicks, readouts, stillPair, stillValues, toSlider } from '../../src/render/explore.ts';
import { renderHtml } from '../../src/render/html.ts';
import { numberBook } from '../../src/render/numbering.ts';
import { renderTypst } from '../../src/render/typst.ts';
import { sanitizePage } from '../../src/node/export-web.ts';

const { book, refs } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
const numbering = numberBook(book);
const find = <K extends string>(kind: K, id: string) => {
  for (const ch of book.chapters) for (const s of ch.sections) for (const b of [...s.layers.summary, ...s.layers.intuition, ...s.layers.formal, ...s.layers.limits]) if (b.kind === kind && 'id' in b && b.id === id) return b;
  throw new Error(id);
};
const charging = find('explore', 'xpl-charging') as ExploreT;

describe('explorable maths', () => {
  it('labels axes with round ticks, and logarithmic axes by decade', () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0, 1.05)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(-60, 5)).toEqual([-60, -50, -40, -30, -20, -10, 0]);
    expect(niceTicks(10, 100000, true)).toEqual([10, 100, 1000, 10000, 100000]);
  });

  it('writes numbers the way a reader would', () => {
    expect(formatValue(1, 2)).toBe('1');
    expect(formatValue(4.605, 2)).toBe('4.61');
    expect(formatValue(994.7, 0)).toBe('995');
    expect(formatValue(1e-7, 2)).toBe('10⁻⁷');
    expect(formatValue(2.5e-9, 2)).toBe('2.5 × 10⁻⁹');
    expect(formatValue(Number.NaN)).toBe('—');
  });

  it('maps sliders both ways, logarithmic ones by ratio and snapped to two figures', () => {
    const [R] = charging.params;
    expect(toSlider(R!, R!.min)).toBe(0);
    expect(toSlider(R!, R!.max)).toBe(1000);
    expect(toSlider(R!, 10)).toBe(500); // 10 kΩ is halfway between 1 and 100 on a log scale
    expect(fromSlider(R!, 500)).toBe(10);
    expect(fromSlider(R!, toSlider(R!, 4.7))).toBe(4.7);
    const lin = { name: 'v', label: 'v', unit: '', min: 0, max: 10, step: 0.5, value: 5, log: false };
    expect(fromSlider(lin, 333)).toBe(3.5); // snapped to the 0.5 step
  });

  it('prints three curves: low, default and high, by the author’s choice or halfway to each end', () => {
    expect(stillValues(charging).pinned.map((v) => v.R)).toEqual([3.3, 33]);
    expect(stillPair({ name: 'C', label: 'C', unit: 'µF', min: 10, max: 470, step: 1, value: 100, log: true })).toEqual([32, 220]);
    expect(stillPair({ name: 'v', label: 'v', unit: '', min: 0, max: 10, step: 1, value: 4, log: false })).toEqual([2, 7]);
  });

  it('marks three points on one curve when the slider only moves the marker', () => {
    const { book: chem } = loadBook(join(REPO_ROOT, 'examples/molecular-shapes'));
    const ph = chem.chapters[0]!.sections[1]!.layers.formal.find((b) => b.kind === 'explore' && b.id === 'xpl-ph') as ExploreT;
    expect(curvesFollowFirst(ph)).toBe(false);
    expect(curvesFollowFirst(charging)).toBe(true);
    const svg = stillSvg(ph, 'light');
    expect(svg.match(/<path d=/g)).toHaveLength(1); // one curve
    expect(svg).toContain('c = 10⁻⁷ M');
    expect(svg).toMatch(/marked at c = 3\.2 × 10⁻¹⁰ M, c = 10⁻⁷ M, c = 10⁻⁴ M/);
  });

  it('computes readouts from the book’s own expressions', () => {
    const r = readouts(charging, defaults(charging));
    expect(r[0]!.value).toBeCloseTo(1, 9);
    expect(r[1]!.text).toBe('4.61');
    expect(readouts(charging, { R: 47, C: 100 })[0]!.value).toBeCloseTo(4.7, 9);
  });

  it('names pinned curves by the sliders that changed', () => {
    const spec = exploreSpec(charging, { R: 47, C: 100 }, { pinned: [{ R: 10, C: 100 }] });
    expect(spec.series.map((s) => s.label)).toEqual(['vC/Vs = 1 − e^(−t/RC) (now)', 'R = 10 kΩ']);
    expect(spec.legend).toBe('below');
  });

  it('catches expressions a reader’s sliders could not drive', () => {
    const bad = structuredClone(charging);
    bad.plot.series[0]!.expr = '1 - exp(-x / (R * L))';
    bad.readouts[0]!.expr = 'R *';
    const p = exploreProblems(bad);
    expect(p[0]).toMatch(/uses "L", which is not one of the sliders \(x, R, C\)/);
    expect(p[1]).toMatch(/does not parse/);
    expect(exploreProblems(charging)).toEqual([]);
  });
});

describe('schema rules', () => {
  it('refuses broken sliders and axes', () => {
    const base = structuredClone(charging);
    expect(Explore.safeParse(base).success).toBe(true);
    const x = structuredClone(base);
    x.params[0]!.name = 'x';
    expect(Explore.safeParse(x).success).toBe(false); // x is the plot's own variable
    const range = structuredClone(base);
    range.params[0]!.value = 1000;
    expect(Explore.safeParse(range).success).toBe(false);
    const log = structuredClone(base);
    log.params[0]!.min = 0;
    expect(Explore.safeParse(log).success).toBe(false); // a log slider cannot reach zero
    const stills = structuredClone(base);
    stills.stills = [0.1, 33];
    expect(Explore.safeParse(stills).success).toBe(false);
  });

  it('needs exactly one right answer in a self-check', () => {
    const q = find('quiz', 'chk-tau-trade');
    expect(Quiz.safeParse(q).success).toBe(true);
    const two = structuredClone(q) as { options: Array<{ correct: boolean }> };
    two.options[0]!.correct = true;
    expect(Quiz.safeParse(two).success).toBe(false);
  });

  it('says where a problem is in words an author can find', () => {
    expect(describePath(book, ['chapters', 1, 'sections', 0, 'layers', 'formal', 6, 'readouts', 0, 'label'])).toBe('chapter 2 (ch-time) › sec-charging › formal › xpl-charging › readouts[1] › label');
  });
});

describe('outputs', () => {
  const bib = formatBibliography(refs, [...numbering.cite.keys()], cslAssets(book.meta.citationStyle), 'html');
  const web = sanitizePage(renderHtml(book, { numbering, bibliography: bib, refs, figureBase: 'figures/' }));

  it('web: a still that works without script, and the data to make it live', () => {
    const m = web.match(/<div class="learn explore" id="xpl-charging" data-explore="([^"]+)">/);
    expect(m).not.toBeNull();
    const data = JSON.parse(new JSDOM(`<p title="${m![1]}"></p>`).window.document.querySelector('p')!.title);
    expect(data.id).toBe('xpl-charging');
    expect(web).toMatch(/<img src="data:image\/svg\+xml;charset=utf-8,[^"]+" alt="[^"]*R = 3\.3 kΩ, R = 10 kΩ and R = 33 kΩ\."/);
  });

  it('web: a self-check with one right answer and a reason for every choice', () => {
    const q = web.slice(web.indexOf('id="chk-tau-trade"'), web.indexOf('</ul>', web.indexOf('id="chk-tau-trade"')));
    expect(q.match(/type="radio"/g)).toHaveLength(4);
    expect(q.match(/class="is-right"/g)).toHaveLength(1);
    expect(q.match(/class="quiz-why"/g)).toHaveLength(4);
  });

  it('ebook: no form controls; the answer sits behind a disclosure', () => {
    const epub = renderHtml(book, { numbering, bibliography: bib, refs, figureBase: 'figures/', target: 'epub', webUrl: 'https://example.org/book/' });
    const q = epub.slice(epub.indexOf('id="chk-tau-trade"'), epub.indexOf('</details>', epub.indexOf('id="chk-tau-trade"')));
    expect(q).not.toMatch(/<input/);
    expect(q).toContain('<summary>Show the answer</summary><p><strong>(c)</strong>');
    expect(epub).not.toMatch(/data-explore/);
    expect(epub).toContain('Move the sliders yourself in the web edition: <a href="https://example.org/book/#xpl-charging">');
  });

  it('print: the still, the numbers at the defaults, and every answer at the back', () => {
    const typ = renderTypst(book, { numbering, bibliography: new Map(), refs, webUrl: 'https://example.org/book/' });
    expect(typ).toContain('Explore 2.1');
    expect(typ).toContain('Move the sliders yourself in the web edition: https:\\/\\/example.org\\/book\\/\\#xpl\\-charging');
    const back = typ.slice(typ.indexOf('= Solutions to practice'));
    for (const id of ['1.1', '1.2', '2.1', '2.2', '3.1']) expect(back).toContain(`Check yourself ${id}]`);
    expect(back).toMatch(/Check yourself 2\.1\] #h\(4pt\) #strong\[\(c\)\]/);
  });
});

describe('live explorable', () => {
  it('turns the still into sliders, a live plot and live numbers', async () => {
    const bib = new Map<string, string>();
    const html = renderHtml(book, { numbering, bibliography: bib, refs, figureBase: 'figures/' });
    const dom = new JSDOM(html, { pretendToBeVisual: true });
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { document: g.document, window: g.window, requestAnimationFrame: g.requestAnimationFrame, performance: g.performance };
    Object.assign(g, { document: dom.window.document, window: dom.window, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window) });
    try {
      const { mountExplorables } = await import('../../src/render/explore-client.ts');
      mountExplorables(dom.window.document);
      const box = dom.window.document.getElementById('xpl-charging')!;
      expect(box.querySelector('.xpl-svg svg')).not.toBeNull();
      expect(box.querySelectorAll('input[type=range]')).toHaveLength(2);
      const out = () => [...box.querySelectorAll('.xpl-readouts output')].map((o) => o.textContent);
      expect(out()).toEqual(['1 s', '4.61 s']);
      const R = box.querySelector<HTMLInputElement>('#xpl-charging-R')!;
      R.value = String(toSlider(charging.params[0]!, 47));
      R.dispatchEvent(new dom.window.Event('input'));
      await new Promise((r) => setTimeout(r, 60));
      expect(out()).toEqual(['4.7 s', '21.64 s']);
      expect(box.querySelector('.xpl-svg')!.getAttribute('aria-label')).toMatch(/Resistance R = 47 kΩ/);
      // pin, then reset: the pinned curve stays for comparison
      [...box.querySelectorAll('button')].find((b) => b.textContent === 'Pin this curve')!.click();
      [...box.querySelectorAll('button')].find((b) => b.textContent === 'Reset')!.click();
      expect(out()).toEqual(['1 s', '4.61 s']);
      expect(box.querySelector('.xpl-svg')!.innerHTML).toContain('R = 47 kΩ');
    } finally {
      Object.assign(g, saved);
    }
  });
});

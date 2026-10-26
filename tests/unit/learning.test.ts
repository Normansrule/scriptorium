/** Learning blocks (derivations, worked problems, experiments, practice) and the concision checks. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintBook, lintText } from '../../src/core/concision.ts';
import { loadBook, REPO_ROOT, cslAssets } from '../../src/node/load.ts';
import { formatBibliography } from '../../src/render/cite.ts';
import { renderHtml } from '../../src/render/html.ts';
import { numberBook } from '../../src/render/numbering.ts';
import { renderTypst } from '../../src/render/typst.ts';

describe('concision', () => {
  it('flags filler, intensifiers, stacked hedges and long sentences, each with a fix', () => {
    const f = lintText('It is important to note that the current is very large. In order to measure it, use a meter.', 'x');
    expect(f.map((x) => x.rule).sort()).toEqual(['filler', 'filler', 'intensifier']);
    expect(f.find((x) => x.text === 'in order to')!.fix).toBe('write “to”');
    expect(lintText('This may possibly be true.', 'x').map((x) => x.rule)).toEqual(['hedge-stack']);
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ') + '.';
    expect(lintText(long, 'x').map((x) => x.rule)).toEqual(['long-sentence']);
  });

  it('leaves tight prose alone and does not count maths or citations as words', () => {
    expect(lintText('The capacitor charges to $V_s(1 - e^{-t/\\tau})$ [@openstax-up2, §10.5].', 'x')).toEqual([]);
  });

  it('measures how much of a book teaches by showing', () => {
    const { book } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
    const r = lintBook(book);
    expect(r.visuals).toBeGreaterThanOrEqual(12); // figures + the derivation, problem and experiment
    expect(r.wordsPerVisual).toBeLessThan(300);
    expect(r.findings.some((x) => x.rule === 'wall-of-text')).toBe(false);
  });
});

describe('learning blocks in the engineering sample', () => {
  const { book, refs } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
  const numbering = numberBook(book);
  const assets = cslAssets(book.meta.citationStyle);
  const order = [...numbering.cite.keys()];

  it('numbers derivations, problems, experiments and exercises per chapter', () => {
    expect(numbering.derivation.get('drv-charging')).toBe('2.1');
    expect(numbering.problem.get('prb-threshold')).toBe('2.1');
    expect(numbering.experiment.get('exp-measure-tau')).toBe('2.1');
    expect([...numbering.exercise.values()]).toEqual(['2.1', '2.2', '2.3', '2.4']);
  });

  it('renders them on the web with solutions folded away, and links each derivation to its equation', () => {
    const html = renderHtml(book, { numbering, bibliography: formatBibliography(refs, order, assets, 'html'), refs, figureBase: 'figures/' });
    expect(html).toContain('Derivation 2.1');
    expect(html).toContain('href="#eq-charging"');
    expect(html).toContain('Worked problem 2.1');
    expect(html).toContain('Experiment 2.1');
    expect(html).toContain('Common mistake');
    expect(html).toContain('In practice');
    expect(html.match(/<details>/g)?.length).toBe(4);
    expect(html).toContain('Problem 2.1'); // "Problem prb-threshold" in the application resolves to its number
    expect(html).toContain('Exercise 2.4'); // the report lists every automated check
  });

  it('prints practice at the chapter end and every worked solution at the back', () => {
    const typ = renderTypst(book, { numbering, bibliography: formatBibliography(refs, order, assets, 'text'), refs });
    expect(typ).toContain('Practice');
    expect(typ).toContain('= Solutions to practice');
    expect(typ.indexOf('= Solutions to practice')).toBeLessThan(typ.indexOf('= Glossary'));
  });
});

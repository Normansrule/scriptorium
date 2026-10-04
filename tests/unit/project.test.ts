/** The app's project model: opening untrusted project files and finding problems before publishing. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clone, fromFile, problems, toFile, type Project } from '../../web/src/project.ts';
import { loadBook, REPO_ROOT } from '../../src/node/load.ts';

const { dir, book, refs } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
const figures = Object.fromEntries(readdirSync(join(dir, 'figures')).map((f) => [f, readFileSync(join(dir, 'figures', f), 'utf8')]));
const base = (): Project => ({ book: clone(book), refs: clone(refs), figures: { ...figures }, models: {}, origin: 'opened' });
const firstPara = (p: Project) => p.book.chapters[0]!.sections[0]!.layers.summary.find((b) => b.kind === 'para') as { text: string };

describe('project problems', () => {
  it('finds none in the sample', () => expect(problems(base())).toEqual([]));

  it('catches a citation to a source that was never verified', () => {
    const p = base();
    firstPara(p).text += ' [@made-up-2026]';
    expect(problems(p).join(' ')).toMatch(/\[@made-up-2026\]/);
  });

  it('catches a glossary link without an entry', () => {
    const p = base();
    firstPara(p).text += ' [[flux capacitor]]';
    expect(problems(p).join(' ')).toMatch(/flux capacitor/);
  });

  it('catches an equation that cannot be typeset', () => {
    const p = base();
    const eq = p.book.chapters[0]!.sections[0]!.layers.formal.find((b) => b.kind === 'equation') as { latex: string };
    eq.latex = '\\frac{1}{';
    expect(problems(p).length).toBeGreaterThan(0);
  });

  it('catches a missing figure file', () => {
    const p = base();
    delete p.figures['tau.svg'];
    expect(problems(p).join(' ')).toMatch(/tau\.svg is missing/);
  });

  it('catches an emptied title', () => {
    const p = base();
    p.book.chapters[0]!.sections[0]!.title = undefined as unknown as string;
    expect(problems(p).length).toBeGreaterThan(0);
  });
});

describe('project files', () => {
  it('round-trips', () => {
    const p = fromFile(toFile(base()));
    expect(p.book.meta.title).toBe(book.meta.title);
    expect(Object.keys(p.figures).length).toBe(Object.keys(figures).length);
    expect(p.origin).toBe('opened');
  });

  it('refuses figures with scripts, event handlers or odd names', () => {
    const file = (figs: Record<string, string>) => JSON.stringify({ book, references: refs, figures: figs });
    expect(() => fromFile(file({ 'x.svg': '<svg><script>alert(1)</script></svg>' }))).toThrow(/active content/);
    expect(() => fromFile(file({ 'x.svg': '<svg onload="alert(1)"></svg>' }))).toThrow(/active content/);
    expect(() => fromFile(file({ '../evil.svg': '<svg></svg>' }))).toThrow(/unexpected figure/);
    expect(() => fromFile(file({ 'x.svg': 'not svg' }))).toThrow(/unexpected figure/);
  });

  it('refuses a book that fails the schema and files that are not JSON', () => {
    expect(() => fromFile('{nope')).toThrow(/not valid JSON/);
    expect(() => fromFile(JSON.stringify({ book: { meta: {} } }))).toThrow(/schema/);
  });
});

/**
 * Integrity of every committed sample book in examples/: each equation points at a real
 * test, each figure exists in light and dark, each citation resolves to a verified
 * reference, and every LaTeX string renders in KaTeX and converts to Typst.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allBlocks, allInlineText, citedIds } from '../../src/core/book.ts';
import { loadBook, REPO_ROOT } from '../../src/node/load.ts';
import { renderMath } from '../../src/render/html.ts';
import { latexToTypst } from '../../src/render/latex-typst.ts';
import { parseInline } from '../../src/render/inline.ts';
import { buildDisclosure } from '../../src/disclosure/ai-disclosure.ts';

const examples = readdirSync(join(REPO_ROOT, 'examples')).filter((d) => existsSync(join(REPO_ROOT, 'examples', d, 'book.json')));

describe.each(examples)('sample book: %s', (name) => {
  const { dir, book, refs } = loadBook(join(REPO_ROOT, 'examples', name, 'book.json'));

  it('every equation has a check that exists in tests/equations', () => {
    for (const { block } of allBlocks(book)) {
      if (block.kind !== 'equation') continue;
      const [file, fn] = block.example.check.split('::');
      expect(file, block.id).toMatch(/^tests\/equations\/test_[a-z0-9_]+\.py$/);
      expect(readFileSync(join(REPO_ROOT, file!), 'utf8'), `${block.id} → ${fn}`).toContain(`def ${fn}(`);
    }
  });

  it('every figure (and every 3D still) exists in light and dark', () => {
    for (const { block } of allBlocks(book)) {
      const srcs: string[] = block.kind === 'figure' ? [block.src] : (block as { kind: string; views?: Array<{ src: string }> }).views?.map((v) => v.src) ?? [];
      for (const src of srcs) {
        expect(existsSync(join(dir, src)), src).toBe(true);
        expect(existsSync(join(dir, src.replace(/\.svg$/, '.dark.svg'))), src).toBe(true);
      }
    }
  });

  it('every cited reference exists and is verified', () => {
    const byId = new Map(refs.map((r) => [r.id, r]));
    for (const id of citedIds(book)) expect(byId.get(id)?.verification.status, id).toBe('verified');
  });

  it('every piece of math renders on the web and converts to Typst', () => {
    const latex: string[] = [];
    for (const { block } of allBlocks(book)) if (block.kind === 'equation') latex.push(block.latex, ...block.where.map((w) => w.symbol));
    for (const t of allInlineText(book)) for (const tok of parseInline(t)) if (tok.t === 'math') latex.push(tok.v);
    expect(latex.length).toBeGreaterThan(10);
    for (const l of latex) {
      expect(() => renderMath(l, false), l).not.toThrow();
      expect(() => latexToTypst(l), l).not.toThrow();
    }
  });

  it('discloses AI text and, conservatively, AI-written figure code', () => {
    const d = buildDisclosure(book, { figureScriptsByAi: true });
    expect(d.text.answer).toBe('yes');
    expect(d.translations.answer).toBe('no');
  });
});

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { loadBook, cslAssets, REPO_ROOT } from '../../src/node/load.ts';
import { numberBook } from '../../src/render/numbering.ts';
import { formatBibliography } from '../../src/render/cite.ts';
import { renderHtml } from '../../src/render/html.ts';
import { sanitizePage } from '../../src/node/export-web.ts';
import { exportPdf } from '../../src/node/export-pdf.ts';
import { preflightInterior } from '../../src/kdp/preflight.ts';
import { findTrim } from '../../src/kdp/specs.ts';

const { dir, book, refs } = loadBook(join(REPO_ROOT, 'examples/rc-circuits/book.json'));
const numbering = numberBook(book);
const order = [...numbering.cite.keys()];
const assets = cslAssets('ieee');

describe('exports', () => {
  it('numbers figures, equations and citations in reading order', () => {
    expect(numbering.equation.get('eq-capacitance')).toBe('1.1');
    expect(numbering.equation.get('eq-charging')).toBe('2.2');
    expect(numbering.figure.get('fig-bode')).toBe('3.2');
    expect(numbering.cite.get('openstax-up2')).toBe(1);
  });

  it('formats IEEE references with citeproc', () => {
    const bib = formatBibliography(refs, order, assets, 'text');
    expect(bib.get('sallen-key-1955')).toMatch(/R\. P\. Sallen and E\. L\. Key, “A practical method of designing RC active filters,” IRE Transactions on Circuit Theory, vol\. 2, no\. 1, pp\. 74–85/);
  });

  it('web page has a CSP, no scripts, and survives sanitizing unchanged in meaning', () => {
    const html = sanitizePage(renderHtml(book, { numbering, bibliography: formatBibliography(refs, order, assets, 'html'), refs, figureBase: 'figures/' }));
    expect(html).toContain('Content-Security-Policy');
    expect(html).toMatch(/default-src 'none'/);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('<math');
    expect(html).toContain('media="(prefers-color-scheme: dark)"');
  });

  it('escapes hostile text instead of rendering it', () => {
    const evil = structuredClone(book);
    evil.chapters[0]!.goals[0] = '<img src=x onerror=alert(1)> **bold**';
    const html = sanitizePage(renderHtml(evil, { numbering, bibliography: new Map(), refs, figureBase: 'figures/' }));
    expect(html).not.toMatch(/<img[^>]*onerror/); // present only as escaped text
    expect(html).toContain('&lt;img');
  });

  it('builds a KDP-clean print PDF', async () => {
    const res = await exportPdf(book, dir, { numbering, bibliography: formatBibliography(refs, order, assets, 'text'), refs });
    const doc = await PDFDocument.load(res.pdf, { updateMetadata: false });
    expect(doc.catalog.has(PDFName.of('Outlines'))).toBe(false);
    expect(res.pages).toBeGreaterThanOrEqual(24);
    const checks = await preflightInterior(res.pdf, { trim: findTrim(6, 9), paper: 'white', bleed: false, insideMarginIn: res.layout.insideIn });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  }, 60_000);

  it('a Typst-looking string in the book cannot inject Typst code', async () => {
    const evil = structuredClone(book);
    evil.chapters[0]!.goals[0] = '#read("/etc/passwd") #import "x" $ ] ) ';
    const res = await exportPdf(evil, dir, { numbering, bibliography: formatBibliography(refs, order, assets, 'text'), refs });
    expect(res.typst).toContain('\\#read(');
  }, 60_000);
});

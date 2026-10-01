/**
 * Milestone 3 outputs: paperback cover, ebook cover, EPUB 3 and the metadata helper.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { cslAssets, loadBook, REPO_ROOT } from '../../src/node/load.ts';
import { numberBook } from '../../src/render/numbering.ts';
import { formatBibliography } from '../../src/render/cite.ts';
import { coverImage, coverLayout, descriptionText, layoutProblems } from '../../src/render/cover.ts';
import { coverGeometry, findTrim, TRIM_SIZES, type Paper } from '../../src/kdp/specs.ts';
import { exportCover, exportEbookCover } from '../../src/node/export-cover.ts';
import { jpegComponents, preflightCover, preflightEbookCover } from '../../src/kdp/cover-preflight.ts';
import { bookUuid, exportEpub, figureFiles, toXhtml } from '../../src/node/export-epub.ts';
import { checkMetadata, unsupportedTags } from '../../src/kdp/metadata.ts';
import type { BookMeta } from '../../src/core/book.ts';

const papers: Paper[] = ['white', 'cream', 'groundwood', 'premium-color'];

describe('cover layout', () => {
  it('keeps every box inside KDP safe zones for every trim size, paper and page count', () => {
    for (const t of TRIM_SIZES)
      for (const p of papers)
        for (const pages of [24, 79, 80, 150, 300, Math.min(t.maxPages[p] ?? 24, 590)]) {
          const g = coverGeometry(t, pages, p);
          expect(layoutProblems(coverLayout(g, t.width, t.height), t.width, t.height), `${t.label} ${p} ${pages}`).toEqual([]);
        }
  });

  it('prints spine text only above 79 pages, with clearance', () => {
    const t = findTrim(6, 9);
    expect(coverLayout(coverGeometry(t, 78, 'white'), 6, 9).spineText).toBeNull();
    const l = coverLayout(coverGeometry(t, 200, 'white'), 6, 9);
    expect(l.spineText).not.toBeNull();
    expect(l.spineText!.x - l.geom.spineLeft).toBeGreaterThanOrEqual(0.0625);
  });

  it('reserves a 2" × 1.2" barcode area at least 0.25" from spine and trim', () => {
    const l = coverLayout(coverGeometry(findTrim(6, 9), 120, 'white'), 6, 9);
    expect([l.barcode.w, l.barcode.h]).toEqual([2, 1.2]);
    expect(l.geom.spineLeft - (l.barcode.x + l.barcode.w)).toBeGreaterThanOrEqual(0.25);
    expect(0.125 + 9 - (l.barcode.y + l.barcode.h)).toBeGreaterThanOrEqual(0.25);
  });

  it('turns a description with KDP tags into cover paragraphs', () => {
    const { book } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
    expect(descriptionText({ ...book, meta: { ...book.meta, description: '<p>One <b>two</b></p><p>Three</p>' } })).toEqual(['One two', 'Three']);
    expect(coverImage(book)).toBe('figures/parallel-plate.svg');
  });
});

describe('cover files', () => {
  const { dir, book } = loadBook(join(REPO_ROOT, 'examples/molecular-shapes'));
  const trim = findTrim(6, 9);

  it('paperback cover PDF passes the cover pre-flight', async () => {
    const res = await exportCover(book, dir, { trim, pages: 120, paper: 'white' });
    const checks = await preflightCover(res.pdf, res.layout.geom, res.layout, trim);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
  }, 60_000);

  it('ebook cover is a 1600 × 2560 RGB JPEG under 5 MB', () => {
    const res = exportEbookCover(book, dir);
    expect([res.width, res.height]).toEqual([1600, 2560]);
    expect(jpegComponents(res.jpeg)).toBe(3);
    expect(preflightEbookCover(res.jpeg).filter((c) => !c.ok)).toEqual([]);
  }, 60_000);
});

describe('EPUB 3', () => {
  const { dir, book, refs } = loadBook(join(REPO_ROOT, 'examples/molecular-shapes'));
  const numbering = numberBook(book);
  const bib = formatBibliography(refs, [...numbering.cite.keys()], cslAssets(book.meta.citationStyle), 'html');
  const { epub } = exportEpub(book, dir, { numbering, bibliography: bib, refs, webUrl: book.meta.webUrl }, { coverJpeg: exportEbookCover(book, dir).jpeg });
  const files = unzipSync(epub);

  it('starts with an uncompressed mimetype entry', () => {
    expect(strFromU8(epub.subarray(30, 38))).toBe('mimetype');
    expect(epub[8]).toBe(0); // compression method 0 = stored
    expect(strFromU8(files['mimetype']!)).toBe('application/epub+zip');
  });

  it('declares MathML, the cover image and every figure in the manifest', () => {
    const opf = strFromU8(files['OEBPS/package.opf']!);
    expect(opf).toMatch(/properties="mathml"/);
    expect(opf).toMatch(/properties="cover-image"/);
    for (const f of figureFiles(book)) expect(opf).toContain(`href="${f}"`);
    expect(opf).toContain(`urn:uuid:${bookUuid(book)}`);
  });

  it('links 3D models to the web edition and contains no script', () => {
    const ch = strFromU8(files['OEBPS/chapter-1.xhtml']!);
    expect(ch).toContain(`${book.meta.webUrl}#fig-methane`);
    expect(ch).not.toMatch(/<script|data-model/i);
  });

  it('is reproducible', () => {
    const again = exportEpub(book, dir, { numbering, bibliography: bib, refs, webUrl: book.meta.webUrl }, { coverJpeg: exportEbookCover(book, dir).jpeg }).epub;
    expect(Buffer.from(again).equals(Buffer.from(epub))).toBe(true);
  }, 60_000);

  it('sanitizes and re-serializes as XHTML', () => {
    const x = toXhtml('<p>a<br>b<img src="x.svg" alt="x" onerror="alert(1)"><script>alert(1)</script></p>');
    expect(x).toContain('<br />');
    expect(x).not.toMatch(/onerror|<script/);
  });

  const java = spawnSync('java', ['-version']).status === 0;
  it.skipIf(!java)('passes EPUBCheck', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'epub-')), 'book.epub');
    writeFileSync(file, epub);
    const r = spawnSync('java', ['-jar', join(REPO_ROOT, 'node_modules/epubcheck-static/vendor/epubcheck.jar'), '--quiet', file], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).not.toMatch(/ERROR|FATAL/);
    expect(r.status).toBe(0);
  }, 120_000);
});

describe('metadata helper', () => {
  const base: BookMeta = { title: 'A Title', authors: ['A. Author'], profile: 'engineering', citationStyle: 'ieee', audience: 'x', language: 'en', date: '2026-10-01', license: 'CC BY 4.0', description: 'Fine.', keywords: ['one phrase'], categories: ['Cat'] };
  const errors = (m: BookMeta) => checkMetadata(m).filter((c) => c.level === 'error').map((c) => c.rule);

  it('passes a clean listing', () => expect(errors(base)).toEqual([]));
  it('rejects a title and subtitle of 200 characters or more', () => expect(errors({ ...base, subtitle: 'x'.repeat(193) })).toContain('Title + subtitle fewer than 200 characters'));
  it('rejects sales-rank and promotion words', () => {
    expect(errors({ ...base, title: 'The Bestselling Guide' })).toContain('Title has no prohibited terms');
    expect(errors({ ...base, keywords: ['free ebook'] })).toContain('Keywords have no prohibited content');
    expect(errors({ ...base, keywords: ['kindle unlimited reads'] })).toContain('Keywords have no prohibited content');
  });
  it('limits keywords to seven and categories to three', () => {
    expect(errors({ ...base, keywords: Array.from({ length: 8 }, (_, i) => `k${i}`) })).toContain('Up to seven keywords');
    expect(errors({ ...base, categories: ['a', 'b', 'c', 'd'] })).toContain('Up to three categories');
  });
  it('allows only KDP description tags', () => {
    expect(unsupportedTags('<p>ok</p><b>ok</b><h4>ok</h4><ul><li>ok</li></ul>')).toEqual([]);
    expect(unsupportedTags('<h2>no</h2><a href="x">no</a><script>')).toEqual(['h2', 'a', 'script']);
    expect(errors({ ...base, description: 'x'.repeat(4001) })).toContain('Description ≤ 4000 characters');
  });
  it('warns at the weekly title limit', () => {
    expect(checkMetadata(base, { titlesThisWeek: 2 }).find((c) => c.rule === 'Weekly title limit')!.level).toBe('warning');
  });
});

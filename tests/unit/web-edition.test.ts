/** The web edition the app saves is built by the same code as the command line's. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Book } from '../../src/core/book.ts';
import { buildWebBook, webReadme } from '../../src/export/web.ts';
import { cslAssets, loadBook, REPO_ROOT } from '../../src/node/load.ts';
import { figureFiles, nodeSanitizer, nodeWebAssets } from '../../src/node/export-web.ts';

const dec = new TextDecoder();

describe('web edition', () => {
  it('has the page, styles, fonts, figures and the 3D viewer for a book with models', () => {
    const { dir, book, refs, models } = loadBook(join(REPO_ROOT, 'examples/cells-and-dna'));
    const files = buildWebBook({ book, refs, files: figureFiles(dir), csl: cslAssets(book.meta.citationStyle), models }, nodeWebAssets(true), nodeSanitizer());
    const names = Object.keys(files);
    expect(names).toContain('index.html');
    expect(names).toContain('assets/book.css');
    expect(names).toContain('assets/katex/katex.min.css');
    expect(names).toContain('assets/viewer3d.js');
    expect(names.filter((n) => n.startsWith('assets/fonts/'))).toHaveLength(5);
    expect(names.some((n) => /^figures\/.+\.dark\.svg$/.test(n))).toBe(true);
    const html = dec.decode(files['index.html']);
    expect(html).toContain(book.meta.title);
    expect(html).not.toMatch(/<script(?![^>]*src="assets\/viewer3d\.js")/); // the only script is our viewer
  });

  it('leaves out the viewer when the book has no 3D models, and refuses to build without fonts', () => {
    const { dir, book, refs } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
    const input = { book, refs, files: figureFiles(dir), csl: cslAssets(book.meta.citationStyle) };
    expect(Object.keys(buildWebBook(input, nodeWebAssets(false), nodeSanitizer()))).not.toContain('assets/viewer3d.js');
    expect(() => buildWebBook(input, { ...nodeWebAssets(false), fonts: {} }, nodeSanitizer())).toThrow(/needs the font/);
  });

  it('explains GitHub Pages in the README', () => {
    expect(webReadme('A Book')).toMatch(/Settings → Pages/);
  });

  it('accepts only https web addresses', () => {
    const { book } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
    for (const bad of ['javascript:alert(1)', 'http://example.com/', 'https://example.com/"onload="x']) {
      expect(Book.safeParse({ ...book, meta: { ...book.meta, webUrl: bad } }).success).toBe(false);
    }
    expect(Book.safeParse({ ...book, meta: { ...book.meta, webUrl: 'https://you.github.io/my-book/' } }).success).toBe(true);
  });
});

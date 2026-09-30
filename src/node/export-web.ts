/**
 * Web-book export: writes index.html, CSS, KaTeX assets, fonts and figures to a folder
 * that can be opened locally or published on GitHub Pages.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import type { Book } from '../core/book.ts';
import { bookCss, renderHtml, type HtmlContext } from '../render/html.ts';
import { REPO_ROOT } from './load.ts';

export const PURIFY_CONFIG = {
  USE_PROFILES: { html: true, mathMl: true, svg: false },
  ADD_TAGS: ['picture', 'source', 'annotation', 'semantics'],
  ADD_ATTR: ['srcset', 'media', 'loading', 'encoding', 'aria-hidden'],
  // DOMPurify's default URI rule blocks javascript:, vbscript: and data: in links.
  ADD_URI_SAFE_ATTR: ['media', 'aria-hidden', 'encoding'],
  FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
};

/** Sanitize the body with DOMPurify, keeping MathML and our figure markup; the head is ours. */
export function sanitizePage(html: string): string {
  const { window } = new JSDOM('');
  const purify = createDOMPurify(window as unknown as Window & typeof globalThis);
  const [head, body] = html.split(/<body>/);
  const [inner, tail] = body!.split(/<\/body>/);
  const clean = purify.sanitize(inner!, PURIFY_CONFIG);
  return `${head}<body>${clean}</body>${tail}`;
}

export function copyWebAssets(outDir: string): void {
  mkdirSync(join(outDir, 'assets', 'fonts'), { recursive: true });
  writeFileSync(join(outDir, 'assets', 'book.css'), bookCss());
  const katexDist = join(REPO_ROOT, 'node_modules', 'katex', 'dist');
  mkdirSync(join(outDir, 'assets', 'katex'), { recursive: true });
  cpSync(join(katexDist, 'katex.min.css'), join(outDir, 'assets', 'katex', 'katex.min.css'));
  cpSync(join(katexDist, 'fonts'), join(outDir, 'assets', 'katex', 'fonts'), { recursive: true });
  for (const [pkg, files] of [
    ['source-serif', ['SourceSerif4-Regular.ttf', 'SourceSerif4-It.ttf', 'SourceSerif4-Semibold.ttf']],
    ['source-sans', ['SourceSans3-Regular.ttf', 'SourceSans3-Semibold.ttf']],
  ] as const) {
    for (const f of files) cpSync(join(REPO_ROOT, 'node_modules', pkg, 'TTF', f), join(outDir, 'assets', 'fonts', f));
  }
}

export function copyFigures(bookDir: string, outDir: string): void {
  mkdirSync(join(outDir, 'figures'), { recursive: true });
  const src = join(bookDir, 'figures');
  if (!existsSync(src)) return;
  for (const f of readdirSync(src)) if (/\.(svg|png)$/.test(f)) cpSync(join(src, f), join(outDir, 'figures', f));
}

export function exportWeb(book: Book, bookDir: string, ctx: Omit<HtmlContext, 'figureBase'>, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  const html = sanitizePage(renderHtml(book, { ...ctx, figureBase: 'figures/' }));
  writeFileSync(join(outDir, 'index.html'), html);
  copyWebAssets(outDir);
  copyFigures(bookDir, outDir);
  return join(outDir, 'index.html');
}

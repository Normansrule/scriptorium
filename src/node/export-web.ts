/**
 * Web-book export for the command line: builds the files with src/export/web.ts (shared with
 * the app) and writes them to a folder that can be opened locally or published on GitHub Pages.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { buildSync } from 'esbuild';
import { PURIFY_CONFIG } from '../export/sanitize.ts';
import { hasModels } from '../render/html.ts';
import { buildWebBook, sanitizeBody, WEB_FONTS, type WebAssets, type WebInput } from '../export/web.ts';
import { REPO_ROOT } from './load.ts';

export { PURIFY_CONFIG };

/** Sanitize the body with DOMPurify, keeping MathML and our figure markup; the head is ours. */
export function sanitizePage(html: string): string {
  return sanitizeBody(html, nodeSanitizer());
}

export function nodeSanitizer(): (body: string) => string {
  const { window } = new JSDOM('');
  const purify = createDOMPurify(window as unknown as Window & typeof globalThis);
  return (body) => purify.sanitize(body, PURIFY_CONFIG);
}

/** Bundle the 3D viewer (src/render/viewer3d-client.ts) into one classic script. */
export function bundleViewer(): string {
  const res = buildSync({
    entryPoints: [join(REPO_ROOT, 'src', 'render', 'viewer3d-client.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    write: false,
    legalComments: 'none',
  });
  return res.outputFiles[0]!.text;
}

/** KaTeX and font files from node_modules; the viewer is bundled only when asked for. */
export function nodeWebAssets(withViewer: boolean): WebAssets {
  const katex = join(REPO_ROOT, 'node_modules', 'katex', 'dist');
  const katexFonts: Record<string, Uint8Array> = {};
  for (const f of readdirSync(join(katex, 'fonts'))) katexFonts[f] = readFileSync(join(katex, 'fonts', f));
  const fonts: Record<string, Uint8Array> = {};
  for (const f of WEB_FONTS) fonts[f] = readFileSync(join(REPO_ROOT, 'node_modules', f.startsWith('SourceSerif') ? 'source-serif' : 'source-sans', 'TTF', f));
  return { katexCss: readFileSync(join(katex, 'katex.min.css'), 'utf8'), katexFonts, fonts, viewerJs: withViewer ? bundleViewer() : undefined };
}

/** Figures (svg/png) of a book folder, keyed `figures/<name>`. */
export function figureFiles(bookDir: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const src = join(bookDir, 'figures');
  if (!existsSync(src)) return out;
  for (const f of readdirSync(src)) if (/\.(svg|png)$/.test(f)) out[`figures/${f}`] = readFileSync(join(src, f));
  return out;
}

export function writeFiles(outDir: string, files: Record<string, Uint8Array>): void {
  for (const [path, data] of Object.entries(files)) {
    const target = join(outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

/** Write the web edition of the book in `bookDir` to `outDir`; returns the path of index.html. */
export function exportWeb(input: Omit<WebInput, 'files'>, bookDir: string, outDir: string): string {
  const files = buildWebBook({ ...input, files: figureFiles(bookDir) }, nodeWebAssets(hasModels(input.book)), nodeSanitizer());
  mkdirSync(outDir, { recursive: true });
  writeFiles(outDir, files);
  return join(outDir, 'index.html');
}

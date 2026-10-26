/**
 * The app's export path (WebAssembly Typst + shared builders) must produce the same,
 * KDP-clean package as the command line. Runs the browser code in Node.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { createWasmEngine } from '../../src/export/typst-wasm.ts';
import { buildPackage } from '../../src/export/package.ts';
import { cslAssets, loadBook, REPO_ROOT } from '../../src/node/load.ts';
import { FONT_FILES } from '../../src/node/export-pdf.ts';
import { resvgRasterize } from '../../src/node/export-cover.ts';
import { toXhtml } from '../../src/node/export-epub.ts';
import { loadProfile } from '../../src/node/profiles.ts';
import { findTrim } from '../../src/kdp/specs.ts';

function bookFiles(dir: string, paths: string[]): Record<string, Uint8Array> {
  return Object.fromEntries(paths.map((p) => [p, new Uint8Array(readFileSync(join(dir, p)))]));
}

const engine = await createWasmEngine({
  compilerWasm: readFileSync(join(REPO_ROOT, 'node_modules/@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm')),
  rendererWasm: readFileSync(join(REPO_ROOT, 'node_modules/@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm')),
  fonts: [...FONT_FILES, join(REPO_ROOT, 'vendor/fonts/NewCMMath-Book.otf'), join(REPO_ROOT, 'vendor/fonts/DejaVuSansMono.ttf')].map((f) => new Uint8Array(readFileSync(f))),
});

describe('in-app KDP package', () => {
  it('builds the engineering sample with every check passing and the same page count as the CLI', async () => {
    const { dir, book, refs } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
    const { figureFiles } = await import('../../src/export/epub.ts');
    const files = bookFiles(dir, figureFiles(book).flatMap((f) => [f, f.replace(/\.svg$/, '.dark.svg')]));
    engine.setFiles(files);
    const steps: string[] = [];
    const res = await buildPackage(
      { book, refs, profile: loadProfile(join(REPO_ROOT, 'profiles'), book.meta.profile), files, csl: cslAssets(book.meta.citationStyle), trim: findTrim(6, 9), paper: 'white' },
      { engine, rasterize: resvgRasterize, toXhtml, onStep: (s) => steps.push(s) },
    );
    expect(res.failures).toEqual([]);
    expect(res.pages).toBe(33);
    expect(Object.keys(res.files).sort()).toEqual(['UPLOAD-CHECKLIST.txt', 'ai-disclosure.json', 'book.epub', 'book.pdf', 'cover.pdf', 'ebook-cover.jpg', 'kdp-metadata.txt', 'preflight.json']);
    expect(strFromU8(unzipSync(res.files['book.epub']!)['mimetype']!)).toBe('application/epub+zip');
    expect(strFromU8(res.files['UPLOAD-CHECKLIST.txt']!)).toMatch(/All automated checks passed/);
    expect(steps.length).toBeGreaterThan(3);
  }, 120_000);

  it('marks a short sample as a practice package instead of failing it', async () => {
    const { dir, book, refs } = loadBook(join(REPO_ROOT, 'examples/heart-and-vessels'));
    const { figureFiles } = await import('../../src/export/epub.ts');
    const files = bookFiles(dir, figureFiles(book));
    engine.setFiles(files);
    const res = await buildPackage(
      { book, refs, profile: loadProfile(join(REPO_ROOT, 'profiles'), book.meta.profile), files, csl: cslAssets(book.meta.citationStyle), trim: findTrim(6, 9), paper: 'white', practice: true },
      { engine, rasterize: resvgRasterize, toXhtml },
    );
    expect(res.failures).toEqual([]);
    expect(res.warnings.join(' ')).toMatch(/practice package/);
    expect(res.warnings.join(' ')).toMatch(/licensed professional/);
    expect(strFromU8(res.files['UPLOAD-CHECKLIST.txt']!)).toMatch(/PRACTICE PACKAGE/);
  }, 120_000);
});

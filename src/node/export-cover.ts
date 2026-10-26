/**
 * Cover export in Node: the shared builders (src/export/cover.ts) with the native Typst
 * compiler and resvg for rasterizing the ebook cover.
 */
import { Resvg } from '@resvg/resvg-js';
import type { Book } from '../core/book.ts';
import type { Paper, TrimSize } from '../kdp/specs.ts';
import { fonts } from '../core/style.ts';
import { buildCover, buildEbookCover, type CoverResult, type EbookCoverResult } from '../export/cover.ts';
import type { Rasterize } from '../export/engine.ts';
import { join } from 'node:path';
import { FONT_FILES, nodeEngine } from './export-pdf.ts';
import { REPO_ROOT } from './load.ts';

export { lightEdgeShare } from '../export/cover.ts';
export type { CoverResult, EbookCoverResult };

// The book fonts, plus a small fallback (a renamed subset of DejaVu Sans, see assets/fonts) for the
// subscript letters and symbols they lack, such as the s in Vₛ.
const font = { fontFiles: [...FONT_FILES, join(REPO_ROOT, 'assets', 'fonts', 'ScriptoriumFallback-Regular.ttf')], loadSystemFonts: false, defaultFontFamily: fonts.sans };

/**
 * resvg rasterizer. Figures arrive as nested SVG images whose <text> resvg will not lay out
 * inside a data URI, so each one is rasterized on its own (with the book's fonts) first.
 */
export const resvgRasterize: Rasterize = async (svg, width, height) => {
  const scale = width / Number(/viewBox="[\d.\s-]*?([\d.]+)\s+[\d.]+"/.exec(svg)?.[1] ?? width);
  const flat = svg.replace(/(<image\b[^>]*?\bwidth="([\d.]+)"[^>]*?href=")data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/g, (_all, pre: string, w: string, b64: string) => {
    const inner = Buffer.from(b64, 'base64').toString('utf8');
    const png = new Resvg(inner, { fitTo: { mode: 'width', value: Math.ceil(Number(w) * scale * 1.5) }, font }).render().asPng();
    return `${pre}data:image/png;base64,${Buffer.from(png).toString('base64')}"`;
  });
  const img = new Resvg(flat, { fitTo: { mode: 'width', value: width }, background: '#FFFFFF', font }).render();
  // Copy into an exact width × height canvas (page sizes can round by a pixel).
  const src = new Uint8Array(img.pixels);
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < Math.min(height, img.height); y++) rgba.set(src.subarray(y * img.width * 4, y * img.width * 4 + Math.min(width, img.width) * 4), y * width * 4);
  return rgba;
};

export async function exportCover(book: Book, bookDir: string, opts: { trim: TrimSize; pages: number; paper: Paper }): Promise<CoverResult> {
  return buildCover(book, nodeEngine(bookDir), opts);
}

export async function exportEbookCover(book: Book, bookDir: string): Promise<EbookCoverResult> {
  return buildEbookCover(book, nodeEngine(bookDir), resvgRasterize);
}

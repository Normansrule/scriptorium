/**
 * Cover export: full-wrap paperback cover PDF and the ebook cover JPEG.
 *
 * The paperback cover is compiled by Typst and cleaned like the interior (no metadata,
 * bookmarks or annotations). The ebook cover is the same front design compiled to SVG by
 * Typst (text becomes outlines, so no fonts are needed downstream), rasterized by resvg at
 * KDP's ideal 1600 × 2560 px, and encoded as an RGB JPEG. If much of the edge is white or very
 * light, a 4 px medium-gray border is added, as KDP advises for light covers.
 */
import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import type { Book } from '../core/book.ts';
import { coverGeometry, EBOOK_COVER, type Paper, type TrimSize } from '../kdp/specs.ts';
import { coverLayout, renderCoverTypst, renderFrontTypst, type CoverLayout } from '../render/cover.ts';
import { compileTypst, FONT_FILES, kdpClean, typstCompiler } from './export-pdf.ts';
import { fonts } from '../core/style.ts';

export interface CoverResult {
  pdf: Uint8Array;
  typst: string;
  layout: CoverLayout;
}

export async function exportCover(book: Book, bookDir: string, opts: { trim: TrimSize; pages: number; paper: Paper }): Promise<CoverResult> {
  const geom = coverGeometry(opts.trim, opts.pages, opts.paper);
  const typst = renderCoverTypst(book, geom, opts.trim.width, opts.trim.height);
  const { pdf } = compileTypst(typstCompiler(bookDir), typst);
  return { pdf: await kdpClean(pdf), typst, layout: coverLayout(geom, opts.trim.width, opts.trim.height) };
}

export interface EbookCoverResult {
  jpeg: Uint8Array;
  width: number;
  height: number;
  border: boolean;
}

/** Share (0–1) of the outermost pixel ring that is white or very light (luminance > 0.9). */
export function lightEdgeShare(rgba: Uint8Array, w: number, h: number): number {
  let light = 0;
  let n = 0;
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if ((0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!) / 255 > 0.9) light++;
    n++;
  };
  for (let x = 0; x < w; x++) (at(x, 0), at(x, h - 1));
  for (let y = 1; y < h - 1; y++) (at(0, y), at(w - 1, y));
  return light / n;
}

export function exportEbookCover(book: Book, bookDir: string): EbookCoverResult {
  const c = typstCompiler(bookDir);
  const res = c.compile({ mainFileContent: renderFrontTypst(book) });
  if (!res.result || res.hasError()) throw new Error('Typst could not compile the ebook cover.');
  // Typst's SVG carries an interactive stylesheet (CSS variables for glyph color) that resvg
  // does not support; every element also has explicit fill attributes, so the stylesheet goes.
  const font = { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: fonts.sans };
  // Figures arrive as nested SVG images whose <text> resvg will not lay out inside a data URI,
  // so each one is rasterized on its own (with the book's fonts) and swapped in as a PNG.
  const svg = c
    .svg(res.result)
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/(<image\b[^>]*?\bwidth="([\d.]+)"[^>]*?href=")data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/g, (_all, pre: string, width: string, b64: string) => {
      const inner = Buffer.from(b64, 'base64').toString('utf8');
      const png = new Resvg(inner, { fitTo: { mode: 'width', value: Math.ceil(Number(width) * (EBOOK_COVER.widthPx / 384) * 1.5) }, font }).render().asPng();
      return `${pre}data:image/png;base64,${Buffer.from(png).toString('base64')}"`;
    });
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: EBOOK_COVER.widthPx }, background: '#FFFFFF', font }).render();
  // Copy into an exact 1600 × 2560 canvas (Typst page sizes can round by a pixel).
  const w = EBOOK_COVER.widthPx;
  const h = EBOOK_COVER.heightPx;
  const src = new Uint8Array(img.pixels);
  const rgba = new Uint8Array(w * h * 4).fill(255);
  for (let y = 0; y < Math.min(h, img.height); y++) rgba.set(src.subarray(y * img.width * 4, y * img.width * 4 + Math.min(w, img.width) * 4), y * w * 4);
  const light = lightEdgeShare(rgba, w, h) > 0.25;
  if (light) {
    const g = parseInt(EBOOK_COVER.borderGray.slice(1, 3), 16);
    const b = EBOOK_COVER.borderPx;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (x < b || y < b || x >= w - b || y >= h - b) {
          const i = (y * w + x) * 4;
          rgba[i] = rgba[i + 1] = rgba[i + 2] = g;
          rgba[i + 3] = 255;
        }
  }
  const out = jpeg.encode({ data: rgba, width: w, height: h }, 90);
  return { jpeg: new Uint8Array(out.data), width: w, height: h, border: light };
}

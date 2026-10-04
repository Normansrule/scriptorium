/**
 * Paperback cover PDF and ebook cover JPEG, the same in the CLI and the app.
 *
 * The paperback cover is compiled by Typst and cleaned like the interior. The ebook cover is
 * the same front design compiled to SVG (text as outlines), rasterized at KDP's ideal
 * 1600 × 2560 px and encoded as an RGB JPEG. If much of the edge is white or very light, a 4 px
 * medium-gray border is added, as KDP advises for light covers.
 */
import jpeg from 'jpeg-js';
import type { Book } from '../core/book.ts';
import { coverGeometry, EBOOK_COVER, type Paper, type TrimSize } from '../kdp/specs.ts';
import { coverImage, coverLayout, frontImageBox, FRONT_PT, renderCoverTypst, renderFrontTypst, type CoverLayout } from '../render/cover.ts';
import type { EncodeJpeg, Rasterize, TypstEngine } from './engine.ts';
import { kdpClean } from './pdf.ts';

export interface CoverResult {
  pdf: Uint8Array;
  typst: string;
  layout: CoverLayout;
}

export async function buildCover(book: Book, engine: TypstEngine, opts: { trim: TrimSize; pages: number; paper: Paper }): Promise<CoverResult> {
  const geom = coverGeometry(opts.trim, opts.pages, opts.paper);
  const typst = renderCoverTypst(book, geom, opts.trim.width, opts.trim.height);
  const { pdf } = await engine.pdf(typst);
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

/**
 * Typst's SVG carries an interactive stylesheet (CSS variables for glyph colour) and, from the
 * WebAssembly renderer, a script and an HTML layer for text selection. Rasterizers need none of
 * them and scripts are never wanted, so all three go; every element carries explicit fills.
 */
export function cleanTypstSvg(svg: string): string {
  return svg
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, ''); // text-selection layer; locks a canvas
}

/**
 * @param opts.figure  'inline' typesets the cover figure with the page (Node, resvg);
 *                     'overlay' leaves it out of the page and has the rasterizer draw it on top
 *                     (browsers: a canvas that draws an SVG with embedded images is locked).
 */
/** jpeg-js encoder (Node). In bundlers that define `module`, jpeg-js returns a Node Buffer, so the browser uses its canvas encoder instead. */
export const jpegJsEncode: EncodeJpeg = async (rgba, width, height, quality) => new Uint8Array(jpeg.encode({ data: rgba, width, height }, quality).data);

export async function buildEbookCover(book: Book, engine: TypstEngine, rasterize: Rasterize, opts: { figure?: 'inline' | 'overlay'; readFile?: (path: string) => Uint8Array | undefined; encodeJpeg?: EncodeJpeg } = {}): Promise<EbookCoverResult> {
  const overlayMode = opts.figure === 'overlay';
  const svg = cleanTypstSvg(await engine.svg(renderFrontTypst(book, { image: !overlayMode })));
  const w = EBOOK_COVER.widthPx;
  const h = EBOOK_COVER.heightPx;
  const overlays = [];
  const src = coverImage(book);
  if (overlayMode && src) {
    const bytes = opts.readFile?.(src);
    if (bytes) {
      const k = w / FRONT_PT.w; // points → pixels
      const box = frontImageBox();
      overlays.push({ svg: new TextDecoder().decode(bytes), x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k });
    }
  }
  const rgba = await rasterize(svg, w, h, overlays);
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
  const encode = opts.encodeJpeg ?? jpegJsEncode;
  return { jpeg: await encode(rgba, w, h, 90), width: w, height: h, border: light };
}

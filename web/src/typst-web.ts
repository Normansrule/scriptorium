/**
 * Loads the WebAssembly Typst compiler and renderer the first time a book is published,
 * so opening the app stays fast. All files come from the app itself (no CDN), which keeps
 * the app working offline and under its Content Security Policy.
 */
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/wasm?url';
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/wasm?url';
import serifRegular from 'source-serif/TTF/SourceSerif4-Regular.ttf?url';
import serifItalic from 'source-serif/TTF/SourceSerif4-It.ttf?url';
import serifSemibold from 'source-serif/TTF/SourceSerif4-Semibold.ttf?url';
import serifBold from 'source-serif/TTF/SourceSerif4-Bold.ttf?url';
import sansRegular from 'source-sans/TTF/SourceSans3-Regular.ttf?url';
import sansItalic from 'source-sans/TTF/SourceSans3-It.ttf?url';
import sansSemibold from 'source-sans/TTF/SourceSans3-Semibold.ttf?url';
import sansBold from 'source-sans/TTF/SourceSans3-Bold.ttf?url';
import mathFont from '../../vendor/fonts/NewCMMath-Book.otf?url';
import monoFont from '../../vendor/fonts/DejaVuSansMono.ttf?url';
import type { WasmEngine } from '../../src/export/typst-wasm.ts';
import type { EncodeJpeg, Rasterize } from '../../src/export/engine.ts';

const FONT_URLS = [serifRegular, serifItalic, serifSemibold, serifBold, sansRegular, sansItalic, sansSemibold, sansBold, mathFont, monoFont];

let enginePromise: Promise<WasmEngine> | null = null;
let figureFontCss = '';

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Put our font into a figure SVG so it draws with the right typeface as an image. */
function withFigureFont(svg: string): string {
  if (!figureFontCss) return svg;
  return svg.replace(/(<svg\b[^>]*>)/, `$1<style>${figureFontCss}</style>`);
}

async function bytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The shared engine; the first call downloads about 30 MB (cached by the browser afterwards). */
export function getEngine(): Promise<WasmEngine> {
  enginePromise ??= (async () => {
    const [{ createWasmEngine }, compilerWasm, rendererWasm, ...fonts] = await Promise.all([
      import('../../src/export/typst-wasm.ts'),
      bytes(compilerWasmUrl),
      bytes(rendererWasmUrl),
      ...FONT_URLS.map(bytes),
    ]);
    // Source Sans 3 regular and semibold, embedded in figure SVGs drawn on the ebook cover
    // (an SVG drawn as an image cannot use the page's web fonts).
    figureFontCss = [
      ['400', fonts[4]!],
      ['600', fonts[6]!],
    ]
      .map(([w, b]) => `@font-face{font-family:"Source Sans 3";font-weight:${w as string};src:url(data:font/ttf;base64,${toBase64(b as Uint8Array)}) format("truetype")}`)
      .join('');
    return createWasmEngine({ compilerWasm, rendererWasm, fonts });
  })();
  enginePromise.catch(() => (enginePromise = null)); // allow a retry after a failed load
  return enginePromise;
}

async function loadSvgImage(svg: string): Promise<{ img: HTMLImageElement; done: () => void }> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return { img, done: () => URL.revokeObjectURL(url) };
}

/**
 * Canvas rasterizer for the ebook cover. Each SVG is drawn as an image (an SVG-as-image cannot
 * run scripts or fetch anything), then the pixels are read back. Overlays are drawn as
 * separate images, because a canvas that draws an SVG containing embedded images is locked
 * against reading.
 */
export const canvasRasterize: Rasterize = async (svg, width, height, overlays = []) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot draw the ebook cover (no 2D canvas).');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  const page = await loadSvgImage(svg);
  try {
    const scale = width / (page.img.naturalWidth || width);
    ctx.drawImage(page.img, 0, 0, width, (page.img.naturalHeight || height) * scale);
  } finally {
    page.done();
  }
  for (const o of overlays) {
    const fig = await loadSvgImage(withFigureFont(o.svg));
    try {
      const iw = fig.img.naturalWidth || o.w;
      const ih = fig.img.naturalHeight || o.h;
      const k = Math.min(o.w / iw, o.h / ih);
      ctx.drawImage(fig.img, o.x + (o.w - iw * k) / 2, o.y + (o.h - ih * k) / 2, iw * k, ih * k);
    } finally {
      fig.done();
    }
  }
  return new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
};

/** Browser JPEG encoder: the canvas's own (baseline, 3-component RGB). */
export const canvasEncodeJpeg: EncodeJpeg = async (rgba, width, height, quality) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot encode the ebook cover (no 2D canvas).');
  const pixels = new Uint8ClampedArray(rgba.length);
  pixels.set(rgba);
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality / 100));
  if (!blob) throw new Error('This browser could not encode the ebook cover as JPEG.');
  return new Uint8Array(await blob.arrayBuffer());
};

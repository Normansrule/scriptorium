/**
 * The one thing that differs between the command line and the app: how Typst runs.
 *
 *   Node (CLI):      @myriaddreamin/typst-ts-node-compiler, figures read from the book folder
 *                    (src/node/typst-node.ts).
 *   Browser / app:   @myriaddreamin/typst.ts WebAssembly compiler + renderer, figures handed
 *                    over as bytes (web/src/typst-web.ts).
 *
 * Everything in src/export/ is written against this interface and runs unchanged in both.
 */
export interface TypstEngine {
  /** Compile a Typst document to PDF; relative paths such as `figures/x.svg` resolve against the book's files. */
  pdf(source: string): Promise<{ pdf: Uint8Array; pages: number }>;
  /** Compile to SVG (glyphs as outlines, so no fonts are needed to rasterize it). */
  svg(source: string): Promise<string>;
  /** Values of every `metadata` element with this label (e.g. `<scriptorium-anchor>`), in document order. */
  query?(source: string, label: string): Promise<unknown[]>;
}

/** An SVG drawn on top of the page, scaled to fit inside the box (pixels) and centred. */
export interface Overlay {
  svg: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Rasterize an SVG to exactly `width` × `height` RGBA pixels on a white background, then draw
 * any overlays. Node uses resvg; the browser draws onto a canvas.
 */
export type Rasterize = (svg: string, width: number, height: number, overlays?: Overlay[]) => Promise<Uint8Array>;

/** Turn untrusted HTML into sanitized, well-formed XHTML (DOMPurify + XMLSerializer). */
export type ToXhtml = (html: string) => string;

/** Encode RGBA pixels as a baseline RGB JPEG (jpeg-js in Node; the browser's canvas encoder in the app). */
export type EncodeJpeg = (rgba: Uint8Array, width: number, height: number, quality: number) => Promise<Uint8Array>;

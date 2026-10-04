/** Node wrapper for src/export/epub.ts: figures come from the book folder, sanitizing uses jsdom. */
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { JSDOM } from 'jsdom';
import type { Book } from '../core/book.ts';
import type { HtmlContext } from '../render/html.ts';
import { buildEpub, makeToXhtml, type EpubResult } from '../export/epub.ts';

export { bookUuid, epubCss, figureFiles } from '../export/epub.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
export const toXhtml = makeToXhtml(dom.window as unknown as Window & typeof globalThis);

/** Reads `rel` from inside `dir` only. */
export function bookFileReader(dir: string): (rel: string) => Uint8Array | undefined {
  return (rel) => {
    const p = normalize(join(dir, rel));
    if (!p.startsWith(normalize(dir)) || !existsSync(p)) return undefined;
    return new Uint8Array(readFileSync(p));
  };
}

export function exportEpub(book: Book, bookDir: string, ctx: Omit<HtmlContext, 'figureBase' | 'target'>, opts: { coverJpeg?: Uint8Array } = {}): EpubResult {
  return buildEpub(book, bookFileReader(bookDir), ctx, { ...opts, toXhtml });
}

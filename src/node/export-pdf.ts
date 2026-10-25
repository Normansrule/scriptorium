/**
 * Print PDF export in Node: the shared builder (src/export/pdf.ts) with the native Typst compiler.
 */
import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler';
import { join } from 'node:path';
import { DEFAULT_LAYOUT, type TypstContext, type TypstLayout } from '../render/typst.ts';
import { buildInterior, type PdfResult } from '../export/pdf.ts';
import type { TypstEngine } from '../export/engine.ts';
import type { Book } from '../core/book.ts';
import { REPO_ROOT } from './load.ts';

export const FONT_FILES = [
  'node_modules/source-serif/TTF/SourceSerif4-Regular.ttf',
  'node_modules/source-serif/TTF/SourceSerif4-It.ttf',
  'node_modules/source-serif/TTF/SourceSerif4-Semibold.ttf',
  'node_modules/source-serif/TTF/SourceSerif4-Bold.ttf',
  'node_modules/source-sans/TTF/SourceSans3-Regular.ttf',
  'node_modules/source-sans/TTF/SourceSans3-It.ttf',
  'node_modules/source-sans/TTF/SourceSans3-Semibold.ttf',
  'node_modules/source-sans/TTF/SourceSans3-Bold.ttf',
].map((f) => join(REPO_ROOT, f));

export type { PdfResult } from '../export/pdf.ts';
export { kdpClean, countPages } from '../export/pdf.ts';

export function typstCompiler(workspace: string): NodeCompiler {
  return NodeCompiler.create({ workspace, fontArgs: [{ fontPaths: FONT_FILES }] });
}

export function compileTypst(c: NodeCompiler, source: string): { pdf: Uint8Array; pages: number } {
  const result = c.compile({ mainFileContent: source });
  const doc = result.result;
  if (!doc || result.hasError()) {
    const err = result.takeError();
    const msgs = (err?.shortDiagnostics ?? []).map((d: { message?: string; range?: string }) => `${d.message ?? JSON.stringify(d)}${d.range ? ` (${d.range})` : ''}`);
    throw new Error(`Typst could not compile the book:\n${msgs.join('\n') || 'unknown error'}`);
  }
  const pdf = c.pdf(doc);
  const pages = doc.numOfPages;
  c.evictCache(10);
  return { pdf, pages };
}

/** TypstEngine for Node: files are read from the book folder by the compiler itself. */
export function nodeEngine(bookDir: string): TypstEngine {
  const c = typstCompiler(bookDir);
  return {
    async pdf(source) {
      return compileTypst(c, source);
    },
    async svg(source) {
      const res = c.compile({ mainFileContent: source });
      if (!res.result || res.hasError()) throw new Error('Typst could not compile the document.');
      return c.svg(res.result);
    },
    async query(source, label) {
      const found = c.query({ mainFileContent: source }, { selector: `<${label}>` }) as Array<{ value?: unknown }>;
      return (found ?? []).map((m) => m.value);
    },
  };
}

export async function exportPdf(book: Book, bookDir: string, ctx: TypstContext, layout: TypstLayout = DEFAULT_LAYOUT): Promise<PdfResult> {
  return buildInterior(book, ctx, nodeEngine(bookDir), layout);
}

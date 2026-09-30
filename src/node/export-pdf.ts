/**
 * Print PDF export: Typst (WebAssembly compiler) → PDF → KDP clean-up.
 *
 * 1. Compile once to learn the page count.
 * 2. Raise the gutter if KDP's page-count table requires more than the layout has.
 * 3. Strip what KDP rejects in an interior file: bookmarks (outline), document metadata,
 *    and annotations (Typst writes clickable links as link annotations).
 */
import { NodeCompiler } from '@myriaddreamin/typst-ts-node-compiler';
import { PDFDocument, PDFName } from 'pdf-lib';
import { join } from 'node:path';
import { minGutter } from '../kdp/specs.ts';
import { DEFAULT_LAYOUT, renderTypst, type TypstContext, type TypstLayout } from '../render/typst.ts';
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

export interface PdfResult {
  pdf: Uint8Array;
  typst: string;
  pages: number;
  layout: TypstLayout;
  diagnostics: string[];
}

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

export async function countPages(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
}

/** Remove bookmarks, metadata and annotations (KDP Paperback Submission Guidelines, G201857950). */
export async function kdpClean(pdf: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  doc.catalog.delete(PDFName.of('Outlines'));
  doc.catalog.delete(PDFName.of('Metadata'));
  doc.catalog.delete(PDFName.of('PageMode'));
  for (const page of doc.getPages()) page.node.delete(PDFName.of('Annots'));
  // An empty trailer Info dictionary is written instead of Typst's Creator/dates.
  doc.context.trailerInfo.Info = doc.context.register(doc.context.obj({}));
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

export async function exportPdf(book: Book, bookDir: string, ctx: TypstContext, layout: TypstLayout = DEFAULT_LAYOUT): Promise<PdfResult> {
  const c = typstCompiler(bookDir);
  const diagnostics: string[] = [];
  let lay = { ...layout };
  let source = renderTypst(book, ctx, lay);
  let { pdf, pages } = compileTypst(c, source);
  const need = minGutter(pages);
  if (need > lay.insideIn) {
    diagnostics.push(`Gutter raised from ${lay.insideIn}" to ${need}" for ${pages} pages (KDP minimum).`);
    lay = { ...lay, insideIn: need };
    source = renderTypst(book, ctx, lay);
    ({ pdf, pages } = compileTypst(c, source));
  }
  return { pdf: await kdpClean(pdf), typst: source, pages, layout: lay, diagnostics };
}

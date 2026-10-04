/**
 * Print interior: Typst → PDF → KDP clean-up, the same in the CLI and the app.
 *
 * 1. Compile once to learn the page count.
 * 2. Raise the gutter if KDP's page-count table requires more than the layout has.
 * 3. Strip what KDP rejects in an interior file: bookmarks (outline), document metadata,
 *    and annotations (Typst writes clickable links as link annotations).
 */
import { PDFDocument, PDFName } from 'pdf-lib';
import { minGutter } from '../kdp/specs.ts';
import { DEFAULT_LAYOUT, renderTypst, type TypstContext, type TypstLayout } from '../render/typst.ts';
import type { Book } from '../core/book.ts';
import type { TypstEngine } from './engine.ts';

export interface PdfResult {
  pdf: Uint8Array;
  typst: string;
  pages: number;
  layout: TypstLayout;
  diagnostics: string[];
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

export async function countPages(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
}

export async function buildInterior(book: Book, ctx: TypstContext, engine: TypstEngine, layout: TypstLayout = DEFAULT_LAYOUT): Promise<PdfResult> {
  const diagnostics: string[] = [];
  let lay = { ...layout };
  let source = renderTypst(book, ctx, lay);
  let { pdf, pages } = await engine.pdf(source);
  const need = minGutter(pages);
  if (need > lay.insideIn) {
    diagnostics.push(`Gutter raised from ${lay.insideIn}" to ${need}" for ${pages} pages (KDP minimum).`);
    lay = { ...lay, insideIn: need };
    source = renderTypst(book, ctx, lay);
    ({ pdf, pages } = await engine.pdf(source));
  }
  return { pdf: await kdpClean(pdf), typst: source, pages, layout: lay, diagnostics };
}

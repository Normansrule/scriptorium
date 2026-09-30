/**
 * KDP pre-flight for the interior PDF. Each rule names the KDP page it comes from.
 * The cover has its own pre-flight in cover-preflight.ts.
 */
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRef } from 'pdf-lib';
import { billedPageCount, checkPageCount, interiorPageSize, minGutter, type Paper, type TrimSize } from './specs.ts';

export interface Check {
  rule: string;
  ok: boolean;
  detail: string;
  source: string;
}

export const PSG = 'KDP Paperback Submission Guidelines (G201857950)';

export function fontsIn(doc: PDFDocument): { name: string; embedded: boolean }[] {
  const out = new Map<string, boolean>();
  const seen = new Set<unknown>();
  const visit = (res: PDFDict | undefined) => {
    if (!res || seen.has(res)) return;
    seen.add(res);
    const fonts = res.lookupMaybe(PDFName.of('Font'), PDFDict);
    fonts?.entries().forEach(([, ref]) => {
      const f = doc.context.lookup(ref) as PDFDict | undefined;
      if (!f) return;
      const name = String(f.get(PDFName.of('BaseFont')) ?? '?');
      let desc = f.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      const desc2 = f.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
      if (!desc && desc2) desc = (doc.context.lookup(desc2.get(0)) as PDFDict).lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
      const embedded = !!desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc!.has(PDFName.of(k)));
      const isType3 = String(f.get(PDFName.of('Subtype'))) === '/Type3';
      out.set(name, embedded || isType3);
    });
    const xo = res.lookupMaybe(PDFName.of('XObject'), PDFDict);
    xo?.entries().forEach(([, ref]) => {
      const x = doc.context.lookup(ref as PDFRef);
      const r = (x as unknown as { dict?: PDFDict }).dict?.lookupMaybe(PDFName.of('Resources'), PDFDict);
      visit(r);
    });
  };
  for (const p of doc.getPages()) visit(p.node.Resources());
  return [...out.entries()].map(([name, embedded]) => ({ name, embedded }));
}

/** Checks shared by interior and cover files. */
export function cleanFileChecks(doc: PDFDocument, bytes: number): Check[] {
  const checks: Check[] = [];
  const fonts = fontsIn(doc);
  const notEmbedded = fonts.filter((f) => !f.embedded);
  checks.push({ rule: 'All fonts embedded', ok: notEmbedded.length === 0, detail: notEmbedded.length ? `Not embedded: ${notEmbedded.map((f) => f.name).join(', ')}` : `${fonts.length} fonts, all embedded.`, source: PSG });

  const hasOutline = doc.catalog.has(PDFName.of('Outlines'));
  checks.push({ rule: 'No bookmarks', ok: !hasOutline, detail: hasOutline ? 'The PDF has a bookmark outline.' : 'No outline.', source: PSG });

  const annotPages = doc.getPages().filter((p) => p.node.has(PDFName.of('Annots'))).length;
  checks.push({ rule: 'No annotations or comments', ok: annotPages === 0, detail: annotPages ? `${annotPages} pages carry annotations (links count).` : 'None.', source: PSG });

  const info = doc.context.trailerInfo.Info ? (doc.context.lookup(doc.context.trailerInfo.Info) as PDFDict | undefined) : undefined;
  const hasMeta = doc.catalog.has(PDFName.of('Metadata')) || (info ? info.keys().length > 0 : false);
  checks.push({ rule: 'No document metadata', ok: !hasMeta, detail: hasMeta ? 'Info dictionary or XMP metadata present.' : 'None.', source: PSG });

  const encrypted = !!doc.context.trailerInfo.Encrypt;
  checks.push({ rule: 'Not encrypted', ok: !encrypted, detail: encrypted ? 'The file is encrypted.' : 'Not encrypted.', source: 'KDP Create a Paperback Cover (G201953020), pre-publication checklist' });

  const mb = bytes / 1e6;
  checks.push({ rule: 'File size ≤ 650 MB', ok: mb <= 650, detail: `${mb.toFixed(1)} MB.`, source: PSG });
  return checks;
}

export async function preflightInterior(pdfBytes: Uint8Array, opts: { trim: TrimSize; paper: Paper; bleed: boolean; insideMarginIn: number }): Promise<Check[]> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const checks: Check[] = [];
  const pages = doc.getPageCount();
  const want = interiorPageSize(opts.trim, opts.bleed);

  const sizes = doc.getPages().map((p) => p.getSize());
  const badSize = sizes.findIndex((s) => Math.abs(s.width / 72 - want.width) > 0.01 || Math.abs(s.height / 72 - want.height) > 0.01);
  checks.push({
    rule: 'Page size matches trim' + (opts.bleed ? ' + bleed' : ''),
    ok: badSize < 0,
    detail: badSize < 0 ? `All ${pages} pages are ${want.width}" × ${want.height}".` : `Page ${badSize + 1} is ${(sizes[badSize]!.width / 72).toFixed(3)}" × ${(sizes[badSize]!.height / 72).toFixed(3)}".`,
    source: PSG,
  });

  const pc = checkPageCount(pages, opts.trim, opts.paper);
  checks.push({ rule: 'Page count within KDP limits', ok: pc.ok, detail: `${pages} pages in the PDF${pages !== billedPageCount(pages) ? `; KDP rounds up to an even ${billedPageCount(pages)}` : ''}. ${pc.message}`, source: PSG });

  const gut = minGutter(pages);
  checks.push({ rule: 'Inside (gutter) margin', ok: opts.insideMarginIn >= gut, detail: `Layout uses ${opts.insideMarginIn}"; KDP needs ≥ ${gut}" for ${pages} pages.`, source: PSG });

  checks.push(...cleanFileChecks(doc, pdfBytes.byteLength));
  return checks;
}

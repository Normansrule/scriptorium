/**
 * KDP pre-flight for the paperback cover PDF and the ebook cover image.
 */
import { PDFDocument } from 'pdf-lib';
import jpeg from 'jpeg-js';
import { cleanFileChecks, type Check } from './preflight.ts';
import { COVER_RECOMMENDED_MAX_MB, EBOOK_COVER, type CoverGeometry } from './specs.ts';
import { layoutProblems, type CoverLayout } from '../render/cover.ts';

const COVER = 'KDP Create a Paperback Cover (G201953020)';
const EBC = 'KDP eBook cover requirements (G6GTK3T3NUHKLEFX)';

export async function preflightCover(pdfBytes: Uint8Array, geom: CoverGeometry, layout?: CoverLayout, trim?: { width: number; height: number }): Promise<Check[]> {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const checks: Check[] = [];
  const n = doc.getPageCount();
  checks.push({ rule: 'Single page (back, spine and front as one image)', ok: n === 1, detail: `${n} page(s).`, source: COVER });
  const s = doc.getPage(0).getSize();
  const wi = s.width / 72;
  const hi = s.height / 72;
  const sizeOk = Math.abs(wi - geom.width) <= 0.01 && Math.abs(hi - geom.height) <= 0.01;
  checks.push({ rule: 'Cover size = bleed + back + spine + front + bleed', ok: sizeOk, detail: `${wi.toFixed(3)}" × ${hi.toFixed(3)}"; expected ${geom.width.toFixed(3)}" × ${geom.height.toFixed(3)}" (spine ${geom.spine.toFixed(3)}").`, source: COVER });
  if (layout && trim) {
    const p = layoutProblems(layout, trim.width, trim.height);
    checks.push({ rule: 'Text, images and barcode area inside the safe zones', ok: p.length === 0, detail: p.length ? p.join(' ') : `All content ≥ ${layout.margin}" inside the trim; barcode area ${layout.barcode.w}" × ${layout.barcode.h}" kept white${layout.spineText ? '; spine text with ≥ 0.0625" clearance' : '; no spine text (79 pages or fewer)'}.`, source: COVER });
  }
  checks.push(...cleanFileChecks(doc, pdfBytes.byteLength).map((c) => (c.rule.startsWith('File size') ? { ...c, detail: `${c.detail} KDP recommends ${COVER_RECOMMENDED_MAX_MB} MB or less.`, source: COVER } : c)));
  return checks;
}

export function preflightEbookCover(jpg: Uint8Array): Check[] {
  const checks: Check[] = [];
  const isJpeg = jpg[0] === 0xff && jpg[1] === 0xd8;
  checks.push({ rule: 'JPEG (KDP\'s preferred format)', ok: isJpeg, detail: isJpeg ? 'JPEG.' : 'Not a JPEG.', source: EBC });
  if (!isJpeg) return checks;
  const img = jpeg.decode(jpg, { useTArray: true, formatAsRGBA: true });
  const ideal = img.width === EBOOK_COVER.widthPx && img.height === EBOOK_COVER.heightPx;
  checks.push({ rule: 'Ideal size 1600 × 2560 px', ok: ideal, detail: `${img.width} × ${img.height} px.`, source: EBC });
  checks.push({ rule: 'Shortest side ≥ 500 px', ok: Math.min(img.width, img.height) >= EBOOK_COVER.minShortSidePx, detail: `${Math.min(img.width, img.height)} px.`, source: EBC });
  const mb = jpg.byteLength / 1e6;
  checks.push({ rule: 'File size ≤ 5 MB', ok: mb <= EBOOK_COVER.maxMB, detail: `${mb.toFixed(2)} MB.`, source: EBC });
  const comps = jpegComponents(jpg);
  checks.push({ rule: 'RGB color (not CMYK)', ok: comps === 3, detail: comps === 3 ? '3 color components (RGB).' : comps === 4 ? '4 components (CMYK); Kindle does not support CMYK.' : `${comps ?? 'unknown'} component(s).`, source: EBC });
  return checks;
}

/** Number of color components from the JPEG start-of-frame marker (3 = RGB/YCbCr, 4 = CMYK, 1 = gray). */
export function jpegComponents(b: Uint8Array): number | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    const len = (b[i + 2]! << 8) | b[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return b[i + 9]!;
    i += 2 + len;
  }
  return null;
}

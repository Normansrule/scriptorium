/**
 * Cover generator: one design, two outputs.
 *
 *   renderCoverTypst  → full-wrap paperback cover (back + spine + front, with bleed) for KDP.
 *   renderFrontTypst  → the front alone, page-shaped like KDP's ideal ebook cover (1600 × 2560 px),
 *                       rasterized to JPEG by src/node/export-cover.ts.
 *
 * Geometry comes from src/kdp/specs.ts (coverGeometry, BARCODE, COVER_TEXT_INSET_IN,
 * COVER_SAFE_FROM_EDGE_IN). `coverLayout` returns every text box in cover coordinates so
 * tests and the cover pre-flight can prove each one sits inside the safe zones.
 *
 * Design: a white cover with a band in the signal color across the top of the front and
 * back and down the spine; title and subtitle in white on the band; the book's chosen
 * figure in the middle of the front; the description on the back; the barcode area at the
 * lower right of the back left empty and white so KDP can place its barcode there.
 */
import { surface, roles, fonts } from '../core/style.ts';
import type { Book } from '../core/book.ts';
import { BARCODE, BLEED_IN, COVER_SAFE_FROM_EDGE_IN, COVER_TEXT_INSET_IN, SPINE_TEXT_CLEARANCE_IN, type CoverGeometry } from '../kdp/specs.ts';

export interface Box {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CoverLayout {
  geom: CoverGeometry;
  /** Margin used inside each trim edge for text and images (≥ both KDP minimums). */
  margin: number;
  band: number;
  /** Height of the strip behind the back-cover title. */
  backBand: number;
  boxes: Box[];
  barcode: Box;
  spineText: Box | null;
}

/** Inside-trim margin for content: KDP asks for ≥ 0.125" (text) and ≥ 0.25" from the outer edge; we use 0.5". */
export const COVER_MARGIN_IN = 0.5;

const tstr = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
const C = {
  band: `rgb("${roles.signal.light}")`,
  ink: `rgb("${surface.ink.light}")`,
  muted: `rgb("${surface.muted.light}")`,
  white: `rgb("#FFFFFF")`,
};

/** The figure shown on the front: meta.coverFigure, else the first figure or 3D model in the book. */
export function coverImage(book: Book): string | null {
  const want = book.meta.coverFigure;
  for (const ch of book.chapters)
    for (const s of ch.sections)
      for (const blocks of Object.values(s.layers))
        for (const b of blocks as Array<{ kind: string; id?: string; src?: string; views?: Array<{ src: string }> }>) {
          if (b.kind !== 'figure' && b.kind !== 'model3d') continue;
          if (want && b.id !== want) continue;
          return b.kind === 'figure' ? b.src! : b.views![0]!.src;
        }
  return null;
}

/** Plain text of the description (KDP allows a few HTML tags in the store listing; the cover prints text). */
export function descriptionText(book: Book): string[] {
  const d = book.meta.description ?? '';
  return d
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[4-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function coverLayout(geom: CoverGeometry, trimW: number, trimH: number): CoverLayout {
  const m = COVER_MARGIN_IN;
  const band = BLEED_IN + trimH * 0.36;
  const top = BLEED_IN;
  const front = geom.frontLeft;
  const back = geom.backLeft;
  const boxes: Box[] = [
    { name: 'front title block', x: front + m, y: top + m, w: trimW - 2 * m, h: band - top - m - 0.15 },
    { name: 'front image', x: front + m, y: band + 0.3, w: trimW - 2 * m, h: trimH * 0.4 },
    { name: 'front author', x: front + m, y: top + trimH - m - 0.4, w: trimW - 2 * m, h: 0.4 },
    { name: 'back title', x: back + m, y: top + m, w: trimW - 2 * m, h: 0.55 },
    { name: 'back description', x: back + m, y: top + m + 1.1, w: trimW - 2 * m, h: trimH - 2 * m - 1.1 - BARCODE.height - 0.3 },
  ];
  // Barcode: lower right of the back cover, inset ≥ 0.25" from the spine and the bottom trim (we use the 0.5" margin).
  const barcode: Box = { name: 'barcode area', x: geom.spineLeft - m - BARCODE.width, y: top + trimH - m - BARCODE.height, w: BARCODE.width, h: BARCODE.height };
  const usable = geom.spine - 2 * SPINE_TEXT_CLEARANCE_IN;
  const spineText = geom.spineTextAllowed && usable > 0.08 ? { name: 'spine text', x: geom.spineLeft + SPINE_TEXT_CLEARANCE_IN, y: top + m, w: usable, h: trimH - 2 * m } : null;
  return { geom, margin: m, band, backBand: top + m + 0.55 + 0.25, boxes, barcode, spineText };
}

/** Every rule the layout must satisfy; used by tests and by the cover pre-flight. */
export function layoutProblems(l: CoverLayout, trimW: number, trimH: number): string[] {
  const out: string[] = [];
  const top = BLEED_IN;
  const panels = [
    { name: 'back', left: l.geom.backLeft },
    { name: 'front', left: l.geom.frontLeft },
  ];
  for (const b of [...l.boxes, l.barcode]) {
    const p = panels.find((q) => b.x >= q.left - 1e-9 && b.x < q.left + trimW)!;
    if (!p) {
      out.push(`${b.name} is not on the front or back panel.`);
      continue;
    }
    const inset = Math.min(b.x - p.left, p.left + trimW - (b.x + b.w), b.y - top, top + trimH - (b.y + b.h));
    if (inset < COVER_TEXT_INSET_IN - 1e-9) out.push(`${b.name} is ${inset.toFixed(3)}" inside the trim; KDP needs ≥ ${COVER_TEXT_INSET_IN}".`);
    const fromEdge = Math.min(b.x, l.geom.width - (b.x + b.w), b.y, l.geom.height - (b.y + b.h));
    if (fromEdge < COVER_SAFE_FROM_EDGE_IN - 1e-9) out.push(`${b.name} is ${fromEdge.toFixed(3)}" from the cover edge; KDP needs ≥ ${COVER_SAFE_FROM_EDGE_IN}".`);
  }
  const bc = l.barcode;
  if (l.geom.spineLeft - (bc.x + bc.w) < BARCODE.clearance - 1e-9) out.push('Barcode area is closer than 0.25" to the spine.');
  if (top + trimH - (bc.y + bc.h) < BARCODE.clearance - 1e-9) out.push('Barcode area is closer than 0.25" to the bottom trim.');
  const desc = l.boxes.find((b) => b.name === 'back description')!;
  if (desc.y + desc.h > bc.y - 1e-9 && desc.x + desc.w > bc.x) out.push('Back description overlaps the barcode area.');
  if (l.spineText) {
    if (l.spineText.x - l.geom.spineLeft < SPINE_TEXT_CLEARANCE_IN - 1e-9 || l.geom.spineLeft + l.geom.spine - (l.spineText.x + l.spineText.w) < SPINE_TEXT_CLEARANCE_IN - 1e-9) out.push('Spine text is closer than 0.0625" to a spine edge.');
    if (!l.geom.spineTextAllowed) out.push('Spine text on a book of 79 pages or fewer.');
  }
  return out;
}

const place = (b: Box, body: string, align = 'top + left') => `#place(top + left, dx: ${b.x.toFixed(4)}in, dy: ${b.y.toFixed(4)}in, box(width: ${b.w.toFixed(4)}in, height: ${b.h.toFixed(4)}in, align(${align}, ${body})))`;

function titleBlock(book: Book, scale = 1): string {
  const m = book.meta;
  const size = (m.title.length > 40 ? 26 : 32) * scale;
  return `[#set par(justify: false, leading: 0.35em)
#text(font: "${fonts.sans}", weight: "bold", size: ${size.toFixed(1)}pt, fill: ${C.white})[#${tstr(m.title)}]
${m.subtitle ? `#v(${(10 * scale).toFixed(1)}pt)\n#set par(leading: 0.5em)\n#text(font: "${fonts.sans}", size: ${(13 * scale).toFixed(1)}pt, fill: ${C.white})[#${tstr(m.subtitle)}]` : ''}]`;
}

const authorLine = (book: Book, scale = 1) => `[#text(font: "${fonts.sans}", weight: "semibold", size: ${(14 * scale).toFixed(1)}pt, fill: ${C.ink})[#${tstr(book.meta.authors.join(', '))}]]`;

const inches = (b: Box): Box => ({ ...b, x: b.x / 72, y: b.y / 72, w: b.w / 72, h: b.h / 72 });

const imageBody = (src: string | null) => (src ? `image(${tstr(src)}, height: 100%, fit: "contain")` : '[]');

export function renderCoverTypst(book: Book, geom: CoverGeometry, trimW: number, trimH: number): string {
  const l = coverLayout(geom, trimW, trimH);
  const problems = layoutProblems(l, trimW, trimH);
  if (problems.length) throw new Error(`Cover layout breaks KDP rules:\n${problems.join('\n')}`);
  const box = (name: string) => l.boxes.find((b) => b.name === name)!;
  const desc = descriptionText(book);
  const parts = [
    `// Generated by Scriptorium — full-wrap paperback cover. Edit the book, not this file.`,
    `#set page(width: ${geom.width.toFixed(4)}in, height: ${geom.height.toFixed(4)}in, margin: 0pt, fill: ${C.white})`,
    `#set text(lang: "${book.meta.language}", hyphenate: false)`,
    // Bands run into the bleed: a deep band on the front, a strip behind the back title, and the spine.
    `#place(top + left, dx: ${geom.spineLeft.toFixed(4)}in, rect(width: ${(geom.width - geom.spineLeft).toFixed(4)}in, height: ${l.band.toFixed(4)}in, fill: ${C.band}))`,
    `#place(top + left, rect(width: ${geom.spineLeft.toFixed(4)}in, height: ${l.backBand.toFixed(4)}in, fill: ${C.band}))`,
    `#place(top + left, dx: ${geom.spineLeft.toFixed(4)}in, rect(width: ${geom.spine.toFixed(4)}in, height: 100%, fill: ${C.band}))`,
    place(box('front title block'), titleBlock(book), 'bottom + left'),
    place(box('front image'), imageBody(coverImage(book)), 'center + horizon'),
    place(box('front author'), authorLine(book), 'bottom + left'),
    place(box('back title'), `[#text(font: "${fonts.sans}", weight: "bold", size: 17pt, fill: ${C.white})[#${tstr(book.meta.title)}]]`, 'top + left'),
    place(box('back description'), `[#set par(justify: false, leading: 0.6em, spacing: 0.9em)\n#set text(font: "${fonts.body}", size: 11pt, fill: ${C.ink})\n${desc.map((p) => `#par[#${tstr(p)}]`).join('\n')}]`, 'top + left'),
    `// Barcode area (${l.barcode.w}" × ${l.barcode.h}") kept white and empty: KDP places the barcode here.`,
  ];
  if (l.spineText) {
    const s = l.spineText;
    const size = Math.min(12, s.w * 72 * 0.7);
    parts.push(`#place(top + left, dx: ${s.x.toFixed(4)}in, dy: ${s.y.toFixed(4)}in, box(width: ${s.w.toFixed(4)}in, height: ${s.h.toFixed(4)}in, align(center + horizon, rotate(90deg, reflow: true, text(font: "${fonts.sans}", weight: "semibold", size: ${size.toFixed(1)}pt, fill: ${C.white})[#${tstr(book.meta.title)} #h(1em) #${tstr(book.meta.authors.join(', '))}]))))`);
  }
  return parts.join('\n') + '\n';
}

/** The front cover alone at the ebook cover's 1600 × 2560 aspect, sized so 300 px = 1 in. */
/** Page size of the ebook front (points: 1600 × 2560 px at 300 px per inch, so rasterizing comes out exact). */
export const FRONT_PT = { w: (1600 / 300) * 72, h: (2560 / 300) * 72 };

/** Where the cover figure sits on the ebook front, in points (the figure is scaled to fit, centred). */
export function frontImageBox(): Box {
  const { w, h } = FRONT_PT;
  const s = w / 72 / 6;
  const m = COVER_MARGIN_IN * s * 72;
  const band = h * 0.36;
  return { name: 'i', x: m, y: band + 0.3 * s * 72, w: w - 2 * m, h: h * 0.4 };
}

/**
 * The front cover alone at the ebook cover's 1600 × 2560 aspect.
 * With `image: false` the figure is left out so a browser can draw it separately (a canvas
 * that draws an SVG containing embedded images can no longer be read back).
 */
export function renderFrontTypst(book: Book, opts: { image?: boolean } = {}): string {
  const { w, h } = FRONT_PT;
  const s = w / 72 / 6; // scale type relative to a 6"-wide front
  const IN = 72;
  const m = COVER_MARGIN_IN * s * IN;
  const band = h * 0.36;
  return [
    `// Generated by Scriptorium — ebook cover (front only).`,
    `#set page(width: ${w.toFixed(3)}pt, height: ${h.toFixed(3)}pt, margin: 0pt, fill: ${C.white})`,
    `#place(top + left, rect(width: 100%, height: ${(band / IN).toFixed(4)}in, fill: ${C.band}))`,
    place(inches({ name: 't', x: m, y: m, w: w - 2 * m, h: band - m - 0.15 * s * IN }), titleBlock(book, s), 'bottom + left'),
    opts.image === false ? '' : place(inches(frontImageBox()), imageBody(coverImage(book)), 'center + horizon'),
    place(inches({ name: 'a', x: m, y: h - m - 0.4 * s * IN, w: w - 2 * m, h: 0.4 * s * IN }), authorLine(book, s), 'bottom + left'),
  ].join('\n') + '\n';
}

/**
 * Kindle Direct Publishing (KDP) print specifications.
 *
 * Every number here comes from Amazon's help pages, checked 2026-09-30:
 *   [PSG]   Paperback Submission Guidelines  https://kdp.amazon.com/en_US/help/topic/G201857950
 *   [COVER] Create a Paperback Cover          https://kdp.amazon.com/en_US/help/topic/G201953020
 *   [BAR]   Barcodes                          https://kdp.amazon.com/en_US/help/topic/G5HDYGP4BXLX4RUW
 *   [EBC]   Kindle eBook cover requirements   https://kdp.amazon.com/en_US/help/topic/G6GTK3T3NUHKLEFX
 *   [META]  Metadata Guidelines for Books     https://kdp.amazon.com/en_US/help/topic/G201097560
 *   [KW]    Make Your Book More Discoverable with Keywords  https://kdp.amazon.com/en_US/help/topic/G201298500
 *   [DESC]  Book description                  https://kdp.amazon.com/en_US/help/topic/G201189630
 * (cover, barcode, ebook-cover and metadata pages checked 2026-10-01)
 * If KDP changes a rule, change it here and nowhere else. tests/unit/kdp.test.ts pins the values.
 * All lengths are inches.
 */

export type Paper = 'white' | 'cream' | 'groundwood' | 'premium-color' | 'standard-color';

/** Bleed on the top, bottom and outer edge of interior pages and all cover edges. [PSG] */
export const BLEED_IN = 0.125;

/** Spine width per page. [COVER] (groundwood from [PSG]) */
export const SPINE_PER_PAGE_IN: Record<Paper, number> = {
  white: 0.002252,
  cream: 0.0025,
  groundwood: 0.00235,
  'premium-color': 0.002347,
  'standard-color': 0.002252,
};

/** KDP prints spine text only on books with MORE than this many pages. [COVER] */
export const SPINE_TEXT_MIN_PAGES = 79;
/** Clearance between spine text and each spine edge. [COVER] */
export const SPINE_TEXT_CLEARANCE_IN = 0.0625;
/** Front/back cover text must sit at least this far inside the trim. [COVER] */
export const COVER_TEXT_INSET_IN = 0.125;
/** "Any content you don't intend to be trimmed off should be a minimum of 0.25" from the outside cover edge." [PSG, Cover formatting] */
export const COVER_SAFE_FROM_EDGE_IN = 0.25;

export const MIN_IMAGE_DPI = 300; // [PSG]
export const RECOMMENDED_MAX_IMAGE_DPI = 600; // [PSG]
export const MIN_FONT_PT = 7; // [PSG]
export const MIN_LINE_PT = 0.75; // [PSG]
export const MIN_GRAY_FILL_PERCENT = 10; // [PSG]
export const MAX_FILE_MB = 650; // [PSG]
/** Titles an account may create per book format per week. [PSG] */
export const TITLES_PER_FORMAT_PER_WEEK = 2;

/** Inside (gutter) margin by page count. [PSG] */
const GUTTER_TABLE: Array<{ maxPages: number; gutter: number }> = [
  { maxPages: 150, gutter: 0.375 },
  { maxPages: 300, gutter: 0.5 },
  { maxPages: 500, gutter: 0.625 },
  { maxPages: 700, gutter: 0.75 },
  { maxPages: 828, gutter: 0.875 },
];
export const OUTSIDE_MARGIN_NO_BLEED_IN = 0.25; // [PSG]
export const OUTSIDE_MARGIN_BLEED_IN = 0.375; // [PSG]

export interface TrimSize {
  label: string;
  width: number;
  height: number;
  /** Maximum page count by paper, [PSG] table (kdp.amazon.com). null = not available. */
  maxPages: Record<Paper, number | null>;
}

const std = (w: number, h: number, bw: number, cr: number, gw: number, prem: number, stdColor: number | null): TrimSize => ({
  label: `${w}" × ${h}"`,
  width: w,
  height: h,
  maxPages: { white: bw, cream: cr, groundwood: gw, 'premium-color': prem, 'standard-color': stdColor },
});

/** Trim sizes offered on kdp.amazon.com. [PSG] */
export const TRIM_SIZES: TrimSize[] = [
  std(5, 8, 828, 776, 812, 828, 600),
  std(5.06, 7.81, 828, 776, 812, 828, 600),
  std(5.25, 8, 828, 776, 812, 828, 600),
  std(5.5, 8.5, 828, 776, 812, 828, 600),
  std(6, 9, 828, 776, 812, 828, 600),
  std(6.14, 9.21, 828, 776, 812, 828, 600),
  std(6.69, 9.61, 828, 776, 812, 828, 600),
  std(7, 10, 828, 776, 812, 828, 600),
  std(7.44, 9.69, 828, 776, 812, 828, 600),
  std(7.5, 9.25, 828, 776, 812, 828, 600),
  std(8, 10, 828, 776, 812, 828, 600),
  std(8.25, 6, 800, 750, 784, 800, 600),
  std(8.25, 8.25, 800, 750, 784, 800, 600),
  std(8.27, 11.69, 780, 730, 764, 590, null),
  std(8.5, 8.5, 590, 550, 578, 590, 600),
  std(8.5, 11, 590, 550, 578, 590, 600),
];

export function findTrim(width: number, height: number): TrimSize {
  const t = TRIM_SIZES.find((s) => Math.abs(s.width - width) < 1e-6 && Math.abs(s.height - height) < 1e-6);
  if (!t) throw new Error(`${width}" × ${height}" is not a KDP paperback trim size.`);
  return t;
}

/** KDP rounds the page count up to an even number. [PSG] */
export function billedPageCount(pages: number): number {
  return pages % 2 === 0 ? pages : pages + 1;
}

export function minPages(paper: Paper): number {
  return paper === 'standard-color' ? 72 : 24; // [PSG]
}

/** Minimum inside (gutter) margin for a page count. [PSG] */
export function minGutter(pages: number): number {
  const row = GUTTER_TABLE.find((r) => pages <= r.maxPages);
  if (!row) throw new Error(`KDP paperbacks top out at 828 pages; got ${pages}.`);
  return row.gutter;
}

export function minOutsideMargin(bleed: boolean): number {
  return bleed ? OUTSIDE_MARGIN_BLEED_IN : OUTSIDE_MARGIN_NO_BLEED_IN;
}

/** Interior PDF page size: trim, or trim + 0.125" (width) and + 0.25" (height) with bleed. [PSG] */
export function interiorPageSize(trim: TrimSize, bleed: boolean): { width: number; height: number } {
  return bleed ? { width: trim.width + BLEED_IN, height: trim.height + 2 * BLEED_IN } : { width: trim.width, height: trim.height };
}

/** Spine width = page count × paper factor. [COVER] */
export function spineWidth(pages: number, paper: Paper): number {
  return billedPageCount(pages) * SPINE_PER_PAGE_IN[paper];
}

export interface CoverGeometry {
  width: number;
  height: number;
  spine: number;
  /** x-coordinates (from left edge of the full cover) */
  backLeft: number;
  spineLeft: number;
  frontLeft: number;
  spineTextAllowed: boolean;
}

/**
 * Full-wrap cover: width = bleed + back + spine + front + bleed; height = bleed + trim height + bleed. [COVER]
 */
export function coverGeometry(trim: TrimSize, pages: number, paper: Paper): CoverGeometry {
  const spine = spineWidth(pages, paper);
  return {
    width: BLEED_IN + trim.width + spine + trim.width + BLEED_IN,
    height: BLEED_IN + trim.height + BLEED_IN,
    spine,
    backLeft: BLEED_IN,
    spineLeft: BLEED_IN + trim.width,
    frontLeft: BLEED_IN + trim.width + spine,
    spineTextAllowed: billedPageCount(pages) > SPINE_TEXT_MIN_PAGES,
  };
}

export interface PageCountCheck {
  ok: boolean;
  message: string;
}

export function checkPageCount(pages: number, trim: TrimSize, paper: Paper): PageCountCheck {
  const n = billedPageCount(pages);
  const max = trim.maxPages[paper];
  if (max === null) return { ok: false, message: `${paper} paper is not offered at ${trim.label}.` };
  if (n < minPages(paper)) return { ok: false, message: `${n} pages is below KDP's minimum of ${minPages(paper)}.` };
  if (n > max) return { ok: false, message: `${n} pages is above KDP's maximum of ${max} for ${trim.label} on ${paper} paper.` };
  return { ok: true, message: `${n} pages is within ${minPages(paper)}–${max}.` };
}

// ---------------------------------------------------------------------------
// Cover extras, ebook cover and metadata

/** "Cover files larger than 650MB won't convert. We recommend a file size of 40MB or less." [COVER] */
export const COVER_RECOMMENDED_MAX_MB = 40;

/** Barcode area on the back cover: suggested 2" × 1.2" (minimum 1.4" × 0.8"), solid white, ≥ 0.25" from spine and trim. KDP adds one if you leave the area free. [BAR] */
export const BARCODE = { width: 2, height: 1.2, minWidth: 1.4, minHeight: 0.8, clearance: 0.25 } as const;

/** Ideal Kindle ebook cover: 2,560 px tall × 1,600 px wide, JPEG, RGB, ≤ 5 MB; shortest side ≥ 500 px to display. [EBC] */
export const EBOOK_COVER = { heightPx: 2560, widthPx: 1600, maxMB: 5, minShortSidePx: 500, borderPx: 4, borderGray: '#808080' } as const;

/** "Your title and subtitle together must be fewer than 200 characters." [META] */
export const TITLE_SUBTITLE_MAX_CHARS = 199;
/** "we have a limit of 4000 characters for the description" [DESC] */
export const DESCRIPTION_MAX_CHARS = 4000;
/** HTML tags KDP accepts in a description. [DESC] */
export const DESCRIPTION_TAGS = ['br', 'p', 'b', 'em', 'i', 'u', 'h4', 'h5', 'h6', 'ol', 'ul', 'li'] as const;
/** "Use up to seven keywords or short phrases." [KW] */
export const MAX_KEYWORDS = 7;
/** "You'll choose up to three categories" [META] */
export const MAX_CATEGORIES = 3;
/**
 * KDP's keyword boxes have a character limit that its help pages do not state; third-party
 * guides report 50. Treated as a warning, not an error.
 */
export const KEYWORD_SOFT_MAX_CHARS = 50;

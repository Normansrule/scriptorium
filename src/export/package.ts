/**
 * The KDP upload package, built the same way in the app (browser) and in tests (Node):
 *
 *   book.pdf            paperback interior          → KDP "Manuscript" (paperback)
 *   cover.pdf           full-wrap paperback cover   → KDP "Book Cover" (paperback)
 *   book.epub           ebook                       → KDP "Manuscript" (Kindle eBook)
 *   ebook-cover.jpg     1600 × 2560 ebook cover     → KDP "Kindle eBook Cover"
 *   kdp-metadata.txt    title, description, keywords, categories, checks
 *   ai-disclosure.json  answers for KDP's AI-content questions
 *   preflight.json      every automated check and its result
 *   UPLOAD-CHECKLIST.txt what goes where, and what a person must still do
 *
 * Nothing here talks to KDP: KDP has no upload API, so publishing stays a human act.
 */
import type { Book, Reference } from '../core/book.ts';
import type { Profile } from '../core/profile.ts';
import { buildDisclosure } from '../disclosure/ai-disclosure.ts';
import { preflightCover, preflightEbookCover } from '../kdp/cover-preflight.ts';
import { checkMetadata, metadataSheet, type MetaCheck } from '../kdp/metadata.ts';
import { preflightInterior, type Check } from '../kdp/preflight.ts';
import type { Paper, TrimSize } from '../kdp/specs.ts';
import { formatBibliography, type CslAssets } from '../render/cite.ts';
import { numberBook } from '../render/numbering.ts';
import { buildCover, buildEbookCover } from './cover.ts';
import type { EncodeJpeg, Rasterize, ToXhtml, TypstEngine } from './engine.ts';
import { buildEpub } from './epub.ts';
import { buildInterior } from './pdf.ts';

export interface PackageInput {
  book: Book;
  refs: Reference[];
  profile: Profile;
  /** book files by path relative to the book, e.g. `figures/x.svg` */
  files: Record<string, Uint8Array>;
  csl: CslAssets;
  trim: TrimSize;
  paper: Paper;
  /** true for gallery samples: under-length books may be packaged for practice, never for upload */
  practice?: boolean;
}

export interface PackageDeps {
  engine: TypstEngine;
  rasterize: Rasterize;
  /** how the rasterizer handles the cover figure (see buildEbookCover); default 'inline' */
  coverFigure?: 'inline' | 'overlay';
  /** JPEG encoder for the ebook cover; default jpeg-js */
  encodeJpeg?: EncodeJpeg;
  toXhtml: ToXhtml;
  /** progress messages for the user */
  onStep?: (message: string) => void;
}

export interface PackageChecks {
  interior: Check[];
  cover: Check[];
  ebookCover: Check[];
  metadata: MetaCheck[];
}

export interface PackageResult {
  files: Record<string, Uint8Array>;
  checks: PackageChecks;
  pages: number;
  /** automated checks that failed (metadata errors included); empty means ready */
  failures: string[];
  warnings: string[];
}

const enc = new TextEncoder();

export async function buildPackage(input: PackageInput, deps: PackageDeps): Promise<PackageResult> {
  const { book, refs, profile, trim, paper } = input;
  const step = deps.onStep ?? (() => undefined);
  const numbering = numberBook(book);
  const order = [...numbering.cite.keys()];
  const disclosure = buildDisclosure(book, { figureScriptsByAi: true });
  const d = { text: disclosure.text.answer, images: disclosure.images.answer, translations: disclosure.translations.answer };

  step('Typesetting the print interior…');
  const interior = await buildInterior(book, { numbering, bibliography: formatBibliography(refs, order, input.csl, 'text'), refs, disclosure: d, webUrl: book.meta.webUrl }, deps.engine, {
    trimWidthIn: trim.width,
    trimHeightIn: trim.height,
    insideIn: 0.75,
    outsideIn: 0.625,
    topIn: 0.75,
    bottomIn: 0.8,
    bleed: false,
  });
  const interiorChecks = await preflightInterior(interior.pdf, { trim, paper, bleed: false, insideMarginIn: interior.layout.insideIn });

  step('Drawing the paperback cover…');
  const cover = await buildCover(book, deps.engine, { trim, pages: interior.pages, paper });
  const coverChecks = await preflightCover(cover.pdf, cover.layout.geom, cover.layout, trim);

  step('Drawing the ebook cover…');
  const ebookCover = await buildEbookCover(book, deps.engine, deps.rasterize, { figure: deps.coverFigure, readFile: (p) => input.files[p], encodeJpeg: deps.encodeJpeg });
  const ebookChecks = preflightEbookCover(ebookCover.jpeg);

  step('Building the EPUB…');
  const epub = buildEpub(book, (p) => input.files[p], { numbering, bibliography: formatBibliography(refs, order, input.csl, 'html'), refs, disclosure: d, webUrl: book.meta.webUrl }, { coverJpeg: ebookCover.jpeg, toXhtml: deps.toXhtml });

  step('Checking the listing details…');
  const meta = checkMetadata(book.meta);
  const checks: PackageChecks = { interior: interiorChecks, cover: coverChecks, ebookCover: ebookChecks, metadata: meta };

  const failures: string[] = [];
  const warnings: string[] = [];
  const add = (label: string, list: Check[]) => {
    for (const c of list.filter((x) => !x.ok)) {
      if (input.practice && c.rule === 'Page count within KDP limits') warnings.push(`${label} — ${c.rule}: ${c.detail} (allowed for a practice package)`);
      else failures.push(`${label} — ${c.rule}: ${c.detail}`);
    }
  };
  add('Interior', interiorChecks);
  add('Cover', coverChecks);
  add('Ebook cover', ebookChecks);
  for (const c of meta) {
    if (c.level === 'error') failures.push(`Listing — ${c.rule}: ${c.detail}`);
    if (c.level === 'warning') warnings.push(`Listing — ${c.rule}: ${c.detail}`);
  }
  if (profile.requiresProfessionalReview) warnings.push(`The ${profile.name} profile requires review by a licensed professional before publishing.`);

  const checklist = [
    `${book.meta.title} — KDP upload checklist`,
    input.practice ? '\nPRACTICE PACKAGE: made from a sample book. Do not upload it to KDP.\n' : '',
    'Paperback (Create → Paperback):',
    '  Manuscript ........ book.pdf',
    `  Book cover ........ cover.pdf (Upload a cover you already have; ${trim.label}, ${paper} paper, no bleed)`,
    'Kindle eBook (Create → Kindle eBook):',
    '  Manuscript ........ book.epub',
    '  Kindle eBook cover  ebook-cover.jpg',
    'Details for both: copy from kdp-metadata.txt. AI-content questions: see ai-disclosure.json.',
    '',
    'Before you press Publish on KDP:',
    '  [ ] I read the whole proof, including the verification report.',
    '  [ ] Every reference opens and says what the book cites it for.',
    '  [ ] The cover text matches the title, subtitle and author on KDP exactly.',
    profile.requiresProfessionalReview ? `  [ ] A licensed professional reviewed this ${profile.name.toLowerCase()} book.` : '',
    `  [ ] I have not created more than KDP's limit of 2 new titles per format this week.`,
    '',
    ...(failures.length ? ['Automated checks that FAILED (fix before uploading):', ...failures.map((f) => `  ✗ ${f}`), ''] : ['All automated checks passed.', '']),
    ...(warnings.length ? ['Warnings:', ...warnings.map((w) => `  ! ${w}`), ''] : []),
  ]
    .filter((l) => l !== '')
    .join('\n');

  const files: Record<string, Uint8Array> = {
    'book.pdf': interior.pdf,
    'cover.pdf': cover.pdf,
    'book.epub': epub.epub,
    'ebook-cover.jpg': ebookCover.jpeg,
    'kdp-metadata.txt': enc.encode(metadataSheet(book.meta, meta)),
    'ai-disclosure.json': enc.encode(JSON.stringify(disclosure, null, 2) + '\n'),
    'preflight.json': enc.encode(JSON.stringify({ ...checks, practice: !!input.practice, failures, warnings }, null, 2) + '\n'),
    'UPLOAD-CHECKLIST.txt': enc.encode(checklist + '\n'),
  };
  return { files, checks, pages: interior.pages, failures, warnings };
}

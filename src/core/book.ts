/**
 * The book model. Every stage of the pipeline reads and writes this shape, and every
 * exporter renders from it. It is plain JSON so a book can be saved, diffed, reviewed
 * and rebuilt without the model provider.
 *
 * The structure *enforces* the writing standard: a section is not free text, it is the
 * five layers from the brief (summary → intuition → formal detail → limits → takeaways),
 * and an equation cannot exist without its intuition, symbol list and worked example.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Provenance: who produced each piece of content. Feeds the KDP AI-disclosure checklist.

export const Provenance = z.enum([
  'ai-generated', // drafted by the model (KDP counts this as AI-generated even after human edits)
  'human-written', // typed by the user
  'code-drawn', // produced by a deterministic script (figures, tables from data)
  'third-party', // quoted/reproduced from a licensed source (must carry a credit)
]);
export type Provenance = z.infer<typeof Provenance>;

// ---------------------------------------------------------------------------
// Inline text
//
// Inline strings use a deliberately small markup, parsed by src/render/inline.ts:
//   **bold**  *italic*  $x^2$ (inline math)  [@refId] or [@refId, p. 12] (citation)
//   [[term]] (links to the glossary)  `code`
// Nothing else is interpreted; raw HTML is escaped, never passed through.

export const Inline = z.string();

// ---------------------------------------------------------------------------
// Blocks

export const Paragraph = z.object({ kind: z.literal('para'), text: Inline });

export const ListBlock = z.object({
  kind: z.literal('list'),
  ordered: z.boolean().default(false),
  items: z.array(Inline).min(1),
});

export const Callout = z.object({
  kind: z.literal('callout'),
  /**
   * simplification: we are knowingly simplifying (brief: "mark simplifications explicitly")
   * consensus / debate: how settled the claim is (build prompt: distinguish the two)
   * safety: required safety note from the domain profile
   */
  tone: z.enum(['simplification', 'consensus', 'debate', 'safety', 'example']),
  title: z.string().optional(),
  text: Inline,
});

export const Symbol = z.object({
  symbol: z.string(), // LaTeX
  meaning: Inline,
  unit: z.string(), // SI unit as text, e.g. "F (farad)" or "—" for dimensionless
});

export const Equation = z.object({
  kind: z.literal('equation'),
  id: z.string().regex(/^eq-[a-z0-9-]+$/),
  /** One plain-language sentence, shown before the equation. */
  intuition: Inline,
  latex: z.string(),
  where: z.array(Symbol).min(1),
  example: z.object({
    text: Inline,
    /** Pointer to the automated check, e.g. "tests/equations/test_rc.py::test_tau_example". */
    check: z.string(),
  }),
  /** Assumptions and where the equation stops being valid. */
  validity: Inline,
  /** Figure that shows what changes when a variable changes. */
  figure: z.string().optional(),
});

export const Figure = z.object({
  kind: z.literal('figure'),
  id: z.string().regex(/^fig-[a-z0-9-]+$/),
  /** Path (relative to the book file) of the light SVG; the dark one is the same path with `.dark.svg`. */
  src: z.string(),
  alt: z.string().min(10),
  /** Takeaway first. */
  caption: Inline,
  credit: z.string(),
  provenance: Provenance,
  /** Fraction of text-block width (0–1]. */
  width: z.number().min(0.2).max(1).default(1),
});

/**
 * A 3D structure (molecule, protein, DNA). The web book shows it in an interactive viewer;
 * print and EPUB show 2–3 rendered views plus a link (and, in print, a QR code) to the
 * interactive version. Shares figure numbering with `figure`.
 */
export const Model3D = z.object({
  kind: z.literal('model3d'),
  id: z.string().regex(/^fig-[a-z0-9-]+$/),
  /** Model file relative to the book (.json, .xyz, .pdb, .sdf, .mol); see src/core/molecule.ts. */
  src: z.string(),
  alt: z.string().min(10),
  caption: Inline,
  credit: z.string(),
  provenance: Provenance,
  /** 'to-scale': coordinates are real (draws a scale bar). 'schematic': shape only (says so on the image). */
  scale: z.enum(['to-scale', 'schematic']),
  scaleNote: z.string().optional(),
  /** Atom drawing size multiplier for the interactive viewer (use < 1 for crowded structures; match the stills). */
  atomScale: z.number().min(0.2).max(1.5).optional(),
  /** Pre-rendered stills (light SVG path; the dark one is `.dark.svg`) with the rotation that made them. */
  views: z.array(z.object({ src: z.string(), label: z.string(), yaw: z.number(), pitch: z.number(), /** what this still shows, if it differs from the figure's alt */ alt: z.string().optional() })).min(2).max(3),
  annotations: z.array(z.object({ type: z.literal('angle'), atoms: z.tuple([z.number().int(), z.number().int(), z.number().int()]), label: z.string() })).default([]),
  width: z.number().min(0.2).max(1).default(1),
});

export const Block = z.discriminatedUnion('kind', [Paragraph, ListBlock, Callout, Equation, Figure, Model3D]);
export type Block = z.infer<typeof Block>;
export type Equation = z.infer<typeof Equation>;
export type Figure = z.infer<typeof Figure>;
export type Model3D = z.infer<typeof Model3D>;

// ---------------------------------------------------------------------------
// Sections, chapters, book

export const Section = z.object({
  id: z.string().regex(/^sec-[a-z0-9-]+$/),
  title: z.string(),
  provenance: Provenance,
  layers: z.object({
    summary: z.array(Block).min(1),
    intuition: z.array(Block).min(1),
    formal: z.array(Block).default([]),
    limits: z.array(Block).min(1),
    takeaways: z.array(Inline).min(1),
  }),
});
export type Section = z.infer<typeof Section>;

export const Chapter = z.object({
  id: z.string().regex(/^ch-[a-z0-9-]+$/),
  title: z.string(),
  goals: z.array(Inline).min(1),
  sections: z.array(Section).min(1),
  summary: z.array(Inline).min(1),
  /** ids of equations repeated in the chapter-end "Key equations" box */
  keyEquations: z.array(z.string()).default([]),
  /** reference ids for "Further reading" */
  furtherReading: z.array(z.string()).default([]),
});
export type Chapter = z.infer<typeof Chapter>;

export const GlossaryEntry = z.object({ term: z.string(), definition: Inline });

export const BookMeta = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  authors: z.array(z.string()).min(1),
  profile: z.string(),
  citationStyle: z.string(),
  audience: z.string(),
  language: z.string().default('en'),
  date: z.string(),
  license: z.string(),
  /** Short statement printed on the copyright page, e.g. how AI was used. */
  colophon: Inline.optional(),
  /** Where the web edition will live; print and EPUB link 3D models here. */
  webUrl: z.string().url().regex(/^https:\/\/[^\s"'<>]+$/, 'must be an https:// address').optional(),
  /** Figure id to show on the front cover (default: the first figure or 3D model). */
  coverFigure: z.string().regex(/^fig-[a-z0-9-]+$/).optional(),
  /** Back-cover and store description (≤ 4000 characters for KDP; checked by src/kdp/metadata.ts). */
  description: z.string().optional(),
  /** Up to seven KDP keywords or short phrases (checked by src/kdp/metadata.ts). */
  keywords: z.array(z.string().min(1)).optional(),
  /** Up to three KDP categories, as the category path text (checked by src/kdp/metadata.ts). */
  categories: z.array(z.string()).optional(),
});
export type BookMeta = z.infer<typeof BookMeta>;

export const Book = z.object({
  meta: BookMeta,
  preface: z.array(Block).default([]),
  chapters: z.array(Chapter).min(1),
  glossary: z.array(GlossaryEntry).default([]),
  /** Path to the CSL-JSON bibliography, relative to the book file. */
  bibliography: z.string(),
});
export type Book = z.infer<typeof Book>;

// ---------------------------------------------------------------------------
// References: CSL-JSON (https://citationstyles.org) plus a verification record.

export const CslName = z
  .object({ family: z.string().optional(), given: z.string().optional(), literal: z.string().optional() })
  .refine((n) => n.family || n.literal, { message: 'A name needs a family name or a literal (organization) name.' });

export const Verification = z.object({
  status: z.enum(['verified', 'unverified', 'failed']),
  /** How it was checked. */
  method: z.enum(['crossref', 'openalex', 'pubmed', 'arxiv', 'publisher-page', 'standards-body', 'isbn']),
  checkedAt: z.string(),
  /** What was compared, e.g. "title + year + first author match Crossref record". */
  note: z.string(),
  /** Claims in the book this reference supports, as the text it was checked against. */
  supports: z.array(z.string()).default([]),
});

export const Reference = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    type: z.enum(['article-journal', 'book', 'chapter', 'paper-conference', 'webpage', 'standard', 'report', 'dataset']),
    title: z.string(),
    author: z.array(CslName).optional(),
    editor: z.array(CslName).optional(),
    /** Publication date; omit when the publisher does not state one (rendered "n.d."), and give `accessed` instead. */
    issued: z.object({ 'date-parts': z.array(z.array(z.number())) }).optional(),
    'container-title': z.string().optional(),
    publisher: z.string().optional(),
    'publisher-place': z.string().optional(),
    volume: z.string().optional(),
    issue: z.string().optional(),
    page: z.string().optional(),
    edition: z.string().optional(),
    DOI: z.string().optional(),
    /** PubMed ID, for medical and biological sources without a DOI. */
    PMID: z.string().regex(/^\d{1,9}$/).optional(),
    ISBN: z.string().optional(),
    URL: z.string().url().optional(),
    accessed: z.object({ 'date-parts': z.array(z.array(z.number())) }).optional(),
    license: z.string().optional(),
    verification: Verification,
  })
  .refine((r) => r.DOI || r.URL || r.ISBN || r.PMID, { message: 'A reference needs a DOI, PMID, URL or ISBN so it can be checked.' })
  .refine((r) => r.issued || r.accessed, { message: 'A reference needs a publication date or, for undated web documents, an access date.' });
export type Reference = z.infer<typeof Reference>;
export const Bibliography = z.array(Reference);

// ---------------------------------------------------------------------------
// Helpers

export function* allBlocks(book: Book): Generator<{ chapter: Chapter; section?: Section; block: Block }> {
  for (const chapter of book.chapters) {
    for (const section of chapter.sections) {
      const l = section.layers;
      for (const block of [...l.summary, ...l.intuition, ...l.formal, ...l.limits]) yield { chapter, section, block };
    }
  }
}

export function allInlineText(book: Book): string[] {
  const out: string[] = [];
  for (const { block } of allBlocks(book)) {
    if (block.kind === 'para' || block.kind === 'callout') out.push(block.text);
    if (block.kind === 'list') out.push(...block.items);
    if (block.kind === 'equation') out.push(block.intuition, block.example.text, block.validity, ...block.where.map((w) => w.meaning));
    if (block.kind === 'figure' || block.kind === 'model3d') out.push(block.caption);
  }
  for (const block of book.preface) {
    if (block.kind === 'para' || block.kind === 'callout') out.push(block.text);
    if (block.kind === 'list') out.push(...block.items);
  }
  for (const ch of book.chapters) {
    out.push(...ch.goals, ...ch.summary);
    for (const s of ch.sections) out.push(...s.layers.takeaways);
  }
  return out;
}

/** Every [@id] cited anywhere in the book. */
export function citedIds(book: Book): Set<string> {
  const ids = new Set<string>();
  const re = /\[@([a-z0-9-]+)(?:,[^\]]*)?\]/g;
  for (const t of allInlineText(book)) for (const m of t.matchAll(re)) ids.add(m[1]!);
  for (const ch of book.chapters) ch.furtherReading.forEach((id) => ids.add(id));
  return ids;
}

/** Glossary terms linked with [[term]] that have no glossary entry (compared case-insensitively). */
export function missingTerms(book: Book): string[] {
  const have = new Set(book.glossary.map((g) => g.term.toLowerCase()));
  const used = new Set<string>();
  for (const t of allInlineText(book)) for (const m of t.matchAll(/\[\[([^\]]+)\]\]/g)) used.add(m[1]!.toLowerCase());
  return [...used].filter((t) => !have.has(t));
}

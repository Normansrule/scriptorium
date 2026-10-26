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

// ---------------------------------------------------------------------------
// Learning blocks: theory turned into practice. Each is structured so it cannot be padded:
// a derivation is a list of steps with the one-line reason for each; a worked problem names
// its strategy before the algebra and ends with a check; an experiment states its prediction
// from the theory before the observation. Word counts are policed by src/core/concision.ts.

/** One step of a derivation or solution: the maths, and the one reason it follows. */
export const Step = z.object({
  /** LaTeX for this step's result (display maths). Optional in solutions that are pure reasoning. */
  latex: z.string().optional(),
  /** Why this step follows from the last: the law, substitution or move used. */
  why: Inline,
});

/** A step-by-step derivation that arrives at an equation in the book. */
export const Derivation = z.object({
  kind: z.literal('derivation'),
  id: z.string().regex(/^drv-[a-z0-9-]+$/),
  /** What is derived, as a goal: "Find the capacitor voltage while it charges." */
  goal: Inline,
  assumptions: z.array(Inline).min(1),
  steps: z.array(Step.extend({ latex: z.string() })).min(2).max(24),
  /** The equation it arrives at (an `eq-` id in the book), if any. */
  result: z.string().regex(/^eq-[a-z0-9-]+$/).optional(),
  /** Sanity checks on the result: units, limits, special cases. */
  check: Inline,
  /** Automated re-derivation, e.g. "tests/equations/test_rc_book.py::test_charging_derivation". */
  test: z.string(),
});

/** A worked problem: how to solve it, not only the answer. */
export const Problem = z.object({
  kind: z.literal('problem'),
  id: z.string().regex(/^prb-[a-z0-9-]+$/),
  level: z.enum(['core', 'stretch', 'challenge']),
  statement: Inline,
  given: z.array(Inline).min(1),
  find: Inline,
  /** The idea before the algebra, in one or two sentences. */
  strategy: Inline,
  steps: z.array(Step).min(1).max(16),
  answer: Inline,
  /** How to know the answer is right: units, size, a limiting case. */
  check: Inline,
  test: z.string(),
});

/** An experiment where theory meets data: predict, observe, explain. */
export const Experiment = z.object({
  kind: z.literal('experiment'),
  id: z.string().regex(/^exp-[a-z0-9-]+$/),
  /** hands-on: safe for a reader at home or in a teaching lab; demonstration: watch it; thought: reasoned only; data: real published measurements. */
  type: z.enum(['hands-on', 'demonstration', 'thought', 'data']),
  question: Inline,
  setup: z.array(Inline).min(1),
  procedure: z.array(Inline).min(1).max(12),
  /** What the theory predicts, before looking. */
  predict: Inline,
  /** What you see (or what the data show). */
  observe: Inline,
  /** Back to the theory: why it came out that way, and why it may differ. */
  explain: Inline,
  /** Required for every experiment, even thought experiments ("No equipment needed."). */
  safety: Inline,
  /** Real measurements with their source, for type "data". */
  data: z.object({ columns: z.array(z.string()).min(2), rows: z.array(z.array(z.union([z.number(), z.string()]))).min(1), source: Inline }).optional(),
});

/** A common wrong idea, why it is tempting, the correction, and a test that tells them apart. */
export const Misconception = z.object({
  kind: z.literal('misconception'),
  wrong: Inline,
  tempting: Inline,
  right: Inline,
  test: Inline,
});

/** Where the theory is used for real. */
export const Application = z.object({
  kind: z.literal('application'),
  title: z.string(),
  text: Inline,
  /** A worked number from practice, if there is one. */
  numbers: Inline.optional(),
});

const ParamName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,15}$/, 'a parameter name is a letter followed by letters, digits or _');
const ROLE = z.enum(['signal', 'accent', 'verified', 'external']);

/**
 * An explorable: the reader moves sliders and watches a plot and a few numbers respond. The web
 * edition runs it live (assets/viewer3d.js); print and the ebook show three stills (the first
 * slider at its low, default and high values), the numbers at the defaults, and what to notice.
 * Every expression uses the safe expression language in src/core/expr.ts (`x` is the plot's
 * horizontal variable; parameters by name), so the model can propose one without running code.
 */
export const Explore = z
  .object({
    kind: z.literal('explore'),
    id: z.string().regex(/^xpl-[a-z0-9-]+$/),
    title: z.string().min(3).max(90),
    /** What to try, as a question the sliders answer. */
    prompt: Inline,
    /** The equation it brings to life, if any. */
    equation: z.string().regex(/^eq-[a-z0-9-]+$/).optional(),
    params: z
      .array(
        z.object({
          name: ParamName,
          /** shown next to the slider: "Resistance R" */
          label: z.string().min(1).max(40),
          unit: z.string().max(12).default(''),
          min: z.number(),
          max: z.number(),
          step: z.number().positive(),
          value: z.number(),
          /** a logarithmic slider, for values that span decades */
          log: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(4),
    plot: z.object({
      x: z.object({ label: z.string(), from: z.number(), to: z.number(), log: z.boolean().default(false) }),
      y: z.object({ label: z.string(), from: z.number(), to: z.number(), log: z.boolean().default(false) }),
      series: z.array(z.object({ label: z.string().max(40), expr: z.string().max(300), role: ROLE.default('signal') })).min(1).max(3),
      /** horizontal reference levels, e.g. 63.2 % */
      levels: z.array(z.object({ y: z.number(), label: z.string().max(40) })).max(3).default([]),
      /** a "you are here" line: x given by an expression of the sliders (e.g. "r"), with a dot on each curve */
      marker: z.object({ x: z.string().max(120), label: z.string().max(40) }).optional(),
    }),
    /** Live numbers under the plot, e.g. the time constant. */
    readouts: z.array(z.object({ label: z.string().max(50), expr: z.string().max(300), unit: z.string().max(12).default(''), digits: z.number().int().min(0).max(6).default(2) })).max(4).default([]),
    /** Low and high values of the first slider for the printed still (default: halfway to each end). */
    stills: z.tuple([z.number(), z.number()]).optional(),
    /** What the reader should notice; printed under the stills. */
    notice: Inline,
    /** Re-computes the readouts at the default values, e.g. "tests/equations/test_rc_book.py::test_explore_charging". */
    test: z.string(),
  })
  .superRefine((b, ctx) => {
    const names = new Set<string>();
    for (const p of b.params) {
      if (p.name === 'x' || names.has(p.name)) ctx.addIssue({ code: 'custom', message: `Parameter "${p.name}" is reserved or repeated.` });
      names.add(p.name);
      if (!(p.min < p.max) || p.value < p.min || p.value > p.max) ctx.addIssue({ code: 'custom', message: `Parameter "${p.name}" needs min < max and a default between them.` });
      if (p.log && p.min <= 0) ctx.addIssue({ code: 'custom', message: `Parameter "${p.name}" is logarithmic, so its minimum must be above zero.` });
    }
    const first = b.params[0];
    if (b.stills && first && b.stills.some((v) => v < first.min || v > first.max)) ctx.addIssue({ code: 'custom', message: 'The still values must lie in the first slider\'s range.' });
    for (const axis of [b.plot.x, b.plot.y]) {
      if (!(axis.from < axis.to)) ctx.addIssue({ code: 'custom', message: `Axis "${axis.label}" needs from < to.` });
      if (axis.log && axis.from <= 0) ctx.addIssue({ code: 'custom', message: `Axis "${axis.label}" is logarithmic, so it must start above zero.` });
    }
  });

/** A one-question self-check with instant feedback: why each answer is right or wrong. */
export const Quiz = z
  .object({
    kind: z.literal('quiz'),
    id: z.string().regex(/^chk-[a-z0-9-]+$/),
    question: Inline,
    /** Two to five answers, exactly one correct; every answer explains itself, wrong ones name the slip. */
    options: z.array(z.object({ text: Inline, correct: z.boolean().default(false), why: Inline })).min(2).max(5),
  })
  .refine((q) => q.options.filter((o) => o.correct).length === 1, { message: 'A check needs exactly one correct answer.' });

export const Block = z.discriminatedUnion('kind', [Paragraph, ListBlock, Callout, Equation, Figure, Model3D, Derivation, Problem, Experiment, Misconception, Application, Explore, Quiz]);
export type Block = z.infer<typeof Block>;
export type Equation = z.infer<typeof Equation>;
export type Figure = z.infer<typeof Figure>;
export type Model3D = z.infer<typeof Model3D>;
export type Derivation = z.infer<typeof Derivation>;
export type Problem = z.infer<typeof Problem>;
export type Experiment = z.infer<typeof Experiment>;
export type Misconception = z.infer<typeof Misconception>;
export type Application = z.infer<typeof Application>;
export type Explore = z.infer<typeof Explore>;
export type Quiz = z.infer<typeof Quiz>;

/** End-of-chapter practice: graded, with an answer and a full worked solution (printed at the back). */
export const Exercise = z.object({
  id: z.string().regex(/^ex-[a-z0-9-]+$/),
  level: z.enum(['core', 'stretch', 'challenge']),
  prompt: Inline,
  answer: Inline,
  solution: z.array(Step).min(1).max(16),
  test: z.string(),
});
export type Exercise = z.infer<typeof Exercise>;

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
  /** One or two sentences that make the reader want the chapter: a question, a puzzle, a use. */
  hook: Inline.optional(),
  /** What the reader should already know, in plain words. */
  prerequisites: z.array(Inline).default([]),
  sections: z.array(Section).min(1),
  summary: z.array(Inline).min(1),
  /** ids of equations repeated in the chapter-end "Key equations" box */
  keyEquations: z.array(z.string()).default([]),
  /** reference ids for "Further reading" */
  furtherReading: z.array(z.string()).default([]),
  /** Practice at the chapter's end; solutions are printed at the back of the book. */
  exercises: z.array(Exercise).default([]),
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
  /** Colour of the book's chrome: chapter openers, headings, learning-block frames (src/core/bookstyle.ts). Never changes what a colour means in a figure. */
  style: z.enum(['classic', 'bookcloth', 'plate', 'window', 'lagoon', 'orchard']).optional(),
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

/** Every inline string a block carries (for citations, glossary links, readability and concision). */
export function blockTexts(b: Block): string[] {
  const steps = (xs: Array<{ why: string }>) => xs.map((x) => x.why);
  switch (b.kind) {
    case 'para':
    case 'callout':
      return [b.text];
    case 'list':
      return b.items;
    case 'equation':
      return [b.intuition, ...b.where.map((w) => w.meaning), b.example.text, b.validity];
    case 'figure':
    case 'model3d':
      return [b.caption];
    case 'derivation':
      return [b.goal, ...b.assumptions, ...steps(b.steps), b.check];
    case 'problem':
      return [b.statement, ...b.given, b.find, b.strategy, ...steps(b.steps), b.answer, b.check];
    case 'experiment':
      return [b.question, ...b.setup, ...b.procedure, b.predict, b.observe, b.explain, b.safety, ...(b.data ? [b.data.source] : [])];
    case 'misconception':
      return [b.wrong, b.tempting, b.right, b.test];
    case 'application':
      return [b.text, ...(b.numbers ? [b.numbers] : [])];
    case 'explore':
      return [b.prompt, b.notice];
    case 'quiz':
      return [b.question, ...b.options.flatMap((o) => [o.text, o.why])];
  }
}

export function exerciseTexts(e: Exercise): string[] {
  return [e.prompt, e.answer, ...e.solution.map((s) => s.why)];
}

export function allInlineText(book: Book): string[] {
  const out: string[] = [];
  for (const { block } of allBlocks(book)) out.push(...blockTexts(block));
  for (const block of book.preface) out.push(...blockTexts(block));
  for (const ch of book.chapters) {
    out.push(...ch.goals, ...ch.summary, ...(ch.hook ? [ch.hook] : []), ...ch.prerequisites);
    for (const s of ch.sections) out.push(...s.layers.takeaways);
    for (const e of ch.exercises) out.push(...exerciseTexts(e));
  }
  return out;
}

/** Every automated check the book points to, labelled the way the book numbers it. */
export function allChecks(book: Book, label: (kind: 'equation' | 'derivation' | 'problem' | 'exercise' | 'explore', id: string) => string): Array<{ label: string; test: string }> {
  const out: Array<{ label: string; test: string }> = [];
  for (const ch of book.chapters) {
    for (const s of ch.sections)
      for (const b of [...s.layers.summary, ...s.layers.intuition, ...s.layers.formal, ...s.layers.limits]) {
        if (b.kind === 'equation') out.push({ label: label('equation', b.id), test: b.example.check });
        if (b.kind === 'derivation') out.push({ label: label('derivation', b.id), test: b.test });
        if (b.kind === 'problem') out.push({ label: label('problem', b.id), test: b.test });
        if (b.kind === 'explore') out.push({ label: label('explore', b.id), test: b.test });
      }
    for (const e of ch.exercises) out.push({ label: label('exercise', e.id), test: e.test });
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

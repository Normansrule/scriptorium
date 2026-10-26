/**
 * The book the app is working on, wherever it came from (generated, a sample, or a project
 * file), plus validation and autosave. Everything the three steps — Write, Edit, Publish —
 * read and change lives here.
 */
import { describePath } from '../../src/core/issues.ts';
import { Bibliography, Book, citedIds, missingTerms, type Reference } from '../../src/core/book.ts';
import { Model } from '../../src/core/molecule.ts';
import type { PipelineState, ReportItem } from '../../src/core/pipeline.ts';
import { renderHtml } from '../../src/render/html.ts';
import { numberBook } from '../../src/render/numbering.ts';
import { renderTypst } from '../../src/render/typst.ts';

export interface Project {
  book: Book;
  refs: Reference[];
  /** figure file name (e.g. `tau.svg`, `tau.dark.svg`) → SVG text */
  figures: Record<string, string>;
  /** 3D models by the `src` path used in the book (e.g. `models/dna.json`) */
  models: Record<string, Model>;
  origin: 'generated' | 'sample' | 'opened';
  /** sample folder name, for samples */
  sampleDir?: string;
  /** the pipeline's verification report, for generated books */
  report?: ReportItem[];
  /** the book as it was before any edits, for "Undo all edits" */
  original?: Book;
}

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function fromPipeline(st: PipelineState): Project | null {
  if (!st.book) return null;
  const figures: Record<string, string> = {};
  for (const [id, svg] of Object.entries(st.figures)) {
    const name = id.replace(/^fig-/, '');
    figures[`${name}.svg`] = svg.light;
    figures[`${name}.dark.svg`] = svg.dark;
  }
  return { book: clone(st.book), refs: clone(st.verified), figures, models: clone(st.models), origin: 'generated', report: clone(st.report), original: clone(st.book) };
}

/** Files the exporters read, keyed by their path in the book (`figures/x.svg`, `models/x.json`). */
export function bookFiles(p: Project): Record<string, Uint8Array> {
  const enc = new TextEncoder();
  const out: Record<string, Uint8Array> = {};
  for (const [name, svg] of Object.entries(p.figures)) out[`figures/${name}`] = enc.encode(svg);
  for (const [path, m] of Object.entries(p.models)) out[path] = enc.encode(JSON.stringify(m));
  return out;
}

/**
 * Everything that would stop the book from building, in plain words. Empty means it builds.
 * Checks the schema, citations, glossary links, every equation (KaTeX for the web and EPUB,
 * the LaTeX-to-Typst converter for print) and that every figure file exists.
 */
export function problems(p: Project): string[] {
  const out: string[] = [];
  const parsed = Book.safeParse(p.book);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 6)) out.push(`${describePath(p.book, i.path as PropertyKey[])}: ${i.message}`);
    return out;
  }
  const book = parsed.data;
  const ids = new Set(p.refs.map((r) => r.id));
  const missing = [...citedIds(book)].filter((id) => !ids.has(id));
  if (missing.length) out.push(`Cites a source that is not in the bibliography: ${missing.map((m) => `[@${m}]`).join(', ')}. Only verified sources can be cited.`);
  const terms = missingTerms(book);
  if (terms.length) out.push(`Links to glossary terms that do not exist: ${terms.map((t) => `[[${t}]]`).join(', ')}. Remove the brackets or add the term to the glossary.`);
  for (const ch of book.chapters)
    for (const s of ch.sections)
      for (const blocks of [s.layers.summary, s.layers.intuition, s.layers.formal, s.layers.limits])
        for (const b of blocks) {
          const files = b.kind === 'figure' ? [b.src] : b.kind === 'model3d' ? b.views.map((v) => v.src) : [];
          for (const f of files) if (!p.figures[f.replace(/^figures\//, '')]) out.push(`${s.title}: figure file ${f} is missing.`);
        }
  if (out.length) return out;
  try {
    const numbering = numberBook(book);
    renderHtml(book, { numbering, bibliography: new Map(), refs: p.refs, figureBase: 'figures/' });
    renderTypst(book, { numbering, bibliography: new Map(), refs: p.refs });
  } catch (e) {
    out.push(String((e as Error).message ?? e));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project files ("Save project" / "Open project")

export function toFile(p: Project): string {
  return JSON.stringify({ format: 'scriptorium-project', version: 1, book: p.book, references: p.refs, figures: p.figures, models: p.models }, null, 1);
}

const FIGURE_NAME = /^[a-z0-9-]+(\.dark)?\.svg$/;
const MODEL_PATH = /^models\/[a-z0-9-]+\.json$/;

/** Parse an untrusted project file. Throws a plain-language error on anything unexpected. */
export function fromFile(text: string, sanitizeSvg?: (svg: string) => string): Project {
  let raw: { book?: unknown; references?: unknown; figures?: unknown; models?: unknown };
  try {
    raw = JSON.parse(text) as typeof raw;
  } catch {
    throw new Error('That file is not a Scriptorium project (it is not valid JSON).');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('That file is not a Scriptorium project.');
  const book = Book.safeParse(raw.book);
  if (!book.success) throw new Error(`The book in that file does not pass the schema: ${describePath(raw.book, (book.error.issues[0]?.path ?? []) as PropertyKey[])}: ${book.error.issues[0]?.message}`);
  const refs = Bibliography.safeParse(raw.references ?? []);
  if (!refs.success) throw new Error(`The references in that file do not pass the schema: ${refs.error.issues[0]?.message}`);
  const figures: Record<string, string> = {};
  for (const [name, svg] of Object.entries((raw.figures ?? {}) as Record<string, unknown>)) {
    if (!FIGURE_NAME.test(name) || typeof svg !== 'string' || !svg.trimStart().startsWith('<svg') || svg.length > 2_000_000) throw new Error(`Refusing unexpected figure "${name}".`);
    if (/<script|[\s"'/;]on[a-z]+\s*=|javascript:|&#|<foreignObject|<animate|<set\b|<iframe|<object|<embed/i.test(svg)) throw new Error(`Figure "${name}" contains active content; refusing to load it.`);
    // In the app, figures are also run through DOMPurify's SVG profile (see main.ts).
    figures[name] = sanitizeSvg ? sanitizeSvg(svg) : svg;
  }
  const models: Record<string, Model> = {};
  for (const [path, m] of Object.entries((raw.models ?? {}) as Record<string, unknown>)) {
    if (!MODEL_PATH.test(path)) throw new Error(`Refusing unexpected model path "${path}".`);
    models[path] = Model.parse(m);
  }
  return { book: book.data, refs: refs.data, figures, models, origin: 'opened', original: clone(book.data) };
}

// ---------------------------------------------------------------------------
// Autosave: the current book stays on this device so closing the app loses nothing.

const AUTOSAVE = 'scriptorium.currentProject';

export function autosave(p: Project | null): 'saved' | 'cleared' | 'too-large' | 'unavailable' {
  try {
    if (!p || p.origin === 'sample') {
      localStorage.removeItem(AUTOSAVE);
      return 'cleared';
    }
    const text = JSON.stringify({ ...JSON.parse(toFile(p)), origin: p.origin, report: p.report, original: p.original });
    if (text.length > 4_500_000) {
      localStorage.removeItem(AUTOSAVE); // never leave an older version to be restored by mistake
      return 'too-large';
    }
    localStorage.setItem(AUTOSAVE, text);
    return 'saved';
  } catch {
    return 'unavailable';
  }
}

export function restore(sanitizeSvg?: (svg: string) => string): Project | null {
  try {
    const text = localStorage.getItem(AUTOSAVE);
    if (!text) return null;
    const p = fromFile(text, sanitizeSvg);
    const extra = JSON.parse(text) as { origin?: Project['origin']; report?: ReportItem[]; original?: unknown };
    const original = Book.safeParse(extra.original);
    return { ...p, origin: extra.origin === 'generated' ? 'generated' : 'opened', report: Array.isArray(extra.report) ? extra.report : undefined, original: original.success ? original.data : p.original };
  } catch {
    return null;
  }
}

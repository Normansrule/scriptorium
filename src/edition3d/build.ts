/**
 * Build the 3D Edition's files from a book, the same way in Node (command line) and the app:
 *
 *   book3d.json           manifest (src/edition3d/manifest.ts)
 *   pages/p001.jpg …      every page of the 2D Edition, typeset exactly as in print
 *   figures/<id>.jpg      figures that lift off the page, as images
 *   models/<id>.json      3D models for figures that become the book's own model
 *
 * Pages come from the same Typst source as the print interior (same layout, same gutter), with
 * invisible anchors added so each figure's place on its page is known. The anchors take no space;
 * the page count is checked against the interior to prove it.
 */
import type { Book, Reference } from '../core/book.ts';
import type { Model } from '../core/molecule.ts';
import { roles } from '../core/style.ts';
import { parseInline, type InlineToken } from '../render/inline.ts';
import { buildDisclosure } from '../disclosure/ai-disclosure.ts';
import { formatBibliography, type CslAssets } from '../render/cite.ts';
import { numberBook, resolveRefs, type Numbering } from '../render/numbering.ts';
import { latexToText } from '../render/latex-text.ts';
import { ANCHOR_LABEL, renderTypst, type TypstLayout } from '../render/typst.ts';
import { cleanTypstSvg } from '../export/cover.ts';
import type { EncodeJpeg, Rasterize, TypstEngine } from '../export/engine.ts';
import { buildInterior } from '../export/pdf.ts';
import { effective, figuresOf, planBook } from './convert.ts';
import { Book3D, type Figure3D, type Plan3D, type Rect } from './manifest.ts';
import { splitPages } from './pages.ts';

export interface Edition3DInput {
  book: Book;
  refs: Reference[];
  /** book files by path relative to the book (`figures/x.svg`) */
  files: Record<string, Uint8Array>;
  /** parsed 3D models by their `src` path in the book */
  models: Record<string, Model>;
  csl: CslAssets;
  /** the author's decisions (plan3d.json); proposals are made fresh and merged with it */
  plan?: Plan3D;
  layout?: TypstLayout;
  /** relative link to the 2D web edition, for the reduced-motion fallback */
  webEdition?: string;
  /** page images: pixels per point (2 → 864 × 1296 px for a 6 × 9 in page) */
  pageScale?: number;
}

export interface Edition3DDeps {
  engine: TypstEngine;
  rasterize: Rasterize;
  encodeJpeg: EncodeJpeg;
  onStep?: (message: string) => void;
}

export interface Edition3DResult {
  files: Record<string, Uint8Array>;
  manifest: Book3D;
  plan: Plan3D;
  warnings: string[];
}

interface Anchor {
  id: string;
  edge: 'start' | 'end';
  page: number;
  x: number;
  y: number;
}

const enc = new TextEncoder();
const PT_PER_IN = 72;

/** Caption text for the viewer: citations become their numbers ([1, §14.2]), markup is dropped. */
function captionText(src: string, numbering: Numbering): string {
  const cite = numbering.cite;
  const walk = (tokens: InlineToken[]): string =>
    tokens
      .map((k) => {
        switch (k.t) {
          case 'bold':
          case 'italic':
            return walk(k.v);
          case 'cite': {
            const n = cite.get(k.id);
            return n ? `[${n}${k.locator ? `, ${k.locator}` : ''}]` : '';
          }
          case 'math':
            return latexToText(k.v);
          default:
            return k.v;
        }
      })
      .join('');
  return resolveRefs(walk(parseInline(src)), numbering).replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

function isAnchor(v: unknown): v is Anchor {
  const a = v as Anchor;
  return !!a && typeof a.id === 'string' && (a.edge === 'start' || a.edge === 'end') && Number.isInteger(a.page) && Number.isFinite(a.x) && Number.isFinite(a.y);
}

/** Figure rectangles on their pages: top-left from the start anchor, height from the end anchor. */
export function figureRects(anchors: unknown[], widths: Map<string, number>, textWidthPt: number): Map<string, { page: number; rect: Rect }> {
  const out = new Map<string, { page: number; rect: Rect }>();
  const starts = new Map<string, Anchor>();
  for (const a of anchors.filter(isAnchor)) {
    if (a.edge === 'start') starts.set(a.id, a);
    else {
      const s = starts.get(a.id);
      if (!s || s.page !== a.page || a.y <= s.y) continue; // a figure split across pages has no single rectangle
      out.set(a.id, { page: s.page, rect: { x: s.x, y: s.y, w: (widths.get(a.id) ?? 1) * textWidthPt, h: a.y - s.y } });
    }
  }
  return out;
}

export async function buildEdition3D(input: Edition3DInput, deps: Edition3DDeps): Promise<Edition3DResult> {
  const { book, refs } = input;
  const step = deps.onStep ?? (() => undefined);
  const scale = input.pageScale ?? 2;
  if (!deps.engine.query) throw new Error('This Typst engine cannot report figure positions.');
  const numbering = numberBook(book);
  const order = [...numbering.cite.keys()];
  const disclosure = buildDisclosure(book, { figureScriptsByAi: true });
  const ctx = {
    numbering,
    bibliography: formatBibliography(refs, order, input.csl, 'text'),
    refs,
    disclosure: { text: disclosure.text.answer, images: disclosure.images.answer, translations: disclosure.translations.answer },
    webUrl: book.meta.webUrl,
  };

  step('Typesetting the pages…');
  const interior = await buildInterior(book, ctx, deps.engine, input.layout);
  const source = renderTypst(book, { ...ctx, anchors: true }, interior.layout);
  const pages = splitPages(await deps.engine.svg(source));
  const anchors = await deps.engine.query(source, ANCHOR_LABEL);
  const warnings: string[] = [];
  if (pages.length !== interior.pages) throw new Error(`The 3D Edition has ${pages.length} pages but the print interior has ${interior.pages}; the figure anchors changed the layout.`);

  const files: Record<string, Uint8Array> = {};
  const pagePaths: string[] = [];
  for (const [i, p] of pages.entries()) {
    step(`Rendering page ${i + 1} of ${pages.length}…`);
    const w = Math.round(p.width * scale);
    const h = Math.round(p.height * scale);
    const rgba = await deps.rasterize(cleanTypstSvg(p.svg), w, h);
    const path = `pages/p${String(i + 1).padStart(3, '0')}.jpg`;
    files[path] = await deps.encodeJpeg(rgba, w, h, 88);
    pagePaths.push(path);
  }

  const lay = interior.layout;
  const textWidth = (lay.trimWidthIn - lay.insideIn - lay.outsideIn) * PT_PER_IN;
  const figs = figuresOf(book);
  const rects = figureRects(anchors, new Map(figs.map((f) => [f.id, f.width])), textWidth);
  const plan = planBook(book, input.plan);
  const figures: Figure3D[] = [];
  for (const fig of figs) {
    const where = rects.get(fig.id);
    if (!where) {
      warnings.push(`${fig.id}: could not find it on a page, so it stays flat.`);
      continue;
    }
    const entry = plan.entries.find((e) => e.id === fig.id)!;
    let treatment = effective(entry);
    let asset: string | undefined;
    if (treatment.mode === 'model') {
      const model = fig.kind === 'model3d' ? input.models[fig.src] : undefined;
      if (model) {
        asset = `models/${fig.id.replace(/^fig-/, '')}.json`;
        files[asset] = enc.encode(JSON.stringify(model));
      } else {
        warnings.push(`${fig.id}: no model data, so it lifts as a card instead.`);
        treatment = { mode: 'lift' };
      }
    }
    if (treatment.mode === 'lift') {
      const src = fig.kind === 'figure' ? fig.src : fig.views[0]!.src;
      const svg = input.files[src];
      if (svg) {
        step(`Preparing ${fig.id}…`);
        const text = new TextDecoder().decode(svg);
        const vb = /viewBox="[\d.\s-]*?([\d.]+)\s+([\d.]+)"/.exec(text);
        const ratio = vb ? Number(vb[2]) / Number(vb[1]) : where.rect.h / where.rect.w;
        const w = 1600;
        const h = Math.max(8, Math.round(w * ratio));
        asset = `figures/${fig.id.replace(/^fig-/, '')}.jpg`;
        files[asset] = await deps.encodeJpeg(await deps.rasterize(text, w, h), w, h, 90);
      } else {
        warnings.push(`${fig.id}: figure file ${src} is missing, so it stays flat.`);
        treatment = { mode: 'flat' };
      }
    }
    figures.push({
      id: fig.id,
      number: numbering.figure.get(fig.id) ?? '',
      page: where.page,
      rect: where.rect,
      alt: fig.alt,
      caption: captionText(fig.caption, numbering),
      credit: captionText(fig.credit, numbering),
      treatment,
      asset,
      ...(fig.kind === 'model3d' ? { atomScale: fig.atomScale, scale: fig.scale } : {}),
    });
  }

  const manifest = Book3D.parse({
    format: 'scriptorium-3d',
    version: 1,
    title: book.meta.title,
    subtitle: book.meta.subtitle,
    authors: book.meta.authors,
    page: { width: pages[0]!.width, height: pages[0]!.height },
    pages: pagePaths,
    pageScale: scale,
    figures,
    webEdition: input.webEdition,
    style: book.meta.style,
    cloth: roles.signal.light,
    disclosure: { text: disclosure.text.answer, images: disclosure.images.answer },
  });
  files['book3d.json'] = enc.encode(JSON.stringify(manifest, null, 1));
  return { files, manifest, plan, warnings };
}

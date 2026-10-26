/**
 * The 2D → 3D converter. For every figure in a book it proposes a treatment for the 3D Edition
 * (see Treatment in manifest.ts) with a plain-words reason, then merges the author's decisions
 * from plan3d.json. Scenes (new 3D geometry standing in for a figure) only apply once a person
 * approves them; lifting a 2D figure off the page and showing the book's own 3D model are
 * mechanical and apply by default.
 *
 * The proposal is deterministic and explainable on purpose: an author can read why a figure was
 * picked, and the same book always gets the same plan.
 */
import type { Block, Book } from '../core/book.ts';
import { stripMarkup } from '../core/readability.ts';
import { KITS, kitById, type KitInfo } from './kits.ts';
import { Plan3D, type PlanEntry, type Treatment } from './manifest.ts';

type FigureLike = Extract<Block, { kind: 'figure' | 'model3d' }>;

export function figuresOf(book: Book): FigureLike[] {
  const out: FigureLike[] = [];
  const visit = (blocks: Block[]) => {
    for (const b of blocks) if (b.kind === 'figure' || b.kind === 'model3d') out.push(b);
  };
  visit(book.preface);
  for (const ch of book.chapters)
    for (const s of ch.sections) for (const blocks of [s.layers.summary, s.layers.intuition, s.layers.formal, s.layers.limits]) visit(blocks);
  return out;
}

const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9-]+/g, ' ')} `;
const has = (hay: string, phrase: string) => hay.includes(` ${phrase} `);

/** A figure that plots data stays the author's chart: a scene shows a thing, not a measurement. */
export const DATA_WORDS = ['plot', 'plots', 'graph', 'chart', 'curve', 'curves', 'histogram', 'axis', 'axes'];

/** A kit title inside a sentence: "an RC charging circuit", "a parallel-plate capacitor", "a MOSFET". */
export function inSentence(title: string): string {
  const acronym = /^[A-Z]{2,}/.test(title);
  const t = acronym ? title : title.charAt(0).toLowerCase() + title.slice(1);
  // "an" before a vowel sound; of the acronyms, "RC" is read letter by letter ("ar-see"), "MOSFET" as a word
  return `${/^(RC|[aeiou])/i.test(t) ? 'an' : 'a'} ${t}`;
}

/**
 * How strongly a kit fits a figure, 0–1, from the figure's own words (alt text and caption).
 *
 * The trade-off: a scene replaces the author's figure with generic geometry, so a false positive
 * costs more than a miss (the figure still lifts off the page as a card). Hence: no match → 0,
 * any veto word → 0, and confidence grows with distinct keyword matches, saturating at three.
 */
export function scoreForScene(figureText: string, kit: KitInfo): number {
  const hay = words(figureText);
  if ([...DATA_WORDS, ...(kit.notWhen ?? [])].some((w) => has(hay, w))) return 0;
  const hits = kit.keywords.filter((k) => has(hay, k)).length;
  return Math.min(1, hits / 3);
}

/** Below this, a kit is not proposed at all. */
export const SCENE_THRESHOLD = 0.34;

export function propose(fig: FigureLike): PlanEntry {
  if (fig.kind === 'model3d') {
    return { id: fig.id, proposed: { mode: 'model' }, reason: 'This figure already has 3D data (a model from cited coordinates), so it becomes that model.', score: 1, approved: true };
  }
  const text = `${fig.alt} ${stripMarkup(fig.caption)}`;
  let best: { kit: KitInfo; score: number } | null = null;
  for (const kit of KITS) {
    const score = scoreForScene(text, kit);
    if (score >= SCENE_THRESHOLD && (!best || score > best.score)) best = { kit, score };
  }
  if (best) {
    return {
      id: fig.id,
      proposed: { mode: 'scene', kit: best.kit.id },
      reason: `The figure describes ${inSentence(best.kit.title)}; the "${best.kit.id}" scene shows ${best.kit.shows.charAt(0).toLowerCase()}${best.kit.shows.slice(1)} Needs your approval.`,
      score: best.score,
      approved: false,
    };
  }
  return { id: fig.id, proposed: { mode: 'lift' }, reason: 'A 2D figure: it lifts off the page as a card you can tilt and bring close. No scene kit matches its subject.', score: 0.2, approved: true };
}

/** Proposals for the whole book, keeping the author's earlier decisions where the figure still exists. */
export function planBook(book: Book, previous?: Plan3D): Plan3D {
  const before = new Map((previous?.entries ?? []).map((e) => [e.id, e]));
  const entries = figuresOf(book).map((fig) => {
    const fresh = propose(fig);
    const old = before.get(fig.id);
    // Keep a decision only if it was made about the same proposal.
    return old && JSON.stringify(old.proposed) === JSON.stringify(fresh.proposed) ? { ...fresh, approved: old.approved, chosen: old.chosen } : fresh;
  });
  return Plan3D.parse({ format: 'scriptorium-plan3d', version: 1, entries });
}

/** The treatment that actually applies: the author's choice, else an approved proposal, else a lift. */
export function effective(e: PlanEntry): Treatment {
  if (e.chosen) return validTreatment(e.chosen);
  if (e.approved) return validTreatment(e.proposed);
  return { mode: 'lift' };
}

function validTreatment(t: Treatment): Treatment {
  if (t.mode === 'scene' && !kitById(t.kit)) return { mode: 'lift' };
  return t;
}

/**
 * Concision: find words that do no work. A learning book earns its length with explanation,
 * worked maths and pictures, not with throat-clearing, so every finding here is a suggestion
 * with a concrete fix, and the book-level numbers say how much of the book is prose versus
 * things that teach by showing (figures, derivations, worked problems, experiments).
 *
 * Pure text processing: runs in Node, the app and the pipeline alike.
 */
import { allBlocks, blockTexts, exerciseTexts, type Block, type Book } from './book.ts';
import { stripMarkup } from './readability.ts';

export type Rule = 'filler' | 'intensifier' | 'hedge-stack' | 'long-sentence' | 'long-paragraph' | 'wall-of-text' | 'repeat';

export interface Finding {
  /** "sec-charging", "ch-time exercises", … */
  where: string;
  rule: Rule;
  /** the words in question (or the start of the passage) */
  text: string;
  fix: string;
}

export interface ConcisionReport {
  findings: Finding[];
  /** words of running prose (paragraphs, lists, callouts) */
  proseWords: number;
  /** figures, 3D models, derivations, worked problems, experiments, explorables */
  visuals: number;
  wordsPerVisual: number;
}

/** Limits, chosen so a reader never meets a wall of text. */
export const LIMITS = {
  sentenceWords: 32,
  paragraphWords: 110,
  /** prose words in one section with nothing that shows (figure, equation, derivation, problem, list…) */
  wallWords: 350,
  /** book-level target: words of prose per teaching visual */
  wordsPerVisual: 300,
};

/** Phrases that can go, with what to write instead ('' = delete). Matched as whole words, case-insensitively. */
export const FILLER: Array<[string, string]> = [
  ['it is important to note that', ''],
  ['it should be noted that', ''],
  ['it is worth noting that', ''],
  ['it goes without saying that', ''],
  ['needless to say', ''],
  ['as we can see', ''],
  ['it can be seen that', ''],
  ['let us take a closer look at', 'look at'],
  ["let's take a closer look at", 'look at'],
  ['in order to', 'to'],
  ['due to the fact that', 'because'],
  ['owing to the fact that', 'because'],
  ['in spite of the fact that', 'although'],
  ['the reason why is that', 'because'],
  ['at this point in time', 'now'],
  ['in the event that', 'if'],
  ['for the purpose of', 'to'],
  ['with regard to', 'about'],
  ['with respect to', 'about'],
  ['in terms of', ''],
  ['a large number of', 'many'],
  ['a great deal of', 'much'],
  ['a variety of', 'several'],
  ['is able to', 'can'],
  ['are able to', 'can'],
  ['has the ability to', 'can'],
  ['prior to', 'before'],
  ['subsequent to', 'after'],
  ['in close proximity to', 'near'],
  ['each and every', 'every'],
  ['first and foremost', 'first'],
  ['plays a crucial role in', 'matters for'],
  ['plays an important role in', 'matters for'],
  ['basically', ''],
  ['essentially', ''],
  ['simply put', ''],
  ['delve into', 'look at'],
];

const INTENSIFIERS = ['very', 'really', 'extremely', 'incredibly', 'truly', 'quite'];
const HEDGES = ['may', 'might', 'could', 'possibly', 'perhaps', 'somewhat', 'arguably', 'potentially', 'probably'];

const words = (t: string) => t.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z(])/).map((x) => x.trim()).filter(Boolean);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrase = (p: string) => new RegExp(`(^|[^A-Za-z])${escapeRe(p)}(?=[^A-Za-z]|$)`, 'i');

/** Findings for one piece of text (inline markup allowed: maths counts as one word, citations as none). */
export function lintText(raw: string, where: string): Finding[] {
  const text = stripMarkup(raw);
  const out: Finding[] = [];
  for (const [p, fix] of FILLER) if (phrase(p).test(text)) out.push({ where, rule: 'filler', text: p, fix: fix ? `write “${fix}”` : 'delete it' });
  for (const s of sentences(text)) {
    const w = words(s);
    if (w.length > LIMITS.sentenceWords) out.push({ where, rule: 'long-sentence', text: `${w.slice(0, 8).join(' ')}…`, fix: `split this ${w.length}-word sentence (aim for under ${LIMITS.sentenceWords})` });
    const lower = w.map((x) => x.toLowerCase().replace(/[^a-z]/g, ''));
    const hedges = lower.filter((x) => HEDGES.includes(x));
    if (hedges.length >= 2) out.push({ where, rule: 'hedge-stack', text: hedges.join(' … '), fix: 'keep one hedge, or say how sure we are and why (a “consensus” or “debate” callout)' });
    for (const x of lower) if (INTENSIFIERS.includes(x)) out.push({ where, rule: 'intensifier', text: x, fix: 'delete it, or replace it with a number' });
  }
  return out;
}

const SHOWS = new Set<Block['kind']>(['figure', 'model3d', 'equation', 'derivation', 'problem', 'experiment', 'explore', 'list']);
const VISUAL = new Set<Block['kind']>(['figure', 'model3d', 'derivation', 'problem', 'experiment', 'explore']);
const PROSE = new Set<Block['kind']>(['para', 'list', 'callout']);

export function lintBook(book: Book): ConcisionReport {
  const findings: Finding[] = [];
  let proseWords = 0;
  let visuals = 0;
  const bySection = new Map<string, { prose: number; shows: boolean; seen: Set<string> }>();
  for (const { chapter, section, block } of allBlocks(book)) {
    const where = section?.id ?? chapter.id;
    const sec = bySection.get(where) ?? { prose: 0, shows: false, seen: new Set<string>() };
    bySection.set(where, sec);
    if (VISUAL.has(block.kind)) visuals++;
    if (SHOWS.has(block.kind)) sec.shows = true;
    for (const t of blockTexts(block)) {
      findings.push(...lintText(t, where));
      const n = words(stripMarkup(t)).length;
      if (PROSE.has(block.kind)) {
        proseWords += n;
        sec.prose += n;
      }
      if (block.kind === 'para' && n > LIMITS.paragraphWords) findings.push({ where, rule: 'long-paragraph', text: `${words(stripMarkup(t)).slice(0, 8).join(' ')}…`, fix: `${n} words: split it, or show it as a list, figure or worked example` });
      for (const s of sentences(stripMarkup(t))) {
        const key = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        if (key.split(' ').length < 6) continue;
        if (sec.seen.has(key)) findings.push({ where, rule: 'repeat', text: `${s.slice(0, 60)}…`, fix: 'this sentence appears twice in the section; keep the clearer place' });
        sec.seen.add(key);
      }
    }
  }
  for (const [where, sec] of bySection)
    if (sec.prose > LIMITS.wallWords && !sec.shows) findings.push({ where, rule: 'wall-of-text', text: `${sec.prose} words`, fix: 'nothing here shows the idea: add a figure, a derivation or a worked problem, or cut' });
  for (const ch of book.chapters) for (const e of ch.exercises) for (const t of exerciseTexts(e)) findings.push(...lintText(t, `${ch.id} exercises`));
  return { findings, proseWords, visuals, wordsPerVisual: visuals ? Math.round(proseWords / visuals) : proseWords };
}

/** One line for the command line and the app: counts per rule, and the density number. */
export function concisionSummary(r: ConcisionReport): string {
  const counts = new Map<Rule, number>();
  for (const f of r.findings) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
  const parts = [...counts].map(([k, v]) => `${v} ${k.replace('-', ' ')}`);
  const density = `${r.wordsPerVisual} words of prose per figure, derivation, problem, experiment or explorable (target ≤ ${LIMITS.wordsPerVisual})`;
  return `${r.findings.length ? `${r.findings.length} places to tighten (${parts.join(', ')})` : 'No padding found'}; ${density}.`;
}

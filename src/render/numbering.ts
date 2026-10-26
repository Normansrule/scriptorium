/**
 * Numbers figures, equations and citations in reading order, so the web book and the
 * print book use identical labels: Figure 2.3, Eq. (2.1), [4].
 *
 * Citation numbers follow IEEE practice: the order in which a source is first cited.
 * Sources that appear only under "Further reading" are numbered after the cited ones.
 */
import { blockTexts, exerciseTexts, type Book } from '../core/book.ts';
import { parseInline, type InlineToken } from './inline.ts';

export interface Numbering {
  figure: Map<string, string>;
  equation: Map<string, string>;
  /** derivations, worked problems, experiments and exercises: "2.1" within each chapter */
  derivation: Map<string, string>;
  problem: Map<string, string>;
  experiment: Map<string, string>;
  exercise: Map<string, string>;
  /** reference id → citation number, in bibliography order */
  cite: Map<string, number>;
}

function citesIn(tokens: InlineToken[], add: (id: string) => void): void {
  for (const t of tokens) {
    if (t.t === 'cite') add(t.id);
    if (t.t === 'bold' || t.t === 'italic') citesIn(t.v, add);
  }
}

export function numberBook(book: Book): Numbering {
  const figure = new Map<string, string>();
  const equation = new Map<string, string>();
  const derivation = new Map<string, string>();
  const problem = new Map<string, string>();
  const experiment = new Map<string, string>();
  const exercise = new Map<string, string>();
  const cite = new Map<string, number>();
  const addCite = (id: string) => {
    if (!cite.has(id)) cite.set(id, cite.size + 1);
  };
  const scan = (texts: string[]) => texts.forEach((t) => citesIn(parseInline(t), addCite));

  for (const b of book.preface) scan(blockTexts(b));
  book.chapters.forEach((ch, ci) => {
    let f = 0;
    let e = 0;
    const n = { derivation: 0, problem: 0, experiment: 0 };
    scan(ch.goals);
    if (ch.hook) scan([ch.hook]);
    scan(ch.prerequisites);
    for (const s of ch.sections) {
      const l = s.layers;
      for (const b of [...l.summary, ...l.intuition, ...l.formal, ...l.limits]) {
        if (b.kind === 'figure' || b.kind === 'model3d') figure.set(b.id, `${ci + 1}.${++f}`);
        if (b.kind === 'equation') equation.set(b.id, `${ci + 1}.${++e}`);
        if (b.kind === 'derivation') derivation.set(b.id, `${ci + 1}.${++n.derivation}`);
        if (b.kind === 'problem') problem.set(b.id, `${ci + 1}.${++n.problem}`);
        if (b.kind === 'experiment') experiment.set(b.id, `${ci + 1}.${++n.experiment}`);
        scan(blockTexts(b));
      }
      scan(l.takeaways);
    }
    scan(ch.summary);
    ch.exercises.forEach((x, i) => {
      exercise.set(x.id, `${ci + 1}.${i + 1}`);
      scan(exerciseTexts(x));
    });
  });
  for (const ch of book.chapters) ch.furtherReading.forEach(addCite);
  return { figure, equation, derivation, problem, experiment, exercise, cite };
}

/** Replace "Eq. (eq-id)" and "Figure fig-id" references in plain strings with their numbers. */
export function resolveRefs(text: string, n: Numbering): string {
  return text
    .replace(/\b(eq-[a-z0-9-]+)\b/g, (m) => n.equation.get(m) ?? m)
    .replace(/\b(fig-[a-z0-9-]+)\b/g, (m) => n.figure.get(m) ?? m)
    .replace(/\b(drv-[a-z0-9-]+)\b/g, (m) => n.derivation.get(m) ?? m)
    .replace(/\b(prb-[a-z0-9-]+)\b/g, (m) => n.problem.get(m) ?? m)
    .replace(/\b(exp-[a-z0-9-]+)\b/g, (m) => n.experiment.get(m) ?? m);
}

/** How the book names each automated check: "Eq. (2.1)", "Derivation 2.1", "Problem 2.1", "Exercise 2.1". */
export function checkLabel(n: Numbering): (kind: 'equation' | 'derivation' | 'problem' | 'exercise', id: string) => string {
  return (kind, id) =>
    kind === 'equation' ? `Eq. (${n.equation.get(id)})` : kind === 'derivation' ? `Derivation ${n.derivation.get(id)}` : kind === 'problem' ? `Problem ${n.problem.get(id)}` : `Exercise ${n.exercise.get(id)}`;
}

/**
 * Numbers figures, equations and citations in reading order, so the web book and the
 * print book use identical labels: Figure 2.3, Eq. (2.1), [4].
 *
 * Citation numbers follow IEEE practice: the order in which a source is first cited.
 * Sources that appear only under "Further reading" are numbered after the cited ones.
 */
import type { Block, Book } from '../core/book.ts';
import { parseInline, type InlineToken } from './inline.ts';

export interface Numbering {
  figure: Map<string, string>;
  equation: Map<string, string>;
  /** reference id → citation number, in bibliography order */
  cite: Map<string, number>;
}

function citesIn(tokens: InlineToken[], add: (id: string) => void): void {
  for (const t of tokens) {
    if (t.t === 'cite') add(t.id);
    if (t.t === 'bold' || t.t === 'italic') citesIn(t.v, add);
  }
}

function blockTexts(b: Block): string[] {
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
  }
}

export function numberBook(book: Book): Numbering {
  const figure = new Map<string, string>();
  const equation = new Map<string, string>();
  const cite = new Map<string, number>();
  const addCite = (id: string) => {
    if (!cite.has(id)) cite.set(id, cite.size + 1);
  };
  const scan = (texts: string[]) => texts.forEach((t) => citesIn(parseInline(t), addCite));

  for (const b of book.preface) scan(blockTexts(b));
  book.chapters.forEach((ch, ci) => {
    let f = 0;
    let e = 0;
    scan(ch.goals);
    for (const s of ch.sections) {
      const l = s.layers;
      for (const b of [...l.summary, ...l.intuition, ...l.formal, ...l.limits]) {
        if (b.kind === 'figure' || b.kind === 'model3d') figure.set(b.id, `${ci + 1}.${++f}`);
        if (b.kind === 'equation') equation.set(b.id, `${ci + 1}.${++e}`);
        scan(blockTexts(b));
      }
      scan(l.takeaways);
    }
    scan(ch.summary);
  });
  for (const ch of book.chapters) ch.furtherReading.forEach(addCite);
  return { figure, equation, cite };
}

/** Replace "Eq. (eq-id)" and "Figure fig-id" references in plain strings with their numbers. */
export function resolveRefs(text: string, n: Numbering): string {
  return text
    .replace(/\b(eq-[a-z0-9-]+)\b/g, (m) => n.equation.get(m) ?? m)
    .replace(/\b(fig-[a-z0-9-]+)\b/g, (m) => n.figure.get(m) ?? m);
}

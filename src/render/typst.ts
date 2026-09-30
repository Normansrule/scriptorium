/**
 * Print renderer: Book → Typst source, following docs/STYLE.md and the KDP interior rules
 * in src/kdp/specs.ts. Every text string goes through `escMarkup`; math goes through the
 * LaTeX→Typst converter; nothing from the book is ever emitted as raw Typst code.
 */
import type { Block, Book, Chapter, Equation, Reference, Section } from '../core/book.ts';
import { fonts, roles, surface } from '../core/style.ts';
import { parseInline, type InlineToken } from './inline.ts';
import { latexToTypst } from './latex-typst.ts';
import { resolveRefs, type Numbering } from './numbering.ts';

export interface TypstLayout {
  trimWidthIn: number;
  trimHeightIn: number;
  insideIn: number;
  outsideIn: number;
  topIn: number;
  bottomIn: number;
  /** Extend the page for bleed (only needed when art reaches the edge). */
  bleed: boolean;
}

export const DEFAULT_LAYOUT: TypstLayout = { trimWidthIn: 6, trimHeightIn: 9, insideIn: 0.75, outsideIn: 0.625, topIn: 0.75, bottomIn: 0.8, bleed: false };

/** Escape a plain string for Typst markup mode. */
export function escMarkup(s: string): string {
  return s.replace(/[\\#*_$@<>[\]`~=+\-/]/g, (c) => `\\${c}`);
}

/** Escape for a Typst string literal. */
export function escString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const light = (hex: string) => `rgb("${hex}")`;
export const TYPST_COLORS = {
  ink: light(surface.ink.light),
  muted: light(surface.muted.light),
  rule: light(surface.rule.light),
  panel: light(surface.panel.light),
  signal: light(roles.signal.light),
  accent: light(roles.accent.light),
  verified: light(roles.verified.light),
  external: light(roles.external.light),
};
const C = TYPST_COLORS;

export interface TypstContext {
  numbering: Numbering;
  bibliography: Map<string, string>; // id → formatted text
  refs: Reference[];
  disclosure?: { text: string; images: string; translations: string };
}

function inline(tokens: InlineToken[], ctx: TypstContext): string {
  return tokens
    .map((t) => {
      switch (t.t) {
        case 'text':
          return escMarkup(t.v);
        case 'bold':
          return `#strong[${inline(t.v, ctx)}]`;
        case 'italic':
          return `#emph[${inline(t.v, ctx)}]`;
        case 'code':
          return `#raw("${escString(t.v)}")`;
        case 'term':
          return `#emph[${escMarkup(t.v)}]`;
        case 'math':
          return `$${latexToTypst(t.v)}$`;
        case 'cite': {
          const n = ctx.numbering.cite.get(t.id);
          if (n === undefined) throw new Error(`Citation [@${t.id}] has no reference.`);
          const label = t.locator ? `${n}, ${t.locator}` : `${n}`;
          return `#link(<ref-${t.id}>)[\\[${escMarkup(label)}\\]]`;
        }
      }
    })
    .join('');
}

const md = (s: string, ctx: TypstContext) => inline(parseInline(resolveRefs(s, ctx.numbering)), ctx);

const CALLOUT: Record<string, { label: string; color: string }> = {
  simplification: { label: 'Simplification', color: C.signal },
  consensus: { label: 'How settled is this?', color: C.verified },
  debate: { label: 'Still debated', color: C.accent },
  safety: { label: 'Safety', color: C.accent },
  example: { label: 'Example', color: C.muted },
};

function equation(b: Equation, ctx: TypstContext): string {
  const num = ctx.numbering.equation.get(b.id)!;
  const rows = b.where.map((w) => `[$${latexToTypst(w.symbol)}$], [${md(w.meaning, ctx)}], [${escMarkup(w.unit)}]`).join(',\n    ');
  return `
#block(breakable: false, width: 100%)[
  #text(style: "italic")[${md(b.intuition, ctx)}]
  #v(2pt)
  #grid(columns: (1fr, auto), align: (center + horizon, right + horizon),
    [$ ${latexToTypst(b.latex)} $], [#text(fill: ${C.muted})[(${num})]])
  #v(2pt)
  #text(font: "${fonts.sans}", size: 8.5pt, fill: ${C.muted})[where]
  #table(columns: (auto, 1fr, auto), stroke: none, inset: (x: 4pt, y: 2.5pt),
    ${rows})
]
#block(fill: ${C.panel}, inset: 8pt, radius: 4pt, width: 100%, breakable: false)[
  #text(font: "${fonts.sans}", weight: "semibold", size: 9pt)[Worked example] \\
  ${md(b.example.text, ctx)}
]
#text(size: 9pt)[#text(font: "${fonts.sans}", weight: "semibold")[Valid when: ]${md(b.validity, ctx)}]
`;
}

/** Extension point: extra block kinds (e.g. 3D models) register a Typst renderer here. */
export const extraTypstBlocks: Record<string, (b: Block, ctx: TypstContext) => string> = {};

function block(b: Block, ctx: TypstContext): string {
  switch (b.kind) {
    case 'para':
      return `${md(b.text, ctx)}\n`;
    case 'list':
      return b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${md(it, ctx)}`).join('\n') + '\n';
    case 'callout': {
      const c = CALLOUT[b.tone]!;
      return `#block(width: 100%, inset: (left: 10pt, rest: 7pt), stroke: (left: 3pt + ${c.color}), fill: ${C.panel}, breakable: false)[
  #text(font: "${fonts.sans}", weight: "semibold", size: 9pt, fill: ${C.ink})[${escMarkup(b.title ?? c.label)}] \\
  ${md(b.text, ctx)}
]
`;
    }
    case 'equation':
      return equation(b, ctx);
    case 'figure': {
      const num = ctx.numbering.figure.get(b.id)!;
      // Figures float to the top or bottom of a page (book convention) so text fills the page.
      return `#place(auto, float: true, clearance: 14pt)[#block(breakable: false, width: 100%)[
  #align(center)[#image("${escString(b.src)}", width: ${Math.round(b.width * 100)}%, alt: "${escString(b.alt)}")]
  #v(4pt)
  #text(font: "${fonts.sans}", size: 8.5pt)[#strong[Figure ${num}] — ${md(b.caption, ctx)} #text(fill: ${C.muted})[${md(b.credit, ctx)}]]
]]
`;
    }
    default: {
      const r = extraTypstBlocks[(b as { kind: string }).kind];
      if (!r) throw new Error(`No print renderer for block kind "${(b as { kind: string }).kind}".`);
      return r(b, ctx);
    }
  }
}

export { md as typstInline };

function layer(label: string, blocks: string): string {
  return `#text(font: "${fonts.sans}", weight: "semibold", size: 8.5pt, fill: ${C.muted}, tracking: 0.04em)[${label}]
#v(-4pt)
${blocks}`;
}

function section(s: Section, ctx: TypstContext): string {
  const l = s.layers;
  const b = (xs: Block[]) => xs.map((x) => block(x, ctx)).join('\n');
  return `
== ${escMarkup(s.title)}

${layer('In short', b(l.summary))}
${layer('Intuition', b(l.intuition))}
${l.formal.length ? layer('The detail', b(l.formal)) : ''}
${layer('Limits', b(l.limits))}
#block(width: 100%, inset: 8pt, stroke: 0.75pt + ${C.rule}, radius: 4pt, breakable: false)[
  #text(font: "${fonts.sans}", weight: "semibold", size: 9pt)[Key takeaways]
${l.takeaways.map((t) => `  - ${md(t, ctx)}`).join('\n')}
]
`;
}

function chapter(ch: Chapter, ci: number, ctx: TypstContext): string {
  const eqs = new Map<string, Equation>();
  for (const s of ch.sections) for (const x of [...s.layers.formal, ...s.layers.intuition]) if (x.kind === 'equation') eqs.set(x.id, x);
  const keyEq = ch.keyEquations
    .map((id) => {
      const e = eqs.get(id);
      if (!e) throw new Error(`Chapter ${ch.id} lists key equation ${id}, which is not in the chapter.`);
      return `[$${latexToTypst(e.latex)}$], [#text(fill: ${C.muted})[(${ctx.numbering.equation.get(id)})]], [${md(e.intuition, ctx)}]`;
    })
    .join(',\n    ');
  return `
#pagebreak(to: "odd", weak: true)
#text(font: "${fonts.sans}", size: 10pt, fill: ${C.muted})[Chapter ${ci + 1}]
= ${escMarkup(ch.title)}

#block(width: 100%, inset: 9pt, fill: ${C.panel}, radius: 4pt)[
  #text(font: "${fonts.sans}", weight: "semibold", size: 9pt)[In this chapter you will learn to]
${ch.goals.map((g) => `  - ${md(g, ctx)}`).join('\n')}
]

${ch.sections.map((s) => section(s, ctx)).join('\n')}

== Chapter summary
${ch.summary.map((t) => `- ${md(t, ctx)}`).join('\n')}

${
  keyEq
    ? `#text(font: "${fonts.sans}", weight: "semibold")[Key equations]
#table(columns: (auto, auto, 1fr), stroke: none, inset: (x: 4pt, y: 4pt), align: horizon,
    ${keyEq})`
    : ''
}

#text(font: "${fonts.sans}", weight: "semibold")[Further reading]
${ch.furtherReading.map((id) => `- #link(<ref-${id}>)[\\[${ctx.numbering.cite.get(id)}\\]] ${escMarkup(ctx.bibliography.get(id) ?? id)}`).join('\n')}
`;
}

/** Every equation in the book, in order. */
export function allEquations(book: Book): Equation[] {
  const out: Equation[] = [];
  for (const ch of book.chapters) for (const s of ch.sections) for (const b of [...s.layers.summary, ...s.layers.intuition, ...s.layers.formal, ...s.layers.limits]) if (b.kind === 'equation') out.push(b);
  return out;
}

function findEquation(book: Book, id: string): Equation | undefined {
  return allEquations(book).find((e) => e.id === id);
}

/** The report's opening sentence, true to what was actually checked (shared with the web and EPUB renderers). */
export function verificationSummary(book: Book, refs: Reference[]): string {
  const eqs = allEquations(book);
  const unverifiedRefs = refs.filter((r) => r.verification.status !== 'verified').length;
  const uncheckedEqs = eqs.filter((e) => !e.example.check.includes('::')).length;
  const a = unverifiedRefs ? `${unverifiedRefs} of ${refs.length} sources are not verified; they are marked below.` : `All ${refs.length} sources were verified; each row says how.`;
  const b =
    eqs.length === 0
      ? ''
      : uncheckedEqs
        ? ` ${uncheckedEqs} of ${eqs.length} equations have no automated check yet and must be checked by hand before publishing.`
        : ` All ${eqs.length} key equations and worked examples are re-derived by the automated tests listed below.`;
  return a + b;
}

export function renderTypst(book: Book, ctx: TypstContext, layout: TypstLayout = DEFAULT_LAYOUT): string {
  const m = book.meta;
  const pageW = layout.trimWidthIn + (layout.bleed ? 0.125 : 0);
  const pageH = layout.trimHeightIn + (layout.bleed ? 0.25 : 0);
  const refsInOrder = [...ctx.numbering.cite.entries()].sort((a, b) => a[1] - b[1]);
  const byId = new Map(ctx.refs.map((r) => [r.id, r]));
  const citedRefs = ctx.refs.filter((r) => ctx.numbering.cite.has(r.id));
  const eqEntries = [...ctx.numbering.equation.entries()];
  const checkFiles = [...new Set(eqEntries.map(([id]) => findEquation(book, id)!.example.check.split('::')[0]!))];
  const checkCells = eqEntries.map(([id, n]) => `[(${n})], [#raw("${escString(findEquation(book, id)!.example.check.split('::').pop()!)}")]`);
  if (checkCells.length % 2) checkCells.push('[], []');

  return `// Generated by Scriptorium from book.json — edit the book, not this file.
#set page(width: ${pageW}in, height: ${pageH}in, binding: left,
  margin: (inside: ${layout.insideIn}in, outside: ${layout.outsideIn}in, top: ${layout.topIn}in, bottom: ${layout.bottomIn}in))
#set text(font: "${fonts.body}", size: 10.5pt, fill: ${C.ink}, lang: "${m.language}", hyphenate: true)
#set par(justify: true, leading: 0.62em, spacing: 0.9em)
#show math.equation: set text(font: "${fonts.mathPrint}")
#show raw: set text(font: "${fonts.mono}", size: 9pt)
#set heading(bookmarked: false)
#show heading.where(level: 1): it => block(below: 14pt)[#text(font: "${fonts.sans}", weight: "semibold", size: 22pt, fill: ${C.ink})[#it.body]]
#show heading.where(level: 2): it => block(above: 16pt, below: 8pt)[#text(font: "${fonts.sans}", weight: "semibold", size: 13.5pt, fill: ${C.ink})[#it.body]]
#show link: set text(fill: ${C.signal})
#set list(indent: 4pt, marker: text(fill: ${C.muted})[•])

// ---------- front matter (roman page numbers, none on the title page)
#set page(numbering: none)
#v(1.6in)
#text(font: "${fonts.sans}", weight: "bold", size: 26pt)[${escMarkup(m.title)}]
${m.subtitle ? `#v(6pt)\n#text(font: "${fonts.sans}", size: 14pt, fill: ${C.muted})[${escMarkup(m.subtitle)}]` : ''}
#v(1fr)
#text(font: "${fonts.sans}", size: 11pt)[${m.authors.map(escMarkup).join(', ')}]
#pagebreak()

#v(1fr)
#set text(size: 8.5pt)
${escMarkup(m.title)}${m.subtitle ? `: ${escMarkup(m.subtitle)}` : ''} \\
${escMarkup(m.license)} \\
Edition date: ${escMarkup(m.date)}. Domain profile: ${escMarkup(m.profile)}; citation style: ${escMarkup(m.citationStyle.toUpperCase())}.

${m.colophon ? md(m.colophon, ctx) : ''}

${ctx.disclosure ? `#strong[AI-content disclosure.] AI-generated text: ${ctx.disclosure.text}. AI-generated images: ${ctx.disclosure.images}. AI translation: ${ctx.disclosure.translations}. See the verification report at the end of the book.` : ''}

This book is for education. It is not a substitute for professional advice.
#set text(size: 10.5pt)
#pagebreak()

#set page(numbering: "i", footer: context {
  let n = counter(page).get().first()
  align(if calc.even(n) { left } else { right })[#text(font: "${fonts.sans}", size: 8.5pt, fill: ${C.muted})[#counter(page).display("i")]]
})
#counter(page).update(3)
#text(font: "${fonts.sans}", weight: "semibold", size: 18pt)[Contents]
#v(8pt)
#outline(title: none, depth: 2, indent: 1.2em)

#pagebreak(to: "odd", weak: true)
#text(font: "${fonts.sans}", weight: "semibold", size: 18pt)[Preface]
#v(6pt)
${book.preface.map((b) => block(b, ctx)).join('\n')}

// ---------- body (arabic page numbers; even on the left, odd on the right)
#pagebreak(to: "odd", weak: true)
#set page(numbering: "1", footer: context {
  let n = counter(page).get().first()
  align(if calc.even(n) { left } else { right })[#text(font: "${fonts.sans}", size: 8.5pt, fill: ${C.muted})[#n]]
})
#counter(page).update(1)
${book.chapters.map((ch, i) => chapter(ch, i, ctx)).join('\n')}

// ---------- back matter
#pagebreak(to: "odd", weak: true)
= Glossary
${book.glossary.map((g) => `/ ${escMarkup(g.term)}: ${md(g.definition, ctx)}`).join('\n')}

#pagebreak(weak: true)
= References
#set par(justify: false)
${refsInOrder.map(([id, n]) => `#grid(columns: (2.2em, 1fr), gutter: 0pt, [\\[${n}\\]], [${escMarkup(ctx.bibliography.get(id) ?? id)} <ref-${id}>])\n#v(3pt)`).join('\n')}

#pagebreak(weak: true)
= Verification report
${escMarkup(verificationSummary(book, citedRefs))}

#text(font: "${fonts.sans}", weight: "semibold")[Sources]
#set text(size: 8.5pt)
#table(columns: (auto, auto, auto, 1fr), stroke: 0.5pt + ${C.rule}, inset: 4pt,
  [*Ref.*], [*Status*], [*Checked*], [*How*],
${refsInOrder
  .map(([id, n]) => {
    const r = byId.get(id)!;
    return `  [\\[${n}\\]], [${escMarkup(r.verification.status)}], [${escMarkup(r.verification.checkedAt)}], [${escMarkup(r.verification.method)}: ${escMarkup(r.verification.note)}]`;
  })
  .join(',\n')}
)
${
  eqEntries.length
    ? `
#text(font: "${fonts.sans}", weight: "semibold", size: 10.5pt)[Equations]
#linebreak()Each check is a test function in ${checkFiles.map((f) => `#raw("${escString(f)}")`).join(', ')}; run them all with #raw("npm run test:equations").
#show raw: set text(size: 7.5pt)
#table(columns: (auto, 1fr, auto, 1fr), stroke: 0.5pt + ${C.rule}, inset: 3pt,
  [*Eq.*], [*Automated check*], [*Eq.*], [*Automated check*],
${checkCells.map((c, i) => (i % 2 === 0 ? `  ${c},` : ` ${c},`)).join('\n').replace(/,$/, '')}
)`
    : ''
}
#set text(size: 10.5pt)
`;
}

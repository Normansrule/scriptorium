/**
 * Print renderer: Book → Typst source, following docs/STYLE.md and the KDP interior rules
 * in src/kdp/specs.ts. Every text string goes through `escMarkup`; math goes through the
 * LaTeX→Typst converter; nothing from the book is ever emitted as raw Typst code.
 */
import { allChecks, type Block, type Book, type Chapter, type Derivation, type Equation, type Experiment, type Explore, type Misconception, type Model3D, type Problem, type Quiz, type Reference, type Section } from '../core/book.ts';
import { formatValue, readouts, stillSvg, stillValues } from './explore.ts';
import { qrSvg } from './qr.ts';
import { styleTypst } from '../core/bookstyle.ts';
import { fonts, roles, surface } from '../core/style.ts';
import { parseInline, type InlineToken } from './inline.ts';
import { latexToTypst } from './latex-typst.ts';
import { checkLabel, resolveRefs, type Numbering } from './numbering.ts';

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
  // `;` is escaped too: right after an inline call such as #link(…)[…] Typst would read it as the end of the call.
  return s.replace(/[\\#*_$@<>[\]`~=+\-/;]/g, (c) => `\\${c}`);
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
  /** Address of the web edition (book.meta.webUrl); 3D figures link and QR-code to it. */
  webUrl?: string;
  /**
   * Mark where each figure lands (page and position) with invisible `<scriptorium-anchor>`
   * metadata, for the 3D Edition. Off for the print interior. The anchors take no space, so the
   * pages come out the same either way (tested in tests/unit/edition3d.test.ts).
   */
  anchors?: boolean;
}

/** Selector the 3D Edition queries for figure positions. */
export const ANCHOR_LABEL = 'scriptorium-anchor';

/** Invisible marker: `edge` is "start" (top-left of the image area) or "end" (its bottom). */
function anchor(id: string, edge: 'start' | 'end', ctx: TypstContext): string {
  if (!ctx.anchors) return '';
  return `#context [#metadata((id: "${escString(id)}", edge: "${edge}", page: here().page(), x: here().position().x.pt(), y: here().position().y.pt())) <${ANCHOR_LABEL}>]`;
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
  ${anchor(b.id, 'start', ctx)}#text(style: "italic")[${md(b.intuition, ctx)}]
  #v(2pt)
  #grid(columns: (1fr, auto), align: (center + horizon, right + horizon),
    [$ ${latexToTypst(b.latex)} $], [#text(fill: ${C.muted})[(${num})]])
  #v(2pt)
  #text(font: "${fonts.sans}", size: 8.5pt, fill: ${C.muted})[where]
  #table(columns: (auto, 1fr, auto), stroke: none, inset: (x: 4pt, y: 2.5pt),
    ${rows})${anchor(b.id, 'end', ctx)}
]
#block(fill: ${C.panel}, inset: 8pt, radius: 4pt, width: 100%, breakable: false)[
  #text(font: "${fonts.sans}", weight: "semibold", size: 9pt)[Worked example] \\
  ${md(b.example.text, ctx)}
]
#text(size: 9pt)[#text(font: "${fonts.sans}", weight: "semibold")[Valid when: ]${md(b.validity, ctx)}]
`;
}

/** Alt text for one still: its own `alt`, else the full description on the first view and a short one on the rest. */
export function viewAlt(b: Model3D, i: number): string {
  const v = b.views[i]!;
  if (v.alt) return v.alt;
  return i === 0 ? `${b.alt} (${v.label} view)` : `The same model, ${v.label} view.`;
}

function model3d(b: Model3D, ctx: TypstContext): string {
  const num = ctx.numbering.figure.get(b.id)!;
  const n = b.views.length;
  const views = b.views
    .map((v, i) => `[#image("${escString(v.src)}", width: 100%, alt: "${escString(viewAlt(b, i))}") #v(-6pt) #align(center)[#text(font: "${fonts.sans}", size: 8pt, fill: ${C.muted})[${escMarkup(v.label)}]]]`)
    .join(', ');
  const url = ctx.webUrl ? `${ctx.webUrl}#${b.id}` : '';
  const caption = `#text(font: "${fonts.sans}", size: 8.5pt)[#strong[Figure ${num}] — ${md(b.caption, ctx)} #text(fill: ${C.muted})[${md(b.credit, ctx)}]${
    url ? ` \\ #text(fill: ${C.muted})[Rotate it in 3D: ${escMarkup(url)}]` : ''
  }]`;
  const bottom = url
    ? `#grid(columns: (1fr, 0.62in), gutter: 8pt, align: (left + horizon, right + horizon), [${caption}], [#image(bytes("${escString(qrSvg(url))}"), format: "svg", width: 0.62in, alt: "QR code linking to the interactive 3D model")])`
    : caption;
  return `#place(auto, float: true, clearance: 14pt)[#block(breakable: false, width: 100%)[
  #align(center)[#box(width: ${Math.round(b.width * 100)}%)[${anchor(b.id, 'start', ctx)}#grid(columns: (1fr,) * ${n}, gutter: 6pt, ${views})${anchor(b.id, 'end', ctx)}]]
  #v(4pt)
  ${bottom}
]]
`;
}

// ---------------------------------------------------------------------------
// Learning blocks (print)

const LEVEL_LABEL: Record<string, string> = { core: 'Core', stretch: 'Stretch', challenge: 'Challenge' };
const EXP_LABEL: Record<string, string> = { 'hands-on': 'Hands-on', demonstration: 'Demonstration', thought: 'Thought experiment', data: 'From real data' };
const label = (t: string) => `#text(font: "${fonts.sans}", weight: "semibold", size: 8.5pt, fill: ${C.muted})[${escMarkup(t)}]`;

/** A boxed learning block with a heading line; breakable so long derivations can cross a page. */
function learnBox(head: string, body: string, edge = 'bk-mark', breakable = true): string {
  return `#block(width: 100%, inset: 9pt, stroke: (rest: 0.75pt + ${C.rule}, left: 2.5pt + ${edge}), radius: 4pt, breakable: ${breakable})[
  #set par(justify: false)
  #text(font: "${fonts.sans}", weight: "semibold", size: 9pt, fill: bk-heading)[${head}]
  #v(2pt)
${body}
]
`;
}

/** Numbered steps: the maths on its own line, the reason underneath in small type. */
function typstSteps(xs: Array<{ latex?: string; why: string }>, ctx: TypstContext): string {
  return `#grid(columns: (14pt, 1fr), row-gutter: 7pt, column-gutter: 4pt,
${xs
  .map((x, i) => `  [#box(fill: bk-band, radius: 50%, width: 11pt, height: 11pt, baseline: 2pt)[#align(center + horizon)[#text(font: "${fonts.sans}", weight: "semibold", size: 7pt, fill: bk-band-ink)[${i + 1}]]]], [${x.latex ? `#align(left)[$ ${latexToTypst(x.latex)} $] #v(-3pt)` : ''}#text(size: 9pt, fill: ${C.muted})[${md(x.why, ctx)}]]`)
  .join(',\n')}
)`;
}

function typstDerivation(b: Derivation, ctx: TypstContext): string {
  const res = b.result ? ` #h(1fr) #text(weight: "regular", fill: ${C.muted})[→ Eq. (${ctx.numbering.equation.get(b.result) ?? b.result})]` : '';
  return learnBox(`Derivation ${ctx.numbering.derivation.get(b.id)}${res}`, `  #strong[${md(b.goal, ctx)}] \\
  ${label('Assume')} ${b.assumptions.map((a) => md(a, ctx)).join('; ')}.
  ${typstSteps(b.steps, ctx)}
  ${label('Check')} ${md(b.check, ctx)}`);
}

function typstProblem(b: Problem, ctx: TypstContext): string {
  return learnBox(`Worked problem ${ctx.numbering.problem.get(b.id)} #h(1fr) #text(weight: "regular", fill: ${C.muted})[${LEVEL_LABEL[b.level]}]`, `  #strong[${md(b.statement, ctx)}]
  #grid(columns: (1fr, 1fr), gutter: 8pt, [${label('Given')} \\ ${b.given.map((g) => md(g, ctx)).join(' \\ ')}], [${label('Find')} \\ ${md(b.find, ctx)}])
  ${label('Strategy')} #emph[${md(b.strategy, ctx)}]
  ${typstSteps(b.steps, ctx)}
  ${label('Answer')} #strong[${md(b.answer, ctx)}] \\
  ${label('Check')} ${md(b.check, ctx)}`);
}

function typstExperiment(b: Experiment, ctx: TypstContext): string {
  const data = b.data
    ? `\n  #table(columns: ${b.data.columns.length}, stroke: none, inset: (x: 4pt, y: 3pt), ${b.data.columns.map((c) => `[*${md(c, ctx)}*]`).join(', ')}, ${b.data.rows.flat().map((v) => `[${typeof v === 'number' ? escMarkup(String(v)) : md(v, ctx)}]`).join(', ')})\n  #text(size: 8pt, fill: ${C.muted})[${md(b.data.source, ctx)}]`
    : '';
  return learnBox(`Experiment ${ctx.numbering.experiment.get(b.id)} #h(1fr) #text(weight: "regular", fill: ${C.muted})[${EXP_LABEL[b.type]}]`, `  #strong[${md(b.question, ctx)}] \\
  #text(size: 9pt)[${label('Safety')} ${md(b.safety, ctx)}]
  #grid(columns: (1fr, 1.3fr), gutter: 10pt, [${label('You need')}
${b.setup.map((x) => `  - ${md(x, ctx)}`).join('\n')}
  ], [${label('Do')}
${b.procedure.map((x, i) => `  ${i + 1}. ${md(x, ctx)}`).join('\n')}
  ])
  #grid(columns: (auto, 1fr), row-gutter: 5pt, column-gutter: 8pt, [${label('Predict')}], [${md(b.predict, ctx)}], [${label('Observe')}], [${md(b.observe, ctx)}], [${label('Explain')}], [${md(b.explain, ctx)}])${data}`);
}

function typstMisconception(b: Misconception, ctx: TypstContext): string {
  return learnBox('Common mistake', `  #grid(columns: (auto, 1fr), row-gutter: 5pt, column-gutter: 8pt, [${label('The mistake')}], [${md(b.wrong, ctx)}], [${label('Why it’s tempting')}], [${md(b.tempting, ctx)}], [${label('What’s true')}], [${md(b.right, ctx)}], [${label('How to tell')}], [${md(b.test, ctx)}])`, C.accent);
}

/** An explorable in print: the three-curve still, the slider ranges, the numbers at the defaults, and a link to the live one. */
function typstExplore(b: Explore, ctx: TypstContext): string {
  const eq = b.equation ? ` #text(weight: "regular", fill: ${C.muted})[· Eq. (${ctx.numbering.equation.get(b.equation) ?? b.equation})]` : '';
  const still = stillSvg(b, 'light');
  const desc = (still.match(/<desc id="d">([^<]*)<\/desc>/)?.[1] ?? b.title).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const { values } = stillValues(b);
  const cells = b.params.flatMap((p) => [`[${escMarkup(p.label)}]`, `[${escMarkup(`${formatValue(p.min, 3)} to ${formatValue(p.max, 3)}${p.unit ? ` ${p.unit}` : ''}`)}]`, `[*${escMarkup(`${formatValue(p.value, 3)}${p.unit ? ` ${p.unit}` : ''}`)}*]`]);
  const outs = readouts(b, values).map((r) => `[${escMarkup(r.label)}], [*${escMarkup(`${r.text}${r.unit ? ` ${r.unit}` : ''}`)}*]`);
  const url = ctx.webUrl ? `${ctx.webUrl}#${b.id}` : '';
  const tryIt = url
    ? `\n  #grid(columns: (1fr, 0.55in), gutter: 8pt, align: (left + horizon, right + horizon), [#text(size: 8.5pt, fill: ${C.muted})[Move the sliders yourself in the web edition: ${escMarkup(url)}]], [#image(bytes("${escString(qrSvg(url))}"), format: "svg", width: 0.55in, alt: "QR code linking to the live version")])`
    : '';
  // anchors inside the box (they take no space): the 3D Edition puts a "try it" hotspot on the box
  return learnBox(
    `${anchor(b.id, 'start', ctx)}Explore ${ctx.numbering.explore.get(b.id)} #h(4pt) #text(weight: "regular", fill: ${C.muted})[${escMarkup(b.title)}]${eq}`,
    `  #strong[${md(b.prompt, ctx)}]
  #block(breakable: false)[#image(bytes("${escString(still)}"), format: "svg", width: 100%, alt: "${escString(desc)}")]
  #set text(size: 8.5pt)
  #grid(columns: (1.35fr, 1fr), gutter: 10pt,
    [#table(columns: 3, stroke: none, inset: (x: 3pt, y: 2pt), [#text(fill: ${C.muted})[Slider]], [#text(fill: ${C.muted})[Range]], [#text(fill: ${C.muted})[Default]], ${cells.join(', ')})],
    [${outs.length ? `#table(columns: 2, stroke: none, fill: bk-tint, inset: (x: 4pt, y: 3pt), ${outs.join(', ')})` : ''}])
  #set text(size: 10.5pt)
  ${label('What to notice')} ${md(b.notice, ctx)}${tryIt}${anchor(b.id, 'end', ctx)}`,
    'bk-mark',
    false,
  );
}

/** A self-check in print: lettered answers; the answer and why are in the back of the book. */
function typstQuiz(b: Quiz, ctx: TypstContext): string {
  return learnBox(
    `${anchor(b.id, 'start', ctx)}Check yourself ${ctx.numbering.quiz.get(b.id)} #h(1fr) #text(weight: "regular", size: 8pt, fill: ${C.muted})[answer at the back]`,
    `  ${md(b.question, ctx)}
  #grid(columns: (auto, 1fr), row-gutter: 5pt, column-gutter: 6pt, ${b.options.map((o, i) => `[#text(font: "${fonts.sans}", weight: "semibold", fill: bk-heading)[(${String.fromCharCode(97 + i)})]], [${md(o.text, ctx)}]`).join(', ')})${anchor(b.id, 'end', ctx)}`,
    'bk-mark',
    false,
  );
}

const quizzesOf = (c: Chapter): Quiz[] => c.sections.flatMap((s) => [...s.layers.summary, ...s.layers.intuition, ...s.layers.formal, ...s.layers.limits]).filter((b): b is Quiz => b.kind === 'quiz');

/** Extension point: extra block kinds register a Typst renderer here. */
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
  #align(center)[#box(width: ${Math.round(b.width * 100)}%)[${anchor(b.id, 'start', ctx)}#image("${escString(b.src)}", width: 100%, alt: "${escString(b.alt)}")${anchor(b.id, 'end', ctx)}]]
  #v(4pt)
  #text(font: "${fonts.sans}", size: 8.5pt)[#strong[Figure ${num}] — ${md(b.caption, ctx)} #text(fill: ${C.muted})[${md(b.credit, ctx)}]]
]]
`;
    }
    case 'model3d':
      return model3d(b, ctx);
    case 'derivation':
      return typstDerivation(b, ctx);
    case 'problem':
      return typstProblem(b, ctx);
    case 'experiment':
      return typstExperiment(b, ctx);
    case 'misconception':
      return typstMisconception(b, ctx);
    case 'explore':
      return typstExplore(b, ctx);
    case 'quiz':
      return typstQuiz(b, ctx);
    case 'application':
      return `#block(width: 100%, inset: 9pt, fill: bk-tint, stroke: (left: 2.5pt + bk-mark), radius: 4pt, breakable: false)[
  #text(font: "${fonts.sans}", weight: "semibold", size: 9pt, fill: bk-heading)[In practice] #text(font: "${fonts.sans}", size: 9pt, fill: ${C.muted})[${escMarkup(b.title)}] \\
  ${md(b.text, ctx)}${b.numbers ? ` \\ #text(size: 9.5pt)[${md(b.numbers, ctx)}]` : ''}
]
`;
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
${anchor(ch.id, 'start', ctx)}#box(fill: bk-band, inset: (x: 6pt), outset: (y: 3pt), radius: 8pt)[#text(font: "${fonts.sans}", weight: "semibold", size: 9.5pt, fill: bk-band-ink, tracking: 0.03em)[Chapter ${ci + 1}]]
= ${escMarkup(ch.title)}

${ch.hook ? `#block(inset: (left: 8pt), stroke: (left: 2pt + bk-mark))[${anchor(ch.id, 'end', ctx)}#text(size: 12pt)[${md(ch.hook, ctx)}]]\n#v(4pt)` : ''}
#block(width: 100%, inset: 9pt, fill: bk-tint, radius: 4pt)[
  ${ch.hook ? '' : anchor(ch.id, 'end', ctx)}#text(font: "${fonts.sans}", weight: "semibold", size: 9pt)[In this chapter you will learn to]
${ch.goals.map((g) => `  - ${md(g, ctx)}`).join('\n')}${
  ch.prerequisites.length ? `\n  #text(size: 9pt)[#text(font: "${fonts.sans}", weight: "semibold")[You’ll need:] ${ch.prerequisites.map((x) => md(x, ctx)).join(' · ')}]` : ''
}
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

${
  ch.exercises.length
    ? `#text(font: "${fonts.sans}", weight: "semibold")[Practice] #text(size: 9pt, fill: ${C.muted})[— answers and worked solutions are at the back of the book.]
${ch.exercises.map((e) => `#grid(columns: (2.2em, 1fr), [#text(font: "${fonts.sans}", weight: "semibold", size: 9pt)[${ctx.numbering.exercise.get(e.id)}]], [#text(font: "${fonts.sans}", size: 8pt, fill: ${C.muted})[${LEVEL_LABEL[e.level]}] ${md(e.prompt, ctx)}])`).join('\n#v(4pt)\n')}
`
    : ''
}
#text(font: "${fonts.sans}", weight: "semibold")[Further reading]
${ch.furtherReading.map((id) => `- #link(<ref-${id}>)[\\[${ctx.numbering.cite.get(id)}\\]] ${escMarkup(ctx.bibliography.get(id) ?? id)}`).join('\n')}
`;
}

/** "Solutions to practice": every self-check answer, and every exercise's answer and worked solution, by chapter. */
function solutions(book: Book, ctx: TypstContext): string {
  if (!book.chapters.some((c) => c.exercises.length || quizzesOf(c).length)) return '';
  const quizAnswers = (c: Chapter) =>
    quizzesOf(c)
      .map((q) => {
        const i = q.options.findIndex((o) => o.correct);
        return `#block(breakable: false, below: 8pt)[#text(font: "${fonts.sans}", weight: "semibold", size: 9.5pt)[Check yourself ${ctx.numbering.quiz.get(q.id)}] #h(4pt) #strong[(${String.fromCharCode(97 + i)})] ${md(q.options[i]!.why, ctx)}]`;
      })
      .join('\n');
  return `#pagebreak(to: "odd", weak: true)
= Solutions to practice
${book.chapters
  .filter((c) => c.exercises.length || quizzesOf(c).length)
  .map(
    (c) => `== ${escMarkup(c.title)}
${quizAnswers(c)}
${c.exercises
  .map((e) => `#block(breakable: true, below: 10pt)[#text(font: "${fonts.sans}", weight: "semibold", size: 9.5pt)[${ctx.numbering.exercise.get(e.id)}] #h(4pt) ${label('Answer')} #strong[${md(e.answer, ctx)}]
${typstSteps(e.solution, ctx)}]`)
  .join('\n')}`,
  )
  .join('\n')}
`;
}

/** Every equation in the book, in order. */
export function allEquations(book: Book): Equation[] {
  const out: Equation[] = [];
  for (const ch of book.chapters) for (const s of ch.sections) for (const b of [...s.layers.summary, ...s.layers.intuition, ...s.layers.formal, ...s.layers.limits]) if (b.kind === 'equation') out.push(b);
  return out;
}

/** The report's opening sentence, true to what was actually checked (shared with the web and EPUB renderers). */
/** "equations, derivations and exercise solutions": the kinds of check a book actually has, in a fixed order. */
function checkKinds(kinds: string[]): string {
  const names: Array<[string, string]> = [['equation', 'equations'], ['derivation', 'derivations'], ['problem', 'worked problems'], ['explore', 'explorables'], ['exercise', 'exercise solutions']];
  const have = names.filter(([k]) => kinds.includes(k)).map(([, n]) => n);
  return have.length > 1 ? `${have.slice(0, -1).join(', ')} and ${have.at(-1)}` : (have[0] ?? 'checks');
}

export function verificationSummary(book: Book, refs: Reference[]): string {
  const checks = allChecks(book, (kind) => kind);
  const eqOnly = checks.every((c) => c.label === 'equation');
  const unverifiedRefs = refs.filter((r) => r.verification.status !== 'verified').length;
  const unchecked = checks.filter((c) => !c.test.includes('::')).length;
  const a = unverifiedRefs
    ? `${unverifiedRefs} of ${refs.length} sources ${unverifiedRefs === 1 ? 'is' : 'are'} not verified; ${unverifiedRefs === 1 ? 'it is' : 'they are'} marked below.`
    : refs.length === 1
      ? 'The one source was verified; the row below says how.'
      : `All ${refs.length} sources were verified; each row says how.`;
  const b =
    checks.length === 0
      ? ''
      : unchecked
        ? ` ${unchecked} of ${checks.length} ${eqOnly ? 'equations have' : 'equations, derivations and solutions have'} no automated check yet and must be checked by hand before publishing.`
        : eqOnly
          ? ` All ${checks.length} key equations and worked examples are re-derived by the automated tests listed below.`
          : ` All ${checks.length} ${checkKinds(checks.map((c) => c.label))} are re-derived by the automated tests listed below.`;
  return a + b;
}

export function renderTypst(book: Book, ctx: TypstContext, layout: TypstLayout = DEFAULT_LAYOUT): string {
  const m = book.meta;
  const pageW = layout.trimWidthIn + (layout.bleed ? 0.125 : 0);
  const pageH = layout.trimHeightIn + (layout.bleed ? 0.25 : 0);
  const refsInOrder = [...ctx.numbering.cite.entries()].sort((a, b) => a[1] - b[1]);
  const byId = new Map(ctx.refs.map((r) => [r.id, r]));
  const citedRefs = ctx.refs.filter((r) => ctx.numbering.cite.has(r.id));
  const checks = allChecks(book, checkLabel(ctx.numbering));
  const checkFiles = [...new Set(checks.map((c) => c.test.split('::')[0]!))];
  const checkCells = checks.map((c) => `[${escMarkup(c.label)}], [#raw("${escString(c.test.split('::').pop()!)}")]`);
  if (checkCells.length % 2) checkCells.push('[], []');

  return `// Generated by Scriptorium from book.json — edit the book, not this file.
#set page(width: ${pageW}in, height: ${pageH}in, binding: left,
  margin: (inside: ${layout.insideIn}in, outside: ${layout.outsideIn}in, top: ${layout.topIn}in, bottom: ${layout.bottomIn}in))
#set text(font: "${fonts.body}", size: 10.5pt, fill: ${C.ink}, lang: "${m.language}", hyphenate: true)
#set par(justify: true, leading: 0.62em, spacing: 0.9em)
#show math.equation: set text(font: "${fonts.mathPrint}")
#show raw: set text(font: "${fonts.mono}", size: 9pt)
#set heading(bookmarked: false)
${styleTypst(m.style)}
#show heading.where(level: 1): it => block(below: 14pt)[#text(font: "${fonts.sans}", weight: "semibold", size: 22pt, fill: bk-heading)[#it.body]]
#show heading.where(level: 2): it => block(above: 16pt, below: 8pt)[#text(font: "${fonts.sans}", weight: "semibold", size: 13.5pt, fill: bk-heading)[#it.body]]
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
${solutions(book, ctx)}
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
  checks.length
    ? `
#text(font: "${fonts.sans}", weight: "semibold", size: 10.5pt)[Automated checks]
#linebreak()Each check is a test function in ${checkFiles.map((f) => `#raw("${escString(f)}")`).join(', ')}\\; run them all with #raw("npm run test:equations").
#show raw: set text(size: 7.5pt)
#table(columns: (auto, 1fr, auto, 1fr), stroke: 0.5pt + ${C.rule}, inset: 3pt,
  [*What*], [*Test*], [*What*], [*Test*],
${checkCells.map((c, i) => (i % 2 === 0 ? `  ${c},` : ` ${c},`)).join('\n').replace(/,$/, '')}
)`
    : ''
}
#set text(size: 10.5pt)
`;
}

/**
 * Web renderer: Book → one HTML page (plus CSS), in the layered reading order.
 * Math renders server-side with KaTeX to HTML + MathML (no client script, so the page can
 * ship a Content Security Policy with script-src 'none'). Every text string is escaped
 * here, and the finished page is sanitized again with DOMPurify before it is written.
 */
import katex from 'katex';
import { allChecks, type Block, type Book, type Chapter, type Derivation, type Equation, type Exercise, type Experiment, type Misconception, type Model3D, type Problem, type Reference, type Section } from '../core/book.ts';
import type { Model } from '../core/molecule.ts';
import { cssVariables, fonts } from '../core/style.ts';
import { parseInline, type InlineToken } from './inline.ts';
import { checkLabel, resolveRefs, type Numbering } from './numbering.ts';
import { verificationSummary, viewAlt } from './typst.ts';

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderMath(latex: string, display: boolean): string {
  return katex.renderToString(latex, { displayMode: display, output: 'htmlAndMathml', throwOnError: true, trust: false, strict: 'error' });
}

/** MathML only (for EPUB, where KaTeX's HTML layer and its fonts are not wanted). */
export function renderMathMl(latex: string, display: boolean): string {
  return katex.renderToString(latex, { displayMode: display, output: 'mathml', throwOnError: true, trust: false, strict: 'error' });
}

export interface HtmlContext {
  numbering: Numbering;
  bibliography: Map<string, string>; // id → formatted HTML from citeproc
  refs: Reference[];
  /** Path prefix for figures, relative to the page. */
  figureBase: string;
  disclosure?: { text: string; images: string; translations: string };
  /** 'web' = KaTeX HTML + MathML; 'epub' = MathML only, XHTML-safe output. */
  target?: 'web' | 'epub';
  /** Parsed 3D models by their `src` path (for the web viewer's data). */
  models?: Record<string, Model>;
  /** Address of the web edition (book.meta.webUrl), used for links from EPUB. */
  webUrl?: string;
}

const math = (latex: string, display: boolean, ctx: HtmlContext) => (ctx.target === 'epub' ? renderMathMl(latex, display) : renderMath(latex, display));

function inline(tokens: InlineToken[], ctx: HtmlContext): string {
  return tokens
    .map((t) => {
      switch (t.t) {
        case 'text':
          return escHtml(t.v);
        case 'bold':
          return `<strong>${inline(t.v, ctx)}</strong>`;
        case 'italic':
          return `<em>${inline(t.v, ctx)}</em>`;
        case 'code':
          return `<code>${escHtml(t.v)}</code>`;
        case 'term':
          return `<a class="term" href="${ctx.target === 'epub' ? 'backmatter.xhtml' : ''}#term-${slug(t.v)}">${escHtml(t.v)}</a>`;
        case 'math':
          return math(t.v, false, ctx);
        case 'cite': {
          const n = ctx.numbering.cite.get(t.id);
          if (n === undefined) throw new Error(`Citation [@${t.id}] has no reference.`);
          return `<a class="cite" href="${ctx.target === 'epub' ? 'backmatter.xhtml' : ''}#ref-${escHtml(t.id)}">[${n}${t.locator ? `, ${escHtml(t.locator)}` : ''}]</a>`;
        }
      }
    })
    .join('');
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const htmlInline = (s: string, ctx: HtmlContext) => inline(parseInline(resolveRefs(s, ctx.numbering)), ctx);
const md = htmlInline;

const CALLOUT_LABEL: Record<string, string> = {
  simplification: 'Simplification',
  consensus: 'How settled is this?',
  debate: 'Still debated',
  safety: 'Safety',
  example: 'Example',
};

function equation(b: Equation, ctx: HtmlContext): string {
  const num = ctx.numbering.equation.get(b.id)!;
  return `<div class="equation" id="${b.id}">
  <p class="eq-intuition">${md(b.intuition, ctx)}</p>
  <div class="eq-row"><div class="eq-math">${math(b.latex, true, ctx)}</div><div class="eq-num">(${num})</div></div>
  <table class="eq-where"><caption>where</caption><tbody>
${b.where.map((w) => `    <tr><td>${math(w.symbol, false, ctx)}</td><td>${md(w.meaning, ctx)}</td><td class="unit">${escHtml(w.unit)}</td></tr>`).join('\n')}
  </tbody></table>
  <div class="example"><div class="label">Worked example</div><p>${md(b.example.text, ctx)}</p><p class="check">Checked by <code>${escHtml(b.example.check)}</code></p></div>
  <p class="validity"><span class="label">Valid when:</span> ${md(b.validity, ctx)}</p>
</div>`;
}

function model3d(b: Model3D, ctx: HtmlContext): string {
  const num = ctx.numbering.figure.get(b.id)!;
  const epub = ctx.target === 'epub';
  const viewImg = (src: string, label: string, i: number) => {
    const path = `${ctx.figureBase}${src.replace(/^figures\//, '')}`;
    const alt = viewAlt(b, i);
    return epub
      ? `<div class="view"><img src="${escHtml(path)}" alt="${escHtml(alt)}"/><p class="view-label">${escHtml(label)}</p></div>`
      : `<div class="view"><picture><source srcset="${escHtml(path.replace(/\.svg$/, '.dark.svg'))}" media="(prefers-color-scheme: dark)"><img src="${escHtml(path)}" alt="${escHtml(alt)}" loading="lazy"></picture><p class="view-label">${escHtml(label)}</p></div>`;
  };
  const model = ctx.models?.[b.src];
  const data =
    !epub && model
      ? ` data-model="${escHtml(JSON.stringify({ model, scale: b.scale, scaleNote: b.scaleNote, atomScale: b.atomScale, annotations: b.annotations, views: b.views.map((v) => ({ yaw: v.yaw, pitch: v.pitch, label: v.label })), alt: b.alt }))}"`
      : '';
  // EPUB readers cannot run the viewer, so the caption links to the web edition (figcaption must stay the last child).
  const link = epub && ctx.webUrl ? `<br/><span class="interactive">Rotate this model in 3D in the web edition: <a href="${escHtml(`${ctx.webUrl}#${b.id}`)}">${escHtml(`${ctx.webUrl}#${b.id}`)}</a></span>` : '';
  return `<figure id="${b.id}" class="model3d" style="--w:${Math.round(b.width * 100)}%"${data}>
  <div class="views">${b.views.map((v, i) => viewImg(v.src, v.label, i)).join('')}</div>
  <figcaption><strong>Figure ${num}</strong> — ${md(b.caption, ctx)} <span class="credit">${md(b.credit, ctx)}</span>${link}</figcaption>
</figure>`;
}

// ---------------------------------------------------------------------------
// Learning blocks

const LEVEL: Record<string, string> = { core: 'Core', stretch: 'Stretch', challenge: 'Challenge' };
const EXPERIMENT_TYPE: Record<string, string> = { 'hands-on': 'Hands-on', demonstration: 'Demonstration', thought: 'Thought experiment', data: 'From real data' };

function steps(xs: Array<{ latex?: string; why: string }>, ctx: HtmlContext): string {
  return `<ol class="steps">${xs
    .map((x) => `<li>${x.latex ? `<div class="step-math">${math(x.latex, true, ctx)}</div>` : ''}<p class="why">${md(x.why, ctx)}</p></li>`)
    .join('')}</ol>`;
}

function derivation(b: Derivation, ctx: HtmlContext): string {
  const num = ctx.numbering.derivation.get(b.id)!;
  const result = b.result ? ` <a class="to-eq" href="#${b.result}">→ Eq. (${ctx.numbering.equation.get(b.result) ?? b.result})</a>` : '';
  return `<div class="learn derivation" id="${b.id}">
  <div class="learn-head"><span class="learn-kind">Derivation ${num}</span>${result}</div>
  <p class="goal">${md(b.goal, ctx)}</p>
  <p class="assume"><span class="label">Assume:</span> ${b.assumptions.map((a) => md(a, ctx)).join('; ')}.</p>
  ${steps(b.steps, ctx)}
  <p class="sanity"><span class="label">Check:</span> ${md(b.check, ctx)}</p>
  <p class="check">Re-derived by <code>${escHtml(b.test)}</code></p>
</div>`;
}

function problem(b: Problem, ctx: HtmlContext): string {
  const num = ctx.numbering.problem.get(b.id)!;
  return `<div class="learn problem" id="${b.id}">
  <div class="learn-head"><span class="learn-kind">Worked problem ${num}</span><span class="level ${b.level}">${LEVEL[b.level]}</span></div>
  <p class="statement">${md(b.statement, ctx)}</p>
  <div class="given-find"><div><span class="label">Given</span><ul>${b.given.map((g) => `<li>${md(g, ctx)}</li>`).join('')}</ul></div><div><span class="label">Find</span><p>${md(b.find, ctx)}</p></div></div>
  <p class="strategy"><span class="label">Strategy:</span> ${md(b.strategy, ctx)}</p>
  ${steps(b.steps, ctx)}
  <p class="answer"><span class="label">Answer:</span> ${md(b.answer, ctx)}</p>
  <p class="sanity"><span class="label">Check:</span> ${md(b.check, ctx)}</p>
  <p class="check">Checked by <code>${escHtml(b.test)}</code></p>
</div>`;
}

function experiment(b: Experiment, ctx: HtmlContext): string {
  const num = ctx.numbering.experiment.get(b.id)!;
  const data = b.data
    ? `<table class="data"><thead><tr>${b.data.columns.map((c) => `<th>${md(c, ctx)}</th>`).join('')}</tr></thead><tbody>${b.data.rows
        .map((r) => `<tr>${r.map((v) => `<td>${typeof v === 'number' ? escHtml(String(v)) : md(v, ctx)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table><p class="data-source">${md(b.data.source, ctx)}</p>`
    : '';
  return `<div class="learn experiment" id="${b.id}">
  <div class="learn-head"><span class="learn-kind">Experiment ${num}</span><span class="level">${EXPERIMENT_TYPE[b.type]}</span></div>
  <p class="statement">${md(b.question, ctx)}</p>
  <p class="safety-line"><span class="label">Safety:</span> ${md(b.safety, ctx)}</p>
  <div class="exp-cols"><div><span class="label">You need</span><ul>${b.setup.map((x) => `<li>${md(x, ctx)}</li>`).join('')}</ul></div><div><span class="label">Do</span><ol>${b.procedure.map((x) => `<li>${md(x, ctx)}</li>`).join('')}</ol></div></div>
  <dl class="pox"><dt>Predict</dt><dd>${md(b.predict, ctx)}</dd><dt>Observe</dt><dd>${md(b.observe, ctx)}</dd><dt>Explain</dt><dd>${md(b.explain, ctx)}</dd></dl>
  ${data}
</div>`;
}

function misconception(b: Misconception, ctx: HtmlContext): string {
  return `<div class="learn misconception">
  <div class="learn-head"><span class="learn-kind">Common mistake</span></div>
  <dl class="pox"><dt>The mistake</dt><dd>${md(b.wrong, ctx)}</dd><dt>Why it’s tempting</dt><dd>${md(b.tempting, ctx)}</dd><dt>What’s true</dt><dd>${md(b.right, ctx)}</dd><dt>How to tell</dt><dd>${md(b.test, ctx)}</dd></dl>
</div>`;
}

function exerciseList(ch: Chapter, ctx: HtmlContext): string {
  if (!ch.exercises.length) return '';
  const one = (e: Exercise) => `<li id="${e.id}"><span class="ex-num">${ctx.numbering.exercise.get(e.id)}</span><span class="level ${e.level}">${LEVEL[e.level]}</span> ${md(e.prompt, ctx)}
  <details><summary>Answer and worked solution</summary><p class="answer"><span class="label">Answer:</span> ${md(e.answer, ctx)}</p>${steps(e.solution, ctx)}<p class="check">Checked by <code>${escHtml(e.test)}</code></p></details></li>`;
  return `<h4>Practice</h4><ol class="exercises">${ch.exercises.map(one).join('\n')}</ol>`;
}

/** Extension point: extra block kinds register an HTML renderer here. */
export const extraHtmlBlocks: Record<string, (b: Block, ctx: HtmlContext) => string> = {};

function block(b: Block, ctx: HtmlContext): string {
  switch (b.kind) {
    case 'para':
      return `<p>${md(b.text, ctx)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((i) => `<li>${md(i, ctx)}</li>`).join('')}</${tag}>`;
    }
    case 'callout':
      return `<aside class="callout ${b.tone}"><div class="label">${escHtml(b.title ?? CALLOUT_LABEL[b.tone]!)}</div><p>${md(b.text, ctx)}</p></aside>`;
    case 'equation':
      return equation(b, ctx);
    case 'figure': {
      const num = ctx.numbering.figure.get(b.id)!;
      const src = `${ctx.figureBase}${b.src.replace(/^figures\//, '')}`;
      const dark = src.replace(/\.svg$/, '.dark.svg');
      const img =
        ctx.target === 'epub'
          ? `<img src="${escHtml(src)}" alt="${escHtml(b.alt)}"/>`
          : `<picture><source srcset="${escHtml(dark)}" media="(prefers-color-scheme: dark)"><img src="${escHtml(src)}" alt="${escHtml(b.alt)}" loading="lazy"></picture>`;
      return `<figure id="${b.id}" style="--w:${Math.round(b.width * 100)}%">
  ${img}
  <figcaption><strong>Figure ${num}</strong> — ${md(b.caption, ctx)} <span class="credit">${md(b.credit, ctx)}</span></figcaption>
</figure>`;
    }
    case 'model3d':
      return model3d(b, ctx);
    case 'derivation':
      return derivation(b, ctx);
    case 'problem':
      return problem(b, ctx);
    case 'experiment':
      return experiment(b, ctx);
    case 'misconception':
      return misconception(b, ctx);
    case 'application':
      return `<aside class="learn application"><div class="learn-head"><span class="learn-kind">In practice</span> <span class="app-title">${escHtml(b.title)}</span></div><p>${md(b.text, ctx)}</p>${b.numbers ? `<p class="numbers">${md(b.numbers, ctx)}</p>` : ''}</aside>`;
    default: {
      const r = extraHtmlBlocks[(b as { kind: string }).kind];
      if (!r) throw new Error(`No HTML renderer for block kind "${(b as { kind: string }).kind}".`);
      return r(b, ctx);
    }
  }
}

export { block as htmlBlock };

/** True when any block in the book needs the 3D viewer script. */
export function hasModels(book: Book): boolean {
  return book.chapters.some((c) => c.sections.some((s) => [...s.layers.summary, ...s.layers.intuition, ...s.layers.formal, ...s.layers.limits].some((b) => b.kind === 'model3d')));
}

function layer(name: string, cls: string, blocks: Block[], ctx: HtmlContext): string {
  if (!blocks.length) return '';
  return `<div class="layer ${cls}"><div class="layer-label">${name}</div>${blocks.map((b) => block(b, ctx)).join('\n')}</div>`;
}

function section(s: Section, ctx: HtmlContext): string {
  const l = s.layers;
  return `<section id="${s.id}">
<h3>${escHtml(s.title)}</h3>
${layer('In short', 'summary', l.summary, ctx)}
${layer('Intuition', 'intuition', l.intuition, ctx)}
${layer('The detail', 'formal', l.formal, ctx)}
${layer('Limits', 'limits', l.limits, ctx)}
<div class="takeaways"><div class="label">Key takeaways</div><ul>${l.takeaways.map((t) => `<li>${md(t, ctx)}</li>`).join('')}</ul></div>
</section>`;
}

export function renderChapter(ch: Chapter, i: number, ctx: HtmlContext): string {
  const eqs = new Map<string, Equation>();
  for (const s of ch.sections) for (const b of s.layers.formal) if (b.kind === 'equation') eqs.set(b.id, b);
  const refHref = ctx.target === 'epub' ? 'backmatter.xhtml' : '';
  return `<article class="chapter" id="${ch.id}">
<p class="kicker">Chapter ${i + 1}</p>
<h2>${escHtml(ch.title)}</h2>
${ch.hook ? `<p class="hook">${md(ch.hook, ctx)}</p>` : ''}
<div class="goals"><div class="label">In this chapter you will learn to</div><ul>${ch.goals.map((g) => `<li>${md(g, ctx)}</li>`).join('')}</ul>${
    ch.prerequisites.length ? `<p class="prereq"><span class="label">You’ll need:</span> ${ch.prerequisites.map((x) => md(x, ctx)).join(' · ')}</p>` : ''
  }</div>
${ch.sections.map((s) => section(s, ctx)).join('\n')}
<section class="chapter-end">
<h3>Chapter summary</h3><ul>${ch.summary.map((s) => `<li>${md(s, ctx)}</li>`).join('')}</ul>
${
  ch.keyEquations.length
    ? `<h4>Key equations</h4>
<table class="key-eqs"><tbody>${ch.keyEquations
        .map((id) => {
          const e = eqs.get(id)!;
          return `<tr><td>${math(e.latex, false, ctx)}</td><td class="eq-num"><a href="#${id}">(${ctx.numbering.equation.get(id)})</a></td><td>${md(e.intuition, ctx)}</td></tr>`;
        })
        .join('')}</tbody></table>`
    : ''
}
${exerciseList(ch, ctx)}
<h4>Further reading</h4>
<ul class="further">${ch.furtherReading.map((id) => `<li><a class="cite" href="${refHref}#ref-${id}">[${ctx.numbering.cite.get(id)}]</a> ${ctx.bibliography.get(id) ?? escHtml(id)}</li>`).join('')}</ul>
</section>
</article>`;
}

export function renderGlossary(book: Book, ctx: HtmlContext): string {
  return `<section id="glossary" class="backmatter"><h2>Glossary</h2><dl>${book.glossary.map((g) => `<dt id="term-${slug(g.term)}">${escHtml(g.term)}</dt><dd>${md(g.definition, ctx)}</dd>`).join('')}</dl></section>`;
}

export function renderReferences(ctx: HtmlContext): string {
  const order = [...ctx.numbering.cite.entries()].sort((a, b) => a[1] - b[1]);
  return `<section id="references" class="backmatter"><h2>References</h2><ol class="refs">${order.map(([id, n]) => `<li id="ref-${id}" value="${n}"><span class="n">[${n}]</span> ${ctx.bibliography.get(id) ?? escHtml(id)}</li>`).join('')}</ol></section>`;
}

export function renderReport(book: Book, ctx: HtmlContext): string {
  const order = [...ctx.numbering.cite.entries()].sort((a, b) => a[1] - b[1]);
  const byId = new Map(ctx.refs.map((r) => [r.id, r]));
  return `<section id="verification" class="backmatter"><h2>Verification report</h2>
<p>${escHtml(verificationSummary(book, ctx.refs.filter((r) => ctx.numbering.cite.has(r.id))))}</p>
<table class="report"><thead><tr><th>Ref.</th><th>Status</th><th>Checked</th><th>How</th></tr></thead><tbody>
${order
  .map(([id, n]) => {
    const v = byId.get(id)!.verification;
    return `<tr><td>[${n}]</td><td><span class="status ${v.status}">${escHtml(v.status)}</span></td><td>${escHtml(v.checkedAt)}</td><td>${escHtml(v.method)}: ${escHtml(v.note)}</td></tr>`;
  })
  .join('\n')}
</tbody></table>
${checksTable(book, ctx)}
</section>`;
}

function checksTable(book: Book, ctx: HtmlContext): string {
  const checks = allChecks(book, checkLabel(ctx.numbering));
  if (!checks.length) return '';
  return `<h3>Automated checks</h3><table class="report"><thead><tr><th>What</th><th>Test</th></tr></thead><tbody>${checks
    .map((c) => `<tr><td>${escHtml(c.label)}</td><td><code>${escHtml(c.test)}</code></td></tr>`)
    .join('')}</tbody></table>`;
}

export const CSP = "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'";
/** Books with 3D models load one script of our own (assets/viewer3d.js) and nothing else. */
export const CSP_WITH_VIEWER = CSP.replace("default-src 'none';", "default-src 'none'; script-src 'self';");

export function renderHtml(book: Book, ctx: HtmlContext): string {
  const m = book.meta;
  const toc = book.chapters
    .map((ch, i) => `<li><a href="#${ch.id}">${i + 1}. ${escHtml(ch.title)}</a><ol>${ch.sections.map((s) => `<li><a href="#${s.id}">${escHtml(s.title)}</a></li>`).join('')}</ol></li>`)
    .join('');
  return `<!doctype html>
<html lang="${escHtml(m.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${hasModels(book) ? CSP_WITH_VIEWER : CSP}">
<meta name="referrer" content="no-referrer">
<title>${escHtml(m.title)}</title>
<link rel="stylesheet" href="assets/katex/katex.min.css">
<link rel="stylesheet" href="assets/book.css">
${hasModels(book) ? '<script defer src="assets/viewer3d.js"></script>' : ''}
</head>
<body>
<a class="skip" href="#main">Skip to the book</a>
<nav class="toc" aria-label="Contents"><p class="toc-title">${escHtml(m.title)}</p><ol>${toc}<li><a href="#glossary">Glossary</a></li><li><a href="#references">References</a></li><li><a href="#verification">Verification report</a></li></ol></nav>
<main id="main">
<header class="titlepage">
<h1>${escHtml(m.title)}</h1>
${m.subtitle ? `<p class="subtitle">${escHtml(m.subtitle)}</p>` : ''}
<p class="byline">${m.authors.map(escHtml).join(', ')} · ${escHtml(m.date)}</p>
${m.colophon ? `<p class="colophon">${md(m.colophon, ctx)}</p>` : ''}
${ctx.disclosure ? `<p class="colophon"><strong>AI-content disclosure.</strong> AI-generated text: ${ctx.disclosure.text}. AI-generated images: ${ctx.disclosure.images}. AI translation: ${ctx.disclosure.translations}.</p>` : ''}
<p class="colophon">${escHtml(m.license)}</p>
</header>
<section class="preface"><h2>Preface</h2>${book.preface.map((b) => block(b, ctx)).join('\n')}</section>
${book.chapters.map((ch, i) => renderChapter(ch, i, ctx)).join('\n')}
${renderGlossary(book, ctx)}
${renderReferences(ctx)}
${renderReport(book, ctx)}
</main>
</body>
</html>`;
}

export function bookCss(): string {
  return `/* Generated from src/core/style.ts — see docs/STYLE.md */
@font-face { font-family: "${fonts.body}"; src: url("fonts/SourceSerif4-Regular.ttf"); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: "${fonts.body}"; src: url("fonts/SourceSerif4-It.ttf"); font-weight: 400; font-style: italic; font-display: swap; }
@font-face { font-family: "${fonts.body}"; src: url("fonts/SourceSerif4-Semibold.ttf"); font-weight: 600; font-display: swap; }
@font-face { font-family: "${fonts.sans}"; src: url("fonts/SourceSans3-Regular.ttf"); font-weight: 400; font-display: swap; }
@font-face { font-family: "${fonts.sans}"; src: url("fonts/SourceSans3-Semibold.ttf"); font-weight: 600; font-display: swap; }
:root { ${cssVariables('light')} color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { ${cssVariables('dark')} } }
* { box-sizing: border-box; }
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
body { margin: 0; background: var(--sc-paper); color: var(--sc-ink); font: 18px/1.6 "${fonts.body}", Georgia, serif; display: grid; grid-template-columns: 17rem minmax(0, 1fr); }
a { color: var(--sc-signal); }
.skip { position: absolute; left: -999px; } .skip:focus { left: 1rem; top: 1rem; background: var(--sc-panel); padding: .5rem; z-index: 2; }
.toc { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 1.5rem 1rem; border-right: 1px solid var(--sc-rule); font: 15px/1.45 "${fonts.sans}", system-ui, sans-serif; background: var(--sc-panel); }
.toc-title { font-weight: 600; margin: 0 0 1rem; }
.toc ol { list-style: none; padding-left: 0; margin: .2rem 0; } .toc ol ol { padding-left: .9rem; } .toc li { margin: .25rem 0; } .toc a { color: var(--sc-ink); text-decoration: none; } .toc a:hover { color: var(--sc-signal); text-decoration: underline; }
main { max-width: 46rem; padding: 2.5rem 2rem 6rem; margin: 0 auto; }
h1, h2, h3, h4, .label, .layer-label, .kicker, figcaption, .eq-where caption, table.report, .toc { font-family: "${fonts.sans}", system-ui, sans-serif; }
h1 { font-size: 2.4rem; line-height: 1.15; margin: 0 0 .3rem; } .subtitle { font: 1.25rem/1.3 "${fonts.sans}", sans-serif; color: var(--sc-muted); margin: 0 0 1rem; }
.byline { color: var(--sc-muted); font-family: "${fonts.sans}", sans-serif; } .colophon { font-size: .85rem; color: var(--sc-muted); }
h2 { font-size: 1.9rem; margin: 3.5rem 0 1rem; font-weight: 600; } h3 { font-size: 1.35rem; margin: 2.5rem 0 .8rem; font-weight: 600; } h4 { margin: 1.5rem 0 .5rem; }
.kicker { color: var(--sc-muted); margin: 4rem 0 -0.8rem; font-size: .95rem; }
.chapter { border-top: 1px solid var(--sc-rule); }
.layer { margin: 1.1rem 0; } .layer-label { font-size: .78rem; letter-spacing: .04em; color: var(--sc-muted); font-weight: 600; margin-bottom: .2rem; }
.goals, .takeaways, .example { background: var(--sc-panel); border-radius: 8px; padding: .8rem 1rem; margin: 1.2rem 0; }
.takeaways { background: transparent; border: 1px solid var(--sc-rule); }
.label { font-weight: 600; font-size: .9rem; }
.callout { border-left: 4px solid var(--sc-signal); background: var(--sc-panel); padding: .7rem 1rem; margin: 1.2rem 0; border-radius: 0 8px 8px 0; }
.callout p { margin: .3rem 0 0; } .callout.consensus { border-color: var(--sc-verified); } .callout.debate, .callout.safety { border-color: var(--sc-accent); } .callout.example { border-color: var(--sc-muted); }
.equation { margin: 1.6rem 0; } .eq-intuition { font-style: italic; margin-bottom: .2rem; }
.eq-row { display: flex; align-items: center; gap: 1rem; } .eq-math { flex: 1; overflow-x: auto; } .eq-num { color: var(--sc-muted); font-family: "${fonts.sans}", sans-serif; white-space: nowrap; }
.eq-where { border-collapse: collapse; font-size: .92rem; margin: .2rem 0 .6rem; } .eq-where caption { text-align: left; color: var(--sc-muted); font-size: .8rem; }
.eq-where td { padding: .15rem .8rem .15rem 0; vertical-align: top; } .eq-where .unit { color: var(--sc-muted); white-space: nowrap; }
.check { font-size: .78rem; color: var(--sc-muted); margin: .3rem 0 0; overflow-wrap: anywhere; } .validity { font-size: .9rem; } .validity .label { font-size: .9rem; }
figure { margin: 1.8rem auto; width: min(100%, var(--w, 100%)); } figure img { width: 100%; height: auto; display: block; border-radius: 6px; }
figcaption { font-size: .88rem; line-height: 1.45; margin-top: .5rem; } .credit { color: var(--sc-muted); }
.model3d .views { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .5rem; }
.model3d .view img { border: 1px solid var(--sc-rule); border-radius: 6px; }
.model3d .view-label { margin: .2rem 0 0; text-align: center; font: .8rem "${fonts.sans}", sans-serif; color: var(--sc-muted); }
.model3d .interactive { font-family: "${fonts.sans}", sans-serif; font-size: .9rem; margin: .4rem 0 0; overflow-wrap: anywhere; }
.viewer3d { border: 1px solid var(--sc-rule); border-radius: 8px; background: var(--sc-paper); max-width: 26rem; margin: 0 auto .5rem; }
.viewer3d svg { display: block; width: 100%; height: auto; touch-action: none; cursor: grab; }
.viewer3d svg:active { cursor: grabbing; }
.viewer3d svg:focus-visible { outline: 2px solid var(--sc-signal); outline-offset: 2px; }
.viewer3d .controls { display: flex; flex-wrap: wrap; gap: .4rem .8rem; align-items: center; padding: .4rem .6rem; border-top: 1px solid var(--sc-rule); font: .85rem "${fonts.sans}", sans-serif; color: var(--sc-muted); }
.viewer3d button { font: inherit; border: 1px solid var(--sc-rule); background: var(--sc-panel); color: var(--sc-ink); border-radius: 6px; padding: .15rem .6rem; cursor: pointer; }
.model3d.js-3d .views { display: none; }
table.key-eqs td { padding: .35rem .8rem .35rem 0; vertical-align: middle; }
.refs { padding-left: 0; list-style: none; } .refs li { margin: .5rem 0; padding-left: 2.6rem; text-indent: -2.6rem; font-size: .95rem; } .refs .n { display: inline-block; width: 2.6rem; text-indent: 0; color: var(--sc-muted); }
dt { font-weight: 600; font-family: "${fonts.sans}", sans-serif; margin-top: .8rem; } dd { margin-left: 0; }
table.report { border-collapse: collapse; font-size: .82rem; width: 100%; } .report th, .report td { border: 1px solid var(--sc-rule); padding: .35rem .45rem; vertical-align: top; text-align: left; }
.status { font-weight: 600; } .status.verified { color: var(--sc-verified); } .status.failed, .status.unverified { color: var(--sc-accent); }
code { font-size: .88em; }
.katex { font-size: 1.05em; }
.hook { font-size: 1.2rem; line-height: 1.5; margin: 1rem 0 1.4rem; }
.prereq { margin: .6rem 0 0; font-size: .92rem; }
.learn { border: 1px solid var(--sc-rule); border-radius: 10px; padding: .9rem 1.1rem; margin: 1.6rem 0; }
.learn-head { display: flex; flex-wrap: wrap; gap: .6rem; align-items: baseline; margin-bottom: .4rem; font-family: "${fonts.sans}", sans-serif; }
.learn-kind { font-weight: 600; } .to-eq { font-size: .88rem; margin-left: auto; }
.level { font: 600 .74rem/1 "${fonts.sans}", sans-serif; letter-spacing: .03em; padding: .2rem .45rem; border-radius: 999px; background: var(--sc-panel); color: var(--sc-muted); }
.level.stretch { color: var(--sc-signal); } .level.challenge { color: var(--sc-accent); }
.learn p { margin: .45rem 0; } .goal, .statement { font-weight: 600; }
.steps { counter-reset: step; list-style: none; padding: 0; margin: .6rem 0; }
.steps > li { counter-increment: step; display: grid; grid-template-columns: 1.6rem minmax(0, 1fr); column-gap: .4rem; padding: .35rem 0; border-top: 1px dashed var(--sc-rule); }
.steps > li::before { content: counter(step); grid-row: 1 / span 2; font: 600 .82rem "${fonts.sans}", sans-serif; color: var(--sc-muted); padding-top: .9rem; }
.step-math { overflow-x: auto; } .step-math .katex-display { margin: .3rem 0; } .step-math .katex-display > .katex { text-align: left; }
.why { font-size: .92rem; color: var(--sc-muted); margin: 0 !important; }
.steps > li:not(:has(.step-math))::before { padding-top: .1rem; }
.given-find, .exp-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .4rem 1.4rem; }
.given-find ul, .exp-cols ul, .exp-cols ol { margin: .2rem 0; padding-left: 1.2rem; }
.answer { font-weight: 600; } .sanity { font-size: .92rem; }
.pox { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: .3rem 1rem; margin: .6rem 0; }
.pox dt { margin: 0; font-size: .9rem; color: var(--sc-muted); } .pox dd { margin: 0; }
.safety-line { font-size: .9rem; border-left: 3px solid var(--sc-accent); padding-left: .6rem; }
.misconception { border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-rule)); }
.application { background: var(--sc-panel); border: 0; } .app-title { color: var(--sc-muted); } .numbers { font-size: .92rem; }
table.data { border-collapse: collapse; font-size: .88rem; margin: .5rem 0; font-variant-numeric: tabular-nums; } table.data th, table.data td { border-bottom: 1px solid var(--sc-rule); padding: .25rem .8rem .25rem 0; text-align: left; }
.data-source { font-size: .8rem; color: var(--sc-muted); }
.exercises { list-style: none; padding: 0; } .exercises > li { padding: .6rem 0; border-top: 1px solid var(--sc-rule); }
.ex-num { font: 600 .9rem "${fonts.sans}", sans-serif; margin-right: .4rem; }
.exercises details { margin-top: .4rem; } .exercises summary { cursor: pointer; font: .9rem "${fonts.sans}", sans-serif; color: var(--sc-signal); }
@media (max-width: 820px) { body { display: block; font-size: 17px; } .toc { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--sc-rule); } main { padding: 1.5rem 16px 4rem; } h1 { font-size: 1.9rem; } }
@media print { .toc { display: none; } body { display: block; } }
`;
}

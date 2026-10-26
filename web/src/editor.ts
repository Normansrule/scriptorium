/**
 * Step 2, Edit: change any words in the book by typing, then check them in the preview.
 *
 * Every keystroke edits the project's book directly and the problems list is re-checked
 * (citations, glossary links, equations), so nothing that would break the build can reach
 * Publish unnoticed. Structure (sections, figures, equations' symbols) stays fixed; words,
 * titles, captions and the store listing are all editable.
 */
import katex from 'katex';
import type { Block, Book, Section } from '../../src/core/book.ts';
import { BOOK_STYLES, type BookStyleId } from '../../src/core/bookstyle.ts';
import { concisionSummary, lintBook } from '../../src/core/concision.ts';
import { clone, problems, type Project } from './project.ts';
import { field, h, prose } from './ui.ts';

export interface EditorHost {
  project: Project;
  /** called after every change (autosave, problem count in the stepper) */
  changed(): void;
  /** the rendered, sanitized book for the Preview tab */
  preview(): HTMLElement;
}

type Target = { kind: 'details' } | { kind: 'section'; ch: number; s: number } | { kind: 'chapter'; ch: number };

let target: Target = { kind: 'details' };
let mode: 'edit' | 'preview' = 'edit';
let targetFor: Project | null = null;

/** The selection belongs to one book; a section index from another book must never be reused. */
function validTarget(book: Book, t: Target): Target {
  if (t.kind === 'chapter' && book.chapters[t.ch]) return t;
  if (t.kind === 'section' && book.chapters[t.ch]?.sections[t.s]) return t;
  return { kind: 'details' };
}

const LAYERS: Array<[keyof Section['layers'] & ('summary' | 'intuition' | 'formal' | 'limits'), string, string]> = [
  ['summary', 'In short', 'One or two paragraphs a reader can stop after.'],
  ['intuition', 'Intuition', 'An analogy or picture before any math.'],
  ['formal', 'The detail', 'Equations, figures and the full explanation.'],
  ['limits', 'Limits', 'Where the idea stops being true.'],
];

const MARKUP_HELP = 'Formatting: **bold**, *italic*, $math$, [@source-id] cites a verified source, [[term]] links the glossary.';

export function editorView(host: EditorHost, opts: { startInPreview?: boolean } = {}): HTMLElement {
  const p = host.project;
  if (targetFor !== p) {
    targetFor = p;
    target = { kind: 'details' };
    mode = opts.startInPreview ? 'preview' : 'edit';
  }
  target = validTarget(p.book, target);
  const status = h('div', { class: 'edit-status' });
  const announce = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  let lastCount = -1;
  const refresh = () => {
    const list = problems(p);
    // announce only when the number of problems changes, not on every keystroke
    if (list.length !== lastCount) announce.textContent = list.length ? `${list.length} ${list.length === 1 ? 'problem' : 'problems'} to fix.` : 'The book builds.';
    lastCount = list.length;
    status.replaceChildren(
      list.length
        ? h('details', { class: 'problems', open: true }, h('summary', {}, `${list.length} ${list.length === 1 ? 'thing' : 'things'} to fix before publishing`), h('ul', {}, ...list.map((x) => h('li', {}, x))))
        : h('p', { class: 'ok-line' }, p.origin === 'sample' ? '✓ The book builds. (This is a sample: edits are not kept.)' : '✓ The book builds. Edits are saved on this device as you type.'),
      ...[tighten()].filter((x): x is HTMLDetailsElement => !!x),
    );
  };
  // Padding is advice, never a blocker: words that do no work, with a fix for each.
  const tighten = () => {
    if (list().length) return null;
    const r = lintBook(p.book);
    return h('details', { class: 'tighten' },
      h('summary', {}, concisionSummary(r)),
      r.findings.length ? h('ul', {}, ...r.findings.slice(0, 40).map((f) => h('li', {}, `${f.where}: “${f.text}” — ${f.fix}`))) : null,
    );
  };
  const list = () => problems(p);
  const onChange = () => {
    host.changed();
    refresh();
  };
  refresh();

  const body = h('div', { class: 'edit-body', id: 'edit-panel', role: 'tabpanel' });
  const nav = h('nav', { class: 'edit-nav', 'aria-label': 'Book contents' });
  const drawNav = () => {
    const item = (t: Target, label: string, cls = '') =>
      h('button', { class: `nav-item ${cls}${same(t, target) ? ' active' : ''}`, 'aria-current': same(t, target) ? 'true' : undefined, onclick: () => { target = t; mode = 'edit'; draw(); } }, label);
    nav.replaceChildren(
      item({ kind: 'details' }, 'Title, cover text and listing', 'details'),
      ...p.book.chapters.flatMap((ch, ci) => [
        item({ kind: 'chapter', ch: ci }, `${ci + 1}. ${ch.title}`, 'chapter'),
        ...ch.sections.map((s, si) => item({ kind: 'section', ch: ci, s: si }, `${ci + 1}.${si + 1} ${s.title}`, 'section')),
      ]),
    );
  };
  const draw = () => {
    drawNav();
    tabs.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.mode === mode));
      b.tabIndex = b.dataset.mode === mode ? 0 : -1;
    });
    body.setAttribute('aria-labelledby', `tab-${mode}`);
    if (mode === 'preview') {
      body.replaceChildren(host.preview());
      return;
    }
    body.replaceChildren(
      target.kind === 'details' ? detailsEditor(p.book, onChange) : target.kind === 'chapter' ? chapterEditor(p.book, target.ch, onChange) : sectionEditor(p.book, target.ch, target.s, onChange),
    );
  };
  const tab = (m: typeof mode, label: string) =>
    h('button', { role: 'tab', class: 'tab', id: `tab-${m}`, 'aria-controls': 'edit-panel', 'data-mode': m, onclick: () => { mode = m; draw(); } }, label);
  const tabs = h('div', { class: 'mode-tabs', role: 'tablist', 'aria-label': 'Edit or preview' }, tab('edit', 'Edit'), tab('preview', 'Preview'));
  tabs.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    mode = mode === 'edit' ? 'preview' : 'edit';
    draw();
    (tabs.querySelector(`[data-mode="${mode}"]`) as HTMLButtonElement | null)?.focus();
  });
  const undo = p.original
    ? h('button', { class: 'secondary small', onclick: (e: Event) => {
        if (!confirmInline(e.currentTarget as HTMLButtonElement, 'Undo every edit?')) return;
        p.book = clone(p.original!);
        onChange();
        draw();
      } }, 'Undo all edits')
    : null;
  draw();
  return h('section', { class: 'editor' },
    h('div', { class: 'edit-head' }, h('div', {}, h('h1', {}, 'Edit the book'), h('p', { class: 'hint' }, 'Type straight into any paragraph. ', MARKUP_HELP)), h('div', { class: 'edit-tools' }, tabs, undo)),
    status,
    announce,
    h('div', { class: 'edit-grid' }, nav, body),
  );
}

/** Two-click confirmation without a browser dialog: the first click arms the button. */
function confirmInline(btn: HTMLButtonElement, question: string): boolean {
  if (btn.dataset.armed === '1') {
    btn.dataset.armed = '';
    btn.textContent = btn.dataset.label ?? btn.textContent;
    if (btn.dataset.aria) btn.setAttribute('aria-label', btn.dataset.aria);
    else btn.removeAttribute('aria-label');
    return true;
  }
  btn.dataset.label = btn.textContent ?? '';
  btn.dataset.aria = btn.getAttribute('aria-label') ?? '';
  btn.dataset.armed = '1';
  btn.textContent = `${question} Click again`;
  btn.setAttribute('aria-label', `${question} Activate again to confirm.`);
  setTimeout(() => {
    if (btn.dataset.armed === '1') {
      btn.dataset.armed = '';
      btn.textContent = btn.dataset.label ?? '';
      if (btn.dataset.aria) btn.setAttribute('aria-label', btn.dataset.aria);
      else btn.removeAttribute('aria-label');
    }
  }, 4000);
  return false;
}

const same = (a: Target, b: Target) => JSON.stringify(a) === JSON.stringify(b);

function detailsEditor(book: Book, changed: () => void): HTMLElement {
  const m = book.meta;
  const text = (label: string, get: () => string, set: (v: string) => void, hint?: string) => {
    const i = h('input', { 'aria-label': label });
    i.value = get();
    i.addEventListener('input', () => {
      set(i.value);
      changed();
    });
    return field(label, i, hint);
  };
  const lines = (label: string, get: () => string[], set: (v: string[]) => void, hint: string) =>
    field(label, prose(get().join('\n'), label, (v) => { set(v.split('\n').map((x) => x.trim()).filter(Boolean)); changed(); }, 3), hint);
  return h('div', { class: 'edit-card' },
    h('h2', {}, 'Title, cover text and listing'),
    h('p', { class: 'hint' }, 'These words appear on the cover, the title page and the KDP listing, so they must match what you type into KDP.'),
    text('Title', () => m.title, (v) => (m.title = v)),
    text('Subtitle', () => m.subtitle ?? '', (v) => (m.subtitle = v || undefined)),
    text('Author(s), separated by commas', () => m.authors.join(', '), (v) => (m.authors = v.split(',').map((x) => x.trim()).filter(Boolean))),
    field('Description (back cover and store page)', prose(m.description ?? '', 'Description', (v) => { m.description = v || undefined; changed(); }, 5), 'Up to 4000 characters.'),
    lines('Keywords (one per line)', () => m.keywords ?? [], (v) => (m.keywords = v), 'Up to seven short phrases. Avoid "free", "bestselling", and words already in the title.'),
    lines('Categories (one per line)', () => m.categories ?? [], (v) => (m.categories = v), 'Up to three.'),
    field('Colophon (how the book was made)', prose(m.colophon ?? '', 'Colophon', (v) => { m.colophon = v || undefined; changed(); }, 3)),
    stylePicker(book, changed),
    text('Web address of the web edition (optional)', () => m.webUrl ?? '', (v) => (m.webUrl = v.trim() || undefined),
      'Where you will publish the web edition, e.g. https://you.github.io/my-book/. The print book and the ebook link and QR-code 3D models to it. Publish → Web edition saves the site.'),
  );
}

/**
 * The book's look: a row of swatch cards, one per style. A real radio group underneath, so it
 * works with the keyboard (arrow keys move the choice) and screen readers announce the names.
 */
function stylePicker(book: Book, changed: () => void): HTMLElement {
  const current = book.meta.style ?? 'classic';
  const group = h('div', { class: 'style-picker', role: 'radiogroup', 'aria-label': 'Book style' });
  for (const s of Object.values(BOOK_STYLES)) {
    const input = h('input', { type: 'radio', name: 'book-style', value: s.id });
    input.checked = s.id === current;
    input.addEventListener('change', () => {
      book.meta.style = s.id === 'classic' ? undefined : (s.id as BookStyleId);
      changed();
    });
    const t = s.light;
    group.append(
      h('label', { class: 'style-card' },
        input,
        h('span', { class: 'style-sample', 'aria-hidden': 'true', style: `--b:${t.band};--bi:${t.bandInk};--hd:${t.heading};--mk:${t.mark};--tn:${t.tint}` },
          h('span', { class: 'ss-chip' }, 'Chapter 1'),
          h('span', { class: 'ss-head' }, 'Aa'),
          h('span', { class: 'ss-box' }),
        ),
        h('span', { class: 'style-name' }, s.name),
        h('span', { class: 'style-desc' }, s.description),
      ),
    );
  }
  return h('fieldset', { class: 'style-field' },
    h('legend', {}, 'Book style'),
    h('p', { class: 'hint' }, 'The colour of chapter openers, headings and learning blocks, in print, the ebook, the web edition and the 3D Edition. Figures keep their colours, so a colour always means the same thing.'),
    group,
  );
}

function chapterEditor(book: Book, ci: number, changed: () => void): HTMLElement {
  const ch = book.chapters[ci]!;
  const title = h('input', { 'aria-label': 'Chapter title' });
  title.value = ch.title;
  title.addEventListener('input', () => {
    ch.title = title.value;
    changed();
  });
  const list = (label: string, arr: string[]) => field(label, prose(arr.join('\n'), label, (v) => { arr.splice(0, arr.length, ...v.split('\n').map((x) => x.trim()).filter(Boolean)); changed(); }, 3), 'One per line.');
  const hook = field('Hook (one or two sentences that make the reader want this chapter)', prose(ch.hook ?? '', 'Hook', (v) => { ch.hook = v.trim() || undefined; changed(); }, 2));
  const exercises = ch.exercises.map((e, i) =>
    h('div', { class: 'block exercise' },
      h('div', { class: 'block-label' }, `Practice ${ci + 1}.${i + 1} · ${e.level}`),
      field('Question', prose(e.prompt, 'Question', (v) => { e.prompt = v; changed(); }, 2)),
      field('Answer', prose(e.answer, 'Answer', (v) => { e.answer = v; changed(); }, 1)),
      stepsEditor(e.solution, changed, `Worked solution — checked by ${e.test}. If you change the numbers, update that test too.`),
    ),
  );
  return h('div', { class: 'edit-card' },
    h('h2', {}, `Chapter ${ci + 1}`),
    field('Chapter title', title),
    hook,
    list('Learning goals', ch.goals),
    list('What the reader should already know', ch.prerequisites),
    list('Chapter summary', ch.summary),
    ...(exercises.length ? [h('h3', {}, 'Practice'), ...exercises] : []),
  );
}

/** Steps of a derivation or solution: the maths (LaTeX, previewed) and the one-line reason. */
function stepsEditor(steps: Array<{ latex?: string; why: string }>, changed: () => void, hint: string): HTMLElement {
  return h('div', { class: 'steps-edit' },
    h('p', { class: 'hint' }, hint),
    ...steps.map((st, i) => {
      const latex = h('input', { 'aria-label': `Step ${i + 1} maths (LaTeX)`, class: 'mono', placeholder: 'maths (LaTeX), optional' });
      latex.value = st.latex ?? '';
      const preview = h('div', { class: 'eq-preview', 'aria-live': 'polite' });
      const show = () => {
        preview.replaceChildren();
        if (!st.latex) return;
        try {
          katex.render(st.latex, preview, { displayMode: true, throwOnError: true, trust: false, strict: 'error', output: 'mathml' });
          preview.classList.remove('bad');
        } catch (e) {
          preview.textContent = `Cannot read this maths: ${(e as Error).message}`;
          preview.classList.add('bad');
        }
      };
      latex.addEventListener('input', () => { st.latex = latex.value || undefined; show(); changed(); });
      show();
      return h('div', { class: 'step-edit' },
        h('span', { class: 'step-n' }, String(i + 1)),
        h('div', {}, latex, preview, prose(st.why, `Step ${i + 1}: why it follows`, (v) => { st.why = v; changed(); }, 1)),
      );
    }),
  );
}

function sectionEditor(book: Book, ci: number, si: number, changed: () => void): HTMLElement {
  const s = book.chapters[ci]!.sections[si]!;
  const title = h('input', { 'aria-label': 'Section title' });
  title.value = s.title;
  title.addEventListener('input', () => {
    s.title = title.value;
    changed();
  });
  const layers = LAYERS.map(([key, label, hint]) => {
    const blocks = s.layers[key];
    const wrap = h('div', { class: 'layer-edit' });
    const draw = () => {
      wrap.replaceChildren(
        h('h3', {}, label, h('small', { class: 'hint' }, ` — ${hint}`)),
        ...blocks.map((b, i) => blockEditor(b, changed, blocks, i, draw)),
        h('button', { class: 'add', onclick: () => { blocks.push({ kind: 'para', text: '' }); changed(); draw(); (wrap.querySelector('.block:last-of-type textarea') as HTMLTextAreaElement | null)?.focus(); } }, '+ Add a paragraph'),
      );
    };
    draw();
    return wrap;
  });
  const takeaways = field('Key takeaways', prose(s.layers.takeaways.join('\n'), 'Key takeaways', (v) => { s.layers.takeaways = v.split('\n').map((x) => x.trim()).filter(Boolean); changed(); }, 3), 'One per line.');
  return h('div', { class: 'edit-card' },
    h('h2', {}, `Section ${ci + 1}.${si + 1}`),
    field('Section title', title),
    h('p', { class: 'hint' }, 'Edited text still counts as AI-generated for KDP when the first draft came from the model; the AI disclosure stays “yes”.'),
    ...layers,
    takeaways,
  );
}

function blockEditor(b: Block, changed: () => void, siblings: Block[], index: number, redraw: () => void): HTMLElement {
  const removable = b.kind === 'para' || b.kind === 'callout' || b.kind === 'list';
  const remove = removable
    ? h('button', { class: 'remove', 'aria-label': 'Remove this paragraph', onclick: (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        if (!confirmInline(btn, 'Remove?')) return;
        siblings.splice(index, 1);
        changed();
        redraw();
      } }, 'Remove')
    : null;
  const box = (label: string, ...kids: Array<Node | null>) => h('div', { class: `block ${b.kind}` }, h('div', { class: 'block-label' }, label, remove), ...kids);
  switch (b.kind) {
    case 'para':
      return box('Paragraph', prose(b.text, 'Paragraph', (v) => { b.text = v; changed(); }));
    case 'callout': {
      const t = h('input', { 'aria-label': 'Box title', placeholder: 'Box title' });
      t.value = b.title ?? '';
      t.addEventListener('input', () => { b.title = t.value || undefined; changed(); });
      return box(`Box (${b.tone})`, t, prose(b.text, 'Box text', (v) => { b.text = v; changed(); }));
    }
    case 'list':
      return box('List (one item per line)', prose(b.items.join('\n'), 'List items', (v) => { b.items = v.split('\n').map((x) => x.trim()).filter(Boolean); changed(); }));
    case 'equation': {
      const latex = h('input', { 'aria-label': 'Equation (LaTeX)', class: 'mono' });
      latex.value = b.latex;
      const render = h('div', { class: 'eq-preview', 'aria-live': 'polite' });
      const show = () => {
        try {
          render.replaceChildren();
          katex.render(b.latex, render, { displayMode: true, throwOnError: true, trust: false, strict: 'error', output: 'mathml' });
          render.classList.remove('bad');
        } catch (e) {
          render.textContent = `Cannot read this equation: ${(e as Error).message}`;
          render.classList.add('bad');
        }
      };
      latex.addEventListener('input', () => { b.latex = latex.value; show(); changed(); });
      show();
      return box('Equation',
        field('One-sentence intuition', prose(b.intuition, 'Intuition', (v) => { b.intuition = v; changed(); }, 2)),
        field('Equation (LaTeX)', latex),
        render,
        field('Worked example', prose(b.example.text, 'Worked example', (v) => { b.example.text = v; changed(); }, 3), `Checked by ${b.example.check}. If you change the numbers, update that test too.`),
        field('Valid when', prose(b.validity, 'Valid when', (v) => { b.validity = v; changed(); }, 2)),
      );
    }
    case 'figure':
    case 'model3d':
      return box(b.kind === 'figure' ? 'Figure' : '3D model',
        field('Caption', prose(b.caption, 'Caption', (v) => { b.caption = v; changed(); }, 2)),
        field('Description for screen readers (alt text)', prose(b.alt, 'Alt text', (v) => { b.alt = v; changed(); }, 2)),
      );
    case 'derivation':
      return box('Derivation',
        field('Goal', prose(b.goal, 'Goal', (v) => { b.goal = v; changed(); }, 1)),
        field('Assumptions (one per line)', prose(b.assumptions.join('\n'), 'Assumptions', (v) => { b.assumptions = v.split('\n').map((x) => x.trim()).filter(Boolean); changed(); }, 2)),
        stepsEditor(b.steps, changed, `Each step: the maths, then the one law or move that justifies it. Re-derived by ${b.test}.`),
        field('Check (units, limits, special cases)', prose(b.check, 'Check', (v) => { b.check = v; changed(); }, 2)),
      );
    case 'problem':
      return box(`Worked problem (${b.level})`,
        field('Problem', prose(b.statement, 'Problem', (v) => { b.statement = v; changed(); }, 2)),
        field('Strategy (the idea before the algebra)', prose(b.strategy, 'Strategy', (v) => { b.strategy = v; changed(); }, 2)),
        stepsEditor(b.steps, changed, `Checked by ${b.test}. If you change the numbers, update that test too.`),
        field('Answer', prose(b.answer, 'Answer', (v) => { b.answer = v; changed(); }, 1)),
        field('Check', prose(b.check, 'Check', (v) => { b.check = v; changed(); }, 2)),
      );
    case 'experiment':
      return box(`Experiment (${b.type})`,
        field('Question', prose(b.question, 'Question', (v) => { b.question = v; changed(); }, 1)),
        field('Safety (required)', prose(b.safety, 'Safety', (v) => { b.safety = v; changed(); }, 2)),
        field('Predict', prose(b.predict, 'Predict', (v) => { b.predict = v; changed(); }, 2)),
        field('Observe', prose(b.observe, 'Observe', (v) => { b.observe = v; changed(); }, 2)),
        field('Explain', prose(b.explain, 'Explain', (v) => { b.explain = v; changed(); }, 3)),
      );
    case 'misconception':
      return box('Common mistake',
        field('The mistake', prose(b.wrong, 'The mistake', (v) => { b.wrong = v; changed(); }, 1)),
        field('Why it’s tempting', prose(b.tempting, 'Why it is tempting', (v) => { b.tempting = v; changed(); }, 2)),
        field('What’s true', prose(b.right, 'What is true', (v) => { b.right = v; changed(); }, 2)),
        field('How to tell', prose(b.test, 'How to tell', (v) => { b.test = v; changed(); }, 2)),
      );
    case 'application': {
      const t = h('input', { 'aria-label': 'Where it is used' });
      t.value = b.title;
      t.addEventListener('input', () => { b.title = t.value; changed(); });
      return box('In practice', field('Where it is used', t), field('How the idea applies', prose(b.text, 'In practice', (v) => { b.text = v; changed(); }, 3)));
    }
    case 'explore': {
      const t = h('input', { 'aria-label': 'Explore title' });
      t.value = b.title;
      t.addEventListener('input', () => { b.title = t.value; changed(); });
      // one row per slider: label, unit, low, default, high (numbers are re-checked by the build)
      const num = (get: () => number, set: (v: number) => void, label: string) => {
        const i = h('input', { type: 'number', 'aria-label': label, step: 'any', class: 'num' });
        i.value = String(get());
        i.addEventListener('change', () => {
          const v = Number(i.value);
          if (Number.isFinite(v)) { set(v); changed(); } else i.value = String(get());
        });
        return i;
      };
      const rows = b.params.map((p) =>
        h('tr', {},
          h('th', { scope: 'row' }, h('code', {}, p.name)),
          h('td', {}, (() => { const i = h('input', { 'aria-label': `Label for ${p.name}` }); i.value = p.label; i.addEventListener('input', () => { p.label = i.value; changed(); }); return i; })()),
          h('td', {}, num(() => p.min, (v) => (p.min = v), `Lowest ${p.name}`)),
          h('td', {}, num(() => p.value, (v) => (p.value = v), `Default ${p.name}`)),
          h('td', {}, num(() => p.max, (v) => (p.max = v), `Highest ${p.name}`)),
          h('td', {}, p.unit || '—'),
        ),
      );
      return box('Explore (sliders and a live plot)',
        field('Title', t),
        field('What to try (a question the sliders answer)', prose(b.prompt, 'What to try', (v) => { b.prompt = v; changed(); }, 2)),
        h('table', { class: 'param-table' },
          h('thead', {}, h('tr', {}, ...['Slider', 'Label', 'Low', 'Default', 'High', 'Unit'].map((x) => h('th', { scope: 'col' }, x)))),
          h('tbody', {}, ...rows),
        ),
        h('p', { class: 'hint' }, `Curves: ${b.plot.series.map((x) => x.expr).join(' · ')}. Readouts are re-checked at the defaults by ${b.test}; if you change a default, update that test too.`),
        field('What to notice (printed under the stills)', prose(b.notice, 'What to notice', (v) => { b.notice = v; changed(); }, 2)),
      );
    }
    case 'quiz': {
      const group = `correct-${b.id}`;
      const opts = b.options.map((o, i) => {
        const r = h('input', { type: 'radio', name: group, 'aria-label': `Answer ${String.fromCharCode(97 + i)} is the correct one` });
        r.checked = o.correct;
        r.addEventListener('change', () => { b.options.forEach((x, j) => (x.correct = j === i)); changed(); redraw(); });
        return h('div', { class: `quiz-option-edit${o.correct ? ' is-right' : ''}` },
          h('label', { class: 'correct-pick' }, r, h('span', {}, `Answer (${String.fromCharCode(97 + i)})`), h('small', {}, o.correct ? 'the right answer' : 'mark as the right answer')),
          field('What the answer says', prose(o.text, `Answer ${i + 1}`, (v) => { o.text = v; changed(); }, 1)),
          field(o.correct ? 'Why it is right' : 'Why it is wrong (name the slip)', prose(o.why, `Why ${i + 1}`, (v) => { o.why = v; changed(); }, 1)),
        );
      });
      return box('Check yourself', field('Question', prose(b.question, 'Question', (v) => { b.question = v; changed(); }, 2)), ...opts);
    }
  }
}

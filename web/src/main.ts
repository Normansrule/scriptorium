/**
 * Scriptorium app (GitHub Pages + desktop). Three steps, one button each:
 *
 *   1 Write    type a topic → Generate (the model plans, you approve the plan, it drafts)
 *   2 Edit     type changes into any paragraph; Preview shows the finished book
 *   3 Publish  build the KDP package in the app, pass the checks, save it
 *
 * Plain TypeScript and DOM, no framework. Text is inserted with textContent; the only HTML
 * inserted is the book proof, produced by our renderer and sanitized with DOMPurify.
 */
import 'katex/dist/katex.min.css';
import './app.css';
import DOMPurify from 'dompurify';
import { approve, newState, runPipeline, STAGES, type Outline, type PipelineState, type Scope, type StageId, type StageStatus } from '../../src/core/pipeline.ts';
import { Bibliography, Book } from '../../src/core/book.ts';
import { Profile } from '../../src/core/profile.ts';
import { Model } from '../../src/core/molecule.ts';
import { Budget } from '../../src/llm/budget.ts';
import { AnthropicProvider } from '../../src/llm/provider.ts';
import { numberBook } from '../../src/render/numbering.ts';
import { formatBibliography } from '../../src/render/cite.ts';
import { bookCss, renderHtml } from '../../src/render/html.ts';
import { mountAll } from '../../src/render/viewer3d-client.ts';
import { buildDisclosure } from '../../src/disclosure/ai-disclosure.ts';
import { KITS as SCENE_KITS } from '../../src/edition3d/kits.ts';
import { PURIFY_CONFIG } from '../../src/export/sanitize.ts';
import { cssVariables } from '../../src/core/style.ts';
import localeXml from '../../styles/locales-en-US.xml?raw';
import serifRegular from 'source-serif/TTF/SourceSerif4-Regular.ttf?url';
import serifItalic from 'source-serif/TTF/SourceSerif4-It.ttf?url';
import serifSemibold from 'source-serif/TTF/SourceSerif4-Semibold.ttf?url';
import sansRegular from 'source-sans/TTF/SourceSans3-Regular.ttf?url';
import sansSemibold from 'source-sans/TTF/SourceSans3-Semibold.ttf?url';
import { isDesktop, keyStore } from './keystore.ts';
import { autosave, clone, fromFile, fromPipeline, problems, restore, toFile, type Project } from './project.ts';
import { editorView } from './editor.ts';
import { publishView, readLog } from './publish.ts';
import { field, h, saveFile, select, slugify } from './ui.ts';

// Every profile in profiles/ and every CSL style in styles/ is picked up automatically.
const profileFiles = import.meta.glob('../../profiles/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const styleFiles = import.meta.glob('../../styles/*.csl', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const PROFILES = Object.values(profileFiles).map((p) => Profile.parse(p)).sort((a, b) => (a.id === 'engineering' ? -1 : b.id === 'engineering' ? 1 : a.name.localeCompare(b.name)));
const STYLES: Record<string, string> = Object.fromEntries(Object.entries(styleFiles).map(([path, xml]) => [path.split('/').pop()!.replace(/\.csl$/, ''), xml]));
const STYLE_LABELS: Record<string, string> = { ieee: 'IEEE', 'american-chemical-society': 'ACS', 'american-medical-association': 'AMA', nature: 'Nature' };

// Sample books: every folder in examples/ with a book.json.
const sampleBooks = import.meta.glob('../../examples/*/book.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const sampleRefs = import.meta.glob('../../examples/*/references.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const sampleFigures = import.meta.glob('../../examples/*/figures/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const sampleModels = import.meta.glob('../../examples/*/models/*.json', { import: 'default', eager: true }) as Record<string, unknown>;
const SAMPLES = Object.keys(sampleBooks)
  .map((path) => {
    const dir = path.split('/').slice(-2, -1)[0]!;
    return { dir, book: Book.parse(sampleBooks[path]), refs: Bibliography.parse(sampleRefs[path.replace('book.json', 'references.json')]) };
  })
  .sort((a, b) => (a.dir === 'rc-circuits' ? -1 : b.dir === 'rc-circuits' ? 1 : a.dir.localeCompare(b.dir)));

// ---------------------------------------------------------------------------
// State

let apiKey = '';
let model = 'claude-sonnet-5-5';
const store = keyStore();
let storeError = '';

type View = 'write' | 'edit' | 'publish' | 'samples' | 'settings';
let view: View = 'write';
/** Figures from project files are only shown as images, but they also go into the EPUB, so they are sanitized with DOMPurify's SVG profile. */
function sanitizeSvg(svg: string): string {
  const clean = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['foreignObject', 'script', 'animate', 'set', 'animateMotion', 'animateTransform', 'iframe'] });
  return /^<svg[^>]*\sxmlns=/.test(clean) ? clean : clean.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

let project: Project | null = restore(sanitizeSvg);
let st: PipelineState | null = null; // a generation run in progress
let budget: Budget | null = null;
let busy = false;
let notice = '';
const log: string[] = [];

const app = document.getElementById('app')!;
const profileOf = (id: string) => PROFILES.find((p) => p.id === id) ?? PROFILES[0]!;

void store
  .load()
  .then((k) => {
    apiKey = k;
    if (k) render();
  })
  .catch((e: Error) => {
    storeError = `Could not read the saved key: ${e.message ?? e}`;
  });

function changed(): void {
  const r = autosave(project);
  if (r === 'too-large') notice = 'This book is too large to keep on this device automatically. Use Save project to keep a copy.';
  drawStepper();
}

// ---------------------------------------------------------------------------
// Layout: top bar with the three steps

const stepper = h('nav', { class: 'steps', 'aria-label': 'Steps' });

function drawStepper(): void {
  const probs = project ? problems(project).length : 0;
  const step = (v: View, n: number, label: string, sub: string, enabled: boolean) =>
    h('button', { class: `step${view === v ? ' active' : ''}`, disabled: !enabled, 'aria-current': view === v ? 'step' : undefined, onclick: () => go(v) },
      h('span', { class: 'step-n', 'aria-hidden': 'true' }, String(n)),
      h('span', { class: 'step-text' }, h('span', { class: 'step-label' }, label), h('span', { class: 'step-sub' }, sub)),
    );
  stepper.replaceChildren(
    step('write', 1, 'Write', st && busy ? 'Generating…' : 'Topic → book', true),
    step('edit', 2, 'Edit', !project ? 'No book yet' : probs ? `${probs} to fix` : 'Type changes', !!project),
    step('publish', 3, 'Publish', project?.origin === 'sample' ? 'Practice' : 'Check → save', !!project),
  );
}

function render(): void {
  drawStepper();
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', 'aria-label': 'Open a project file' });
  fileInput.addEventListener('change', () => void openFile(fileInput));
  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('button', { class: 'brand', onclick: () => go('write') }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Scriptorium'),
      stepper,
      h('nav', { class: 'topnav', 'aria-label': 'Project' },
        h('button', { class: 'link', onclick: () => fileInput.click() }, 'Open'),
        project ? h('button', { class: 'link', onclick: () => saveFile(`${slugify(project!.book.meta.title)}.scriptorium.json`, toFile(project!), 'application/json') }, 'Save project') : null,
        h('button', { class: 'link', onclick: () => go('samples') }, 'Samples'),
        h('button', { class: 'link', onclick: () => go('settings') }, apiKey ? 'Settings ✓' : 'Settings'),
        fileInput,
      ),
    ),
    replaceBanner(),
    notice ? h('div', { class: 'notice', role: 'status' }, notice, h('button', { class: 'link', onclick: () => { notice = ''; render(); } }, 'Dismiss')) : '',
    h('main', { id: 'main', class: `panel view-${view}`, tabindex: '-1' }, panel()),
  );
}

function go(v: View): void {
  view = v;
  render();
  document.getElementById('main')?.focus();
  window.scrollTo(0, 0);
}

function panel(): Node {
  switch (view) {
    case 'settings':
      return settingsView();
    case 'samples':
      return samplesView();
    case 'edit':
      return project ? editorView({ project, changed, preview: () => proofDom(project!) }, { startInPreview: project.origin === 'sample' }) : writeView();
    case 'publish':
      return project
        ? publishView({ project, profile: profileOf(project.book.meta.profile), csl: { styleXml: STYLES[project.book.meta.citationStyle] ?? STYLES.ieee!, localeXml }, goEdit: () => go('edit') })
        : writeView();
    default:
      return st && (busy || st.status.outline === 'waiting-for-you' || Object.values(st.status).includes('failed')) ? runView() : writeView();
  }
}

// ---------------------------------------------------------------------------
// 1 · Write

function writeView(): Node {
  let profileId = PROFILES[0]!.id;
  const chips = h('div', { class: 'domain-chips', role: 'radiogroup', 'aria-label': 'Domain' });
  const styleSelect = select('style', Object.keys(STYLES), Object.keys(STYLES).map((s) => STYLE_LABELS[s] ?? s), profileOf(profileId).citationStyle);
  const note = h('p', { class: 'hint' });
  const drawChips = () => {
    chips.replaceChildren(
      ...PROFILES.map((p) =>
        h('button', { type: 'button', role: 'radio', class: `chip-btn${p.id === profileId ? ' on' : ''}`, 'aria-checked': String(p.id === profileId), onclick: () => { profileId = p.id; styleSelect.value = p.citationStyle; drawChips(); } }, p.name),
      ),
    );
    const p = profileOf(profileId);
    note.textContent = p.requiresProfessionalReview ? `${p.name} books are for education only and must be reviewed by a licensed professional before publishing.` : '';
  };
  drawChips();
  const topic = h('textarea', { name: 'topic', rows: '3', required: true, placeholder: 'e.g. How lithium-ion batteries store and release energy', 'aria-label': 'What should the book explain?' });
  const form = h('form', { class: 'write', onsubmit: (e: Event) => { e.preventDefault(); void start(new FormData(e.target as HTMLFormElement), profileId); } },
    h('h1', {}, 'What should the book explain?'),
    h('p', { class: 'lede' }, 'Type a topic and press Generate. You approve the plan before anything is written, then edit and publish. Every source is looked up and verified before it can be cited.'),
    topic,
    chips,
    note,
    h('details', { class: 'more' }, h('summary', {}, 'More options'),
      h('div', { class: 'row' },
        field('Audience', h('input', { name: 'audience', value: 'Curious newcomers with high-school algebra' })),
        field('Depth', select('depth', ['introductory', 'intermediate', 'advanced'])),
        field('Author name', h('input', { name: 'author', value: 'Scriptorium' })),
      ),
      h('div', { class: 'row' },
        field('Chapters', h('input', { name: 'chapters', type: 'number', min: '1', max: '12', value: '3' })),
        field('Sections per chapter', h('input', { name: 'sections', type: 'number', min: '1', max: '6', value: '2' })),
        field('Citation style', styleSelect),
      ),
      h('div', { class: 'row' },
        field('Token cap for this book', h('input', { name: 'cap', type: 'number', min: '10000', step: '10000', value: '400000' }), 'The run stops before any call that could pass the cap.'),
        field('Requests per minute', h('input', { name: 'rpm', type: 'number', min: '1', max: '200', value: '20' })),
      ),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'primary big', type: 'submit', disabled: busy }, apiKey ? 'Generate book' : 'Add an API key to generate'),
      h('button', { class: 'secondary', type: 'button', onclick: () => go('samples') }, 'Try a sample book'),
    ),
    project && project.origin !== 'sample' ? h('p', { class: 'hint' }, 'Your current book, ', h('strong', {}, project.book.meta.title), ', is kept on this device. Generating a new one replaces it — use Save project first to keep a copy.') : null,
  );
  return form;
}

function deps() {
  const profile = profileOf(st!.scope.profileId);
  return {
    provider: new AnthropicProvider({ apiKey, model, browser: true }),
    budget: budget!,
    profile,
    onEvent: (e: { stage: StageId; status: StageStatus; message?: string }) => {
      if (e.message) log.push(`${STAGES.find((s) => s.id === e.stage)!.name}: ${e.message}`);
      if (view === 'write') render();
    },
  };
}

async function start(fd: FormData, profileId: string, replaceOk = false): Promise<void> {
  if (!apiKey) return go('settings');
  if (!replaceOk) return replaceGuard(() => void start(fd, profileId, true));
  const topic = String(fd.get('topic') ?? '').trim();
  if (!topic) return;
  const scope: Scope = {
    topic,
    audience: String(fd.get('audience') ?? ''),
    depth: (fd.get('depth') as Scope['depth']) ?? 'introductory',
    chapters: Number(fd.get('chapters') ?? 3),
    sectionsPerChapter: Number(fd.get('sections') ?? 2),
    profileId,
    citationStyle: String(fd.get('style') ?? profileOf(profileId).citationStyle),
    author: String(fd.get('author') ?? 'Scriptorium').trim() || 'Scriptorium',
  };
  st = newState(scope);
  budget = new Budget({ capTokens: Number(fd.get('cap') ?? 400000), requestsPerMinute: Number(fd.get('rpm') ?? 20) });
  log.length = 0;
  await advance();
}

async function advance(): Promise<void> {
  busy = true;
  go('write');
  await runPipeline(st!, deps());
  busy = false;
  if (st!.status.export === 'waiting-for-you' || st!.status.export === 'done') {
    project = fromPipeline(st!);
    changed();
    notice = 'Your book is drafted. Read it in Preview, change anything by typing, then go to Publish.';
    st = null;
    go('edit');
  } else go('write');
}

function runView(): Node {
  if (st!.status.outline === 'waiting-for-you' && st!.outline) return outlineView(st!);
  const failed = Object.entries(st!.status).find(([, s]) => s === 'failed');
  const stages = STAGES.map((s, i) => {
    const status = st!.status[s.id];
    return h('li', { class: `stage ${status}${s.checkpoint ? ' checkpoint' : ''}` },
      h('span', { class: 'dot', 'aria-hidden': 'true' }, status === 'done' ? '✓' : String(i + 1)),
      h('div', {}, h('div', { class: 'stage-name' }, s.name), h('div', { class: 'stage-what' }, s.what), h('div', { class: 'sr-only' }, `Status: ${status.replace(/-/g, ' ')}`)),
    );
  });
  return h('section', {},
    h('h1', {}, failed ? 'The run stopped' : 'Generating your book'),
    h('p', { class: 'lede' }, failed ? 'Read the problem below, fix it (for example, raise the token cap under More options), and press Generate again.' : 'You can leave this open; nothing is published until you choose to.'),
    budget ? h('p', { class: 'hint' }, `${budget.spent.toLocaleString()} of ${budget.opts.capTokens.toLocaleString()} tokens used`) : null,
    h('div', { class: 'run-grid' },
      h('ol', { class: 'stages' }, ...stages),
      h('ol', { class: 'log', 'aria-live': 'polite' }, ...log.slice(-14).map((l) => h('li', {}, l))),
    ),
    reportList(st!.report),
    failed ? h('div', { class: 'actions' }, h('button', { class: 'secondary', onclick: () => { st = null; go('write'); } }, 'Back to Write')) : null,
  );
}

function outlineView(state: PipelineState): Node {
  const o = state.outline!;
  const title = h('input', { value: o.title, 'aria-label': 'Book title' });
  const chapters = o.chapters.map((c) => ({
    c,
    title: h('input', { value: c.title, 'aria-label': 'Chapter title' }),
    goals: h('textarea', { rows: String(Math.max(2, c.goals.length)), 'aria-label': 'Learning goals, one per line' }),
    sections: c.sections.map((s) => ({ s, title: h('input', { value: s.title, 'aria-label': 'Section title' }) })),
  }));
  chapters.forEach((x) => (x.goals.value = x.c.goals.join('\n')));
  const approveIt = () => {
    const edited: Outline = {
      ...o,
      title: title.value.trim() || o.title,
      chapters: chapters.map((x) => ({ ...x.c, title: x.title.value.trim() || x.c.title, goals: x.goals.value.split('\n').map((g) => g.trim()).filter(Boolean), sections: x.sections.map((y) => ({ ...y.s, title: y.title.value.trim() || y.s.title })) })),
    };
    approve(state, 'outline', edited);
    void advance();
  };
  return h('section', { class: 'checkpoint-panel' },
    h('p', { class: 'checkpoint-flag' }, 'Your decision'),
    h('h1', {}, 'Check the plan'),
    h('p', { class: 'lede' }, 'Change any title or learning goal. Research and writing start only when you press Continue.'),
    field('Book title', title),
    ...chapters.map((x, i) =>
      h('fieldset', { class: 'chapter-edit' },
        h('legend', {}, `Chapter ${i + 1}`),
        field('Title', x.title),
        field('Learning goals (one per line)', x.goals),
        h('div', { class: 'sections' }, ...x.sections.map((y, j) => field(`Section ${i + 1}.${j + 1}`, y.title))),
        h('p', { class: 'hint' }, `Will search for: ${x.c.queries.join('; ')}`),
      ),
    ),
    reportList(state.report),
    h('div', { class: 'actions' },
      h('button', { class: 'primary big', onclick: approveIt }, 'Continue — write the book'),
      h('button', { class: 'secondary', onclick: () => { st = null; go('write'); } }, 'Cancel'),
    ),
  );
}

function reportList(report: PipelineState['report'] | undefined): Node | null {
  if (!report?.length) return null;
  const counts = { problem: 0, warning: 0, info: 0 };
  report.forEach((r) => counts[r.level]++);
  return h('details', { class: 'report', open: counts.problem > 0 },
    h('summary', {}, `Verification report: ${counts.problem} problems, ${counts.warning} warnings`),
    h('ul', {}, ...report.map((r) => h('li', { class: r.level }, h('strong', {}, `${r.where}: `), r.message))),
  );
}

// ---------------------------------------------------------------------------
// Preview (used by Edit)

function proofDom(p: Project): HTMLElement {
  const wrap = h('div', { class: 'proof' });
  if (p.book.meta.style && p.book.meta.style !== 'classic') wrap.dataset.bookStyle = p.book.meta.style;
  const probs = problems(p);
  if (probs.length) {
    wrap.append(h('p', { class: 'blocker' }, 'The preview will appear when the problems above are fixed.'));
    return wrap;
  }
  const numbering = numberBook(p.book);
  const order = [...numbering.cite.keys()];
  const style = STYLES[p.book.meta.citationStyle] ?? STYLES.ieee!;
  const bib = formatBibliography(p.refs, order, { styleXml: style, localeXml }, 'html');
  const d = buildDisclosure(p.book, { figureScriptsByAi: true });
  const html = renderHtml(p.book, { numbering, bibliography: bib, refs: p.refs, figureBase: 'figures/', models: p.models, disclosure: { text: d.text.answer, images: d.images.answer, translations: d.translations.answer } });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const clean = DOMPurify.sanitize(doc.querySelector('main')!.innerHTML, PURIFY_CONFIG);
  wrap.innerHTML = clean; // sanitized above
  const dataUrl = (file: string) => (p.figures[file] ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.figures[file])}` : '');
  wrap.querySelectorAll('img[src^="figures/"]').forEach((img) => img.setAttribute('src', dataUrl(img.getAttribute('src')!.slice(8))));
  wrap.querySelectorAll('source[srcset^="figures/"]').forEach((s) => s.setAttribute('srcset', dataUrl(s.getAttribute('srcset')!.slice(8))));
  mountAll(wrap); // rotatable 3D models (the stills stay as the fallback)
  return wrap;
}

// ---------------------------------------------------------------------------
// Samples, opening files, settings

function samplesView(): Node {
  return h('section', {},
    h('h1', {}, 'Sample books'),
    h('p', { class: 'lede' }, 'One short book per domain, made with this pipeline and checked by hand. Open one to read it, try editing, and make a practice package.'),
    h('div', { class: 'sample-grid' },
      ...SAMPLES.map((s) =>
        h('button', { class: 'sample-card', onclick: () => openSample(s.dir) },
          h('span', { class: 'sample-domain' }, profileOf(s.book.meta.profile).name),
          h('span', { class: 'sample-title' }, s.book.meta.title),
          h('span', { class: 'sample-sub' }, s.book.meta.subtitle ?? ''),
        ),
      ),
    ),
    // The 3D Editions are built by the Pages workflow next to the app, so they exist on the web only.
    isDesktop()
      ? null
      : h('div', { class: 'edition3d-links' },
          h('h2', {}, 'Read a sample in 3D'),
          h('p', { class: 'hint' }, 'The same pages in a book you can turn; figures lift off the page and models rotate. Preview of the 3D Edition.'),
          h('ul', {}, ...SAMPLES.map((s) => h('li', {}, h('a', { href: `3d.html?book=books/${s.dir}/3d/` }, s.book.meta.title)))),
          h('h2', {}, 'Scene kits'),
          h('p', { class: 'hint' }, 'Ready-made 3D scenes a figure can become, once its author approves. Each one rotates, cuts open, explodes into parts and plays its process.'),
          h('div', { class: 'kit-grid' },
            ...SCENE_KITS.map((k) =>
              h('a', { class: 'kit-card', href: `3d.html?kit=${k.id}` },
                h('span', { class: 'kit-swatch', 'aria-hidden': 'true' }, ...k.swatch.map((c) => h('i', { style: `background:${c}` }))),
                h('span', { class: 'kit-title' }, k.title),
                h('span', { class: 'kit-shows' }, k.animation ?? k.shows),
              ),
            ),
          ),
        ),
  );
}

function openSample(dir: string): void {
  replaceGuard(() => loadSample(dir));
}

function loadSample(dir: string): void {
  const s = SAMPLES.find((x) => x.dir === dir) ?? SAMPLES[0]!;
  const figures: Record<string, string> = {};
  for (const [path, svg] of Object.entries(sampleFigures)) if (path.includes(`/examples/${s.dir}/`)) figures[path.split('/').pop()!] = svg;
  const models: Record<string, Model> = {};
  for (const [path, m] of Object.entries(sampleModels)) if (path.includes(`/examples/${s.dir}/`)) models[`models/${path.split('/').pop()!}`] = Model.parse(m);
  project = { book: clone(s.book), refs: clone(s.refs), figures, models, origin: 'sample', sampleDir: s.dir, original: clone(s.book) };
  notice = 'This is a sample. Edits are not kept, and Publish makes a practice package only.';
  go('edit');
}

/**
 * Opening a sample or a file replaces the current book (which is only kept on this device),
 * so first ask, inline, with a way to save a copy.
 */
let pendingReplace: (() => void) | null = null;

function replaceGuard(action: () => void): void {
  if (!project || project.origin === 'sample') return action();
  pendingReplace = action;
  render();
}

function replaceBanner(): Node | '' {
  if (!pendingReplace || !project) return '';
  const run = () => {
    const a = pendingReplace;
    pendingReplace = null;
    a?.();
  };
  return h('div', { class: 'notice warn', role: 'alertdialog', 'aria-label': 'Replace the current book?' },
    h('span', {}, `This replaces “${project.book.meta.title}”, which is only saved on this device.`),
    h('button', { class: 'secondary small', onclick: () => { saveFile(`${slugify(project!.book.meta.title)}.scriptorium.json`, toFile(project!), 'application/json'); run(); } }, 'Save a copy, then continue'),
    h('button', { class: 'secondary small', onclick: run }, 'Replace it'),
    h('button', { class: 'link', onclick: () => { pendingReplace = null; render(); } }, 'Cancel'),
  );
}

async function openFile(input: HTMLInputElement): Promise<void> {
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  if (f.size > 20_000_000) {
    notice = 'That file is larger than 20 MB, which is too large for a project.';
    return render();
  }
  try {
    const opened = fromFile(await f.text(), sanitizeSvg);
    replaceGuard(() => {
      project = opened;
      changed();
      notice = `Opened “${opened.book.meta.title}”.`;
      go('edit');
    });
  } catch (e) {
    notice = String((e as Error).message ?? e);
    render();
  }
}

function settingsView(): Node {
  const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', value: apiKey, placeholder: 'sk-ant-…', 'aria-describedby': 'key-help' });
  const desktop = store.kind === 'keychain';
  const remember = h('input', { type: 'checkbox', checked: desktop });
  void store.hasStored().then((v) => (remember.checked = v || desktop)).catch(() => undefined);
  const modelInput = h('input', { value: model });
  const status = h('p', { class: 'hint', role: 'status' }, storeError);
  const save = async () => {
    apiKey = key.value.trim();
    model = modelInput.value.trim() || model;
    try {
      if (remember.checked && apiKey) await store.save(apiKey);
      else await store.forget();
      go('write');
    } catch (e) {
      // The message comes from our own Rust command and never contains the key.
      status.replaceChildren(
        `The key is kept for this session only: ${(e as Error).message ?? e}. It works until you close the app; you will paste it again next time. `,
        h('button', { class: 'secondary small', onclick: () => go('write') }, 'Continue with this key'),
      );
    }
  };
  const entries = readLog();
  return h('section', { class: 'settings' },
    h('h1', {}, 'Settings'),
    h('h2', {}, 'Your API key'),
    h('p', { class: 'lede', id: 'key-help' },
      desktop
        ? 'The key is sent only to api.anthropic.com with each model request. It is never logged, exported, or sent to the scholarly databases. If you remember it, it is stored in your operating system’s keychain, not in the app.'
        : 'The key stays in this browser tab and is sent only to api.anthropic.com with each model request. It is never logged, exported, or sent to the scholarly databases.'),
    field('Anthropic API key', key),
    field('Model', modelInput),
    h('label', { class: 'check' }, remember, h('span', {}, desktop ? 'Remember on this device (saved in the system keychain)' : 'Remember on this device (stored unencrypted in this browser; leave off on shared computers)')),
    status,
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: () => void save() }, 'Save key'),
      h('button', { class: 'secondary', onclick: () => { key.value = ''; remember.checked = false; void save(); } }, 'Forget key'),
    ),
    h('h2', {}, 'Packages made on this device'),
    h('p', { class: 'hint' }, 'Used to keep you within KDP’s limit of 2 new titles per format per week. It never leaves this device.'),
    entries.length
      ? h('ul', { class: 'pub-log' }, ...entries.slice().reverse().map((e) => h('li', {}, `${e.at.slice(0, 16).replace('T', ' ')} UTC — ${e.title} (${e.formats.join(', ')})`)))
      : h('p', { class: 'hint' }, 'None yet.'),
  );
}

// ---------------------------------------------------------------------------
// Fonts and colour tokens from src/core/style.ts, then the book's own CSS scoped to .proof.

const proofStyle = document.createElement('style');
proofStyle.textContent = (() => {
  const faces = [
    ['Source Serif 4', serifRegular, 400, 'normal'],
    ['Source Serif 4', serifItalic, 400, 'italic'],
    ['Source Serif 4', serifSemibold, 600, 'normal'],
    ['Source Sans 3', sansRegular, 400, 'normal'],
    ['Source Sans 3', sansSemibold, 600, 'normal'],
  ]
    .map(([f, u, w, s]) => `@font-face { font-family: "${f}"; src: url("${u}"); font-weight: ${w}; font-style: ${s}; font-display: swap; }`)
    .join('\n');
  const rest = bookCss()
    .replace(/@font-face[^}]*}/g, '')
    .replace(/:root/g, '&')
    .replace(/(^|\n)body \{/g, '$1& {')
    .replace(/\.toc[^{]*\{[^}]*\}/g, '');
  return `${faces}
:root { ${cssVariables('light')} color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { ${cssVariables('dark')} } }
.proof { ${rest} }
.proof { display: block; max-width: 44rem; margin: 0; font-size: 17px; }`;
})();
document.head.append(proofStyle);

if (project) view = 'edit';
render();
// Links such as …/#sample=cells-and-dna open a sample book.
const openFromHash = () => {
  const m = location.hash.match(/^#sample(?:=([a-z0-9-]+))?$/);
  if (m) openSample(m[1] ?? SAMPLES[0]!.dir);
};
window.addEventListener('hashchange', openFromHash);
openFromHash();

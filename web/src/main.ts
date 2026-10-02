/**
 * Scriptorium web app (GitHub Pages + desktop). Plain TypeScript and DOM, no framework.
 * All text is inserted with textContent; the only HTML we insert is the book proof,
 * which is produced by our renderer and then sanitized with DOMPurify.
 */
import 'katex/dist/katex.min.css';
import './app.css';
import DOMPurify from 'dompurify';
import { approve, newState, runPipeline, STAGES, type Outline, type PipelineState, type Scope, type StageId, type StageStatus } from '../../src/core/pipeline.ts';
import { Bibliography, Book, type Reference } from '../../src/core/book.ts';
import { Profile } from '../../src/core/profile.ts';
import { Budget } from '../../src/llm/budget.ts';
import { AnthropicProvider } from '../../src/llm/provider.ts';
import { numberBook } from '../../src/render/numbering.ts';
import { formatBibliography } from '../../src/render/cite.ts';
import { bookCss, renderHtml } from '../../src/render/html.ts';
import { mountAll } from '../../src/render/viewer3d-client.ts';
import { keyStore } from './keystore.ts';
import { Model } from '../../src/core/molecule.ts';
import { buildDisclosure } from '../../src/disclosure/ai-disclosure.ts';
import { cssVariables } from '../../src/core/style.ts';
import localeXml from '../../styles/locales-en-US.xml?raw';
import serifRegular from 'source-serif/TTF/SourceSerif4-Regular.ttf?url';
import serifItalic from 'source-serif/TTF/SourceSerif4-It.ttf?url';
import serifSemibold from 'source-serif/TTF/SourceSerif4-Semibold.ttf?url';
import sansRegular from 'source-sans/TTF/SourceSans3-Regular.ttf?url';
import sansSemibold from 'source-sans/TTF/SourceSans3-Semibold.ttf?url';

// Every profile in profiles/ and every CSL style in styles/ is picked up automatically.
const profileFiles = import.meta.glob('../../profiles/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const styleFiles = import.meta.glob('../../styles/*.csl', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const PROFILES = Object.values(profileFiles).map((p) => Profile.parse(p));
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
// Tiny DOM helper: attributes and text only, never innerHTML.

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

// ---------------------------------------------------------------------------
// App state (the API key lives only in this variable unless the user opts in to remember it)

let apiKey = '';
let model = 'claude-sonnet-5-5';
const store = keyStore();
let storeError = '';
void store
  .load()
  .then((k) => {
    apiKey = k;
    if (k && view === 'home') render();
  })
  .catch((e: Error) => {
    storeError = `Could not read the saved key: ${e.message ?? e}`;
  });

type View = 'home' | 'outline' | 'progress' | 'proof' | 'settings';
let view: View = 'home';
let st: PipelineState | null = null;
let budget: Budget | null = null;
let sample: { dir: string; book: Book; refs: Reference[]; figures: Record<string, string>; models: Record<string, Model> } | null = null;
const log: string[] = [];
let busy = false;

const app = document.getElementById('app')!;

function stageStatus(id: StageId): StageStatus {
  if (sample) return 'done';
  return st?.status[id] ?? 'pending';
}

// ---------------------------------------------------------------------------
// Layout

function render(): void {
  app.replaceChildren(
    h('header', { class: 'topbar' },
      h('button', { class: 'brand', onclick: () => go('home') }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Scriptorium'),
      h('nav', { class: 'topnav', 'aria-label': 'Main' },
        h('button', { class: 'link', onclick: () => openSample(SAMPLES[0]!.dir) }, 'Sample books'),
        h('button', { class: 'link', onclick: () => go('settings') }, apiKey ? 'Settings (key saved)' : 'Settings'),
      ),
    ),
    h('div', { class: 'layout' }, rail(), h('main', { id: 'main', class: 'panel', tabindex: '-1' }, panel())),
  );
}

function go(v: View): void {
  view = v;
  render();
  document.getElementById('main')?.focus();
}

function rail(): HTMLElement {
  const items = STAGES.map((s, i) => {
    const status = stageStatus(s.id);
    return h('li', { class: `stage ${status}${s.checkpoint ? ' checkpoint' : ''}` },
      h('span', { class: 'dot', 'aria-hidden': 'true' }, status === 'done' ? '✓' : String(i + 1)),
      h('div', {},
        h('div', { class: 'stage-name' }, s.name, s.checkpoint ? h('span', { class: 'you-decide' }, 'you decide') : null),
        h('div', { class: 'stage-what' }, s.what),
        h('div', { class: 'sr-only' }, `Status: ${status.replace(/-/g, ' ')}`),
      ),
    );
  });
  const used = budget ? `${budget.spent.toLocaleString()} of ${budget.opts.capTokens.toLocaleString()} tokens used` : '';
  return h('aside', { class: 'rail', 'aria-label': 'Pipeline' }, h('p', { class: 'rail-title' }, 'How a book is made'), h('ol', {}, ...items), used ? h('p', { class: 'budget' }, used) : null);
}

function panel(): Node {
  switch (view) {
    case 'settings':
      return settingsView();
    case 'outline':
      return outlineView();
    case 'progress':
      return progressView();
    case 'proof':
      return proofView();
    default:
      return homeView();
  }
}

// ---------------------------------------------------------------------------
// Home: stage 1, topic + scope

function homeView(): Node {
  const profileSelect = select('profile', PROFILES.map((p) => p.id), PROFILES.map((p) => p.name));
  profileSelect.value = PROFILES.some((p) => p.id === 'engineering') ? 'engineering' : PROFILES[0]!.id;
  const styleSelect = select('style', Object.keys(STYLES), Object.keys(STYLES).map((s) => STYLE_LABELS[s] ?? s));
  const syncStyle = () => {
    const p = PROFILES.find((x) => x.id === profileSelect.value);
    if (p && STYLES[p.citationStyle]) styleSelect.value = p.citationStyle;
    note.textContent = p?.requiresProfessionalReview ? `${p.name} books are flagged for review by a licensed professional before publishing.` : '';
  };
  const note = h('p', { class: 'hint' });
  profileSelect.addEventListener('change', syncStyle);
  const form = h('form', { class: 'scope', onsubmit: (e: Event) => { e.preventDefault(); void start(new FormData(e.target as HTMLFormElement)); } },
    h('h1', {}, 'What should the book explain?'),
    h('p', { class: 'lede' }, 'Scriptorium plans, researches, drafts, checks and typesets an illustrated book. Every source is looked up and verified before it can be cited, and you approve the outline and the final proof.'),
    field('Topic', h('textarea', { name: 'topic', rows: '2', required: true, placeholder: 'e.g. How lithium-ion batteries store and release energy' })),
    h('div', { class: 'row' },
      field('Audience', h('input', { name: 'audience', value: 'Curious newcomers with high-school algebra' })),
      field('Depth', select('depth', ['introductory', 'intermediate', 'advanced'])),
    ),
    h('div', { class: 'row' },
      field('Chapters', h('input', { name: 'chapters', type: 'number', min: '1', max: '12', value: '3' })),
      field('Sections per chapter', h('input', { name: 'sections', type: 'number', min: '1', max: '6', value: '2' })),
      field('Domain', profileSelect),
      field('Citation style', styleSelect),
    ),
    note,
    h('details', { class: 'more' }, h('summary', {}, 'Spending limit'),
      h('div', { class: 'row' },
        field('Token cap for this book', h('input', { name: 'cap', type: 'number', min: '10000', step: '10000', value: '400000' })),
        field('Requests per minute', h('input', { name: 'rpm', type: 'number', min: '1', max: '200', value: '20' })),
      ),
      h('p', { class: 'hint' }, 'The run stops before any call that could push the book past the cap.'),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'primary', type: 'submit', disabled: busy }, apiKey ? 'Plan the outline' : 'Add an API key to start'),
      h('button', { class: 'secondary', type: 'button', onclick: () => openSample(SAMPLES[0]!.dir) }, 'Open a sample book'),
    ),
  );
  queueMicrotask(syncStyle);
  return form;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), control);
}

function select(name: string, values: string[], labels = values): HTMLSelectElement {
  return h('select', { name }, ...values.map((v, i) => h('option', { value: v }, labels[i]!)));
}

function deps() {
  const profile = PROFILES.find((p) => p.id === st!.scope.profileId)!;
  return {
    provider: new AnthropicProvider({ apiKey, model, browser: true }),
    budget: budget!,
    profile,
    onEvent: (e: { stage: StageId; status: StageStatus; message?: string }) => {
      if (e.message) log.push(`${STAGES.find((s) => s.id === e.stage)!.name}: ${e.message}`);
      if (view === 'progress') render();
    },
  };
}

async function start(fd: FormData): Promise<void> {
  if (!apiKey) return go('settings');
  sample = null;
  const scope: Scope = {
    topic: String(fd.get('topic')),
    audience: String(fd.get('audience')),
    depth: fd.get('depth') as Scope['depth'],
    chapters: Number(fd.get('chapters')),
    sectionsPerChapter: Number(fd.get('sections')),
    profileId: String(fd.get('profile')),
    citationStyle: String(fd.get('style')),
    author: 'Scriptorium',
  };
  st = newState(scope);
  budget = new Budget({ capTokens: Number(fd.get('cap')), requestsPerMinute: Number(fd.get('rpm')) });
  log.length = 0;
  await advance();
}

async function advance(): Promise<void> {
  busy = true;
  go('progress');
  await runPipeline(st!, deps());
  busy = false;
  if (st!.status.outline === 'waiting-for-you') go('outline');
  else if (st!.status.export === 'waiting-for-you' || st!.status.export === 'done') go('proof');
  else go('progress');
}

// ---------------------------------------------------------------------------
// Checkpoint 1: outline

function outlineView(): Node {
  if (!st?.outline) return h('p', {}, 'No outline yet.');
  const o = st.outline;
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
    approve(st!, 'outline', edited);
    void advance();
  };
  return h('section', { class: 'checkpoint-panel' },
    h('p', { class: 'checkpoint-flag' }, 'Checkpoint 1 of 2 — your decision'),
    h('h1', {}, 'Check the outline'),
    h('p', { class: 'lede' }, 'Edit titles and learning goals. Research and drafting start only after you approve.'),
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
    reportList(),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: approveIt }, 'Approve outline and continue')),
  );
}

// ---------------------------------------------------------------------------
// Stages 3–8: progress

function progressView(): Node {
  const failed = st && Object.entries(st.status).find(([, s]) => s === 'failed');
  return h('section', {},
    h('h1', {}, failed ? 'The run stopped' : busy ? 'Working on it' : 'Pipeline'),
    h('p', { class: 'lede' }, failed ? 'Read the problem below, fix it (for example, raise the spending cap in Spending limit), and start again.' : 'Each stage reports what it did. Problems and warnings collect in the verification report.'),
    h('ol', { class: 'log', 'aria-live': 'polite' }, ...log.slice(-12).map((l) => h('li', {}, l))),
    reportList(),
  );
}

function reportList(): Node | null {
  if (!st?.report.length) return null;
  const counts = { problem: 0, warning: 0, info: 0 };
  st.report.forEach((r) => counts[r.level]++);
  return h('details', { class: 'report', open: counts.problem > 0 },
    h('summary', {}, `Verification report: ${counts.problem} problems, ${counts.warning} warnings`),
    h('ul', {}, ...st.report.map((r) => h('li', { class: r.level }, h('strong', {}, `${r.where}: `), r.message))),
  );
}

// ---------------------------------------------------------------------------
// Checkpoint 2: proof

function figureMap(): Record<string, string> {
  if (sample) return sample.figures;
  const out: Record<string, string> = {};
  for (const [id, svg] of Object.entries(st?.figures ?? {})) {
    const name = id.replace(/^fig-/, '');
    out[`${name}.svg`] = svg.light;
    out[`${name}.dark.svg`] = svg.dark;
  }
  return out;
}

function modelMap(): Record<string, Model> {
  return sample ? sample.models : (st?.models ?? {});
}

function proofDom(book: Book, refs: Reference[]): HTMLElement {
  const numbering = numberBook(book);
  const order = [...numbering.cite.keys()];
  const style = STYLES[book.meta.citationStyle] ?? STYLES.ieee!;
  const bib = formatBibliography(refs, order, { styleXml: style, localeXml }, 'html');
  const d = buildDisclosure(book, { figureScriptsByAi: true });
  const html = renderHtml(book, { numbering, bibliography: bib, refs, figureBase: 'figures/', models: modelMap(), disclosure: { text: d.text.answer, images: d.images.answer, translations: d.translations.answer } });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const inner = doc.querySelector('main')!.innerHTML;
  const clean = DOMPurify.sanitize(inner, { USE_PROFILES: { html: true, mathMl: true }, ADD_TAGS: ['picture', 'source', 'annotation', 'semantics'], ADD_ATTR: ['srcset', 'media', 'loading', 'data-model'], ADD_URI_SAFE_ATTR: ['media', 'aria-hidden', 'encoding'] });
  const wrap = h('div', { class: 'proof' });
  wrap.innerHTML = clean; // sanitized above
  const figs = figureMap();
  const dataUrl = (file: string) => (figs[file] ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(figs[file])}` : '');
  wrap.querySelectorAll('img[src^="figures/"]').forEach((img) => img.setAttribute('src', dataUrl(img.getAttribute('src')!.slice(8))));
  wrap.querySelectorAll('source[srcset^="figures/"]').forEach((s) => s.setAttribute('srcset', dataUrl(s.getAttribute('srcset')!.slice(8))));
  mountAll(wrap); // rotatable 3D models (the stills stay as the fallback)
  return wrap;
}

function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function proofView(): Node {
  const book = sample?.book ?? st?.book;
  const refs = sample?.refs ?? st?.verified ?? [];
  if (!book) return h('p', {}, 'Nothing to proof yet.');
  const waiting = !sample && st?.status.export === 'waiting-for-you';
  const d = buildDisclosure(book, { figureScriptsByAi: true });
  const project = { book, references: refs, figures: figureMap(), models: modelMap() };
  const picker = sample
    ? h('div', { class: 'sample-picker', role: 'tablist', 'aria-label': 'Sample books' },
        ...SAMPLES.map((s) => h('button', { role: 'tab', 'aria-selected': String(s.dir === sample!.dir), class: s.dir === sample!.dir ? 'tab active' : 'tab', onclick: () => openSample(s.dir) }, `${PROFILES.find((p) => p.id === s.book.meta.profile)?.name ?? s.book.meta.profile}: ${s.book.meta.title}`)))
    : null;
  return h('section', {},
    waiting ? h('p', { class: 'checkpoint-flag' }, 'Checkpoint 2 of 2 — your decision') : null,
    picker,
    h('h1', {}, sample ? book.meta.title : 'Review the proof'),
    h('p', { class: 'lede' }, sample ? 'A sample made with this pipeline. Every equation is re-derived by a test and every source was checked by hand.' : 'Read it through and check the verification report. Approving downloads the project; build the print PDF and EPUB with one command.'),
    h('div', { class: 'proof-bar' },
      h('div', {}, h('strong', {}, 'KDP AI disclosure: '), `text ${d.text.answer}, images ${d.images.answer}, translations ${d.translations.answer}`),
      h('div', { class: 'actions' },
        waiting
          ? h('button', { class: 'primary', onclick: () => { approve(st!, 'export'); void runPipeline(st!, deps()).then(() => { download('scriptorium-project.json', project); render(); }); } }, 'Approve and download project')
          : h('button', { class: 'primary', onclick: () => download('scriptorium-project.json', project) }, 'Download project'),
      ),
    ),
    h('p', { class: 'hint' }, 'Print PDF, EPUB and cover: ', h('code', {}, 'npm run cli -- build-project scriptorium-project.json'), ' (the in-browser PDF exporter arrives with the desktop app).'),
    reportList(),
    proofDom(book, refs),
  );
}

function openSample(dir: string): void {
  const s = SAMPLES.find((x) => x.dir === dir) ?? SAMPLES[0]!;
  const figures: Record<string, string> = {};
  for (const [path, svg] of Object.entries(sampleFigures)) if (path.includes(`/examples/${s.dir}/`)) figures[path.split('/').pop()!] = svg;
  const models: Record<string, Model> = {};
  for (const [path, m] of Object.entries(sampleModels)) if (path.includes(`/examples/${s.dir}/`)) models[`models/${path.split('/').pop()!}`] = Model.parse(m);
  sample = { ...s, figures, models };
  st = null;
  budget = null;
  go('proof');
}

// ---------------------------------------------------------------------------
// Settings: bring your own key

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
      go('home');
    } catch (e) {
      // The message comes from our own Rust command and never contains the key.
      status.textContent = `The key is kept for this session only: ${(e as Error).message ?? e}`;
    }
  };
  return h('section', {},
    h('h1', {}, 'Your API key'),
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
  );
}

// Fonts and color tokens from src/core/style.ts, then the book's own CSS scoped to .proof.
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
.proof { display: block; max-width: 44rem; margin: 2rem 0 0; font-size: 17px; }`;
})();
document.head.append(proofStyle);

render();
const m = location.hash.match(/^#sample(?:=([a-z0-9-]+))?$/);
if (m) openSample(m[1] ?? SAMPLES[0]!.dir);

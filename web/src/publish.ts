/**
 * Step 3, Publish: build the KDP upload package in the app, check it, and only then let the
 * person save it — with guards against publishing too much or by accident:
 *
 *   1. Automated checks must all pass (interior, cover, ebook cover, listing). Books that
 *      do not build at all never get this far.
 *   2. The person ticks what only a person can confirm (read the proof, checked sources,
 *      AI-disclosure answers, licensed review for medicine).
 *   3. KDP's limit of 2 new titles per format per week is enforced from this device's log;
 *      the exact same package twice, or the same title twice in a day, needs a deliberate tick.
 *      If this device cannot keep a log, that is said plainly and also needs a tick.
 *   4. The final button stays disabled until the book's title is typed exactly.
 *   5. One click saves one package; the button then locks until the book, the settings or the
 *      formats change.
 *
 * Every build is tied to the exact book, mode (real or practice), trim and paper it was made
 * from; a build that finishes after any of those changed is thrown away. Only one build runs
 * at a time. KDP has no upload API, so uploading on kdp.amazon.com stays with the person.
 */
import { zipSync } from 'fflate';
import type { Profile } from '../../src/core/profile.ts';
import type { PackageResult } from '../../src/export/package.ts';
import { contentHash, evaluatePublish, FORMATS, pruneLog, titleKey, type Format, type PublishEntry } from '../../src/export/publish-guard.ts';
import { TRIM_SIZES, findTrim, type Paper } from '../../src/kdp/specs.ts';
import type { Check } from '../../src/kdp/preflight.ts';
import { bookFiles, problems, type Project } from './project.ts';
import { canvasEncodeJpeg, canvasRasterize, getEngine } from './typst-web.ts';
import { field, h, saveFile, select, slugify } from './ui.ts';

const LOG_KEY = 'scriptorium.publishLog';

export function readLog(): PublishEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? (raw as PublishEntry[]).filter((e) => e && typeof e.key === 'string' && typeof e.hash === 'string' && typeof e.at === 'string' && Number.isFinite(Date.parse(e.at)) && Array.isArray(e.formats))
      : [];
  } catch {
    return [];
  }
}

function writeLog(log: PublishEntry[]): boolean {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(pruneLog(log, Date.now())));
    return true;
  } catch {
    return false;
  }
}

/** Can this device keep the publishing log? (Private windows and blocked storage cannot.) */
function logAvailable(): boolean {
  try {
    const probe = `${LOG_KEY}.probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export interface PublishHost {
  project: Project;
  profile: Profile;
  csl: { styleXml: string; localeXml: string };
  goEdit(): void;
}

interface Settings {
  trim: string;
  paper: Paper;
}

interface Built {
  /** what the files were built from: book content, real/practice, trim and paper */
  key: string;
  project: Project;
  result: PackageResult;
}

// Kept across re-renders so a finished build, the choices and the ticks survive a redraw.
let built: Built | null = null;
let building: { key: string; seq: number } | null = null;
let buildSeq = 0;
let savedKey: string | null = null;
let settings: Settings = { trim: '6x9', paper: 'white' };
const formats = new Set<Format>(FORMATS);
const acked = new Set<string>(); // confirmations the person ticked, by their text
let lastProject: Project | null = null;
// The newest view on screen: a build started from an earlier view reports here when it ends.
let status = '';
let liveView: { progress: HTMLElement; update: () => void } | null = null;
function say(message: string): void {
  status = message;
  if (liveView) liveView.progress.textContent = message;
}

const FORMAT_LABEL: Record<Format, string> = { paperback: 'Paperback', ebook: 'Kindle eBook' };

const buildKey = (p: Project, s: Settings) => `${contentHash(p.book, p.refs)}|${p.origin === 'sample' ? 'practice' : 'real'}|${s.trim}|${s.paper}`;
const saveKey = (k: string) => `${k}|${[...formats].sort().join('+')}`;

export function publishView(host: PublishHost): HTMLElement {
  const p = host.project;
  if (p !== lastProject) {
    // a different book: nothing carries over
    lastProject = p;
    built = null;
    savedKey = null;
    acked.clear();
    status = '';
  }
  const practice = p.origin === 'sample';
  const currentKey = () => buildKey(p, settings);
  const validBuild = () => (built && built.project === p && built.key === currentKey() ? built : null);
  const logHash = () => `${contentHash(p.book, p.refs)}|${settings.trim}|${settings.paper}`;
  const canLog = practice || logAvailable();

  const root = h('section', { class: 'publish' });
  const buildProblems = problems(p);

  // ---- settings
  const formatBox = h('fieldset', { class: 'chips' }, h('legend', {}, 'Formats'),
    ...FORMATS.map((f) => {
      const cb = h('input', { type: 'checkbox', checked: formats.has(f), value: f });
      cb.addEventListener('change', () => {
        if (cb.checked) formats.add(f);
        else formats.delete(f);
        update();
      });
      return h('label', { class: 'chip' }, cb, FORMAT_LABEL[f]);
    }),
  );
  const trim = select('trim', TRIM_SIZES.map((t) => `${t.width}x${t.height}`), TRIM_SIZES.map((t) => t.label), settings.trim);
  const paper = select('paper', ['white', 'cream'], ['White paper', 'Cream paper'], settings.paper);
  const settingsChanged = () => {
    settings = { trim: trim.value, paper: paper.value as Paper };
    update();
  };
  trim.addEventListener('change', settingsChanged);
  paper.addEventListener('change', settingsChanged);

  // ---- step A: build + automated checks
  const progress = h('p', { class: 'hint', role: 'status', 'aria-live': 'polite' });
  const checkBtn = h('button', { class: 'primary big', onclick: () => void runChecks() }, 'Build and check the package');
  const results = h('div', { class: 'results' });

  // ---- step B: human confirmations
  const confirmations: Array<[string, HTMLInputElement]> = [
    ['I read the whole proof, including the verification report at the end.', h('input', { type: 'checkbox' })],
    ['I opened the references and they say what the book cites them for.', h('input', { type: 'checkbox' })],
    ['The title, subtitle and author on KDP will match the cover exactly.', h('input', { type: 'checkbox' })],
    ['I will answer KDP’s AI-content questions as listed in ai-disclosure.json (text: yes for drafted books).', h('input', { type: 'checkbox' })],
  ];
  if (host.profile.requiresProfessionalReview) confirmations.push([`A licensed professional reviewed this ${host.profile.name.toLowerCase()} book.`, h('input', { type: 'checkbox' })]);
  confirmations.forEach(([label, cb]) => {
    cb.checked = acked.has(label);
    cb.addEventListener('change', () => {
      if (cb.checked) acked.add(label);
      else acked.delete(label);
      refreshButton();
    });
  });

  // ---- step C: limits and duplicates
  const guardBox = h('div', { class: 'guard' });
  let guardTicks: Array<[string, HTMLInputElement]> = [];

  // ---- step D: type the title, then save
  const typed = h('input', { 'aria-label': 'Type the book title to confirm', autocomplete: 'off', spellcheck: 'false', placeholder: p.book.meta.title });
  typed.addEventListener('input', () => refreshButton());
  const saveBtn = h('button', { class: 'primary big', disabled: true, onclick: () => save() }, practice ? 'Save practice package' : 'Save KDP package');
  const why = h('ul', { class: 'why-not', 'aria-label': 'Why the button is not available yet' });

  function verdict() {
    return evaluatePublish(practice ? [] : readLog(), { key: titleKey(p.book), hash: logHash(), formats: [...formats], now: Date.now() });
  }

  /** Redraw what depends on the build, the settings and the log; keeps the person's ticks. */
  function update(): void {
    const b = validBuild();
    const isBuilding = building !== null;
    checkBtn.disabled = isBuilding;
    trim.disabled = paper.disabled = isBuilding;
    checkBtn.textContent = isBuilding ? 'Building…' : b ? 'Run the checks again' : 'Build and check the package';
    results.replaceChildren(
      b
        ? resultList(b.result)
        : built && built.project === p
          ? h('p', { class: 'hint' }, 'The book or the settings changed since the last build. Build again.')
          : h('p', { class: 'hint' }, 'Nothing built yet. Building takes a few seconds (the first time also loads the typesetter, about 30 MB).'),
    );
    const v = verdict();
    const notes = [...v.confirmations];
    if (!canLog) notes.push('This device cannot keep a publishing log (storage is blocked or this is a private window), so KDP’s weekly limit cannot be checked here. Count your new titles this week yourself.');
    guardTicks = notes.map((c) => {
      const cb = h('input', { type: 'checkbox', checked: acked.has(c) });
      cb.addEventListener('change', () => {
        if (cb.checked) acked.add(c);
        else acked.delete(c);
        refreshButton();
      });
      return [c, cb];
    });
    guardBox.replaceChildren(
      ...(practice ? [h('p', { class: 'hint' }, 'Practice packages from sample books do not count toward KDP limits and must not be uploaded.')] : []),
      ...v.blockers.map((x) => h('p', { class: 'blocker' }, '⛔ ', x)),
      ...guardTicks.map(([c, cb]) => h('label', { class: 'check warn' }, cb, h('span', {}, c, ' I understand and want to continue.'))),
      ...(!practice && !v.blockers.length && !notes.length ? [h('p', { class: 'ok-line' }, '✓ Within KDP’s limit of 2 new titles per format per week (counted from this device).')] : []),
    );
    refreshButton();
  }

  function refreshButton(): void {
    const b = validBuild();
    if (b && savedKey === saveKey(b.key)) {
      saveBtn.disabled = true;
      why.replaceChildren(h('li', {}, 'This package is saved. Change the book, the settings or the formats to make another.'));
      return;
    }
    const v = verdict();
    const reasons: string[] = [];
    if (buildProblems.length) reasons.push('The book has problems to fix in Edit.');
    if (building) reasons.push('Wait for the build to finish.');
    else if (!b) reasons.push('Build and check the package first.');
    else if (b.result.failures.length) reasons.push(`${b.result.failures.length} automated ${b.result.failures.length === 1 ? 'check' : 'checks'} failed.`);
    if (!practice) {
      const unticked = confirmations.filter(([, cb]) => !cb.checked).length;
      if (unticked) reasons.push(`Tick the ${unticked} remaining ${unticked === 1 ? 'confirmation' : 'confirmations'}.`);
    }
    reasons.push(...v.blockers);
    if (guardTicks.some(([, cb]) => !cb.checked)) reasons.push('Tick the warning under Publishing limits.');
    if (!practice && typed.value.trim() !== p.book.meta.title.trim()) reasons.push('Type the book’s title exactly.');
    saveBtn.disabled = reasons.length > 0;
    why.replaceChildren(...reasons.map((r) => h('li', {}, r)));
  }

  async function runChecks(): Promise<void> {
    if (building) return; // one build at a time, across redraws
    const snapshot: Settings = { ...settings };
    const key = buildKey(p, snapshot);
    const seq = ++buildSeq;
    building = { key, seq };
    update();
    try {
      say('Loading the typesetter…');
      // The exporters (PDF tools, EPUB, JPEG) load only when someone publishes, so the app opens fast.
      const [engine, { buildPackage }, { makeToXhtml }] = await Promise.all([getEngine(), import('../../src/export/package.ts'), import('../../src/export/epub.ts')]);
      const files = bookFiles(p);
      engine.setFiles(files);
      const result = await buildPackage(
        { book: p.book, refs: p.refs, profile: host.profile, files, csl: host.csl, trim: findTrim(...(snapshot.trim.split('x').map(Number) as [number, number])), paper: snapshot.paper, practice },
        { engine, rasterize: canvasRasterize, encodeJpeg: canvasEncodeJpeg, coverFigure: 'overlay', toXhtml: makeToXhtml(window), onStep: (x) => say(x) },
      );
      if (seq !== buildSeq || key !== buildKey(p, snapshot) || p !== lastProject) {
        say('The book changed while it was building, so that build was discarded. Build again.');
        return;
      }
      built = { key, project: p, result };
      say(result.failures.length ? 'Built, but some checks failed — see below.' : `Built and checked: ${result.pages} pages. Every automated check passed.`);
    } catch (e) {
      console.error(e);
      say(`Could not build the package: ${(e as Error).message ?? e}`);
    } finally {
      if (building?.seq === seq) building = null;
      liveView?.update();
    }
  }

  function save(): void {
    refreshButton();
    const b = validBuild();
    if (!b || saveBtn.disabled) return;
    const folder = `${slugify(p.book.meta.title)}${practice ? '-PRACTICE' : ''}-kdp`;
    const wanted = new Set<string>(['kdp-metadata.txt', 'ai-disclosure.json', 'preflight.json', 'UPLOAD-CHECKLIST.txt']);
    if (formats.has('paperback')) ['book.pdf', 'cover.pdf'].forEach((f) => wanted.add(f));
    if (formats.has('ebook')) ['book.epub', 'ebook-cover.jpg'].forEach((f) => wanted.add(f));
    const files: Record<string, Uint8Array> = {};
    for (const [name, data] of Object.entries(b.result.files)) if (wanted.has(name)) files[`${folder}/${name}`] = data;
    // Record first, so the limit holds even if saving the file is interrupted.
    const logged = practice || writeLog([...readLog(), { key: titleKey(p.book), title: p.book.meta.title, hash: logHash(), formats: [...formats], at: new Date().toISOString() }]);
    saveFile(`${folder}.zip`, zipSync(files, { level: 6 }), 'application/zip');
    savedKey = saveKey(b.key);
    say(`Saved ${folder}.zip. Next: upload the files on kdp.amazon.com as listed in UPLOAD-CHECKLIST.txt.${logged ? '' : ' (This device could not record it in the publishing log, so the weekly limit cannot be checked here.)'}`);
    update();
  }

  root.append(
    h('h1', {}, practice ? 'Publish (practice)' : 'Publish'),
    h('p', { class: 'lede' }, practice
      ? 'Sample books are demonstrations, so this makes a practice package you can open and inspect — it must not be uploaded to KDP. Nothing here is uploaded anywhere.'
      : 'Build the files KDP asks for, check them, and save them as one package. Nothing is uploaded: you upload the files on kdp.amazon.com yourself.'),
    ...(buildProblems.length
      ? [h('div', { class: 'blocker-box' }, h('p', {}, h('strong', {}, 'Fix these first:')), h('ul', {}, ...buildProblems.map((x) => h('li', {}, x))), h('button', { class: 'secondary', onclick: host.goEdit }, 'Go to Edit'))]
      : []),
    h('ol', { class: 'publish-steps' },
      h('li', {}, h('h2', {}, 'Choose formats'), h('div', { class: 'row' }, formatBox, field('Trim size', trim), field('Paper', paper))),
      h('li', {}, h('h2', {}, 'Build and check'), checkBtn, progress, results),
      practice ? null : h('li', {}, h('h2', {}, 'Confirm what only you can check'), ...confirmations.map(([label, cb]) => h('label', { class: 'check' }, cb, h('span', {}, label)))),
      h('li', {}, h('h2', {}, practice ? 'Limits' : 'Publishing limits'), guardBox),
      h('li', {}, h('h2', {}, 'Save the package'),
        practice ? null : field(`Type the title to confirm: “${p.book.meta.title}”`, typed),
        saveBtn,
        why,
      ),
    ),
  );
  liveView = { progress, update };
  progress.textContent = building ? 'A build is running…' : status;
  update();
  return root;
}

function resultList(r: PackageResult): HTMLElement {
  const group = (label: string, checks: Array<{ rule: string; ok: boolean; detail: string }>) => {
    const bad = checks.filter((c) => !c.ok).length;
    return h('details', { class: `check-group ${bad ? 'bad' : 'good'}`, open: bad > 0 },
      h('summary', {}, `${bad ? '✗' : '✓'} ${label}: ${checks.length - bad}/${checks.length} checks pass`),
      h('ul', {}, ...checks.map((c) => h('li', { class: c.ok ? 'ok' : 'fail' }, `${c.ok ? '✓' : '✗'} ${c.rule} — ${c.detail}`))),
    );
  };
  const meta = r.checks.metadata.map((c) => ({ rule: c.rule, ok: c.level !== 'error', detail: c.detail }));
  return h('div', {},
    group('Print interior (book.pdf)', r.checks.interior as Check[]),
    group('Paperback cover (cover.pdf)', r.checks.cover as Check[]),
    group('Ebook cover (ebook-cover.jpg)', r.checks.ebookCover as Check[]),
    group('Listing (title, description, keywords)', meta),
    r.warnings.length ? h('div', { class: 'warnings' }, h('strong', {}, 'Warnings'), h('ul', {}, ...r.warnings.map((w) => h('li', {}, w)))) : null,
  );
}

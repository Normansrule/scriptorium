#!/usr/bin/env node
/**
 * Scriptorium command line.
 *
 *   npm run build -- examples/rc-circuits                      web book, print PDF, cover, EPUB, metadata sheet → dist/
 *   npm run build:all                                           every book under examples/, with a summary
 *     flags: --strict (exit 1 on any failed check) --allow-short (sample books may be under 24 pages) --epubcheck
 *   npm run cli -- epubcheck dist/rc-circuits/book.epub         validate an EPUB with EPUBCheck (needs Java)
 *   npm run cli -- generate --topic "How lithium-ion batteries work"   write a new book (needs ANTHROPIC_API_KEY)
 *   npm run cli -- build-project scriptorium-project.json      build a project downloaded from the web app
 *   npm run cli -- verify-refs examples/rc-circuits/book.json  re-check every DOI against Crossref
 *   npm run cli -- spine --pages 212 --paper white --trim 6x9  cover geometry for KDP
 *   npm run cli -- preflight dist/rc-circuits/book.pdf --trim 6x9
 *   npm run cli -- plan3d examples/rc-circuits [--approve fig-a,fig-b] [--reject fig-c]   2D → 3D proposals
 *   npm run cli -- edition3d examples/rc-circuits                 3D Edition (pages, figures, models) → dist/<book>/edition3d
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { buildDisclosure } from '../disclosure/ai-disclosure.ts';
import { coverGeometry, findTrim, type Paper } from '../kdp/specs.ts';
import { preflightInterior, type Check } from '../kdp/preflight.ts';
import { preflightCover, preflightEbookCover } from '../kdp/cover-preflight.ts';
import { checkMetadata, metadataSheet } from '../kdp/metadata.ts';
import { exportCover, exportEbookCover } from '../node/export-cover.ts';
import { exportEpub } from '../node/export-epub.ts';
import { formatBibliography } from '../render/cite.ts';
import { numberBook } from '../render/numbering.ts';
import { verifyReference } from '../research/scholarly.ts';
import { exportPdf } from '../node/export-pdf.ts';
import { exportWeb } from '../node/export-web.ts';
import { exportEdition3D, PLAN_FILE, updatePlan } from '../node/export-edition3d.ts';
import { effective } from '../edition3d/convert.ts';
import { concisionSummary, lintBook } from '../core/concision.ts';
import { cslAssets, loadBook, REPO_ROOT } from '../node/load.ts';
import { approve, newState, runPipeline, Outline, STAGES } from '../core/pipeline.ts';
import { AnthropicProvider } from '../llm/provider.ts';
import { Budget } from '../llm/budget.ts';
import { loadProfile } from '../node/profiles.ts';
import { Model } from '../core/molecule.ts';

const rel = (p: string) => relative(process.cwd(), p) || '.';

function flag(args: string[], name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

function parseTrim(s: string) {
  const [w, h] = s.split('x').map(Number);
  return findTrim(w!, h!);
}

export interface BuildSummary {
  name: string;
  pages: number | null;
  failed: string[];
  warnings: string[];
}

async function build(args: string[]): Promise<BuildSummary> {
  const t0 = Date.now();
  const bookPath = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'examples/rc-circuits/book.json';
  const { dir, book, refs, models } = loadBook(bookPath);
  const name = basename(dir);
  const out = resolve(flag(args, 'out', join(REPO_ROOT, 'dist', name))!);
  mkdirSync(out, { recursive: true });
  const summary: BuildSummary = { name, pages: null, failed: [], warnings: [] };
  const report = (label: string, checks: Check[]) => {
    const bad = checks.filter((c) => !c.ok);
    console.log(`${bad.length ? '✗' : '✓'} ${label}: ${checks.length - bad.length}/${checks.length} checks pass`);
    for (const c of bad) console.log(`    ✗ ${c.rule}: ${c.detail}`);
    // --allow-short: one-chapter gallery samples are below KDP's 24-page minimum on purpose.
    const counted = args.includes('--allow-short') ? bad.filter((c) => c.rule !== 'Page count within KDP limits') : bad;
    summary.failed.push(...counted.map((c) => `${label} — ${c.rule}`));
    summary.warnings.push(...bad.filter((c) => !counted.includes(c)).map((c) => `${label} — ${c.rule} (allowed for a sample)`));
  };

  const figScript = join(dir, 'figures.ts');
  if (existsSync(figScript)) {
    const mod = (await import(pathToFileURL(figScript).href)) as { drawAll?: () => string[] };
    const n = mod.drawAll?.().length ?? 0;
    console.log(`✓ Drew ${n} figure and model files (light + dark)`);
  }

  const profile = loadProfile(join(REPO_ROOT, 'profiles'), book.meta.profile);
  const numbering = numberBook(book);
  const order = [...numbering.cite.keys()];
  const assets = cslAssets(book.meta.citationStyle);
  const disclosure = buildDisclosure(book, { figureScriptsByAi: /written with AI assistance/i.test(book.meta.colophon ?? '') });
  const d = { text: disclosure.text.answer, images: disclosure.images.answer, translations: disclosure.translations.answer };
  const htmlBib = formatBibliography(refs, order, assets, 'html');

  const htmlPath = exportWeb({ book, refs, csl: assets, models, figureScriptsByAi: /written with AI assistance/i.test(book.meta.colophon ?? '') }, dir, join(out, 'web'));
  console.log(`✓ Web book  → ${rel(htmlPath)}`);

  const preflightAll: Record<string, unknown> = {};
  const trim = parseTrim(flag(args, 'trim', '6x9')!);
  const paper = (flag(args, 'paper', 'white') as Paper) ?? 'white';
  if (!args.includes('--skip-pdf')) {
    const res = await exportPdf(book, dir, { numbering, bibliography: formatBibliography(refs, order, assets, 'text'), refs, disclosure: d, webUrl: book.meta.webUrl }, { trimWidthIn: trim.width, trimHeightIn: trim.height, insideIn: 0.75, outsideIn: 0.625, topIn: 0.75, bottomIn: 0.8, bleed: false });
    const pdfPath = join(out, 'book.pdf');
    writeFileSync(pdfPath, res.pdf);
    writeFileSync(join(out, 'book.typ'), res.typst);
    res.diagnostics.forEach((m) => console.log(`  ${m}`));
    summary.pages = res.pages;
    console.log(`✓ Print PDF → ${rel(pdfPath)} (${res.pages} pages, ${trim.label})`);
    const interior = await preflightInterior(res.pdf, { trim, paper, bleed: false, insideMarginIn: res.layout.insideIn });
    report('KDP interior pre-flight', interior);
    preflightAll.interior = interior;

    const cover = await exportCover(book, dir, { trim, pages: res.pages, paper });
    writeFileSync(join(out, 'cover.pdf'), cover.pdf);
    writeFileSync(join(out, 'cover.typ'), cover.typst);
    const g = cover.layout.geom;
    console.log(`✓ Cover PDF → ${rel(join(out, 'cover.pdf'))} (${g.width.toFixed(3)}" × ${g.height.toFixed(3)}", spine ${g.spine.toFixed(3)}"${g.spineTextAllowed ? ', spine text' : ', no spine text'})`);
    const coverChecks = await preflightCover(cover.pdf, g, cover.layout, trim);
    report('KDP cover pre-flight', coverChecks);
    preflightAll.cover = coverChecks;
  }

  const ebookCover = await exportEbookCover(book, dir);
  writeFileSync(join(out, 'ebook-cover.jpg'), ebookCover.jpeg);
  console.log(`✓ Ebook cover → ${rel(join(out, 'ebook-cover.jpg'))} (${ebookCover.width} × ${ebookCover.height} px${ebookCover.border ? ', gray border for a light cover' : ''})`);
  const ebc = preflightEbookCover(ebookCover.jpeg);
  report('Ebook cover check', ebc);
  preflightAll.ebookCover = ebc;

  const epub = exportEpub(book, dir, { numbering, bibliography: htmlBib, refs, disclosure: d, webUrl: book.meta.webUrl }, { coverJpeg: ebookCover.jpeg });
  writeFileSync(join(out, 'book.epub'), epub.epub);
  console.log(`✓ EPUB 3    → ${rel(join(out, 'book.epub'))} (${(epub.epub.byteLength / 1024).toFixed(0)} KB)`);
  if (args.includes('--epubcheck')) {
    const r = runEpubcheck(join(out, 'book.epub'));
    console.log(`${r.ok ? '✓' : '✗'} EPUBCheck: ${r.summary}`);
    if (!r.ok) summary.failed.push(`EPUBCheck — ${r.summary}`);
  }

  const meta = checkMetadata(book.meta);
  writeFileSync(join(out, 'kdp-metadata.txt'), metadataSheet(book.meta, meta) + (profile.requiresProfessionalReview ? `\n! Before publishing: the ${profile.name} profile requires review by a licensed professional.\n` : ''));
  const metaErr = meta.filter((c) => c.level === 'error');
  const metaWarn = meta.filter((c) => c.level === 'warning');
  console.log(`${metaErr.length ? '✗' : '✓'} KDP metadata → ${rel(join(out, 'kdp-metadata.txt'))} (${metaErr.length} errors, ${metaWarn.length} warnings)`);
  for (const c of [...metaErr, ...metaWarn]) console.log(`    ${c.level === 'error' ? '✗' : '!'} ${c.rule}: ${c.detail}`);
  summary.failed.push(...metaErr.map((c) => `KDP metadata — ${c.rule}`));
  summary.warnings.push(...metaWarn.map((c) => `KDP metadata — ${c.rule}`));
  preflightAll.metadata = meta;
  if (profile.requiresProfessionalReview) preflightAll.professionalReview = { required: true, done: false, detail: `The ${profile.name} profile requires review by a licensed professional before publishing.` };
  writeFileSync(join(out, 'preflight.json'), JSON.stringify(preflightAll, null, 2));

  writeFileSync(join(out, 'ai-disclosure.json'), JSON.stringify(disclosure, null, 2));
  console.log(`✓ AI disclosure → ${rel(join(out, 'ai-disclosure.json'))} (text: ${d.text}, images: ${d.images}, translations: ${d.translations})`);
  // Concision is advice, not a gate: padding never stops a build.
  const conc = lintBook(book);
  console.log(`${conc.findings.length ? '•' : '✓'} Concision: ${concisionSummary(conc)}`);
  for (const f of conc.findings.slice(0, args.includes('--all-findings') ? Infinity : 5)) console.log(`    • ${f.where}: “${f.text}” — ${f.fix}`);
  if (conc.findings.length > 5 && !args.includes('--all-findings')) console.log(`    … ${conc.findings.length - 5} more (add --all-findings)`);
  if (profile.requiresProfessionalReview) {
    const msg = `The ${profile.name} profile requires review by a licensed professional before publishing.`;
    console.log(`! Professional review: ${msg}`);
    summary.warnings.push(msg);
  }
  if (summary.failed.length && args.includes('--strict')) process.exitCode = 1;
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return summary;
}

/** Build every book under examples/ (each into dist/<folder>), then print one line per book. */
async function buildAll(args: string[]): Promise<void> {
  const root = join(REPO_ROOT, 'examples');
  const books = readdirSync(root).filter((d) => existsSync(join(root, d, 'book.json'))).sort();
  const results: BuildSummary[] = [];
  for (const b of books) {
    console.log(`\n── ${b}`);
    results.push(await build([join(root, b, 'book.json'), ...args.filter((a) => a !== '--strict')]));
  }
  console.log('\nSummary');
  for (const r of results) console.log(`  ${r.failed.length ? '✗' : '✓'} ${r.name.padEnd(20)} ${String(r.pages ?? '–').padStart(4)} pages  ${r.failed.length ? r.failed.join('; ') : r.warnings.length ? `passes; ${r.warnings.length} warning(s)` : 'all checks pass'}`);
  if (args.includes('--strict') && results.some((r) => r.failed.length)) process.exitCode = 1;
}

/** Validate an EPUB with the W3C EPUBCheck (bundled jar; needs Java). */
export function runEpubcheck(file: string): { ok: boolean; summary: string } {
  const jar = join(REPO_ROOT, 'node_modules', 'epubcheck-static', 'vendor', 'epubcheck.jar');
  const r = spawnSync('java', ['-jar', jar, '--quiet', file], { encoding: 'utf8' });
  if (r.error) return { ok: false, summary: 'Java is not installed, so EPUBCheck could not run.' };
  const lines = `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /^(ERROR|FATAL|WARNING)/.test(l));
  return { ok: r.status === 0, summary: r.status === 0 ? `no errors${lines.length ? ` (${lines.length} warnings)` : ''}` : lines.slice(0, 5).join(' | ') || `exit code ${r.status}` };
}

async function epubcheck(args: string[]): Promise<void> {
  const file = args[0];
  if (!file) throw new Error('Usage: epubcheck <book.epub>');
  const r = runEpubcheck(file);
  console.log(`${r.ok ? '✓' : '✗'} EPUBCheck: ${r.summary}`);
  if (!r.ok) process.exitCode = 1;
}

async function verifyRefs(args: string[]): Promise<void> {
  const { dir, book, refs } = loadBook(args[0] ?? 'examples/rc-circuits/book.json');
  let bad = 0;
  for (const r of refs) {
    if (!r.DOI) {
      const ok = r.verification.status === 'verified';
      if (!ok) bad++;
      console.log(`${ok ? '•' : '✗'} ${r.id}: no DOI — ${ok ? `human-verified ${r.verification.checkedAt} (${r.verification.method})` : 'not verified'}`);
      continue;
    }
    const v = await verifyReference(r, { mailto: process.env.CROSSREF_MAILTO });
    if (v.status !== 'verified') bad++;
    console.log(`${v.status === 'verified' ? '✓' : '✗'} ${r.id}: ${v.note}`);
  }
  console.log(bad ? `${bad} reference(s) need attention in ${join(dir, book.bibliography)}` : 'All references verified.');
  if (bad) process.exitCode = 1;
}

/** Turn a project downloaded from the web app into a book folder, then build it. */
async function buildProject(args: string[]): Promise<void> {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Usage: build-project <scriptorium-project.json>');
  const project = JSON.parse(readFileSync(file, 'utf8')) as { book: { meta: { title: string } }; references: unknown[]; figures: Record<string, string>; models?: Record<string, unknown> };
  const slug = project.book.meta.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'book';
  const dir = join(REPO_ROOT, 'books', slug);
  mkdirSync(join(dir, 'figures'), { recursive: true });
  writeFileSync(join(dir, 'book.json'), JSON.stringify({ ...project.book, bibliography: 'references.json' }, null, 2));
  writeFileSync(join(dir, 'references.json'), JSON.stringify(project.references, null, 2));
  for (const [name, svg] of Object.entries(project.figures ?? {})) {
    if (!/^[a-z0-9-]+(\.dark)?\.svg$/.test(name)) throw new Error(`Refusing unexpected figure file name: ${name}`);
    if (/<script|\son\w+=|javascript:/i.test(svg)) throw new Error(`Figure ${name} contains script; refusing to write it.`);
    writeFileSync(join(dir, 'figures', name), svg);
  }
  for (const [path, model] of Object.entries(project.models ?? {})) {
    if (!/^models\/[a-z0-9-]+\.json$/.test(path)) throw new Error(`Refusing unexpected model file name: ${path}`);
    mkdirSync(join(dir, 'models'), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(Model.parse(model), null, 1) + '\n'); // schema-checked: numbers and short strings only
  }
  console.log(`✓ Unpacked project → ${rel(dir)}`);
  await build([join(dir, 'book.json'), ...args.filter((a) => a !== file)]);
}

/**
 * Generate a new book with your own key (ANTHROPIC_API_KEY in the environment or .env).
 * Pauses at both human checkpoints: edit outline.json, then press Enter; read the proof,
 * then press Enter to export.
 */
async function generate(args: string[]): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Set ANTHROPIC_API_KEY (see .env.example). The key is read from the environment and never written anywhere.');
  const topic = flag(args, 'topic');
  if (!topic) throw new Error('Usage: generate --topic "How lithium-ion batteries work" [--profile engineering] [--chapters 3] [--sections 2] [--cap 400000]');
  const profile = loadProfile(join(REPO_ROOT, 'profiles'), flag(args, 'profile', 'engineering')!);
  const st = newState({ topic, profileId: profile.id, chapters: Number(flag(args, 'chapters', '3')), sectionsPerChapter: Number(flag(args, 'sections', '2')), audience: flag(args, 'audience', 'Curious newcomers with high-school algebra')!, depth: 'introductory', author: flag(args, 'author', 'Scriptorium')! });
  const budget = new Budget({ capTokens: Number(flag(args, 'cap', '400000')), requestsPerMinute: Number(flag(args, 'rpm', '20')) });
  const deps = {
    provider: new AnthropicProvider({ apiKey: key, model: flag(args, 'model') }),
    budget,
    profile,
    scholarly: { mailto: process.env.CROSSREF_MAILTO },
    onEvent: (e: { stage: string; status: string; message?: string }) => console.log(`  [${STAGES.find((x) => x.id === e.stage)!.name}] ${e.status}${e.message ? ` — ${e.message}` : ''}`),
  };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const work = join(REPO_ROOT, 'books', `draft-${Date.now()}`);
  mkdirSync(work, { recursive: true });

  await runPipeline(st, deps);
  if (st.status.outline !== 'waiting-for-you') throw new Error(st.report.at(-1)?.message ?? 'Outline failed.');
  const outlinePath = join(work, 'outline.json');
  writeFileSync(outlinePath, JSON.stringify(st.outline, null, 2));
  await rl.question(`\nCheckpoint 1: edit ${rel(outlinePath)} if you like, then press Enter to approve it. `);
  approve(st, 'outline', Outline.parse(JSON.parse(readFileSync(outlinePath, 'utf8'))));

  await runPipeline(st, deps);
  writeFileSync(join(work, 'report.json'), JSON.stringify(st.report, null, 2));
  if (st.status.export !== 'waiting-for-you') throw new Error(`Stopped: ${st.report.at(-1)?.message}. Report: ${rel(join(work, 'report.json'))}`);
  const project = { book: st.book, references: st.verified, figures: Object.fromEntries(Object.entries(st.figures).flatMap(([id, f]) => [[`${id.slice(4)}.svg`, f.light], [`${id.slice(4)}.dark.svg`, f.dark]])), models: st.models };
  const projectPath = join(work, 'scriptorium-project.json');
  writeFileSync(projectPath, JSON.stringify(project, null, 2));
  const problems = st.report.filter((r) => r.level === 'problem').length;
  console.log(`\n${st.report.length} report items (${problems} problems) in ${rel(join(work, 'report.json'))}. Tokens used: ${budget.spent.toLocaleString()}.`);
  await rl.question('Checkpoint 2: press Enter to build the proof (web book + PDF). ');
  rl.close();
  approve(st, 'export');
  await buildProject([projectPath]);
}

function spine(args: string[]): void {
  const trim = parseTrim(flag(args, 'trim', '6x9')!);
  const pages = Number(flag(args, 'pages', '0'));
  const paper = flag(args, 'paper', 'white') as Paper;
  const g = coverGeometry(trim, pages, paper);
  console.log(JSON.stringify({ trim: trim.label, pages, paper, spineIn: +g.spine.toFixed(4), coverWidthIn: +g.width.toFixed(4), coverHeightIn: +g.height.toFixed(4), spineTextAllowed: g.spineTextAllowed }, null, 2));
}

async function preflight(args: string[]): Promise<void> {
  const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))!;
  const trim = parseTrim(flag(args, 'trim', '6x9')!);
  const checks = await preflightInterior(readFileSync(file), { trim, paper: (flag(args, 'paper', 'white') as Paper) ?? 'white', bleed: args.includes('--bleed'), insideMarginIn: Number(flag(args, 'inside', '0.75')) });
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.rule} — ${c.detail}`);
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

function ids(args: string[], name: string): string[] {
  return (flag(args, name) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

/** Show (and save) the converter's proposal for every figure; --approve / --reject record decisions. */
async function plan3d(args: string[]): Promise<void> {
  const { dir, book } = loadBook(args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'examples/rc-circuits/book.json');
  const plan = updatePlan(book, dir, { approve: ids(args, 'approve'), reject: ids(args, 'reject') });
  for (const e of plan.entries) {
    const t = effective(e);
    const proposed = e.proposed.mode === 'scene' ? `scene:${e.proposed.kit}` : e.proposed.mode;
    const applied = t.mode === 'scene' ? `scene:${t.kit}` : t.mode;
    console.log(`${e.approved ? '✓' : '?'} ${e.id.padEnd(28)} proposed ${proposed.padEnd(14)} → ${applied.padEnd(14)} ${e.approved ? e.reason.replace(/ Needs your approval\.$/, ' Approved.') : e.reason}`);
  }
  console.log(`Saved ${relative(process.cwd(), join(dir, PLAN_FILE))}. Scenes apply only after --approve.`);
}

/** Build the 3D Edition of one book into dist/<book>/edition3d. */
async function edition3d(args: string[]): Promise<void> {
  const t0 = Date.now();
  const { dir, book, refs, models } = loadBook(args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'examples/rc-circuits/book.json');
  const out = resolve(flag(args, 'out', join(REPO_ROOT, 'dist', basename(dir), 'edition3d'))!);
  const r = await exportEdition3D({ book, refs, models, csl: cslAssets(book.meta.citationStyle), webEdition: flag(args, 'web-edition', '../web/index.html') }, dir, out, (m) => process.stdout.write(`\r${m.padEnd(60)}`));
  process.stdout.write('\r'.padEnd(62) + '\r');
  const by = (mode: string) => r.manifest.figures.filter((f) => f.treatment.mode === mode).length;
  console.log(`✓ 3D Edition → ${relative(process.cwd(), out)}: ${r.manifest.pages.length} pages, ${r.manifest.figures.length} figures (${by('model')} models, ${by('scene')} scenes, ${by('lift')} lift, ${by('flat')} flat) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
}

// Read .env if present (Node ≥ 20.12). Secrets stay in the process environment only.
if (existsSync(join(REPO_ROOT, '.env'))) process.loadEnvFile(join(REPO_ROOT, '.env'));

export const commands: Record<string, (a: string[]) => unknown> = { build, 'build-all': buildAll, epubcheck, generate, 'build-project': buildProject, 'verify-refs': verifyRefs, spine, preflight, plan3d, edition3d };

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !commands[cmd]) {
  console.log(`Usage: scriptorium <${Object.keys(commands).join('|')}> [options]`);
  process.exitCode = cmd ? 1 : 0;
} else {
  Promise.resolve(commands[cmd]!(rest)).catch((e: Error) => {
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  });
}

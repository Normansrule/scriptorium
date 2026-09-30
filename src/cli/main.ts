#!/usr/bin/env node
/**
 * Scriptorium command line.
 *
 *   npm run build -- examples/rc-circuits/book.json            build web book + print PDF into dist/
 *   npm run cli -- generate --topic "How lithium-ion batteries work"   write a new book (needs ANTHROPIC_API_KEY)
 *   npm run cli -- build-project scriptorium-project.json      build a project downloaded from the web app
 *   npm run cli -- verify-refs examples/rc-circuits/book.json  re-check every DOI against Crossref
 *   npm run cli -- spine --pages 212 --paper white --trim 6x9  cover geometry for KDP
 *   npm run cli -- preflight dist/rc-circuits/book.pdf --trim 6x9
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { buildDisclosure } from '../disclosure/ai-disclosure.ts';
import { coverGeometry, findTrim, type Paper } from '../kdp/specs.ts';
import { preflightInterior } from '../kdp/preflight.ts';
import { formatBibliography } from '../render/cite.ts';
import { numberBook } from '../render/numbering.ts';
import { verifyReference } from '../research/scholarly.ts';
import { exportPdf } from '../node/export-pdf.ts';
import { exportWeb } from '../node/export-web.ts';
import { cslAssets, loadBook, REPO_ROOT } from '../node/load.ts';
import { approve, newState, runPipeline, Outline, STAGES } from '../core/pipeline.ts';
import { AnthropicProvider } from '../llm/provider.ts';
import { Budget } from '../llm/budget.ts';
import { loadProfile } from '../node/profiles.ts';

const rel = (p: string) => relative(process.cwd(), p) || '.';

function flag(args: string[], name: string, fallback?: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

function parseTrim(s: string) {
  const [w, h] = s.split('x').map(Number);
  return findTrim(w!, h!);
}

async function build(args: string[]): Promise<void> {
  const t0 = Date.now();
  const bookPath = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'examples/rc-circuits/book.json';
  const { dir, book, refs } = loadBook(bookPath);
  const name = basename(dir);
  const out = resolve(flag(args, 'out', join(REPO_ROOT, 'dist', name))!);
  mkdirSync(out, { recursive: true });

  const figScript = join(dir, 'figures.ts');
  if (existsSync(figScript)) {
    const mod = (await import(pathToFileURL(figScript).href)) as { drawAll?: () => string[] };
    const n = mod.drawAll?.().length ?? 0;
    console.log(`✓ Drew ${n} figure files (light + dark)`);
  }

  const numbering = numberBook(book);
  const order = [...numbering.cite.keys()];
  const assets = cslAssets(book.meta.citationStyle);
  const disclosure = buildDisclosure(book, { figureScriptsByAi: /written with AI assistance/i.test(book.meta.colophon ?? '') });
  const d = { text: disclosure.text.answer, images: disclosure.images.answer, translations: disclosure.translations.answer };

  const htmlPath = exportWeb(book, dir, { numbering, bibliography: formatBibliography(refs, order, assets, 'html'), refs, disclosure: d }, join(out, 'web'));
  console.log(`✓ Web book  → ${rel(htmlPath)}`);

  if (!args.includes('--skip-pdf')) {
    const trim = parseTrim(flag(args, 'trim', '6x9')!);
    const res = await exportPdf(book, dir, { numbering, bibliography: formatBibliography(refs, order, assets, 'text'), refs, disclosure: d }, { trimWidthIn: trim.width, trimHeightIn: trim.height, insideIn: 0.75, outsideIn: 0.625, topIn: 0.75, bottomIn: 0.8, bleed: false });
    const pdfPath = join(out, 'book.pdf');
    writeFileSync(pdfPath, res.pdf);
    writeFileSync(join(out, 'book.typ'), res.typst);
    res.diagnostics.forEach((m) => console.log(`  ${m}`));
    console.log(`✓ Print PDF → ${rel(pdfPath)} (${res.pages} pages, ${trim.label})`);

    const checks = await preflightInterior(res.pdf, { trim, paper: (flag(args, 'paper', 'white') as Paper) ?? 'white', bleed: false, insideMarginIn: res.layout.insideIn });
    writeFileSync(join(out, 'preflight.json'), JSON.stringify(checks, null, 2));
    const failed = checks.filter((c) => !c.ok);
    console.log(`${failed.length ? '✗' : '✓'} KDP pre-flight: ${checks.length - failed.length}/${checks.length} checks pass`);
    for (const c of failed) console.log(`    ✗ ${c.rule}: ${c.detail}`);
    if (failed.length && args.includes('--strict')) process.exitCode = 1;
  }
  writeFileSync(join(out, 'ai-disclosure.json'), JSON.stringify(disclosure, null, 2));
  console.log(`✓ AI disclosure → ${rel(join(out, 'ai-disclosure.json'))} (text: ${d.text}, images: ${d.images}, translations: ${d.translations})`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
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
  const project = JSON.parse(readFileSync(file, 'utf8')) as { book: { meta: { title: string } }; references: unknown[]; figures: Record<string, string> };
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
  const project = { book: st.book, references: st.verified, figures: Object.fromEntries(Object.entries(st.figures).flatMap(([id, f]) => [[`${id.slice(4)}.svg`, f.light], [`${id.slice(4)}.dark.svg`, f.dark]])) };
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

// Read .env if present (Node ≥ 20.12). Secrets stay in the process environment only.
if (existsSync(join(REPO_ROOT, '.env'))) process.loadEnvFile(join(REPO_ROOT, '.env'));

export const commands: Record<string, (a: string[]) => unknown> = { build, generate, 'build-project': buildProject, 'verify-refs': verifyRefs, spine, preflight };

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

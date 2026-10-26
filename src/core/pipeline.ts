/**
 * The nine-stage generation pipeline. Each stage is visible in the UI (progress events),
 * and the pipeline pauses at the two human checkpoints: after the outline and before
 * the final export. Everything runs in the browser or in Node; network access is
 * injected (fetch for the scholarly databases, a Provider for the model).
 */
import { z } from 'zod';
import type { Book, Chapter, Reference, Section } from './book.ts';
import { Block, Book as BookSchema, Exercise, Explore, Quiz } from './book.ts';
import { exploreProblems } from '../render/explore.ts';
import { lintBook } from './concision.ts';
import type { Profile } from './profile.ts';
import { fleschKincaid, TARGET_GRADE } from './readability.ts';
import { compile } from './expr.ts';
import { callModel, type Provider } from '../llm/provider.ts';
import type { Budget } from '../llm/budget.ts';
import { draftPrompt, outlinePrompt, reviewPrompt } from '../llm/prompts.ts';
import { guardCitations, injectionSignals, parseModelJson, wrapUntrusted } from '../llm/untrusted.ts';
import { fetchAbstract, matchReference, resolveDoi, searchCrossref, searchOpenAlex, type ScholarlyHit, type ScholarlyOptions } from '../research/scholarly.ts';
import { searchPubMed, verifyPmid, type PubMedHit } from '../research/pubmed.ts';
import { fetchPdbEntry, fetchPubChem3D, type FetchedStructure } from '../research/structures.ts';
import { renderMoleculeSvg, STILL } from '../render/molecule-svg.ts';
import type { Model } from './molecule.ts';
import { plot, type PlotSpec } from '../render/svg.ts';
import { renderMath } from '../render/html.ts';

// ---------------------------------------------------------------------------
// Stage list

export const STAGES = [
  { id: 'scope', name: 'Topic + scope', checkpoint: false, what: 'Topic, depth, audience, length, domain profile, citation style.' },
  { id: 'outline', name: 'Outline', checkpoint: true, what: 'Chapters, sections and learning goals. You edit and approve it.' },
  { id: 'research', name: 'Research', checkpoint: false, what: 'Search Crossref, OpenAlex and PubMed; collect candidate sources with DOIs or PubMed IDs.' },
  { id: 'verify', name: 'Verification', checkpoint: false, what: 'Resolve every DOI and match title, year and author; drop what fails.' },
  { id: 'draft', name: 'Drafting', checkpoint: false, what: 'Write each section in five layers, citing only verified sources.' },
  { id: 'figures', name: 'Figures + equations', checkpoint: false, what: 'Draw proposed plots from safe expressions; check every equation parses.' },
  { id: 'review', name: 'Expert review', checkpoint: false, what: 'A separate reviewer critiques accuracy, rigor and citation support.' },
  { id: 'readability', name: 'Readability', checkpoint: false, what: 'Measure reading grade, build the glossary.' },
  { id: 'export', name: 'Layout + export', checkpoint: true, what: 'Web book, print PDF and EPUB. You review the final proof.' },
] as const;
export type StageId = (typeof STAGES)[number]['id'];
export type StageStatus = 'pending' | 'running' | 'waiting-for-you' | 'done' | 'failed';

// ---------------------------------------------------------------------------
// Inputs and state

export const Scope = z.object({
  topic: z.string().min(3).max(300),
  audience: z.string().default('Curious newcomers with high-school algebra'),
  depth: z.enum(['introductory', 'intermediate', 'advanced']).default('introductory'),
  chapters: z.number().int().min(1).max(12).default(3),
  sectionsPerChapter: z.number().int().min(1).max(6).default(2),
  profileId: z.string(),
  citationStyle: z.string().optional(),
  author: z.string().default('Scriptorium'),
});
export type Scope = z.infer<typeof Scope>;

export const Outline = z.object({
  title: z.string(),
  subtitle: z.string().default(''),
  chapters: z
    .array(
      z.object({
        id: z.string().regex(/^ch-[a-z0-9-]+$/),
        title: z.string(),
        goals: z.array(z.string()).min(1),
        hook: z.string().optional(),
        prerequisites: z.array(z.string()).default([]),
        queries: z.array(z.string()).min(1).max(6),
        sections: z.array(z.object({ id: z.string().regex(/^sec-[a-z0-9-]+$/), title: z.string(), summary: z.string() })).min(1),
      }),
    )
    .min(1),
  warnings: z.array(z.string()).default([]),
});
export type Outline = z.infer<typeof Outline>;

const PlotBlock = z.object({
  kind: z.literal('plot'),
  id: z.string().regex(/^fig-[a-z0-9-]+$/),
  alt: z.string().min(10),
  caption: z.string(),
  x: z.object({ label: z.string(), from: z.number(), to: z.number(), log: z.boolean().default(false) }),
  y: z.object({ label: z.string(), from: z.number(), to: z.number() }),
  series: z.array(z.object({ label: z.string(), expr: z.string().max(300) })).min(1).max(3),
});
type PlotBlock = z.infer<typeof PlotBlock>;

const StructureBlock = z.object({
  kind: z.literal('structure'),
  id: z.string().regex(/^fig-[a-z0-9-]+$/),
  source: z.enum(['pubchem', 'pdb']),
  /** compound name for PubChem, four-character entry ID for the Protein Data Bank */
  name: z.string().min(1).max(80),
  alt: z.string().min(10),
  caption: z.string(),
});

/** The three standard views every 3D figure prints. */
export const STANDARD_VIEWS = [
  { label: 'front', yaw: 0, pitch: 0 },
  { label: 'side', yaw: 90, pitch: 0 },
  { label: 'angled', yaw: 35, pitch: -30 },
] as const;

const DraftBlock = z.union([PlotBlock, z.any()]);
const Draft = z.object({
  summary: z.array(DraftBlock).min(1),
  intuition: z.array(DraftBlock).min(1),
  formal: z.array(DraftBlock).default([]),
  limits: z.array(DraftBlock).min(1),
  takeaways: z.array(z.string()).min(1),
  /** practice questions for this section; gathered at the chapter's end */
  exercises: z.array(z.any()).default([]),
  terms: z.array(z.object({ term: z.string(), definition: z.string() })).default([]),
  uncited_claims: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

const Review = z.object({
  issues: z.array(z.object({ severity: z.enum(['high', 'medium', 'low']), where: z.string(), problem: z.string(), fix: z.string() })).default([]),
  unsupported_citations: z.array(z.object({ id: z.string(), claim: z.string() })).default([]),
});

export interface ReportItem {
  stage: StageId;
  level: 'info' | 'warning' | 'problem';
  where: string;
  message: string;
}

export interface PipelineState {
  scope: Scope;
  status: Record<StageId, StageStatus>;
  outline?: Outline;
  candidates: Reference[];
  verified: Reference[];
  abstracts: Record<string, string>;
  drafts: Record<string, z.infer<typeof Draft>>; // by section id
  figures: Record<string, { light: string; dark: string }>; // fig id → SVG
  /** 3D models fetched for model3d figures, keyed by their src path in the book. */
  models: Record<string, Model>;
  book?: Book;
  report: ReportItem[];
  readability: Record<string, number>; // section id → grade
}

export interface PipelineDeps {
  provider: Provider;
  budget: Budget;
  profile: Profile;
  scholarly?: ScholarlyOptions;
  onEvent?: (e: { stage: StageId; status: StageStatus; message?: string; progress?: number }) => void;
  today?: () => string;
}

export function newState(scope: Scope): PipelineState {
  return {
    scope: Scope.parse(scope),
    status: Object.fromEntries(STAGES.map((s) => [s.id, 'pending'])) as Record<StageId, StageStatus>,
    candidates: [],
    verified: [],
    abstracts: {},
    drafts: {},
    figures: {},
    models: {},
    report: [],
    readability: {},
  };
}

// ---------------------------------------------------------------------------
// Stages

const kebab = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function hitToReference(h: ScholarlyHit, today: string): Reference {
  const first = h.authors[0]?.family ?? 'anon';
  return {
    id: kebab(`${first}-${h.year ?? 'nd'}-${h.title.split(/\s+/).slice(0, 3).join('-')}`),
    type: 'article-journal',
    title: h.title.replace(/<[^>]+>/g, ''),
    author: h.authors.slice(0, 12).map((a) => ({ family: a.family, given: a.given })),
    issued: { 'date-parts': [[h.year ?? 0]] },
    'container-title': h.container,
    DOI: h.doi,
    PMID: (h as PubMedHit).pmid || undefined,
    URL: !h.doi && (h as PubMedHit).pmid ? `https://pubmed.ncbi.nlm.nih.gov/${(h as PubMedHit).pmid}/` : undefined,
    verification: { status: 'unverified', method: h.doi ? 'crossref' : 'pubmed', checkedAt: today, note: `found by ${h.source} search`, supports: [] },
  };
}

async function stageOutline(st: PipelineState, d: PipelineDeps): Promise<void> {
  const s = st.scope;
  const res = await callModel(d.provider, d.budget, {
    system: outlinePrompt(d.profile),
    prompt: `Topic: ${s.topic}\nAudience: ${s.audience}\nDepth: ${s.depth}\nChapters: ${s.chapters}\nSections per chapter: ${s.sectionsPerChapter}`,
    maxTokens: 4000,
    purpose: 'outline',
  });
  st.outline = parseModelJson(res.text, Outline);
  st.outline.warnings.forEach((w) => st.report.push({ stage: 'outline', level: 'warning', where: 'outline', message: w }));
}

async function stageResearch(st: PipelineState, d: PipelineDeps): Promise<void> {
  const today = d.today?.() ?? new Date().toISOString().slice(0, 10);
  const seen = new Set<string>();
  const queries = st.outline!.chapters.flatMap((c) => c.queries);
  let i = 0;
  for (const q of queries) {
    d.onEvent?.({ stage: 'research', status: 'running', message: `Searching: ${q}`, progress: i++ / queries.length });
    const hits: ScholarlyHit[] = [];
    try {
      hits.push(...(await searchCrossref(q, 5, d.scholarly)));
    } catch (e) {
      st.report.push({ stage: 'research', level: 'warning', where: q, message: (e as Error).message });
    }
    if (d.profile.databases.includes('openalex')) {
      try {
        hits.push(...(await searchOpenAlex(q, 5, d.scholarly)));
      } catch (e) {
        st.report.push({ stage: 'research', level: 'warning', where: q, message: (e as Error).message });
      }
    }
    if (d.profile.databases.includes('pubmed')) {
      try {
        hits.push(...(await searchPubMed(q, 5, d.scholarly)));
      } catch (e) {
        st.report.push({ stage: 'research', level: 'warning', where: q, message: (e as Error).message });
      }
    }
    for (const h of hits) {
      const key = h.doi ?? ((h as PubMedHit).pmid ? `pmid:${(h as PubMedHit).pmid}` : '');
      if (!key || seen.has(key) || !h.title) continue;
      seen.add(key);
      const ref = hitToReference(h, today);
      if (!st.candidates.some((c) => c.id === ref.id)) st.candidates.push(ref);
    }
  }
}

async function stageVerify(st: PipelineState, d: PipelineDeps): Promise<void> {
  const today = d.today?.() ?? new Date().toISOString().slice(0, 10);
  let i = 0;
  for (const ref of st.candidates) {
    d.onEvent?.({ stage: 'verify', status: 'running', message: ref.title, progress: i++ / st.candidates.length });
    try {
      if (!ref.DOI && ref.PMID) {
        const v = await verifyPmid(ref.PMID, ref.title, d.scholarly);
        if (!v.ok) {
          st.report.push({ stage: 'verify', level: 'warning', where: ref.id, message: `${v.note}; dropped.` });
          continue;
        }
        st.abstracts[ref.id] = '';
        st.verified.push({ ...ref, verification: { ...ref.verification, status: 'verified', method: 'pubmed', checkedAt: today, note: v.note } });
        continue;
      }
      const hit = await resolveDoi(ref.DOI!, d.scholarly);
      if (!hit) {
        st.report.push({ stage: 'verify', level: 'warning', where: ref.id, message: `DOI ${ref.DOI} does not resolve; dropped.` });
        continue;
      }
      const m = matchReference(ref, hit);
      if (!m.ok) {
        st.report.push({ stage: 'verify', level: 'warning', where: ref.id, message: `Metadata mismatch (${m.note}); dropped.` });
        continue;
      }
      const abstract = await fetchAbstract(ref.DOI!, d.scholarly).catch(() => '');
      const flags = injectionSignals(abstract);
      if (flags.length) st.report.push({ stage: 'verify', level: 'problem', where: ref.id, message: `Abstract contains text that looks like instructions (${flags.join(', ')}); it is passed to the model as data only.` });
      st.abstracts[ref.id] = abstract;
      st.verified.push({ ...ref, verification: { ...ref.verification, status: 'verified', checkedAt: today, note: m.note + (abstract ? '; abstract retrieved from OpenAlex' : '; no abstract available') } });
    } catch (e) {
      st.report.push({ stage: 'verify', level: 'warning', where: ref.id, message: (e as Error).message });
    }
  }
  if (!st.verified.length) st.report.push({ stage: 'verify', level: 'problem', where: 'bibliography', message: 'No sources could be verified; drafted text will carry no citations.' });
}

function referenceBlock(st: PipelineState): string {
  const lines = st.verified.map((r) => `[${r.id}] ${r.author?.[0]?.family ?? ''} (${r.issued?.['date-parts'][0]?.[0] ?? 'n.d.'}). ${r.title}. ${r['container-title'] ?? ''}. Abstract: ${st.abstracts[r.id] || '(none available)'}`);
  return wrapUntrusted('verified-references', lines.join('\n\n'));
}

async function stageDraft(st: PipelineState, d: PipelineDeps): Promise<void> {
  const refs = referenceBlock(st);
  const verifiedIds = new Set(st.verified.map((r) => r.id));
  const all = st.outline!.chapters.flatMap((c) => c.sections.map((s) => ({ c, s })));
  let i = 0;
  for (const { c, s } of all) {
    d.onEvent?.({ stage: 'draft', status: 'running', message: s.title, progress: i++ / all.length });
    const res = await callModel(d.provider, d.budget, {
      system: draftPrompt(d.profile),
      prompt: `Book: ${st.outline!.title}\nAudience: ${st.scope.audience}\nChapter: ${c.title}\nChapter goals: ${c.goals.join('; ')}\nSection: ${s.title}\nSection plan: ${s.summary}\n\n${refs}`,
      maxTokens: 9000,
      purpose: `draft ${c.id}/${s.id}`,
    });
    const draft = parseModelJson(res.text, Draft);
    // Citation guard: any [@id] that is not a verified reference is removed and reported.
    const clean = (t: string) => {
      const g = guardCitations(t, verifiedIds);
      g.removed.forEach((id) => st.report.push({ stage: 'draft', level: 'problem', where: s.id, message: `Removed citation to unknown source "${id}".` }));
      return g.text;
    };
    st.drafts[s.id] = JSON.parse(JSON.stringify(draft), (_k, v) => (typeof v === 'string' ? clean(v) : v));
    draft.uncited_claims.forEach((claim) => st.report.push({ stage: 'draft', level: 'warning', where: s.id, message: `Uncited claim (explanation, not sourced): ${claim}` }));
    draft.warnings.forEach((w) => st.report.push({ stage: 'draft', level: 'warning', where: s.id, message: w }));
  }
}

function plotToSpec(p: PlotBlock): PlotSpec {
  const ticks = (from: number, to: number, log: boolean) => {
    if (log) {
      const out: number[] = [];
      for (let e = Math.ceil(Math.log10(from)); e <= Math.floor(Math.log10(to)); e++) out.push(10 ** e);
      return out;
    }
    const step = (to - from) / 5;
    return Array.from({ length: 6 }, (_, k) => +(from + k * step).toPrecision(4));
  };
  return {
    title: p.caption.slice(0, 120),
    desc: p.alt,
    x: { label: p.x.label, from: p.x.from, to: p.x.to, log: p.x.log, ticks: ticks(p.x.from, p.x.to, p.x.log) },
    y: { label: p.y.label, from: p.y.from, to: p.y.to, ticks: ticks(p.y.from, p.y.to, false) },
    series: p.series.map((s, i) => ({ label: s.label, expr: s.expr, role: (['signal', 'accent', 'external'] as const)[i], direct: p.series.length === 1 })),
  };
}

async function structureToModel3d(sb: z.infer<typeof StructureBlock>, st: PipelineState, d: PipelineDeps): Promise<unknown> {
  const fetched: FetchedStructure = sb.source === 'pubchem' ? await fetchPubChem3D(sb.name, d.scholarly) : await fetchPdbEntry(sb.name, d.scholarly);
  const slug = sb.id.replace(/^fig-/, '');
  const src = `models/${slug}.json`;
  st.models[src] = fetched.model;
  const views = STANDARD_VIEWS.map((v) => {
    const key = `${sb.id}--${v.label}`;
    st.figures[key] = {
      light: renderMoleculeSvg(fetched.model, v, { ...STILL, mode: 'light', scale: 'to-scale', title: `${sb.alt} (${v.label})` }),
      dark: renderMoleculeSvg(fetched.model, v, { ...STILL, mode: 'dark', scale: 'to-scale', title: `${sb.alt} (${v.label})` }),
    };
    return { src: `figures/${slug}--${v.label}.svg`, label: v.label, yaw: v.yaw, pitch: v.pitch };
  });
  return { kind: 'model3d', id: sb.id, src, alt: sb.alt, caption: sb.caption, credit: `${fetched.credit} ${fetched.url}`, provenance: 'third-party', scale: 'to-scale', views, annotations: [], width: 1 };
}

async function stageFigures(st: PipelineState, d: PipelineDeps): Promise<void> {
  const allow3d = d.profile.figureTypes.some((f) => f.id === 'molecule-3d' || f.id === 'structure-3d');
  for (const [sid, draft] of Object.entries(st.drafts)) {
    for (const layerName of ['summary', 'intuition', 'formal', 'limits'] as const) {
      const out: unknown[] = [];
      for (const b of draft[layerName] as unknown[]) {
        const sb = StructureBlock.safeParse(b);
        if (sb.success) {
          if (!allow3d) {
            st.report.push({ stage: 'figures', level: 'warning', where: `${sid}/${sb.data.id}`, message: `The ${d.profile.name} profile has no 3D figure type; structure dropped.` });
            continue;
          }
          try {
            out.push(await structureToModel3d(sb.data, st, d));
            st.report.push({ stage: 'figures', level: 'info', where: `${sid}/${sb.data.id}`, message: `3D coordinates downloaded from ${sb.data.source === 'pubchem' ? 'PubChem' : 'the Protein Data Bank'} for "${sb.data.name}"; check the structure is the one the text describes.` });
          } catch (e) {
            st.report.push({ stage: 'figures', level: 'problem', where: `${sid}/${sb.data.id}`, message: `3D structure dropped: ${(e as Error).message}` });
          }
          continue;
        }
        const pb = PlotBlock.safeParse(b);
        if (pb.success) {
          try {
            pb.data.series.forEach((s) => compile(s.expr));
            const spec = plotToSpec(pb.data);
            st.figures[pb.data.id] = { light: plot(spec, 'light'), dark: plot(spec, 'dark') };
            out.push({ kind: 'figure', id: pb.data.id, src: `figures/${pb.data.id.replace(/^fig-/, '')}.svg`, alt: pb.data.alt, caption: pb.data.caption, credit: 'Drawn by Scriptorium from the expression proposed in drafting.', provenance: 'ai-generated', width: 1 });
          } catch (e) {
            st.report.push({ stage: 'figures', level: 'problem', where: `${sid}/${pb.data.id}`, message: `Plot dropped: ${(e as Error).message}` });
          }
          continue;
        }
        if ((b as { kind?: string }).kind === 'explore') {
          // a proposed explorable must parse, and its expressions must only use its own sliders
          const xb = Explore.safeParse({ ...(b as object), test: 'unverified' });
          const problems = xb.success ? exploreProblems(xb.data) : [xb.error.issues.map((i) => i.message).join('; ')];
          if (problems.length) {
            st.report.push({ stage: 'figures', level: 'problem', where: `${sid}/${(b as { id?: string }).id ?? 'explore'}`, message: `Explorable dropped: ${problems.join(' ')}` });
            continue;
          }
          st.report.push({ stage: 'figures', level: 'warning', where: `${sid}/${xb.data!.id}`, message: 'Explorable readouts are unverified: add a check in tests/equations that recomputes them at the defaults, and point "test" at it before publishing.' });
          out.push(xb.data!);
          continue;
        }
        if ((b as { kind?: string }).kind === 'quiz') {
          const q = Quiz.safeParse(b);
          if (!q.success) {
            st.report.push({ stage: 'figures', level: 'problem', where: `${sid}/${(b as { id?: string }).id ?? 'quiz'}`, message: `Self-check dropped: ${q.error.issues.map((i) => i.message).join('; ')}` });
            continue;
          }
        }
        const lb = b as { kind?: string; id?: string; steps?: Array<{ latex?: string }>; test?: string };
        if (lb.kind === 'derivation' || lb.kind === 'problem') {
          try {
            for (const step of lb.steps ?? []) if (step.latex) renderMath(step.latex, true);
          } catch (e) {
            st.report.push({ stage: 'figures', level: 'problem', where: `${sid}/${lb.id}`, message: `${lb.kind === 'derivation' ? 'Derivation' : 'Worked problem'} has maths that does not parse and was dropped: ${(e as Error).message}` });
            continue;
          }
          st.report.push({ stage: 'figures', level: 'warning', where: `${sid}/${lb.id}`, message: `${lb.kind === 'derivation' ? 'Derivation' : 'Worked problem'} is unverified: add a SymPy/Pint check in tests/equations and point "test" at it before publishing.` });
          lb.test = 'unverified';
        }
        const eq = b as { kind?: string; id?: string; latex?: string; example?: { check?: string } };
        if (eq.kind === 'equation') {
          try {
            renderMath(eq.latex ?? '', true);
          } catch (e) {
            st.report.push({ stage: 'figures', level: 'problem', where: `${sid}/${eq.id}`, message: `Equation does not parse and was dropped: ${(e as Error).message}` });
            continue;
          }
          st.report.push({ stage: 'figures', level: 'warning', where: `${sid}/${eq.id}`, message: 'Equation and worked example are unverified: add a SymPy/Pint check in tests/equations and set example.check before publishing.' });
          eq.example = { ...(eq.example ?? {}), check: 'unverified' };
        }
        out.push(b);
      }
      draft[layerName] = out;
    }
  }
}

async function stageReview(st: PipelineState, d: PipelineDeps): Promise<void> {
  const refs = referenceBlock(st);
  const entries = Object.entries(st.drafts);
  let i = 0;
  for (const [sid, draft] of entries) {
    d.onEvent?.({ stage: 'review', status: 'running', message: sid, progress: i++ / entries.length });
    const res = await callModel(d.provider, d.budget, {
      system: reviewPrompt(d.profile),
      prompt: `${wrapUntrusted(`draft ${sid}`, JSON.stringify(draft))}\n\n${refs}`,
      maxTokens: 3000,
      purpose: `review ${sid}`,
    });
    const review = parseModelJson(res.text, Review);
    for (const issue of review.issues) st.report.push({ stage: 'review', level: issue.severity === 'high' ? 'problem' : 'warning', where: `${sid}: ${issue.where}`, message: `${issue.problem} — suggested fix: ${issue.fix}` });
    for (const u of review.unsupported_citations) st.report.push({ stage: 'review', level: 'problem', where: `${sid}: [@${u.id}]`, message: `Citation may not support: "${u.claim}". Check the source before publishing.` });
  }
}

function assembleBook(st: PipelineState, d: PipelineDeps): Book {
  const o = st.outline!;
  const terms = new Map<string, string>();
  const seenExercise = new Set<string>();
  const chapters: Chapter[] = o.chapters.map((c) => ({
    id: c.id,
    title: c.title,
    goals: c.goals,
    hook: c.hook,
    sections: c.sections.map((s): Section => {
      const dr = st.drafts[s.id]!;
      dr.terms.forEach((t) => terms.set(t.term, t.definition));
      // Keep only blocks that match the book schema; report the rest instead of failing the book.
      const valid = (xs: unknown[], layerName: string): Block[] =>
        xs.flatMap((x) => {
          const r = Block.safeParse(x);
          if (r.success) return [r.data];
          st.report.push({ stage: 'readability', level: 'problem', where: `${s.id}/${layerName}`, message: `Dropped a malformed block: ${r.error.issues[0]?.message ?? 'invalid'}` });
          return [];
        });
      return { id: s.id, title: s.title, provenance: 'ai-generated', layers: { summary: valid(dr.summary, 'summary'), intuition: valid(dr.intuition, 'intuition'), formal: valid(dr.formal, 'formal'), limits: valid(dr.limits, 'limits'), takeaways: dr.takeaways } };
    }),
    summary: c.sections.map((s) => st.drafts[s.id]!.takeaways[0]!).filter(Boolean),
    keyEquations: c.sections.flatMap((s) => (st.drafts[s.id]!.formal as Array<{ kind?: string; id?: string }>).filter((b) => b.kind === 'equation').map((b) => b.id!)),
    furtherReading: [],
    prerequisites: c.prerequisites,
    exercises: c.sections.flatMap((s) =>
      (st.drafts[s.id]!.exercises as unknown[]).flatMap((x) => {
        const r = Exercise.safeParse({ ...(x as object), test: 'unverified' });
        if (r.success && !seenExercise.has(r.data.id)) {
          seenExercise.add(r.data.id);
          return [r.data];
        }
        if (r.success) return [];
        st.report.push({ stage: 'readability', level: 'warning', where: `${s.id}/exercises`, message: `Dropped a malformed exercise: ${r.error.issues[0]?.message ?? 'invalid'}` });
        return [];
      }),
    ),
  }));
  const book = {
    meta: {
      title: o.title,
      subtitle: o.subtitle || undefined,
      authors: [st.scope.author],
      profile: d.profile.id,
      citationStyle: st.scope.citationStyle ?? d.profile.citationStyle,
      audience: st.scope.audience,
      language: 'en',
      date: d.today?.() ?? new Date().toISOString().slice(0, 10),
      license: 'All rights reserved by the author unless stated otherwise.',
      colophon: `Drafted with an AI model (${d.provider.name}/${d.provider.model}) by Scriptorium and reviewed by a second model pass. See the verification report before publishing.`,
    },
    preface: [
      ...d.profile.safetyNotes.map((t) => ({ kind: 'callout', tone: 'safety', title: 'Safety', text: t })),
      ...(d.profile.requiresProfessionalReview
        ? [{ kind: 'callout', tone: 'safety', title: 'Professional review required', text: 'This book was flagged for review by a licensed professional before publication. It is educational and gives no individual advice.' }]
        : []),
    ],
    chapters,
    glossary: [...terms].map(([term, definition]) => ({ term, definition })),
    bibliography: 'references.json',
  };
  return BookSchema.parse(book);
}

async function stageReadability(st: PipelineState, d: PipelineDeps): Promise<void> {
  for (const [sid, dr] of Object.entries(st.drafts)) {
    const texts = [...dr.summary, ...dr.intuition, ...dr.limits].flatMap((b: { text?: string; items?: string[] }) => [b.text ?? '', ...(b.items ?? [])]);
    const r = fleschKincaid(texts.join(' '));
    st.readability[sid] = r.grade;
    if (r.grade > TARGET_GRADE.max + 1) st.report.push({ stage: 'readability', level: 'warning', where: sid, message: `Reading grade ${r.grade} (target ${TARGET_GRADE.min}–${TARGET_GRADE.max}). Shorten sentences or define more terms.` });
  }
  if (d.profile.requiresProfessionalReview)
    st.report.push({ stage: 'readability', level: 'problem', where: 'whole book', message: `The ${d.profile.name} profile requires review by a licensed professional before publishing.` });
  st.book = assembleBook(st, d);
  // Padding is reported, never fatal: the editor shows the same list as places to tighten.
  const conc = lintBook(st.book);
  for (const f of conc.findings.slice(0, 12)) st.report.push({ stage: 'readability', level: 'info', where: f.where, message: `Tighten: “${f.text}” — ${f.fix}` });
  if (conc.findings.length > 12) st.report.push({ stage: 'readability', level: 'info', where: 'whole book', message: `${conc.findings.length - 12} more places to tighten; see Edit.` });
}

const RUNNERS: Record<StageId, (st: PipelineState, d: PipelineDeps) => Promise<void>> = {
  scope: async () => {},
  outline: stageOutline,
  research: stageResearch,
  verify: stageVerify,
  draft: stageDraft,
  figures: stageFigures,
  review: stageReview,
  readability: stageReadability,
  export: async () => {},
};

/**
 * Run stages in order until the pipeline reaches a checkpoint that has not been
 * approved, or the end. Call again after `approve()` to continue.
 */
export async function runPipeline(st: PipelineState, d: PipelineDeps): Promise<PipelineState> {
  for (const stage of STAGES) {
    const s = st.status[stage.id];
    if (s === 'done') continue;
    if (s === 'waiting-for-you') return st;
    st.status[stage.id] = 'running';
    d.onEvent?.({ stage: stage.id, status: 'running' });
    try {
      await RUNNERS[stage.id](st, d);
    } catch (e) {
      st.status[stage.id] = 'failed';
      st.report.push({ stage: stage.id, level: 'problem', where: stage.name, message: (e as Error).message });
      d.onEvent?.({ stage: stage.id, status: 'failed', message: (e as Error).message });
      return st;
    }
    st.status[stage.id] = stage.checkpoint ? 'waiting-for-you' : 'done';
    d.onEvent?.({ stage: stage.id, status: st.status[stage.id] });
    if (stage.checkpoint) return st;
  }
  return st;
}

/** Human checkpoint: accept (optionally edited) outline, or the final proof. */
export function approve(st: PipelineState, stage: 'outline' | 'export', editedOutline?: Outline): void {
  if (st.status[stage] !== 'waiting-for-you') throw new Error(`${stage} is not waiting for approval.`);
  if (stage === 'outline' && editedOutline) st.outline = Outline.parse(editedOutline);
  st.status[stage] = 'done';
}

export function referencesForExport(st: PipelineState): Reference[] {
  return st.verified;
}

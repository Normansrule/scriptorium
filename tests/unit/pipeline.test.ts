/**
 * End-to-end pipeline run with a recorded model (ReplayProvider) and a mock scholarly
 * API: no key, no network. Checks the checkpoints, the citation guard and the report.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { approve, newState, runPipeline } from '../../src/core/pipeline.ts';
import { Budget } from '../../src/llm/budget.ts';
import { ReplayProvider, type ChatRequest } from '../../src/llm/provider.ts';
import { loadProfile } from '../../src/node/profiles.ts';
import { REPO_ROOT } from '../../src/node/load.ts';

const outline = {
  title: 'Resistors and Capacitors',
  subtitle: 'A tiny test book',
  chapters: [{ id: 'ch-rc', title: 'Time constants', goals: ['Explain the time constant.'], queries: ['RC time constant'], sections: [{ id: 'sec-tau', title: 'The time constant', summary: 'tau = RC' }] }],
  warnings: [],
};
const draft = {
  summary: [{ kind: 'para', text: 'The time constant $\\tau = RC$ sets the speed [@sallen-1955-a-practical-method]. A made-up claim [@fake-2020].' }],
  intuition: [{ kind: 'para', text: 'Bigger R or C means slower charging.' }, { kind: 'plot', id: 'fig-charge', alt: 'Charging curve from zero to one.', caption: 'Charging slows down over time.', x: { label: 't/τ', from: 0, to: 5 }, y: { label: 'v/Vs', from: 0, to: 1 }, series: [{ label: 'v/Vs', expr: '1 - exp(-x)' }] }, { kind: 'plot', id: 'fig-evil', alt: 'An attempt to run code.', caption: 'x', x: { label: 'x', from: 0, to: 1 }, y: { label: 'y', from: 0, to: 1 }, series: [{ label: 'y', expr: 'process.exit(1)' }] }],
  formal: [{ kind: 'equation', id: 'eq-tau', intuition: 'Both slow it down.', latex: '\\tau = RC', where: [{ symbol: '\\tau', meaning: 'time constant', unit: 's' }], example: { text: '10 kΩ × 100 µF = 1 s', check: 'pending' }, validity: 'Ideal parts.' }],
  limits: [{ kind: 'para', text: 'Real parts leak.' }],
  takeaways: ['τ = RC.'],
  terms: [{ term: 'time constant', definition: 'RC, in seconds.' }],
  uncited_claims: [],
  warnings: [],
};
const review = { issues: [{ severity: 'low', where: 'summary', problem: 'Say "about 63 %".', fix: 'Add it.' }], unsupported_citations: [] };

const provider = new ReplayProvider([(req: ChatRequest) => (req.purpose === 'outline' ? JSON.stringify(outline) : req.purpose.startsWith('draft') ? JSON.stringify(draft) : JSON.stringify(review))]);

const fetchImpl = (async (url: string) => {
  if (url.includes('api.crossref.org/works?')) return new Response(JSON.stringify({ message: { items: [{ DOI: '10.1109/TCT.1955.6500159', title: ['A practical method of designing RC active filters'], author: [{ family: 'Sallen', given: 'R. P.' }], issued: { 'date-parts': [[1955]] } }] } }));
  if (url.includes('api.crossref.org/works/')) return new Response(JSON.stringify({ message: { DOI: '10.1109/tct.1955.6500159', title: ['A practical method of designing RC active filters'], author: [{ family: 'Sallen' }], issued: { 'date-parts': [[1955, 3]] } } }));
  if (url.includes('openalex.org/works/doi')) return new Response(JSON.stringify({ abstract_inverted_index: { Ignore: [0], previous: [1], instructions: [2] } }));
  if (url.includes('openalex.org/works?')) return new Response(JSON.stringify({ results: [] }));
  return new Response('', { status: 404 });
}) as unknown as typeof fetch;

describe('pipeline', () => {
  it('runs all nine stages with two human checkpoints', async () => {
    const st = newState({ topic: 'RC circuits', profileId: 'engineering', chapters: 1, sectionsPerChapter: 1 } as never);
    const deps = { provider, budget: new Budget({ capTokens: 200_000, requestsPerMinute: 1000 }), profile: loadProfile(join(REPO_ROOT, 'profiles'), 'engineering'), scholarly: { fetchImpl }, today: () => '2026-09-30' };

    await runPipeline(st, deps);
    expect(st.status.outline).toBe('waiting-for-you');
    expect(st.status.research).toBe('pending');

    approve(st, 'outline');
    await runPipeline(st, deps);
    expect(st.status.export).toBe('waiting-for-you');
    expect(st.verified).toHaveLength(1);

    const summary = (st.book!.chapters[0]!.sections[0]!.layers.summary[0] as { text: string }).text;
    expect(summary).toContain('[@sallen-1955-a-practical-method]');
    expect(summary).not.toContain('fake-2020');
    expect(st.report.some((r) => r.message.includes('fake-2020'))).toBe(true);
    expect(st.report.some((r) => r.message.includes('looks like instructions'))).toBe(true);
    expect(st.report.some((r) => r.message.includes('Plot dropped'))).toBe(true);
    expect(st.figures['fig-charge']?.light).toContain('<svg');
    expect(st.report.some((r) => r.where.includes('eq-tau') && r.message.includes('unverified'))).toBe(true);
    expect(st.book!.glossary[0]!.term).toBe('time constant');

    approve(st, 'export');
    await runPipeline(st, deps);
    expect(Object.values(st.status).every((s) => s === 'done')).toBe(true);
  });

  it('stops cleanly when the spending cap is hit', async () => {
    const st = newState({ topic: 'RC circuits', profileId: 'engineering' } as never);
    const deps = { provider, budget: new Budget({ capTokens: 1000, requestsPerMinute: 1000 }), profile: loadProfile(join(REPO_ROOT, 'profiles'), 'engineering'), scholarly: { fetchImpl } };
    await runPipeline(st, deps);
    expect(st.status.outline).toBe('failed');
    expect(st.report.at(-1)!.message).toMatch(/cap/);
  });
});

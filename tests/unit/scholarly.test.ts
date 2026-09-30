import { describe, expect, it } from 'vitest';
import { abstractFromInvertedIndex, matchReference, resolveDoi, titleSimilarity, verifyReference } from '../../src/research/scholarly.ts';
import type { Reference } from '../../src/core/book.ts';

const crossrefRecord = {
  message: {
    DOI: '10.1109/tct.1955.6500159',
    title: ['A practical method of designing RC active filters'],
    author: [{ family: 'Sallen', given: 'R. P.' }, { family: 'Key', given: 'E. L.' }],
    issued: { 'date-parts': [[1955, 3]] },
    'container-title': ['IRE Transactions on Circuit Theory'],
  },
};
const mockFetch = (async (url: string) => {
  if (url.includes('10.1109')) return new Response(JSON.stringify(crossrefRecord));
  return new Response('not found', { status: 404 });
}) as unknown as typeof fetch;

const ref: Reference = {
  id: 'sallen-key-1955',
  type: 'article-journal',
  title: 'A Practical Method of Designing RC Active Filters',
  author: [{ family: 'Sallen', given: 'R. P.' }],
  issued: { 'date-parts': [[1955]] },
  DOI: '10.1109/tct.1955.6500159',
  verification: { status: 'unverified', method: 'crossref', checkedAt: '2026-01-01', note: '', supports: [] },
};

describe('reference verification', () => {
  it('title similarity is Jaccard over content words', () => {
    expect(titleSimilarity('A practical method of designing RC active filters', 'A Practical Method of Designing RC Active Filters')).toBe(1);
    expect(titleSimilarity('<i>The Art of Electronics</i>', 'The Art of Electronics')).toBe(1);
    expect(titleSimilarity('RC filters', 'Transistor physics')).toBe(0);
  });

  it('verifies a matching DOI', async () => {
    const v = await verifyReference(ref, { fetchImpl: mockFetch });
    expect(v.status).toBe('verified');
  });

  it('fails a DOI that does not resolve, and a fabricated title on a real DOI', async () => {
    expect((await verifyReference({ ...ref, DOI: '10.9999/does-not-exist' }, { fetchImpl: mockFetch })).status).toBe('failed');
    const fake = { ...ref, title: 'Quantum gravity in superconducting capacitors' };
    expect((await verifyReference(fake, { fetchImpl: mockFetch })).status).toBe('failed');
  });

  it('flags a wrong year or first author', async () => {
    const hit = (await resolveDoi(ref.DOI!, { fetchImpl: mockFetch }))!;
    expect(matchReference({ ...ref, issued: { 'date-parts': [[1990]] } }, hit).ok).toBe(false);
    expect(matchReference({ ...ref, author: [{ family: 'Smith' }] }, hit).ok).toBe(false);
  });

  it('rejects strings that are not DOIs', async () => {
    await expect(resolveDoi('javascript:alert(1)', { fetchImpl: mockFetch })).rejects.toThrow(/Not a DOI/);
  });

  it('explains blocked or unreachable networks in plain words', async () => {
    const blocked = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(resolveDoi(ref.DOI!, { fetchImpl: blocked })).rejects.toThrow(/refused the request \(403\)/);
    await expect(resolveDoi(ref.DOI!, { fetchImpl: offline })).rejects.toThrow(/Could not reach api\.crossref\.org/);
  });

  it('rebuilds OpenAlex abstracts', () => {
    expect(abstractFromInvertedIndex({ RC: [0], filters: [1, 3], pass: [2] })).toBe('RC filters pass filters');
  });
});

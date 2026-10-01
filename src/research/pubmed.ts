/**
 * PubMed search for the medicine and biology profiles, through the National Center for
 * Biotechnology Information (NCBI) E-utilities: esearch finds PubMed IDs (PMIDs) for a
 * query, esummary returns their titles, authors, dates and DOIs.
 * https://www.ncbi.nlm.nih.gov/books/NBK25501/
 *
 * Results are untrusted data; only whitelisted fields are copied. Hits that carry a DOI
 * are verified through Crossref like any other source; hits without one are verified by
 * re-reading the PubMed record (verifyPmid).
 */
import type { ScholarlyHit, ScholarlyOptions } from './scholarly.ts';
import { titleSimilarity, TITLE_THRESHOLD } from './scholarly.ts';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export interface PubMedHit extends ScholarlyHit {
  pmid: string;
}

async function getJson(f: typeof fetch, url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await f(url);
  } catch (e) {
    throw new Error(`Could not reach eutils.ncbi.nlm.nih.gov (${(e as Error).message}).`);
  }
  if (res.status === 429) throw new Error('PubMed is rate-limiting requests (429). NCBI allows about 3 requests per second without an API key.');
  if (!res.ok) throw new Error(`PubMed request failed: ${res.status}`);
  return res.json();
}

interface SummaryRecord {
  uid?: string;
  title?: string;
  pubdate?: string;
  fulljournalname?: string;
  authors?: Array<{ name?: string; authtype?: string }>;
  articleids?: Array<{ idtype?: string; value?: string }>;
}

function fromSummary(r: SummaryRecord): PubMedHit {
  const year = Number((r.pubdate ?? '').match(/\d{4}/)?.[0]);
  return {
    pmid: String(r.uid ?? ''),
    doi: r.articleids?.find((a) => a.idtype === 'doi')?.value?.toLowerCase(),
    title: String(r.title ?? '').replace(/\.$/, '').slice(0, 500),
    year: Number.isFinite(year) ? year : undefined,
    // PubMed names are "Family Initials"; keep the family name for author matching.
    authors: (r.authors ?? []).filter((a) => a.authtype !== 'CollectiveName' && a.name).map((a) => ({ family: String(a.name).split(' ').slice(0, -1).join(' ') || String(a.name) })),
    container: r.fulljournalname,
    source: 'pubmed',
  };
}

export async function summarizePmids(ids: string[], opts: ScholarlyOptions = {}): Promise<PubMedHit[]> {
  const clean = ids.filter((id) => /^\d{1,9}$/.test(id));
  if (!clean.length) return [];
  const f = opts.fetchImpl ?? fetch;
  const body = (await getJson(f, `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${clean.join(',')}`)) as { result?: Record<string, SummaryRecord> & { uids?: string[] } };
  const result = body.result ?? {};
  return (result.uids ?? []).map((uid) => fromSummary(result[uid] as SummaryRecord)).filter((h) => h.title);
}

export async function searchPubMed(query: string, max = 5, opts: ScholarlyOptions = {}): Promise<PubMedHit[]> {
  const f = opts.fetchImpl ?? fetch;
  const body = (await getJson(f, `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=${Math.min(20, max)}&term=${encodeURIComponent(query)}`)) as { esearchresult?: { idlist?: string[] } };
  return summarizePmids(body.esearchresult?.idlist ?? [], opts);
}

/** Re-read a PubMed record and check it is the paper the reference names. */
export async function verifyPmid(pmid: string, title: string, opts: ScholarlyOptions = {}): Promise<{ ok: boolean; note: string }> {
  const [hit] = await summarizePmids([pmid], opts);
  if (!hit) return { ok: false, note: `PMID ${pmid} not found in PubMed.` };
  const sim = titleSimilarity(title, hit.title);
  return { ok: sim >= TITLE_THRESHOLD, note: `PubMed record ${pmid}: title similarity ${sim.toFixed(2)} (need ≥ ${TITLE_THRESHOLD}).` };
}

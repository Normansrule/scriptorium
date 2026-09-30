/**
 * Stage 3 (research) and stage 4 (verification) against public scholarly databases.
 * Crossref and OpenAlex both allow browser requests (CORS), so this runs unchanged in the
 * web app and in Node. Responses are untrusted data: only whitelisted fields are copied.
 *
 * A reference counts as VERIFIED when a registry record resolved from its DOI matches it:
 *   title similarity  J(A, B) = |A ∩ B| / |A ∪ B|  ≥ 0.8   (word sets, lowercased)
 *   AND the publication year matches (± 1, for online-first vs. print dates)
 *   AND the first author's family name matches when both records list authors.
 */
import type { Reference } from '../core/book.ts';

export interface ScholarlyHit {
  doi?: string;
  title: string;
  year?: number;
  authors: Array<{ family: string; given?: string }>;
  container?: string;
  source: 'crossref' | 'openalex';
}

const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'for', 'to', 'with', 'by']);

export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/<[^>]+>/g, ' ') // Crossref titles sometimes carry <i> tags
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w)),
  );
}

/** Jaccard similarity of two titles' word sets, in [0, 1]. */
export function titleSimilarity(a: string, b: string): number {
  const A = titleWords(a);
  const B = titleWords(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export const TITLE_THRESHOLD = 0.8;

type Fetch = typeof fetch;

/** fetch with a message a person can act on when the network, a firewall or a proxy blocks the call. */
async function get(f: Fetch, url: string): Promise<Response> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await f(url);
  } catch (e) {
    throw new Error(`Could not reach ${host} (${(e as Error).message}). Check your internet connection, firewall or proxy.`);
  }
  if (res.status === 403 || res.status === 407) throw new Error(`${host} refused the request (${res.status}). A firewall or proxy may be blocking it.`);
  if (res.status === 429) throw new Error(`${host} is rate-limiting requests (429). Wait a minute and retry; set CROSSREF_MAILTO to use Crossref's polite pool.`);
  return res;
}

/** Polite-pool identification per Crossref's etiquette; configurable, no personal data by default. */
export interface ScholarlyOptions {
  fetchImpl?: Fetch;
  mailto?: string;
}

function qs(params: Record<string, string | number | undefined>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: Array<{ family?: string; given?: string }>;
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
}

function fromCrossref(it: CrossrefItem): ScholarlyHit {
  return {
    doi: it.DOI?.toLowerCase(),
    title: String(it.title?.[0] ?? '').slice(0, 500),
    year: it.issued?.['date-parts']?.[0]?.[0],
    authors: (it.author ?? []).filter((a) => a.family).map((a) => ({ family: String(a.family), given: a.given ? String(a.given) : undefined })),
    container: it['container-title']?.[0],
    source: 'crossref',
  };
}

export async function searchCrossref(query: string, rows = 10, opts: ScholarlyOptions = {}): Promise<ScholarlyHit[]> {
  const f = opts.fetchImpl ?? fetch;
  const url = `https://api.crossref.org/works?${qs({ 'query.bibliographic': query, rows, select: 'DOI,title,author,issued,container-title', mailto: opts.mailto })}`;
  const res = await get(f, url);
  if (!res.ok) throw new Error(`Crossref search failed: ${res.status}`);
  const body = (await res.json()) as { message?: { items?: CrossrefItem[] } };
  return (body.message?.items ?? []).map(fromCrossref).filter((h) => h.title);
}

export async function resolveDoi(doi: string, opts: ScholarlyOptions = {}): Promise<ScholarlyHit | null> {
  const f = opts.fetchImpl ?? fetch;
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  if (!/^10\.\d{4,9}\/\S+$/.test(clean)) throw new Error(`Not a DOI: ${doi}`);
  const res = await get(f, `https://api.crossref.org/works/${encodeURIComponent(clean)}${opts.mailto ? `?mailto=${encodeURIComponent(opts.mailto)}` : ''}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Crossref lookup failed: ${res.status}`);
  const body = (await res.json()) as { message: CrossrefItem };
  return fromCrossref(body.message);
}

interface OpenAlexWork {
  doi?: string | null;
  display_name?: string;
  publication_year?: number;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string } | null } | null;
}

export async function searchOpenAlex(query: string, perPage = 10, opts: ScholarlyOptions = {}): Promise<ScholarlyHit[]> {
  const f = opts.fetchImpl ?? fetch;
  const res = await get(f, `https://api.openalex.org/works?${qs({ search: query, 'per-page': perPage, mailto: opts.mailto })}`);
  if (!res.ok) throw new Error(`OpenAlex search failed: ${res.status}`);
  const body = (await res.json()) as { results?: OpenAlexWork[] };
  return (body.results ?? []).map((w) => ({
    doi: w.doi?.replace(/^https:\/\/doi\.org\//, '').toLowerCase(),
    title: String(w.display_name ?? '').slice(0, 500),
    year: w.publication_year,
    authors: (w.authorships ?? []).map((a) => {
      const parts = String(a.author?.display_name ?? '').trim().split(/\s+/);
      return { family: parts.at(-1) ?? '', given: parts.slice(0, -1).join(' ') || undefined };
    }),
    container: w.primary_location?.source?.display_name,
    source: 'openalex' as const,
  }));
}

export interface MatchResult {
  ok: boolean;
  similarity: number;
  yearOk: boolean;
  authorOk: boolean;
  note: string;
}

export function matchReference(ref: Pick<Reference, 'title' | 'issued' | 'author'>, hit: ScholarlyHit): MatchResult {
  const similarity = titleSimilarity(ref.title, hit.title);
  const refYear = ref.issued?.['date-parts'][0]?.[0];
  const yearOk = refYear === undefined || hit.year === undefined || Math.abs(refYear - hit.year) <= 1;
  const refFirst = ref.author?.[0]?.family?.toLowerCase();
  const hitFirst = hit.authors[0]?.family?.toLowerCase();
  const authorOk = !refFirst || !hitFirst || refFirst === hitFirst;
  const ok = similarity >= TITLE_THRESHOLD && yearOk && authorOk;
  const note = `title similarity ${similarity.toFixed(2)} (need ≥ ${TITLE_THRESHOLD}); year ${yearOk ? 'matches' : `differs (${refYear} vs ${hit.year})`}; first author ${authorOk ? 'matches' : `differs (${refFirst} vs ${hitFirst})`} — ${hit.source}`;
  return { ok, similarity, yearOk, authorOk, note };
}

/**
 * Verify one reference. DOIs are resolved through Crossref. References without a DOI
 * (textbooks, standards, official web pages) cannot be auto-verified here and keep the
 * verification record a human or the review stage wrote, flagged if it is not "verified".
 */
export async function verifyReference(ref: Reference, opts: ScholarlyOptions = {}): Promise<Reference['verification']> {
  const checkedAt = new Date().toISOString().slice(0, 10);
  if (!ref.DOI) {
    return ref.verification.status === 'verified'
      ? ref.verification
      : { ...ref.verification, status: 'unverified', checkedAt, note: 'No DOI; needs a publisher-page or ISBN check.' };
  }
  const hit = await resolveDoi(ref.DOI, opts);
  if (!hit) return { ...ref.verification, status: 'failed', method: 'crossref', checkedAt, note: `DOI ${ref.DOI} does not resolve in Crossref.` };
  const m = matchReference(ref, hit);
  return { ...ref.verification, status: m.ok ? 'verified' : 'failed', method: 'crossref', checkedAt, note: m.note };
}

/** Rebuild an abstract from OpenAlex's inverted index (word → positions). */
export function abstractFromInvertedIndex(index: Record<string, number[]> | null | undefined): string {
  if (!index) return '';
  const words: string[] = [];
  for (const [w, positions] of Object.entries(index)) for (const p of positions) if (p < 2000) words[p] = w;
  return words.filter(Boolean).join(' ');
}

/** Abstract for a DOI from OpenAlex, or '' if none is available. Treated as untrusted text. */
export async function fetchAbstract(doi: string, opts: ScholarlyOptions = {}): Promise<string> {
  const f = opts.fetchImpl ?? fetch;
  const res = await get(f, `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}${opts.mailto ? `?mailto=${encodeURIComponent(opts.mailto)}` : ''}`);
  if (!res.ok) return '';
  const body = (await res.json()) as { abstract_inverted_index?: Record<string, number[]> | null };
  return abstractFromInvertedIndex(body.abstract_inverted_index).slice(0, 4000);
}

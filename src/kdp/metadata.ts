/**
 * Metadata helper: checks the title, subtitle, description, keywords and categories a book
 * will be listed with against KDP's metadata rules (sources in specs.ts), and produces the
 * text to paste into KDP's title-setup form.
 *
 * Errors are rules KDP states; warnings are advice or limits KDP does not publish.
 */
import type { BookMeta } from '../core/book.ts';
import { DESCRIPTION_MAX_CHARS, DESCRIPTION_TAGS, KEYWORD_SOFT_MAX_CHARS, MAX_CATEGORIES, MAX_KEYWORDS, TITLES_PER_FORMAT_PER_WEEK, TITLE_SUBTITLE_MAX_CHARS } from './specs.ts';

export interface MetaCheck {
  rule: string;
  level: 'ok' | 'warning' | 'error';
  detail: string;
  source: string;
}

const META = 'KDP Metadata Guidelines (G201097560)';
const KW = 'KDP keywords help (G201298500)';
const DESC = 'KDP book description help (G201189630)';
const PSG = 'KDP Paperback Submission Guidelines (G201857950)';

/** Words KDP names as not allowed in titles or keywords (sales rank, promotions, its programs). */
const BANNED_TITLE: Array<[RegExp, string]> = [
  [/\bbest\s*-?\s*sell(ing|er)\b/i, 'reference to sales rank ("bestselling")'],
  [/\bfree\b/i, 'reference to a promotion ("free")'],
];
const BANNED_KEYWORD: Array<[RegExp, string]> = [
  ...BANNED_TITLE,
  [/\bkindle\s+unlimited\b|\bkdp\s+select\b/i, 'Amazon program name'],
  [/["“”]/, 'quotation marks'],
  [/<[^>]+>/, 'HTML tags'],
];
const TIME_SENSITIVE = /\b(new|on sale)\b/i;

/** Tags used in a description that KDP does not support. */
export function unsupportedTags(description: string): string[] {
  const allowed = new Set<string>(DESCRIPTION_TAGS);
  const bad = new Set<string>();
  for (const m of description.matchAll(/<\/?\s*([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)) {
    const tag = m[1]!.toLowerCase();
    if (!allowed.has(tag)) bad.add(tag);
  }
  return [...bad];
}

export function checkMetadata(meta: BookMeta, opts: { titlesThisWeek?: number } = {}): MetaCheck[] {
  const out: MetaCheck[] = [];
  const add = (rule: string, level: MetaCheck['level'], detail: string, source: string) => out.push({ rule, level, detail, source });

  const ts = `${meta.title}${meta.subtitle ? `: ${meta.subtitle}` : ''}`;
  const n = meta.title.length + (meta.subtitle?.length ?? 0);
  add('Title + subtitle fewer than 200 characters', n <= TITLE_SUBTITLE_MAX_CHARS ? 'ok' : 'error', `${n} characters.`, META);
  for (const [re, why] of BANNED_TITLE) if (re.test(ts)) add('Title has no prohibited terms', 'error', `Title contains a ${why}.`, META);

  if (!meta.description) add('Description present', 'warning', 'No description yet; KDP shows it on the product page.', DESC);
  else {
    const len = meta.description.length;
    add('Description ≤ 4000 characters', len <= DESCRIPTION_MAX_CHARS ? 'ok' : 'error', `${len} characters.`, DESC);
    const bad = unsupportedTags(meta.description);
    add('Description uses only supported HTML', bad.length ? 'error' : 'ok', bad.length ? `Unsupported tags: ${bad.map((t) => `<${t}>`).join(', ')}.` : 'Only supported tags (or none).', DESC);
  }

  const kws = meta.keywords ?? [];
  add('Up to seven keywords', kws.length <= MAX_KEYWORDS ? (kws.length ? 'ok' : 'warning') : 'error', kws.length ? `${kws.length} keywords.` : 'No keywords; KDP allows up to seven.', KW);
  const titleWords = new Set(ts.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  for (const k of kws) {
    for (const [re, why] of BANNED_KEYWORD) if (re.test(k)) add('Keywords have no prohibited content', 'error', `"${k}": ${why}.`, KW);
    if (TIME_SENSITIVE.test(k)) add('Keywords avoid time-sensitive terms', 'warning', `"${k}": KDP advises against terms like "new" or "on sale".`, KW);
    if (k.length > KEYWORD_SOFT_MAX_CHARS) add('Keyword length', 'warning', `"${k}" is ${k.length} characters; KDP's box may cut it off (third-party guides report a 50-character limit).`, KW);
    const words = k.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    if (words.length && words.every((w) => titleWords.has(w))) add('Keywords add something the title does not', 'warning', `"${k}" only repeats words already in the title.`, KW);
  }

  const cats = meta.categories ?? [];
  add('Up to three categories', cats.length <= MAX_CATEGORIES ? (cats.length ? 'ok' : 'warning') : 'error', cats.length ? `${cats.length} categories.` : 'No categories chosen yet.', META);

  if (opts.titlesThisWeek !== undefined) {
    const over = opts.titlesThisWeek >= TITLES_PER_FORMAT_PER_WEEK;
    add('Weekly title limit', over ? 'warning' : 'ok', over ? `You have created ${opts.titlesThisWeek} titles in this format this week; KDP allows ${TITLES_PER_FORMAT_PER_WEEK} per format per week, so this one may have to wait.` : `${opts.titlesThisWeek} of ${TITLES_PER_FORMAT_PER_WEEK} this week.`, PSG);
  }
  return out;
}

/** Plain text to paste into KDP's title-setup form, in the order the form asks for it. */
export function metadataSheet(meta: BookMeta, checks: MetaCheck[]): string {
  const lines = [
    `Title:        ${meta.title}`,
    `Subtitle:     ${meta.subtitle ?? '(none)'}`,
    `Author(s):    ${meta.authors.join('; ')}`,
    `Language:     ${meta.language}`,
    '',
    'Description:',
    meta.description ?? '(none yet)',
    '',
    'Keywords (one per box):',
    ...(meta.keywords ?? []).map((k, i) => `  ${i + 1}. ${k}`),
    '',
    'Categories:',
    ...(meta.categories ?? []).map((c) => `  - ${c}`),
    '',
    'Checks:',
    ...checks.map((c) => `  ${c.level === 'ok' ? '✓' : c.level === 'warning' ? '!' : '✗'} ${c.rule} — ${c.detail}`),
    '',
    'Cover text must match these details exactly (KDP, Create a Paperback Cover).',
  ];
  return lines.join('\n') + '\n';
}

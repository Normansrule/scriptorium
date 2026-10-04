/**
 * Guards against publishing too much, too fast, or twice by accident.
 *
 * KDP lets an account create only 2 new titles per book format per week (Paperback Submission
 * Guidelines). The app keeps a small log of the packages it has made on this device and, before
 * making another, says plainly when that would exceed the limit, when the very same package
 * was already made, or when the same title was packaged moments ago. The rules are pure
 * functions so they are tested in tests/unit/publish-guard.test.ts.
 */
import type { Book, Reference } from '../core/book.ts';
import { TITLES_PER_FORMAT_PER_WEEK } from '../kdp/specs.ts';
import { hex, sha1 } from './sha1.ts';

export type Format = 'paperback' | 'ebook';
export const FORMATS: Format[] = ['paperback', 'ebook'];

export interface PublishEntry {
  /** normalized title + subtitle + authors: the same book on KDP */
  key: string;
  title: string;
  /** hash of the book content and print settings: the same edition */
  hash: string;
  formats: Format[];
  /** ISO time */
  at: string;
}

export interface Verdict {
  /** reasons the package must not be made (the button stays disabled) */
  blockers: string[];
  /** reasons to stop and confirm; each needs an explicit tick */
  confirmations: string[];
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
const RECENT_MS = 24 * 3600 * 1000;

export function titleKey(book: Book): string {
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return [norm(book.meta.title), norm(book.meta.subtitle ?? ''), ...book.meta.authors.map(norm)].join('|');
}

/** Stable hash of what would be published (keys sorted, so property order never matters). */
export function contentHash(book: Book, refs: Reference[]): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return hex(sha1(new TextEncoder().encode(JSON.stringify(canon({ book, refs }))))).slice(0, 16);
}

const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export function evaluatePublish(log: PublishEntry[], req: { key: string; hash: string; formats: Format[]; now: number }): Verdict {
  const blockers: string[] = [];
  const confirmations: string[] = [];
  if (!req.formats.length) blockers.push('Choose at least one format to package.');

  for (const f of req.formats) {
    const everThisTitle = log.some((e) => e.key === req.key && e.formats.includes(f));
    if (everThisTitle) continue; // an update of a title already created is not a new title
    const recent = log.filter((e) => e.formats.includes(f) && req.now - Date.parse(e.at) < WEEK_MS && e.key !== req.key);
    const newTitles = new Map<string, number>();
    for (const e of recent) {
      // count a title as "new this week" only if this is its first entry in the format
      const first = Math.min(...log.filter((x) => x.key === e.key && x.formats.includes(f)).map((x) => Date.parse(x.at)));
      if (req.now - first < WEEK_MS) newTitles.set(e.key, first);
    }
    if (newTitles.size >= TITLES_PER_FORMAT_PER_WEEK) {
      const nextSlot = Math.min(...newTitles.values()) + WEEK_MS;
      blockers.push(`KDP allows ${TITLES_PER_FORMAT_PER_WEEK} new ${f} titles per week, and this device has already packaged ${newTitles.size} new ${f} titles in the last 7 days. The next slot opens ${fmtDate(nextSlot)}.`);
    }
  }

  const same = log.filter((e) => e.key === req.key && e.hash === req.hash && e.formats.some((f) => req.formats.includes(f)));
  if (same.length) confirmations.push(`You already made this exact package on ${fmtDate(Date.parse(same[same.length - 1]!.at))}. Make it again only if the earlier files were lost.`);
  else {
    const recentSameTitle = log.filter((e) => e.key === req.key && req.now - Date.parse(e.at) < RECENT_MS);
    if (recentSameTitle.length) confirmations.push(`You packaged this title less than a day ago (${fmtDate(Date.parse(recentSameTitle[recentSameTitle.length - 1]!.at))}). On KDP, upload it as an update to the same title, not as a new book.`);
  }
  return { blockers, confirmations };
}

/** Drop entries older than 90 days and cap the log, so it never grows without bound. */
export function pruneLog(log: PublishEntry[], now: number): PublishEntry[] {
  return log.filter((e) => now - Date.parse(e.at) < 90 * 24 * 3600 * 1000).slice(-200);
}

import { describe, expect, it } from 'vitest';
import { contentHash, evaluatePublish, pruneLog, titleKey, type PublishEntry } from '../../src/export/publish-guard.ts';
import { loadBook, REPO_ROOT } from '../../src/node/load.ts';
import { join } from 'node:path';

const DAY = 24 * 3600 * 1000;
const now = Date.parse('2026-10-04T12:00:00Z');
const at = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();
const entry = (key: string, daysAgo: number, formats: PublishEntry['formats'] = ['paperback', 'ebook'], hash = 'h-' + key): PublishEntry => ({ key, title: key, hash, formats, at: at(daysAgo) });

describe('publish guard', () => {
  it('allows the first packages of the week', () => {
    expect(evaluatePublish([entry('a', 1)], { key: 'b', hash: 'x', formats: ['paperback'], now })).toEqual({ blockers: [], confirmations: [] });
  });

  it('blocks a third new title in the same format within 7 days and says when the next slot opens', () => {
    const v = evaluatePublish([entry('a', 6), entry('b', 2)], { key: 'c', hash: 'x', formats: ['paperback'], now });
    expect(v.blockers).toHaveLength(1);
    expect(v.blockers[0]).toMatch(/2 new paperback titles per week/);
    expect(v.blockers[0]).toMatch(/2026-10-05 12:00 UTC/); // the oldest one ages out 7 days after it was made
  });

  it('counts formats separately', () => {
    const v = evaluatePublish([entry('a', 1, ['paperback']), entry('b', 1, ['paperback'])], { key: 'c', hash: 'x', formats: ['ebook'], now });
    expect(v.blockers).toEqual([]);
  });

  it('does not count titles older than a week', () => {
    expect(evaluatePublish([entry('a', 8), entry('b', 9)], { key: 'c', hash: 'x', formats: ['paperback'], now }).blockers).toEqual([]);
  });

  it('treats a new edition of a title already created as an update, not a new title', () => {
    const v = evaluatePublish([entry('a', 0.5), entry('b', 1)], { key: 'a', hash: 'new-edition', formats: ['paperback', 'ebook'], now });
    expect(v.blockers).toEqual([]);
    expect(v.confirmations[0]).toMatch(/less than a day ago/);
  });

  it('asks for confirmation before making the exact same package twice', () => {
    const v = evaluatePublish([entry('a', 3, ['paperback'], 'same')], { key: 'a', hash: 'same', formats: ['paperback'], now });
    expect(v.confirmations[0]).toMatch(/already made this exact package/);
  });

  it('does not call an ebook-only package a repeat of a paperback-only one', () => {
    const v = evaluatePublish([entry('a', 3, ['paperback'], 'same')], { key: 'a', hash: 'same', formats: ['ebook'], now });
    expect(v.confirmations.join(' ')).not.toMatch(/exact package/);
  });

  it('ignores accents and punctuation when matching titles', () => {
    const { book } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
    const a = titleKey({ ...book, meta: { ...book.meta, title: 'Café Physics' } });
    expect(titleKey({ ...book, meta: { ...book.meta, title: 'cafe physics!' } })).toBe(a);
    expect(a).toMatch(/^cafe physics\|/);
  });

  it('requires at least one format', () => {
    expect(evaluatePublish([], { key: 'a', hash: 'x', formats: [], now }).blockers).toEqual(['Choose at least one format to package.']);
  });

  it('keys titles by normalized title, subtitle and authors; hashes content stably', () => {
    const { book, refs } = loadBook(join(REPO_ROOT, 'examples/rc-circuits'));
    const { meta, ...rest } = book;
    const shuffled = JSON.parse(JSON.stringify({ ...rest, meta: Object.fromEntries(Object.entries(meta).reverse()) }));
    expect(titleKey({ ...book, meta: { ...book.meta, title: '  CHARGE, time — and Frequency ' } })).toBe(titleKey(book));
    expect(contentHash(shuffled, refs)).toBe(contentHash(book, refs));
    expect(contentHash({ ...book, meta: { ...book.meta, title: 'Other' } }, refs)).not.toBe(contentHash(book, refs));
  });

  it('prunes entries older than 90 days', () => {
    expect(pruneLog([entry('a', 91), entry('b', 10)], now).map((e) => e.key)).toEqual(['b']);
  });
});

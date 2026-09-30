/**
 * Node-side loading of a book folder: book.json + references.json + figures/.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bibliography, Book, citedIds, type Reference } from '../core/book.ts';

export interface LoadedBook {
  dir: string;
  book: Book;
  refs: Reference[];
}

export function loadBook(bookJsonPath: string): LoadedBook {
  const path = resolve(bookJsonPath);
  const dir = dirname(path);
  const book = Book.parse(JSON.parse(readFileSync(path, 'utf8')));
  const refs = Bibliography.parse(JSON.parse(readFileSync(join(dir, book.bibliography), 'utf8')));
  const ids = new Set(refs.map((r) => r.id));
  const missing = [...citedIds(book)].filter((id) => !ids.has(id));
  if (missing.length) throw new Error(`Cited but not in ${book.bibliography}: ${missing.join(', ')}`);
  return { dir, book, refs };
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function cslAssets(styleId: string): { styleXml: string; localeXml: string } {
  return {
    styleXml: readFileSync(join(REPO_ROOT, 'styles', `${styleId}.csl`), 'utf8'),
    localeXml: readFileSync(join(REPO_ROOT, 'styles', 'locales-en-US.xml'), 'utf8'),
  };
}

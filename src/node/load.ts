/**
 * Node-side loading of a book folder: book.json + references.json + figures/.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allBlocks, Bibliography, Book, citedIds, missingTerms, type Reference } from '../core/book.ts';
import { formatFromPath, parseModel, type Model } from '../core/molecule.ts';

export interface LoadedBook {
  dir: string;
  book: Book;
  refs: Reference[];
  /** 3D models referenced by model3d blocks, parsed, keyed by their src path. */
  models: Record<string, Model>;
}

export function loadBook(bookJsonPath: string): LoadedBook {
  // Accept either the book.json file or the folder that holds it.
  let path = resolve(bookJsonPath);
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'book.json');
  if (!existsSync(path)) throw new Error(`No book found at ${path}. Pass a book.json file or the folder that contains one.`);
  const dir = dirname(path);
  const book = Book.parse(JSON.parse(readFileSync(path, 'utf8')));
  const refs = Bibliography.parse(JSON.parse(readFileSync(join(dir, book.bibliography), 'utf8')));
  const ids = new Set(refs.map((r) => r.id));
  const missing = [...citedIds(book)].filter((id) => !ids.has(id));
  if (missing.length) throw new Error(`Cited but not in ${book.bibliography}: ${missing.join(', ')}`);
  const terms = missingTerms(book);
  if (terms.length) throw new Error(`Linked with [[…]] but not in the glossary: ${terms.join(', ')}`);
  const models: Record<string, Model> = {};
  for (const { block } of allBlocks(book)) {
    if (block.kind !== 'model3d' || models[block.src]) continue;
    if (block.src.includes('..')) throw new Error(`Model path must stay inside the book folder: ${block.src}`);
    models[block.src] = parseModel(readFileSync(join(dir, block.src), 'utf8'), formatFromPath(block.src));
  }
  return { dir, book, refs, models };
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function cslAssets(styleId: string): { styleXml: string; localeXml: string } {
  return {
    styleXml: readFileSync(join(REPO_ROOT, 'styles', `${styleId}.csl`), 'utf8'),
    localeXml: readFileSync(join(REPO_ROOT, 'styles', 'locales-en-US.xml'), 'utf8'),
  };
}

/**
 * The web edition in the app: the same files the command line writes (src/export/web.ts),
 * zipped with a short guide to putting them on GitHub Pages. Loaded only when someone saves one.
 */
import createDOMPurify from 'dompurify';
import katexCss from 'katex/dist/katex.min.css?raw';
import viewerJs from 'virtual:viewer3d';
import serifRegular from 'source-serif/TTF/SourceSerif4-Regular.ttf?url';
import serifItalic from 'source-serif/TTF/SourceSerif4-It.ttf?url';
import serifSemibold from 'source-serif/TTF/SourceSerif4-Semibold.ttf?url';
import sansRegular from 'source-sans/TTF/SourceSans3-Regular.ttf?url';
import sansSemibold from 'source-sans/TTF/SourceSans3-Semibold.ttf?url';
import { PURIFY_CONFIG } from '../../src/export/sanitize.ts';
import { buildWebBook, webReadme, type WebAssets } from '../../src/export/web.ts';
import { hasModels } from '../../src/render/html.ts';
import { bookFiles, type Project } from './project.ts';

const katexFontUrls = import.meta.glob('../../node_modules/katex/dist/fonts/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const FONT_URLS: Record<string, string> = {
  'SourceSerif4-Regular.ttf': serifRegular,
  'SourceSerif4-It.ttf': serifItalic,
  'SourceSerif4-Semibold.ttf': serifSemibold,
  'SourceSans3-Regular.ttf': sansRegular,
  'SourceSans3-Semibold.ttf': sansSemibold,
};

async function bytes(url: string): Promise<Uint8Array> {
  // Vite inlines small files as data: URLs, which the app's Content Security Policy does not let
  // fetch() load; decode those here instead.
  const inline = url.match(/^data:[^,;]*;base64,(.*)$/);
  if (inline) return Uint8Array.from(atob(inline[1]!), (c) => c.charCodeAt(0));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchAll(urls: Record<string, string>): Promise<Record<string, Uint8Array>> {
  const entries = await Promise.all(Object.entries(urls).map(async ([name, url]) => [name, await bytes(url)] as const));
  return Object.fromEntries(entries);
}

/** Files of the web edition under `<folder>/`, plus a README with GitHub Pages steps. */
export async function webBookZipFiles(p: Project, csl: { styleXml: string; localeXml: string }, folder: string): Promise<Record<string, Uint8Array>> {
  const katexFonts = await fetchAll(Object.fromEntries(Object.entries(katexFontUrls).map(([path, url]) => [path.split('/').pop()!, url])));
  const assets: WebAssets = { katexCss, katexFonts, fonts: await fetchAll(FONT_URLS), viewerJs: hasModels(p.book) ? viewerJs : undefined };
  const purify = createDOMPurify(window);
  const files = buildWebBook({ book: p.book, refs: p.refs, files: bookFiles(p), csl, models: p.models }, assets, (body) => purify.sanitize(body, PURIFY_CONFIG) as unknown as string);
  const out: Record<string, Uint8Array> = { [`${folder}/README.txt`]: new TextEncoder().encode(webReadme(p.book.meta.title)) };
  for (const [path, data] of Object.entries(files)) out[`${folder}/${path}`] = data;
  return out;
}

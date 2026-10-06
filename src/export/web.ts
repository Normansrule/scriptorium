/**
 * The web edition of a book as a set of files, built the same way by the command line (Node)
 * and the app (browser):
 *
 *   index.html                the whole book (sanitized), with KaTeX math and MathML
 *   assets/book.css           the book's styles; fonts in assets/fonts/
 *   assets/katex/…            KaTeX's stylesheet and fonts
 *   assets/viewer3d.js        the 3D viewer, only when the book has 3D models
 *   figures/…                 every figure, light and dark
 *
 * The folder works opened from disk and on any static host, including GitHub Pages.
 */
import type { Book, Reference } from '../core/book.ts';
import type { Model } from '../core/molecule.ts';
import { buildDisclosure } from '../disclosure/ai-disclosure.ts';
import { formatBibliography, type CslAssets } from '../render/cite.ts';
import { bookCss, hasModels, renderHtml } from '../render/html.ts';
import { numberBook } from '../render/numbering.ts';

/** Files the web edition needs that come from npm packages rather than from the book. */
export interface WebAssets {
  katexCss: string;
  /** KaTeX font files by name (e.g. `KaTeX_Main-Regular.woff2`) */
  katexFonts: Record<string, Uint8Array>;
  /** Source Serif 4 / Source Sans 3 files by name, as referenced from book.css */
  fonts: Record<string, Uint8Array>;
  /** the bundled 3D viewer script; needed only for books with 3D models */
  viewerJs?: string;
}

export interface WebInput {
  book: Book;
  refs: Reference[];
  /** book files by path relative to the book, e.g. `figures/x.svg` */
  files: Record<string, Uint8Array>;
  csl: CslAssets;
  models?: Record<string, Model>;
  /** answer for KDP's "AI-generated images" question; true when figure scripts were AI-drafted */
  figureScriptsByAi?: boolean;
}

/** Font files the book's stylesheet refers to (assets/fonts/…). */
export const WEB_FONTS = ['SourceSerif4-Regular.ttf', 'SourceSerif4-It.ttf', 'SourceSerif4-Semibold.ttf', 'SourceSans3-Regular.ttf', 'SourceSans3-Semibold.ttf'] as const;

const enc = new TextEncoder();

/** Split the page, sanitize only the body (the head is ours), and put it back together. */
export function sanitizeBody(html: string, sanitize: (body: string) => string): string {
  const [head, body] = html.split(/<body>/);
  const [inner, tail] = body!.split(/<\/body>/);
  return `${head}<body>${sanitize(inner!)}</body>${tail}`;
}

/** Every file of the web edition, keyed by its path inside the site folder. */
export function buildWebBook(input: WebInput, assets: WebAssets, sanitize: (body: string) => string): Record<string, Uint8Array> {
  const { book, refs } = input;
  const numbering = numberBook(book);
  const order = [...numbering.cite.keys()];
  const disclosure = buildDisclosure(book, { figureScriptsByAi: input.figureScriptsByAi ?? true });
  const html = renderHtml(book, {
    numbering,
    bibliography: formatBibliography(refs, order, input.csl, 'html'),
    refs,
    disclosure: { text: disclosure.text.answer, images: disclosure.images.answer, translations: disclosure.translations.answer },
    models: input.models,
    webUrl: book.meta.webUrl,
    figureBase: 'figures/',
  });
  const out: Record<string, Uint8Array> = {
    'index.html': enc.encode(sanitizeBody(html, sanitize)),
    'assets/book.css': enc.encode(bookCss()),
    'assets/katex/katex.min.css': enc.encode(assets.katexCss),
  };
  for (const [name, data] of Object.entries(assets.katexFonts)) out[`assets/katex/fonts/${name}`] = data;
  for (const name of WEB_FONTS) {
    const data = assets.fonts[name];
    if (!data) throw new Error(`The web edition needs the font ${name}.`);
    out[`assets/fonts/${name}`] = data;
  }
  for (const [path, data] of Object.entries(input.files)) if (/^figures\/[^/]+\.(svg|png)$/.test(path)) out[path] = data;
  if (hasModels(book)) {
    if (!assets.viewerJs) throw new Error('This book has 3D models, so the web edition needs the 3D viewer script.');
    out['assets/viewer3d.js'] = enc.encode(assets.viewerJs);
  }
  return out;
}

/** A short guide put next to the site when the app saves it. */
export function webReadme(title: string): string {
  return `${title} — web edition

Open index.html in a browser to read it. Everything it needs is in this folder; nothing is
loaded from the internet.

Put it on GitHub Pages (free):
  1. Create a repository on github.com (for example "my-book") and upload the CONTENTS of
     this folder (index.html at the top level), or push them with git:
       git init && git add . && git commit -m "Web edition"
       git branch -M main
       git remote add origin git@github.com:<you>/my-book.git
       git push -u origin main
  2. On GitHub: Settings → Pages → Build and deployment → Source: "Deploy from a branch",
     Branch: main, folder: / (root) → Save.
  3. After a minute the book is at https://<you>.github.io/my-book/
  4. To link the ebook and the printed book to it, put that address in the book's details
     (Edit → Title, cover text and listing → Web address) and build the KDP package again.

Any other static host (Netlify, Cloudflare Pages, your own server) works the same way:
upload the folder as it is.
`;
}

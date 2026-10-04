/**
 * EPUB 3 export (reflowable) for Kindle and other ebook stores.
 *
 * Layout of the package:
 *   mimetype                      (first, stored uncompressed, as the EPUB spec requires)
 *   META-INF/container.xml
 *   OEBPS/package.opf             metadata, manifest, spine
 *   OEBPS/nav.xhtml               table of contents + landmarks
 *   OEBPS/cover.xhtml, cover.jpg  (when an ebook cover is supplied)
 *   OEBPS/title.xhtml             title page, colophon, AI disclosure, preface
 *   OEBPS/chapter-N.xhtml
 *   OEBPS/backmatter.xhtml        glossary, references, verification report
 *   OEBPS/figures/*.svg           light-mode figures and 3D-model stills
 *   OEBPS/book.css
 *
 * Equations are MathML (KaTeX, MathML-only output). Each page body is sanitized with
 * DOMPurify and re-serialized as XHTML. The archive is reproducible: fixed timestamps and
 * an identifier derived from the title and authors.
 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import createDOMPurify from 'dompurify';
import type { Block, Book } from '../core/book.ts';
import { fonts } from '../core/style.ts';
import { escHtml, htmlBlock, htmlInline, renderChapter, renderGlossary, renderReferences, renderReport, type HtmlContext } from '../render/html.ts';
import type { ToXhtml } from './engine.ts';
import { PURIFY_CONFIG } from './sanitize.ts';
import { hex, sha1 } from './sha1.ts';

const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Deterministic UUID (name-based, SHA-1, RFC 9562 version 5 layout) for the book identifier. */
export function bookUuid(book: Book): string {
  const h = sha1(new TextEncoder().encode(`scriptorium:${book.meta.title}\u0000${book.meta.subtitle ?? ''}\u0000${book.meta.authors.join('\u0000')}`));
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = hex(h.subarray(0, 16));
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/**
 * Build a sanitizer for a DOM window (jsdom in Node, the real window in the browser):
 * DOMPurify, then re-serialized as well-formed XHTML.
 */
export function makeToXhtml(window: Window & typeof globalThis): ToXhtml {
  const purify = createDOMPurify(window);
  return (html: string) => sanitizeToXhtml(purify, window, html);
}

function sanitizeToXhtml(purify: ReturnType<typeof createDOMPurify>, window: Window & typeof globalThis, html: string): string {
  const clean = purify.sanitize(html, { ...PURIFY_CONFIG, ADD_ATTR: PURIFY_CONFIG.ADD_ATTR.filter((a) => a !== 'data-model' && a !== 'loading') });
  const body = window.document.implementation.createHTMLDocument('').body;
  body.innerHTML = clean; // already sanitized by DOMPurify
  const xml = new window.XMLSerializer().serializeToString(body);
  return xml.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
}

function page(title: string, lang: string, body: string, opts: { epubType?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="${XHTML_NS}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escHtml(lang)}" xml:lang="${escHtml(lang)}">
<head>
<meta charset="utf-8"/>
<title>${escHtml(title)}</title>
<link rel="stylesheet" type="text/css" href="book.css"/>
</head>
<body${opts.epubType ? ` epub:type="${opts.epubType}"` : ''}>
${body}
</body>
</html>
`;
}

export function epubCss(): string {
  return `/* Scriptorium EPUB stylesheet — simple, so reading systems can apply the reader's own settings. */
body { font-family: "${fonts.body}", Georgia, serif; line-height: 1.5; margin: 0 4%; }
h1, h2, h3, h4, .label, .layer-label, .kicker, figcaption, caption { font-family: "${fonts.sans}", sans-serif; }
h1 { font-size: 1.8em; margin: 2em 0 .3em; } .subtitle { font-size: 1.15em; margin: 0 0 1.5em; }
h2 { font-size: 1.5em; margin: 1.5em 0 .6em; page-break-before: always; } h3 { font-size: 1.2em; margin: 1.6em 0 .5em; }
.kicker { margin: 2em 0 0; font-size: .9em; } .chapter h2 { page-break-before: avoid; }
.layer-label { font-size: .75em; letter-spacing: .04em; font-weight: bold; margin: 1em 0 .2em; }
.goals, .takeaways, .example, .callout { border: 1px solid #D0D7DE; padding: .5em .8em; margin: 1em 0; }
.callout { border-left: 4px solid #0072B2; } .callout.safety, .callout.debate { border-left-color: #B34E00; }
.label { font-weight: bold; font-size: .9em; } .callout p { margin: .3em 0 0; }
.eq-intuition { font-style: italic; } .eq-row { margin: .6em 0; } .eq-math { text-align: center; } .eq-num { text-align: right; font-family: "${fonts.sans}", sans-serif; }
.eq-where { border-collapse: collapse; font-size: .92em; } .eq-where td { padding: .1em .6em .1em 0; vertical-align: top; } .eq-where caption { text-align: left; font-size: .8em; }
.check, .credit, .view-label { font-size: .8em; } .validity { font-size: .92em; }
figure { margin: 1.2em 0; page-break-inside: avoid; } figure img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
figcaption { font-size: .88em; margin-top: .4em; }
.model3d .views { text-align: center; } .model3d .view { display: inline-block; width: 31%; vertical-align: top; margin: 0 .5%; } .view-label { text-align: center; margin: .1em 0 0; }
.interactive { font-size: .85em; }
.refs { list-style: none; padding-left: 0; } .refs li { margin: .4em 0; } .refs .n { font-weight: bold; }
dt { font-weight: bold; font-family: "${fonts.sans}", sans-serif; margin-top: .6em; } dd { margin-left: 0; }
table.report { border-collapse: collapse; font-size: .8em; } .report th, .report td { border: 1px solid #D0D7DE; padding: .25em; vertical-align: top; text-align: left; }
.colophon { font-size: .85em; }
.cover { text-align: center; margin: 0; padding: 0; } .cover img { max-width: 100%; max-height: 100%; }
`;
}

/** Every figure file the book shows (light versions), relative to the book folder. */
export function figureFiles(book: Book): string[] {
  const out = new Set<string>();
  const visit = (b: Block) => {
    if (b.kind === 'figure') out.add(b.src);
    if (b.kind === 'model3d') b.views.forEach((v) => out.add(v.src));
  };
  book.preface.forEach(visit);
  for (const ch of book.chapters) for (const s of ch.sections) for (const blocks of [s.layers.summary, s.layers.intuition, s.layers.formal, s.layers.limits]) blocks.forEach(visit);
  return [...out];
}

const hasMath = (xhtml: string) => xhtml.includes('<math');

export interface EpubResult {
  epub: Uint8Array;
  files: string[];
}

/**
 * @param readFile returns a book file's bytes by its path relative to the book (e.g. `figures/x.svg`), or undefined
 * @param toXhtml  sanitizer from makeToXhtml (jsdom in Node, the page's window in the browser)
 */
export function buildEpub(book: Book, readFile: (path: string) => Uint8Array | undefined, ctx: Omit<HtmlContext, 'figureBase' | 'target'>, opts: { coverJpeg?: Uint8Array; toXhtml: ToXhtml }): EpubResult {
  const toXhtml = opts.toXhtml;
  const m = book.meta;
  const c: HtmlContext = { ...ctx, figureBase: 'figures/', target: 'epub' };
  const lang = m.language;
  const docs: Array<{ id: string; href: string; title: string; xhtml: string; type?: string; landmark?: string }> = [];

  const titleBody = `<section epub:type="titlepage"><h1>${escHtml(m.title)}</h1>
${m.subtitle ? `<p class="subtitle">${escHtml(m.subtitle)}</p>` : ''}
<p>${m.authors.map(escHtml).join(', ')}</p></section>
<section epub:type="copyright-page">
${m.colophon ? `<p class="colophon">${htmlInline(m.colophon, c)}</p>` : ''}
${ctx.disclosure ? `<p class="colophon"><strong>AI-content disclosure.</strong> AI-generated text: ${escHtml(ctx.disclosure.text)}. AI-generated images: ${escHtml(ctx.disclosure.images)}. AI translation: ${escHtml(ctx.disclosure.translations)}.</p>` : ''}
<p class="colophon">${escHtml(m.license)}</p>
<p class="colophon">Edition date: ${escHtml(m.date)}.</p></section>
${book.preface.length ? `<section epub:type="preface"><h2 id="preface">Preface</h2>${book.preface.map((b) => htmlBlock(b, c)).join('\n')}</section>` : ''}`;
  docs.push({ id: 'titlepage', href: 'title.xhtml', title: m.title, xhtml: toXhtml(titleBody), landmark: 'titlepage' });

  book.chapters.forEach((ch, i) => {
    const html = renderChapter(ch, i, c);
    docs.push({ id: `chapter-${i + 1}`, href: `chapter-${i + 1}.xhtml`, title: `${i + 1}. ${ch.title}`, xhtml: toXhtml(html), type: 'chapter', landmark: i === 0 ? 'bodymatter' : undefined });
  });

  const back = `${renderGlossary(book, c)}\n${renderReferences(c)}\n${renderReport(book, c)}`;
  docs.push({ id: 'backmatter', href: 'backmatter.xhtml', title: 'Glossary, references and verification report', xhtml: toXhtml(back), type: 'backmatter' });

  // In-book links: figure/equation references stay within a chapter; terms and citations point to backmatter.xhtml.
  const zip: Zippable = {};
  const fixed = new Date('2000-01-01T00:00:00Z');
  zip['mimetype'] = [strToU8('application/epub+zip'), { level: 0, mtime: fixed }];
  zip['META-INF/container.xml'] = [
    strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`),
    { mtime: fixed },
  ];
  const put = (path: string, data: Uint8Array) => (zip[`OEBPS/${path}`] = [data, { mtime: fixed }]);

  for (const d of docs) put(d.href, strToU8(page(d.title, lang, d.xhtml, { epubType: d.type })));
  put('book.css', strToU8(epubCss()));

  const figs = figureFiles(book);
  for (const f of figs) {
    const bytes = readFile(f);
    if (!bytes) throw new Error(`Figure file missing for the EPUB: ${f}`);
    put(f, bytes);
  }

  const cover = opts.coverJpeg;
  if (cover) {
    put('cover.jpg', cover);
    put('cover.xhtml', strToU8(page('Cover', lang, `<section epub:type="cover" class="cover"><img src="cover.jpg" alt="${escHtml(`Cover of ${m.title}`)}"/></section>`)));
  }

  const toc = [
    `<li><a href="title.xhtml">Title page</a></li>`,
    ...(book.preface.length ? [`<li><a href="title.xhtml#preface">Preface</a></li>`] : []),
    ...book.chapters.map((ch, i) => `<li><a href="chapter-${i + 1}.xhtml">${i + 1}. ${escHtml(ch.title)}</a><ol>${ch.sections.map((s) => `<li><a href="chapter-${i + 1}.xhtml#${s.id}">${escHtml(s.title)}</a></li>`).join('')}</ol></li>`),
    ...(book.glossary.length ? [`<li><a href="backmatter.xhtml#glossary">Glossary</a></li>`] : []),
    `<li><a href="backmatter.xhtml#references">References</a></li>`,
    `<li><a href="backmatter.xhtml#verification">Verification report</a></li>`,
  ];
  const nav = `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${toc.join('\n')}</ol></nav>
<nav epub:type="landmarks" hidden="hidden"><h1>Landmarks</h1><ol>
${cover ? '<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>' : ''}
<li><a epub:type="bodymatter" href="chapter-1.xhtml">Start of content</a></li>
</ol></nav>`;
  put('nav.xhtml', strToU8(page('Contents', lang, nav)));

  const modified = `${/^\d{4}-\d{2}-\d{2}$/.test(m.date) ? m.date : '2000-01-01'}T00:00:00Z`;
  const media = (f: string) => (f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'image/jpeg');
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="css" href="book.css" media-type="text/css"/>`,
    ...(cover ? [`<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>`, `<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`] : []),
    ...docs.map((d) => `<item id="${d.id}" href="${d.href}" media-type="application/xhtml+xml"${hasMath(d.xhtml) ? ' properties="mathml"' : ''}/>`),
    ...figs.map((f, i) => `<item id="img-${i + 1}" href="${escHtml(f)}" media-type="${media(f)}"/>`),
  ];
  const spine = [...(cover ? [`<itemref idref="cover" linear="yes"/>`] : []), ...docs.map((d) => `<itemref idref="${d.id}"/>`)];
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escHtml(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${bookUuid(book)}</dc:identifier>
    <dc:title id="title">${escHtml(m.title)}</dc:title>
${m.subtitle ? `    <dc:title id="subtitle">${escHtml(m.subtitle)}</dc:title>\n    <meta refines="#title" property="title-type">main</meta>\n    <meta refines="#subtitle" property="title-type">subtitle</meta>` : ''}
${m.authors.map((a, i) => `    <dc:creator id="creator-${i + 1}">${escHtml(a)}</dc:creator>`).join('\n')}
    <dc:language>${escHtml(lang)}</dc:language>
    <dc:date>${escHtml(m.date)}</dc:date>
    <dc:rights>${escHtml(m.license)}</dc:rights>
${m.description ? `    <dc:description>${escHtml(m.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())}</dc:description>` : ''}
${(m.keywords ?? []).map((k) => `    <dc:subject>${escHtml(k)}</dc:subject>`).join('\n')}
    <meta property="dcterms:modified">${modified}</meta>
    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessMode">visual</meta>
    <meta property="schema:accessModeSufficient">textual</meta>
    <meta property="schema:accessibilityFeature">alternativeText</meta>
    <meta property="schema:accessibilityFeature">MathML</meta>
    <meta property="schema:accessibilityFeature">tableOfContents</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityHazard">none</meta>
    <meta property="schema:accessibilitySummary">Every figure has a text description; equations are MathML with a written symbol list and worked example.</meta>
  </metadata>
  <manifest>
${manifest.map((l) => `    ${l}`).join('\n')}
  </manifest>
  <spine>
${spine.map((l) => `    ${l}`).join('\n')}
  </spine>
</package>
`;
  zip['OEBPS/package.opf'] = [strToU8(opf), { mtime: fixed }];

  // fflate keeps insertion order; re-insert so mimetype is first and package.opf follows container.xml.
  const ordered: Zippable = { mimetype: zip['mimetype']!, 'META-INF/container.xml': zip['META-INF/container.xml']!, 'OEBPS/package.opf': zip['OEBPS/package.opf']! };
  for (const [k, v] of Object.entries(zip)) if (!(k in ordered)) ordered[k] = v;
  const epub = zipSync(ordered, { level: 9, mtime: fixed });
  return { epub, files: Object.keys(ordered) };
}

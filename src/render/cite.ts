/**
 * Bibliography formatting with citeproc-js and Citation Style Language (CSL) styles.
 * Styles live in styles/ (from github.com/citation-style-language/styles, CC BY-SA 3.0);
 * a domain profile names its style id and the file is loaded by the caller, so this
 * module runs in the browser and in Node.
 */
// citeproc ships CommonJS without types
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import CSL from 'citeproc';
import type { Reference } from '../core/book.ts';

export interface CslAssets {
  styleXml: string;
  localeXml: string;
}

/** Only CSL fields go to the processor; our verification record stays out. */
function toCsl(r: Reference): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { verification, license, ...csl } = r;
  return csl;
}

/** Remove markup citeproc emits in text mode (e.g. <i> around titles in some styles). */
function stripTags(s: string): string {
  return s.replace(/<\/?(i|b|sup|sub|span)[^>]*>/g, '');
}

/**
 * Returns one formatted entry per reference, in the order given by `orderedIds`.
 * format: 'html' for the web book, 'text' for Typst and EPUB text (the caller escapes it).
 */
export function formatBibliography(refs: Reference[], orderedIds: string[], assets: CslAssets, format: 'html' | 'text'): Map<string, string> {
  const byId = new Map(refs.map((r) => [r.id, toCsl(r)]));
  const ids = orderedIds.filter((id) => byId.has(id));
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const sys = {
    retrieveLocale: () => assets.localeXml,
    retrieveItem: (id: string) => byId.get(id),
  };
  const engine = new CSL.Engine(sys, assets.styleXml, 'en-US');
  engine.setOutputFormat(format);
  engine.updateItems(ids);
  const [meta, entries] = engine.makeBibliography() as [{ entry_ids: string[][] }, string[]];
  meta.entry_ids.forEach((eids, i) => {
    let entry = entries[i]!.trim();
    if (format === 'html') {
      // Drop citeproc's wrapper divs and the leading "[n]" label; we render our own label.
      entry = entry.replace(/^<div class="csl-entry">/, '').replace(/<\/div>$/, '').replace(/<div class="csl-left-margin">[^<]*<\/div>/, '').replace(/<div class="csl-right-inline">([\s\S]*)<\/div>/, '$1').trim();
    } else {
      entry = stripTags(entry).replace(/^[([]?\d+[)\]]?\.?\s*/, '').trim();
    }
    out.set(eids[0]!, entry);
  });
  return out;
}

/**
 * Split Typst's whole-document SVG into one standalone SVG per page, so each page can be drawn
 * into its own texture. Pure string work (no DOM), so it runs in Node and in the browser.
 *
 * Typst's SVG (from typst.ts) looks like:
 *
 *   <svg class="typst-doc" …>
 *     <style>…</style>
 *     <defs class="glyph"><path id="g…" class="outline_glyph" d="…"/>…</defs>
 *     <defs class="clip-path">…</defs>
 *     <style>…</style>
 *     <g class="typst-page" transform="translate(0, Y)" data-page-width="W" data-page-height="H">…</g>
 *     …one <g class="typst-page"> per page…
 *   </svg>
 *
 * Each page keeps only the glyph outlines it uses, so page files stay small.
 */

export interface PageSvg {
  width: number;
  height: number;
  svg: string;
}

/** Index just past the `</g>` that closes the `<g` starting at `start` (nested groups counted). */
function groupEnd(svg: string, start: number): number {
  const tag = /<g\b[^>]*?(\/?)>|<\/g>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let m = tag.exec(svg); m; m = tag.exec(svg)) {
    if (m[0] === '</g>') depth--;
    else if (m[1] !== '/') depth++;
    if (depth === 0) return tag.lastIndex;
  }
  throw new Error('The typeset SVG is malformed (unclosed page group).');
}

function section(svg: string, cls: string): string {
  const m = svg.match(new RegExp(`<defs[^>]*class="${cls}"[^>]*?(?:/>|>([\\s\\S]*?)</defs>)`));
  return m?.[1] ?? '';
}

export function splitPages(doc: string): PageSvg[] {
  const glyphs = new Map<string, string>();
  for (const m of section(doc, 'glyph').matchAll(/<(path|symbol)\b[^>]*\bid="([^"]+)"[\s\S]*?(?:\/>|<\/\1>)/g)) glyphs.set(m[2]!, m[0]);
  const clips = section(doc, 'clip-path');
  const pages: PageSvg[] = [];
  const open = /<g\b[^>]*class="typst-page"[^>]*>/g;
  for (let m = open.exec(doc); m; m = open.exec(doc)) {
    const end = groupEnd(doc, m.index);
    const head = m[0];
    const width = Number(head.match(/data-page-width="([\d.]+)"/)?.[1]);
    const height = Number(head.match(/data-page-height="([\d.]+)"/)?.[1]);
    if (!(width > 0 && height > 0)) throw new Error('The typeset SVG has a page without a size.');
    // The page group is translated down the long document; drop that so it starts at 0,0.
    const body = head.replace(/\stransform="[^"]*"/, '') + doc.slice(m.index + head.length, end);
    const used = new Set<string>();
    for (const r of body.matchAll(/href="#([^"]+)"/g)) used.add(r[1]!);
    const defs = [...used].map((id) => glyphs.get(id) ?? '').join('');
    pages.push({
      width,
      height,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/><defs>${defs}${clips}</defs>${body}</svg>`,
    });
    open.lastIndex = end;
  }
  if (!pages.length) throw new Error('The typeset SVG has no pages.');
  return pages;
}

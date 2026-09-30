/**
 * The inline markup used in every text field of a book (see src/core/book.ts):
 *   **bold**  *italic*  $math$  [@id] / [@id, locator]  [[term]]  `code`
 * Parsed into tokens once; the HTML and Typst renderers each escape every text token,
 * so no content (model output included) can inject markup into either format.
 */

export type InlineToken =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: InlineToken[] }
  | { t: 'italic'; v: InlineToken[] }
  | { t: 'math'; v: string }
  | { t: 'cite'; id: string; locator?: string }
  | { t: 'term'; v: string }
  | { t: 'code'; v: string };

export function parseInline(src: string): InlineToken[] {
  const out: InlineToken[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if (rest.startsWith('\\$')) {
      buf += '$';
      i += 2;
    } else if (rest[0] === '$' && (m = rest.match(/^\$((?:\\.|[^$\\])+)\$/))) {
      flush();
      out.push({ t: 'math', v: m[1]! });
      i += m[0].length;
    } else if ((m = rest.match(/^\[@([a-z0-9-]+)(?:,\s*([^\]]+))?\]/))) {
      flush();
      out.push({ t: 'cite', id: m[1]!, locator: m[2]?.trim() });
      i += m[0].length;
    } else if ((m = rest.match(/^\[\[([^\]]+)\]\]/))) {
      flush();
      out.push({ t: 'term', v: m[1]! });
      i += m[0].length;
    } else if ((m = rest.match(/^`([^`]+)`/))) {
      flush();
      out.push({ t: 'code', v: m[1]! });
      i += m[0].length;
    } else if ((m = rest.match(/^\*\*(.+?)\*\*/))) {
      flush();
      out.push({ t: 'bold', v: parseInline(m[1]!) });
      i += m[0].length;
    } else if ((m = rest.match(/^\*([^*\s](?:[^*]*[^*\s])?)\*/))) {
      flush();
      out.push({ t: 'italic', v: parseInline(m[1]!) });
      i += m[0].length;
    } else {
      buf += src[i];
      i++;
    }
  }
  flush();
  return out;
}

/** Plain text of a token list (for alt text, readability, search). */
export function plainText(tokens: InlineToken[]): string {
  return tokens
    .map((k) => {
      switch (k.t) {
        case 'text':
        case 'term':
        case 'code':
          return k.v;
        case 'math':
          return k.v;
        case 'bold':
        case 'italic':
          return plainText(k.v);
        case 'cite':
          return '';
      }
    })
    .join('');
}

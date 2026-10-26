/**
 * Schema problems in words a book author can act on: where in the book (chapter, section, block
 * id, field) and what is wrong, instead of a raw path such as chapters.0.sections.1.layers.formal.3.
 */
import type { core } from 'zod';

type Issue = Pick<core.$ZodIssue, 'path' | 'message'>;

const at = (data: unknown, path: PropertyKey[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<PropertyKey, unknown>)[k] : undefined), data);

export function describePath(data: unknown, path: PropertyKey[]): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const k = path[i]!;
    const here = at(data, path.slice(0, i + 1)) as { id?: unknown; title?: unknown; kind?: unknown } | undefined;
    const parent = path[i - 1];
    if (typeof k === 'number') {
      if (parent === 'chapters') parts.push(`chapter ${k + 1}${typeof here?.id === 'string' ? ` (${here.id})` : ''}`);
      else if (parent === 'sections') parts.push(typeof here?.id === 'string' ? here.id : `section ${k + 1}`);
      else if (['summary', 'intuition', 'formal', 'limits', 'preface'].includes(String(parent))) parts.push(typeof here?.id === 'string' ? here.id : `${String(here?.kind ?? 'block')} ${k + 1}`);
      else parts[parts.length - 1] = `${parts.at(-1) ?? ''}[${k + 1}]`;
    } else if (k !== 'chapters' && k !== 'sections' && k !== 'layers') {
      parts.push(String(k));
    }
  }
  return parts.join(' › ') || 'the book';
}

export function describeIssues(data: unknown, issues: Issue[], max = 6): string {
  const lines = issues.slice(0, max).map((i) => `  • ${describePath(data, i.path as PropertyKey[])}: ${i.message}`);
  if (issues.length > max) lines.push(`  • …and ${issues.length - max} more`);
  return lines.join('\n');
}

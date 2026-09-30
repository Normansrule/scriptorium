/**
 * Stage 8: readability.
 *
 * Flesch–Kincaid Grade Level (Kincaid et al., 1975):
 *
 *   grade = 0.39 · (words / sentences) + 11.8 · (syllables / words) − 15.59
 *
 * The target for body text is grade 10–12. Math, citations and code are removed first,
 * because formulas are not prose and would distort the counts. Syllables are counted with
 * a vowel-group heuristic, which is approximate (typically within one syllable per word);
 * the score is a guide for the readability pass, not a hard gate.
 */

export function stripMarkup(text: string): string {
  return text
    .replace(/\$[^$]*\$/g, ' x ') // inline math counts as one short word
    .replace(/\[@[^\]]*\]/g, '')
    .replace(/`[^`]*`/g, ' code ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*+/g, '');
}

export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export interface Readability {
  words: number;
  sentences: number;
  syllables: number;
  grade: number;
}

export function fleschKincaid(text: string): Readability {
  const clean = stripMarkup(text);
  const sentences = Math.max(1, (clean.match(/[.!?]+(\s|$)/g) ?? []).length);
  const words = clean.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  const n = Math.max(1, words.length);
  const grade = 0.39 * (n / sentences) + 11.8 * (syllables / n) - 15.59;
  return { words: words.length, sentences, syllables, grade: Math.round(grade * 100) / 100 };
}

export const TARGET_GRADE = { min: 10, max: 12 } as const;

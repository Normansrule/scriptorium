import { describe, expect, it } from 'vitest';
import { countSyllables, fleschKincaid } from '../../src/core/readability.ts';

describe('Flesch–Kincaid grade', () => {
  it('matches the formula on a hand-counted example', () => {
    // "The cat sat on the mat." 6 words, 1 sentence, 6 syllables → 0.39·6 + 11.8·1 − 15.59 = −1.45
    const r = fleschKincaid('The cat sat on the mat.');
    expect(r.words).toBe(6);
    expect(r.syllables).toBe(6);
    expect(r.grade).toBeCloseTo(-1.45, 2);
  });
  it('counts syllables approximately', () => {
    expect(countSyllables('capacitor')).toBe(4);
    expect(countSyllables('time')).toBe(1);
    expect(countSyllables('frequency')).toBe(3);
  });
  it('ignores math and citations', () => {
    expect(fleschKincaid('It is $\\frac{1}{2\\pi RC}$ [@x].').words).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/core/expr.ts';

describe('safe plot expressions', () => {
  it('evaluates the book equations', () => {
    expect(compile('1 - exp(-x)')({ x: 1 })).toBeCloseTo(0.63212, 5);
    expect(compile('20 * log10(1 / sqrt(1 + (x / fc)^2))')({ x: 995, fc: 995 })).toBeCloseTo(-3.0103, 4);
    expect(compile('-2^2')({})).toBe(-4);
    expect(compile('2^3^2')({})).toBe(512);
  });
  it('rejects anything outside the grammar', () => {
    for (const bad of ['alert(1)', 'x; process.exit()', 'constructor.constructor("x")()', '`x`', 'x[0]', 'a.b', 'eval(x)', 'constructor', '__proto__']) {
      expect(() => compile(bad)({ x: 1 })).toThrow();
    }
  });
});

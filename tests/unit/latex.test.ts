import { describe, expect, it } from 'vitest';
import { latexToTypst } from '../../src/render/latex-typst.ts';

describe('LaTeX → Typst math', () => {
  it('converts the forms used in the books', () => {
    expect(latexToTypst('C = \\frac{Q}{V}')).toBe('C = frac(Q, V)');
    expect(latexToTypst('\\tfrac12 QV')).toBe('frac(1, 2) Q V');
    expect(latexToTypst('C = 100\\,\\mu\\text{F}')).toBe('C = 100 thin "µF"');
    expect(latexToTypst('R = 10\\,\\text{k}\\Omega')).toBe('R = 10 thin "kΩ"');
    expect(latexToTypst('G_{\\text{dB}}')).toBe('G_("dB")');
  });
  it('rejects anything it does not know instead of guessing', () => {
    for (const bad of ['\\input{x}', '\\constructor', '\\toString', '\\__proto__', 'a # b', '\\frac{1}{2']) expect(() => latexToTypst(bad), bad).toThrow();
  });
});

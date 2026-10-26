import { describe, expect, it } from 'vitest';
import { escMarkup } from '../../src/render/typst.ts';
import { latexToText } from '../../src/render/latex-text.ts';
import { faceOn, renderMoleculeSvg } from '../../src/render/molecule-svg.ts';
import type { Model } from '../../src/core/molecule.ts';

describe('Typst escaping', () => {
  it('escapes a semicolon so it survives right after an inline call', () => {
    expect(escMarkup('; both change')).toBe(String.raw`\; both change`);
    expect(escMarkup('#raw("x")')).toBe(String.raw`\#raw("x")`);
  });
});

describe('angle labels', () => {
  const water: Model = {
    title: 'water',
    unit: 'Å',
    atoms: [
      { el: 'O', x: 0, y: 0, z: 0 },
      { el: 'H', x: 0.79, y: -0.61, z: 0 },
      { el: 'H', x: -0.79, y: -0.61, z: 0 },
    ],
    bonds: [
      [0, 1],
      [0, 2],
    ],
  };
  const ann = [{ type: 'angle' as const, atoms: [1, 0, 2] as [number, number, number], label: '104.5°' }];

  it('faceOn accepts a plane facing the viewer and rejects a tilted one', () => {
    expect(faceOn({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(true);
    expect(faceOn({ x: 1, y: 0, z: 0.5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(false);
  });

  it('labels the angle face-on only', () => {
    expect(renderMoleculeSvg(water, { yaw: 0, pitch: 0 }, { annotations: ann })).toContain('104.5°');
    expect(renderMoleculeSvg(water, { yaw: 35, pitch: -30 }, { annotations: ann })).not.toContain('104.5°');
  });
});

describe('latexToText (captions where maths cannot be typeset)', () => {
  it('turns the caption subset of LaTeX into readable Unicode', () => {
    expect(latexToText('\\mathrm{HR} \\times \\mathrm{SV}')).toBe('HR × SV');
    expect(latexToText('R \\propto \\frac{1}{r^4}')).toBe('R ∝ 1/r⁴');
    expect(latexToText('C = 100\\,\\mu\\text{F}')).toBe('C = 100\u2009µF'); // a thin space before the unit
    expect(latexToText('V_s(1 - e^{-t/\\tau})')).toBe('Vₛ(1 - e^(-t/τ))');
    // unknown commands stay readable rather than vanishing
    expect(latexToText('\\weird x')).toBe('\\weird x');
  });
});

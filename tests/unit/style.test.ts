import { describe, expect, it } from 'vitest';
import { contrast, printMinimums, roles, surface } from '../../src/core/style.ts';

describe('STYLE.md palette meets WCAG 2.2 contrast', () => {
  for (const mode of ['light', 'dark'] as const) {
    const bg = surface.paper[mode];
    it(`${mode}: body text ≥ 4.5:1 (ink and muted)`, () => {
      expect(contrast(surface.ink[mode], bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(surface.muted[mode], bg)).toBeGreaterThanOrEqual(4.5);
    });
    for (const [name, r] of Object.entries(roles)) {
      it(`${mode}: ${name} ≥ ${r.text ? '4.5' : '3'}:1`, () => {
        expect(contrast(r[mode], bg)).toBeGreaterThanOrEqual(r.text ? 4.5 : 3);
        expect(contrast(r[mode], surface.panel[mode])).toBeGreaterThanOrEqual(3);
      });
    }
  }
  it('print floors are above KDP minimums (0.75 pt lines, 7 pt text, 10 % gray)', () => {
    expect(printMinimums.lineWidthPt).toBeGreaterThanOrEqual(0.75);
    expect(printMinimums.labelSizePt).toBeGreaterThanOrEqual(7);
    expect(printMinimums.grayFillPercent).toBeGreaterThanOrEqual(10);
  });
});

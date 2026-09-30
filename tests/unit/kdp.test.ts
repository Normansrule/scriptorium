import { describe, expect, it } from 'vitest';
import { billedPageCount, checkPageCount, coverGeometry, findTrim, interiorPageSize, minGutter, spineWidth } from '../../src/kdp/specs.ts';

// Values from KDP Paperback Submission Guidelines (G201857950) and Create a Paperback Cover (G201953020).
describe('KDP specs', () => {
  const trim = findTrim(6, 9);

  it('gutter follows the page-count table', () => {
    expect(minGutter(24)).toBe(0.375);
    expect(minGutter(150)).toBe(0.375);
    expect(minGutter(151)).toBe(0.5);
    expect(minGutter(300)).toBe(0.5);
    expect(minGutter(301)).toBe(0.625);
    expect(minGutter(700)).toBe(0.75);
    expect(minGutter(828)).toBe(0.875);
    expect(() => minGutter(829)).toThrow();
  });

  it('bleed adds 0.125" width and 0.25" height to the interior page', () => {
    expect(interiorPageSize(trim, true)).toEqual({ width: 6.125, height: 9.25 });
    expect(interiorPageSize(trim, false)).toEqual({ width: 6, height: 9 });
  });

  it('spine width = pages × paper factor (worked example: 212 pages on white)', () => {
    expect(spineWidth(212, 'white')).toBeCloseTo(212 * 0.002252, 10);
    expect(spineWidth(212, 'cream')).toBeCloseTo(0.53, 10);
    expect(spineWidth(211, 'white')).toBeCloseTo(212 * 0.002252, 10); // KDP rounds up to even
  });

  it('cover = bleed + back + spine + front + bleed', () => {
    const g = coverGeometry(trim, 212, 'white');
    expect(g.width).toBeCloseTo(0.125 + 6 + 212 * 0.002252 + 6 + 0.125, 10);
    expect(g.width).toBeCloseTo(12.7274, 4);
    expect(g.height).toBeCloseTo(9.25, 10);
    expect(g.frontLeft).toBeCloseTo(0.125 + 6 + g.spine, 10);
    expect(g.spineTextAllowed).toBe(true);
  });

  it('spine text only above 79 pages', () => {
    expect(coverGeometry(trim, 78, 'white').spineTextAllowed).toBe(false);
    expect(coverGeometry(trim, 80, 'white').spineTextAllowed).toBe(true);
  });

  it('page-count limits', () => {
    expect(billedPageCount(27)).toBe(28);
    expect(checkPageCount(22, trim, 'white').ok).toBe(false);
    expect(checkPageCount(24, trim, 'white').ok).toBe(true);
    expect(checkPageCount(828, trim, 'white').ok).toBe(true);
    expect(checkPageCount(800, trim, 'cream').ok).toBe(false);
    expect(checkPageCount(60, trim, 'standard-color').ok).toBe(false);
    expect(checkPageCount(100, findTrim(8.27, 11.69), 'standard-color').ok).toBe(false);
  });

  it('rejects non-KDP trim sizes', () => {
    expect(() => findTrim(6, 8)).toThrow();
  });
});

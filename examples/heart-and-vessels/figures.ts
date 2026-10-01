/**
 * Figures for the medicine sample book. Every curve is an equation from book.json with
 * the values the cited textbook gives (OpenStax Anatomy and Physiology 2e, §19.4 and
 * §20.2); tests/equations/test_medicine.py checks the same numbers.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plot } from '../../src/render/svg.ts';
import type { Mode } from '../../src/core/style.ts';

const here = dirname(fileURLToPath(import.meta.url));

const plots: Record<string, (mode: Mode) => string> = {
  'cardiac-output': (mode) =>
    plot(
      {
        title: 'Cardiac output rises with heart rate and stroke volume',
        desc: 'CO = HR × SV for heart rates 50 to 110 bpm and stroke volumes of 55, 70 and 100 mL; marked point at 75 bpm and 70 mL giving 5.25 L/min.',
        x: { label: 'Heart rate, HR (beats per minute)', from: 50, to: 110, ticks: [50, 60, 70, 80, 90, 100, 110] },
        y: { label: 'Cardiac output, CO (L/min)', from: 0, to: 12, ticks: [0, 2, 4, 6, 8, 10, 12] },
        series: [
          { label: 'SV = 100 mL', expr: 'x * 0.100', role: 'accent', direct: false },
          { label: 'SV = 70 mL', expr: 'x * 0.070', role: 'signal', direct: false },
          { label: 'SV = 55 mL', expr: 'x * 0.055', role: 'external', direct: false },
        ],
        points: [{ x: 75, y: 5.25, label: '75 bpm × 70 mL = 5.25 L/min', dx: 10, dy: 62 }],
      },
      mode,
    ),
  'resistance-radius': (mode) =>
    plot(
      {
        title: 'Resistance depends on the fourth power of vessel radius',
        desc: 'Relative resistance = 1 / (relative radius)⁴ on a logarithmic axis, for radii from 0.4 to 2.2 times the original; marked points at half the radius (16 times the resistance) and twice the radius (one sixteenth).',
        x: { label: 'Vessel radius ÷ original radius', from: 0.4, to: 2.2, ticks: [0.5, 1, 1.5, 2] },
        y: { label: 'Resistance ÷ original (log scale)', from: 0.03, to: 50, log: true, ticks: [0.1, 1, 10], tickFormat: (v) => `${v}` },
        series: [{ label: 'R ∝ 1/r⁴', expr: '1 / x^4', role: 'signal', labelAt: 1.55, labelDy: -14 }],
        points: [
          { x: 0.5, y: 16, label: 'half the radius: 16 × the resistance', dx: 10, dy: -4 },
          { x: 1, y: 1, label: 'original vessel', dx: 10, dy: -10 },
          { x: 2, y: 1 / 16, label: 'twice the radius: 1/16 the resistance', dx: -10, dy: 18, anchor: 'end' },
        ],
      },
      mode,
    ),
};

/** Writes figures/*.svg under <root>; returns the paths relative to <root>. */
export function drawAll(root = here): string[] {
  mkdirSync(join(root, 'figures'), { recursive: true });
  const written: string[] = [];
  for (const [name, draw] of Object.entries(plots)) {
    for (const mode of ['light', 'dark'] as const) {
      const rel = `figures/${name}${mode === 'dark' ? '.dark' : ''}.svg`;
      writeFileSync(join(root, rel), draw(mode));
      written.push(rel);
    }
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Wrote ${drawAll().length} files under ${here}`);

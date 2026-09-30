/**
 * Draws every figure in the RC-circuits sample book, in light and dark versions.
 * Run: npm run figures   (part of `npm run assets`)
 *
 * Every plotted curve is an equation from book.json evaluated by src/core/expr.ts, with
 * the same component values as the worked examples, so the pictures cannot drift from
 * the math that tests/equations/test_rc_book.py verifies.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrow, palette, plot, svgDoc, text } from '../../src/render/svg.ts';
import { batteryV, capacitorV, dot, ground, resistorH, switchH, terminal, wire } from '../../src/render/schematic.ts';
import { seriesOrder, type Mode } from '../../src/core/style.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'figures');

type Draw = (mode: Mode) => string;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const hz = (v: number) => (v >= 1000 ? `${v / 1000} kHz` : `${v} Hz`);

const figures: Record<string, Draw> = {
  'parallel-plate': (mode) => {
    const pal = palette(mode);
    const W = 380;
    const H = 210;
    const x1 = 70;
    const x2 = 290;
    const yTop = 50;
    const yBot = 150;
    const parts: string[] = [];
    // field region tint
    parts.push(`<rect x="${x1}" y="${yTop + 4}" width="${x2 - x1}" height="${yBot - yTop - 8}" fill="${pal.tint('signal')}"/>`);
    // field lines (arrows from + to −)
    for (let x = x1 + 22; x < x2 - 10; x += 36) parts.push(arrow(x, yTop + 12, x, yBot - 10, pal.role('signal'), 1.5));
    // plates
    parts.push(`<rect x="${x1}" y="${yTop - 6}" width="${x2 - x1}" height="8" rx="2" fill="${pal.ink}"/>`);
    parts.push(`<rect x="${x1}" y="${yBot - 2}" width="${x2 - x1}" height="8" rx="2" fill="${pal.ink}"/>`);
    // charges
    for (let x = x1 + 14; x < x2; x += 24) {
      parts.push(text(x, yTop - 12, '+', { anchor: 'middle', fill: pal.role('accent'), size: 15, weight: 700 }));
      parts.push(text(x, yBot + 24, '−', { anchor: 'middle', fill: pal.role('signal'), size: 15, weight: 700 }));
    }
    // gap dimension
    const dx = x2 + 26;
    parts.push(arrow(dx, (yTop + yBot) / 2, dx, yTop + 2, pal.muted, 1.25), arrow(dx, (yTop + yBot) / 2, dx, yBot - 2, pal.muted, 1.25));
    parts.push(text(dx + 8, (yTop + yBot) / 2 + 5, 'd (gap)', { fill: pal.ink, size: 13 }));
    // labels
    parts.push(text(x1 - 8, yTop + 2, 'Plate area A', { anchor: 'end', fill: pal.ink, size: 12 }));
    parts.push(text(x1 - 8, yTop + 16, '+Q', { anchor: 'end', fill: pal.role('accent'), size: 12, weight: 600 }));
    parts.push(text(x1 - 8, yBot + 6, '−Q', { anchor: 'end', fill: pal.role('signal'), size: 12, weight: 600 }));
    parts.push(text((x1 + x2) / 2, H - 8, 'Electric field E between the plates (arrows)', { anchor: 'middle', fill: pal.muted, size: 11 }));
    return svgDoc(W, H, 'Parallel-plate capacitor', 'Two plates of area A, gap d, charges +Q and −Q, uniform field between them.', parts.join('\n'), pal);
  },

  energy: (mode) =>
    plot(
      {
        title: 'Energy stored versus voltage',
        desc: 'U = ½CV² for 100 µF and 47 µF, 0–15 V.',
        x: { label: 'Voltage across the capacitor, V (V)', from: 0, to: 15, ticks: [0, 3, 6, 9, 12, 15] },
        y: { label: 'Stored energy, U (mJ)', from: 0, to: 12, ticks: [0, 3, 6, 9, 12] },
        series: [
          { label: 'C = 100 µF', expr: '0.5 * 100e-6 * x^2 * 1000', role: seriesOrder[0], direct: false },
          { label: 'C = 47 µF', expr: '0.5 * 47e-6 * x^2 * 1000', role: seriesOrder[1], direct: false },
        ],
        points: [{ x: 12, y: 7.2, label: '12 V → 7.2 mJ', dx: -104, dy: -8 }],
      },
      mode,
    ),

  'rc-circuit': (mode) => {
    const pal = palette(mode);
    const W = 360;
    const H = 200;
    const L = 70;
    const R = 280;
    const T = 50;
    const B = 160;
    const parts = [
      batteryV(pal, L, T, B, 'Vₛ'),
      switchH(pal, L, 150, T, 'switch'),
      resistorH(pal, 150, R, T, 'R'),
      capacitorV(pal, R, T, B, 'C'),
      wire(pal, [[L, B], [R, B]]),
      arrow(185, T + 18, 225, T + 18, pal.role('signal'), 1.5),
      text(205, T + 34, 'current i', { anchor: 'middle', fill: pal.role('signal'), size: 12 }),
      text(R + 40, (T + B) / 2 - 22, '+', { fill: pal.role('accent'), size: 13, weight: 700 }),
      text(R + 40, (T + B) / 2 + 30, '−', { fill: pal.role('accent'), size: 13, weight: 700 }),
      text(R + 52, (T + B) / 2 + 5, 'v', { fill: pal.role('accent'), size: 14, italic: true, weight: 600 }),
      text(R + 60, (T + B) / 2 + 9, 'C', { fill: pal.role('accent'), size: 10, italic: true, weight: 600 }),
    ];
    return svgDoc(W, H, 'RC charging circuit', 'Battery Vs, switch, resistor R and capacitor C in one loop; capacitor voltage vC.', parts.join('\n'), pal);
  },

  charging: (mode) =>
    plot(
      {
        title: 'Capacitor charging curve',
        desc: 'vC/Vs = 1 − e^(−t/τ) for t from 0 to 6τ.',
        x: { label: 'Time, in time constants (t / τ)', from: 0, to: 6, ticks: [0, 1, 2, 3, 4, 5, 6] },
        y: { label: 'Capacitor voltage (fraction of Vₛ)', from: 0, to: 1.05, ticks: [0, 0.25, 0.5, 0.75, 1], tickFormat: pct },
        series: [{ label: 'vC / Vₛ = 1 − e^(−t/τ)', expr: '1 - exp(-x)', role: 'signal', labelAt: 2.3, labelDy: 30 }],
        refLines: [{ x1: 0, y1: 1, x2: 6, y2: 1, label: 'supply voltage Vₛ', labelX: 6, labelY: 1 }],
        points: [
          { x: 1, y: 1 - Math.exp(-1), label: '1τ: 63.2%', dx: 8, dy: 16 },
          { x: 5, y: 1 - Math.exp(-5), label: '5τ: 99.3%', dx: 8, dy: 22 },
        ],
      },
      mode,
    ),

  tau: (mode) =>
    plot(
      {
        title: 'Effect of the resistor on charging speed',
        desc: 'vC(t) = 5(1 − e^(−t/RC)) with C = 100 µF and R = 10, 22, 47 kΩ.',
        x: { label: 'Time, t (s)', from: 0, to: 15, ticks: [0, 3, 6, 9, 12, 15] },
        y: { label: 'Capacitor voltage, vC (V)', from: 0, to: 6.6, ticks: [0, 1, 2, 3, 4, 5] },
        series: [
          { label: 'R = 10 kΩ (τ = 1 s)', expr: '5 * (1 - exp(-x / 1))', role: seriesOrder[0], direct: false },
          { label: 'R = 22 kΩ (τ = 2.2 s)', expr: '5 * (1 - exp(-x / 2.2))', role: seriesOrder[1], direct: false },
          { label: 'R = 47 kΩ (τ = 4.7 s)', expr: '5 * (1 - exp(-x / 4.7))', role: seriesOrder[2], direct: false },
        ],
      },
      mode,
    ),

  discharge: (mode) =>
    plot(
      {
        title: 'Capacitor discharge curve',
        desc: 'vC/V0 = e^(−t/τ) for t from 0 to 5τ.',
        x: { label: 'Time, in time constants (t / τ)', from: 0, to: 5, ticks: [0, 1, 2, 3, 4, 5] },
        y: { label: 'Capacitor voltage (fraction of V₀)', from: 0, to: 1.05, ticks: [0, 0.25, 0.5, 0.75, 1], tickFormat: pct },
        series: [{ label: 'vC / V₀ = e^(−t/τ)', expr: 'exp(-x)', role: 'signal', labelAt: 5, labelDy: -12 }],
        points: [
          { x: Math.LN2, y: 0.5, label: 'half-life 0.693τ: 50%', dx: 8, dy: -8 },
          { x: 1, y: Math.exp(-1), label: '1τ: 36.8%', dx: 12, dy: 4 },
        ],
      },
      mode,
    ),

  'lowpass-circuit': (mode) => {
    const pal = palette(mode);
    const W = 380;
    const H = 190;
    const T = 50;
    const B = 150;
    const L = 50;
    const N = 230;
    const O = 330;
    const parts = [
      terminal(pal, L, T),
      terminal(pal, L, B),
      resistorH(pal, L + 4, N, T, 'R'),
      wire(pal, [[N, T], [O - 4, T]]),
      terminal(pal, O, T),
      dot(pal, N, T),
      capacitorV(pal, N, T, B, 'C', 'left'),
      wire(pal, [[L + 4, B], [O - 4, B]]),
      terminal(pal, O, B),
      dot(pal, N, B),
      ground(pal, N, B + 8),
      wire(pal, [[N, B], [N, B + 8]]),
      text(L, T - 14, 'vᵢₙ (input)', { anchor: 'middle', fill: pal.role('signal'), size: 12, weight: 600 }),
      text(O, T - 14, 'vₒᵤₜ (output)', { anchor: 'middle', fill: pal.role('accent'), size: 12, weight: 600 }),
    ];
    return svgDoc(W, H, 'RC low-pass filter', 'Input through series resistor R; capacitor C from output node to ground; output across C.', parts.join('\n'), pal);
  },

  bode: (mode) => {
    // Try it: change R_OHMS or C_FARADS, run `npm run figures`, and the curve, the −3 dB point and its label move together.
    const R_OHMS = 1600;
    const C_FARADS = 100e-9;
    const fc = 1 / (2 * Math.PI * R_OHMS * C_FARADS);
    const fcLabel = fc >= 1000 ? `${(fc / 1000).toPrecision(3)} kHz` : `${Math.round(fc)} Hz`;
    return plot(
      {
        title: 'Bode magnitude plot of an RC low-pass filter',
        desc: `Gain in dB versus log frequency, fc ≈ ${fcLabel}, −3 dB at fc, −20 dB/decade asymptote.`,
        x: { label: 'Frequency, f (Hz, log scale)', from: 10, to: 100000, log: true, ticks: [10, 100, 1000, 10000, 100000], tickFormat: hz },
        y: { label: 'Gain (dB)', from: -52, to: 5, ticks: [0, -10, -20, -30, -40, -50] },
        series: [{ label: '', expr: '20 * log10(1 / sqrt(1 + (x / fc)^2))', vars: { fc }, role: 'signal', direct: false }],
        refLines: [
          { x1: 10, y1: 0, x2: fc, y2: 0 },
          { x1: fc, y1: 0, x2: 100000, y2: -20 * Math.log10(100000 / fc), label: 'asymptote: −20 dB per decade', labelX: 100000, labelY: -45 },
        ],
        points: [{ x: fc, y: -3.01, label: `fc ≈ ${fcLabel}: −3 dB`, dx: 8, dy: -10 }],
      },
      mode,
    );
  },

  'cutoff-shift': (mode) => {
    const fcOf = (c: number) => 1 / (2 * Math.PI * 1600 * c);
    return plot(
      {
        title: 'Effect of the capacitor on cutoff frequency',
        desc: 'Gain curves for C = 10 nF, 100 nF, 1 µF with R = 1.6 kΩ; cutoffs ≈ 9.9 kHz, 995 Hz, 99 Hz.',
        x: { label: 'Frequency, f (Hz, log scale)', from: 10, to: 100000, log: true, ticks: [10, 100, 1000, 10000, 100000], tickFormat: hz },
        y: { label: 'Gain (dB)', from: -64, to: 14, ticks: [0, -20, -40, -60] },
        series: [
          { label: 'C = 1 µF', expr: '20 * log10(1 / sqrt(1 + (x / fc)^2))', vars: { fc: fcOf(1e-6) }, role: seriesOrder[0], direct: false },
          { label: 'C = 100 nF', expr: '20 * log10(1 / sqrt(1 + (x / fc)^2))', vars: { fc: fcOf(100e-9) }, role: seriesOrder[1], direct: false },
          { label: 'C = 10 nF', expr: '20 * log10(1 / sqrt(1 + (x / fc)^2))', vars: { fc: fcOf(10e-9) }, role: seriesOrder[2], direct: false },
        ],
        points: [
          { x: fcOf(1e-6), y: -3.01, label: '99 Hz', dx: 0, dy: 24, guides: false },
          { x: fcOf(100e-9), y: -3.01, label: '995 Hz', dx: 0, dy: 24, guides: false },
          { x: fcOf(10e-9), y: -3.01, label: '9.9 kHz', dx: 0, dy: 24, guides: false },
        ],
      },
      mode,
    );
  },
};

export function drawAll(dir = out): string[] {
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, draw] of Object.entries(figures)) {
    for (const mode of ['light', 'dark'] as const) {
      const file = join(dir, mode === 'light' ? `${name}.svg` : `${name}.dark.svg`);
      writeFileSync(file, draw(mode));
      written.push(file);
    }
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = drawAll();
  console.log(`Drew ${files.length} figure files in ${out}`);
}

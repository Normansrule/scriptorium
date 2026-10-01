/**
 * Figures and the DNA model for the biology sample book.
 *
 * The DNA model is built from the dimensions the cited textbook gives (OpenStax
 * Biology 2e, §14.2): 0.34 nm between base pairs, 3.4 nm per turn (10 base pairs), and a
 * 2 nm diameter. Rise, turn and diameter are to scale; the bases are drawn as single
 * beads and the two backbones sit opposite each other, so the major and minor grooves of
 * real DNA are not shown (the caption says so). tests/equations/test_biology.py re-measures
 * the model.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plot } from '../../src/render/svg.ts';
import { renderMoleculeSvg, STILL } from '../../src/render/molecule-svg.ts';
import type { Atom, Model } from '../../src/core/molecule.ts';
import type { Mode } from '../../src/core/style.ts';

const here = dirname(fileURLToPath(import.meta.url));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

export const DNA = { risePerBp: 0.34, bpPerTurn: 10, diameter: 2.0 } as const;
const SEQUENCE = 'ATGCGTACCA'; // 10 bp = one full turn
const PAIR: Record<string, string> = { A: 'T', T: 'A', G: 'C', C: 'G' };

/** Backbone beads (el P, phosphate) on a 1 nm radius helix; base beads (el N) halfway in. */
export function dnaModel(): Model {
  const atoms: Atom[] = [];
  const bonds: Array<[number, number]> = [];
  const R = DNA.diameter / 2;
  const rb = 0.45;
  SEQUENCE.split('').forEach((base, i) => {
    const th = (2 * Math.PI * i) / DNA.bpPerTurn;
    const zc = r4(i * DNA.risePerBp - ((SEQUENCE.length - 1) * DNA.risePerBp) / 2);
    const c = Math.cos(th), s = Math.sin(th);
    const k = atoms.length;
    atoms.push({ el: 'P', x: r4(R * c), y: zc, z: r4(R * s) }); // strand 1 backbone
    atoms.push({ el: 'N', x: r4(rb * c), y: zc, z: r4(rb * s), label: base }); // base on strand 1
    atoms.push({ el: 'N', x: r4(-rb * c), y: zc, z: r4(-rb * s), label: PAIR[base]! }); // paired base
    atoms.push({ el: 'P', x: r4(-R * c), y: zc, z: r4(-R * s) }); // strand 2 backbone
    bonds.push([k, k + 1], [k + 1, k + 2], [k + 2, k + 3]);
    if (i > 0) bonds.push([k - 4, k], [k - 1, k + 3]); // backbones run along each strand
  });
  return { title: 'B-DNA, schematic (10 base pairs, one turn)', unit: 'nm', atoms, bonds };
}

/** Smaller beads so the two backbones read as ribbons; the book's model3d block uses the same value. */
export const ATOM_SCALE = 0.6;

const VIEWS = [
  { label: 'side', yaw: 0, pitch: 0 },
  { label: 'down the axis', yaw: 0, pitch: -90 },
  { label: 'angled', yaw: 30, pitch: -25 },
];

const plots: Record<string, (mode: Mode) => string> = {
  'sa-volume': (mode) =>
    plot(
      {
        title: 'Surface area to volume ratio of a spherical cell',
        desc: 'SA/V = 3/r for radius 0.5 to 20 micrometres on log axes; marked points at r = 1 µm (3 per µm) and r = 10 µm (0.3 per µm).',
        x: { label: 'Cell radius, r (µm, log scale)', from: 0.5, to: 20, log: true, ticks: [1, 10], tickFormat: (v) => `${v}` },
        y: { label: 'Surface area ÷ volume (per µm)', from: 0, to: 6.5, ticks: [0, 1, 2, 3, 4, 5, 6] },
        series: [{ label: 'SA/V = 3/r', expr: '3 / x', role: 'signal', labelAt: 0.7, labelDy: -14 }],
        points: [
          { x: 1, y: 3, label: 'r = 1 µm (prokaryote-sized): 3 per µm', dx: 10, dy: -6 },
          { x: 10, y: 0.3, label: 'r = 10 µm (eukaryote-sized): 0.3 per µm', dx: -10, dy: -60, anchor: 'end' },
        ],
      },
      mode,
    ),
};

/** Writes models/*.json and figures/*.svg under <root>; returns the paths relative to <root>. */
export function drawAll(root = here): string[] {
  mkdirSync(join(root, 'figures'), { recursive: true });
  mkdirSync(join(root, 'models'), { recursive: true });
  const written: string[] = [];
  const put = (rel: string, content: string) => {
    writeFileSync(join(root, rel), content);
    written.push(rel);
  };
  const dna = dnaModel();
  put('models/dna.json', JSON.stringify(dna, null, 1) + '\n');
  for (const v of VIEWS) {
    const slug = v.label.replace(/\s+/g, '-');
    for (const mode of ['light', 'dark'] as const) put(`figures/dna-${slug}${mode === 'dark' ? '.dark' : ''}.svg`, renderMoleculeSvg(dna, v, { ...STILL, mode, scale: 'to-scale', atomScale: ATOM_SCALE, title: `DNA double helix, ${v.label} view` }));
  }
  for (const [name, draw] of Object.entries(plots)) for (const mode of ['light', 'dark'] as const) put(`figures/${name}${mode === 'dark' ? '.dark' : ''}.svg`, draw(mode));
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Wrote ${drawAll().length} files under ${here}`);

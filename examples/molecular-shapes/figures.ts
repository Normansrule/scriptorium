/**
 * Figures and 3D models for the chemistry sample book.
 *
 * The two shape models are built from the bond angles the cited textbook gives
 * (OpenStax Chemistry 2e, §7.6: water 104.5°, methane 109.5°). Bond lengths are drawn
 * equal (1 unit) because the book only teaches shape here, and every view says
 * "bond lengths not to scale". tests/equations/test_chemistry.py re-measures the angles
 * from the generated model files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrow, palette, plot, svgDoc, text } from '../../src/render/svg.ts';
import { renderMoleculeSvg, STILL, type Annotation } from '../../src/render/molecule-svg.ts';
import type { Model } from '../../src/core/molecule.ts';
import type { Mode } from '../../src/core/style.ts';

const here = dirname(fileURLToPath(import.meta.url));
const deg = Math.PI / 180;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
const sup10 = (e: number) => (e === 0 ? '1' : `10${String(e).split('').map((c) => SUP[c] ?? c).join('')}`);

/** Water: O at the origin, both H in the x–y plane, H–O–H = 104.5°. */
function water(): Model {
  const half = (104.5 / 2) * deg;
  return {
    title: 'Water (H2O), bent',
    unit: 'Å',
    atoms: [
      { el: 'O', x: 0, y: 0, z: 0 },
      { el: 'H', x: r6(Math.sin(half)), y: r6(-Math.cos(half)), z: 0 },
      { el: 'H', x: r6(-Math.sin(half)), y: r6(-Math.cos(half)), z: 0 },
    ],
    bonds: [
      [0, 1],
      [0, 2],
    ],
  };
}

/** Methane: C at the origin, H toward alternate corners of a cube (a regular tetrahedron). */
function methane(): Model {
  const k = 1 / Math.sqrt(3);
  const corners = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ];
  return {
    title: 'Methane (CH4), tetrahedral',
    unit: 'Å',
    atoms: [{ el: 'C', x: 0, y: 0, z: 0 }, ...corners.map(([x, y, z]) => ({ el: 'H', x: r6(x! * k), y: r6(y! * k), z: r6(z! * k) }))],
    bonds: [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ],
  };
}

export const MODELS: Record<string, { model: Model; views: Array<{ label: string; yaw: number; pitch: number }>; annotations: Annotation[] }> = {
  water: {
    model: water(),
    views: [
      { label: 'front', yaw: 0, pitch: 0 },
      { label: 'side', yaw: 90, pitch: 0 },
      { label: 'angled', yaw: 35, pitch: -30 },
    ],
    annotations: [{ type: 'angle', atoms: [1, 0, 2], label: '104.5°' }],
  },
  methane: {
    model: methane(),
    views: [
      // pitch −45° puts the plane of atoms H1, C, H2 face-on, so the 109.5° arc is true to size
      { label: 'front', yaw: 0, pitch: -45 },
      { label: 'side', yaw: 90, pitch: 0 },
      { label: 'angled', yaw: 30, pitch: -20 },
    ],
    annotations: [{ type: 'angle', atoms: [1, 0, 2], label: '109.5°' }],
  },
};

/**
 * Four electron groups around a central atom, two ways: flat (a square, 90° between neighbours)
 * and in 3D (a tetrahedron, 109.5°, Eq. (eq-tetrahedral)). The tetrahedron is drawn in the usual
 * wedge-and-dash perspective: solid wedges come towards the reader, dashed ones go away.
 */
function electronGroups(mode: Mode): string {
  const pal = palette(mode);
  const W = 432;
  const H = 210;
  const parts: string[] = [];
  const lobe = (x1: number, y1: number, x2: number, y2: number, style: 'line' | 'wedge' | 'dash') => {
    if (style === 'line') return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${pal.ink}" stroke-width="3" stroke-linecap="round"/>`;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    const nx = (-dy / L) * 5;
    const ny = (dx / L) * 5;
    if (style === 'wedge') return `<path d="M${x1},${y1} L${x2 + nx},${y2 + ny} L${x2 - nx},${y2 - ny} Z" fill="${pal.ink}"/>`;
    const out: string[] = [];
    for (let k = 1; k <= 6; k++) {
      const t = k / 6.5;
      const w = t;
      out.push(`<line x1="${x1 + dx * t + nx * w}" y1="${y1 + dy * t + ny * w}" x2="${x1 + dx * t - nx * w}" y2="${y1 + dy * t - ny * w}" stroke="${pal.ink}" stroke-width="1.6"/>`);
    }
    return out.join('');
  };
  const atom = (x: number, y: number, r: number, f: string, label: string) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" stroke="${pal.ink}" stroke-width="1.2"/>` + text(x, y + 4, label, { anchor: 'middle', fill: mode === 'light' && f !== '#555' ? pal.ink : '#fff', size: 11, weight: 600 });
  const C = '#555';
  const Hc = mode === 'light' ? '#f4f4f4' : '#d8d8d8';
  // left: flat square
  const ax = 108;
  const ay = 100;
  const d = 52;
  for (const [x, y] of [[ax - d, ay], [ax + d, ay], [ax, ay - d], [ax, ay + d]] as const) {
    parts.push(lobe(ax, ay, x, y, 'line'));
    parts.push(atom(x, y, 11, Hc, 'H'));
  }
  parts.push(atom(ax, ay, 15, C, 'C'));
  parts.push(`<path d="M${ax + 18},${ay} A18,18 0 0 0 ${ax},${ay - 18}" fill="none" stroke="${pal.role('accent')}" stroke-width="2"/>`);
  parts.push(text(ax + 22, ay - 20, '90°', { fill: pal.role('accent'), size: 12, weight: 600 }));
  parts.push(text(ax, 186, 'Flat square: 90° apart', { anchor: 'middle', fill: pal.ink, size: 12, weight: 600 }));
  parts.push(text(ax, 201, 'groups crowd each other', { anchor: 'middle', fill: pal.muted, size: 11 }));
  // right: tetrahedron (wedge-and-dash)
  const bx = 318;
  const by = 104;
  const tips: Array<[number, number, 'line' | 'wedge' | 'dash']> = [[bx, by - 62, 'line'], [bx - 56, by + 30, 'line'], [bx + 46, by + 42, 'wedge'], [bx + 58, by + 6, 'dash']];
  for (const [x, y, st] of tips) parts.push(lobe(bx, by, x, y, st));
  for (const [x, y] of tips) parts.push(atom(x, y, 11, Hc, 'H'));
  parts.push(atom(bx, by, 15, C, 'C'));
  parts.push(`<path d="M${bx},${by - 20} A20,20 0 0 0 ${bx - 18},${by + 10}" fill="none" stroke="${pal.role('signal')}" stroke-width="2"/>`);
  parts.push(text(bx - 30, by - 14, '109.5°', { anchor: 'end', fill: pal.role('signal'), size: 12, weight: 600 }));
  parts.push(text(bx, 186, 'Tetrahedron: 109.5° apart', { anchor: 'middle', fill: pal.ink, size: 12, weight: 600 }));
  parts.push(text(bx, 201, 'as far apart as 3D allows', { anchor: 'middle', fill: pal.muted, size: 11 }));
  parts.push(arrow(196, 100, 236, 100, pal.muted, 1.5));
  parts.push(text(W - 6, 14, 'wedge: towards you · dashes: away', { anchor: 'end', fill: pal.muted, size: 10 }));
  return svgDoc(W, H, 'Four electron groups spread out in 3D', 'Left: a central carbon with four bonds to hydrogen in a flat square, 90 degrees apart. Right: the same four bonds arranged as a tetrahedron, drawn with a wedge towards the reader and dashes away from the reader, 109.5 degrees apart.', parts.join('\n'), pal);
}

const plots: Record<string, (mode: Mode) => string> = {
  'electron-groups': electronGroups,
  dilution: (mode) =>
    plot(
      {
        title: 'Dilution: concentration falls as volume grows',
        desc: 'C2 = n / V2 with n = 0.100 mol of solute, V2 from 0.05 to 0.50 L; marked point at 0.200 L and 0.500 M.',
        x: { label: 'Final volume, V₂ (L)', from: 0.05, to: 0.5, ticks: [0.1, 0.2, 0.3, 0.4, 0.5] },
        y: { label: 'Concentration, C₂ (mol/L)', from: 0, to: 2.2, ticks: [0, 0.5, 1, 1.5, 2] },
        series: [{ label: 'C₂ = 0.100 mol / V₂', expr: '0.1 / x', role: 'signal', labelAt: 0.5, labelDy: -14 }],
        points: [
          { x: 0.05, y: 2, label: 'start: 50.0 mL at 2.00 M', dx: 10, dy: 4, guides: false },
          { x: 0.2, y: 0.5, label: 'diluted to 200 mL: 0.500 M', dx: 8, dy: -12 },
        ],
      },
      mode,
    ),
  ph: (mode) =>
    plot(
      {
        title: 'pH is a logarithmic scale',
        desc: 'pH = −log10[H3O+] for hydronium concentrations from 1e-14 to 1 mol/L; marked points at 1e-7 (pH 7) and 1e-3 (pH 3).',
        x: { label: 'Hydronium concentration, [H₃O⁺] (mol/L, log scale)', from: 1e-14, to: 1, log: true, ticks: [1e-14, 1e-12, 1e-10, 1e-8, 1e-6, 1e-4, 1e-2, 1], tickFormat: (v) => sup10(Math.round(Math.log10(v))) },
        y: { label: 'pH', from: 0, to: 14, ticks: [0, 2, 4, 6, 8, 10, 12, 14] },
        series: [{ label: 'pH = −log₁₀[H₃O⁺]', expr: '-log10(x)', role: 'signal', direct: false }],
        points: [
          { x: 1e-7, y: 7, label: 'pure water, 25 °C: pH 7.00', dx: 8, dy: -8 },
          { x: 1e-3, y: 3, label: '[H₃O⁺] = 10⁻³ M: pH 3.00', dx: -10, dy: 18, anchor: 'end' },
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
  for (const [name, m] of Object.entries(MODELS)) {
    put(`models/${name}.json`, JSON.stringify(m.model, null, 2) + '\n');
    for (const v of m.views) {
      for (const mode of ['light', 'dark'] as const) {
        put(`figures/${name}-${v.label}${mode === 'dark' ? '.dark' : ''}.svg`, renderMoleculeSvg(m.model, v, { ...STILL, mode, annotations: m.annotations, scale: 'schematic', scaleNote: 'lengths not to scale', title: `${m.model.title}, ${v.label} view` }));
      }
    }
  }
  for (const [name, draw] of Object.entries(plots)) for (const mode of ['light', 'dark'] as const) put(`figures/${name}${mode === 'dark' ? '.dark' : ''}.svg`, draw(mode));
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`Wrote ${drawAll().length} files under ${here}`);

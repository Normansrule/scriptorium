/**
 * Ball-and-stick rendering of a Model as SVG — one renderer for the print stills, the
 * EPUB stills, the web-book viewer and the app proof, so every edition shows the same
 * picture. Orthographic projection, painter's-algorithm depth sort, CPK element colors
 * (the textbook convention; see docs/STYLE.md), element labels on every atom large enough
 * to hold one, so color is never the only cue.
 */
import { contrast } from '../core/style.ts';
import { angleDeg, type Model } from '../core/molecule.ts';
import { esc, palette, svgDoc, text } from './svg.ts';
import type { Mode } from '../core/style.ts';

/** CPK colors as used by Jmol, adjusted only where a color would vanish against the page. */
const CPK: Record<string, string> = {
  H: '#FFFFFF', C: '#909090', N: '#3050F8', O: '#FF0D0D', F: '#90E050', Na: '#AB5CF2', Mg: '#8AFF00', P: '#FF8000',
  S: '#FFFF30', Cl: '#1FF01F', K: '#8F40D4', Ca: '#3DFF00', Fe: '#E06633', Zn: '#7D80B0', Br: '#A62929', I: '#940094',
};
/** Drawing radius per element as a fraction of the bond-scale unit (not physical radii). */
const DRAW_R: Record<string, number> = { H: 0.22, C: 0.32, N: 0.31, O: 0.3, P: 0.38, S: 0.38 };
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export interface Annotation {
  type: 'angle';
  /** atom indices i–j–k; the arc is drawn at j */
  atoms: [number, number, number];
  label: string;
}

export interface MoleculeView {
  /** rotation about the vertical axis, degrees */
  yaw: number;
  /** rotation about the horizontal axis, degrees */
  pitch: number;
  label?: string;
}

export interface RenderOptions {
  size?: number;
  mode?: Mode;
  title?: string;
  desc?: string;
  annotations?: Annotation[];
  /** 'to-scale' draws a scale bar; 'schematic' prints a "not to scale" note. */
  scale?: 'to-scale' | 'schematic';
  scaleNote?: string;
  /** Show the view label (e.g. "front") in the corner. */
  showViewLabel?: boolean;
  /** Atom drawing radius multiplier (smaller for big structures). */
  atomScale?: number;
  /**
   * Fixed size for every label, in SVG px. Print stills set this so text stays ≥ 8 pt
   * after the image is scaled into a three-across grid (STYLE.md print floor).
   */
  textPx?: number;
}

/** Settings for the small stills placed three across in print and EPUB: 150 px wide, 12 px text ≈ 8.3 pt in a 1.45-inch column. */
export const STILL = { size: 150, textPx: 12 } as const;

export interface Projected {
  sx: number;
  sy: number;
  depth: number;
}

export function project(model: Model, view: MoleculeView, size: number, pad = 0.14): { pts: Projected[]; scale: number; rot: Array<{ x: number; y: number; z: number }> } {
  const y = (view.yaw * Math.PI) / 180;
  const p = (view.pitch * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  const rot = model.atoms.map((a) => {
    const x1 = cy * a.x + sy * a.z;
    const z1 = -sy * a.x + cy * a.z;
    const y2 = cp * a.y - sp * z1;
    const z2 = sp * a.y + cp * z1;
    return { x: x1, y: y2, z: z2 };
  });
  const reach = Math.max(1e-9, ...model.atoms.map((a) => Math.hypot(a.x, a.y, a.z)));
  const scale = (size * (1 - 2 * pad)) / (2 * reach);
  return { pts: rot.map((r) => ({ sx: size / 2 + r.x * scale, sy: size / 2 - r.y * scale, depth: r.z })), scale, rot };
}

/** Typical bond length in the model's units (median), used to size atoms consistently. */
function bondUnit(model: Model): number {
  const ls = model.bonds.map(([i, j]) => {
    const a = model.atoms[i]!;
    const b = model.atoms[j]!;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  });
  if (!ls.length) return 1;
  ls.sort((a, b) => a - b);
  return ls[Math.floor(ls.length / 2)]!;
}

function labelColor(fill: string): string {
  return contrast(fill, '#1F2328') >= contrast(fill, '#FFFFFF') ? '#1F2328' : '#FFFFFF';
}

/** True when the plane through a–b–c faces the viewer to within `maxDeg`. */
export function faceOn(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, c: { x: number; y: number; z: number }, maxDeg = 5): boolean {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const len = Math.hypot(n[0]!, n[1]!, n[2]!);
  return len > 0 && Math.abs(n[2]!) / len >= Math.cos((maxDeg * Math.PI) / 180);
}

export function renderMoleculeSvg(model: Model, view: MoleculeView, opts: RenderOptions = {}): string {
  const size = opts.size ?? 240;
  const mode = opts.mode ?? 'light';
  const pal = palette(mode);
  const { pts, scale, rot } = project(model, view, size);
  const unit = bondUnit(model) * scale; // px per typical bond
  const atomScale = opts.atomScale ?? (model.atoms.length > 200 ? 0.5 : 1);
  type Item = { depth: number; svg: string };
  const items: Item[] = [];

  for (const b of model.bonds) {
    const [i, j] = b;
    const order = b[2] ?? 1;
    const A = pts[i]!;
    const B = pts[j]!;
    const dx = B.sx - A.sx, dy = B.sy - A.sy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = Math.max(2, unit * 0.09);
    const offsets = order === 1 ? [0] : order === 2 ? [-1, 1] : [-1.6, 0, 1.6];
    const lines = offsets
      .map((o) => {
        const ox = nx * o * w * 1.1, oy = ny * o * w * 1.1;
        return `<line x1="${(A.sx + ox).toFixed(1)}" y1="${(A.sy + oy).toFixed(1)}" x2="${(B.sx + ox).toFixed(1)}" y2="${(B.sy + oy).toFixed(1)}" stroke="${pal.muted}" stroke-width="${(order === 1 ? w : w * 0.7).toFixed(1)}" stroke-linecap="round"/>`;
      })
      .join('');
    items.push({ depth: (A.depth + B.depth) / 2 - 1e-6, svg: lines });
  }

  // Depth of the nearest bond touching each atom: an atom's label is drawn after its own
  // bonds (so a stick coming toward the viewer never hides the symbol) but before nearer atoms.
  const bondFront = model.atoms.map((_, k) => pts[k]!.depth);
  for (const [i, j] of model.bonds) {
    const avg = (pts[i]!.depth + pts[j]!.depth) / 2;
    bondFront[i] = Math.max(bondFront[i]!, avg);
    bondFront[j] = Math.max(bondFront[j]!, avg);
  }
  model.atoms.forEach((a, k) => {
    const P = pts[k]!;
    const fill = own(CPK, a.el) ? CPK[a.el]! : '#FF1493';
    const r = Math.max(2.5, unit * (own(DRAW_R, a.el) ? DRAW_R[a.el]! : 0.33) * atomScale);
    const outline = mode === 'light' ? '#1F2328' : '#0D1117';
    let s = `<circle cx="${P.sx.toFixed(1)}" cy="${P.sy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" stroke="${outline}" stroke-width="1.25"/>`;
    // a small highlight gives the eye a depth cue without hiding the flat fill
    s += `<circle cx="${(P.sx - r * 0.32).toFixed(1)}" cy="${(P.sy - r * 0.32).toFixed(1)}" r="${(r * 0.28).toFixed(1)}" fill="#FFFFFF" fill-opacity="0.45"/>`;
    items.push({ depth: P.depth, svg: s });
    const lab = a.label ?? a.el;
    if (r >= (opts.textPx ? opts.textPx * 0.55 : 7)) {
      const fs = opts.textPx ?? Math.min(13, Math.max(9, r * 0.85));
      const t = text(P.sx, P.sy + fs * 0.36, lab, { anchor: 'middle', size: fs, weight: 700, fill: labelColor(fill) });
      items.push({ depth: bondFront[k]! + 1e-6, svg: `<g>${`<circle cx="${P.sx.toFixed(1)}" cy="${P.sy.toFixed(1)}" r="${(r * 0.62).toFixed(1)}" fill="${fill}"/>`}${t}</g>` });
    }
  });

  items.sort((a, b) => a.depth - b.depth); // far first
  const parts = items.map((i) => i.svg);

  for (const an of opts.annotations ?? []) {
    const [i, j, k] = an.atoms;
    const A = pts[i]!, B = pts[j]!, C = pts[k]!;
    // Label an angle only in views that show its plane face-on (normal within 5° of the line of
    // sight); in any other view the arc would be foreshortened and the label would lie.
    if (!faceOn(rot[i]!, rot[j]!, rot[k]!)) continue;
    const a1 = Math.atan2(A.sy - B.sy, A.sx - B.sx);
    let a2 = Math.atan2(C.sy - B.sy, C.sx - B.sx);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    a2 = a1 + d;
    const R = unit * 0.55;
    const x1 = B.sx + R * Math.cos(a1), y1 = B.sy + R * Math.sin(a1);
    const x2 = B.sx + R * Math.cos(a2), y2 = B.sy + R * Math.sin(a2);
    parts.push(`<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${R.toFixed(1)},${R.toFixed(1)} 0 0 ${d > 0 ? 1 : 0} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="none" stroke="${pal.role('accent')}" stroke-width="2"/>`);
    const mid = a1 + d / 2;
    const lx = B.sx + (R + 16) * Math.cos(mid), ly = B.sy + (R + 16) * Math.sin(mid);
    const fs = opts.textPx ?? 12;
    parts.push(`<rect x="${(lx - fs * 1.9).toFixed(1)}" y="${(ly - fs * 0.85).toFixed(1)}" width="${(fs * 3.8).toFixed(1)}" height="${(fs * 1.4).toFixed(1)}" rx="4" fill="${pal.paper}" fill-opacity="0.85"/>`);
    parts.push(text(lx, ly + fs * 0.3, an.label, { anchor: 'middle', size: fs, weight: 600, fill: pal.role('accent') }));
  }

  const small = opts.textPx ?? 11;
  if (opts.showViewLabel && view.label) parts.push(text(8, 16, view.label, { size: small, fill: pal.muted }));
  if (opts.scale === 'to-scale') {
    const nice = [0.5, 1, 2, 5, 10].find((v) => v * scale >= size * 0.15) ?? 1;
    const L = nice * scale;
    parts.push(`<line x1="10" y1="${size - 12}" x2="${(10 + L).toFixed(1)}" y2="${size - 12}" stroke="${pal.ink}" stroke-width="2"/><line x1="10" y1="${size - 16}" x2="10" y2="${size - 8}" stroke="${pal.ink}" stroke-width="1.5"/><line x1="${(10 + L).toFixed(1)}" y1="${size - 16}" x2="${(10 + L).toFixed(1)}" y2="${size - 8}" stroke="${pal.ink}" stroke-width="1.5"/>`);
    parts.push(text(10 + L / 2, size - 18, `${nice} ${model.unit}`, { anchor: 'middle', size: small, fill: pal.ink }));
  } else if (opts.scale === 'schematic') {
    parts.push(text(size - 6, size - 6, opts.scaleNote ?? 'not to scale', { anchor: 'end', size: small, fill: pal.muted }));
  }
  return svgDoc(size, size, opts.title ?? model.title ?? '3D model', opts.desc ?? `${model.atoms.length} atoms`, parts.join('\n'), pal);
}

/** Plain-text legend of the elements present, e.g. "O oxygen (red), H hydrogen (white)". */
export function elementLegend(model: Model): string {
  const names: Record<string, string> = { H: 'hydrogen (white)', C: 'carbon (gray)', N: 'nitrogen (blue)', O: 'oxygen (red)', P: 'phosphorus (orange)', S: 'sulfur (yellow)' };
  return [...new Set(model.atoms.map((a) => a.el))].map((e) => `${e} ${own(names, e) ? names[e] : e}`).join(', ');
}

export { esc };

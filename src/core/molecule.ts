/**
 * Molecules and other 3D structures for `model3d` blocks.
 *
 * A model is a list of atoms (element + x, y, z in ångström, or any length unit the
 * model declares) and a list of bonds. It can be read from XYZ, PDB (ATOM/HETATM +
 * CONECT) or SDF/MOL V2000 text — the formats PubChem and the Protein Data Bank serve —
 * or written directly as JSON. Everything here is pure data processing: no rendering,
 * no network, no eval, so it runs in Node, the web app and the web book viewer.
 */
import { z } from 'zod';

export const Atom = z.object({
  el: z.string().regex(/^[A-Z][a-z]?$/),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  /** Optional text shown instead of the element symbol (e.g. "P" for a backbone bead). */
  label: z.string().max(6).optional(),
});
export type Atom = z.infer<typeof Atom>;

export const Model = z.object({
  title: z.string().optional(),
  /** Unit of the coordinates, shown in the viewer's scale note. */
  unit: z.enum(['Å', 'nm']).default('Å'),
  atoms: z.array(Atom).min(1).max(20000),
  /** Pairs of atom indices; a third number is the bond order (1, 2 or 3). */
  bonds: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)]).or(z.tuple([z.number().int().min(0), z.number().int().min(0), z.number().int().min(1).max(3)]))).default([]),
});
export type Model = z.infer<typeof Model>;

/**
 * Approximate single-bond covalent radii in ångström, used only to *guess* bonds when a
 * file carries none (XYZ, PDB without CONECT). Two atoms are bonded when their distance is
 * below rA + rB + 0.45 Å. The guess is checked against expected bonds in the tests.
 */
const RADIUS: Record<string, number> = { H: 0.31, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Na: 1.66, Mg: 1.41, P: 1.07, S: 1.05, Cl: 1.02, K: 2.03, Ca: 1.76, Fe: 1.32, Zn: 1.22, Br: 1.2, I: 1.39 };
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function distance(a: Atom, b: Atom): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Angle A–B–C at atom B, in degrees. */
export function angleDeg(a: Atom, b: Atom, c: Atom): number {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  return (Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...u) * Math.hypot(...v))))) * 180) / Math.PI;
}

export function inferBonds(atoms: Atom[], tolerance = 0.45): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (atoms.length > 4000) return out; // O(n²); large structures must bring their own bonds
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i]!;
      const b = atoms[j]!;
      const ra = own(RADIUS, a.el) ? RADIUS[a.el]! : 0.8;
      const rb = own(RADIUS, b.el) ? RADIUS[b.el]! : 0.8;
      const d = distance(a, b);
      if (d > 0.4 && d < ra + rb + tolerance) out.push([i, j]);
    }
  }
  return out;
}

function normEl(s: string): string {
  const t = s.trim().replace(/[^A-Za-z]/g, '');
  if (!t) throw new Error(`Bad element symbol "${s}".`);
  return t[0]!.toUpperCase() + (t[1] ?? '').toLowerCase();
}

/** XYZ: line 1 = atom count, line 2 = comment, then "El x y z" per atom. */
export function parseXyz(text: string): Model {
  const lines = text.replace(/\r/g, '').split('\n');
  const n = Number(lines[0]?.trim());
  if (!Number.isInteger(n) || n < 1) throw new Error('XYZ: first line must be the atom count.');
  const atoms: Atom[] = [];
  for (let i = 0; i < n; i++) {
    const f = (lines[i + 2] ?? '').trim().split(/\s+/);
    if (f.length < 4) throw new Error(`XYZ: atom line ${i + 3} is incomplete.`);
    atoms.push({ el: normEl(f[0]!), x: Number(f[1]), y: Number(f[2]), z: Number(f[3]) });
  }
  if (atoms.some((a) => ![a.x, a.y, a.z].every(Number.isFinite))) throw new Error('XYZ: coordinates must be numbers.');
  return Model.parse({ title: lines[1]?.trim() || undefined, atoms, bonds: inferBonds(atoms) });
}

/** PDB: ATOM/HETATM records (fixed columns) and optional CONECT records. */
export function parsePdb(text: string): Model {
  const atoms: Atom[] = [];
  const serialToIndex = new Map<number, number>();
  const bonds = new Set<string>();
  let title: string | undefined;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const rec = raw.slice(0, 6).trim();
    if (rec === 'TITLE' && !title) title = raw.slice(10).trim();
    if (rec === 'ATOM' || rec === 'HETATM') {
      const serial = Number(raw.slice(6, 11));
      const el = raw.slice(76, 78).trim() || raw.slice(12, 16).trim().replace(/^\d+/, '').slice(0, 1);
      const a = { el: normEl(el), x: Number(raw.slice(30, 38)), y: Number(raw.slice(38, 46)), z: Number(raw.slice(46, 54)) };
      if (![a.x, a.y, a.z].every(Number.isFinite)) throw new Error(`PDB: bad coordinates in "${raw.slice(0, 30)}".`);
      serialToIndex.set(serial, atoms.length);
      atoms.push(a);
    }
    if (rec === 'CONECT') {
      const ids = (raw.slice(6).match(/.{1,5}/g) ?? []).map((s) => Number(s)).filter((v) => Number.isInteger(v) && v > 0);
      const [from, ...to] = ids;
      for (const t of to) {
        const i = serialToIndex.get(from!);
        const j = serialToIndex.get(t);
        if (i !== undefined && j !== undefined && i !== j) bonds.add(i < j ? `${i}-${j}` : `${j}-${i}`);
      }
    }
  }
  if (!atoms.length) throw new Error('PDB: no ATOM or HETATM records.');
  const bondList: Array<[number, number]> = bonds.size ? [...bonds].map((k) => k.split('-').map(Number) as [number, number]) : inferBonds(atoms);
  return Model.parse({ title, atoms, bonds: bondList });
}

/** SDF / MOL V2000 (the format PubChem returns for 3D conformers). Only the first record is read. */
export function parseSdf(text: string): Model {
  const lines = text.replace(/\r/g, '').split('\n');
  const counts = lines[3] ?? '';
  if (!/V2000/.test(counts)) throw new Error('SDF: only V2000 molfiles are supported.');
  const na = Number(counts.slice(0, 3));
  const nb = Number(counts.slice(3, 6));
  const atoms: Atom[] = [];
  for (let i = 0; i < na; i++) {
    const l = lines[4 + i] ?? '';
    atoms.push({ x: Number(l.slice(0, 10)), y: Number(l.slice(10, 20)), z: Number(l.slice(20, 30)), el: normEl(l.slice(31, 34)) });
  }
  const bonds: Array<[number, number, number]> = [];
  for (let i = 0; i < nb; i++) {
    const l = lines[4 + na + i] ?? '';
    const a = Number(l.slice(0, 3)) - 1;
    const b = Number(l.slice(3, 6)) - 1;
    const order = Math.min(3, Math.max(1, Number(l.slice(6, 9)) || 1));
    if (a >= 0 && b >= 0 && a < na && b < na) bonds.push([a, b, order]);
  }
  return Model.parse({ title: lines[0]?.trim() || undefined, atoms, bonds });
}

export function parseModel(text: string, format: 'xyz' | 'pdb' | 'sdf' | 'json'): Model {
  if (text.length > 5_000_000) throw new Error('Model file is larger than 5 MB.');
  switch (format) {
    case 'xyz':
      return parseXyz(text);
    case 'pdb':
      return parsePdb(text);
    case 'sdf':
      return parseSdf(text);
    case 'json':
      return Model.parse(JSON.parse(text));
  }
}

export function formatFromPath(path: string): 'xyz' | 'pdb' | 'sdf' | 'json' {
  const ext = path.split('.').pop()!.toLowerCase();
  if (ext === 'xyz' || ext === 'pdb' || ext === 'json') return ext;
  if (ext === 'sdf' || ext === 'mol') return 'sdf';
  throw new Error(`Unsupported model format ".${ext}" (use .xyz, .pdb, .sdf, .mol or .json).`);
}

/** Move the model so its center of the atoms' bounding box is at the origin. */
export function centered(m: Model): Model {
  const ax = m.atoms.map((a) => a.x);
  const ay = m.atoms.map((a) => a.y);
  const az = m.atoms.map((a) => a.z);
  const c = [(Math.min(...ax) + Math.max(...ax)) / 2, (Math.min(...ay) + Math.max(...ay)) / 2, (Math.min(...az) + Math.max(...az)) / 2];
  return { ...m, atoms: m.atoms.map((a) => ({ ...a, x: a.x - c[0]!, y: a.y - c[1]!, z: a.z - c[2]! })) };
}

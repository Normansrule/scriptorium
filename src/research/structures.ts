/**
 * 3D structures from public databases, for model3d figures:
 *   PubChem (NCBI) 3D conformers of small molecules, as SDF, via PUG REST
 *     https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
 *   Protein Data Bank (RCSB PDB) entries, as PDB text
 *     https://www.rcsb.org/docs/programmatic-access/file-download-services
 *
 * Downloads are untrusted text: they are size-limited and parsed by the strict parsers in
 * src/core/molecule.ts — nothing in them is executed or rendered as markup.
 */
import { parsePdb, parseSdf, type Atom, type Model } from '../core/molecule.ts';
import type { ScholarlyOptions } from './scholarly.ts';

const MAX_BYTES = 5_000_000;

async function getText(f: typeof fetch, url: string): Promise<string> {
  let res: Response;
  try {
    res = await f(url);
  } catch (e) {
    throw new Error(`Could not reach ${new URL(url).host} (${(e as Error).message}).`);
  }
  if (res.status === 404) throw new Error(`Not found: ${url}`);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const t = await res.text();
  if (t.length > MAX_BYTES) throw new Error(`Structure file is larger than ${MAX_BYTES / 1e6} MB.`);
  return t;
}

export interface FetchedStructure {
  model: Model;
  /** Where the coordinates came from, for the figure's credit line. */
  credit: string;
  url: string;
}

/** 3D conformer of a compound by name (e.g. "caffeine") from PubChem. */
export async function fetchPubChem3D(name: string, opts: ScholarlyOptions = {}): Promise<FetchedStructure> {
  if (!/^[\w\s(),'+-]{1,80}$/.test(name)) throw new Error(`Refusing unusual compound name: ${name}`);
  const f = opts.fetchImpl ?? fetch;
  const base = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name';
  const cidBody = JSON.parse(await getText(f, `${base}/${encodeURIComponent(name)}/cids/JSON`)) as { IdentifierList?: { CID?: number[] } };
  const cid = cidBody.IdentifierList?.CID?.[0];
  if (!cid) throw new Error(`PubChem has no compound named "${name}".`);
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`;
  const model = parseSdf(await getText(f, url));
  return { model: { ...model, title: name }, credit: `3D conformer: PubChem CID ${cid}, National Center for Biotechnology Information (NCBI).`, url: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` };
}

/**
 * A protein or nucleic-acid entry reduced to its backbone trace: one bead per residue
 * (Cα for amino acids, P for nucleotides), joined along each chain when consecutive beads
 * are closer than `maxGap` Å. Thousands of atoms become a few hundred beads a reader can
 * follow, which is how textbooks draw a fold.
 */
export function backboneTrace(pdbText: string, maxGap = 4.2): Model {
  const beads: Array<Atom & { chain: string; res: number }> = [];
  for (const raw of pdbText.replace(/\r/g, '').split('\n')) {
    if (!raw.startsWith('ATOM')) continue;
    const name = raw.slice(12, 16).trim();
    if (name !== 'CA' && name !== 'P') continue;
    if (raw[16] && raw[16] !== ' ' && raw[16] !== 'A') continue; // first alternate location only
    beads.push({
      el: name === 'CA' ? 'C' : 'P',
      x: Number(raw.slice(30, 38)),
      y: Number(raw.slice(38, 46)),
      z: Number(raw.slice(46, 54)),
      chain: raw[21] ?? 'A',
      res: Number(raw.slice(22, 26)),
    });
  }
  if (!beads.length) return parsePdb(pdbText);
  const bonds: Array<[number, number]> = [];
  const gap = (a: Atom, b: Atom) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const limit = (a: (typeof beads)[number]) => (a.el === 'P' ? 8 : maxGap); // P–P along a strand is about 6–7 Å
  for (let i = 1; i < beads.length; i++) if (beads[i]!.chain === beads[i - 1]!.chain && gap(beads[i]!, beads[i - 1]!) < limit(beads[i]!)) bonds.push([i - 1, i]);
  return { unit: 'Å', atoms: beads.map(({ el, x, y, z }) => ({ el, x, y, z })), bonds };
}

/** A Protein Data Bank entry by its four-character ID, as a backbone trace. */
export async function fetchPdbEntry(id: string, opts: ScholarlyOptions = {}): Promise<FetchedStructure> {
  if (!/^[0-9][A-Za-z0-9]{3}$/.test(id)) throw new Error(`Not a PDB ID: ${id}`);
  const f = opts.fetchImpl ?? fetch;
  const url = `https://files.rcsb.org/download/${id.toUpperCase()}.pdb`;
  const model = backboneTrace(await getText(f, url));
  return { model: { ...model, title: `PDB ${id.toUpperCase()}` }, credit: `Coordinates: Protein Data Bank entry ${id.toUpperCase()} (RCSB PDB), backbone trace.`, url: `https://www.rcsb.org/structure/${id.toUpperCase()}` };
}

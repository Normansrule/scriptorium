/**
 * Scene kits: ready-made 3D scenes the converter can propose for a figure. Each kit is a set of
 * named parts (so labels, cutaway, explode and X-ray work on it) plus an optional process
 * animation. The geometry lives with the viewer (web/src/edition3d/kits/); this catalog is what the
 * converter and the docs need to know about each one.
 *
 * Kits draw *schematic* structure (which part is where, what moves), never measured dimensions:
 * the book's text and its references carry the numbers.
 */
export interface KitInfo {
  id: string;
  title: string;
  /** what the scene shows, for the plan and the viewer's About panel */
  shows: string;
  /** words in a figure's alt text or caption that suggest this kit (whole words, lowercase) */
  keywords: string[];
  /** words that rule it out (e.g. a circuit symbol is not a device cross-section) */
  notWhen?: string[];
  /** what the animation timeline plays, if any */
  animation?: string;
}

export const KITS: KitInfo[] = [
  {
    id: 'mosfet',
    title: 'MOSFET (n-channel, cross-section)',
    shows: 'Source, drain, gate, gate oxide and p-type body as separate parts; the inversion channel and electron flow as the gate voltage rises past threshold.',
    keywords: ['mosfet', 'transistor', 'nmos', 'pmos', 'gate oxide', 'inversion layer', 'channel', 'field-effect', 'cmos'],
    notWhen: ['symbol', 'schematic symbol', 'circuit diagram', 'truth table'],
    animation: 'Gate voltage sweeps from 0 past threshold: the channel forms, then electrons drift from source to drain.',
  },
];

export const kitById = (id: string): KitInfo | undefined => KITS.find((k) => k.id === id);

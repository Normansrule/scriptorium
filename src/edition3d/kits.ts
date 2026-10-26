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
  /** the scene's main colours, for gallery cards (decoration only; the title carries the meaning) */
  swatch: string[];
  /** values another part of the book can drive (an explorable's `drives` links), with the range the scene draws */
  inputs?: Array<{ name: string; label: string; unit: string; min: number; max: number }>;
}

export const KITS: KitInfo[] = [
  {
    id: 'mosfet',
    title: 'MOSFET (n-channel, cross-section)',
    shows: 'Source, drain, gate, gate oxide and p-type body as separate parts; the inversion channel and electron flow as the gate voltage rises past threshold.',
    keywords: ['mosfet', 'transistor', 'nmos', 'pmos', 'gate oxide', 'inversion layer', 'channel', 'field-effect', 'cmos'],
    notWhen: ['symbol', 'schematic symbol', 'circuit diagram', 'truth table'],
    animation: 'Gate voltage sweeps from 0 past threshold: the channel forms, then electrons drift from source to drain.',
    swatch: ['#c3c9d1', '#0072b2', '#d55e00', '#009e73'],
  },
  {
    id: 'capacitor',
    title: 'Parallel-plate capacitor',
    shows: 'Two plates, the dielectric between them, the charge on each plate and the electric field lines across the gap.',
    keywords: ['parallel-plate', 'parallel plate', 'plates', 'dielectric', 'electric field', 'capacitance', 'plate area'],
    notWhen: ['symbol', 'circuit diagram', 'truth table'],
    animation: 'Charging through a resistor: charge and field grow as q = Q(1 − e^(−t/τ)), from 0 to 5 τ.',
    swatch: ['#c3c9d1', '#f0e442', '#d55e00', '#0072b2'],
    inputs: [{ name: 'tau', label: 'Time constant τ', unit: 's', min: 0.01, max: 1000 }],
  },
  {
    id: 'rc-loop',
    title: 'RC charging circuit (real parts)',
    shows: 'Battery, switch, colour-coded resistor and electrolytic capacitor wired in a loop, with the moving charge and bars for capacitor voltage and current.',
    keywords: ['rc circuit', 'charging', 'time constant', 'resistor', 'capacitor', 'switch', 'battery', 'discharging'],
    notWhen: ['low-pass', 'filter', 'input voltage', 'frequency response', 'bode'],
    animation: 'The switch closes: the current falls as e^(−t/τ) (the charge slows) while the capacitor voltage rises to the supply voltage, from 0 to 5 τ.',
    swatch: ['#25313f', '#c77a4a', '#56b4e9', '#d55e00'],
    inputs: [{ name: 'tau', label: 'Time constant τ', unit: 's', min: 0.01, max: 1000 }],
  },
  {
    id: 'vessel',
    title: 'Blood vessel (flow and radius)',
    shows: 'The vessel wall and inner lining (the front half as glass), red blood cells, and the flow-speed profile across the vessel.',
    keywords: ['vessel', 'blood vessel', 'radius', 'resistance', 'blood', 'artery', 'arteriole', 'flow', 'poiseuille', 'lumen'],
    notWhen: ['heart chamber', 'valve', 'ecg', 'electrocardiogram'],
    animation: 'The vessel narrows to half its radius and back: resistance rises as 1/r⁴, flow falls as r⁴ and the cells slow as r².',
    swatch: ['#c0645a', '#f2c4b8', '#b3202a', '#0072b2'],
    inputs: [{ name: 'radius', label: 'Radius (× the original)', unit: '', min: 0.4, max: 1.5 }],
  },
  {
    id: 'cell',
    title: 'Cell size (surface and volume)',
    shows: 'A reference cell of radius 1 µm beside one that grows to 4 µm: membrane with transport proteins, cytoplasm and nucleus, and supplies crossing the membrane.',
    keywords: ['cell', 'cells', 'spherical', 'sphere', 'membrane', 'surface area', 'volume', 'radius'],
    notWhen: ['dna', 'helix', 'protein structure'],
    animation: 'The cell grows from 1 to 4 µm: membrane ×16, volume ×64, so the membrane per cubic micrometre falls to a quarter (3/r) and the cytoplasm pales.',
    swatch: ['#c0645a', '#f6c9bb', '#009e73', '#f0e442'],
    inputs: [{ name: 'radius', label: 'Cell radius', unit: 'µm', min: 1, max: 4 }],
  },
  {
    id: 'vsepr',
    title: 'Electron groups (VSEPR)',
    shows: 'Four electron groups around a central atom, each a lobe with a hydrogen at its tip.',
    keywords: ['electron group', 'electron groups', 'tetrahedron', 'tetrahedral', 'vsepr', 'lone pair', 'lone pairs', 'bond angle', 'central atom'],
    notWhen: ['orbital diagram', 'energy level'],
    animation: 'The groups spread from a flat square (90°) to a tetrahedron (109.5°); then two become lone pairs and the bond angle closes towards the measured 104.5° of water.',
    swatch: ['#4a4f57', '#0072b2', '#d55e00', '#f4f4f4'],
  },
];

export const kitById = (id: string): KitInfo | undefined => KITS.find((k) => k.id === id);

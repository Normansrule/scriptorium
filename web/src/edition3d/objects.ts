/**
 * What a figure becomes when it leaves the page. Every kind exposes the same small interface so
 * the controls (rotate, cut away, explode, X-ray, labels, timeline) work the same on all of them
 * and simply hide what a kind does not support.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Model } from '../../../src/core/molecule.ts';
import { CPK, DRAW_R } from '../../../src/render/molecule-svg.ts';

export interface Label {
  text: string;
  /** anchor in the part's local space (or the object's, when there is no part) */
  at: THREE.Vector3;
  /** part it belongs to (the label follows it when the model explodes) */
  part?: THREE.Object3D;
}

export interface Abilities {
  cutaway: boolean;
  explode: boolean;
  xray: boolean;
  animate: boolean;
  labels: boolean;
}

export interface FigureObject {
  group: THREE.Group;
  /** radius of the bounding sphere at scale 1, for framing */
  radius: number;
  abilities: Abilities;
  labels: Label[];
  /** cut 0 = whole, 1 = cut to the middle */
  setCut(k: number): void;
  setExplode(k: number): void;
  setXray(on: boolean): void;
  /** process timeline, 0–1; returns a one-line status for the readout */
  setTime?(t: number): string;
  /** seconds for one full play of the timeline */
  duration?: number;
  /** every frame while open (for idle motion such as drifting electrons) */
  tick?(dt: number): void;
  dispose(): void;
}

/**
 * Material for solid parts: when the cutaway plane slices a part, its inside faces are drawn as a
 * flat, slightly darker cap colour, so cut parts read as solid rather than hollow.
 */
export function solid(color: THREE.ColorRepresentation, opts: { roughness?: number; metalness?: number; emissive?: THREE.ColorRepresentation } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.55, metalness: opts.metalness ?? 0, side: THREE.DoubleSide, emissive: opts.emissive ?? 0x000000 });
  const cap = new THREE.Color(color).multiplyScalar(0.78);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.capColor = { value: cap };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 capColor;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (!gl_FrontFacing) gl_FragColor = vec4(capColor, gl_FragColor.a);');
  };
  m.userData.baseOpacity = 1;
  return m;
}

/** Shared cutaway plane in the object's local frame (normal −z: cuts away the front half). */
export class Cutaway {
  readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
  private local = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
  constructor(private depth: number) {}
  set(k: number): void {
    // k = 0 → plane in front of everything; k = 1 → through the middle (z = 0)
    this.local.constant = k <= 0 ? 1e6 : this.depth * (1 - k);
  }
  /** Re-express the local plane in world space as the object moves. */
  update(obj: THREE.Object3D): void {
    this.plane.copy(this.local).applyMatrix4(obj.matrixWorld);
  }
}

function applyToMaterials(root: THREE.Object3D, fn: (m: THREE.MeshStandardMaterial) => void): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) fn(m as THREE.MeshStandardMaterial);
  });
}

export function setClipping(root: THREE.Object3D, plane: THREE.Plane | null): void {
  applyToMaterials(root, (m) => {
    m.clippingPlanes = plane ? [plane] : [];
    m.needsUpdate = true;
  });
}

/** X-ray: everything turns to tinted glass, with crisp outlines so the structure stays legible. */
export function setXray(root: THREE.Object3D, on: boolean, edges: THREE.LineSegments[]): void {
  applyToMaterials(root, (m) => {
    const base = (m.userData.baseOpacity as number | undefined) ?? 1;
    m.transparent = on || base < 1;
    m.opacity = on ? Math.min(base, 0.16) : base;
    m.depthWrite = !on && base >= 1;
    m.needsUpdate = true;
  });
  for (const e of edges) e.visible = on;
}

export function outline(mesh: THREE.Mesh, color = 0xffffff): THREE.LineSegments {
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 30), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }));
  e.visible = false;
  mesh.add(e);
  return e;
}

export function block(size: [number, number, number], centre: [number, number, number], mat: THREE.Material, radius = 0.04): THREE.Mesh {
  const r = Math.min(radius, Math.min(...size) / 2.2);
  const m = new THREE.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], 3, r), mat);
  m.position.set(...centre);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// A 2D figure lifted off the page: a stiff card printed with the figure.

export function liftCard(texture: THREE.Texture, aspect: number, paper: string): FigureObject {
  const w = 3.2;
  const h = w * aspect;
  const edge = new THREE.MeshStandardMaterial({ color: paper, roughness: 0.9 });
  const face = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85 });
  const back = new THREE.MeshStandardMaterial({ color: new THREE.Color(paper).multiplyScalar(0.94), roughness: 0.9 });
  const card = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), [edge, edge, edge, edge, face, back]);
  card.castShadow = true;
  const group = new THREE.Group();
  group.add(card);
  return {
    group,
    radius: Math.hypot(w, h) / 2,
    abilities: { cutaway: false, explode: false, xray: false, animate: false, labels: false },
    labels: [],
    setCut() {},
    setExplode() {},
    setXray() {},
    dispose() {
      card.geometry.dispose();
      for (const m of [edge, face, back]) m.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// The book's own 3D model (atoms and bonds from cited coordinates).

export function moleculeObject(data: unknown, atomScale = 1): FigureObject {
  const model = Model.parse(data);
  const n = model.atoms.length;
  const c = new THREE.Vector3();
  for (const a of model.atoms) c.add(new THREE.Vector3(a.x, a.y, a.z));
  c.divideScalar(n);
  const lengths = model.bonds.map(([i, j]) => {
    const a = model.atoms[i]!;
    const b = model.atoms[j]!;
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  });
  const unit = lengths.length ? lengths.sort((a, b) => a - b)[Math.floor(lengths.length / 2)]! : 1.5;
  let extent = 0;
  for (const a of model.atoms) extent = Math.max(extent, Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z));
  const k = 1.6 / Math.max(extent, 1e-6); // fit in a sphere of radius ~1.6
  const group = new THREE.Group();
  const atomMat = solid(0xffffff, { roughness: 0.35 });
  const atoms = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 16), atomMat, n);
  const m4 = new THREE.Matrix4();
  model.atoms.forEach((a, i) => {
    const r = (DRAW_R[a.el] ?? 0.34) * unit * atomScale * k;
    m4.compose(new THREE.Vector3((a.x - c.x) * k, (a.y - c.y) * k, (a.z - c.z) * k), new THREE.Quaternion(), new THREE.Vector3(r, r, r));
    atoms.setMatrixAt(i, m4);
    atoms.setColorAt(i, new THREE.Color(CPK[a.el] ?? '#ff1493'));
  });
  atoms.castShadow = true;
  group.add(atoms);
  const bondMat = solid(0xb8bcc4, { roughness: 0.5 });
  const bonds = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 10), bondMat, Math.max(1, model.bonds.length));
  const up = new THREE.Vector3(0, 1, 0);
  model.bonds.forEach(([i, j], b) => {
    const A = model.atoms[i]!;
    const B = model.atoms[j]!;
    const p = new THREE.Vector3((A.x - c.x) * k, (A.y - c.y) * k, (A.z - c.z) * k);
    const q = new THREE.Vector3((B.x - c.x) * k, (B.y - c.y) * k, (B.z - c.z) * k);
    const d = q.clone().sub(p);
    const r = 0.07 * unit * k * atomScale;
    m4.compose(p.clone().add(q).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize()), new THREE.Vector3(r, d.length(), r));
    bonds.setMatrixAt(b, m4);
  });
  bonds.count = model.bonds.length;
  group.add(bonds);
  const cut = new Cutaway(1.7);
  setClipping(group, cut.plane);
  return {
    group,
    radius: 1.8,
    abilities: { cutaway: true, explode: false, xray: true, animate: false, labels: false },
    labels: [],
    setCut(v) {
      cut.set(v);
    },
    setExplode() {},
    setXray(on) {
      setXray(group, on, []);
    },
    tick() {
      cut.update(group);
    },
    dispose() {
      atoms.geometry.dispose();
      bonds.geometry.dispose();
      atomMat.dispose();
      bondMat.dispose();
    },
  };
}

/**
 * Scene kit: blood flowing through a vessel that narrows (schematic, not to scale).
 *
 * A vessel with its wall and inner lining, red blood cells and a row of arrows showing the
 * velocity profile: fastest in the middle, still at the wall (smooth, steady flow). The timeline
 * narrows the vessel to half its radius and back. Resistance follows R ∝ 1/r⁴, so at the same
 * pressure difference the flow falls as r⁴ and the cells' average speed as r². Real blood is not a
 * simple fluid and real vessels are elastic, so the numbers are the idealised law the book states.
 */
import * as THREE from 'three';
import { solid, type FigureObject } from '../objects.ts';
import { KitBuilder } from './common.ts';

export function vesselKit(): FigureObject {
  const k = new KitBuilder(0.7, 1.2);
  const L = 5.2;
  const R = 0.85; // lumen radius at rest
  const WALL = 0.28;

  // the wall as a back and a front half-shell, so exploding opens the vessel like a book; the
  // front half is glass, so the cells and the flow profile show without cutting anything away
  const wallMat = solid('#c0645a', { roughness: 0.7 });
  const liningMat = solid('#f2c4b8', { roughness: 0.55 });
  const glassMat = solid('#e8a79e', { roughness: 0.3 });
  glassMat.transparent = true;
  glassMat.opacity = 0.22;
  glassMat.userData.baseOpacity = 0.22;
  glassMat.depthWrite = false;
  const half = (front: boolean) => {
    const g = new THREE.Group();
    // θ measured from +z: the front half spans −90°…90°, the back half 90°…270°
    const start = front ? -Math.PI / 2 : Math.PI / 2;
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(R + WALL, R + WALL, L, 48, 1, true, start, Math.PI), front ? glassMat : wallMat);
    g.add(outer);
    if (!front) {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, L, 48, 1, true, start, Math.PI), liningMat));
      for (const end of [1, -1]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(R + 0.04, R + WALL, 48, 1, 0, Math.PI), wallMat);
        ring.rotation.set(end > 0 ? -Math.PI / 2 : Math.PI / 2, 0, end > 0 ? 0 : Math.PI); // both rings cover the back half (z ≤ 0)
        ring.position.y = (end * L) / 2;
        g.add(ring);
      }
    }
    g.rotation.z = Math.PI / 2; // lie along x
    return g;
  };
  const back = half(false);
  const front = half(true);
  const vessel = new THREE.Group();
  k.add(vessel, [0, 0, 0], { outline: false });
  k.add(back, [0, 0, -1.3], { parent: vessel });
  k.add(front, [0, 0, 1.6], { parent: vessel, outline: false });

  // red blood cells: flattened discs at random places in the lumen
  const N = 160;
  const cellMat = new THREE.MeshStandardMaterial({ color: '#b3202a', roughness: 0.45, emissive: '#5a0d12', emissiveIntensity: 0.25 });
  const cells = new THREE.InstancedMesh(new THREE.TorusGeometry(0.075, 0.045, 8, 16), cellMat, N);
  const seeds = Array.from({ length: N }, (_, i) => {
    const rho = Math.sqrt(((i * 0.6180339) % 1) * 0.92); // uniform over the cross-section
    const ang = i * 2.399963;
    return { rho, ang, x: (((i * 0.37) % 1) - 0.5) * L, spin: i * 0.7 };
  });
  cells.frustumCulled = false; // instances move; the geometry's own bounds would cull them
  k.add(cells, [0, 0, 0], { outline: false });

  // velocity profile: arrows across one cross-section, length ∝ 1 − (ρ/r)²
  const arrowMat = new THREE.MeshStandardMaterial({ color: '#0072b2', emissive: '#0072b2', emissiveIntensity: 0.5 });
  const arrows = new THREE.Group();
  const shafts: THREE.Mesh[] = [];
  const heads: THREE.Mesh[] = [];
  const rows = [-0.85, -0.6, -0.3, 0, 0.3, 0.6, 0.85];
  for (const f of rows) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 8), arrowMat);
    shaft.rotation.z = -Math.PI / 2;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 10), arrowMat);
    head.rotation.z = -Math.PI / 2;
    shaft.userData.f = f;
    shafts.push(shaft);
    heads.push(head);
    arrows.add(shaft, head);
  }
  arrows.position.x = -L / 2 + 0.6;
  k.add(arrows, [0, 0.9, 0], { outline: false });

  let r = 1; // radius as a fraction of the resting radius
  let speed = 1; // average speed relative to rest (∝ r² at constant pressure difference)
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const placeCells = () => {
    for (let i = 0; i < N; i++) {
      const s = seeds[i]!;
      const rr = s.rho * R * r;
      q.setFromEuler(new THREE.Euler(s.spin, Math.PI / 2, 0));
      m4.compose(new THREE.Vector3(s.x, Math.cos(s.ang) * rr, Math.sin(s.ang) * rr), q, new THREE.Vector3(1, 1, 0.55));
      cells.setMatrixAt(i, m4);
    }
    cells.instanceMatrix.needsUpdate = true;
  };
  const placeArrows = () => {
    shafts.forEach((sh, i) => {
      const f = sh.userData.f as number;
      const len = Math.max(0.02, 1.6 * speed * (1 - f * f));
      sh.scale.set(1, len, 1);
      sh.position.set(len / 2, f * R * r, 0);
      heads[i]!.position.set(len + 0.06, f * R * r, 0);
    });
  };

  k.label('Vessel wall', [0.8, R + WALL, -0.2], back);
  k.label('Inner lining', [-1.2, R * 0.7, -R * 0.7], back);
  k.label('Red blood cells', [1.6, 0, 0], cells);
  k.label('Fastest in the middle', [-L / 2 + 1.4, 0.05, 0], arrows);

  const show = (radius: number): string => {
    r = radius;
    speed = r * r;
    vessel.scale.set(1, r, r);
    placeCells();
    placeArrows();
    const resist = 1 / r ** 4;
    if (r > 0.995) return 'Original radius. Press play to narrow the vessel: resistance follows R ∝ 1/r⁴.';
    return `Radius ${r.toFixed(2)} × the original → resistance ${resist.toFixed(1)} × (R ∝ 1/r⁴). At the same pressure difference, flow is ${(r ** 4).toFixed(2)} × the original and the cells move ${speed.toFixed(2)} × as fast.`;
  };
  const setTime = (t: number): string => show(1 - 0.5 * Math.sin(Math.PI * t));
  setTime(0);
  const obj = k.finish({
    duration: 10,
    setTime,
    tick: (dt) => {
      for (const s of seeds) {
        const v = 1.4 * speed * (1 - s.rho * s.rho);
        s.x += v * dt;
        if (s.x > L / 2) s.x -= L;
        s.spin += dt * 0.8;
      }
      placeCells();
    },
  });
  // an explorable can set the radius directly (as a fraction of the original; the scene shows 0.4–1.5)
  obj.setInput = (name, value) => (name === 'radius' && Number.isFinite(value) ? show(Math.min(1.5, Math.max(0.4, value))) : '');
  return obj;
}

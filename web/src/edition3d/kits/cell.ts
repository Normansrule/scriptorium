/**
 * Scene kit: why cells stay small (schematic spheres, not a real cell).
 *
 * A reference cell of radius 1 µm sits beside a cell that grows to 4 µm on the timeline. Both
 * have a membrane studded with transport proteins, cytoplasm and a nucleus. Supplies (yellow
 * dots) cross the membrane at a rate that follows its area (∝ r²), while the volume they must
 * serve grows as r³; the cytoplasm pales as the supply per cubic micrometre, 3/r, falls. The
 * numbers in the readout are the sphere formulas the book states, nothing more.
 */
import * as THREE from 'three';
import { solid, type FigureObject } from '../objects.ts';
import { KitBuilder, ROLE } from './common.ts';

const UNIT = 0.62; // scene units per micrometre
const R_MAX = 4;

/** Points spread evenly over a unit sphere (Fibonacci lattice). */
function spherePoints(n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r));
  }
  return out;
}

interface CellParts {
  root: THREE.Group;
  membrane: THREE.Mesh;
  cytoplasm: THREE.Mesh;
  cytoMat: THREE.MeshStandardMaterial;
  nucleus: THREE.Mesh;
  pumps: THREE.InstancedMesh;
  sites: THREE.Vector3[];
}

function makeCell(maxPumps: number): CellParts {
  const root = new THREE.Group();
  const membraneMat = solid('#c0645a', { roughness: 0.55 });
  membraneMat.transparent = true;
  membraneMat.opacity = 0.42;
  membraneMat.userData.baseOpacity = 0.42;
  membraneMat.depthWrite = false;
  const membrane = new THREE.Mesh(new THREE.SphereGeometry(UNIT, 48, 32), membraneMat);
  const cytoMat = solid('#f6c9bb', { roughness: 0.7 });
  const cytoplasm = new THREE.Mesh(new THREE.SphereGeometry(UNIT * 0.93, 48, 32), cytoMat);
  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(UNIT * 0.32, 32, 24), solid('#8f7f9f', { roughness: 0.5 }));
  nucleus.position.set(UNIT * 0.12, UNIT * 0.08, 0);
  const sites = spherePoints(maxPumps);
  const pumps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 8), solid(ROLE.green, { roughness: 0.4 }), maxPumps);
  pumps.frustumCulled = false;
  root.add(cytoplasm, nucleus, membrane, pumps);
  return { root, membrane, cytoplasm, cytoMat, nucleus, pumps, sites };
}

/** Show `count` of the pumps, upright on a membrane of radius r (µm), at a constant drawn size. */
function placePumps(c: CellParts, r: number, count: number): void {
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const k = 1 / r; // the cell group is scaled by r; keep the proteins the same size
  c.sites.forEach((p, i) => {
    const s = i < count ? k : 0;
    q.setFromUnitVectors(up, p);
    m4.compose(p.clone().multiplyScalar(UNIT), q, new THREE.Vector3(s, s, s));
    c.pumps.setMatrixAt(i, m4);
  });
  c.pumps.instanceMatrix.needsUpdate = true;
}

export function cellKit(): FigureObject {
  const k = new KitBuilder(0.62, 3.2, new THREE.Vector3(0, -0.15, 0));
  const PUMP_DENSITY = 9; // drawn proteins per µm² at r = 1 … the count follows the area
  const maxPumps = Math.round(PUMP_DENSITY * R_MAX * R_MAX);

  const small = makeCell(PUMP_DENSITY);
  small.root.position.set(-3.4, 0, 0);
  k.add(small.root, [-0.8, 0, 0]);
  placePumps(small, 1, PUMP_DENSITY);

  const big = makeCell(maxPumps);
  big.root.position.set(0.9, 0, 0);
  const bigHolder = new THREE.Group();
  bigHolder.add(big.root);
  k.add(bigHolder, [0, 0, 0], { outline: false });
  // explode the big cell's layers apart: membrane up, nucleus out towards the reader
  k.add(big.membrane, [0, 1.1, 0], { parent: big.root, outline: false });
  k.add(big.nucleus, [0, 0, 1.2], { parent: big.root });
  k.add(big.pumps, [0, 1.1, 0], { parent: big.root, outline: false });

  // supplies crossing the membrane: a dot travels inwards from just outside to just inside
  const N = 220;
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: '#fff4c2', emissive: ROLE.yellow, emissiveIntensity: 0.9 }), N);
  dots.frustumCulled = false;
  big.root.add(dots);
  const smallDots = new THREE.InstancedMesh(dots.geometry, dots.material, 30);
  smallDots.frustumCulled = false;
  small.root.add(smallDots);
  const seeds = spherePoints(N).map((p, i) => ({ p, phase: (i * 0.618) % 1 }));
  const smallSeeds = spherePoints(30).map((p, i) => ({ p, phase: (i * 0.618) % 1 }));

  let r = 1;
  let clock = 0;
  const m4 = new THREE.Matrix4();
  const moveDots = (mesh: THREE.InstancedMesh, list: typeof seeds, radius: number, shown: number) => {
    list.forEach((s, i) => {
      const u = (s.phase + clock * 0.35) % 1; // 0: outside the membrane, 1: inside
      const d = UNIT * (1.18 - 0.4 * u);
      const sc = i < shown ? (1 / radius) * Math.sin(Math.PI * u) : 0;
      m4.makeScale(sc, sc, sc).setPosition(s.p.x * d, s.p.y * d, s.p.z * d);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  const pale = new THREE.Color('#e9dcd8');
  const rich = new THREE.Color('#f2a894');
  const apply = () => {
    big.root.scale.setScalar(r);
    big.root.position.x = 0.9 + (r - 1) * UNIT * 0.35;
    placePumps(big, r, Math.round(PUMP_DENSITY * r * r));
    // supply per volume, relative to the small cell: (r² / r³) = 1/r
    big.cytoMat.color.copy(pale).lerp(rich, 1 / r);
    small.cytoMat.color.copy(rich);
    moveDots(dots, seeds, r, Math.min(N, Math.round(14 * r * r)));
    moveDots(smallDots, smallSeeds, 1, 14);
  };

  k.label('Membrane', [0.9, UNIT * 1.02, 0], big.membrane);
  k.label('Transport proteins', [0.9 + UNIT * 0.72, UNIT * 0.72, 0], big.pumps);
  k.label('Nucleus', [0.9 + UNIT * 0.12, UNIT * 0.08, UNIT * 0.32], big.nucleus);
  k.label('Cytoplasm', [0.9 - UNIT * 0.5, -UNIT * 0.35, UNIT * 0.4], big.cytoplasm);
  k.label('Reference cell, r = 1 µm', [-3.4, -UNIT * 1.1, 0], small.root);

  const show = (radius: number): string => {
    r = radius;
    apply();
    const A = 4 * Math.PI * r * r;
    const V = (4 / 3) * Math.PI * r ** 3;
    if (r < 1.02) return 'Both cells have radius 1 µm: 12.6 µm² of membrane for 4.2 µm³ of cell, 3 µm² for every µm³. Press play to grow the right-hand cell.';
    return `r = ${r.toFixed(1)} µm: ${(r * r).toFixed(1)}× the membrane (${A.toFixed(0)} µm²) but ${(r ** 3).toFixed(1)}× the volume (${V.toFixed(0)} µm³), so each µm³ gets ${(3 / r).toFixed(2)} µm² of membrane, ${(1 / r).toFixed(2)} of the small cell's.`;
  };
  const setTime = (t: number): string => show(1 + (R_MAX - 1) * t);
  setTime(0);
  const obj = k.finish({
    duration: 9,
    setTime,
    tick: (dt) => {
      clock += dt;
      moveDots(dots, seeds, r, Math.min(N, Math.round(14 * r * r)));
      moveDots(smallDots, smallSeeds, 1, 14);
    },
  });
  // an explorable can set the radius in µm; the scene draws 1–4 µm and says when it clips
  obj.setInput = (name, value) => {
    if (name !== 'radius' || !Number.isFinite(value)) return '';
    const shown = Math.min(R_MAX, Math.max(1, value));
    const msg = show(shown);
    return shown !== value ? `${msg} (The explorable says ${value.toPrecision(2)} µm; this scene draws 1 to ${R_MAX} µm.)` : msg;
  };
  return obj;
}

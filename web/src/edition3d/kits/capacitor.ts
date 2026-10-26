/**
 * Scene kit: a parallel-plate capacitor charging (schematic, not to scale).
 *
 * Two metal plates, a dielectric slab between them, the charge gathering on each plate and the
 * electric field lines between them. The timeline charges it through a resistor: charge, and with
 * it the field, follow q = Q(1 − e^(−t/τ)), shown in units of the time constant τ, so nothing here
 * claims a particular voltage or size.
 */
import * as THREE from 'three';
import { block, solid, type FigureObject } from '../objects.ts';
import { KitBuilder, ROLE } from './common.ts';

export function capacitorKit(): FigureObject {
  const k = new KitBuilder(0.62, 1.4);
  const W = 4;
  const D = 2.6;
  const GAP = 1.2;
  const plateMat = solid(ROLE.metal, { roughness: 0.25, metalness: 0.85 });
  const top = k.add(block([W, 0.12, D], [0, GAP / 2 + 0.06, 0], plateMat, 0.04), [0, 1.4, 0]);
  const bottom = k.add(block([W, 0.12, D], [0, -GAP / 2 - 0.06, 0], plateMat, 0.04), [0, -1.4, 0]);
  const leadMat = solid(ROLE.copper, { roughness: 0.35, metalness: 0.7 });
  const leadTop = k.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 12), leadMat), [0, 1.4, 0]);
  leadTop.position.set(0, GAP / 2 + 0.72, 0);
  const leadBottom = k.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 12), leadMat), [0, -1.4, 0]);
  leadBottom.position.set(0, -GAP / 2 - 0.72, 0);

  const dielMat = solid(ROLE.yellow, { roughness: 0.6 });
  dielMat.transparent = true;
  dielMat.opacity = 0.2;
  dielMat.userData.baseOpacity = 0.2;
  dielMat.depthWrite = false;
  const dielectric = k.add(block([W * 0.96, GAP * 0.86, D * 0.96], [0, 0, 0], dielMat, 0.03), [3.4, 0, 0]);

  // charges: + on the top plate's inner face, − on the bottom's (accent and signal roles)
  const N = 7 * 4;
  const plus = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshStandardMaterial({ color: ROLE.accent, emissive: ROLE.accent, emissiveIntensity: 0.35 }), N);
  const minus = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshStandardMaterial({ color: ROLE.signal, emissive: ROLE.signal, emissiveIntensity: 0.35 }), N);
  const spots: Array<[number, number]> = [];
  for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) spots.push([-W / 2 + 0.35 + (i * (W - 0.7)) / 6, -D / 2 + 0.35 + (j * (D - 0.7)) / 3]);
  plus.frustumCulled = false;
  minus.frustumCulled = false;
  top.add(plus);
  bottom.add(minus);

  // field lines: thin arrows from + to −, brighter as charge builds
  const fieldMat = new THREE.MeshStandardMaterial({ color: ROLE.signal, emissive: ROLE.signal, emissiveIntensity: 0.5, transparent: true, opacity: 0 });
  fieldMat.userData.baseOpacity = 0;
  const field = new THREE.Group();
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 3; j++) {
      const x = -W / 2 + 0.6 + (i * (W - 1.2)) / 4;
      const z = -D / 2 + 0.5 + (j * (D - 1)) / 2;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, GAP - 0.28, 6), fieldMat);
      shaft.position.set(x, 0.05, z);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 10), fieldMat);
      head.rotation.x = Math.PI; // pointing down: from + to −
      head.position.set(x, -GAP / 2 + 0.16, z);
      field.add(shaft, head);
    }
  k.add(field, [0, 0, 0], { outline: false });

  const place = (mesh: THREE.InstancedMesh, y: number, frac: number) => {
    const m4 = new THREE.Matrix4();
    const shown = Math.round(frac * N);
    spots.forEach(([x, z], i) => {
      const s = i < shown ? 1 : 0;
      m4.makeScale(s, s, s).setPosition(x, y, z);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  k.label('Top plate: +Q', [-W / 2 + 0.4, GAP / 2 + 0.12, D / 2], top);
  k.label('Bottom plate: −Q', [-W / 2 + 0.4, -GAP / 2 - 0.12, D / 2], bottom);
  k.label('Dielectric (κ)', [W / 2 - 0.5, 0.2, D / 2], dielectric);
  k.label('Electric field E', [-W / 2 + 0.6, 0.05, D / 2 - 0.5], field);
  k.label('Gap d', [W / 2 - 0.2, -0.25, -D / 2], dielectric);

  let frac = 0;
  const setTime = (t: number): string => {
    const tau = t * 5;
    frac = 1 - Math.exp(-tau);
    place(plus, -0.12, frac);
    place(minus, 0.12, frac);
    fieldMat.opacity = 0.85 * frac;
    fieldMat.userData.live = fieldMat.opacity;
    const pct = Math.round(frac * 100);
    return tau < 0.05
      ? 'Switch open: both plates are neutral and there is no field between them.'
      : `t = ${tau.toFixed(1)} τ: each plate holds ${pct} % of its final charge, so the field between them is ${pct} % of full (q = Q(1 − e^(−t/τ))).`;
  };
  setTime(0);
  return k.finish({
    duration: 7,
    setTime,
    afterXray: () => {
      fieldMat.opacity = (fieldMat.userData.live as number | undefined) ?? 0;
    },
  });
}

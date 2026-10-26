/**
 * Scene kit: electron groups push apart (VSEPR), from a flat square to a tetrahedron, then water.
 *
 * Four electron groups around a central atom, each drawn as a lobe with a hydrogen at its tip.
 * First half of the timeline: the groups start flat, 90° apart, and spread into a tetrahedron,
 * 109.5° apart (arccos(−1/3), the book's Eq. for methane). Second half: two groups become lone
 * pairs (no hydrogen, fatter lobes) and the two remaining bonds close to 104.5°, the measured
 * H–O–H angle the book cites. VSEPR explains the direction of that change, not its size; the
 * readout says the 104.5° is measured.
 */
import * as THREE from 'three';
import { solid, type FigureObject } from '../objects.ts';
import { KitBuilder, ROLE, smooth } from './common.ts';

const TET = Math.acos(-1 / 3); // 109.47°
const WATER = (104.5 * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The four directions for a given stage: square (s = 0) → tetrahedron (s = 1), with the two upper groups at `bond` apart. */
function directions(s: number, bond: number, lone: number): THREE.Vector3[] {
  // tetrahedron oriented so two groups lean up (in the x–y plane) and two lean down (in the y–z plane)
  const half = bond / 2;
  const halfL = lone / 2;
  const tet = [
    new THREE.Vector3(Math.sin(half), Math.cos(half), 0),
    new THREE.Vector3(-Math.sin(half), Math.cos(half), 0),
    new THREE.Vector3(0, -Math.cos(halfL), Math.sin(halfL)),
    new THREE.Vector3(0, -Math.cos(halfL), -Math.sin(halfL)),
  ];
  const square = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
  return square.map((q, i) => q.clone().lerp(tet[i]!, s).normalize());
}

export function vseprKit(): FigureObject {
  const k = new KitBuilder(0.95, 2.2);
  const BOND = 1.55;

  const centralMat = solid('#4a4f57', { roughness: 0.45 });
  const central = k.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 40, 28), centralMat), [0, 0, 0]);

  const groups = Array.from({ length: 4 }, (_, i) => {
    const holder = new THREE.Group();
    const lobeMat = new THREE.MeshStandardMaterial({ color: ROLE.signal, emissive: ROLE.signal, emissiveIntensity: 0.25, transparent: true, opacity: 0.38, roughness: 0.3, depthWrite: false });
    lobeMat.userData.baseOpacity = 0.38;
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 20), lobeMat);
    lobe.scale.set(0.55, 1, 0.55);
    lobe.position.y = 0.72;
    const bond = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, BOND, 14), solid('#d7dde5', { roughness: 0.4, metalness: 0.2 }));
    bond.position.y = BOND / 2;
    const hMat = solid('#f4f4f4', { roughness: 0.5 });
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.26, 28, 20), hMat);
    h.position.y = BOND;
    holder.add(lobe, bond, h);
    k.add(holder, [0, 0, 0], { outline: false });
    return { holder, lobe, lobeMat, bond, h, hMat, index: i };
  });

  const up = new THREE.Vector3(0, 1, 0);
  let angleNow = Math.PI / 2;
  const pose = (dirs: THREE.Vector3[], explode = 0) => {
    groups.forEach((g, i) => {
      g.holder.quaternion.setFromUnitVectors(up, dirs[i]!);
      g.holder.position.copy(dirs[i]!).multiplyScalar(explode);
    });
  };
  let explodeK = 0;
  let current = directions(0, TET, TET);

  k.label('Central atom', [0, -0.05, 0.45], central);
  k.label('Bonding pair', [0, 0.9, 0], groups[0]!.holder);
  k.label('Hydrogen', [0, BOND + 0.3, 0], groups[1]!.holder);
  k.label('Electron group (a lone pair in water)', [0, 0.9, 0], groups[2]!.holder);

  const water = new THREE.Color('#d0453a'); // oxygen, in the usual CPK red
  const carbon = new THREE.Color('#4a4f57');
  const lonePair = new THREE.Color(ROLE.accent);
  const bondPair = new THREE.Color(ROLE.signal);

  const setTime = (t: number): string => {
    const spread = smooth(0, 0.45, t); // square → tetrahedron
    const toWater = smooth(0.55, 1, t); // two groups become lone pairs
    const bond = TET + (WATER - TET) * toWater;
    const lone = TET + (TET + (TET - WATER) * 2.2 - TET) * toWater; // lone pairs open a little (shape only, not a measured value)
    current = directions(spread, bond, lone);
    pose(current, explodeK);
    angleNow = current[0]!.angleTo(current[2]!); // neighbouring groups
    const bondAngle = current[0]!.angleTo(current[1]!);
    for (const g of groups) {
      const isLone = g.index >= 2;
      const f = isLone ? toWater : 0;
      g.h.scale.setScalar(1 - f);
      g.bond.scale.set(1, Math.max(0.001, 1 - f), 1);
      g.bond.visible = f < 0.99;
      g.h.visible = f < 0.99;
      g.lobe.scale.set(0.55 + 0.25 * f, 1 + 0.12 * f, 0.55 + 0.25 * f);
      g.lobeMat.color.copy(bondPair).lerp(lonePair, f);
      g.lobeMat.emissive.copy(g.lobeMat.color);
    }
    centralMat.color.copy(carbon).lerp(water, toWater);
    if (t < 0.02) return 'Four electron groups forced flat: neighbouring groups are only 90° apart. Press play and let them repel.';
    if (t < 0.5) return `The groups spread out in 3D: neighbours now ${deg(angleNow).toFixed(1)}° apart${spread > 0.99 ? ' — a tetrahedron, as in methane (arccos(−1/3) = 109.5°)' : ''}.`;
    if (toWater < 0.01) return 'Methane, CH₄: four bonding pairs, every H–C–H angle 109.5°.';
    return `Two groups become lone pairs, as in water. They push harder, and the H–O–H angle closes to ${deg(bondAngle).toFixed(1)}°${toWater > 0.99 ? ' (104.5° is the measured value; VSEPR predicts only that it is less than 109.5°)' : ''}.`;
  };
  setTime(0);
  return k.finish({
    duration: 9,
    setTime,
    abilities: { cutaway: false },
    // exploding pulls each group out along its own direction, wherever the timeline has put it
    setExplode: (v) => {
      explodeK = v * 1.1;
      pose(current, explodeK);
    },
  });
}

/**
 * Scene kit: an n-channel MOSFET as a schematic cross-section block (not to scale).
 *
 * Parts: p-type body, n+ source and drain, gate oxide, gate, metal contacts; plus the inversion
 * channel, the depletion region under the gate and conduction electrons. The timeline sweeps the
 * gate–source voltage from zero past the threshold: below it there is no channel and no current;
 * above it a thin n-type channel forms under the oxide and electrons drift from source to drain.
 * Voltages are shown relative to the threshold, never as numbers, because the kit is not a model
 * of any particular device — the book's text and references carry the numbers.
 */
import * as THREE from 'three';
import { block, Cutaway, outline, setClipping, setXray, solid, type FigureObject, type Label } from '../objects.ts';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function mosfetKit(): FigureObject {
  const group = new THREE.Group();
  const scene = new THREE.Group();
  scene.scale.setScalar(0.42);
  scene.position.y = -0.9;
  group.add(scene);
  const D = 5; // depth along z
  const C = {
    body: '#c9a26b', // p-type
    well: '#56b4e9', // n+
    oxide: '#e9f4fb',
    gate: '#5a6472',
    metal: '#c3c9d1',
    channel: '#0072b2',
    depletion: '#f0e442',
  };
  const parts: Array<{ mesh: THREE.Object3D; base: THREE.Vector3; dir: THREE.Vector3 }> = [];
  const edges: THREE.LineSegments[] = [];
  const add = (mesh: THREE.Mesh, dir: [number, number, number]) => {
    scene.add(mesh);
    parts.push({ mesh, base: mesh.position.clone(), dir: new THREE.Vector3(...dir) });
    edges.push(outline(mesh, 0xdfe8f2));
    return mesh;
  };

  // p-type body, built around the wells so it stays solid when they lift out
  const bodyMat = solid(C.body, { roughness: 0.75 });
  const body = new THREE.Group();
  body.add(block([10, 2.0, D], [0, 1.0, 0], bodyMat, 0.06));
  body.add(block([0.8, 0.6, D], [-4.6, 2.3, 0], bodyMat, 0.02));
  body.add(block([3.6, 0.6, D], [0, 2.3, 0], bodyMat, 0.02));
  body.add(block([0.8, 0.6, D], [4.6, 2.3, 0], bodyMat, 0.02));
  scene.add(body);
  parts.push({ mesh: body, base: body.position.clone(), dir: new THREE.Vector3(0, -1.6, 0) });
  body.children.forEach((m) => edges.push(outline(m as THREE.Mesh, 0xdfe8f2)));

  const wellMat = solid(C.well, { roughness: 0.6 });
  const source = add(block([2.4, 0.6, D], [-3.0, 2.3, 0], wellMat, 0.02), [-0.5, 0.9, 0]);
  const drain = add(block([2.4, 0.6, D], [3.0, 2.3, 0], wellMat, 0.02), [0.5, 0.9, 0]);

  const oxideMat = solid(C.oxide, { roughness: 0.15 });
  oxideMat.transparent = true;
  oxideMat.opacity = 0.72;
  oxideMat.userData.baseOpacity = 0.72;
  const oxide = add(block([3.8, 0.14, D], [0, 2.67, 0], oxideMat, 0.02), [0, 1.9, 0]);

  const gateMat = solid(C.gate, { roughness: 0.4, metalness: 0.3, emissive: '#000000' });
  const gate = add(block([3.8, 0.7, D], [0, 3.09, 0], gateMat, 0.04), [0, 2.9, 0]);

  const metalMat = solid(C.metal, { roughness: 0.25, metalness: 0.85 });
  const sPad = add(block([1.2, 0.5, D * 0.6], [-3.0, 2.85, 0], metalMat, 0.04), [-0.5, 2.4, 0]);
  const dPad = add(block([1.2, 0.5, D * 0.6], [3.0, 2.85, 0], metalMat, 0.04), [0.5, 2.4, 0]);
  const gPad = add(block([1.0, 0.4, D * 0.6], [0, 3.64, 0], metalMat, 0.04), [0, 3.8, 0]);

  // inversion channel: a thin sheet just under the oxide; appears as the gate passes threshold
  const channelMat = new THREE.MeshStandardMaterial({ color: C.channel, emissive: C.channel, emissiveIntensity: 0.6, transparent: true, opacity: 0, roughness: 0.3, side: THREE.DoubleSide });
  channelMat.userData.baseOpacity = 0;
  const channel = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.07, D + 0.012), channelMat); // flush with the cut face so the cross-section shows it
  channel.position.set(0, 2.565, 0);
  scene.add(channel);
  parts.push({ mesh: channel, base: channel.position.clone(), dir: new THREE.Vector3(0, -1.6, 0) });

  // depletion region: grows under the gate as the gate voltage rises
  const depMat = new THREE.MeshStandardMaterial({ color: C.depletion, transparent: true, opacity: 0.0, roughness: 0.8, depthWrite: false, side: THREE.DoubleSide });
  depMat.userData.baseOpacity = 0;
  const depletion = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1, D + 0.008), depMat);
  depletion.position.set(0, 2.5, 0);
  scene.add(depletion);
  parts.push({ mesh: depletion, base: depletion.position.clone(), dir: new THREE.Vector3(0, -1.6, 0) });

  // conduction electrons
  const N = 140;
  const eMat = new THREE.MeshStandardMaterial({ color: '#dff3ff', emissive: '#56b4e9', emissiveIntensity: 1.2, roughness: 0.2 });
  const electrons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 10, 8), eMat, N);
  // two in five electrons ride just in front of the cross-section face (as textbook cross-sections draw them); the rest are inside, seen when cut open or X-rayed
  const seeds = Array.from({ length: N }, (_, i) => ({ phase: (i * 0.618) % 1, z: i % 5 < 2 ? D / 2 + 0.06 : (((i * 0.37) % 1) - 0.5) * D * 0.9, y: (i * 0.53) % 1, side: i % 2 }));
  scene.add(electrons);
  parts.push({ mesh: electrons, base: electrons.position.clone(), dir: new THREE.Vector3(0, -1.6, 0) });

  const cut = new Cutaway(D / 2 * 0.42 + 0.01);
  setClipping(group, cut.plane);

  let strength = 0; // channel 0–1
  let flow = 0; // electron drift speed 0–1
  let clock = 0;
  const m4 = new THREE.Matrix4();
  const placeElectrons = () => {
    for (let i = 0; i < N; i++) {
      const s = seeds[i]!;
      let x: number;
      let y: number;
      if (strength > 0.15) {
        // drifting through the channel from source (x < 0) to drain, density follows the channel
        const p = (s.phase + clock * 0.25 * flow) % 1;
        x = -3.9 + p * 7.8;
        const inWell = Math.abs(x) > 1.8;
        y = inWell ? 2.1 + s.y * 0.45 : 2.535 + s.y * 0.05;
        const visible = s.phase < 0.25 + 0.75 * strength;
        m4.makeScale(visible ? 1 : 0, visible ? 1 : 0, visible ? 1 : 0);
      } else {
        // no channel: electrons stay in the n+ wells, jiggling
        x = (s.side ? 1 : -1) * (2.0 + s.phase * 2.0) + Math.sin(clock * 3 + i) * 0.05;
        y = 2.1 + s.y * 0.45;
        m4.identity();
      }
      m4.setPosition(x, y, s.z);
      electrons.setMatrixAt(i, m4);
    }
    electrons.instanceMatrix.needsUpdate = true;
  };
  placeElectrons();

  const labels: Label[] = [
    { text: 'Source (n⁺)', at: new THREE.Vector3(-4.0, 2.2, D / 2), part: source },
    { text: 'Drain (n⁺)', at: new THREE.Vector3(3.9, 2.2, D / 2), part: drain },
    { text: 'Gate', at: new THREE.Vector3(1.2, 3.3, D / 2), part: gate },
    { text: 'Gate oxide', at: new THREE.Vector3(-1.3, 2.67, D / 2), part: oxide },
    { text: 'p-type body', at: new THREE.Vector3(-3.6, 0.8, D / 2), part: body },
    { text: 'Metal contact', at: new THREE.Vector3(3.0, 3.1, D * 0.3), part: dPad },
  ];
  void sPad;
  void gPad;
  // anchors were written in the block's coordinates; make them relative to their part so they
  // follow it when the model explodes (the viewer places them with part.localToWorld)
  for (const l of labels) if (l.part) l.at.sub(l.part.position);

  return {
    group,
    radius: 2.6,
    abilities: { cutaway: true, explode: true, xray: true, animate: true, labels: true },
    labels,
    duration: 9,
    setCut(k) {
      cut.set(k);
    },
    setExplode(k) {
      for (const p of parts) p.mesh.position.copy(p.base).addScaledVector(p.dir, k);
    },
    setXray(on) {
      setXray(group, on, edges);
      // keep the process visible through the glass
      channelMat.opacity = strength * 0.85;
      depMat.opacity = depMat.userData.live as number ?? 0;
    },
    setTime(t) {
      // gate voltage as a fraction of the threshold: 0 → 1.8 Vth over the first 60 % of the timeline
      const vg = 1.8 * smooth(0.04, 0.6, t);
      strength = smooth(1.0, 1.35, vg);
      flow = strength * smooth(0.55, 0.8, t);
      channelMat.opacity = strength * 0.85;
      const dep = Math.min(vg, 1) * 0.55;
      depletion.scale.y = Math.max(0.001, dep);
      depletion.position.y = 2.6 - dep / 2;
      depMat.opacity = 0.18 * Math.min(1, vg);
      depMat.userData.live = depMat.opacity;
      gateMat.emissive.set('#e0651f').multiplyScalar(0.1 * Math.min(1, vg / 1.8));
      placeElectrons();
      if (vg < 1) return `Gate voltage below threshold (${Math.round(vg * 100)} % of V_th): no channel, no current.`;
      if (flow < 0.05) return 'Past threshold: a thin n-type inversion channel forms under the oxide.';
      return 'Drain voltage applied: electrons drift through the channel from source to drain.';
    },
    tick(dt) {
      clock += dt;
      cut.update(group);
      if (flow > 0 || strength <= 0.15) placeElectrons();
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh || (o as THREE.LineSegments).isLineSegments) m.geometry.dispose();
      });
      for (const m of [bodyMat, wellMat, oxideMat, gateMat, metalMat, channelMat, depMat, eMat]) m.dispose();
    },
  };
}

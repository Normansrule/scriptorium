/**
 * Scene kit: an RC charging circuit as real parts on a board (schematic proportions).
 *
 * Battery, switch, resistor (colour bands for 10 kΩ: brown, black, orange, gold) and an
 * electrolytic capacitor, joined by copper wire. On the timeline the switch closes and charge
 * flows: the moving dots slow down as the current falls, i = (V_s/R) e^(−t/τ), while the
 * capacitor fills, v_C = V_s(1 − e^(−t/τ)). Two bars beside the capacitor show both, in percent.
 */
import * as THREE from 'three';
import { block, solid, type FigureObject } from '../objects.ts';
import { KitBuilder, ROLE } from './common.ts';

export function rcLoopKit(): FigureObject {
  const k = new KitBuilder(0.55, 2.2, new THREE.Vector3(0, -0.3, 0));
  k.scene.rotation.x = 0.5; // tip the board towards the reader so the parts read from above
  const X = 2.6;
  const Z = 1.6;
  const boardMat = solid('#25313f', { roughness: 0.9 });
  const board = k.add(block([X * 2 + 1.2, 0.12, Z * 2 + 1.2], [0, -0.06, 0], boardMat, 0.05), [0, -1.2, 0]);

  // the loop: battery on the left, switch top-left, resistor top-right, capacitor on the right
  const path = new THREE.CurvePath<THREE.Vector3>();
  const c = [new THREE.Vector3(-X, 0.12, Z), new THREE.Vector3(-X, 0.12, -Z), new THREE.Vector3(X, 0.12, -Z), new THREE.Vector3(X, 0.12, Z)];
  for (let i = 0; i < 4; i++) path.add(new THREE.LineCurve3(c[i]!, c[(i + 1) % 4]!));
  const wireMat = solid(ROLE.copper, { roughness: 0.35, metalness: 0.75 });
  const wire = new THREE.Mesh(new THREE.TubeGeometry(path as unknown as THREE.Curve<THREE.Vector3>, 160, 0.045, 8, true), wireMat);
  k.add(wire, [0, 0, 0], { outline: false });

  // battery (along z on the left edge)
  const battery = new THREE.Group();
  const cell = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.3, 28), solid('#1f2328', { roughness: 0.5 }));
  cell.rotation.x = Math.PI / 2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.36, 28), solid(ROLE.accent, { roughness: 0.4 }));
  band.rotation.x = Math.PI / 2;
  band.position.z = -0.47;
  const nub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 16), solid(ROLE.metal, { metalness: 0.8, roughness: 0.25 }));
  nub.rotation.x = Math.PI / 2;
  nub.position.z = -0.71;
  battery.add(cell, band, nub);
  battery.position.set(-X, 0.42, 0.1);
  k.add(battery, [-0.6, 1.0, 0]);

  // switch (top edge, left): two posts and a lever that closes
  const sw = new THREE.Group();
  const postMat = solid(ROLE.metal, { metalness: 0.8, roughness: 0.3 });
  for (const x of [-0.4, 0.4]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 12), postMat);
    post.position.set(x, 0.27, 0);
    sw.add(post);
  }
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.1), solid(ROLE.metal, { metalness: 0.9, roughness: 0.2 }));
  lever.geometry.translate(0.42, 0, 0); // hinge at the left post
  lever.position.set(-0.4, 0.42, 0);
  sw.add(lever);
  sw.position.set(-X + 1.4, 0, -Z);
  k.add(sw, [0, 1.0, -0.4]);

  // resistor (top edge, right) with its colour code
  const res = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.75, 6, 18), solid('#d9c39a', { roughness: 0.6 }));
  body.rotation.z = Math.PI / 2;
  res.add(body);
  ['#7a4a1e', '#111111', ROLE.accent, '#c8a13a'].forEach((col, i) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.178, 0.178, 0.07, 20), solid(col, { roughness: 0.5, metalness: col === '#c8a13a' ? 0.6 : 0 }));
    b.rotation.z = Math.PI / 2;
    b.position.x = -0.3 + i * 0.17 + (i === 3 ? 0.12 : 0);
    res.add(b);
  });
  res.position.set(1.0, 0.3, -Z);
  k.add(res, [0, 1.0, -0.4]);

  // electrolytic capacitor (right edge), with a glowing fill that rises as it charges
  const cap = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.95, 32), solid('#1b4f8c', { roughness: 0.45 }));
  can.position.y = 0.6;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.365, 0.365, 0.95, 32, 1, true, -0.4, 0.8), solid('#d7dde5', { roughness: 0.5 }));
  stripe.position.y = 0.6;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 32), solid(ROLE.metal, { metalness: 0.85, roughness: 0.3 }));
  lid.position.y = 1.09;
  const fillMat = new THREE.MeshStandardMaterial({ color: ROLE.sky, emissive: ROLE.sky, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 });
  fillMat.userData.baseOpacity = 0.85;
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.95, 32, 1, true), fillMat);
  fill.geometry.translate(0, 0.475, 0);
  fill.position.y = 0.125;
  cap.add(can, stripe, lid, fill);
  cap.position.set(X, 0, 0.2);
  k.add(cap, [0.6, 1.0, 0]);

  // two bars: capacitor voltage (rises) and current (falls)
  const bars = new THREE.Group();
  const barMat = (col: string) => new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 });
  const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1, 0.22), barMat(ROLE.sky));
  const iBar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1, 0.22), barMat(ROLE.accent));
  vBar.geometry.translate(0, 0.5, 0);
  iBar.geometry.translate(0, 0.5, 0);
  vBar.position.set(0, 0.12, 0);
  iBar.position.set(0.4, 0.12, 0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.4), solid('#3a4656'));
  frame.position.set(0.2, 0.1, 0);
  bars.add(frame, vBar, iBar);
  bars.position.set(X - 1.6, 0, Z - 0.2);
  k.add(bars, [0, 0.6, 0.6], { outline: false });

  // moving charge (conventional current, clockwise from the battery's + end)
  const N = 48;
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: ROLE.yellow, emissiveIntensity: 1.1 }), N);
  dots.frustumCulled = false;
  k.add(dots, [0, 0, 0], { outline: false });
  const phase = Array.from({ length: N }, (_, i) => i / N);
  let current = 0;
  const m4 = new THREE.Matrix4();
  const moveDots = () => {
    for (let i = 0; i < N; i++) {
      const p = path.getPointAt(phase[i]!);
      const s = current > 0.004 ? 1 : 0;
      m4.makeScale(s, s, s).setPosition(p.x, p.y + 0.06, p.z);
      dots.setMatrixAt(i, m4);
    }
    dots.instanceMatrix.needsUpdate = true;
  };

  k.label('Battery (supply Vₛ)', [-X - 0.3, 0.75, 0.3], battery);
  k.label('Switch', [-X + 1.4, 0.55, -Z], sw);
  k.label('Resistor R (10 kΩ)', [1.0, 0.55, -Z], res);
  k.label('Capacitor C', [X + 0.3, 1.1, 0.2], cap);
  k.label('Capacitor voltage (blue), current (orange)', [X - 1.6, 1.2, Z - 0.2], bars);

  const setTime = (t: number): string => {
    const closed = t > 0.03;
    lever.rotation.z = closed ? 0 : 0.6;
    const tau = closed ? ((t - 0.03) / 0.97) * 5 : 0;
    const v = closed ? 1 - Math.exp(-tau) : 0;
    current = closed ? Math.exp(-tau) : 0;
    fill.scale.y = Math.max(0.001, v);
    vBar.scale.y = Math.max(0.001, v * 1.4);
    iBar.scale.y = Math.max(0.001, current * 1.4);
    moveDots();
    if (!closed) return 'Switch open: no current, the capacitor is empty.';
    const when = realTau ? `t = ${(tau * realTau).toFixed(realTau < 1 ? 2 : 1)} s (${tau.toFixed(1)} τ, with τ = ${fmtS(realTau)})` : `t = ${tau.toFixed(1)} τ`;
    return `${when}: the capacitor is at ${Math.round(v * 100)} % of the supply voltage; the current is down to ${Math.round(current * 100)} % of its first value.`;
  };
  // driven by an explorable: τ in real seconds, and the play button takes 5τ (when that is watchable)
  let realTau: number | null = null;
  let lastT = 0;
  const fmtS = (v: number) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} s`;
  setTime(0);
  void board;
  const obj = k.finish({
    duration: 8,
    setTime: (t) => setTime((lastT = t)),
    tick: (dt) => {
      if (current <= 0.004) return;
      // dots travel at a speed proportional to the current
      for (let i = 0; i < N; i++) phase[i] = (phase[i]! + dt * 0.35 * current) % 1;
      moveDots();
    },
  });
  obj.setInput = (name, value) => {
    if (name !== 'tau' || !(value > 0)) return '';
    realTau = value;
    const real = 5 * value;
    obj.duration = Math.min(30, Math.max(2.5, real / 0.97));
    const note = real > 30 ? ' Playing faster than real time.' : real < 2.5 ? ' Playing slower than real time.' : ' Playing in real time.';
    return `${setTime(lastT)}${note}`;
  };
  return obj;
}

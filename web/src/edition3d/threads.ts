/**
 * Threads: coloured arcs between items the book says belong together (items.ts `connections`):
 * an equation and the figure that shows it, an explorable and the equation it brings to life, an
 * explorable and the scene it drives. On a spread they rise between the pop-up cards; on the desk
 * they join kept cards. Each thread fades from one item's colour to the other's; pointing at an
 * item (or a link in a panel) lights its threads and sends dashes flowing along them, and dims the
 * rest. With reduced motion the dashes stay still.
 */
import * as THREE from 'three';
import type { Item, Link } from './items.ts';
import { KIND } from './kinds.ts';
import type { Stage } from './stage.ts';

interface Thread {
  a: string;
  b: string;
  mesh: THREE.Mesh;
  beads: THREE.Mesh[];
  mat: THREE.MeshBasicMaterial;
  beadMats: THREE.MeshBasicMaterial[];
  geo: THREE.TubeGeometry;
  dash: THREE.Texture;
}

const BASE = 0.42;
const DIM = 0.08;

/** A dash pattern for the alpha map: opaque dashes with soft ends, clear gaps. */
function dashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, '#000');
  grad.addColorStop(0.12, '#fff');
  grad.addColorStop(0.62, '#fff');
  grad.addColorStop(0.74, '#000');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Threads {
  private group = new THREE.Group();
  private threads: Thread[] = [];
  private dash = dashTexture();
  private lit: string | null = null;
  private flowing: (() => void) | null = null;
  private kinds: Map<string, Item>;

  constructor(
    private stage: Stage,
    items: Item[],
    private links: Map<string, Link[]>,
    /** where an item's thread attaches (world space), or null if it is not in view */
    private endpoint: (key: string) => THREE.Vector3 | null,
  ) {
    this.kinds = new Map(items.map((i) => [i.key, i]));
    stage.scene.add(this.group);
    stage.onFrame((dt) => {
      if (!this.flowing) return;
      for (const t of this.threads) t.dash.offset.x -= dt * 1.4;
      this.stage.invalidate();
    });
  }

  get count(): number {
    return this.threads.length;
  }

  /** Draw a thread for every connected pair among `keys` whose ends are both in view. */
  show(keys: string[]): void {
    this.clear();
    const set = new Set(keys);
    const done = new Set<string>();
    for (const a of keys) {
      for (const l of this.links.get(a) ?? []) {
        const b = l.item.key;
        const id = [a, b].sort().join('|');
        if (!set.has(b) || done.has(id)) continue;
        done.add(id);
        const pa = this.endpoint(a);
        const pb = this.endpoint(b);
        if (pa && pb) this.add(a, b, pa, pb);
      }
    }
    this.highlight(this.lit);
  }

  clear(): void {
    for (const t of this.threads) {
      this.group.remove(t.mesh, ...t.beads);
      t.geo.dispose();
      t.mat.dispose();
      t.beadMats.forEach((m) => m.dispose());
      t.beads.forEach((b) => b.geometry.dispose());
      t.dash.dispose();
    }
    this.threads = [];
    this.stage.invalidate();
  }

  set visible(v: boolean) {
    this.group.visible = v;
    this.stage.invalidate();
  }

  /** Light the threads of `key` (only the one to `other`, if given); null lights none and dims none. */
  highlight(key: string | null, other?: string): void {
    this.lit = key;
    let any = false;
    for (const t of this.threads) {
      const touches = key !== null && (t.a === key || t.b === key) && (!other || t.a === other || t.b === other);
      any ||= touches;
      const o = key === null ? BASE : touches ? 1 : DIM;
      t.mat.opacity = o;
      t.beadMats.forEach((m) => (m.opacity = Math.min(1, o + 0.2)));
    }
    const flow = any && !this.stage.reducedMotion;
    if (flow && !this.flowing) this.flowing = this.stage.hold();
    if (!flow && this.flowing) {
      this.flowing();
      this.flowing = null;
    }
    this.stage.invalidate();
  }

  private add(a: string, b: string, pa: THREE.Vector3, pb: THREE.Vector3): void {
    const dist = pa.distanceTo(pb);
    const mid = pa.clone().lerp(pb, 0.5);
    mid.y += 0.25 + dist * 0.28; // arc up and over, higher for longer threads
    const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
    const geo = new THREE.TubeGeometry(curve, 64, 0.015, 6, false);
    // colour along the thread: from a's kind to b's kind (uv.x runs along the tube)
    const ca = new THREE.Color(KIND[this.kinds.get(a)?.kind ?? 'figure'].color);
    const cb = new THREE.Color(KIND[this.kinds.get(b)?.kind ?? 'figure'].color);
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    const colors = new Float32Array(uv.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < uv.count; i++) {
      c.copy(ca).lerp(cb, uv.getX(i));
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const dash = this.dash.clone(); // same image, its own repeat for this thread's length
    dash.needsUpdate = true;
    dash.repeat.set(Math.max(4, Math.round(curve.getLength() / 0.09)), 1);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: BASE, alphaMap: dash, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    // a bead at each end, in that end's colour, where the thread is tied on
    const beadMats = [ca, cb].map((col) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: BASE + 0.2, depthWrite: false }));
    const beads = [pa, pb].map((p, i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.034, 12, 8), beadMats[i]!);
      m.position.copy(p);
      m.renderOrder = 2;
      return m;
    });
    this.group.add(mesh, ...beads);
    this.threads.push({ a, b, mesh, beads, mat, beadMats, geo, dash });
    this.stage.invalidate();
  }
}

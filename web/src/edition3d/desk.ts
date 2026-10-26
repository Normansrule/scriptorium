/**
 * The desk: things a reader pulls out of the book and keeps. Kept items fly off their page and land
 * as small pop-up cards on the table in front of the book; a click opens one again, the drawer lists
 * them, and study mode turns them into cards to practise with.
 *
 * What is kept stays in this browser only (localStorage, per book); nothing is sent anywhere. If
 * storage is unavailable (a private window), the desk still works until the page closes.
 */
import * as THREE from 'three';
import type { BookModel } from './book.ts';
import { cutOut, type Item } from './items.ts';
import { KIND } from './kinds.ts';
import { easeInOut, easeOut, type Stage } from './stage.ts';

export class DeskStore {
  private keys: string[] = [];
  readonly onChange = new Set<(added?: Item) => void>();

  constructor(
    private storageKey: string,
    private all: Item[],
  ) {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as unknown;
      if (Array.isArray(raw)) this.keys = raw.filter((k): k is string => typeof k === 'string' && all.some((i) => i.key === k));
    } catch {
      this.keys = [];
    }
  }

  get items(): Item[] {
    return this.keys.map((k) => this.all.find((i) => i.key === k)!).filter(Boolean);
  }

  has(key: string): boolean {
    return this.keys.includes(key);
  }

  toggle(item: Item): boolean {
    const on = !this.has(item.key);
    this.keys = on ? [...this.keys, item.key] : this.keys.filter((k) => k !== item.key);
    this.save();
    this.onChange.forEach((f) => f(on ? item : undefined));
    return on;
  }

  clear(): void {
    this.keys = [];
    this.save();
    this.onChange.forEach((f) => f());
  }

  private save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.keys));
    } catch {
      /* storage blocked: keep the desk for this visit only */
    }
  }
}

interface DeskCard {
  item: Item;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  disposables: Array<{ dispose(): void }>;
}

const CARD_W = 1.4;
const MAX_CARDS = 10;

/** The kept items as cards standing on the table in front of the book. */
export class DeskTable {
  private cards: DeskCard[] = [];
  private ray = new THREE.Raycaster();
  /** a card was clicked */
  onPick: ((item: Item) => void) | null = null;

  constructor(
    private stage: Stage,
    private model: BookModel,
    private store: DeskStore,
  ) {
    store.onChange.add((added) => void this.sync(added));
    const canvas = stage.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = canvas.getBoundingClientRect();
      this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
      const hit = this.ray.intersectObjects(this.cards.map((c) => c.mesh), false)[0];
      const card = hit && this.cards.find((c) => c.mesh === hit.object);
      if (card) this.onPick?.(card.item);
    });
  }

  /** How much table in front of the book the desk needs (0 when empty), for framing the camera. */
  get depth(): number {
    return this.cards.length ? 1.25 : 0;
  }

  /** Where the i-th of n cards stands. */
  private slot(i: number, n: number): { x: number; z: number; tilt: number } {
    const span = Math.min(2 * this.model.W - 0.3, n * (CARD_W + 0.14));
    const step = n > 1 ? span / n : 0;
    const x = -span / 2 + step * (i + 0.5);
    return { x, z: this.model.H / 2 + 0.95, tilt: (i - (n - 1) / 2) * -0.035 };
  }

  async sync(added?: Item): Promise<void> {
    const items = this.store.items.slice(-MAX_CARDS);
    // remove cards no longer kept
    for (const c of [...this.cards]) if (!items.some((i) => i.key === c.item.key)) this.remove(c);
    for (const it of items) if (!this.cards.some((c) => c.item.key === it.key)) await this.add(it, it === added);
    this.cards.sort((a, b) => items.indexOf(a.item) - items.indexOf(b.item));
    const n = this.cards.length;
    const from = this.cards.map((c) => ({ x: c.pivot.position.x, z: c.pivot.position.z, r: c.pivot.rotation.y }));
    const release = this.stage.hold();
    await this.stage.tween(380, (k) => {
      this.cards.forEach((c, i) => {
        const s = this.slot(i, n);
        c.pivot.position.x = from[i]!.x + (s.x - from[i]!.x) * k;
        c.pivot.position.z = from[i]!.z + (s.z - from[i]!.z) * k;
        c.pivot.rotation.y = from[i]!.r + (s.tilt - from[i]!.r) * k;
      });
    }, easeInOut);
    release();
  }

  private async add(item: Item, fly: boolean): Promise<void> {
    const canvas = await cutOut(this.model, item, 640);
    const aspect = canvas ? canvas.height / canvas.width : 0.7;
    const w = CARD_W;
    const h = Math.min(1.2, Math.max(0.4, w * aspect));
    const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
    if (tex) tex.anisotropy = this.stage.renderer.capabilities.getMaxAnisotropy();
    if (tex) tex.colorSpace = THREE.SRGBColorSpace;
    const kind = KIND[item.kind];
    const edge = new THREE.MeshLambertMaterial({ color: kind.color });
    const face = new THREE.MeshLambertMaterial(tex ? { map: tex } : { color: 0xf4f1ea });
    const geo = new THREE.BoxGeometry(w, h, 0.012);
    const mesh = new THREE.Mesh(geo, [edge, edge, edge, edge, face, edge]);
    mesh.position.y = h / 2;
    mesh.castShadow = true;
    const holder = new THREE.Group();
    holder.rotation.x = -0.85; // leaning well back, like a card on a stand, so it faces a reader looking down
    holder.add(mesh);
    // a coloured base strip, so each card reads as its kind from across the table
    const base = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, 0.012, 0.16), edge);
    base.position.set(0, 0.006, -0.02);
    const pivot = new THREE.Group();
    pivot.add(holder, base);
    const n = Math.min(MAX_CARDS, this.cards.length + 1);
    const s = this.slot(n - 1, n);
    pivot.position.set(s.x, 0.02, s.z);
    this.stage.scene.add(pivot);
    const card: DeskCard = { item, pivot, mesh, disposables: [geo, edge, face, base.geometry, ...(tex ? [tex] : [])] };
    this.cards.push(card);
    if (fly) await this.flyIn(card);
    this.stage.invalidate();
  }

  /** The card leaves its place on the page in an arc and lands on the desk. */
  private async flyIn(c: DeskCard): Promise<void> {
    const where = this.model.figureRect(c.item.page, c.item.rect);
    if (!where) return;
    const end = c.pivot.position.clone();
    const start = where.centre.clone();
    const holder = c.mesh.parent!;
    const r0 = holder.rotation.x;
    const release = this.stage.hold();
    await this.stage.tween(820, (k) => {
      c.pivot.position.lerpVectors(start, end, k);
      c.pivot.position.y = start.y + Math.sin(Math.PI * k) * 1.1 + (end.y - start.y) * k;
      holder.rotation.x = -Math.PI / 2 + (r0 + Math.PI / 2) * k;
      holder.rotation.z = Math.sin(Math.PI * k) * 0.5;
    }, easeOut);
    holder.rotation.z = 0;
    release();
  }

  private remove(c: DeskCard): void {
    this.stage.scene.remove(c.pivot);
    c.disposables.forEach((d) => d.dispose());
    this.cards = this.cards.filter((x) => x !== c);
    this.stage.invalidate();
  }
}

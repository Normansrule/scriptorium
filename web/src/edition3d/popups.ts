/**
 * Pop-up book mode: when a spread opens, its figures, equations and self-checks rise off the page
 * as paper cards, hinged along their bottom edge and held up by folded paper struts, the way a
 * pop-up book's pieces stand when you open it. As a leaf starts to turn they fold flat again.
 *
 * Each card is the item cut from the printed page, so it always matches the print. Its edges and
 * back are printed in the item's colour (kinds.ts). Where a card stood up, the page underneath
 * shows plain paper with the soft shadow of a die-cut, as in a real pop-up.
 *
 * A chapter opener gets the centrepiece: a banner in the binding's cloth and headband colours with
 * the chapter's number and title, and in front of it a row of small tiles, one per kind of thing
 * inside the chapter (3 figures, 2 equations…), standing up one after another like a pop-up
 * book's layered scene.
 */
import * as THREE from 'three';
import type { BookModel } from './book.ts';
import { chapterCounts, chapterItems, cutOut, type Item } from './items.ts';
import { KIND, type ItemKind } from './kinds.ts';
import { easeInOut, easeOutBack, type Stage } from './stage.ts';
import type { Theme } from './theme.ts';
import { UNIT_PER_PT } from './book.ts';

const STAND = -0.28; // standing angle: leaning back about 16°, so the face turns to the reader
const FLAT = -Math.PI / 2;
const T = 0.01; // card thickness (thick enough for its coloured edge to show)

interface PopCard {
  item: Item;
  pivot: THREE.Group;
  card: THREE.Mesh;
  patch: THREE.Mesh | null;
  struts: THREE.Mesh[];
  w: number;
  h: number;
  angle: number;
  /** its folded and standing angles (banners stand straighter; tiles fold against their banner) */
  flat: number;
  stand: number;
  /** a count flap on a chapter banner (it has no hotspot of its own) */
  tile?: boolean;
  disposables: Array<{ dispose(): void }>;
}

function strutGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setIndex([0, 1, 2, 0, 2, 1]);
  return g;
}

/** A soft die-cut shadow on paper: darker towards the hinge, a hairline round the edge. */
function patchTexture(paper: string, edge: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = paper;
  g.fillRect(0, 0, 128, 128);
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.16)');
  grad.addColorStop(0.35, 'rgba(0,0,0,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = edge;
  g.globalAlpha = 0.55;
  g.setLineDash([6, 5]);
  g.lineWidth = 2;
  g.strokeRect(2, 2, 124, 124);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The back of a card: the item's colour with a fine dot pattern, like printed pop-up stock. */
function backTexture(color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.28)';
  for (let y = 4; y < 64; y += 8) for (let x = (y / 8) % 2 ? 8 : 4; x < 64; x += 8) g.fillRect(x - 1, y - 1, 2, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  return t;
}

/**
 * The card's printed face: the cut-out with a frame in the item's colour and a tab naming it,
 * like the coloured stock pop-up books are printed on.
 */
function framed(src: HTMLCanvasElement, color: string, ink: string, name: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  const m = Math.max(4, Math.round(src.width * 0.012));
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, m, m, c.width - 2 * m, c.height - 2 * m);
  // the name tab, top left
  const fs = Math.max(14, Math.round(src.width * 0.028));
  g.font = `600 ${fs}px "Source Sans 3", system-ui, sans-serif`;
  const tw = g.measureText(name).width + fs * 1.1;
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(m, m, tw, fs * 1.55, [0, 0, fs * 0.5, 0]);
  g.fill();
  g.fillStyle = ink;
  g.textBaseline = 'middle';
  g.fillText(name, m + fs * 0.55, m + fs * 0.8);
  return c;
}

/** Wrap text to lines no wider than `max` px (title lines on the banner). */
function wrapLines(g: CanvasRenderingContext2D, text: string, max: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width <= max || !line) line = t;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/\s*\S+$/, '')}…`;
    return kept;
  }
  return lines;
}

/** Where each count flap sits on the banner, as fractions of its width and height (from the top left). */
interface Flap {
  kind: ItemKind;
  n: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
function flapLayout(counts: ReturnType<typeof chapterCounts>): Flap[] {
  const h = 0.3;
  const w = Math.min(0.15, 0.86 / Math.max(1, counts.length) - 0.02);
  const gap = 0.02;
  const span = counts.length * w + (counts.length - 1) * gap;
  return counts.map((c, i) => ({ ...c, x: 0.5 - span / 2 + i * (w + gap), y: 0.6, w, h }));
}

/** The chapter banner: cloth ground, headband stripes, number and title, a gentle sunburst. */
function bannerCanvas(theme: Theme, number: number, title: string, aspect: number, flaps: Flap[]): HTMLCanvasElement {
  const W = 1200;
  const H = Math.round(W * aspect);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = theme.cloth;
  g.fillRect(0, 0, W, H);
  // sunburst rays from below, like the opening spread of a pop-up book
  g.save();
  g.globalAlpha = 0.09;
  g.fillStyle = '#ffffff';
  const cx = W / 2;
  const cy = H * 1.15;
  for (let i = 0; i < 18; i += 2) {
    const a0 = Math.PI + (i / 18) * Math.PI;
    const a1 = Math.PI + ((i + 1) / 18) * Math.PI;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a0) * W, cy + Math.sin(a0) * W);
    g.lineTo(cx + Math.cos(a1) * W, cy + Math.sin(a1) * W);
    g.closePath();
    g.fill();
  }
  g.restore();
  // headband stripes, top and bottom, with a stitched line
  const band = Math.round(H * 0.07);
  g.fillStyle = theme.headband;
  g.fillRect(0, 0, W, band);
  g.fillRect(0, H - band, W, band);
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.setLineDash([14, 10]);
  g.lineWidth = 3;
  for (const y of [band + 10, H - band - 10]) {
    g.beginPath();
    g.moveTo(16, y);
    g.lineTo(W - 16, y);
    g.stroke();
  }
  g.setLineDash([]);
  // the chapter number in a medallion
  const r = H * 0.15;
  const mx = band + r + 24;
  const my = flaps.length ? H * 0.34 : H / 2;
  g.fillStyle = theme.headband;
  g.beginPath();
  g.arc(mx, my, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(mx, my, r - 9, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = theme.ui.accentInk;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${Math.round(r * 1.05)}px "Source Serif 4", Georgia, serif`;
  g.fillText(String(number), mx, my + r * 0.06);
  // kicker and title
  const tx = mx + r + 36;
  const maxW = W - tx - 40;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillStyle = theme.headband;
  g.font = `600 ${Math.round(H * 0.09)}px "Source Sans 3", system-ui, sans-serif`;
  const top = flaps.length ? H * 0.2 : H * 0.32;
  g.fillText(`CHAPTER ${number}`, tx, top);
  g.fillStyle = '#ffffff';
  let fs = Math.round(H * 0.13);
  g.font = `700 ${fs}px "Source Serif 4", Georgia, serif`;
  let lines = wrapLines(g, title, maxW, 2);
  if (lines.length > 1) {
    fs = Math.round(H * 0.1);
    g.font = `700 ${fs}px "Source Serif 4", Georgia, serif`;
    lines = wrapLines(g, title, maxW, 2);
  }
  lines.forEach((l, i) => g.fillText(l, tx, top + fs * 1.12 * (i + 1)));
  // die-cut slots behind the flaps, and a small label
  if (flaps.length) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.strokeStyle = 'rgba(255,255,255,0.45)';
    g.lineWidth = 3;
    g.setLineDash([8, 7]);
    for (const f of flaps) {
      g.beginPath();
      g.roundRect(f.x * W, f.y * H, f.w * W, f.h * H, 14);
      g.fill();
      g.stroke();
    }
    g.setLineDash([]);
  }
  return c;
}

/** A count tile: the kind's colour, a big number and what it counts. */
function tileCanvas(kind: ItemKind, n: number, label: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 256;
  const g = c.getContext('2d')!;
  const k = KIND[kind];
  g.fillStyle = k.color;
  g.fillRect(0, 0, 320, 256);
  g.strokeStyle = 'rgba(255,255,255,0.65)';
  g.lineWidth = 6;
  g.beginPath();
  g.roundRect(12, 12, 296, 232, 18);
  g.stroke();
  g.fillStyle = k.ink;
  g.textAlign = 'center';
  g.font = '800 124px "Source Sans 3", system-ui, sans-serif';
  g.fillText(String(n), 160, 148);
  let fs = 44;
  g.font = `700 ${fs}px "Source Sans 3", system-ui, sans-serif`;
  while (g.measureText(label).width > 276 && fs > 24) g.font = `700 ${--fs}px "Source Sans 3", system-ui, sans-serif`;
  g.fillText(label, 160, 214);
  return c;
}

export class PopUps {
  private cards: PopCard[] = [];
  private enabled = true;
  private generation = 0;

  constructor(
    private stage: Stage,
    private model: BookModel,
    private items: Item[],
    private theme: Theme,
  ) {
    model.onTurnStart.add(() => void this.foldAll());
  }

  get on(): boolean {
    return this.enabled;
  }

  /** Switch pop-ups on or off (they rise on the current spread, or fold away). */
  async set(on: boolean, visible: Item[]): Promise<void> {
    this.enabled = on;
    if (on) await this.raise(visible);
    else await this.foldAll();
  }

  /** The visible spread changed: stand up its items. */
  async raise(visible: Item[]): Promise<void> {
    const gen = ++this.generation;
    this.clear();
    if (!this.enabled) return;
    const wanted = visible.filter((it) => it.kind !== 'explore'); // explorable boxes are page-sized: they stay flat
    const built: PopCard[] = [];
    for (const item of wanted) {
      const cs = await this.build(item);
      if (gen !== this.generation) return; // the reader turned on meanwhile
      built.push(...cs);
    }
    const release = this.stage.hold();
    await Promise.all(
      built.map(
        (c, i) =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              void this.stage.tween(c.tile ? 520 : 640, (k) => this.setAngle(c, c.flat + (c.stand - c.flat) * k), easeOutBack).then(resolve);
            }, c.tile ? 560 + i * 90 : 120 + i * 110), // flaps swing out once their banner is up
          ),
      ),
    );
    release();
  }

  /** Fold everything flat (quickly) and take it away. */
  async foldAll(): Promise<void> {
    this.generation++;
    const cards = this.cards;
    if (!cards.length) return;
    const from = cards.map((c) => c.angle);
    await this.stage.tween(180, (k) => cards.forEach((c, i) => this.setAngle(c, from[i]! + (c.flat - from[i]!) * k)), easeInOut);
    if (this.cards === cards) this.clear();
  }

  /** The four world corners of a standing card's face (for its hotspot), or null if it is not up. */
  corners(key: string): THREE.Vector3[] | null {
    const c = this.cards.find((x) => x.item.key === key && !x.tile);
    if (!c) return null;
    c.pivot.updateMatrixWorld(true);
    const z = T / 2 + 0.001;
    return [
      [-c.w / 2, c.h, z],
      [c.w / 2, c.h, z],
      [c.w / 2, 0, z],
      [-c.w / 2, 0, z],
    ].map(([x, y, zz]) => c.card.parent!.localToWorld(new THREE.Vector3(x, y, zz)));
  }

  isUp(key: string): boolean {
    return this.cards.some((c) => c.item.key === key);
  }

  private clear(): void {
    for (const c of this.cards) {
      this.stage.scene.remove(c.pivot, ...(c.patch ? [c.patch] : []), ...c.struts);
      c.disposables.forEach((d) => d.dispose());
    }
    this.cards = [];
    this.stage.invalidate();
  }

  private async build(item: Item): Promise<PopCard[]> {
    const where = this.model.figureRect(item.page, item.rect);
    if (!where) return [];
    if (item.kind === 'chapter') return this.buildChapter(item, where);
    const canvas = await cutOut(this.model, item);
    const w = item.rect.w * UNIT_PER_PT;
    const h = item.rect.h * UNIT_PER_PT;
    const [tl, , br] = [where.corners[0]!, where.corners[1]!, where.corners[2]!];
    const y = where.corners[0]!.y;
    const kind = KIND[item.kind];

    const face = canvas ? new THREE.CanvasTexture(framed(canvas, kind.color, kind.ink, item.name)) : null;
    if (face) {
      face.colorSpace = THREE.SRGBColorSpace;
      face.anisotropy = this.stage.renderer.capabilities.getMaxAnisotropy();
    }
    const back = backTexture(kind.color);
    const edgeMat = new THREE.MeshLambertMaterial({ color: kind.color });
    const faceMat = new THREE.MeshLambertMaterial(face ? { map: face } : { color: this.theme.paper });
    const backMat = new THREE.MeshLambertMaterial({ map: back });
    const geo = new THREE.BoxGeometry(w, h, T);
    const card = new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, backMat]);
    card.position.y = h / 2;
    card.castShadow = true;
    card.receiveShadow = true;
    const holder = new THREE.Group(); // rotates about the hinge
    holder.add(card);
    const pivot = new THREE.Group();
    pivot.position.set((tl.x + br.x) / 2, y + 0.002, br.z);
    pivot.add(holder);

    // where the card stood up, the page shows a die-cut in plain paper
    const patchTex = patchTexture(this.theme.paper, kind.color);
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: patchTex }));
    patch.rotation.x = -Math.PI / 2;
    patch.position.set((tl.x + br.x) / 2, y + 0.0015, (tl.z + br.z) / 2);
    patch.receiveShadow = true;

    // folded paper struts behind the card, a third of the way in from each side
    const strutMat = new THREE.MeshLambertMaterial({ color: kind.color, side: THREE.DoubleSide });
    const struts = [0, 1].map(() => {
      const m = new THREE.Mesh(strutGeometry(), strutMat);
      m.castShadow = true;
      return m;
    });

    this.stage.scene.add(pivot, patch, ...struts);
    const c: PopCard = { item, pivot, card, patch, struts, w, h, angle: FLAT, flat: FLAT, stand: STAND, disposables: [geo, edgeMat, faceMat, backMat, back, patchTex, patch.geometry, patch.material as THREE.Material, strutMat, ...struts.map((s) => s.geometry), ...(face ? [face] : [])] };
    this.cards.push(c);
    this.setAngle(c, FLAT);
    return [c];
  }

  /** A chapter opener: the banner, and a tile for each kind of thing inside. */
  private buildChapter(item: Item, where: NonNullable<ReturnType<BookModel['figureRect']>>): PopCard[] {
    if (item.ref.kind !== 'chapter') return [];
    const [tl, , br] = [where.corners[0]!, where.corners[1]!, where.corners[2]!];
    const y = tl.y;
    const w = item.rect.w * UNIT_PER_PT;
    const h = w * 0.36;
    const flaps = flapLayout(chapterCounts(chapterItems(item, this.items)));
    const face = new THREE.CanvasTexture(bannerCanvas(this.theme, item.ref.data.number, item.ref.data.title, h / w, flaps));
    face.colorSpace = THREE.SRGBColorSpace;
    face.anisotropy = this.stage.renderer.capabilities.getMaxAnisotropy();
    const back = backTexture(this.theme.headband);
    const edgeMat = new THREE.MeshLambertMaterial({ color: this.theme.headband });
    const faceMat = new THREE.MeshLambertMaterial({ map: face });
    const backMat = new THREE.MeshLambertMaterial({ map: back });
    const geo = new THREE.BoxGeometry(w, h, T * 1.4);
    const card = new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, backMat]);
    card.position.y = h / 2;
    card.castShadow = true;
    const holder = new THREE.Group();
    holder.add(card);
    const pivot = new THREE.Group();
    const cx = (tl.x + br.x) / 2;
    pivot.position.set(cx, y + 0.002, br.z);
    pivot.add(holder);
    const strutMat = new THREE.MeshLambertMaterial({ color: this.theme.headband, side: THREE.DoubleSide });
    const struts = [0, 1].map(() => {
      const m = new THREE.Mesh(strutGeometry(), strutMat);
      m.castShadow = true;
      return m;
    });
    this.stage.scene.add(pivot, ...struts);
    const banner: PopCard = { item, pivot, card, patch: null, struts, w, h, angle: FLAT, flat: FLAT, stand: -0.12, disposables: [geo, edgeMat, faceMat, backMat, face, back, strutMat, ...struts.map((s) => s.geometry)] };
    this.cards.push(banner);
    this.setAngle(banner, FLAT);
    const out = [banner];

    // the flaps: one per kind of thing inside, hinged along their top edge on the banner's lower
    // band; they swing out towards the reader, so the page underneath stays readable
    flaps.forEach((f) => {
      const tex = new THREE.CanvasTexture(tileCanvas(f.kind, f.n, f.label));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.stage.renderer.capabilities.getMaxAnisotropy();
      const color = KIND[f.kind].color;
      const tEdge = new THREE.MeshLambertMaterial({ color });
      const tFace = new THREE.MeshLambertMaterial({ map: tex });
      const tGeo = new THREE.BoxGeometry(f.w * w, f.h * h, T);
      const tCard = new THREE.Mesh(tGeo, [tEdge, tEdge, tEdge, tEdge, tFace, tEdge]);
      tCard.position.y = (-f.h * h) / 2; // hangs below its hinge
      tCard.castShadow = true;
      const tHolder = new THREE.Group();
      tHolder.add(tCard);
      const tPivot = new THREE.Group();
      tPivot.position.set((f.x - 0.5) * w + (f.w * w) / 2, (1 - f.y) * h, T * 0.7 + T / 2);
      tPivot.add(tHolder);
      holder.add(tPivot);
      const tile: PopCard = { item, pivot: tPivot, card: tCard, patch: null, struts: [], w: f.w * w, h: f.h * h, angle: 0, flat: 0, stand: -0.55, tile: true, disposables: [tGeo, tEdge, tFace, tex] };
      this.cards.push(tile);
      this.setAngle(tile, 0);
      out.push(tile);
    });
    return out;
  }

  private setAngle(c: PopCard, a: number): void {
    c.angle = a;
    const holder = c.card.parent!;
    holder.rotation.x = a;
    // the strut: hinge point on the page, a point behind it on the page, and a point on the card's back
    const up = Math.max(0, (a - c.flat) / (c.stand - c.flat));
    const hb = c.h * 0.42;
    const depth = hb * 0.75;
    c.pivot.updateMatrixWorld(true);
    c.struts.forEach((s, i) => {
      const x = (i === 0 ? -1 : 1) * c.w * 0.3;
      const onCard = holder.localToWorld(new THREE.Vector3(x, hb, -T / 2 - 0.001));
      const hinge = c.pivot.localToWorld(new THREE.Vector3(x, 0, -0.01));
      const behind = c.pivot.localToWorld(new THREE.Vector3(x, 0, -depth));
      const pos = s.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, hinge.x, hinge.y, hinge.z);
      pos.setXYZ(1, behind.x, behind.y, behind.z);
      pos.setXYZ(2, onCard.x, onCard.y, onCard.z);
      pos.needsUpdate = true;
      s.geometry.computeVertexNormals();
      s.geometry.computeBoundingSphere();
      s.visible = up > 0.08;
    });
    if (c.patch) c.patch.visible = up > 0.02;
    this.stage.invalidate();
  }
}

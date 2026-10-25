/**
 * The physical book: cloth covers, two page blocks whose thickness follows your place in the
 * book, the open spread with pages curving into the gutter, and a leaf that bends as it turns.
 *
 * Coordinates: the spine runs along z at x = 0; the right page spans x ∈ [0, W], the left page
 * x ∈ [−W, 0]; the top of the page is at z = −H/2. One unit is 100 points (1/72 in) of paper.
 */
import * as THREE from 'three';
import type { Book3D } from '../../../src/edition3d/manifest.ts';
import { easeInOut, type Stage } from './stage.ts';
import type { Theme } from './theme.ts';

export const UNIT_PER_PT = 0.01;
const SEG = 48; // segments across a page: enough for a smooth bend, cheap to update on the CPU
const ROWS = 8; // segments down a page: long thin triangles leave hairline cracks on some GPUs
const R1 = ROWS + 1;
const COVER = 0.055;
const OVERHANG = 0.09;

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A woven-cloth bump: fine crossing threads, so the cover catches light like bookcloth. */
function clothTexture(color: string): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const map = canvasTexture(256, 256, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
    }
  });
  const bump = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 256; i += 2) {
      g.fillStyle = i % 4 ? '#9a9a9a' : '#6a6a6a';
      g.fillRect(0, i, 256, 1);
      g.fillRect(i, 0, 1, 256);
    }
  });
  for (const t of [map, bump]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6, 9);
  }
  bump.colorSpace = THREE.NoColorSpace;
  return { map, bump };
}

/** Endpaper: a quiet repeat of the book's mark in the cloth colour on paper. */
function endpaperTexture(theme: Theme): THREE.CanvasTexture {
  return canvasTexture(432, 648, (g) => {
    g.fillStyle = theme.paper;
    g.fillRect(0, 0, 432, 648);
    g.strokeStyle = theme.cloth;
    g.globalAlpha = 0.22;
    g.lineWidth = 2;
    for (let y = 0; y < 648; y += 36) {
      for (let x = (y / 36) % 2 ? 18 : 0; x < 432; x += 36) {
        g.strokeRect(x + 10, y + 8, 16, 20);
        g.beginPath();
        g.moveTo(x + 13, y + 15);
        g.lineTo(x + 23, y + 15);
        g.moveTo(x + 13, y + 21);
        g.lineTo(x + 20, y + 21);
        g.stroke();
      }
    }
  });
}

/** Fine lines for the edges of the page block. */
function pageEdgeTexture(paper: string): THREE.CanvasTexture {
  const t = canvasTexture(64, 256, (g) => {
    g.fillStyle = paper;
    g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 2) {
      g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.06})`;
      g.fillRect(0, y, 64, 1);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A page surface: SEG × 1 quads lying in the xz-plane, facing +y, with per-vertex x set later. */
function pageGeometry(W: number, H: number, flipU: boolean): THREE.BufferGeometry {
  const pos = new Float32Array((SEG + 1) * R1 * 3);
  const uv = new Float32Array((SEG + 1) * R1 * 2);
  const idx: number[] = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    for (let j = 0; j <= ROWS; j++) {
      const k = i * R1 + j;
      const v = j / ROWS;
      pos[k * 3] = u * W;
      pos[k * 3 + 1] = 0;
      pos[k * 3 + 2] = -H / 2 + v * H;
      uv[k * 2] = flipU ? 1 - u : u;
      uv[k * 2 + 1] = 1 - v;
    }
    if (i < SEG) {
      for (let j = 0; j < ROWS; j++) {
        const a = i * R1 + j;
        // winding so the front face looks up (+y)
        idx.push(a, a + 1, a + R1, a + R1, a + 1, a + R1 + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Shape a page that lies flat on its block: it dips into the gutter near the spine. */
function layFlat(g: THREE.BufferGeometry, W: number, side: 1 | -1, y: number, dip: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    // the left page's geometry runs from its outer edge (u = 0) to the spine (u = 1)
    const fromSpine = side === 1 ? u : 1 - u;
    const s = Math.min(1, fromSpine / 0.22);
    const sink = dip * (1 - s * s * (3 - 2 * s)); // smoothstep down into the gutter
    for (let j = 0; j <= ROWS; j++) {
      pos.setX(i * R1 + j, side === 1 ? u * W : -W + u * W);
      pos.setY(i * R1 + j, y - sink);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

export interface Spread {
  /** page index (0-based) on the left, or −1 for the inside of the front cover */
  left: number;
  /** page index on the right, or −1 past the last page */
  right: number;
}

export class BookModel {
  readonly group = new THREE.Group();
  readonly W: number;
  readonly H: number;
  /** leaves turned so far (0 = the book opened at the first page) */
  leaf = 0;
  readonly leaves: number;
  private left: THREE.Mesh;
  private right: THREE.Mesh;
  private turnFront: THREE.Mesh;
  private turnBack: THREE.Mesh;
  private leftBlock: THREE.Mesh;
  private rightBlock: THREE.Mesh;
  private gutter: THREE.Mesh;
  private textures = new Map<number, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  private blank: THREE.Texture;
  private endpaper: THREE.Texture;
  private readonly t: number;
  readonly onSpread = new Set<(s: Spread) => void>();

  constructor(
    private stage: Stage,
    private book: Book3D,
    private base: string,
    theme: Theme,
    /** scene-kit previews: every page is blank paper */
    private blankPages = false,
  ) {
    this.W = book.page.width * UNIT_PER_PT;
    this.H = book.page.height * UNIT_PER_PT;
    this.leaves = Math.ceil(book.pages.length / 2);
    // Page thickness is exaggerated so a short sample book still reads as a book.
    this.t = Math.max(0.0025, Math.min(0.006, 0.35 / Math.max(1, this.leaves)));
    const { W, H } = this;

    const cloth = clothTexture(theme.cloth);
    const coverMat = new THREE.MeshStandardMaterial({ map: cloth.map, bumpMap: cloth.bump, bumpScale: 0.6, roughness: 0.82, color: 0xffffff });
    const board = new THREE.BoxGeometry(W + OVERHANG, COVER, H + OVERHANG * 2);
    for (const side of [-1, 1]) {
      const cover = new THREE.Mesh(board, coverMat);
      // boards sit a little into the table so their tops stay well clear of the paper above them
      cover.position.set(side * ((W + OVERHANG) / 2 + 0.02), COVER / 2 - 0.03, 0);
      // Covers lie under the pages; letting them cast shadows only produces acne along the gutter.
      cover.receiveShadow = true;
      this.group.add(cover);
    }
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.08, COVER * 0.6, H + OVERHANG * 2), coverMat);
    spine.position.y = COVER * 0.3;
    this.group.add(spine);
    // Paper fills the gutter under the two pages: where the pages meet, multisampling can leave a
    // hairline of partial coverage, and paper there is invisible where cloth would show.
    this.gutter = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, H - 0.02), new THREE.MeshLambertMaterial({ color: theme.paper }));
    this.group.add(this.gutter);
    const band = new THREE.MeshStandardMaterial({ color: theme.headband, roughness: 0.6 });
    for (const z of [-H / 2 - 0.012, H / 2 + 0.012]) {
      const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 12), band);
      hb.rotation.z = Math.PI / 2;
      hb.position.set(0, COVER + 0.03, z);
      this.group.add(hb);
    }

    const edge = pageEdgeTexture(theme.paper);
    const edgeMat = new THREE.MeshStandardMaterial({ map: edge, roughness: 0.95 });
    const paperMat = new THREE.MeshStandardMaterial({ color: theme.paper, roughness: 0.95 });
    const blockMats = [edgeMat, edgeMat, paperMat, paperMat, edgeMat, edgeMat];
    this.leftBlock = new THREE.Mesh(new THREE.BoxGeometry(W - 0.03, 1, H - 0.02), blockMats);
    this.rightBlock = new THREE.Mesh(new THREE.BoxGeometry(W - 0.03, 1, H - 0.02), blockMats);
    for (const b of [this.leftBlock, this.rightBlock]) {
      b.castShadow = b.receiveShadow = true;
      this.group.add(b);
    }

    this.blank = canvasTexture(8, 8, (g) => {
      g.fillStyle = theme.paper;
      g.fillRect(0, 0, 8, 8);
    });
    this.endpaper = endpaperTexture(theme);
    // Paper is matte: Lambert shading (no specular term) is both right for paper and cheaper.
    const pageMat = (back = false) => new THREE.MeshLambertMaterial({ map: this.blank, side: back ? THREE.BackSide : THREE.FrontSide });
    this.left = new THREE.Mesh(pageGeometry(W, H, false), pageMat());
    this.right = new THREE.Mesh(pageGeometry(W, H, false), pageMat());
    this.turnFront = new THREE.Mesh(pageGeometry(W, H, false), pageMat());
    this.turnBack = new THREE.Mesh(pageGeometry(W, H, true), pageMat(true));
    for (const m of [this.left, this.right, this.turnFront, this.turnBack]) {
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.turnFront.castShadow = this.turnBack.castShadow = true;
    this.turnFront.visible = this.turnBack.visible = false;
    stage.scene.add(this.group);
    this.layout();
  }

  /** Stack heights for a given number of turned leaves. */
  private heights(leaf: number): { l: number; r: number } {
    const n = this.leaves;
    return { l: COVER + 0.004 + leaf * this.t, r: COVER + 0.004 + (n - leaf) * this.t };
  }

  get spread(): Spread {
    const n = this.book.pages.length;
    const left = this.leaf === 0 ? -1 : 2 * this.leaf - 1;
    const right = 2 * this.leaf < n ? 2 * this.leaf : -1;
    return { left, right };
  }

  /** The surface height of a page side (for placing figures and hotspots). */
  surfaceY(side: 'left' | 'right'): number {
    const h = this.heights(this.leaf);
    return side === 'left' ? h.l : h.r;
  }

  private texture(index: number): THREE.Texture {
    if (this.blankPages || index < 0 || index >= this.book.pages.length) return this.blank;
    let t = this.textures.get(index);
    if (!t) {
      t = this.loader.load(new URL(this.book.pages[index]!, this.base).href, () => this.stage.invalidate());
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.stage.renderer.capabilities.getMaxAnisotropy();
      this.textures.set(index, t);
    }
    return t;
  }

  /** Load the pages around the current spread, release the rest (memory stays flat in long books). */
  private keepNear(): void {
    const s = this.spread;
    const centre = Math.max(s.left, s.right, 0);
    for (let i = centre - 4; i <= centre + 5; i++) this.texture(i);
    for (const [i, t] of this.textures) {
      if (Math.abs(i - centre) > 8) {
        t.dispose();
        this.textures.delete(i);
      }
    }
  }

  private setMap(m: THREE.Mesh, t: THREE.Texture): void {
    const mat = m.material as THREE.MeshLambertMaterial;
    if (mat.map !== t) {
      mat.map = t;
      mat.needsUpdate = true;
    }
  }

  /** Put blocks and the two flat pages where they belong for the current leaf. */
  private layout(leftLeaf = this.leaf, rightLeaf = this.leaf): void {
    const { W } = this;
    const hl = this.heights(leftLeaf).l;
    const hr = this.heights(rightLeaf).r;
    const lb = Math.max(0.002, hl - COVER);
    const rb = Math.max(0.002, hr - COVER);
    // The page dips into the gutter; the block's top sits just under that lowest point so it
    // never shows through the curved page.
    const dipL = Math.min(0.035, (hl - COVER) * 0.8);
    const dipR = Math.min(0.035, (hr - COVER) * 0.8);
    const lbTop = Math.max(0.002, lb - dipL - 0.002);
    const rbTop = Math.max(0.002, rb - dipR - 0.002);
    this.leftBlock.scale.y = lbTop;
    this.leftBlock.position.set(-W / 2 - 0.005, COVER + lbTop / 2, 0);
    this.rightBlock.scale.y = rbTop;
    this.rightBlock.position.set(W / 2 + 0.005, COVER + rbTop / 2, 0);
    this.leftBlock.visible = leftLeaf > 0;
    const gTop = Math.min(hl - dipL, hr - dipR) - 0.001;
    this.gutter.scale.y = Math.max(0.002, gTop - COVER * 0.6);
    this.gutter.position.set(0, COVER * 0.6 + this.gutter.scale.y / 2, 0);
    layFlat(this.left.geometry, W, -1, hl + 0.002, dipL);
    layFlat(this.right.geometry, W, 1, hr + 0.002, dipR);
    const s = this.spreadAt(leftLeaf, rightLeaf);
    this.setMap(this.left, s.left < 0 ? this.endpaper : this.texture(s.left));
    this.setMap(this.right, this.texture(s.right));
    this.stage.invalidate();
  }

  private spreadAt(leftLeaf: number, rightLeaf: number): Spread {
    const n = this.book.pages.length;
    return { left: leftLeaf === 0 ? -1 : 2 * leftLeaf - 1, right: 2 * rightLeaf < n ? 2 * rightLeaf : -1 };
  }

  /** Bend the turning leaf. p: 0 = lying on the right, 1 = lying on the left. */
  private bend(p: number, forward: boolean): void {
    const { W } = this;
    const from = forward ? this.leaf : this.leaf - 1;
    const yR = this.heights(from).r + 0.003;
    const yL = this.heights(from + 1).l + 0.003;
    const theta = p * Math.PI;
    const lag = 0.7 * Math.sin(Math.PI * p);
    const du = W / SEG;
    for (const mesh of [this.turnFront, this.turnBack]) {
      const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      let x = 0;
      let y = 0;
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG;
        for (let j = 0; j <= ROWS; j++) {
          pos.setX(i * R1 + j, x);
          pos.setY(i * R1 + j, y + yR + (yL - yR) * p);
        }
        // the free edge lags behind the motion, which is what makes paper look like paper
        const phi = Math.min(Math.PI, Math.max(0, theta - (forward ? 1 : -1) * lag * u ** 1.35));
        x += Math.cos(phi) * du;
        y += Math.sin(phi) * du;
      }
      pos.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();
    }
  }

  /** Turn one leaf forward (+1) or back (−1). Resolves when the leaf lands. */
  async turn(dir: 1 | -1, fromProgress = 0): Promise<boolean> {
    if (this.stage.busy) this.stage.flush();
    if (dir === 1 && 2 * this.leaf >= this.book.pages.length) return false;
    if (dir === -1 && this.leaf === 0) return false;
    const forward = dir === 1;
    const L = forward ? this.leaf : this.leaf - 1; // the physical leaf that moves
    const n = this.book.pages.length;
    this.setMap(this.turnFront, this.texture(2 * L < n ? 2 * L : -1));
    this.setMap(this.turnBack, this.texture(2 * L + 1 < n ? 2 * L + 1 : -1));
    // underneath: the page that will be revealed
    if (forward) this.layout(this.leaf, this.leaf + 1);
    else this.layout(this.leaf - 1, this.leaf);
    this.turnFront.visible = this.turnBack.visible = true;
    const release = this.stage.hold();
    const start = forward ? fromProgress : 1 - fromProgress;
    const end = forward ? 1 : 0;
    await this.stage.tween(520 * Math.abs(end - start) + 80, (k) => this.bend(start + (end - start) * k, forward), easeInOut);
    release();
    this.leaf += dir;
    this.turnFront.visible = this.turnBack.visible = false;
    this.layout();
    this.keepNear();
    this.onSpread.forEach((f) => f(this.spread));
    return true;
  }

  /** Dragging a page corner: show the leaf at progress p without committing. */
  dragTo(dir: 1 | -1, p: number): void {
    const forward = dir === 1;
    const L = forward ? this.leaf : this.leaf - 1;
    if (L < 0 || 2 * L >= this.book.pages.length) return;
    const n = this.book.pages.length;
    if (!this.turnFront.visible) {
      this.setMap(this.turnFront, this.texture(2 * L));
      this.setMap(this.turnBack, this.texture(2 * L + 1 < n ? 2 * L + 1 : -1));
      if (forward) this.layout(this.leaf, this.leaf + 1);
      else this.layout(this.leaf - 1, this.leaf);
      this.turnFront.visible = this.turnBack.visible = true;
    }
    this.bend(forward ? p : 1 - p, forward);
    this.stage.invalidate();
  }

  /** Let go of a drag: finish the turn or fall back. */
  async release(dir: 1 | -1, p: number, commit: boolean): Promise<void> {
    if (commit) {
      await this.turn(dir, p);
      return;
    }
    const forward = dir === 1;
    const release = this.stage.hold();
    await this.stage.tween(260, (k) => this.bend(forward ? p * (1 - k) : 1 - p * (1 - k), forward));
    release();
    this.turnFront.visible = this.turnBack.visible = false;
    this.layout();
  }

  goToPage(index: number): void {
    this.stage.flush();
    // page index 0 is alone on the right; then 1|2, 3|4 … share a spread
    this.leaf = Math.max(0, Math.min(this.leaves, Math.ceil(index / 2)));
    this.layout();
    this.keepNear();
    this.onSpread.forEach((f) => f(this.spread));
  }

  start(): void {
    this.keepNear();
    this.layout();
    this.onSpread.forEach((f) => f(this.spread));
  }

  /** World-space rectangle of a figure on the visible spread, or null if its page is not open. */
  figureRect(page: number, rect: { x: number; y: number; w: number; h: number }): { side: 'left' | 'right'; corners: THREE.Vector3[]; centre: THREE.Vector3 } | null {
    const s = this.spread;
    const index = page - 1;
    const side = index === s.left ? 'left' : index === s.right ? 'right' : null;
    if (!side) return null;
    const x0 = (side === 'left' ? -this.W : 0) + rect.x * UNIT_PER_PT;
    const z0 = -this.H / 2 + rect.y * UNIT_PER_PT;
    const w = rect.w * UNIT_PER_PT;
    const h = rect.h * UNIT_PER_PT;
    const y = this.surfaceY(side) + 0.006;
    const corners = [new THREE.Vector3(x0, y, z0), new THREE.Vector3(x0 + w, y, z0), new THREE.Vector3(x0 + w, y, z0 + h), new THREE.Vector3(x0, y, z0 + h)];
    return { side, corners, centre: new THREE.Vector3(x0 + w / 2, y, z0 + h / 2) };
  }

  /** Which side of the spread a world x falls on. */
  sideAt(x: number): 'left' | 'right' {
    return x < 0 ? 'left' : 'right';
  }
}

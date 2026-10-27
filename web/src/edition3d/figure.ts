/**
 * Pop-off figures: a figure rises from its place on the page, the camera leans in, and the
 * controls for what this kind of figure can do appear. Closing reverses it, back onto the page.
 */
import * as THREE from 'three';
import type { Explorable3D, Figure3D } from '../../../src/edition3d/manifest.ts';
import { compile } from '../../../src/core/expr.ts';
import { exploreContent, el as panelEl } from './panel.ts';
import type { BookModel } from './book.ts';
import { ICON } from './icons.ts';
import { capacitorKit } from './kits/capacitor.ts';
import { cellKit } from './kits/cell.ts';
import { mosfetKit } from './kits/mosfet.ts';
import { rcLoopKit } from './kits/rc-loop.ts';
import { vesselKit } from './kits/vessel.ts';
import { vseprKit } from './kits/vsepr.ts';
import { liftCard, moleculeObject, type FigureObject } from './objects.ts';
import { easeInOut, easeOut, type Stage } from './stage.ts';
import type { Theme } from './theme.ts';

export const KITS: Record<string, () => FigureObject> = { mosfet: mosfetKit, capacitor: capacitorKit, 'rc-loop': rcLoopKit, vessel: vesselKit, cell: cellKit, vsepr: vseprKit };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

export class FigureView {
  private obj: FigureObject | null = null;
  private fig: Figure3D | null = null;
  private ghost: THREE.Group | null = null;
  private yaw = 0;
  private pitch = 0;
  private vYaw = 0;
  private vPitch = 0;
  private dragging = false;
  private time = 0;
  private playing = false;
  private release: (() => void) | null = null;
  private from: { pos: THREE.Vector3; quat: THREE.Quaternion; scale: number } | null = null;
  private readonly pose = new THREE.Vector3(0, 2.2, 1.0);
  private readonly dock: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly labelLayer: HTMLElement;
  private readonly status: HTMLElement;
  private labelEls: HTMLElement[] = [];
  private bookPose: CameraPose | null = null;
  private returnFocus: HTMLElement | null = null;
  /** Called after a figure is back on its page, with that figure (so focus can return to it). */
  onClose: ((fig: Figure3D) => void) | null = null;
  /** Explorables in the book that can drive this figure's scene (their `drives` name its kit). */
  driversFor: ((fig: Figure3D) => Explorable3D[]) | null = null;
  /** Extra buttons for the dock (Keep on desk…), made fresh for each figure. */
  toolsFor: ((fig: Figure3D) => HTMLElement[]) | null = null;
  /** extra content for the caption panel (what this figure is connected to) */
  extrasFor: ((fig: Figure3D) => HTMLElement | null) | null = null;
  private drive: HTMLElement | null = null;

  constructor(
    private stage: Stage,
    private book: BookModel | null,
    private base: string,
    private theme: Theme,
    private ui: HTMLElement,
    private getBookPose: () => CameraPose,
    private announce: (s: string) => void,
  ) {
    this.dock = el('div', { class: 'dock', role: 'toolbar', 'aria-label': 'Figure controls', hidden: '' });
    this.caption = el('aside', { class: 'fig-caption', hidden: '', 'aria-live': 'polite' });
    this.labelLayer = el('div', { class: 'labels', 'aria-hidden': 'true' });
    this.status = el('p', { class: 'fig-status', role: 'status' });
    ui.append(this.labelLayer, this.caption, this.dock);
    stage.afterRender.add(() => this.placeLabels());
    stage.onFrame((dt) => this.frame(dt));
    const canvas = stage.renderer.domElement;
    let last: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.obj || this.dragging) return; // ignore a second finger
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.vYaw = this.vPitch = 0;
      this.hold();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging || !last) return;
      const now = performance.now();
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      this.yaw += dx * 0.009;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + dy * 0.009));
      const dt = Math.max(1, now - last.t);
      this.vYaw = (dx * 0.009) / dt * 16;
      this.vPitch = (dy * 0.009) / dt * 16;
      last = { x: e.clientX, y: e.clientY, t: now };
      this.applyRotation();
    });
    const end = () => {
      this.dragging = false;
      last = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  get isOpen(): boolean {
    return !!this.obj;
  }

  private hold(): void {
    if (!this.release) this.release = this.stage.hold();
  }

  private settle(): void {
    if (this.release && !this.dragging && !this.playing && Math.abs(this.vYaw) + Math.abs(this.vPitch) < 1e-4 && !this.obj?.tick) {
      this.release();
      this.release = null;
    }
  }

  private frame(dt: number): void {
    if (!this.obj) return;
    if (!this.dragging && Math.abs(this.vYaw) + Math.abs(this.vPitch) > 1e-4) {
      // momentum after a flick, with friction
      this.yaw += this.vYaw;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch + this.vPitch));
      this.vYaw *= 0.92;
      this.vPitch *= 0.92;
      this.applyRotation();
    }
    if (this.playing && this.obj.setTime) {
      this.time = (this.time + dt / (this.obj.duration ?? 8)) % 1;
      this.setTime(this.time, true);
    }
    this.obj.tick?.(dt);
    this.settle();
  }

  private applyRotation(): void {
    if (!this.obj) return;
    this.obj.group.quaternion.setFromEuler(new THREE.Euler(this.pitch - 0.35, this.yaw, 0, 'YXZ'));
    this.stage.invalidate();
  }

  /** Open a figure that sits on the visible spread (or, for a kit preview, from the page centre). */
  async open(fig: Figure3D, trigger?: HTMLElement, opts: { drive?: Explorable3D } = {}): Promise<void> {
    if (this.obj) await this.close();
    const t = fig.treatment;
    let obj: FigureObject;
    if (t.mode === 'model' && fig.asset) {
      const data = await (await fetch(new URL(fig.asset, this.base))).json();
      obj = moleculeObject(data, fig.atomScale ?? 1);
    } else if (t.mode === 'scene' && KITS[t.kit]) {
      obj = KITS[t.kit]!();
    } else if (t.mode === 'lift' && fig.asset) {
      const tex = await new THREE.TextureLoader().loadAsync(new URL(fig.asset, this.base).href);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.stage.renderer.capabilities.getMaxAnisotropy();
      obj = liftCard(tex, tex.image.height / tex.image.width, this.theme.paper);
    } else return;
    // frame by the object's real size, measured upright at scale 1 — at both ends of its timeline,
    // so a part that grows (a cell, a vessel) stays in view when it plays
    const box = new THREE.Box3().setFromObject(obj.group);
    if (obj.setTime) {
      obj.setTime(1);
      box.union(new THREE.Box3().setFromObject(obj.group));
      obj.setTime(0);
    }
    if (!box.isEmpty()) {
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      obj.radius = sphere.radius;
      // centre the object on its group origin, so it rotates about its middle
      for (const child of obj.group.children) child.position.sub(sphere.center);
    }
    this.obj = obj;
    this.fig = fig;
    this.returnFocus = trigger ?? null;
    this.yaw = t.mode === 'lift' ? 0 : -0.5;
    this.pitch = t.mode === 'lift' ? 0.2 : 0;
    this.time = 0;
    this.playing = false;

    // where it starts: lying on its page, the size of the printed figure
    const where = this.book?.figureRect(fig.page, fig.rect);
    const centre = where?.centre ?? new THREE.Vector3(this.book ? this.book.W / 2 : 0, 0.3, 0);
    const widthOnPage = where ? where.corners[0]!.distanceTo(where.corners[1]!) : 2.5;
    const startScale = Math.max(0.05, widthOnPage / (obj.radius * 2));
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    this.from = { pos: centre.clone(), quat: flat, scale: startScale };
    obj.group.position.copy(centre);
    obj.group.quaternion.copy(flat);
    obj.group.scale.setScalar(startScale);
    this.stage.scene.add(obj.group);
    if (where) this.ghost = this.makeGhost(where.corners);

    // camera leans in
    this.bookPose = this.getBookPose();
    const lean = this.leanPose(obj.radius);
    const endQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch - 0.35, this.yaw, 0, 'YXZ'));
    const cam = this.stage.camera;
    const camFrom = cam.position.clone();
    const tgtFrom = this.bookPose.target.clone();
    const release = this.stage.hold();
    this.buildDock(obj);
    this.showCaption(fig);
    await this.stage.tween(760, (k) => {
      obj.group.position.lerpVectors(centre, this.pose, k);
      obj.group.quaternion.slerpQuaternions(flat, endQuat, k);
      obj.group.scale.setScalar(startScale + (1 - startScale) * k);
      cam.position.lerpVectors(camFrom, lean.position, k);
      cam.lookAt(new THREE.Vector3().lerpVectors(tgtFrom, lean.target, k));
    }, easeOut);
    release();
    if (obj.setTime) this.setTime(0);
    this.hold();
    this.announce(`Figure ${fig.number} opened in 3D. Drag or use the arrow keys to rotate. Escape puts it back on the page.`);
    (this.dock.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
    if (opts.drive) this.attachDriver(opts.drive);
  }

  async close(): Promise<void> {
    const obj = this.obj;
    const fig = this.fig;
    if (!obj || !this.from || !fig) return;
    this.playing = false;
    this.dock.hidden = true;
    this.caption.hidden = true;
    this.detachDriver();
    this.labelEls.forEach((l) => l.remove());
    this.labelEls = [];
    obj.setExplode(0);
    obj.setCut(0);
    obj.setXray(false);
    const from = this.from;
    const pos0 = obj.group.position.clone();
    const q0 = obj.group.quaternion.clone();
    const s0 = obj.group.scale.x;
    const cam = this.stage.camera;
    const camFrom = cam.position.clone();
    const back = this.bookPose ?? this.getBookPose();
    const tgt0 = this.leanPose(obj.radius).target;
    const release = this.stage.hold();
    await this.stage.tween(520, (k) => {
      obj.group.position.lerpVectors(pos0, from.pos, k);
      obj.group.quaternion.slerpQuaternions(q0, from.quat, k);
      obj.group.scale.setScalar(s0 + (from.scale - s0) * k);
      cam.position.lerpVectors(camFrom, back.position, k);
      cam.lookAt(new THREE.Vector3().lerpVectors(tgt0, back.target, k));
    }, easeInOut);
    release();
    this.stage.scene.remove(obj.group);
    obj.dispose();
    if (this.ghost) {
      this.stage.scene.remove(this.ghost);
      this.ghost = null;
    }
    this.obj = null;
    this.fig = null;
    if (this.release) {
      this.release();
      this.release = null;
    }
    this.stage.invalidate();
    this.onClose?.(fig);
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
  }

  /** Where the camera goes so the figure fills about two thirds of the shorter screen side. */
  private leanPose(radius: number): CameraPose {
    const cam = this.stage.camera;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const fov = Math.min(vfov, hfov);
    const d = radius / Math.tan(fov / 2) / 0.82;
    const a = (24 * Math.PI) / 180;
    const target = this.pose.clone();
    return { position: target.clone().add(new THREE.Vector3(0, Math.sin(a) * d, Math.cos(a) * d)), target };
  }

  private makeGhost(c: THREE.Vector3[]): THREE.Group {
    const g = new THREE.Group();
    const shape = new THREE.BufferGeometry().setFromPoints(c);
    shape.setIndex([0, 1, 2, 0, 2, 3]);
    const fill = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: this.theme.cloth, transparent: true, opacity: 0.14, depthWrite: false }));
    const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(c.map((p) => p.clone().setY(p.y + 0.002))), new THREE.LineDashedMaterial({ color: this.theme.headband, dashSize: 0.06, gapSize: 0.04 }));
    line.computeLineDistances();
    g.add(fill, line);
    this.stage.scene.add(g);
    return g;
  }

  private setTime(t: number, fromPlay = false): void {
    if (!this.obj?.setTime) return;
    this.time = t;
    const msg = this.obj.setTime(t);
    this.status.textContent = msg;
    const range = this.dock.querySelector<HTMLInputElement>('input[name="time"]');
    if (range && fromPlay) range.value = String(Math.round(t * 1000));
    this.stage.invalidate();
  }

  private showCaption(fig: Figure3D): void {
    const kit = fig.treatment.mode === 'scene' ? ' This scene comes from a scene kit: it shows the structure schematically, not to scale.' : '';
    const scale = fig.scale === 'to-scale' ? ' Coordinates are to scale.' : fig.scale === 'schematic' ? ' Schematic: shape only, not to scale.' : '';
    this.caption.innerHTML = '';
    const h = el('p', { class: 'cap-title' });
    h.textContent = fig.number ? `Figure ${fig.number}` : 'Scene kit preview';
    const p = el('p', { class: 'cap-text' });
    p.textContent = fig.caption;
    const c = el('p', { class: 'cap-credit' });
    c.textContent = `${fig.credit}${scale}${kit}`;
    const alt = el('p', { class: 'sr-only' });
    alt.textContent = `Description: ${fig.alt}`;
    this.caption.append(h, p, c, alt, this.status);
    const extra = this.extrasFor?.(fig);
    if (extra) this.caption.append(extra);
    this.status.textContent = '';
    this.caption.hidden = false;
  }

  private buildDock(obj: FigureObject): void {
    const d = this.dock;
    d.innerHTML = '';
    const a = obj.abilities;
    const toggle = (name: string, icon: string, label: string, on: (v: boolean) => void, key: string) => {
      const b = el('button', { type: 'button', class: 'tool', 'aria-pressed': 'false', 'aria-keyshortcuts': key, title: `${label} (${key})` }, `${icon}<span>${label}</span>`);
      b.dataset.name = name;
      b.addEventListener('click', () => {
        const v = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(v));
        on(v);
        this.stage.invalidate();
      });
      return b;
    };
    const slider = (name: string, icon: string, label: string, on: (k: number) => void) => {
      const wrap = el('label', { class: 'tool slider' }, `${icon}<span>${label}</span>`);
      const r = el('input', { type: 'range', name, min: '0', max: '1000', value: '0', 'aria-label': label });
      r.addEventListener('input', () => {
        on(Number(r.value) / 1000);
        this.stage.invalidate();
      });
      wrap.append(r);
      return wrap;
    };
    if (a.animate && obj.setTime) {
      const play = el('button', { type: 'button', class: 'tool primary', 'aria-pressed': 'false', 'aria-keyshortcuts': 'Space', title: 'Play the process (Space)' }, `${ICON.play}<span>Play</span>`);
      play.addEventListener('click', () => this.togglePlay(play));
      play.dataset.name = 'play';
      d.append(play, slider('time', '', 'Timeline', (k) => {
        this.playing = false;
        play.setAttribute('aria-pressed', 'false');
        play.innerHTML = `${ICON.play}<span>Play</span>`;
        this.setTime(k);
      }));
    }
    if (a.cutaway) d.append(slider('cut', ICON.cut, 'Cut away', (k) => obj.setCut(k)));
    if (a.explode) d.append(slider('explode', ICON.explode, 'Explode', (k) => obj.setExplode(k * 1.0)));
    if (a.xray) d.append(toggle('xray', ICON.xray, 'X-ray', (v) => obj.setXray(v), 'X'));
    if (a.labels) {
      const lb = toggle('labels', ICON.labels, 'Labels', (v) => this.showLabels(v), 'L');
      lb.setAttribute('aria-pressed', 'true');
      d.append(lb);
      this.showLabels(true);
    }
    // explorables that can drive this scene: their sliders move it
    const fig = this.fig;
    if (fig && obj.setInput) {
      for (const x of this.driversFor?.(fig) ?? []) {
        const b = el('button', { type: 'button', class: 'tool drive', 'aria-pressed': 'false', title: `Drive this scene with the sliders of Explore ${x.number}` }, `${ICON.sliders}<span>Drive with Explore ${x.number}</span>`);
        b.dataset.drive = x.id;
        b.addEventListener('click', () => (b.getAttribute('aria-pressed') === 'true' ? this.detachDriver() : this.attachDriver(x)));
        d.append(b);
      }
    }
    if (fig) d.append(...(this.toolsFor?.(fig) ?? []));
    const reset = el('button', { type: 'button', class: 'tool', title: 'Reset the view (R)', 'aria-keyshortcuts': 'R' }, `${ICON.reset}<span>Reset</span>`);
    reset.addEventListener('click', () => this.reset());
    const close = el('button', { type: 'button', class: 'tool', title: 'Back to the page (Escape)', 'aria-keyshortcuts': 'Escape' }, `${ICON.close}<span>Back to page</span>`);
    close.addEventListener('click', () => void this.close());
    d.append(reset, close);
    d.hidden = false;
  }

  /**
   * Put an explorable's sliders beside the scene. Every slider change runs the explorable's
   * `drives` expressions for this kit and hands the results to the scene.
   */
  private attachDriver(x: Explorable3D): void {
    const obj = this.obj;
    const fig = this.fig;
    if (!obj?.setInput || !fig || fig.treatment.mode !== 'scene') return;
    this.detachDriver();
    const kit = fig.treatment.kit;
    const drives = ((x.block as { drives?: Array<{ kit: string; input: string; expr: string }> }).drives ?? []).filter((dr) => dr.kit === kit);
    const panel = panelEl('aside', { class: 'fig-drive', 'aria-label': `Explore ${x.number} driving the scene` });
    const head = panelEl('div', { class: 'drive-head' });
    head.append(panelEl('p', { class: 'drive-title' }, `Explore ${x.number} · ${x.title}`));
    const off = el('button', { type: 'button', class: 'btn ghost icon-only', 'aria-label': 'Stop driving the scene' }, ICON.close);
    off.addEventListener('click', () => this.detachDriver());
    head.append(off);
    panel.append(head, panelEl('p', { class: 'drive-note' }, 'Move a slider: the scene follows.'));
    const body = panelEl('div');
    panel.append(body);
    this.ui.append(panel);
    this.drive = panel;
    exploreContent(body, x, {
      mode: () => (this.theme.id === 'plate' ? 'light' : 'dark'),
      compact: true,
      onChange: (values) => {
        const msgs: string[] = [];
        for (const dr of drives) {
          try {
            const msg = obj.setInput!(dr.input, compile(dr.expr)(values));
            if (msg) msgs.push(msg);
          } catch {
            /* a broken link expression is caught by the build; never break the scene */
          }
        }
        if (msgs.length) this.status.textContent = msgs.join(' ');
        this.stage.invalidate();
      },
    });
    this.dock.querySelectorAll<HTMLElement>('[data-drive]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.drive === x.id)));
    this.announce(`Explore ${x.number} now drives the scene. Its sliders are beside it.`);
  }

  private detachDriver(): void {
    this.drive?.remove();
    this.drive = null;
    this.dock.querySelectorAll<HTMLElement>('[data-drive]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
  }

  private togglePlay(btn: HTMLElement): void {
    this.playing = !this.playing;
    btn.setAttribute('aria-pressed', String(this.playing));
    btn.innerHTML = this.playing ? `${ICON.pause}<span>Pause</span>` : `${ICON.play}<span>Play</span>`;
    if (this.playing) this.hold();
  }

  private reset(): void {
    if (!this.obj) return;
    this.yaw = this.fig?.treatment.mode === 'lift' ? 0 : -0.5;
    this.pitch = this.fig?.treatment.mode === 'lift' ? 0.2 : 0;
    this.vYaw = this.vPitch = 0;
    this.obj.setCut(0);
    this.obj.setExplode(0);
    this.obj.setXray(false);
    for (const r of this.dock.querySelectorAll<HTMLInputElement>('input[name="cut"], input[name="explode"]')) r.value = '0';
    this.dock.querySelector('[data-name="xray"]')?.setAttribute('aria-pressed', 'false');
    this.applyRotation();
  }

  private showLabels(on: boolean): void {
    this.labelEls.forEach((l) => l.remove());
    this.labelEls = [];
    if (!on || !this.obj) return;
    for (const l of this.obj.labels) {
      const e = el('div', { class: 'label' });
      e.textContent = l.text;
      this.labelLayer.append(e);
      this.labelEls.push(e);
    }
    this.stage.invalidate();
  }

  private placeLabels(): void {
    if (!this.obj || !this.labelEls.length) return;
    this.obj.group.updateMatrixWorld(true);
    this.obj.labels.forEach((l, i) => {
      const e = this.labelEls[i]!;
      const world = (l.part ?? this.obj!.group).localToWorld(l.at.clone());
      const s = this.stage.project(world);
      e.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      e.style.visibility = s.visible ? 'visible' : 'hidden';
    });
  }

  /** Keyboard while a figure is open. Returns true when the key was used. */
  key(e: KeyboardEvent): boolean {
    if (!this.obj) return false;
    const step = 0.12;
    switch (e.key) {
      case 'Escape':
        void this.close();
        return true;
      case 'ArrowLeft':
        this.yaw -= step;
        break;
      case 'ArrowRight':
        this.yaw += step;
        break;
      case 'ArrowUp':
        this.pitch = Math.max(-1.3, this.pitch - step);
        break;
      case 'ArrowDown':
        this.pitch = Math.min(1.3, this.pitch + step);
        break;
      case 'r':
      case 'R':
        this.reset();
        return true;
      case 'x':
      case 'X':
        (this.dock.querySelector('[data-name="xray"]') as HTMLButtonElement | null)?.click();
        return true;
      case 'l':
      case 'L':
        (this.dock.querySelector('[data-name="labels"]') as HTMLButtonElement | null)?.click();
        return true;
      case ' ': {
        const p = this.dock.querySelector('[data-name="play"]') as HTMLButtonElement | null;
        if (!p) return false;
        p.click();
        return true;
      }
      default:
        return false;
    }
    this.applyRotation();
    return true;
  }
}

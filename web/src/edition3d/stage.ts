/**
 * The stage: renderer, camera, lights, the table, a tiny tween system and render-on-demand.
 * Frames are drawn only while something moves (or once after a change), so an open book that
 * nobody touches costs nothing — that keeps laptops cool and phones at 60 fps when it matters.
 */
import * as THREE from 'three';
import type { Theme } from './theme.ts';

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Strong ease-out (cubic-bezier(0.23, 1, 0.32, 1) shape) for things arriving. */
export const easeOut = (t: number) => 1 - (1 - t) ** 4;

interface Tween {
  start: number;
  duration: number;
  ease: (t: number) => number;
  step: (k: number) => void;
  done?: () => void;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  // A generous near plane keeps depth precision high even on 16-bit depth buffers (some phones and
  // software renderers), so stacked paper and cloth a hair apart never flicker through each other.
  readonly camera = new THREE.PerspectiveCamera(30, 1, 1.5, 90);
  readonly reducedMotion: boolean;
  private tweens = new Set<Tween>();
  private dirty = true;
  private continuous = 0;
  private listeners: Array<(dt: number) => void> = [];
  private last = performance.now();

  constructor(readonly host: HTMLElement, theme: Theme) {
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.className = 'stage-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    host.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(theme.ground);
    this.scene.fog = new THREE.Fog(theme.ground, 26, 85);

    // Soft studio light: a sky/ground fill, a warm key from the upper left that casts the book's
    // shadow, and a cool rim from behind so page edges read.
    this.scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(theme.table), 1.7));
    const key = new THREE.DirectionalLight(0xfff6ea, 1.9);
    key.position.set(-6, 14, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xdfe9ff, 0.55);
    rim.position.set(5, 6, -9);
    this.scene.add(rim);

    const table = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: theme.table, roughness: 0.96, metalness: 0 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.runTweens(now);
      for (const l of this.listeners) l(dt);
      if (this.dirty || this.tweens.size || this.continuous > 0) {
        this.renderer.render(this.scene, this.camera);
        this.dirty = false;
        this.afterRender.forEach((f) => f());
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Called after each drawn frame (HTML overlays follow the 3D scene here). */
  readonly afterRender = new Set<() => void>();

  invalidate(): void {
    this.dirty = true;
  }

  /** Keep drawing every frame while `on` holds (animations, drags); call the returned function to stop. */
  hold(): () => void {
    this.continuous++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.continuous--;
        this.invalidate();
      }
    };
  }

  onFrame(fn: (dt: number) => void): void {
    this.listeners.push(fn);
  }

  /** Animate k from 0 to 1. With reduced motion, jumps to the end at once. */
  tween(duration: number, step: (k: number) => void, ease = easeInOut): Promise<void> {
    return new Promise((resolve) => {
      if (this.reducedMotion || duration <= 0) {
        step(1);
        this.invalidate();
        resolve();
        return;
      }
      this.tweens.add({ start: performance.now(), duration, ease, step, done: resolve });
      this.invalidate();
    });
  }

  /** Finish every running tween now (a second key press should never wait for the first). */
  flush(): void {
    for (const t of [...this.tweens]) {
      t.step(1);
      this.tweens.delete(t);
      t.done?.();
    }
    this.invalidate();
  }

  get busy(): boolean {
    return this.tweens.size > 0;
  }

  private runTweens(now: number): void {
    for (const t of [...this.tweens]) {
      const raw = Math.min(1, (now - t.start) / t.duration);
      t.step(t.ease(raw));
      if (raw >= 1) {
        this.tweens.delete(t);
        t.done?.();
      }
    }
  }

  private resize(): void {
    const w = this.host.clientWidth || innerWidth;
    const h = this.host.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.onResize.forEach((f) => f(w, h));
    this.invalidate();
  }

  readonly onResize = new Set<(w: number, h: number) => void>();

  /** Screen position (CSS pixels) of a world point, and whether it is in front of the camera. */
  project(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, visible: v.z < 1 };
  }
}

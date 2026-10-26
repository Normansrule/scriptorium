/**
 * Shared plumbing for scene kits: parts that explode along their own direction, outlines for
 * X-ray, a cutaway plane, labels that follow their part, and clean disposal. A kit only has to
 * build its geometry and say what its timeline does.
 */
import * as THREE from 'three';
import { Cutaway, outline, setClipping, setXray, type FigureObject, type Label } from '../objects.ts';

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The book's colour-blind-safe roles (src/core/style.ts), as used in the kits. */
export const ROLE = {
  signal: '#0072b2', // the main quantity or flow
  accent: '#d55e00', // the thing compared against it
  sky: '#56b4e9',
  yellow: '#f0e442',
  green: '#009e73',
  metal: '#c3c9d1',
  copper: '#c77a4a',
};

export class KitBuilder {
  readonly group = new THREE.Group();
  /** everything drawn goes in here; scale and offset it so the kit fits a radius of about 2 */
  readonly scene = new THREE.Group();
  readonly labels: Label[] = [];
  private parts: Array<{ obj: THREE.Object3D; base: THREE.Vector3; dir: THREE.Vector3 }> = [];
  private edges: THREE.LineSegments[] = [];
  private materials = new Set<THREE.Material>();
  private cut: Cutaway;

  constructor(scale: number, depth: number, offset = new THREE.Vector3()) {
    this.scene.scale.setScalar(scale);
    this.scene.position.copy(offset);
    this.group.add(this.scene);
    this.cut = new Cutaway(depth * scale);
  }

  /** Add a part. `dir` is where it moves when the model is exploded fully. */
  add<T extends THREE.Object3D>(obj: T, dir: [number, number, number] = [0, 0, 0], opts: { outline?: boolean; parent?: THREE.Object3D } = {}): T {
    (opts.parent ?? this.scene).add(obj);
    this.parts.push({ obj, base: obj.position.clone(), dir: new THREE.Vector3(...dir) });
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) this.materials.add(mat);
      if (opts.outline !== false && !(m as unknown as THREE.InstancedMesh).isInstancedMesh) this.edges.push(outline(m, 0xdfe8f2));
    });
    return obj;
  }

  /** A label anchored on a part (given in the scene's coordinates; stored relative to the part). */
  label(text: string, at: [number, number, number], part?: THREE.Object3D): void {
    const v = new THREE.Vector3(...at);
    if (part) {
      part.updateMatrixWorld(true);
      this.scene.updateMatrixWorld(true);
      // scene coordinates → the part's local frame
      const toPart = new THREE.Matrix4().copy(part.matrixWorld).invert().multiply(this.scene.matrixWorld);
      v.applyMatrix4(toPart);
    } else {
      v.applyMatrix4(this.scene.matrix);
    }
    this.labels.push({ text, at: v, part });
  }

  finish(
    spec: Omit<FigureObject, 'group' | 'radius' | 'labels' | 'setCut' | 'setExplode' | 'setXray' | 'dispose' | 'abilities'> & {
      abilities?: Partial<FigureObject['abilities']>;
      afterXray?: (on: boolean) => void;
      /** replaces the default explode (each part along its own direction), e.g. for parts that move on the timeline too */
      setExplode?: (k: number) => void;
    },
  ): FigureObject {
    setClipping(this.group, this.cut.plane);
    const { tick, afterXray, abilities, setExplode, ...rest } = spec;
    return {
      ...rest,
      group: this.group,
      radius: 2.4,
      labels: this.labels,
      abilities: { cutaway: true, explode: true, xray: true, animate: !!spec.setTime, labels: true, ...abilities },
      setCut: (k) => this.cut.set(k),
      setExplode:
        setExplode ??
        ((k) => {
          for (const p of this.parts) p.obj.position.copy(p.base).addScaledVector(p.dir, k);
        }),
      setXray: (on) => {
        setXray(this.group, on, this.edges);
        afterXray?.(on);
      },
      tick: (dt) => {
        this.cut.update(this.group);
        tick?.(dt);
      },
      dispose: () => {
        this.group.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh || (o as THREE.LineSegments).isLineSegments) m.geometry.dispose();
        });
        for (const m of this.materials) m.dispose();
      },
    };
  }
}

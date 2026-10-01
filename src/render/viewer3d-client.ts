/**
 * Interactive 3D viewer for the web book and the app. Bundled by esbuild into
 * assets/viewer3d.js (the only script a web book ever loads).
 *
 * It finds <figure class="model3d" data-model="…">, replaces the still images with a
 * rotatable drawing made by the same renderer as the print stills, and adds controls:
 *   drag (mouse, pen or touch) · arrow keys when focused · buttons for each saved view.
 * Nothing moves on its own, so prefers-reduced-motion needs no special case. If this
 * script does not run, the stills stay visible — that is the static fallback.
 */
import { Model } from '../core/molecule.ts';
import { renderMoleculeSvg, type Annotation } from './molecule-svg.ts';
import type { Mode } from '../core/style.ts';

interface ViewerData {
  model: unknown;
  scale: 'to-scale' | 'schematic';
  scaleNote?: string;
  atomScale?: number;
  annotations: Annotation[];
  views: Array<{ yaw: number; pitch: number; label: string }>;
  alt: string;
}

function themeMode(): Mode {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function mountViewer(fig: HTMLElement): void {
  if (fig.dataset.mounted) return;
  let data: ViewerData;
  let model: Model;
  try {
    data = JSON.parse(fig.dataset.model ?? '') as ViewerData;
    model = Model.parse(data.model);
  } catch {
    return; // keep the stills
  }
  fig.dataset.mounted = '1';
  let { yaw, pitch } = data.views[0]!;

  const box = document.createElement('div');
  box.className = 'viewer3d';
  const stage = document.createElement('div');
  stage.setAttribute('role', 'img');
  stage.setAttribute('aria-label', `${data.alt} Interactive: drag or use the arrow keys to rotate.`);
  stage.tabIndex = 0;
  const controls = document.createElement('div');
  controls.className = 'controls';
  const hint = document.createElement('span');
  hint.textContent = 'Drag or use arrow keys to rotate.';
  controls.append(hint);
  for (const v of data.views) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = v.label;
    b.addEventListener('click', () => {
      yaw = v.yaw;
      pitch = v.pitch;
      draw();
    });
    controls.append(b);
  }
  box.append(stage, controls);
  fig.insertBefore(box, fig.firstChild);
  fig.classList.add('js-3d');

  function draw(): void {
    // The renderer escapes every string it emits; model data was schema-checked above.
    stage.innerHTML = renderMoleculeSvg(model, { yaw, pitch }, { size: 360, mode: themeMode(), annotations: data.annotations, scale: data.scale, scaleNote: data.scaleNote ?? (data.scale === 'schematic' ? 'lengths not to scale' : undefined), atomScale: typeof data.atomScale === 'number' ? Math.min(1.5, Math.max(0.2, data.atomScale)) : undefined, title: data.alt });
  }

  let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, yaw, pitch };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    yaw = drag.yaw + (e.clientX - drag.x) * 0.6;
    pitch = Math.max(-89, Math.min(89, drag.pitch + (e.clientY - drag.y) * 0.6));
    draw();
  });
  const end = () => (drag = null);
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 30 : 10;
    if (e.key === 'ArrowLeft') yaw -= step;
    else if (e.key === 'ArrowRight') yaw += step;
    else if (e.key === 'ArrowUp') pitch = Math.max(-89, pitch - step);
    else if (e.key === 'ArrowDown') pitch = Math.min(89, pitch + step);
    else return;
    e.preventDefault();
    draw();
  });
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', draw);
  draw();
}

export function mountAll(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('figure.model3d[data-model]').forEach(mountViewer);
}

if (typeof document !== 'undefined' && document.currentScript) {
  // Loaded as the web book's script tag.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll());
  else mountAll();
}

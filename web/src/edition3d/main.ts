/**
 * The 3D Edition viewer.
 *
 *   3d.html?book=books/cells-and-dna/3d/     open a book's 3D Edition (the folder holding book3d.json)
 *   3d.html?kit=mosfet                       preview a scene kit on a blank spread
 *   &theme=bookcloth|plate|window            the Phase 0 visual concepts
 *
 * Keyboard: ← → (or Page Up / Page Down) turn pages, Tab reaches each figure on the spread,
 * Enter lifts it off the page, Escape puts it back. With "reduce motion" set, the viewer offers
 * the 2D Edition first and, if opened anyway, nothing animates.
 */
import * as THREE from 'three';
import { Book3D, type Figure3D } from '../../../src/edition3d/manifest.ts';
import { kitById } from '../../../src/edition3d/kits.ts';
import { BookModel } from './book.ts';
import { FigureView, KITS, type CameraPose } from './figure.ts';
import { ICON } from './icons.ts';
import { Stage } from './stage.ts';
import { themeFromUrl } from './theme.ts';
import './edition3d.css';

const root = document.getElementById('edition3d')!;
const params = new URLSearchParams(location.search);
const theme = themeFromUrl();
document.documentElement.dataset.theme = theme.id;
for (const [k, v] of Object.entries(theme.ui)) document.documentElement.style.setProperty(`--${k}`, v);
document.documentElement.style.setProperty('--ground', theme.ground);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};

/** A safe relative folder inside this site (no scheme, no climbing above the site root). */
function bookBase(): URL {
  const raw = params.get('book') ?? 'books/cells-and-dna/3d/';
  if (/^[a-z][a-z0-9+.-]*:|^\/\/|\\/i.test(raw) || raw.split('/').includes('..')) throw new Error('That book address is not allowed.');
  return new URL(raw.endsWith('/') ? raw : `${raw}/`, location.href);
}

/** A blank book for scene-kit previews. */
function previewBook(kit: string): Book3D {
  const info = kitById(kit);
  return Book3D.parse({
    format: 'scriptorium-3d',
    version: 1,
    title: info ? `Scene kit: ${info.title}` : 'Scene kit preview',
    authors: ['Scriptorium'],
    page: { width: 432, height: 648 },
    pages: ['pages/p001.jpg', 'pages/p002.jpg', 'pages/p003.jpg'],
    pageScale: 1,
    cloth: '#1e4f9c',
    figures: [
      {
        id: `fig-${kit}`,
        number: '',
        page: 3,
        rect: { x: 60, y: 110, w: 312, h: 210 },
        alt: info ? `${info.title}: ${info.shows}` : 'Scene kit preview.',
        caption: info ? `${info.shows} ${info.animation ?? ''}` : '',
        credit: 'Scene kit preview, not part of a book. Geometry drawn in code by Scriptorium.',
        treatment: { mode: 'scene', kit },
      },
    ],
  });
}

async function load(): Promise<{ book: Book3D; base: URL; preview: boolean }> {
  const kit = params.get('kit');
  if (kit) {
    if (!KITS[kit]) throw new Error(`There is no scene kit called “${kit}”.`);
    return { book: previewBook(kit), base: new URL('./', location.href), preview: true };
  }
  const base = bookBase();
  const res = await fetch(new URL('book3d.json', base));
  if (!res.ok) throw new Error(`Could not load this book’s 3D Edition (${res.status}).`);
  return { book: Book3D.parse(await res.json()), base, preview: false };
}

function fail(message: string): void {
  root.innerHTML = '';
  const box = el('section', { class: 'gate' });
  const h = el('h1');
  h.textContent = 'The 3D Edition could not open';
  const p = el('p');
  p.textContent = message;
  box.append(h, p);
  root.append(box);
}

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Reduced motion (or no WebGL): offer the calm 2D Edition first. */
function gate(book: Book3D, base: URL, reason: 'motion' | 'webgl'): Promise<void> {
  return new Promise((resolve) => {
    const box = el('section', { class: 'gate' });
    const h = el('h1');
    h.textContent = book.title;
    const p = el('p');
    p.textContent =
      reason === 'motion'
        ? 'Your device asks for reduced motion, so the book opens in its 2D Edition. The 3D Edition can still open, with every animation switched off.'
        : 'This browser cannot draw 3D graphics (WebGL is off or unavailable). The 2D Edition has the same text, figures and references.';
    const actions = el('div', { class: 'gate-actions' });
    if (book.webEdition) {
      const a = el('a', { class: 'btn primary', href: new URL(book.webEdition, base).href }, `${ICON.book}<span>Read the 2D Edition</span>`);
      actions.append(a);
    }
    if (reason === 'motion') {
      const b = el('button', { type: 'button', class: 'btn' }, `${ICON.cube}<span>Open the 3D Edition without motion</span>`);
      b.addEventListener('click', () => {
        box.remove();
        resolve();
      });
      actions.append(b);
    }
    box.append(h, p, actions);
    root.append(box);
  });
}

async function main(): Promise<void> {
  let loaded: Awaited<ReturnType<typeof load>>;
  try {
    loaded = await load();
  } catch (e) {
    fail((e as Error).message);
    return;
  }
  const { book, base, preview } = loaded;
  document.title = `${book.title} — 3D Edition`;
  if (!webglOk()) return void gate(book, base, 'webgl');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches && !params.has('motion')) await gate(book, base, 'motion');

  const stageHost = el('div', { class: 'stage' });
  const ui = el('div', { class: 'ui' });
  root.append(stageHost, ui);
  const stage = new Stage(stageHost, theme);
  const model = new BookModel(stage, book, base.href, theme, preview);

  // ---- chrome: title, page count, page buttons, About
  const live = el('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const say = (s: string) => (live.textContent = s);
  const top = el('header', { class: 'top' });
  const title = el('div', { class: 'title' });
  const t1 = el('p', { class: 'book-title' });
  t1.textContent = book.title;
  const t2 = el('p', { class: 'book-pages' });
  title.append(t1, t2);
  const tools = el('div', { class: 'top-tools' });
  if (book.webEdition && !preview) tools.append(el('a', { class: 'btn ghost', href: new URL(book.webEdition, base).href, title: 'The same book as a 2D web page' }, `${ICON.book}<span>2D Edition</span>`));
  const aboutBtn = el('button', { type: 'button', class: 'btn ghost', 'aria-expanded': 'false', 'aria-controls': 'about' }, `${ICON.info}<span>About</span>`);
  tools.append(aboutBtn);
  top.append(title, tools);
  const prev = el('button', { type: 'button', class: 'turn prev', 'aria-label': 'Previous page', 'aria-keyshortcuts': 'ArrowLeft' }, ICON.prev);
  const next = el('button', { type: 'button', class: 'turn next', 'aria-label': 'Next page', 'aria-keyshortcuts': 'ArrowRight' }, ICON.next);
  const hotspots = el('div', { class: 'hotspots', role: 'group', 'aria-label': 'Figures on these pages' });
  const about = el('aside', { class: 'about', id: 'about', hidden: '' });
  about.innerHTML = `<h2>About this edition</h2>
    <p>The same book as the print edition, page for page. Figures marked with a lift button rise off the page: drag to rotate them, and where a figure supports it, cut it open, explode it into parts, see through it, or play its process.</p>
    <h3>Keys</h3>
    <ul><li><kbd>←</kbd> <kbd>→</kbd> turn pages</li><li><kbd>Tab</kbd> then <kbd>Enter</kbd> lift a figure</li><li>Arrow keys rotate it · <kbd>X</kbd> X-ray · <kbd>L</kbd> labels · <kbd>Space</kbd> play · <kbd>R</kbd> reset · <kbd>Esc</kbd> back to the page</li></ul>`;
  if (book.disclosure) {
    const d = el('p', { class: 'muted' });
    d.textContent = `AI-content disclosure — text: ${book.disclosure.text}; images: ${book.disclosure.images}. Every source is verified; see the References at the end of the book.`;
    about.append(d);
  }
  aboutBtn.addEventListener('click', () => {
    const open = about.hidden;
    about.hidden = !open;
    aboutBtn.setAttribute('aria-expanded', String(open));
  });
  ui.append(top, prev, next, hotspots, about, live);

  // ---- camera framing
  const bookPose = (): CameraPose => {
    const cam = stage.camera;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    // fit the open book (with its cloth overhang) plus a margin for the chrome
    const spread = model.W * 2 + 0.5;
    const a = (60 * Math.PI) / 180;
    const dW = spread / 2 / Math.tan(hfov / 2);
    const dH = (model.H * Math.sin(a) + 1.1) / 2 / Math.tan(vfov / 2);
    const d = Math.max(dW, dH) * 1.16;
    const target = new THREE.Vector3(0, 0, 0.22);
    return { target, position: target.clone().add(new THREE.Vector3(0, Math.sin(a) * d, Math.cos(a) * d)) };
  };
  const figureView = new FigureView(stage, model, base.href, theme, ui, bookPose, say);
  const placeCamera = () => {
    if (figureView.isOpen) return;
    const p = bookPose();
    stage.camera.position.copy(p.position);
    stage.camera.lookAt(p.target);
  };
  stage.onResize.add(placeCamera);
  placeCamera();

  // ---- hotspots: one real button per liftable figure on the open spread
  let spots: Array<{ fig: Figure3D; btn: HTMLButtonElement }> = [];
  const visibleFigures = () => book.figures.filter((f) => f.treatment.mode !== 'flat' && model.figureRect(f.page, f.rect));
  const buildSpots = () => {
    hotspots.innerHTML = '';
    spots = visibleFigures().map((fig) => {
      const kind = fig.treatment.mode === 'lift' ? 'Lift' : 'Open in 3D';
      const btn = el('button', { type: 'button', class: 'spot' }, `<span class="spot-pill">${fig.treatment.mode === 'lift' ? ICON.lift : ICON.cube}<span>${kind}</span></span>`);
      btn.setAttribute('aria-label', `${kind}: ${fig.number ? `Figure ${fig.number}. ` : ''}${fig.alt}`);
      btn.addEventListener('click', () => void openFigure(fig, btn));
      hotspots.append(btn);
      return { fig, btn };
    });
    stage.invalidate();
  };
  stage.afterRender.add(() => {
    for (const { fig, btn } of spots) {
      const r = model.figureRect(fig.page, fig.rect);
      if (!r || figureView.isOpen) {
        btn.hidden = true;
        continue;
      }
      const pts = r.corners.map((c) => stage.project(c));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      btn.hidden = false;
      btn.style.transform = `translate(${Math.min(...xs).toFixed(1)}px, ${Math.min(...ys).toFixed(1)}px)`;
      btn.style.width = `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)}px`;
      btn.style.height = `${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}px`;
    }
  });

  const pageLabel = () => {
    const s = model.spread;
    const n = book.pages.length;
    const parts = [s.left, s.right].filter((i) => i >= 0).map((i) => i + 1);
    t2.textContent = preview ? 'Preview — blank pages' : parts.length === 2 ? `Pages ${parts[0]}–${parts[1]} of ${n}` : parts.length ? `Page ${parts[0]} of ${n}` : `End of the book (${n} pages)`;
    prev.disabled = model.leaf === 0;
    next.disabled = 2 * model.leaf >= n;
  };
  model.onSpread.add(() => {
    pageLabel();
    buildSpots();
    say(t2.textContent ?? '');
  });

  const openFigure = async (fig: Figure3D, btn?: HTMLElement) => {
    top.classList.add('dim');
    prev.hidden = next.hidden = true;
    await figureView.open(fig, btn);
  };
  figureView.onClose = (fig) => {
    top.classList.remove('dim');
    prev.hidden = next.hidden = false;
    buildSpots();
    // the hotspots were rebuilt: put keyboard focus back on the figure that was open
    spots.find((s) => s.fig.id === fig.id)?.btn.focus({ preventScroll: true });
  };

  const turn = async (dir: 1 | -1) => {
    if (figureView.isOpen) return;
    await model.turn(dir);
  };
  prev.addEventListener('click', () => void turn(-1));
  next.addEventListener('click', () => void turn(1));

  // ---- drag a page to turn it (a quick flick is enough)
  const canvas = stage.renderer.domElement;
  const ray = new THREE.Raycaster();
  const table = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1);
  let drag: { dir: 1 | -1; x0: number; t0: number; p: number; width: number; id: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (figureView.isOpen || drag || e.button > 0) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), stage.camera);
    const hit = ray.ray.intersectPlane(table, new THREE.Vector3());
    if (!hit || Math.abs(hit.z) > model.H / 2 || Math.abs(hit.x) > model.W || Math.abs(hit.x) < model.W * 0.35) return; // grab the outer part of a page
    const dir: 1 | -1 = hit.x > 0 ? 1 : -1;
    if ((dir === 1 && next.disabled) || (dir === -1 && prev.disabled)) return;
    const a = stage.project(new THREE.Vector3(-model.W, 0, 0));
    const b = stage.project(new THREE.Vector3(model.W, 0, 0));
    drag = { dir, x0: e.clientX, t0: performance.now(), p: 0, width: Math.max(80, b.x - a.x), id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.p = Math.max(0, Math.min(1, ((drag.x0 - e.clientX) * drag.dir) / (drag.width * 0.8)));
    if (drag.p > 0.01) model.dragTo(drag.dir, drag.p);
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.p <= 0.01) return;
    const velocity = Math.abs(e.clientX - d.x0) / Math.max(1, performance.now() - d.t0);
    void model.release(d.dir, d.p, d.p > 0.45 || velocity > 0.5);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- keyboard
  addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    // let form controls keep their own keys (a slider's arrows, a button's Space), but Escape always works
    const native = e.key !== 'Escape' && (target.matches('input, textarea, select') || (target.matches('button, a') && (e.key === ' ' || e.key === 'Enter')));
    if (native) return;
    if (figureView.key(e)) {
      e.preventDefault();
      return;
    }
    if (figureView.isOpen) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      void turn(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      void turn(-1);
    } else if (e.key === 'Home') model.goToPage(0);
    else if (e.key === 'End') model.goToPage(book.pages.length - 1);
    else if (e.key === 'Escape' && !about.hidden) aboutBtn.click();
  });

  // ---- start: open at the requested page (or the first figure in a preview)
  const startPage = Number(params.get('page') ?? '1');
  model.start();
  if (Number.isInteger(startPage) && startPage > 1) model.goToPage(startPage - 1);
  if (preview) {
    model.goToPage(2);
    const fig = book.figures[0]!;
    setTimeout(() => void openFigure(fig), 350);
  }
  const autoOpen = params.get('open');
  if (autoOpen) {
    const fig = book.figures.find((f) => f.id === autoOpen);
    if (fig) {
      model.goToPage(fig.page - 1);
      setTimeout(() => void openFigure(fig), 350);
    }
  }
  if (params.has('debug')) Object.assign(window, { __stage: stage, __book: model, __THREE: THREE });
  root.dataset.ready = '1';
}

void main();

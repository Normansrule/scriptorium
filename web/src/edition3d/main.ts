/**
 * The 3D Edition viewer.
 *
 *   3d.html?book=books/cells-and-dna/3d/     open a book's 3D Edition (the folder holding book3d.json)
 *   3d.html?kit=mosfet                       preview a scene kit on a blank spread
 *   &theme=bookcloth|plate|window|lagoon|orchard   override the book's own style
 *
 * Keyboard: ← → (or Page Up / Page Down) turn pages, Tab reaches each figure on the spread,
 * Enter lifts it off the page, Escape puts it back. With "reduce motion" set, the viewer offers
 * the 2D Edition first and, if opened anyway, nothing animates.
 */
import * as THREE from 'three';
import { Book3D, type Explorable3D, type Figure3D } from '../../../src/edition3d/manifest.ts';
import { DeskStore, DeskTable } from './desk.ts';
import { chapterCounts, chapterItems, connections, cutOut, itemsOf, type Item } from './items.ts';
import { KIND } from './kinds.ts';
import { checkContent, chip, el as panelEl, equationContent, exploreContent, Modal, plain } from './panel.ts';
import { PopUps } from './popups.ts';
import { Threads } from './threads.ts';
import { startStudy } from './study.ts';
import { ReviewStore, TOP_BOX, whenText } from './review.ts';
import { KITS as KIT_INFO, kitById } from '../../../src/edition3d/kits.ts';
import { BookModel } from './book.ts';
import { FigureView, KITS, type CameraPose } from './figure.ts';
import { ICON } from './icons.ts';
import { Stage } from './stage.ts';
import { applyTheme, pickTheme, type Theme } from './theme.ts';
import './edition3d.css';

const root = document.getElementById('edition3d')!;
const params = new URLSearchParams(location.search);
// until the book says which style it uses: the URL's choice, else Bookcloth
let theme: Theme = pickTheme(params.get('theme'));
applyTheme(theme);

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
  theme = pickTheme(params.get('theme'), book.style);
  applyTheme(theme);
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
  if (preview) {
    // a kit preview links to the other kits, so the gallery can be browsed from inside the viewer
    const nav = el('nav', { class: 'kit-nav', 'aria-label': 'Scene kits' });
    const current = params.get('kit');
    for (const k of KIT_INFO) {
      const a = el('a', { href: `?kit=${encodeURIComponent(k.id)}`, class: 'kit-link' });
      a.textContent = k.title.replace(/ \(.*\)$/, '');
      if (k.id === current) a.setAttribute('aria-current', 'page');
      nav.append(a);
    }
    tools.append(nav);
  }
  const popBtn = el('button', { type: 'button', class: 'btn ghost', 'aria-pressed': 'true', title: 'Pop-up book: figures, equations and checks stand up off the page (P)', 'aria-keyshortcuts': 'P' }, `${ICON.popup}<span>Pop-up</span>`);
  const deskBtn = el('button', { type: 'button', class: 'btn ghost desk-btn', title: 'Your desk: what you kept from the book (D)', 'aria-keyshortcuts': 'D' }, `${ICON.desk}<span>Desk</span><span class="count" aria-hidden="true">0</span><span class="due" aria-hidden="true" hidden></span>`);
  if (!preview) tools.append(popBtn, deskBtn);
  const aboutBtn = el('button', { type: 'button', class: 'btn ghost', 'aria-expanded': 'false', 'aria-controls': 'about' }, `${ICON.info}<span>About</span>`);
  tools.append(aboutBtn);
  top.append(title, tools);
  const prev = el('button', { type: 'button', class: 'turn prev', 'aria-label': 'Previous page', 'aria-keyshortcuts': 'ArrowLeft' }, ICON.prev);
  const next = el('button', { type: 'button', class: 'turn next', 'aria-label': 'Next page', 'aria-keyshortcuts': 'ArrowRight' }, ICON.next);
  const hotspots = el('div', { class: 'hotspots', role: 'group', 'aria-label': 'Things to pull out of these pages' });
  const about = el('aside', { class: 'about', id: 'about', hidden: '' });
  about.innerHTML = `<h2>About this edition</h2>
    <p>The same book as the print edition, page for page. In pop-up mode, figures, equations and checks stand up as paper cards when you open a spread. Pull any of them out: figures lift off the page or come to life in 3D (rotate, cut open, explode, X-ray, play), equations open as cards with every symbol, explorables give you live sliders, and checks quiz you.</p>
    <p>Coloured threads join things that belong together: an equation and the figure that shows it, an explorable and the equation it brings to life or the scene it drives. Point at one to light its threads; each panel lists its connections.</p>
    <p>Keep what you want to remember: it lands on your desk in front of the book. Study mode turns your desk, or a chapter, into practice cards and remembers how you did: a card you get right comes back later each time (tomorrow, then in 2, 4, 8 and 16 days), and one you miss comes back tomorrow. All of this stays in this browser.</p>
    <p class="legend">${(['figure', 'scene', 'equation', 'explore', 'check', 'chapter'] as const).map((k) => `<span class="chip" style="--chip:${KIND[k].color};--chip-ink:${KIND[k].ink}">${KIND[k].icon}${KIND[k].label}</span>`).join(' ')}</p>
    <h3>Keys</h3>
    <ul><li><kbd>←</kbd> <kbd>→</kbd> turn pages · <kbd>P</kbd> pop-ups on or off · <kbd>D</kbd> your desk</li><li><kbd>Tab</kbd> then <kbd>Enter</kbd> pull something out</li><li>Arrow keys rotate it · <kbd>X</kbd> X-ray · <kbd>L</kbd> labels · <kbd>Space</kbd> play · <kbd>R</kbd> reset · <kbd>Esc</kbd> back to the page</li></ul>`;
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
    const deskDepth = deskTable?.depth ?? 0;
    const dH = (model.H * Math.sin(a) + 1.1 + deskDepth) / 2 / Math.tan(vfov / 2);
    const d = Math.max(dW, dH) * 1.16;
    const target = new THREE.Vector3(0, 0, 0.22 + deskDepth / 2);
    return { target, position: target.clone().add(new THREE.Vector3(0, Math.sin(a) * d, Math.cos(a) * d)) };
  };
  let deskTable: DeskTable | null = null;
  const figureView = new FigureView(stage, model, base.href, theme, ui, bookPose, say);
  const placeCamera = () => {
    if (figureView.isOpen) return;
    const p = bookPose();
    stage.camera.position.copy(p.position);
    stage.camera.lookAt(p.target);
  };
  stage.onResize.add(placeCamera);
  placeCamera();

  // ---- everything that can be pulled out of the book: pop-ups, hotspots, panels, the desk
  const items = itemsOf(book);
  const modal = new Modal(ui);
  const popups = new PopUps(stage, model, items, theme);
  const links = connections(items);
  const byKey = new Map(items.map((i) => [i.key, i]));
  /** A thread ties on at the middle of an item's top edge: the standing card's, or the page's. */
  const spreadEnd = (key: string): THREE.Vector3 | null => {
    const it = byKey.get(key);
    if (!it) return null;
    const c = popups.corners(key) ?? model.figureRect(it.page, it.rect)?.corners;
    if (!c) return null;
    const p = c[0]!.clone().lerp(c[1]!, 0.5);
    p.y += 0.012;
    return p;
  };
  const threads = new Threads(stage, items, links, spreadEnd);
  let raiseGen = 0;
  /** Stand up this spread's pop-ups, then tie its threads once the cards have settled. */
  const raiseSpread = async () => {
    const gen = ++raiseGen;
    threads.clear();
    await popups.raise(visibleItems());
    if (gen === raiseGen && !figureView.isOpen) threads.show(visibleItems().map((i) => i.key));
  };
  model.onTurnStart.add(() => {
    raiseGen++;
    threads.clear();
  });
  const desk = new DeskStore(`scriptorium-desk:${book.title}`, items);
  const review = new ReviewStore(`scriptorium-review:${book.title}`);
  deskTable = preview ? null : new DeskTable(stage, model, desk);
  const plotMode = () => (theme.id === 'plate' ? 'light' : 'dark') as 'light' | 'dark';
  type Spot = { item: Item; btn: HTMLButtonElement };
  let spots: Spot[] = [];
  const busy = () => figureView.isOpen || modal.isOpen;
  const visibleItems = () => items.filter((it) => model.figureRect(it.page, it.rect));

  const keepButton = (it: Item, compact = false) => {
    const b = el('button', { type: 'button', class: compact ? 'tool keep' : 'btn keep', 'aria-pressed': String(desk.has(it.key)) });
    const paint = () => {
      const on = desk.has(it.key);
      b.setAttribute('aria-pressed', String(on));
      b.innerHTML = `${ICON.keep}<span>${on ? 'On your desk' : 'Keep on desk'}</span>`;
      b.title = on ? 'Take it off your desk' : 'Keep it on your desk, to come back to and to study';
    };
    paint();
    b.addEventListener('click', () => {
      const on = desk.toggle(it);
      paint();
      say(on ? `${it.name} is on your desk.` : `${it.name} is off your desk.`);
    });
    return b;
  };

  const buildSpots = () => {
    hotspots.innerHTML = '';
    spots = visibleItems().map((item) => {
      const k = KIND[item.kind];
      const btn = el('button', { type: 'button', class: `spot spot-${item.kind}` }, `<span class="spot-pill">${k.icon}<span>${k.verb}</span></span>`);
      btn.style.setProperty('--kind', k.color);
      btn.style.setProperty('--kind-ink', k.ink);
      btn.setAttribute('aria-label', `${k.verb}: ${item.name}. ${item.title}`);
      btn.addEventListener('click', () => void openItem(item, btn));
      // pointing at an item lights its threads
      const lite = () => threads.highlight(item.key);
      const unlite = () => threads.highlight(null);
      btn.addEventListener('pointerenter', lite);
      btn.addEventListener('pointerleave', unlite);
      btn.addEventListener('focus', lite);
      btn.addEventListener('blur', unlite);
      return { item, btn };
    });
    hotspots.append(...spots.map((s) => s.btn));
    stage.invalidate();
  };
  stage.afterRender.add(() => {
    for (const { item, btn } of spots) {
      // a standing pop-up card takes its hotspot with it
      const corners = popups.corners(item.key) ?? model.figureRect(item.page, item.rect)?.corners;
      if (!corners || busy()) {
        btn.hidden = true;
        continue;
      }
      const pts = corners.map((c) => stage.project(c));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      btn.hidden = false;
      btn.style.transform = `translate(${Math.min(...xs).toFixed(1)}px, ${Math.min(...ys).toFixed(1)}px)`;
      btn.style.width = `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)}px`;
      btn.style.height = `${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}px`;
    }
  });
  modal.onChange = (open) => {
    top.classList.toggle('dim', open);
    prev.hidden = next.hidden = open;
    if (!open) for (const s of spots) s.btn.hidden = false; // so focus can return to a hotspot before the next frame
    if (!open) setTimeout(reframe, 0);
    if (!open) paintDesk(); // a study session may have changed what is due
    stage.invalidate();
  };

  // ---- connections: what each item is stated to belong with (equation ↔ figure ↔ explorable)
  /** "Connected" row for a panel: each link is a button that opens the other item. */
  const connectedRow = (item: Item, from?: HTMLElement): HTMLElement | null => {
    const ls = links.get(item.key) ?? [];
    if (!ls.length) return null;
    const box = panelEl('section', { class: 'connected', 'aria-label': 'Connected in this book' });
    box.append(panelEl('p', { class: 'mini-label' }, 'Connected'));
    const row = panelEl('div', { class: 'connected-row' });
    for (const l of ls) {
      const b = panelEl('button', { type: 'button', class: 'link-chip' });
      b.style.setProperty('--kind', KIND[l.item.kind].color);
      b.append(panelEl('span', { class: 'link-verb' }, l.label), chip(l.item.kind, l.item.name));
      if (l.drive === 'to') b.append(panelEl('span', { class: 'link-hint' }, 'in 3D, with these sliders'));
      b.title = l.item.title;
      b.addEventListener('click', async () => {
        if (figureView.isOpen) await figureView.close();
        const drive = l.drive === 'to' && item.ref.kind === 'explore' ? { drive: item.ref.data } : {};
        void openItem(l.item, from, drive);
      });
      b.addEventListener('pointerenter', () => threads.highlight(l.item.key, item.key));
      b.addEventListener('pointerleave', () => threads.highlight(null));
      row.append(b);
    }
    box.append(row);
    return box;
  };
  figureView.extrasFor = (fig) => {
    const it = items.find((i) => i.id === fig.id);
    return it ? connectedRow(it) : null;
  };

  /** Figures that a given explorable can drive (scenes whose kit its `drives` name). */
  const drivenFigures = (x: Explorable3D) => {
    const kits = new Set(((x.block as { drives?: Array<{ kit: string }> }).drives ?? []).map((d) => d.kit));
    return book.figures.filter((f) => f.treatment.mode === 'scene' && kits.has(f.treatment.kit));
  };
  figureView.driversFor = (fig) => (fig.treatment.mode === 'scene' ? book.explorables.filter((x) => drivenFigures(x).some((f) => f.id === fig.id)) : []);
  figureView.toolsFor = (fig) => {
    const it = items.find((i) => i.id === fig.id);
    return it ? [keepButton(it, true)] : [];
  };

  /** A chapter's overview: its hook, its goals, everything inside it, and a way to study it. */
  const openChapter = (item: Item, from?: HTMLElement) => {
    if (item.ref.kind !== 'chapter') return;
    const ch = item.ref.data;
    const inside = chapterItems(item, items);
    const counts = chapterCounts(inside);
    const studyBtn = el('button', { type: 'button', class: 'btn primary' }, `${ICON.study}<span>Study this chapter</span>`);
    studyBtn.disabled = !inside.length;
    studyBtn.addEventListener('click', () => startStudy(modal, model, inside, from ?? null, (it) => void openItem(it, from), `Chapter ${ch.number}`, review));
    const keepAll = el('button', { type: 'button', class: 'btn' }, `${ICON.keep}<span>Keep it all on my desk</span>`);
    keepAll.disabled = !inside.length;
    keepAll.addEventListener('click', () => {
      const missing = inside.filter((it) => !desk.has(it.key));
      for (const it of missing) desk.toggle(it);
      say(missing.length ? `${missing.length} added to your desk.` : 'All of this chapter is already on your desk.');
      keepAll.disabled = true;
    });
    modal.open({
      kind: 'chapter',
      kicker: item.name,
      title: ch.title,
      from,
      variant: 'wide chapter',
      build: (body) => {
        if (ch.hook) body.append(panelEl('p', { class: 'ch-hook' }, plain(ch.hook)));
        if (counts.length) {
          const row = panelEl('div', { class: 'ch-counts', role: 'list', 'aria-label': 'In this chapter' });
          for (const c of counts) {
            const t = panelEl('span', { class: 'ch-count', role: 'listitem' });
            t.style.setProperty('--kind', KIND[c.kind].color);
            t.style.setProperty('--kind-ink', KIND[c.kind].ink);
            t.append(panelEl('b', {}, String(c.n)), panelEl('span', {}, c.label));
            row.append(t);
          }
          body.append(row);
          // how far the reader has got with this chapter in study mode
          const studied = inside.filter((it) => review.get(it.key)).length;
          if (studied) {
            const due = inside.filter((it) => review.get(it.key) && review.isDue(it.key)).length;
            const bar = panelEl('div', { class: 'ch-progress', role: 'img', 'aria-label': `Studied ${studied} of ${inside.length}${due ? `, ${due} due for review` : ''}` });
            const fill = panelEl('span');
            fill.style.width = `${Math.round((studied / inside.length) * 100)}%`;
            bar.append(fill);
            body.append(bar, panelEl('p', { class: 'ch-progress-text', 'aria-hidden': 'true' }, `Studied ${studied} of ${inside.length}${due ? ` · ${due} due for review` : ''}`));
          }
        }
        if (ch.goals.length) {
          const g = panelEl('section', { class: 'ch-goals' });
          g.append(panelEl('p', { class: 'mini-label' }, 'By the end of this chapter you can'));
          const ul = panelEl('ul');
          for (const goal of ch.goals) ul.append(panelEl('li', {}, plain(goal)));
          g.append(ul);
          body.append(g);
        }
        if (inside.length) {
          const list = panelEl('div', { class: 'ch-inside' });
          list.append(panelEl('p', { class: 'mini-label' }, 'Inside, in reading order'));
          for (const it of inside) {
            const b = panelEl('button', { type: 'button', class: 'ch-item' });
            b.style.setProperty('--kind', KIND[it.kind].color);
            b.append(chip(it.kind, it.name), panelEl('span', { class: 'ch-item-title' }, plain(it.title)), panelEl('span', { class: 'ch-page' }, `p. ${it.page}`));
            b.addEventListener('click', () => {
              modal.close(true);
              modal.onChange?.(false);
              if (!model.figureRect(it.page, it.rect)) model.goToPage(it.page - 1);
              setTimeout(() => void openItem(it, from), 420);
            });
            list.append(b);
          }
          body.append(list);
        }
      },
      actions: [studyBtn, keepAll],
    });
  };

  const openItem = async (item: Item, from?: HTMLElement, opts: { drive?: Explorable3D } = {}) => {
    if (busy() && !modal.isOpen) return;
    const r = item.ref;
    if (r.kind === 'figure' || r.kind === 'model' || r.kind === 'scene') {
      modal.close(true);
      modal.onChange?.(false);
      if (!model.figureRect(item.page, item.rect)) model.goToPage(item.page - 1);
      raiseGen++;
      threads.clear();
      await popups.foldAll();
      await openFigure(r.data, from, opts);
      return;
    }
    if (r.kind === 'explore') {
      const x = r.data;
      const driveBtns = drivenFigures(x).map((f) => {
        const b = el('button', { type: 'button', class: 'btn link-3d' }, `${ICON.link}<span>Drive Figure ${f.number} in 3D</span>`);
        b.addEventListener('click', () => {
          const fi = items.find((i) => i.id === f.id);
          if (fi) void openItem(fi, from, { drive: x });
        });
        return b;
      });
      modal.open({
        kind: 'explore',
        kicker: item.name,
        title: x.title,
        from,
        variant: 'wide',
        build: (body) => {
          exploreContent(body, x, { mode: plotMode });
          const row = connectedRow(item, from);
          if (row) body.append(row);
        },
        actions: [...driveBtns, keepButton(item)],
      });
      return;
    }
    if (r.kind === 'equation') {
      const pic = await cutOut(model, item);
      const e = r.data;
      modal.open({
        kind: 'equation',
        kicker: item.name,
        title: 'Equation card',
        from,
        build: (body) => {
          equationContent(body, e, pic);
          const row = connectedRow(item, from);
          if (row) body.append(row);
        },
        actions: [keepButton(item)],
      });
      return;
    }
    if (r.kind === 'chapter') {
      openChapter(item, from);
      return;
    }
    if (r.kind !== 'check') return;
    const c = r.data;
    modal.open({ kind: 'check', kicker: item.name, title: 'Check yourself', from, build: (body) => checkContent(body, c), actions: [keepButton(item)] });
  };

  /** Frame the book and the desk together (after the desk grows or shrinks), unless a panel is up. */
  let framedDepth = deskTable?.depth ?? 0;
  const reframe = () => {
    if (busy() || (deskTable?.depth ?? 0) === framedDepth) return;
    framedDepth = deskTable?.depth ?? 0;
    const p = bookPose();
    const cam = stage.camera;
    const from = cam.position.clone();
    void stage.tween(500, (k) => {
      cam.position.lerpVectors(from, p.position, k);
      cam.lookAt(p.target);
    });
  };

  // ---- the desk: what the reader kept
  const paintDesk = () => {
    const n = desk.items.length;
    const due = review.due(desk.items).length;
    const c = deskBtn.querySelector('.count')!;
    c.textContent = String(n);
    deskBtn.classList.toggle('has', n > 0);
    const d = deskBtn.querySelector<HTMLElement>('.due')!;
    d.hidden = !due;
    d.textContent = `${due} due`;
    deskBtn.setAttribute('aria-label', `Your desk: ${n} kept${due ? `, ${due} due for review` : ''}`);
  };
  /** How well a kept card is learned: five pips (its review box) and when it comes back. */
  const strength = (it: Item): HTMLElement => {
    const r = review.get(it.key);
    const box = r?.box ?? 0;
    const days = review.daysLeft(it.key);
    const when = !r ? 'New' : days === 0 ? 'Due now' : `Next ${whenText(days)}`;
    const s = panelEl('span', { class: `strength${review.isDue(it.key) ? ' is-due' : ''}`, role: 'img', 'aria-label': `${r ? `Box ${box} of ${TOP_BOX}` : 'Not studied yet'}; ${when.toLowerCase()}` });
    const pips = panelEl('span', { class: 'pips', 'aria-hidden': 'true' });
    for (let i = 1; i <= TOP_BOX; i++) pips.append(panelEl('i', i <= box ? { class: 'on' } : {}));
    s.append(pips, panelEl('span', { class: 'when', 'aria-hidden': 'true' }, when));
    return s;
  };
  desk.onChange.add(() => {
    paintDesk();
    setTimeout(reframe, 450); // once the card has landed
  });
  paintDesk();
  if (deskTable) {
    const table = deskTable;
    const deskThreads = new Threads(stage, items, links, (k) => table.top(k));
    table.onSynced = () => deskThreads.show(desk.items.map((i) => i.key));
    deskTable.onPick = (it) => void openItem(it);
    void deskTable.sync().then(reframe); // a desk kept from an earlier visit
  }
  const openDesk = (from?: HTMLElement) => {
    modal.open({
      kicker: 'Your desk',
      title: desk.items.length ? `${desk.items.length} kept from the book` : 'Nothing kept yet',
      variant: 'wide desk',
      from,
      build: (body) => {
        if (!desk.items.length) {
          body.append(panelEl('p', { class: 'muted' }, 'Pull something out of the book (a figure, an equation, an explorable or a check) and press “Keep on desk”. It lands on the table in front of the book, ready to open again or to study.'));
          return;
        }
        const grid = panelEl('div', { class: 'desk-grid' });
        for (const it of desk.items) {
          const card = panelEl('div', { class: 'desk-card' });
          card.style.setProperty('--kind', KIND[it.kind].color);
          const pic = panelEl('div', { class: 'desk-pic' });
          void cutOut(model, it, 520).then((c) => {
            if (!c) return;
            const img = panelEl('img', { alt: '' });
            img.src = c.toDataURL('image/png');
            pic.append(img);
          });
          const open = panelEl('button', { type: 'button', class: 'desk-open' });
          open.append(chip(it.kind, it.name), panelEl('span', { class: 'desk-title' }, it.title));
          open.addEventListener('click', () => void openItem(it, deskBtn));
          const rm = panelEl('button', { type: 'button', class: 'btn ghost icon-only', 'aria-label': `Take ${it.name} off your desk` });
          rm.innerHTML = ICON.close;
          rm.addEventListener('click', () => {
            desk.toggle(it);
            openDesk(from);
          });
          card.append(pic, open, rm, strength(it));
          grid.append(card);
        }
        body.append(grid);
      },
      actions: desk.items.length
        ? [
            ...(() => {
              const due = review.due(desk.items).length;
              const study = (ahead: boolean) => startStudy(modal, model, desk.items, deskBtn, (it) => void openItem(it, deskBtn), 'your desk', review, ahead);
              const main = el('button', { type: 'button', class: 'btn primary' }, `${ICON.study}<span>${due ? `Review ${due} due` : 'Practise ahead'}</span>`);
              main.addEventListener('click', () => study(!due));
              if (!due) {
                const next = Math.min(...desk.items.map((it) => review.daysLeft(it.key)));
                main.title = `Nothing is due; your next review is ${whenText(next)}. Practising ahead doesn’t move any card.`;
                return [main];
              }
              const all = el('button', { type: 'button', class: 'btn' }, 'Practise all');
              all.title = 'Go through every kept card; only the due ones are scheduled';
              all.addEventListener('click', () => study(true));
              return due < desk.items.length ? [main, all] : [main];
            })(),
            (() => {
              const b = el('button', { type: 'button', class: 'btn ghost' }, 'Clear the desk');
              b.addEventListener('click', () => {
                if (b.dataset.armed) {
                  desk.clear();
                  openDesk(from);
                } else {
                  b.dataset.armed = '1';
                  b.textContent = 'Clear everything? Press again';
                }
              });
              return b;
            })(),
          ]
        : [],
    });
  };
  deskBtn.addEventListener('click', () => openDesk(deskBtn));

  // ---- pop-up book
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let popOn = !reduced && params.get('popup') !== '0';
  const paintPop = () => popBtn.setAttribute('aria-pressed', String(popOn));
  paintPop();
  void popups.set(popOn, []);
  popBtn.addEventListener('click', () => {
    popOn = !popOn;
    paintPop();
    raiseGen++;
    threads.clear();
    void popups.set(popOn, visibleItems()).then(() => threads.show(visibleItems().map((i) => i.key)));
    say(popOn ? 'Pop-ups on: figures, equations and checks stand up off the page.' : 'Pop-ups off: everything lies flat on the page.');
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
    if (!figureView.isOpen) void raiseSpread();
    say(t2.textContent ?? '');
  });

  const openFigure = async (fig: Figure3D, btn?: HTMLElement, opts: { drive?: Explorable3D } = {}) => {
    top.classList.add('dim');
    prev.hidden = next.hidden = true;
    raiseGen++;
    threads.clear();
    await figureView.open(fig, btn, opts);
  };
  figureView.onClose = (fig) => {
    top.classList.remove('dim');
    prev.hidden = next.hidden = false;
    buildSpots();
    // the hotspots were rebuilt: put keyboard focus back on the figure that was open
    void raiseSpread(); // (with pop-ups off, this just ties the threads on the flat page)
    spots.find((s) => s.item.id === fig.id)?.btn.focus({ preventScroll: true });
  };

  const turn = async (dir: 1 | -1) => {
    if (busy()) return;
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
    if (busy() || drag || e.button > 0) return;
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
    if (busy()) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      void turn(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      void turn(-1);
    } else if (e.key === 'Home') model.goToPage(0);
    else if (e.key === 'End') model.goToPage(book.pages.length - 1);
    else if ((e.key === 'p' || e.key === 'P') && !preview) popBtn.click();
    else if ((e.key === 'd' || e.key === 'D') && !preview) openDesk(deskBtn);
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
  const autoItem = params.get('item');
  if (autoItem) {
    const it = items.find((i) => i.id === autoItem);
    if (it) {
      model.goToPage(it.page - 1);
      setTimeout(() => void openItem(it), 450);
    }
  }
  if (params.has('debug')) Object.assign(window, { __stage: stage, __book: model, __THREE: THREE, __desk: desk, __popups: popups });
  root.dataset.ready = '1';
}

void main();

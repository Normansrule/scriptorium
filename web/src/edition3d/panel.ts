/**
 * Panels over the book: one accessible modal used for everything pulled out of the page
 * (explorables, equation cards, self-checks), the desk and study mode. Focus moves in, Tab stays
 * inside, Escape or the close button returns focus to whatever opened it.
 *
 * Also the content builders for each kind of item, so the same card looks the same in its own
 * panel, on the desk and in study mode.
 */
import { mountExplore } from '../../../src/render/explore-client.ts';
import { latexToText } from '../../../src/render/latex-text.ts';
import type { Check3D, Equation3D, Explorable3D } from '../../../src/edition3d/manifest.ts';
import type { Values } from '../../../src/render/explore.ts';
import type { Mode } from '../../../src/core/style.ts';
import { ICON } from './icons.ts';
import { KIND, type ItemKind } from './kinds.ts';

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
};

/** Book text to plain text: maths as Unicode, markup and citations dropped (the page shows them). */
export function plain(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, (_, m: string) => latexToText(m))
    .replace(/\[@[^\]]+\]/g, '')
    .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*/g, (_, a?: string, b?: string) => a ?? b ?? '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

/** A coloured chip naming the kind of item: colour plus words, never colour alone. */
export function chip(kind: ItemKind, text = KIND[kind].label): HTMLElement {
  const c = el('span', { class: 'chip' });
  c.style.setProperty('--chip', KIND[kind].color);
  c.style.setProperty('--chip-ink', KIND[kind].ink);
  c.innerHTML = KIND[kind].icon;
  c.append(document.createTextNode(text));
  return c;
}

export interface OpenOptions {
  kind?: ItemKind;
  /** small line above the title, e.g. "Explore 2.1" */
  kicker?: string;
  title: string;
  build: (body: HTMLElement) => void;
  /** buttons for the footer (Keep on desk, links…) */
  actions?: HTMLElement[];
  from?: HTMLElement | null;
  /** extra class on the dialog (wide, study…) */
  variant?: string;
  onClose?: () => void;
}

export class Modal {
  private overlay: HTMLElement | null = null;
  private returnTo: HTMLElement | null = null;
  private closing: (() => void) | null = null;
  /** told when any panel opens or closes, so the book can dim and stop turning */
  onChange: ((open: boolean) => void) | null = null;

  constructor(private host: HTMLElement) {}

  get isOpen(): boolean {
    return !!this.overlay;
  }

  open(o: OpenOptions): HTMLElement {
    const reopen = this.isOpen;
    this.close(true);
    this.returnTo = o.from ?? (document.activeElement as HTMLElement | null);
    this.closing = o.onClose ?? null;
    const titleId = `panel-title-${Math.random().toString(36).slice(2, 8)}`;
    const overlay = el('div', { class: 'xpl-overlay' });
    const dialog = el('div', { class: `xpl-dialog ${o.variant ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
    if (o.kind) dialog.style.setProperty('--kind', KIND[o.kind].color);
    const head = el('header', { class: 'xpl-head' });
    const h = el('h2', { id: titleId });
    if (o.kind) h.append(chip(o.kind, o.kicker ?? KIND[o.kind].label));
    else if (o.kicker) h.append(el('span', { class: 'xpl-kicker' }, o.kicker));
    h.append(el('span', { class: 'panel-title' }, o.title));
    const close = el('button', { type: 'button', class: 'btn ghost icon-only', 'aria-label': 'Close and go back to the book' });
    close.innerHTML = ICON.close;
    close.addEventListener('click', () => this.close());
    head.append(h, close);
    const body = el('div', { class: 'panel-body' });
    dialog.append(head, body);
    if (o.actions?.length) {
      const foot = el('footer', { class: 'panel-actions' });
      foot.append(...o.actions);
      dialog.append(foot);
    }
    overlay.append(dialog);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) this.close(); // a click on the dimmed book closes it
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Tab') trap(e, dialog);
    });
    this.host.append(overlay);
    this.overlay = overlay;
    o.build(body);
    if (!reopen) this.onChange?.(true);
    (dialog.querySelector<HTMLElement>('[data-autofocus], input[type=range], .panel-body button, .panel-actions button') ?? close).focus({ preventScroll: true });
    return dialog;
  }

  close(quiet = false): void {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    const done = this.closing;
    this.closing = null;
    done?.();
    if (quiet) return;
    this.onChange?.(false);
    if (this.returnTo?.isConnected) this.returnTo.focus({ preventScroll: true });
  }
}

export function trap(e: KeyboardEvent, root: HTMLElement): void {
  const items = [...root.querySelectorAll<HTMLElement>('button, input, summary, a[href], [tabindex="0"]')].filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ---------------------------------------------------------------------------
// Content for each kind of item

export function exploreContent(body: HTMLElement, x: Explorable3D, opts: { mode: () => Mode; onChange?: (v: Values) => void; compact?: boolean }): void {
  const b = x.block as { prompt?: string; notice?: string };
  const box = el('div', { class: `explore xpl-live-panel${opts.compact ? ' compact' : ''}` });
  box.dataset.explore = JSON.stringify(x.block);
  const prompt = el('p', { class: 'xpl-prompt' }, plain(b.prompt ?? ''));
  const plot = el('div', { class: 'xpl-plot' });
  const controls = el('div', { class: 'xpl-static' });
  const notice = el('details', { class: 'xpl-notice' });
  notice.append(el('summary', {}, 'What to notice'), el('p', {}, plain(b.notice ?? '')));
  box.append(...(opts.compact ? [] : [prompt]), plot, controls, ...(opts.compact ? [] : [notice]));
  body.append(box);
  mountExplore(box, { mode: opts.mode, onChange: opts.onChange });
}

export function equationContent(body: HTMLElement, e: Equation3D, picture: HTMLCanvasElement | null): void {
  body.append(el('p', { class: 'eq-intuition' }, e.intuition));
  if (picture) {
    const fig = el('figure', { class: 'eq-picture' });
    const img = el('img', { alt: `Eq. (${e.number}): ${e.text}` });
    img.src = picture.toDataURL('image/png');
    fig.append(img);
    body.append(fig);
  } else body.append(el('p', { class: 'eq-text' }, e.text));
  const t = el('table', { class: 'eq-symbols' });
  const cap = el('caption', {}, 'Every symbol, with its unit');
  t.append(cap);
  for (const s of e.symbols) {
    const tr = el('tr');
    tr.append(el('th', { scope: 'row' }, s.symbol), el('td', {}, s.meaning), el('td', { class: 'unit' }, s.unit));
    t.append(tr);
  }
  body.append(t);
  const ex = el('div', { class: 'eq-example' });
  ex.append(el('p', { class: 'mini-label' }, 'Worked example'), el('p', {}, e.example));
  body.append(ex);
  body.append(el('p', { class: 'eq-valid' }, `Valid when: ${e.validity}`));
}

/** A self-check: choosing an answer reveals why; `onAnswer` hears whether the first choice was right. */
export function checkContent(body: HTMLElement, c: Check3D, onAnswer?: (rightFirstTime: boolean) => void): void {
  body.append(el('p', { class: 'chk-question' }, c.question));
  const list = el('div', { class: 'chk-options', role: 'group', 'aria-label': 'Answers' });
  const why = el('p', { class: 'chk-why', role: 'status', 'aria-live': 'polite' });
  let first = true;
  c.options.forEach((o, i) => {
    const b = el('button', { type: 'button', class: 'chk-option' });
    b.append(el('span', { class: 'opt-letter', 'aria-hidden': 'true' }, String.fromCharCode(97 + i)), el('span', {}, o.text));
    b.addEventListener('click', () => {
      for (const x of list.querySelectorAll('button')) x.classList.remove('picked');
      b.classList.add('picked', o.correct ? 'right' : 'wrong');
      why.className = `chk-why ${o.correct ? 'right' : 'wrong'}`;
      why.textContent = `${o.correct ? 'Right.' : 'Not quite.'} ${o.why}`;
      if (first) {
        first = false;
        onAnswer?.(o.correct);
      }
    });
    list.append(b);
  });
  body.append(list, why);
}

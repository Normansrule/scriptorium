/**
 * Explorables in the 3D Edition: the printed box on the page gets a "Try it" hotspot, and the
 * live version (the same sliders, plot and numbers as the web edition) opens in a panel over the
 * book. A modal dialog: focus moves in, Tab stays inside, Escape or the close button returns focus
 * to the hotspot that opened it.
 */
import { mountExplore } from '../../../src/render/explore-client.ts';
import { latexToText } from '../../../src/render/latex-text.ts';
import type { Explorable3D } from '../../../src/edition3d/manifest.ts';
import type { Mode } from '../../../src/core/style.ts';
import { ICON } from './icons.ts';

/** Book text to plain text: maths as Unicode, markup and citations dropped (the page shows them). */
function plain(s: string): string {
  return s
    .replace(/\$([^$]+)\$/g, (_, m: string) => latexToText(m))
    .replace(/\[@[^\]]+\]/g, '')
    .replace(/\*\*([^*]+)\*\*|\*([^*]+)\*/g, (_, a?: string, b?: string) => a ?? b ?? '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
};

export class ExplorePanel {
  private overlay: HTMLElement | null = null;
  private returnTo: HTMLElement | null = null;
  onClose: ((x: Explorable3D) => void) | null = null;
  private current: Explorable3D | null = null;

  constructor(
    private host: HTMLElement,
    private mode: () => Mode,
  ) {}

  get isOpen(): boolean {
    return !!this.overlay;
  }

  open(x: Explorable3D, from?: HTMLElement): void {
    this.close();
    this.current = x;
    this.returnTo = from ?? null;
    const b = x.block as { prompt?: string; notice?: string };
    const titleId = `xpl-title-${x.id}`;
    const overlay = el('div', { class: 'xpl-overlay' });
    const dialog = el('div', { class: 'xpl-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId });
    const head = el('header', { class: 'xpl-head' });
    const h = el('h2', { id: titleId });
    h.append(el('span', { class: 'xpl-kicker' }, `Explore ${x.number}`), document.createTextNode(` ${x.title}`));
    const close = el('button', { type: 'button', class: 'btn ghost', 'aria-label': 'Close and go back to the page' });
    close.innerHTML = ICON.close;
    close.addEventListener('click', () => this.close());
    head.append(h, close);
    const body = el('div', { class: 'explore xpl-live-panel' });
    body.dataset.explore = JSON.stringify(x.block);
    const prompt = el('p', { class: 'xpl-prompt' }, plain(b.prompt ?? ''));
    const plot = el('div', { class: 'xpl-plot' });
    const controls = el('div', { class: 'xpl-static' });
    const notice = el('details', { class: 'xpl-notice' });
    notice.append(el('summary', {}, 'What to notice'), el('p', {}, plain(b.notice ?? '')));
    body.append(prompt, plot, controls, notice);
    dialog.append(head, body);
    overlay.append(dialog);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) this.close(); // a click on the dimmed book closes it
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Tab') this.trap(e, dialog);
    });
    this.host.append(overlay);
    this.overlay = overlay;
    mountExplore(body, { mode: this.mode });
    (dialog.querySelector<HTMLElement>('input[type=range]') ?? close).focus({ preventScroll: true });
  }

  close(): void {
    if (!this.overlay) return;
    const x = this.current!;
    this.overlay.remove();
    this.overlay = null;
    this.current = null;
    this.onClose?.(x);
    this.returnTo?.focus({ preventScroll: true });
  }

  private trap(e: KeyboardEvent, dialog: HTMLElement): void {
    const items = [...dialog.querySelectorAll<HTMLElement>('button, input, summary, [tabindex="0"]')].filter((n) => !n.hasAttribute('disabled'));
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
}

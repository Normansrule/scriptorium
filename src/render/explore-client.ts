/**
 * Live explorables for the web edition and the app preview (bundled into assets/viewer3d.js).
 *
 * Finds <div class="explore" data-explore="…">, replaces the printed still and the range table
 * with sliders, a live plot and live numbers. The plot comes from the same functions that drew
 * the still (src/render/explore.ts). Without this script the still stays: the static fallback.
 *
 * Interaction: every slider is a native range input (keyboard, touch and screen readers work);
 * "Pin" keeps up to two earlier curves for comparison; "Sweep" plays the first slider across its
 * range (skipped when the reader asks for reduced motion); "Reset" goes back to the defaults.
 * Changes are announced politely, after the reader stops moving the slider.
 */
import type { Explore } from '../core/book.ts';
import type { Mode } from '../core/style.ts';
import { defaults, exploreSpec, exploreSvg, formatValue, fromSlider, paramText, readouts, SLIDER_STEPS, toSlider, type Values } from './explore.ts';

const MAX_PINS = 2;

function mode(): Mode {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
};

/** The block as rendered by our own HTML renderer; reject anything that is not shaped like one. */
function parse(raw: string | undefined): Explore | null {
  try {
    const b = JSON.parse(raw ?? '') as Explore;
    if (b?.kind !== 'explore' || !Array.isArray(b.params) || !b.params.length || !b.plot?.series?.length) return null;
    return b;
  } catch {
    return null;
  }
}

export interface MountOptions {
  /** colour mode for the plot (default: follow the reader's light or dark setting) */
  mode?: () => Mode;
}

export function mountExplore(box: HTMLElement, opts: MountOptions = {}): void {
  const colourMode = opts.mode ?? mode;
  if (box.dataset.mounted) return;
  const b = parse(box.dataset.explore);
  const plotHost = box.querySelector<HTMLElement>('.xpl-plot');
  const staticPart = box.querySelector<HTMLElement>('.xpl-static');
  if (!b || !plotHost || !staticPart) return;
  box.dataset.mounted = '1';

  let values: Values = defaults(b);
  let pinned: Values[] = [];
  let frame = 0;
  let sweeping = 0;

  // ---- controls
  const controls = el('div', { class: 'xpl-controls' });
  const outputs: Record<string, HTMLOutputElement> = {};
  const ranges: Record<string, HTMLInputElement> = {};
  for (const p of b.params) {
    const id = `${b.id}-${p.name}`;
    const row = el('div', { class: 'xpl-slider' });
    const label = el('label', { for: id }, p.label);
    const range = el('input', { type: 'range', id, min: '0', max: String(SLIDER_STEPS), step: '1', value: String(toSlider(p, p.value)) });
    const out = el('output', { for: id });
    range.addEventListener('input', () => {
      stopSweep();
      values = { ...values, [p.name]: fromSlider(p, Number(range.value)) };
      schedule();
    });
    row.append(label, range, out);
    controls.append(row);
    outputs[p.name] = out;
    ranges[p.name] = range;
  }
  const list = el('ul', { class: 'xpl-readouts', 'aria-label': 'Live values' });
  const readoutEls = b.readouts.map((r) => {
    const li = el('li');
    li.append(el('span', { class: 'xpl-label' }, r.label), el('output'));
    list.append(li);
    return li.querySelector('output')!;
  });
  const buttons = el('div', { class: 'xpl-buttons' });
  const pinBtn = el('button', { type: 'button', title: 'Keep this curve on the plot to compare with the next one' }, 'Pin this curve');
  const clearBtn = el('button', { type: 'button' }, 'Clear pins');
  const sweepBtn = el('button', { type: 'button', title: `Move ${b.params[0]!.label} slowly from its lowest to its highest value` }, `Sweep ${b.params[0]!.name}`);
  const resetBtn = el('button', { type: 'button' }, 'Reset');
  buttons.append(pinBtn, clearBtn, ...(reducedMotion() ? [] : [sweepBtn]), resetBtn);
  const live = el('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const stage = el('div', { class: 'xpl-svg', role: 'img' });
  plotHost.replaceChildren(stage);
  staticPart.replaceChildren(controls, ...(b.readouts.length ? [list] : []), buttons, live);
  staticPart.classList.add('xpl-live');

  pinBtn.addEventListener('click', () => {
    pinned = [...pinned, { ...values }].slice(-MAX_PINS);
    say(`Pinned: ${paramText(b, values)}.`);
    draw();
  });
  clearBtn.addEventListener('click', () => {
    pinned = [];
    say('Pins cleared.');
    draw();
  });
  resetBtn.addEventListener('click', () => {
    stopSweep();
    values = defaults(b);
    for (const p of b.params) ranges[p.name]!.value = String(toSlider(p, p.value));
    say(`Back to the defaults: ${paramText(b, values)}.`);
    draw();
  });
  sweepBtn.addEventListener('click', () => {
    if (sweeping) return stopSweep();
    const p = b.params[0]!;
    const t0 = performance.now();
    sweepBtn.textContent = 'Stop';
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / 3200);
      // ease in and out, so the start and the end (often the interesting parts) linger
      const k = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      const pos = Math.round(k * SLIDER_STEPS);
      ranges[p.name]!.value = String(pos);
      values = { ...values, [p.name]: fromSlider(p, pos) };
      draw(false);
      sweeping = u < 1 ? requestAnimationFrame(step) : 0;
      if (!sweeping) {
        sweepBtn.textContent = `Sweep ${p.name}`;
        say(summary());
      }
    };
    sweeping = requestAnimationFrame(step);
  });

  function stopSweep(): void {
    if (!sweeping) return;
    cancelAnimationFrame(sweeping);
    sweeping = 0;
    sweepBtn.textContent = `Sweep ${b!.params[0]!.name}`;
  }

  // ---- drawing
  let announce = 0;
  const say = (s: string) => {
    live.textContent = s;
  };
  const summary = () => {
    const r = readouts(b, values).map((x) => `${x.label} ${x.text}${x.unit ? ` ${x.unit}` : ''}`);
    return `${paramText(b, values)}.${r.length ? ` ${r.join('; ')}.` : ''}`;
  };
  function schedule(): void {
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }
  function draw(announceIt = true): void {
    stage.innerHTML = exploreSvg(b!, values, colourMode(), pinned); // our own escaped SVG, no outside markup
    stage.setAttribute('aria-label', exploreSpec(b!, values, { pinned }).desc);
    for (const p of b!.params) outputs[p.name]!.textContent = `${formatValue(values[p.name]!, 3)}${p.unit ? ` ${p.unit}` : ''}`;
    readouts(b!, values).forEach((r, i) => (readoutEls[i]!.textContent = `${r.text}${r.unit ? ` ${r.unit}` : ''}`));
    clearBtn.disabled = !pinned.length;
    if (announceIt) {
      clearTimeout(announce);
      announce = window.setTimeout(() => say(summary()), 700);
    }
  }
  if (typeof matchMedia === 'function') matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => draw(false));
  draw(false);
}

export function mountExplorables(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('.explore[data-explore]').forEach((box) => mountExplore(box));
}

/** Tiny DOM helpers: attributes and text only, never innerHTML. */
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void) | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
}

export function select(name: string, values: string[], labels = values, value?: string): HTMLSelectElement {
  const s = h('select', { name }, ...values.map((v, i) => h('option', { value: v }, labels[i]!)));
  if (value !== undefined) s.value = value;
  return s;
}

/** Save bytes or text as a file (blob URL; the desktop app routes it to the Downloads folder). */
export function saveFile(name: string, data: Uint8Array | string, type: string): void {
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Auto-growing textarea for editing prose. */
export function prose(value: string, label: string, oninput: (v: string) => void, rows = 3): HTMLTextAreaElement {
  const t = h('textarea', { rows: String(rows), 'aria-label': label, spellcheck: 'true' });
  t.value = value;
  const fit = () => {
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 2}px`;
  };
  t.addEventListener('input', () => {
    fit();
    oninput(t.value);
  });
  queueMicrotask(fit);
  return t;
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'book';

/**
 * Diagrams for the README: the 9-stage pipeline (animated), the security model, and the
 * five writing layers. Each follows docs/STYLE.md and is drawn in light and dark.
 */
import { arrow, palette, svgDoc, text, type Pal } from '../../src/render/svg.ts';
import { STAGES } from '../../src/core/pipeline.ts';
import { motion, type Mode, type Role } from '../../src/core/style.ts';

export function card(p: Pal, x: number, y: number, w: number, h: number, role: Role | null, lines: Array<{ t: string; size?: number; weight?: number; fill?: string }>, cls = ''): string {
  const bar = role ? `<rect x="${x}" y="${y}" width="5" height="${h}" rx="2" fill="${p.role(role)}"/>` : '';
  const fill = role ? p.tint(role) : p.panel;
  let ty = y + 22;
  const ts = lines
    .map((l) => {
      const s = text(x + 16, ty, l.t, { fill: l.fill ?? p.ink, size: l.size ?? 12, weight: l.weight });
      ty += (l.size ?? 12) + 6;
      return s;
    })
    .join('');
  return `<g class="${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${p.rule}" stroke-width="1.5"/>${bar}${ts}</g>`;
}

export function wrap(s: string, n: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if ((cur + ' ' + w).trim().length > n) {
      out.push(cur.trim());
      cur = w;
    } else cur += ' ' + w;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function pipeline(mode: Mode): string {
  const p = palette(mode);
  const W = 880;
  const cw = 256;
  const ch = 84;
  const gx = 36;
  const gy = 34;
  const x0 = 20;
  const y0 = 20;
  const parts: string[] = [];
  const css: string[] = [];
  const slot = 100 / 11; // 9 stages, the two checkpoints hold for an extra slot each
  let t = 0;
  STAGES.forEach((s, i) => {
    const r = Math.floor(i / 3);
    const c = i % 3;
    const x = x0 + c * (cw + gx);
    const y = y0 + r * (ch + gy);
    const lines = [{ t: `${i + 1}  ${s.name}`, size: 14, weight: 600 }, ...wrap(s.what, 40).map((l) => ({ t: l, size: 11.5, fill: p.muted }))];
    parts.push(card(p, x, y, cw, ch, s.checkpoint ? 'checkpoint' : null, lines));
    if (s.checkpoint) parts.push(`<rect x="${x + cw - 82}" y="${y + 9}" width="72" height="18" rx="4" fill="${p.paper}" stroke="${p.role('checkpoint')}" stroke-width="1.5"/>${text(x + cw - 46, y + 22, 'you decide', { fill: p.ink, size: 11, weight: 600, anchor: 'middle' })}`);
    const start = t;
    const dur = s.checkpoint ? 2 * slot : slot;
    t += dur;
    css.push(`@keyframes hl${i} { 0%, ${start.toFixed(2)}% { opacity: 0; } ${(start + 1.5).toFixed(2)}%, ${(start + dur - 1.5).toFixed(2)}% { opacity: 1; } ${(start + dur).toFixed(2)}%, 100% { opacity: 0; } }
.hl${i} { opacity: 0; animation: hl${i} 9s ${motion.easing} infinite; }`);
    parts.push(`<rect class="hl${i}" x="${x - 3}" y="${y - 3}" width="${cw + 6}" height="${ch + 6}" rx="10" fill="none" stroke="${p.role('signal')}" stroke-width="3"/>`);
    if (c < 2) parts.push(arrow(x + cw + 6, y + ch / 2, x + cw + gx - 6, y + ch / 2, p.muted));
    else if (i < 8) {
      const nx = x0 + cw / 2;
      const ny = y + ch + gy;
      parts.push(`<path d="M${x + cw / 2},${y + ch + 4} v${gy / 2 - 4} H${nx} v${gy / 2 - 10}" fill="none" stroke="${p.muted}" stroke-width="1.5"/><path d="M${nx},${ny - 4} l-4,-7 h8 z" fill="${p.muted}"/>`);
    }
  });
  const H = y0 + 3 * ch + 2 * gy + 20;
  const style = `<style>${css.join('\n')}\n@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }</style>`;
  return svgDoc(W, H, 'The nine-stage pipeline', 'Nine stages in reading order: topic and scope, outline (human checkpoint), research, verification, drafting, figures and equations, expert review, readability, layout and export (human checkpoint). A highlight moves through the stages and pauses at the two checkpoints.', style + parts.join('\n'), p);
}

export function security(mode: Mode): string {
  const p = palette(mode);
  const W = 880;
  const H = 400;
  const parts: string[] = [];
  parts.push(`<rect x="16" y="16" width="400" height="368" rx="12" fill="${p.tint('verified')}" stroke="${p.role('verified')}" stroke-width="1.5"/>`);
  parts.push(text(34, 44, 'Stays on your machine', { fill: p.ink, size: 16, weight: 600 }));
  parts.push(text(34, 64, 'browser tab or desktop app', { fill: p.muted, size: 12 }));
  const local = [
    ['API key', 'session memory or OS keychain; never logged or exported'],
    ['Book project', 'outline, drafts, figures, verification report'],
    ['Exports', 'web book, print PDF, cover, EPUB, AI disclosure'],
    ['Checks', 'schema validation, citation guard, safe plot parser'],
  ];
  local.forEach(([a, b], i) => parts.push(card(p, 34, 84 + i * 72, 364, 60, null, [{ t: a!, size: 13, weight: 600 }, { t: b!, size: 11.5, fill: p.muted }])));

  parts.push(`<rect x="520" y="16" width="344" height="190" rx="12" fill="${p.tint('external')}" stroke="${p.role('external')}" stroke-width="1.5"/>`);
  parts.push(text(538, 44, 'Leaves: model provider', { fill: p.ink, size: 16, weight: 600 }));
  parts.push(text(538, 64, 'api.anthropic.com only', { fill: p.muted, size: 12 }));
  ['Your key (request header, HTTPS)', 'Topic, outline, section plans', 'Verified reference titles + abstracts', 'Drafts sent for review'].forEach((t, i) => parts.push(text(538, 92 + i * 24, `• ${t}`, { fill: p.ink, size: 12.5 })));
  parts.push(text(538, 192, 'Capped by your per-book token limit', { fill: p.muted, size: 11.5 }));

  parts.push(`<rect x="520" y="224" width="344" height="168" rx="12" fill="${p.tint('external')}" stroke="${p.role('external')}" stroke-width="1.5"/>`);
  parts.push(text(538, 252, 'Leaves: public databases', { fill: p.ink, size: 16, weight: 600 }));
  parts.push(text(538, 272, 'Crossref, OpenAlex, PubMed, PubChem, RCSB PDB', { fill: p.muted, size: 12 }));
  ['Search keywords, DOIs, PubMed IDs', 'Compound names, PDB IDs (for 3D models)', 'No key, no drafts, no personal data'].forEach((t, i) => parts.push(text(538, 298 + i * 23, `• ${t}`, { fill: p.ink, size: 12.5 })));
  parts.push(text(538, 376, 'Replies are untrusted data, never instructions', { fill: p.muted, size: 11.5 }));

  parts.push(arrow(420, 110, 514, 110, p.role('external')));
  parts.push(arrow(514, 150, 420, 150, p.muted));
  parts.push(text(467, 102, 'prompts', { anchor: 'middle', fill: p.ink, size: 11 }));
  parts.push(text(467, 168, 'JSON only', { anchor: 'middle', fill: p.ink, size: 11 }));
  parts.push(arrow(420, 290, 514, 290, p.role('external')));
  parts.push(arrow(514, 330, 420, 330, p.muted));
  parts.push(text(467, 282, 'queries', { anchor: 'middle', fill: p.ink, size: 11 }));
  parts.push(text(467, 348, 'metadata', { anchor: 'middle', fill: p.ink, size: 11 }));
  return svgDoc(W, H, 'Security model', 'Left: what stays on your machine (API key, book project, exports, checks). Right, top: what goes to the model provider (key in the request header, topic, outline, reference titles and abstracts, drafts) and returns only schema-checked JSON. Right, bottom: what goes to public databases — Crossref, OpenAlex, PubMed, PubChem and the Protein Data Bank (search keywords, DOIs, PubMed IDs, compound names and PDB IDs, no key) — and returns data treated as untrusted.', parts.join('\n'), p);
}

export function layers(mode: Mode): string {
  const p = palette(mode);
  const W = 880;
  const rows = [
    ['In short', 'One plain paragraph: the whole idea, no jargon.', 'A capacitor charged through a resistor fills fast, then slowly.'],
    ['Intuition', 'Analogy and picture before any math.', 'Filling a rigid tank through a narrow hose.'],
    ['The detail', 'Numbered equations, every symbol with units, a checked worked example.', 'τ = RC;  v(t) = Vₛ(1 − e^(−t/τ))'],
    ['Limits', 'Where the model breaks, what real parts do differently.', 'Leakage and meter resistance change the numbers.'],
    ['Key takeaways', 'Two or three lines to remember.', '63 % after 1τ, 99 % after 5τ.'],
  ];
  const parts: string[] = [];
  const bh = 56;
  rows.forEach(([name, what, ex], i) => {
    const y = 16 + i * (bh + 10);
    const indent = i * 18;
    parts.push(`<rect x="${16 + indent}" y="${y}" width="${W - 32 - indent}" height="${bh}" rx="8" fill="${i === 2 ? p.tint('signal') : p.panel}" stroke="${p.rule}" stroke-width="1.5"/>`);
    parts.push(text(32 + indent, y + 24, `${i + 1}  ${name}`, { fill: p.ink, size: 14, weight: 600 }));
    parts.push(text(32 + indent, y + 43, what!, { fill: p.muted, size: 12 }));
    parts.push(text(W - 32, y + 33, ex!, { fill: p.ink, size: 12.5, anchor: 'end', italic: true }));
  });
  const H = 16 + rows.length * (bh + 10) + 6;
  return svgDoc(W, H, 'The five writing layers', 'Every section is written in five layers, each a little deeper: in short, intuition, the detail (equations), limits, key takeaways. A reader can stop after any layer and still have a correct picture.', parts.join('\n'), p);
}

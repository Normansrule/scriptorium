/**
 * Code-drawn SVG figures that follow docs/STYLE.md. Every figure is rendered twice, once
 * per color mode, from the same drawing function; print uses the light version.
 *
 * Coordinates are in CSS pixels at 96 px/in. A full-width print figure is 4.5 in = 432 px,
 * so 1.5 px strokes print at 1.125 pt and 11 px labels at 8.25 pt — both above the
 * STYLE.md print floors (1 pt lines, 8 pt labels).
 */
import { compile } from '../core/expr.ts';
import { dashes, fonts, hexToRgba, fillAlpha, roles, surface, type Mode, type Role } from '../core/style.ts';

export const PX_PER_IN = 96;
export const FIG_WIDTH_PX = 432;

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface Pal {
  mode: Mode;
  paper: string;
  panel: string;
  ink: string;
  muted: string;
  rule: string;
  role: (r: Role) => string;
  tint: (r: Role) => string;
}

export function palette(mode: Mode): Pal {
  return {
    mode,
    paper: surface.paper[mode],
    panel: surface.panel[mode],
    ink: surface.ink[mode],
    muted: surface.muted[mode],
    rule: surface.rule[mode],
    role: (r) => roles[r][mode],
    tint: (r) => hexToRgba(roles[r][mode], fillAlpha[mode]),
  };
}

export function svgDoc(width: number, height: number, title: string, desc: string, body: string, pal: Pal, opts: { transparent?: boolean } = {}): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="t d" font-family="'${fonts.sans}', 'Source Sans Pro', 'Helvetica Neue', Arial, sans-serif">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
${opts.transparent ? '' : `<rect width="${width}" height="${height}" fill="${pal.paper}"/>`}
${body}
</svg>
`;
}

export function text(x: number, y: number, s: string, o: { size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; weight?: number; italic?: boolean; baseline?: string } = {}): string {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size ?? 11}" fill="${o.fill ?? 'currentColor'}" text-anchor="${o.anchor ?? 'start'}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.italic ? ' font-style="italic"' : ''}${o.baseline ? ` dominant-baseline="${o.baseline}"` : ''}>${esc(s)}</text>`;
}

export function line(x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1.5, dash = 'none'): string {
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${w}"${dash !== 'none' ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;
}

export function arrowHead(x: number, y: number, angleRad: number, fill: string, size = 7): string {
  const a1 = angleRad + Math.PI * 0.85;
  const a2 = angleRad - Math.PI * 0.85;
  return `<path d="M${x.toFixed(1)},${y.toFixed(1)} L${(x + size * Math.cos(a1)).toFixed(1)},${(y + size * Math.sin(a1)).toFixed(1)} L${(x + size * Math.cos(a2)).toFixed(1)},${(y + size * Math.sin(a2)).toFixed(1)} Z" fill="${fill}"/>`;
}

export function arrow(x1: number, y1: number, x2: number, y2: number, stroke: string, w = 1.5): string {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const bx = x2 - 5 * Math.cos(ang);
  const by = y2 - 5 * Math.sin(ang);
  return line(x1, y1, bx, by, stroke, w) + arrowHead(x2, y2, ang, stroke);
}

// ---------------------------------------------------------------------------
// Plots

export interface Series {
  label: string;
  expr: string;
  role?: Role;
  vars?: Record<string, number>;
  /** where to put the direct label, as an x value */
  labelAt?: number;
  labelDy?: number;
  labelAnchor?: 'start' | 'middle' | 'end';
  /** Draw the label next to the line. Default true; turn off where the legend alone reads better. */
  direct?: boolean;
}

export interface KeyPoint {
  x: number;
  y: number;
  label: string;
  role?: Role;
  /** label offset in px */
  dx?: number;
  dy?: number;
  guides?: boolean;
  anchor?: 'start' | 'middle' | 'end';
}

export interface PlotSpec {
  title: string;
  desc: string;
  x: { label: string; from: number; to: number; log?: boolean; ticks?: number[]; tickFormat?: (v: number) => string };
  y: { label: string; from: number; to: number; ticks?: number[]; tickFormat?: (v: number) => string };
  series: Series[];
  points?: KeyPoint[];
  /** straight reference lines in data coordinates */
  refLines?: Array<{ x1: number; y1: number; x2: number; y2: number; label?: string; labelX?: number; labelY?: number }>;
  width?: number;
  height?: number;
  samples?: number;
}

export function plot(spec: PlotSpec, mode: Mode): string {
  const pal = palette(mode);
  const W = spec.width ?? FIG_WIDTH_PX;
  const H = spec.height ?? 270;
  const m = { l: 52, r: 18, t: 14, b: 44 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const lx = (v: number) => (spec.x.log ? Math.log10(v) : v);
  const X = (v: number) => m.l + ((lx(v) - lx(spec.x.from)) / (lx(spec.x.to) - lx(spec.x.from))) * pw;
  const Y = (v: number) => m.t + ph - ((v - spec.y.from) / (spec.y.to - spec.y.from)) * ph;
  const clampY = (v: number) => Math.min(Math.max(v, spec.y.from - (spec.y.to - spec.y.from) * 0.02), spec.y.to);

  const parts: string[] = [];
  const fmt = (f: ((v: number) => string) | undefined, v: number) => (f ? f(v) : String(Math.round(v * 1000) / 1000));

  // grid + ticks
  for (const t of spec.y.ticks ?? []) {
    parts.push(line(m.l, Y(t), m.l + pw, Y(t), pal.rule, 1));
    parts.push(text(m.l - 6, Y(t) + 4, fmt(spec.y.tickFormat, t), { anchor: 'end', fill: pal.muted, size: 11 }));
  }
  for (const t of spec.x.ticks ?? []) {
    parts.push(line(X(t), m.t, X(t), m.t + ph, pal.rule, 1));
    parts.push(text(X(t), m.t + ph + 16, fmt(spec.x.tickFormat, t), { anchor: 'middle', fill: pal.muted, size: 11 }));
  }
  // axes
  parts.push(line(m.l, m.t + ph, m.l + pw, m.t + ph, pal.muted, 1));
  parts.push(line(m.l, m.t, m.l, m.t + ph, pal.muted, 1));
  parts.push(text(m.l + pw / 2, H - 6, spec.x.label, { anchor: 'middle', fill: pal.ink, size: 12 }));
  parts.push(`<text transform="translate(13 ${(m.t + ph / 2).toFixed(1)}) rotate(-90)" font-size="12" fill="${pal.ink}" text-anchor="middle">${esc(spec.y.label)}</text>`);

  // reference lines
  for (const r of spec.refLines ?? []) {
    parts.push(line(X(r.x1), Y(r.y1), X(r.x2), Y(r.y2), pal.muted, 1, '4 3'));
    if (r.label) parts.push(text(X(r.labelX ?? r.x2), Y(r.labelY ?? r.y2) - 6, r.label, { fill: pal.muted, size: 11, anchor: 'end' }));
  }

  // series
  const n = spec.samples ?? 240;
  spec.series.forEach((s, i) => {
    const f = compile(s.expr);
    const color = s.role ? pal.role(s.role) : pal.ink;
    const pts: string[] = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const xv = spec.x.log ? 10 ** (lx(spec.x.from) + u * (lx(spec.x.to) - lx(spec.x.from))) : spec.x.from + u * (spec.x.to - spec.x.from);
      const yv = f({ x: xv, ...(s.vars ?? {}) });
      if (Number.isFinite(yv)) pts.push(`${X(xv).toFixed(1)},${Y(clampY(yv)).toFixed(1)}`);
    }
    const dash = dashes[i % dashes.length]!;
    parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round"${dash !== 'none' ? ` stroke-dasharray="${dash}"` : ''}/>`);
    if (s.direct !== false && s.label) {
      const at = s.labelAt ?? spec.x.to;
      const yv = f({ x: at, ...(s.vars ?? {}) });
      parts.push(text(X(at), Y(clampY(yv)) + (s.labelDy ?? -8), s.label, { fill: pal.ink, size: 12, anchor: s.labelAnchor ?? (at >= spec.x.to ? 'end' : 'start'), weight: 600 }));
    }
  });

  // legend (≥ 2 series): a short line sample in the series' color and dash, plus its label; wraps to new rows
  if (spec.series.length >= 2) {
    const rowH = 18;
    const items: string[] = [];
    let lxPos = m.l + 10;
    let row = 0;
    let maxRight = lxPos;
    spec.series.forEach((s, i) => {
      const w = 27 + s.label.length * 6.2 + 14;
      if (lxPos + w > m.l + pw && lxPos > m.l + 10) {
        row++;
        lxPos = m.l + 10;
      }
      const ly = m.t + 11 + row * rowH;
      const color = s.role ? pal.role(s.role) : pal.ink;
      const dash = dashes[i % dashes.length]!;
      items.push(`<line x1="${lxPos}" y1="${ly}" x2="${lxPos + 22}" y2="${ly}" stroke="${color}" stroke-width="2.25"${dash !== 'none' ? ` stroke-dasharray="${dash}"` : ''}/>`);
      items.push(text(lxPos + 27, ly + 4, s.label, { fill: pal.ink, size: 11 }));
      lxPos += w;
      maxRight = Math.max(maxRight, lxPos);
    });
    parts.push(`<rect x="${m.l + 3}" y="${m.t + 1}" width="${maxRight - m.l - 10}" height="${(row + 1) * rowH + 2}" rx="4" fill="${pal.paper}" stroke="${pal.rule}"/>`);
    parts.push(...items);
  }

  // key points
  for (const p of spec.points ?? []) {
    const color = p.role ? pal.role(p.role) : pal.ink;
    if (p.guides !== false) {
      parts.push(line(X(p.x), Y(p.y), X(p.x), m.t + ph, pal.muted, 1, '2 3'));
      parts.push(line(m.l, Y(p.y), X(p.x), Y(p.y), pal.muted, 1, '2 3'));
    }
    parts.push(`<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="4" fill="${pal.paper}" stroke="${color}" stroke-width="2"/>`);
    parts.push(text(X(p.x) + (p.dx ?? 8), Y(p.y) + (p.dy ?? -8), p.label, { fill: pal.ink, size: 11.5, anchor: p.anchor ?? (p.dx === 0 ? 'middle' : 'start') }));
  }

  return svgDoc(W, H, spec.title, spec.desc, parts.join('\n'), pal);
}

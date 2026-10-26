/**
 * Explorables, shared by every output: the web edition's live version (viewer3d-client.ts), the
 * print and ebook stills, the editor preview and the build checks all turn an `explore` block
 * into a plot through these functions, so what the reader drags is what the book prints.
 */
import type { Explore } from '../core/book.ts';
import { compile } from '../core/expr.ts';
import type { Mode, Role } from '../core/style.ts';
import { plot, type PlotSpec, type Series } from './svg.ts';

export type Values = Record<string, number>;

export const defaults = (b: Explore): Values => Object.fromEntries(b.params.map((p) => [p.name, p.value]));

/**
 * About five round tick values covering [from, to]: steps of 1, 2 or 5 × 10ⁿ, the way a person
 * would label an axis. Logarithmic axes get one tick per decade.
 */
export function niceTicks(from: number, to: number, log = false): number[] {
  if (log) {
    const out: number[] = [];
    for (let e = Math.ceil(Math.log10(from) - 1e-9); e <= Math.floor(Math.log10(to) + 1e-9); e++) out.push(10 ** e);
    return out;
  }
  const raw = (to - from) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // the round step nearest to a fifth of the range, never so small that labels crowd
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw * 0.7)!;
  const out: number[] = [];
  for (let v = Math.ceil(from / step - 1e-9) * step; v <= to + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

const SUPER: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/** A number the way a reader writes it: 3 significant figures at most, no trailing zeros, no "1e-7". */
export function formatValue(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e6 || a < 1e-3)) {
    const [m, e] = v.toExponential(Math.min(digits, 3)).split('e') as [string, string];
    const mant = m.replace(/\.?0+$/, '');
    const pow = `10${String(Number(e)).replace(/./g, (c) => SUPER[c] ?? c)}`;
    return mant === '1' ? pow : `${mant} × ${pow}`;
  }
  const fixed = v.toFixed(digits);
  return digits > 0 ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Decade ticks on a log axis that spans many decades read best as powers of ten: 10⁻⁷. */
const decade = (v: number) => `10${String(Math.round(Math.log10(v))).replace(/./g, (c) => SUPER[c] ?? c)}`;

const tickFormat = (ticks: number[], log = false) => (v: number) => {
  if (log && (ticks[0]! < 0.01 || ticks.at(-1)! > 1e5)) return decade(v);
  const span = Math.max(...ticks.map((t) => Math.abs(t))) || 1;
  // 10 000 and up: group the digits with a thin space, as SI style does
  if (Math.abs(v) >= 10000 && Number.isInteger(v)) return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  return formatValue(v, span < 1 ? 3 : span < 10 ? 2 : span < 100 ? 1 : 0).replace('-', '−');
};

export const paramText = (b: Explore, values: Values) => b.params.map((p) => `${p.label} = ${formatValue(values[p.name]!, 3)}${p.unit ? ` ${p.unit}` : ''}`).join(', ');

/** The plot spec for one set of values, plus pinned earlier sets drawn as comparison curves. */
export function exploreSpec(b: Explore, values: Values, opts: { pinned?: Values[]; width?: number; height?: number; title?: string } = {}): PlotSpec {
  const p = b.plot;
  const xt = niceTicks(p.x.from, p.x.to, p.x.log);
  const yt = niceTicks(p.y.from, p.y.to, p.y.log);
  const series: Series[] = [];
  const many = (opts.pinned?.length ?? 0) > 0;
  for (const s of p.series) series.push({ label: many ? `${s.label} (now)` : s.label, expr: s.expr, role: s.role as Role, vars: values, direct: false });
  (opts.pinned ?? []).forEach((pv, i) => {
    // name a pinned curve by the sliders that differ from now (all of them if none differ)
    const differ = b.params.filter((q) => pv[q.name] !== values[q.name]);
    const tag = (differ.length ? differ : b.params).map((q) => `${q.name} = ${formatValue(pv[q.name]!, 3)}${q.unit ? ` ${q.unit}` : ''}`).join(', ');
    for (const s of p.series) series.push({ label: `${p.series.length > 1 ? `${s.label}, ` : ''}${tag}`, expr: s.expr, role: (i === 0 ? 'accent' : 'external') as Role, vars: pv, direct: false });
  });
  return {
    title: opts.title ?? b.title,
    desc: `${p.series.map((s) => s.label).join(' and ')} against ${p.x.label}, for ${paramText(b, values)}.`,
    x: { label: p.x.label, from: p.x.from, to: p.x.to, log: p.x.log, ticks: thin(xt), tickFormat: tickFormat(xt, p.x.log) },
    y: { label: p.y.label, from: p.y.from, to: p.y.to, log: p.y.log, ticks: thin(yt), tickFormat: tickFormat(yt, p.y.log) },
    series,
    refLines: [...p.levels.map((l) => ({ x1: p.x.from, y1: l.y, x2: p.x.to, y2: l.y, label: l.label, labelX: p.x.to, labelY: l.y })), ...markerLines(b, values)],
    points: markerPoints(b, values),
    width: opts.width,
    height: opts.height,
    legend: 'below',
  };
}

/** At most eight ticks: every second (or third…) one on a long log axis. */
function thin(ticks: number[]): number[] {
  const k = Math.ceil(ticks.length / 8);
  return k <= 1 ? ticks : ticks.filter((_, i) => i % k === 0);
}

function markerX(b: Explore, values: Values): number | null {
  if (!b.plot.marker) return null;
  const x = compile(b.plot.marker.x)(values);
  return Number.isFinite(x) && x >= b.plot.x.from && x <= b.plot.x.to ? x : null;
}

function markerLines(b: Explore, values: Values): NonNullable<PlotSpec['refLines']> {
  const x = markerX(b, values);
  if (x === null) return [];
  const p = b.plot;
  return [{ x1: x, y1: p.y.from, x2: x, y2: p.y.to, label: p.marker!.label, labelX: x, labelY: p.y.to }];
}

function markerPoints(b: Explore, values: Values): NonNullable<PlotSpec['points']> {
  const x = markerX(b, values);
  if (x === null) return [];
  return b.plot.series.flatMap((s) => {
    const y = compile(s.expr)({ ...values, x });
    if (!Number.isFinite(y) || y < b.plot.y.from || y > b.plot.y.to) return [];
    return [{ x, y, label: formatValue(Number(y.toPrecision(3)), 6), role: s.role as Role, guides: false, dx: 8, dy: -8 }];
  });
}

/** The live plot as an SVG string. */
export function exploreSvg(b: Explore, values: Values, mode: Mode, pinned: Values[] = []): string {
  return plot(exploreSpec(b, values, { pinned }), mode);
}

/**
 * The print still: the first slider at a low, the default and a high value (other sliders at their
 * defaults), so the page shows what dragging it does.
 */
export function stillValues(b: Explore): { values: Values; pinned: Values[] } {
  const d = defaults(b);
  const p = b.params[0]!;
  const [lo, hi] = b.stills ?? stillPair(p);
  return { values: d, pinned: [{ ...d, [p.name]: lo }, { ...d, [p.name]: hi }] };
}

/**
 * Low and high values for the still when the author gives none: halfway (in the slider's own
 * scale) between the default and each end, rounded to two significant figures. The very ends are
 * often extreme enough to squash the default curve against an axis.
 */
export function stillPair(p: Explore['params'][number]): [number, number] {
  const mid = (a: number, c: number) => (p.log ? Math.sqrt(a * c) : (a + c) / 2);
  const round = (v: number) => Number(v.toPrecision(2));
  return [round(mid(p.min, p.value)), round(mid(p.value, p.max))];
}

/** Whether the curves change at all with the first slider (some sliders only move the marker). */
export function curvesFollowFirst(b: Explore): boolean {
  const { values, pinned } = stillValues(b);
  const xs = [0.1, 0.35, 0.6, 0.85].map((u) => (b.plot.x.log ? 10 ** (Math.log10(b.plot.x.from) + u * (Math.log10(b.plot.x.to) - Math.log10(b.plot.x.from))) : b.plot.x.from + u * (b.plot.x.to - b.plot.x.from)));
  return b.plot.series.some((s) => {
    const f = compile(s.expr);
    return xs.some((x) => pinned.some((pv) => Math.abs(f({ ...pv, x }) - f({ ...values, x })) > 1e-9 * (1 + Math.abs(f({ ...values, x })))));
  });
}

export function stillSvg(b: Explore, mode: Mode): string {
  const { values, pinned } = stillValues(b);
  const p = b.params[0]!;
  const name = (v: number) => `${p.name} = ${formatValue(v, 3)}${p.unit ? ` ${p.unit}` : ''}`;
  const sets = [pinned[0]!, values, pinned[1]!];
  if (!curvesFollowFirst(b)) {
    // the slider only moves the "you are here" marker: one curve, three markers
    const spec = exploreSpec(b, values);
    spec.refLines = (spec.refLines ?? []).filter((r) => r.x1 !== r.x2);
    spec.points = [];
    for (const v of sets) {
      spec.refLines.push(...markerLines(b, v).map((r) => ({ ...r, label: name(v[p.name]!) })));
      spec.points.push(...markerPoints(b, v));
    }
    spec.desc = `${b.plot.series.map((s) => s.label).join(' and ')} against ${b.plot.x.label}, marked at ${sets.map((v) => name(v[p.name]!)).join(', ')}.`;
    return plot(spec, mode);
  }
  const spec = exploreSpec(b, values, { pinned });
  // name the curves by the first slider's value, so the still reads without the sliders
  const per = b.plot.series.length;
  spec.series.forEach((s, i) => {
    const which = Math.floor(i / per);
    const base = b.plot.series[i % per]!.label;
    const v = which === 0 ? values[p.name]! : pinned[which - 1]![p.name]!;
    s.label = `${per > 1 ? `${base}, ` : ''}${name(v)}${which === 0 ? ' (default)' : ''}`;
  });
  spec.desc = `${b.plot.series.map((s) => s.label).join(' and ')} against ${b.plot.x.label} for ${p.label} at ${name(pinned[0]![p.name]!)}, ${name(p.value)} and ${name(pinned[1]![p.name]!)}.`;
  return plot(spec, mode);
}

/** Readouts at a set of values. */
export function readouts(b: Explore, values: Values): Array<{ label: string; value: number; text: string; unit: string }> {
  return b.readouts.map((r) => {
    const value = compile(r.expr)(values);
    return { label: r.label, value, text: formatValue(value, r.digits), unit: r.unit };
  });
}

/** Slider position (0–1000) ↔ value, linear or logarithmic, snapped to the step. */
export const SLIDER_STEPS = 1000;
export function toSlider(p: Explore['params'][number], v: number): number {
  const u = p.log ? (Math.log(v) - Math.log(p.min)) / (Math.log(p.max) - Math.log(p.min)) : (v - p.min) / (p.max - p.min);
  return Math.round(Math.min(1, Math.max(0, u)) * SLIDER_STEPS);
}
export function fromSlider(p: Explore['params'][number], pos: number): number {
  const u = pos / SLIDER_STEPS;
  const raw = p.log ? Math.exp(Math.log(p.min) + u * (Math.log(p.max) - Math.log(p.min))) : p.min + u * (p.max - p.min);
  // log sliders snap to 2 significant figures, so 4.7 kΩ and 47 kΩ are both reachable
  const snapped = p.log ? Number(raw.toPrecision(2)) : Math.round((raw - p.min) / p.step) * p.step + p.min;
  return Math.min(p.max, Math.max(p.min, Number(snapped.toPrecision(12))));
}

/**
 * Problems with an explorable that would break it for a reader: expressions that do not parse or
 * use names that are not parameters, or curves and readouts that are not numbers at the defaults.
 * Returns plain-words messages (empty when it is fine).
 */
export function exploreProblems(b: Explore): string[] {
  const out: string[] = [];
  const names = new Set(['x', ...b.params.map((p) => p.name)]);
  const d = defaults(b);
  const check = (what: string, expr: string, vars: Values) => {
    try {
      const f = compile(expr);
      const v = f(vars);
      if (!Number.isFinite(v)) out.push(`${what} is not a number at the default values (${expr}).`);
    } catch (e) {
      const m = (e as Error).message;
      const unknown = m.match(/Unknown variable "([^"]+)"/);
      out.push(unknown && !names.has(unknown[1]!) ? `${what} uses "${unknown[1]}", which is not one of the sliders (${[...names].join(', ')}).` : `${what} does not parse: ${m}`);
    }
  };
  const mid = b.plot.x.log ? Math.sqrt(b.plot.x.from * b.plot.x.to) : (b.plot.x.from + b.plot.x.to) / 2;
  for (const s of b.plot.series) check(`Curve "${s.label}"`, s.expr, { ...d, x: mid });
  for (const r of b.readouts) check(`Readout "${r.label}"`, r.expr, d);
  if (b.plot.marker) check('The marker', b.plot.marker.x, d);
  return out;
}

/**
 * Circuit schematic primitives in the style of docs/STYLE.md (U.S. textbook symbols:
 * zig-zag resistor, parallel-plate capacitor). Each returns SVG markup. Components are
 * drawn horizontally or vertically between two points; wires are plain lines.
 */
import { line, text, type Pal } from './svg.ts';

const W = 1.75; // stroke width for wires and symbols

export function wire(pal: Pal, pts: Array<[number, number]>): string {
  return `<polyline points="${pts.map(([x, y]) => `${x},${y}`).join(' ')}" fill="none" stroke="${pal.ink}" stroke-width="${W}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

export function dot(pal: Pal, x: number, y: number): string {
  return `<circle cx="${x}" cy="${y}" r="3.2" fill="${pal.ink}"/>`;
}

export function terminal(pal: Pal, x: number, y: number): string {
  return `<circle cx="${x}" cy="${y}" r="4" fill="${pal.paper}" stroke="${pal.ink}" stroke-width="${W}"/>`;
}

/** Resistor between (x1,y) and (x2,y), horizontal. */
export function resistorH(pal: Pal, x1: number, x2: number, y: number, label: string): string {
  const len = 44;
  const cx = (x1 + x2) / 2;
  const a = cx - len / 2;
  const n = 6;
  const pts: Array<[number, number]> = [[x1, y], [a, y]];
  for (let i = 0; i < n; i++) pts.push([a + ((i + 0.5) * len) / n, y + (i % 2 === 0 ? -7 : 7)]);
  pts.push([a + len, y], [x2, y]);
  return wire(pal, pts) + text(cx, y - 14, label, { anchor: 'middle', fill: pal.ink, size: 13, italic: true });
}

/** Capacitor between (x,y1) (top) and (x,y2) (bottom), vertical. */
export function capacitorV(pal: Pal, x: number, y1: number, y2: number, label: string, labelSide: 'left' | 'right' = 'right'): string {
  const cy = (y1 + y2) / 2;
  const gap = 7;
  const plate = 32;
  return (
    wire(pal, [[x, y1], [x, cy - gap]]) +
    wire(pal, [[x, cy + gap], [x, y2]]) +
    line(x - plate / 2, cy - gap, x + plate / 2, cy - gap, pal.ink, 2.5) +
    line(x - plate / 2, cy + gap, x + plate / 2, cy + gap, pal.ink, 2.5) +
    text(labelSide === 'right' ? x + plate / 2 + 6 : x - plate / 2 - 6, cy + 5, label, { anchor: labelSide === 'right' ? 'start' : 'end', fill: pal.ink, size: 13, italic: true })
  );
}

/** Battery between (x,y1) (top, + terminal) and (x,y2), vertical. */
export function batteryV(pal: Pal, x: number, y1: number, y2: number, label: string): string {
  const cy = (y1 + y2) / 2;
  return (
    wire(pal, [[x, y1], [x, cy - 6]]) +
    wire(pal, [[x, cy + 6], [x, y2]]) +
    line(x - 16, cy - 6, x + 16, cy - 6, pal.ink, 2.5) +
    line(x - 9, cy + 6, x + 9, cy + 6, pal.ink, 3.5) +
    text(x + 20, cy - 10, '+', { fill: pal.ink, size: 12 }) +
    text(x - 22, cy + 5, label, { anchor: 'end', fill: pal.ink, size: 13, italic: true })
  );
}

/** Open switch between (x1,y) and (x2,y). */
export function switchH(pal: Pal, x1: number, x2: number, y: number, label: string): string {
  const a = (x1 + x2) / 2 - 14;
  const b = a + 28;
  return (
    wire(pal, [[x1, y], [a, y]]) +
    wire(pal, [[b, y], [x2, y]]) +
    `<circle cx="${a}" cy="${y}" r="2.8" fill="${pal.ink}"/><circle cx="${b}" cy="${y}" r="2.8" fill="${pal.ink}"/>` +
    line(a, y, b - 2, y - 14, pal.ink, W) +
    text((a + b) / 2, y - 20, label, { anchor: 'middle', fill: pal.muted, size: 11 })
  );
}

export function ground(pal: Pal, x: number, y: number): string {
  return line(x - 14, y, x + 14, y, pal.ink, W) + line(x - 9, y + 5, x + 9, y + 5, pal.ink, W) + line(x - 4, y + 10, x + 4, y + 10, pal.ink, W);
}

/**
 * README hero: topic typed in → outline → a page fills with text, an equation and a
 * figure → web book + KDP-ready PDF. One idea (the flow), 8-second loop, eased, holds on
 * the final frame. With prefers-reduced-motion (or any viewer without animation) the
 * SVG shows the final frame, which is also the static fallback.
 */
import { palette, svgDoc, text } from '../../src/render/svg.ts';
import { motion, type Mode } from '../../src/core/style.ts';

const LOOP = 8; // seconds

/** Keyframes: hidden until `from`% of the loop, fully shown by `to`%, held to 97%. */
function reveal(name: string, from: number, to: number, kind: 'fade' | 'draw' | 'wipe' = 'fade'): string {
  const hidden = kind === 'fade' ? 'opacity: 0; transform: translateY(6px);' : kind === 'draw' ? 'stroke-dashoffset: 1;' : 'transform: scaleX(0);';
  const shown = kind === 'fade' ? 'opacity: 1; transform: none;' : kind === 'draw' ? 'stroke-dashoffset: 0;' : 'transform: scaleX(1);';
  return `@keyframes ${name} { 0%, ${from}% { ${hidden} } ${to}%, 97% { ${shown} } 100% { ${hidden} } }
.${name} { animation: ${name} ${LOOP}s ${motion.easing} infinite; transform-box: fill-box; transform-origin: left center; }`;
}

export function hero(mode: Mode): string {
  const p = palette(mode);
  const W = 880;
  const H = 300;
  const parts: string[] = [];
  const css: string[] = [];

  // Stage captions along the bottom — a real sequence, so numbered.
  const steps = [
    { x: 40, label: '1  Topic' },
    { x: 262, label: '2  Outline — you approve' },
    { x: 500, label: '3  Researched, drafted, checked' },
    { x: 730, label: '4  Web, print, EPUB' },
  ];
  steps.forEach((s, i) => {
    css.push(reveal(`cap${i}`, [0, 16, 34, 66][i]!, [6, 22, 40, 72][i]!));
    parts.push(`<g class="cap${i}">${text(s.x, 280, s.label, { fill: p.muted, size: 13, weight: 600 })}</g>`);
  });

  // 1. Topic box with typed text
  parts.push(`<rect x="30" y="92" width="190" height="64" rx="8" fill="${p.paper}" stroke="${p.rule}" stroke-width="1.5"/>`);
  parts.push(text(42, 112, 'Topic', { fill: p.muted, size: 11 }));
  parts.push(`<clipPath id="type"><rect class="typing" x="42" y="118" width="170" height="40"/></clipPath>`);
  parts.push(`<g clip-path="url(#type)">${text(42, 136, 'How do RC circuits', { fill: p.ink, size: 14 })}${text(42, 152, 'keep time?', { fill: p.ink, size: 14 })}</g>`);
  css.push(`@keyframes typing { 0% { transform: scaleX(0); } 14%, 97% { transform: scaleX(1); } 100% { transform: scaleX(0); } }
.typing { animation: typing ${LOOP}s steps(24, end) infinite; transform-box: fill-box; transform-origin: left center; }`);

  const arrowAt = (x: number, i: number) => {
    css.push(reveal(`arr${i}`, [12, 30, 62][i]!, [16, 34, 66][i]!, 'fade'));
    return `<g class="arr${i}"><line x1="${x}" y1="124" x2="${x + 24}" y2="124" stroke="${p.muted}" stroke-width="1.5"/><path d="M${x + 30},124 l-7,-4 v8 z" fill="${p.muted}"/></g>`;
  };
  parts.push(arrowAt(226, 0));

  // 2. Outline card with checkpoint mark
  parts.push(`<g class="outline"><rect x="262" y="60" width="200" height="140" rx="8" fill="${p.panel}" stroke="${p.rule}" stroke-width="1.5"/>
<rect x="262" y="60" width="5" height="140" rx="2" fill="${p.role('checkpoint')}"/>
${text(278, 82, 'Outline', { fill: p.ink, size: 13, weight: 600 })}
${['1  What a capacitor stores', '2  Charging: keeping time', '3  Filtering signals'].map((t, i) => `<g class="ol${i}">${text(278, 106 + i * 22, t, { fill: p.ink, size: 12.5 })}</g>`).join('')}
<g class="ok">${text(278, 186, '✓ approved by you', { fill: p.role('verified'), size: 12, weight: 600 })}</g></g>`);
  css.push(reveal('outline', 14, 20));
  [0, 1, 2].forEach((i) => css.push(reveal(`ol${i}`, 18 + i * 3, 21 + i * 3)));
  css.push(reveal('ok', 29, 32));
  parts.push(arrowAt(468, 1));

  // 3. A book page filling up
  const px = 506;
  const py = 34;
  parts.push(`<g class="page"><rect x="${px}" y="${py}" width="168" height="220" rx="4" fill="${p.paper}" stroke="${p.ink}" stroke-width="1.5"/>`);
  parts.push(`<rect x="${px + 16}" y="${py + 16}" width="96" height="8" rx="2" fill="${p.ink}"/>`);
  parts.push(...[0, 1, 2, 3].map((i) => `<rect class="ln${i}" x="${px + 16}" y="${py + 34 + i * 11}" width="${[136, 128, 136, 88][i]}" height="4" rx="2" fill="${p.muted}"/>`));
  [0, 1, 2, 3].forEach((i) => css.push(reveal(`ln${i}`, 36 + i * 2, 39 + i * 2, 'wipe')));
  parts.push(`<g class="eqn">${text(px + 84, py + 96, 'τ = RC', { fill: p.ink, size: 14, anchor: 'middle', italic: true })}${text(px + 152, py + 96, '(2.1)', { fill: p.muted, size: 9, anchor: 'end' })}</g>`);
  css.push(reveal('eqn', 44, 48));
  const fx = px + 18;
  const fy = py + 108;
  const fw = 132;
  const fh = 70;
  const pts: string[] = [];
  for (let k = 0; k <= 60; k++) {
    const u = (k / 60) * 5;
    pts.push(`${(fx + (u / 5) * fw).toFixed(1)},${(fy + fh - (1 - Math.exp(-u)) * fh).toFixed(1)}`);
  }
  parts.push(`<line x1="${fx}" y1="${fy + fh}" x2="${fx + fw}" y2="${fy + fh}" stroke="${p.muted}" stroke-width="1"/><line x1="${fx}" y1="${fy}" x2="${fx}" y2="${fy + fh}" stroke="${p.muted}" stroke-width="1"/>`);
  parts.push(`<polyline class="curve" points="${pts.join(' ')}" fill="none" stroke="${p.role('signal')}" stroke-width="2.5" pathLength="1" stroke-dasharray="1"/>`);
  css.push(reveal('curve', 48, 58, 'draw'));
  parts.push(`<g class="chk">${text(px + 16, py + 202, '✓ 4 sources verified', { fill: p.role('verified'), size: 10.5, weight: 600 })}</g>`);
  css.push(reveal('chk', 58, 62));
  parts.push('</g>');
  css.push(reveal('page', 32, 36));
  parts.push(arrowAt(680, 2));

  // 4. Outputs: web + print + ebook
  const ox = 722;
  const out = [
    ['Web book', 'light + dark, MathML', p.muted, 400],
    ['Print PDF + cover', 'KDP pre-flight ✓', p.role('verified'), 600],
    ['EPUB 3', 'reflowable, MathML', p.muted, 400],
  ] as const;
  out.forEach(([t, s, c, w], i) => {
    parts.push(`<g class="out${i}"><rect x="${ox}" y="${44 + i * 64}" width="140" height="54" rx="8" fill="${p.panel}" stroke="${p.rule}" stroke-width="1.5"/>
${text(ox + 14, 66 + i * 64, t, { fill: p.ink, size: 13, weight: 600 })}${text(ox + 14, 84 + i * 64, s, { fill: c, size: 11, weight: w })}</g>`);
    css.push(reveal(`out${i}`, 66 + i * 3, 70 + i * 3));
  });

  const style = `<style>
${css.join('\n')}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
</style>`;
  return svgDoc(W, H, 'Scriptorium: from a topic to a finished book', 'Animation: a topic is typed, an outline appears and is approved, a page fills with text, an equation and a drawn charging curve with verified sources, and the book is exported as a web book, a KDP-ready print PDF with cover, and an EPUB 3 ebook.', style + parts.join('\n'), p);
}

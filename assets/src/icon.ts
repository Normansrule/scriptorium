/**
 * App icon: an open book on the signal-blue tile, a charging curve on the right page
 * (the sample book's first figure) and an accent ribbon. One design for every size;
 * `npm run icons` rasterizes it and lets the Tauri command line cut the platform icons.
 */
import { roles, surface } from '../../src/core/style.ts';

export function icon(): string {
  const blue = roles.signal.light;
  const accent = roles.accent.light;
  const ink = surface.ink.light;
  // charging curve 1 − e^(−t) across the right page
  const pts: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * 5;
    const x = 548 + (i / 40) * 270;
    const y = 640 - (1 - Math.exp(-t)) * 250;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-labelledby="t"><title id="t">Scriptorium</title>
<rect x="32" y="32" width="960" height="960" rx="210" fill="${blue}"/>
<path d="M512 300 C 420 250 300 240 170 262 L 170 752 C 300 730 420 740 512 792 Z" fill="#FFFFFF"/>
<path d="M512 300 C 604 250 724 240 854 262 L 854 752 C 724 730 604 740 512 792 Z" fill="#F6F8FA"/>
<path d="M512 300 L 512 792" stroke="${ink}" stroke-opacity="0.25" stroke-width="10"/>
${[0, 1, 2, 3, 4].map((k) => `<path d="M220 ${360 + k * 70} C 300 ${348 + k * 70} 390 ${350 + k * 70} 462 ${372 + k * 70}" stroke="${ink}" stroke-opacity="0.35" stroke-width="18" stroke-linecap="round" fill="none"/>`).join('\n')}
<polyline points="${pts.join(' ')}" fill="none" stroke="${blue}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M548 380 L 548 652 L 830 652" fill="none" stroke="${ink}" stroke-opacity="0.45" stroke-width="10" stroke-linecap="round"/>
<path d="M700 236 L 700 360 L 732 334 L 764 360 L 764 228 Z" fill="${accent}"/>
</svg>
`;
}

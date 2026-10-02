/**
 * Writes assets/rendered/icon.svg and icon-1024.png from assets/src/icon.ts.
 * Then `npx tauri icon assets/rendered/icon-1024.png` cuts every platform icon into src-tauri/icons/.
 * Both steps run with `npm run icons`.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { icon } from '../assets/src/icon.ts';

const out = join(import.meta.dirname, '..', 'assets', 'rendered');
const svg = icon();
writeFileSync(join(out, 'icon.svg'), svg);
writeFileSync(join(out, 'icon-1024.png'), new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } }).render().asPng());
console.log('✓ Wrote assets/rendered/icon.svg and icon-1024.png');

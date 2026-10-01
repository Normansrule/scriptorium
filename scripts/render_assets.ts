/**
 * Regenerates every README visual and every sample-book figure.
 *
 *   npm run assets          write assets/rendered/*.svg and redraw examples/<book>/figures/
 *   npm run assets:check    fail if any committed SVG differs from what the sources produce (used by CI)
 *
 * SVGs are deterministic and checked for staleness. Screenshots (PNG) need a built book,
 * a built app and Chromium; `python scripts/screenshots.py` regenerates them but CI does
 * not diff them, because font rasterization differs slightly between machines.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hero } from '../assets/src/hero.ts';
import { layers, pipeline, security } from '../assets/src/diagrams.ts';
import type { Mode } from '../src/core/style.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets', 'rendered');
const check = process.argv.includes('--check');

const extra: Record<string, (m: Mode) => string> = {};
if (existsSync(join(root, 'assets', 'src', 'extra.ts'))) Object.assign(extra, ((await import(pathToFileURL(join(root, 'assets', 'src', 'extra.ts')).href)) as { svgs: typeof extra }).svgs);
const svgs: Record<string, (m: Mode) => string> = { hero, pipeline, security, layers, ...extra };
let stale = 0;
mkdirSync(out, { recursive: true });
for (const [name, fn] of Object.entries(svgs)) {
  for (const mode of ['light', 'dark'] as const) {
    const file = join(out, `${name}${mode === 'dark' ? '.dark' : ''}.svg`);
    const svg = fn(mode);
    const kb = Buffer.byteLength(svg) / 1024;
    if (kb > 500) throw new Error(`${file} is ${kb.toFixed(0)} KB; STYLE.md caps SVGs at 500 KB.`);
    if (check) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== svg) {
        console.error(`✗ stale: ${file}`);
        stale++;
      }
    } else writeFileSync(file, svg);
  }
}

// Book figures and generated models are assets too: every examples/<book>/figures.ts.
let figureFiles = 0;
for (const book of readdirSync(join(root, 'examples'))) {
  const script = join(root, 'examples', book, 'figures.ts');
  if (!existsSync(script)) continue;
  const mod = (await import(pathToFileURL(script).href)) as { drawAll: (root?: string) => string[] };
  if (check) {
    const tmp = join(root, '.scratch', 'figcheck', book);
    rmSync(tmp, { recursive: true, force: true });
    for (const rel of mod.drawAll(tmp)) {
      const committed = join(root, 'examples', book, rel);
      if (!existsSync(committed) || readFileSync(committed, 'utf8') !== readFileSync(join(tmp, rel), 'utf8')) {
        console.error(`✗ stale: ${committed}`);
        stale++;
      }
      figureFiles++;
    }
  } else figureFiles += mod.drawAll().length;
}

if (check) {
  if (stale) {
    console.error(`${stale} rendered asset(s) are out of date. Run: npm run assets`);
    process.exitCode = 1;
  } else console.log(`✓ All rendered SVG assets match their sources (${Object.keys(svgs).length * 2} README SVGs, ${figureFiles} book figure and model files).`);
} else {
  console.log(`✓ Wrote ${Object.keys(svgs).length * 2} README SVGs to assets/rendered and redrew ${figureFiles} book figure and model files.`);
  console.log('  Screenshots: python scripts/screenshots.py (needs npm run demo, npm run app:build and Playwright Chromium).');
}

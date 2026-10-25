/**
 * 3D Edition for the command line: plan3d.json next to the book, pages rendered with resvg.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Book, Reference } from '../core/book.ts';
import type { Model } from '../core/molecule.ts';
import { jpegJsEncode } from '../export/cover.ts';
import { buildEdition3D, type Edition3DResult } from '../edition3d/build.ts';
import { planBook } from '../edition3d/convert.ts';
import { Plan3D } from '../edition3d/manifest.ts';
import type { CslAssets } from '../render/cite.ts';
import { resvgRasterize } from './export-cover.ts';
import { nodeEngine } from './export-pdf.ts';
import { figureFiles, writeFiles } from './export-web.ts';

export const PLAN_FILE = 'plan3d.json';

export function readPlan(bookDir: string): Plan3D | undefined {
  const p = join(bookDir, PLAN_FILE);
  return existsSync(p) ? Plan3D.parse(JSON.parse(readFileSync(p, 'utf8'))) : undefined;
}

/** Propose treatments, keep earlier decisions, apply --approve / --reject, and save plan3d.json. */
export function updatePlan(book: Book, bookDir: string, opts: { approve?: string[]; reject?: string[] } = {}): Plan3D {
  const plan = planBook(book, readPlan(bookDir));
  for (const e of plan.entries) {
    if (opts.approve?.includes(e.id)) e.approved = true;
    if (opts.reject?.includes(e.id)) {
      e.approved = false;
      e.chosen = undefined;
    }
  }
  writeFileSync(join(bookDir, PLAN_FILE), `${JSON.stringify(plan, null, 1)}\n`);
  return plan;
}

export async function exportEdition3D(
  input: { book: Book; refs: Reference[]; models: Record<string, Model>; csl: CslAssets; webEdition?: string },
  bookDir: string,
  outDir: string,
  onStep?: (m: string) => void,
): Promise<Edition3DResult> {
  const files: Record<string, Uint8Array> = { ...figureFiles(bookDir) };
  const r = await buildEdition3D({ ...input, files, plan: readPlan(bookDir) }, { engine: nodeEngine(bookDir), rasterize: resvgRasterize, encodeJpeg: jpegJsEncode, onStep });
  writeFiles(outDir, r.files);
  return r;
}

/**
 * The 3D Edition's data, shared by the builder (Node and app) and the viewer (browser).
 *
 *   book3d.json      what the viewer loads: page images, and every figure with where it sits on its
 *                    page and how it comes off the page (its "treatment")
 *   plan3d.json      kept next to the book source: the converter's proposal for each figure and
 *                    whether the author approved it (src/edition3d/convert.ts)
 *
 * One figure spec serves both editions: the 2D Edition prints the figure (or the stills of a 3D
 * model); the 3D Edition reads the same figure id, finds it on the page, and applies its treatment.
 */
import { z } from 'zod';

/**
 * How a figure behaves in the 3D Edition.
 *   flat   stays on the page (no hotspot)
 *   lift   rises off the page as a card you can tilt and bring close (any 2D figure)
 *   model  becomes the book's own 3D model (model3d blocks: atoms and bonds from cited sources)
 *   scene  becomes a 3D scene from a scene kit (parts you can cut away, explode, X-ray, animate)
 */
export const Treatment = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('flat') }),
  z.object({ mode: z.literal('lift') }),
  z.object({ mode: z.literal('model') }),
  z.object({ mode: z.literal('scene'), kit: z.string().regex(/^[a-z0-9-]+$/) }),
]);
export type Treatment = z.infer<typeof Treatment>;

/** A rectangle on a page, in points from the page's top-left corner. */
export const Rect = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
export type Rect = z.infer<typeof Rect>;

export const Figure3D = z.object({
  id: z.string().regex(/^fig-[a-z0-9-]+$/),
  /** "2.1" */
  number: z.string(),
  /** 1-based page number in the edition */
  page: z.number().int().min(1),
  rect: Rect,
  alt: z.string(),
  /** caption as plain text */
  caption: z.string(),
  credit: z.string(),
  treatment: Treatment,
  /** lift: the figure as an image (`figures/<id>.jpg`); model: the model data (`models/<id>.json`) */
  asset: z.string().regex(/^(figures|models)\/[a-z0-9-]+\.(jpg|png|json)$/).optional(),
  /** model: drawing size multiplier and whether coordinates are to scale */
  atomScale: z.number().optional(),
  scale: z.enum(['to-scale', 'schematic']).optional(),
});
export type Figure3D = z.infer<typeof Figure3D>;

export const Book3D = z.object({
  format: z.literal('scriptorium-3d'),
  version: z.literal(1),
  title: z.string(),
  subtitle: z.string().optional(),
  authors: z.array(z.string()),
  /** page size in points (1/72 in) */
  page: z.object({ width: z.number().positive(), height: z.number().positive() }),
  /** page images in reading order: `pages/p001.jpg` … */
  pages: z.array(z.string().regex(/^pages\/p\d{3,4}\.jpg$/)).min(1).max(2000),
  /** pixels per point the page images were rendered at */
  pageScale: z.number().positive(),
  figures: z.array(Figure3D),
  /** relative link to the 2D web edition (reduced-motion fallback), if published alongside */
  webEdition: z.string().optional(),
  /** colors for the binding, from the book's profile */
  cloth: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** honesty: what the AI drafted, shown in the viewer's About panel */
  disclosure: z.object({ text: z.string(), images: z.string() }).optional(),
});
export type Book3D = z.infer<typeof Book3D>;

/** One converter proposal and the author's decision. */
export const PlanEntry = z.object({
  id: z.string().regex(/^fig-[a-z0-9-]+$/),
  proposed: Treatment,
  /** why the converter proposed it, in plain words */
  reason: z.string(),
  /** 0–1: how strongly the figure benefits from 3D */
  score: z.number().min(0).max(1),
  /** scenes need a person's approval; lift, model and flat apply without one */
  approved: z.boolean(),
  /** the author may choose a different treatment than proposed */
  chosen: Treatment.optional(),
});
export type PlanEntry = z.infer<typeof PlanEntry>;

export const Plan3D = z.object({ format: z.literal('scriptorium-plan3d'), version: z.literal(1), entries: z.array(PlanEntry) });
export type Plan3D = z.infer<typeof Plan3D>;

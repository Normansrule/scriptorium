/**
 * Domain profiles. Adding a domain = adding one JSON file in profiles/ that passes this
 * schema (see docs/ADDING_A_DOMAIN.md). The pipeline reads the profile to pick the
 * citation style, which databases to search, which figure types to offer, the unit
 * conventions to enforce, and the safety notes every book in the domain must carry.
 */
import { z } from 'zod';

export const Database = z.enum(['crossref', 'openalex', 'pubmed', 'arxiv', 'pubchem', 'pdb']);

export const Profile = z.object({
  id: z.string().regex(/^[a-z-]+$/),
  name: z.string(),
  description: z.string(),
  /** Citation Style Language (CSL) style id, e.g. "ieee", "american-chemical-society", "american-medical-association". */
  citationStyle: z.string(),
  databases: z.array(Database).min(1),
  figureTypes: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })).min(1),
  units: z.object({
    system: z.literal('SI'),
    /** Conventions the drafting prompt must follow, e.g. "write 4.7 kΩ, not 4700 ohms". */
    conventions: z.array(z.string()),
  }),
  /** Printed in every book of this domain. */
  safetyNotes: z.array(z.string()),
  /** Topics the drafting stage must keep at textbook level (no procedural detail). */
  restrictedDetail: z.array(z.string()).default([]),
  /** When true, sections are flagged for licensed-professional review before publishing. */
  requiresProfessionalReview: z.boolean().default(false),
  /** Extra instructions appended to the drafting prompt. Treated as trusted (ships with the repo). */
  draftingNotes: z.array(z.string()).default([]),
});
export type Profile = z.infer<typeof Profile>;

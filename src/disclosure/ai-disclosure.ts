/**
 * AI-disclosure checklist for KDP.
 *
 * KDP asks separately whether a book contains AI-generated TEXT, IMAGES (cover and
 * interior) and TRANSLATIONS. Its definition: content created by an AI tool is
 * "AI-generated" even after substantial human edits; content a person created and then
 * polished with AI is "AI-assisted" and need not be disclosed.
 * Source: KDP Content Guidelines, https://kdp.amazon.com/en_US/help/topic/G200672390
 *
 * This module derives the three answers from the provenance recorded on every section and
 * figure, and lists exactly which parts drove each answer.
 */
import type { Book, Provenance } from '../core/book.ts';

export interface DisclosureItem {
  where: string;
  provenance: Provenance;
}

export interface Disclosure {
  text: { answer: 'yes' | 'no'; items: DisclosureItem[] };
  images: { answer: 'yes' | 'no'; items: DisclosureItem[] };
  translations: { answer: 'yes' | 'no'; items: DisclosureItem[] };
  notes: string[];
}

export function buildDisclosure(book: Book, opts: { coverProvenance?: Provenance; translatedByAi?: boolean; figureScriptsByAi?: boolean } = {}): Disclosure {
  const text: DisclosureItem[] = [];
  const images: DisclosureItem[] = [];
  for (const ch of book.chapters) {
    for (const s of ch.sections) {
      text.push({ where: `${ch.title} › ${s.title}`, provenance: s.provenance });
      for (const b of [...s.layers.summary, ...s.layers.intuition, ...s.layers.formal, ...s.layers.limits]) {
        if (b.kind === 'figure') images.push({ where: `${b.id} (${ch.title})`, provenance: b.provenance });
      }
    }
  }
  if (opts.coverProvenance) images.push({ where: 'cover', provenance: opts.coverProvenance });

  const aiText = text.filter((t) => t.provenance === 'ai-generated');
  // If an AI assistant wrote the drawing scripts, the conservative reading is that the figures are AI-generated too.
  const aiImages = images.filter((i) => i.provenance === 'ai-generated' || (opts.figureScriptsByAi && i.provenance === 'code-drawn'));
  const notes = [
    'KDP counts content created by an AI tool as AI-generated even if you edited it substantially afterwards.',
    'Code-drawn figures come from deterministic scripts in this repository; they are listed so you can decide how to answer, but they were not produced by an image-generation model. If an AI assistant wrote those scripts, the conservative answer for images is yes (set figureScriptsByAi).',
  ];
  return {
    text: { answer: aiText.length ? 'yes' : 'no', items: aiText },
    images: { answer: aiImages.length ? 'yes' : 'no', items: images },
    translations: { answer: opts.translatedByAi ? 'yes' : 'no', items: [] },
    notes,
  };
}

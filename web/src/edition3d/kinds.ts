/**
 * The things a reader can pull out of the book, each with one colour and one icon used everywhere:
 * hotspot pills, pop-up card edges, desk cards, study cards. Colours are the Okabe–Ito set (safe for
 * colour-blind readers), and every use also carries the kind's name, so colour is never the only cue.
 */
import { ICON } from './icons.ts';

export type ItemKind = 'figure' | 'model' | 'scene' | 'equation' | 'explore' | 'check' | 'chapter';

export interface KindStyle {
  label: string;
  /** what the hotspot pill says */
  verb: string;
  color: string;
  /** text on `color` (≥ 4.5:1) */
  ink: string;
  icon: string;
}

export const KIND: Record<ItemKind, KindStyle> = {
  figure: { label: 'Figure', verb: 'Lift', color: '#56b4e9', ink: '#06131d', icon: ICON.lift },
  model: { label: '3D model', verb: 'Open in 3D', color: '#009e73', ink: '#02150f', icon: ICON.cube },
  scene: { label: '3D scene', verb: 'Bring to life', color: '#2bc495', ink: '#03170f', icon: ICON.cube },
  equation: { label: 'Equation', verb: 'Pull out', color: '#e69f00', ink: '#1d1300', icon: ICON.equation },
  explore: { label: 'Explore', verb: 'Try it', color: '#cc79a7', ink: '#1f0a16', icon: ICON.sliders },
  check: { label: 'Check yourself', verb: 'Quiz me', color: '#f0e442', ink: '#1c1a02', icon: ICON.check },
  chapter: { label: 'Chapter', verb: 'What’s inside', color: '#d55e00', ink: '#1f0a00', icon: ICON.book },
};

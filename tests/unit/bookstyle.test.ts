/** Book styles: every pairing passes WCAG AA, every output format gets the style, and meaning stays put. */
import { describe, expect, it } from 'vitest';
import { Book } from '../../src/core/book.ts';
import { BOOK_STYLE_IDS, BOOK_STYLES, bookStyle, styleContrasts, styleCss, styleTypst } from '../../src/core/bookstyle.ts';
import { roles } from '../../src/core/style.ts';
import { bookCss } from '../../src/render/html.ts';

describe('book styles', () => {
  it('pass WCAG AA contrast for every text pairing, in light and dark', () => {
    for (const s of Object.values(BOOK_STYLES))
      for (const mode of ['light', 'dark'] as const)
        for (const c of styleContrasts(s, mode)) expect(c.ratio, `${s.id} ${mode}: ${c.pair}`).toBeGreaterThanOrEqual(c.min);
  });

  it('are exactly the styles the book schema accepts', () => {
    const schema = Book.shape.meta.shape.style.unwrap().options;
    expect([...schema].sort()).toEqual([...BOOK_STYLE_IDS].sort());
  });

  it('never reuse a meaning colour as chrome, so blue always means the main quantity', () => {
    const meaning = new Set(Object.values(roles).flatMap((r) => [r.light.toLowerCase(), r.dark.toLowerCase()]));
    for (const s of Object.values(BOOK_STYLES)) for (const mode of ['light', 'dark'] as const) for (const c of Object.values(s[mode])) expect(meaning.has(c.toLowerCase()), `${s.id} ${mode} ${c}`).toBe(false);
  });

  it('reach the web book, the editor preview and print', () => {
    const css = bookCss();
    for (const id of BOOK_STYLE_IDS) if (id !== 'classic') expect(css).toContain(`[data-book-style="${id}"]`);
    expect(styleCss()).toContain('--bk-band');
    expect(styleTypst('lagoon')).toContain(`rgb("${BOOK_STYLES.lagoon.light.band}")`);
    // an unknown style falls back to Classic rather than failing the build
    expect(bookStyle('no-such-style').id).toBe('classic');
  });

  it('animate the web book only when motion is welcome, and only on screen', () => {
    const css = bookCss();
    const block = css.slice(css.indexOf('@media screen and (prefers-reduced-motion: no-preference)'));
    expect(block).toContain('animation-timeline: view()');
    expect(css.match(/animation-timeline: view\(\);/g)!.length).toBe(1);
  });
});

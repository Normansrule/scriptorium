# Scriptorium style guide

Every visual in this repository — README art, book figures, the web book, the app, and the print PDF — follows this page. The values are not copied by hand: they live in [`src/core/style.ts`](../src/core/style.ts), and [`tests/unit/style.test.ts`](../tests/unit/style.test.ts) fails the build if a color pairing drops below the contrast rules below.

## 1. Color

The hues come from the Okabe–Ito palette, a set chosen so that people with the common forms of color-vision deficiency can still tell them apart [1]. In light mode each hue is darkened (same hue, lower lightness) so it reaches the contrast targets on white.

Contrast targets, from the Web Content Accessibility Guidelines (WCAG) 2.2 [2]:

- **Text** (labels, captions, body): at least **4.5 : 1** against its background.
- **Strokes and shapes** that carry meaning (curves, arrows, box outlines): at least **3 : 1**.

### Roles (a color always means the same thing)

| Role | Light | Dark | Meaning | Allowed for small text? |
|---|---|---|---|---|
| `signal` | `#0072B2` | `#3D95C9` | The main quantity or flow being explained (voltage; data moving through the pipeline) | Yes |
| `accent` | `#B34E00` | `#E0651F` | A second quantity compared against the first (current), or the one thing to look at | Yes |
| `verified` | `#007A5A` | `#2BC495` | Checked, passed, safe: verified references, passing pre-flight rules, data that stays local | Yes |
| `checkpoint` | `#A86F00` | `#E69F00` | A human decision point — only the two human checkpoints and user actions | No — strokes and fills only |
| `external` | `#A8538A` | `#B97AB8` | Leaves the machine or comes from outside: the model provider, fetched papers, untrusted content | Yes |

### Series in a plot

Inside a data plot the colors lose their pipeline meaning and simply tell series apart, always in this fixed order: **`signal` → `accent` → `external`**. A fourth series is never a new color; split into small multiples instead. The three-color set passes an automated palette check in both modes: lightness band, chroma floor, color-vision-deficiency (CVD) separation ΔE ≥ 14 and normal-vision separation ΔE ≥ 15 (OKLab × 100). Each series still gets a direct label or a legend entry and its own dash pattern.

### Molecules and 3D models

3D structures use the CPK convention readers already know from chemistry textbooks (carbon dark gray, oxygen red, nitrogen blue, hydrogen white or light gray, sulfur yellow), because recognising an element by its color matters more than palette purity. Every rendered still also carries element labels, so the figure does not rely on color alone.

### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#FFFFFF` | `#0D1117` | Page and figure background (dark matches GitHub's dark theme) |
| `panel` | `#F6F8FA` | `#161B22` | Cards, callouts, code blocks |
| `ink` | `#1F2328` | `#E6EDF3` | Body text and neutral strokes |
| `muted` | `#57606A` | `#8B949E` | Axis labels, secondary text, grid lines |
| `rule` | `#D0D7DE` | `#30363D` | Hairlines and borders |

Soft fills behind a role color use that color at **12 %** opacity (light) or **20 %** (dark).

### Book styles (the colour of the chrome)

A book picks one style with `meta.style` ([`src/core/bookstyle.ts`](../src/core/bookstyle.ts)). The style colours only the *chrome*: the chapter-number chip, headings, the left edge of learning blocks and the hook, step-number discs, and the tint behind goal boxes. Figures, plots and callouts keep the roles above, so a style can never change what a colour means. No style token reuses a role colour (tested).

| Style | Chip / headings | Edge mark | Tint | Feel |
|---|---|---|---|---|
| `classic` (default) | grey / ink | hairline | panel | Quiet; colour only where it means something |
| `bookcloth` | deep blue `#1E4F9C` | orange `#D0601C` | `#EEF3FB` | Cloth binding with a headband thread |
| `plate` | black `#141414` | signal orange `#E8582A` | `#EEF3EF` | Museum plate |
| `window` | olive `#525E1B` | ochre `#A87C22` | `#F7F3E6` | Old reading room |
| `lagoon` | teal `#0F6E73` | coral `#D9553A` | `#EAF5F4` | Bright and calm |
| `orchard` | plum `#5B2A6E` | gold `#B57F12` | `#F5EFF7` | Warm |

Each style has a dark-mode set too. [`tests/unit/bookstyle.test.ts`](../tests/unit/bookstyle.test.ts) checks, in both modes: chip text on the chip ≥ 4.5 : 1, headings on paper and on the tint ≥ 4.5 : 1, body text on the tint ≥ 4.5 : 1, and the edge mark on paper ≥ 3 : 1. The 3D Edition opens in the matching binding and interface (Classic books get Bookcloth); `?theme=` overrides it.

### Never rely on color alone

Books get printed in black ink, and some readers can't separate hues. So:

- Every data series has a **direct label** or a legend entry next to the plot and a distinct **dash pattern**: solid, `6 3`, `2 3`, `8 3 2 3`.
- Every diagram box that carries a role also carries an **icon or a word** saying the role (e.g., "you decide", "leaves your machine").

## 2. Type

| Use | Font | Web size | Print size |
|---|---|---|---|
| Body text | Source Serif 4 | 18 px / 1.6 line height | 10.5 pt / 14.5 pt leading |
| Headings, figure labels, UI | Source Sans 3 (Semibold for headings) | scale 1.25 | scale 1.2 |
| Math | KaTeX fonts (web) · New Computer Modern Math (print, bundled with Typst) | — | — |
| Code | system `ui-monospace` (web) · DejaVu Sans Mono (print, bundled with Typst) | 0.9 em | 9 pt |

Source Serif 4 and Source Sans 3 are by Adobe under the SIL Open Font License 1.1 and are installed as pinned npm packages (`source-serif`, `source-sans`), so the print PDF can embed them.

Print floors, set above Kindle Direct Publishing's (KDP) minimums of 0.75 pt lines and 7 pt text [3]: **lines ≥ 1 pt, labels ≥ 8 pt, gray fills ≥ 12 %**.

## 3. Diagram conventions

- **Direction:** time and data flow left → right, then top → bottom.
- **Boxes:** 8 px corner radius, 1.5 px `ink` outline; a role color appears as a 4 px left bar plus a soft fill, not as a solid block.
- **Arrows:** 1.5 px, `ink` by default, `signal` when the arrow *is* the thing being taught; filled triangular heads.
- **Labels:** Source Sans 3, sentence case, no ALL CAPS except acronyms. Acronyms are spelled out on first use in the caption.
- **Circuit schematics:** we use the zig-zag resistor and parallel-plate capacitor common in U.S. textbooks, and say so in the first schematic's caption.
- **Plots:** axes in `muted`, 1 px; light grid in `rule`; axis titles include units in parentheses, e.g., "Time (ms)". Key points (like one time constant) get a dot, a thin guide line, and a direct label.

## 4. Figures and captions

- Numbered per chapter: **Figure 2.3**.
- Caption = the takeaway first, then detail: *"Figure 2.3 — After one time constant the capacitor has reached about 63 % of the supply voltage."*
- Credit line when a figure uses outside data or work: *"Data: …"*, *"Adapted from … (CC BY 4.0)"*. Code-drawn figures say *"Drawn by `examples/…/figures.ts`."*
- Every figure has **alt text** that states what the figure shows, not what it looks like.
- Vector (SVG) first. Raster only for photographs, at **300 DPI at printed size**.
- Web and GitHub: each figure ships as a light and a dark SVG, swapped with `<picture>` and `prefers-color-scheme`. Print uses the light SVG.
- **3D models:** interactive in the web book; print and EPUB get two or three rendered views plus a QR code and link to the interactive version.

## 5. Motion

| Setting | Value |
|---|---|
| One idea per animation | always |
| Loop length | 3–8 s |
| Transition | 400 ms, `cubic-bezier(0.4, 0, 0.2, 1)` (ease in-out) |
| Hold on the key frame | ≥ 1.5 s |
| `prefers-reduced-motion` | show the final key frame, no movement |

Animated SVGs use CSS keyframes (they play when embedded with `<img>` on GitHub); interactive and 3D pieces live on the GitHub Pages site with a static fallback in the README.

## 6. Layout (print)

- Default trim 6" × 9". Margins: **inside 0.75"**, outside 0.625", top 0.75", bottom 0.8" — above KDP's page-count-based gutter minimum for books up to 700 pages; the exporter recomputes the gutter from the final page count and raises it if needed [3].
- Figures up to the text-block width (4.625"); captions in Source Sans 3 at 8.5 pt.

## References

[1] M. Okabe and K. Ito, "Color Universal Design (CUD): How to make figures and presentations that are friendly to colorblind people," J\*FLY, 2008. https://jfly.uni-koeln.de/color/

[2] World Wide Web Consortium (W3C), "Web Content Accessibility Guidelines (WCAG) 2.2," W3C Recommendation, 2023. https://www.w3.org/TR/WCAG22/

[3] Amazon Kindle Direct Publishing, "Paperback Submission Guidelines." https://kdp.amazon.com/en_US/help/topic/G201857950

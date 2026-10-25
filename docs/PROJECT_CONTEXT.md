# Scriptorium: The Living Textbook Forge
Project context for Claude. Read fully before every task.

## Mission
Scriptorium (repo Normansrule/scriptorium) generates the best textbooks for learning and understanding: rigorous, fully referenced, written simply, and full of stunning visuals. Every book comes in two editions from one source:
- 2D Edition: a gorgeous print and ebook textbook, ready for Amazon Kindle Direct Publishing (KDP).
- 3D Edition: the same book as an immersive, explorable experience, where pages turn in 3D, diagrams lift off the page into rotatable models, processes animate, and every figure can be opened up and explored.
It ships as a web app and a downloadable desktop app from one codebase. Build on what the repo already has; don't rewrite working parts without asking.

## What makes the books great
1. Pedagogy first. Each chapter has learning objectives, a hook, core explanation, worked examples, a visual summary, common misconceptions, practice problems with solutions, and a chapter recap. Concepts are taught from several angles: intuition, visual, formal definition or equation, and example.
2. Simple language at top-expert rigor. Plain words first, then the precise term; every equation derived step by step; consistent notation and a glossary.
3. References everywhere. Every claim, figure and dataset is cited (textbooks, peer-reviewed papers, standards, agency sources) in a chosen citation style, with a full bibliography and an index.
4. Visuals that teach. Every figure has one job: diagrams, cutaways, exploded views, flowcharts, charts from real data, timelines and comparison tables, in a consistent style system across the whole book. No decorative filler.
5. Subjects: engineering, chemistry, medicine, biology, physics, computing, mathematics and more, with per-subject visual kits (molecule renderer, circuit diagrams, anatomical layers, free-body diagrams, plots).

## Generation pipeline
Topic and audience level → research and source gathering → outline (for my review) → chapter drafting → fact and citation check → figure planning → figure generation → layout → proofing pass → export. Every stage is visible, editable and re-runnable. Nothing ships without a human review gate.

## 2D Edition
- Layout engine with professional typography: a baseline grid, real math typesetting, widow and orphan control, figure placement near its first reference, running heads, and margin notes.
- Exports: a print-ready PDF and EPUB 3. Follow current KDP specifications (trim sizes, bleed, margins by page count, 300 dots per inch (DPI) images, embedded fonts, cover dimensions from the page count) and check them against KDP's live documentation before each release.
- Cover designer with spine and back cover sized automatically.
- Preflight checker: flags low-resolution images, text in the bleed, missing fonts, broken references and contrast issues before export.

## 3D Edition
- A physical-feeling book in 3D: realistic page turns, paper and binding materials, soft lighting, and a camera that leans in when you focus on a figure.
- Pop-off figures: any figure can rise off the page into a 3D model you can rotate, slice (cutaway), explode into parts, X-ray and animate. 2D labels stay synced with the 3D model.
- Living diagrams: processes animate with a scrubbable timeline (blood flow, a chemical reaction, a circuit, an engine cycle).
- Converter: an existing 2D book (one made in Scriptorium, or an imported PDF or EPUB the user has rights to) can be turned into a 3D Edition. Claude proposes which figures become 3D scenes; the user approves each one.
- Exports: a hosted interactive edition, an offline desktop edition, and high-resolution stills and turntable renders of 3D figures back into the 2D Edition for print.

## AI and honesty
- AI drafts the text, outlines, figure plans and quiz questions; it never invents a source. Every citation must resolve to a real, checkable reference, or the claim is flagged for the user.
- Images, 3D models and data must be generated, created in-house or properly licensed. Track the source and license per asset; credit them in the book.
- Medical, legal and safety-critical content carries a clear "educational, not professional advice" note and extra review flags.
- KDP requires authors to disclose AI-generated content. Remind the user and track what was AI-generated in project metadata.

## Tech direction (propose better options if you see them)
- Monorepo, TypeScript, React and Vite. Desktop via Tauri with a Rust core.
- Book source: a structured, open format (Markdown/MDX plus YAML metadata plus a figure spec per figure), versioned in git.
- 2D layout: Paged.js or Typst for print-quality PDF; KaTeX or MathJax for math; an EPUB 3 builder.
- 3D: React Three Fiber / Three.js with WebGPU where available; glTF assets with level-of-detail (LOD) variants; Theatre.js or GSAP for animation.
- Tests: golden-file PDF and EPUB checks, an EPUB validator (EPUBCheck), citation-resolution tests, visual regression of key pages, and performance budgets.

## Design language
The app, its website and the 3D Edition should feel like premium, award-level product design: unmistakably original, never template-like or generic AI-looking. References (borrow techniques, never copy layouts, assets or branding):
- apple.com and apple.com/airpods-pro: restraint, huge confident type, scroll-driven storytelling with pinned sections
- rive.app: state-machine animation, UI that reacts to the cursor
- igloo.inc and dogstudio.co: cinematic WebGL hero moments and section transitions
- bruno-simon.com: playful, explorable 3D
- 1minus1.com: study what makes it distinctive
Website: a scroll-driven story where a plain page of text fills with diagrams, the book closes and spins, then reopens in 3D as a figure rises off the page and unfolds into an exploded model.
App: a calm, focused writing studio with the book center stage and minimal chrome; editorial typography that rivals the best printed textbooks; one signature accent color. Delight lives in key moments: the outline appearing, the first page laid out, and the first figure popping into 3D.
Use the emil-design-eng, Impeccable and taste-skill skills for every UI task, and run Impeccable's audit before calling UI work done.
Non-negotiable:
- 60 frames per second (fps) for the 3D Edition on a mid-range laptop, and smooth on a recent phone
- Largest Contentful Paint (LCP) under 2.5 s
- keyboard navigation
- Web Content Accessibility Guidelines (WCAG) AA contrast
- alt text for every figure
- a reduced-motion mode that falls back to the 2D Edition
- sound off by default

## How to work
- Build in phases with a review gate at the end of each. Stop at every gate and show me screenshots, sample pages or recordings, a short summary and open questions.
- Prefer one finished flagship chapter in both editions over many shallow ones.
- When unsure about a fact, a KDP rule or a license, say so and check rather than guess.
- Write out acronyms in full with the acronym in parentheses the first time they appear in each chapter and in the docs.
- README and docs: clear and slightly informal, with GIFs, a feature tour, setup, an architecture diagram and a "Design" section.
- Keep replies to me concise and direct.

## Phases
0. Audit the existing repo, research, architecture, 3 visual concepts
1. Book source format + generation pipeline with review gates
2. 2D Edition: layout engine, figure system, PDF/EPUB export, preflight
3. Flagship chapter in the 2D Edition (a sample topic I pick)
4. 3D Edition: book renderer, page turns, pop-off figures
5. 2D → 3D converter + living diagrams
6. Cover designer, KDP export checks, citation verification
7. Website, desktop packaging, release
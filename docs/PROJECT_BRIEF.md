# Project brief: Scriptorium

> This is the brief the repository is built against. It is the original brief with
> the Kindle Direct Publishing (KDP) rules checked against Amazon's own help pages
> on 2026-09-30. Changes from the first draft are marked **[revised]**.
> The build instructions (role, quality bar, rules) live in [BUILD_PROMPT.md](BUILD_PROMPT.md).

## Summary

- **Name:** Scriptorium **[revised]** — a scriptorium was the room in a monastery where books were copied, checked and illustrated. The name is a placeholder that is easy to change (`package.json` `name`, README title, Pages URL).
- **One-sentence idea:** An open-source, web-based AND downloadable tool that generates professional, richly illustrated, fully referenced research books on any specialized topic (engineering, chemistry, medicine, biology, physics, and more), written in simple language but with top-expert accuracy, and exports print- and ebook-ready files for Amazon Kindle Direct Publishing (KDP).
- **Audiences:** (1) people using the tool to create books; (2) readers of the books (smart newcomers who want expert-level understanding).
- **Hosting:** GitHub Pages web app + downloadable desktop app (Windows/macOS/Linux) built from the same code.
- **Stack:** TypeScript web app; Tauri for the desktop build; Typst for print PDF; EPUB 3 export for ebooks; KaTeX + MathML for equations; Mermaid and code-generated SVG for diagrams; three.js / model-viewer for 3D; 3Dmol.js or Mol* for molecules and proteins; Citation Style Language (CSL) for citation styles.
  - **[revised] Change, with justification:** Typst is run through `typst.ts` (the Typst compiler compiled to WebAssembly, npm package `@myriaddreamin/typst-ts-node-compiler`). This keeps Typst as the typesetter but means (a) nobody has to install a separate Typst binary, and (b) the same compiler can later run inside the browser, so the GitHub Pages app can produce a PDF with no server.
- **Bring-your-own API key** for the AI model; the key stays on the user's machine and is only sent to the model provider.

## Generation pipeline (each stage visible in the UI, with a progress view)

1. **Topic + scope:** user enters topic, depth, audience level, length, domain profile, citation style.
2. **Outline:** chapter/section plan with learning goals per chapter. **HUMAN CHECKPOINT:** user edits/approves.
3. **Research:** gather sources from scholarly databases (Crossref, OpenAlex, PubMed, arXiv, domain databases like PubChem and the Protein Data Bank), store metadata + Digital Object Identifiers (DOIs) in the bibliography.
4. **Verification:** every reference resolved and checked; every claim linked to a source or marked as explanation; unverifiable claims flagged in a report.
5. **Drafting:** layered writing per section: plain summary → intuition → formal detail (equations) → limits/edge cases → key takeaways.
6. **Figures, equations, 3D:** generated per the rules below.
7. **Expert review pass:** a separate reviewer agent critiques accuracy, rigor, missing caveats, and outdated claims; fixes applied and logged.
8. **Readability pass:** target roughly grade 10 to 12 reading level for body text without dropping rigor; every term defined; glossary auto-built.
9. **Layout + export:** web book, print PDF, EPUB. **HUMAN CHECKPOINT:** user reviews final proof.

## Domain profiles (pluggable; adding a new domain = adding one config file)

Each profile defines: default citation style (e.g., IEEE for engineering, ACS for chemistry, AMA for medicine), preferred databases, figure types (e.g., free-body and circuit diagrams, reaction mechanisms and 3D molecules, anatomical and pathway diagrams, cell and protein structures), units conventions, and required safety notes. Ship engineering, chemistry, medicine, and biology profiles first; document how to add more.

## Writing standard

"Explain like a great teacher, check like a journal referee." Simple sentences, concrete examples and analogies, but no oversimplification that becomes wrong. Mark simplifications explicitly. Each chapter ends with a summary, key equations, and further reading.

## Figures standard (professional style)

- One book-wide style from STYLE.md: colorblind-safe palette, consistent fonts, line weights, labeling.
- Prefer accurate, code-drawn vector figures (SVG/plots from real data) for anything technical; numbered figures with captions and source credit.
- Raster images at 300 DPI at printed size; grayscale-safe versions for black-and-white print.
- **[revised]** Print-safe drawing minimums, from KDP: every line at least 0.75 pt, every label at least 7 pt, and every gray fill at least 10% for black-ink interiors. STYLE.md sets its own minimums above these.
- Third-party images only when license allows (e.g., public domain / Creative Commons), with attribution. AI-generated images are allowed only for non-technical illustration, are labeled in the build log, and never depict data, anatomy, or structures unless verified against sources.
- 3D: interactive models in the web book; print and EPUB get rendered stills from 2 to 3 angles plus a QR code/link to the interactive version.

## Content safety

- Medical content: educational disclaimer, no individualized treatment or dosing directives, flag clinical sections for licensed-professional review before publishing.
- Omit hazardous procedural detail (e.g., synthesis routes for dangerous substances, weaponizable methods) regardless of topic; explain concepts at the level a textbook would.
- Every book ships with a verification report: sources checked, claims flagged, reviewer changes.

## KDP publishing module **[revised — every rule below checked against KDP help pages, 2026-09-30]**

All numbers live in one file, `src/kdp/specs.ts`, each with a comment linking the KDP page it came from, so a rule change is a one-line edit.

### Interior (paperback PDF)

- User-selected trim size (default 6" × 9"); single-page PDF, not spreads. [G201857950]
- **Bleed** only when art reaches the page edge. With bleed, the PDF page is **0.125" wider and 0.25" taller** than the trim size (0.125" on top, bottom and outer edge). [G201857950]
- **Minimum margins by page count:** [G201857950]

  | Page count | Inside (gutter) | Outside, no bleed | Outside, with bleed |
  |---|---|---|---|
  | 24–150 | 0.375" | ≥ 0.25" | ≥ 0.375" |
  | 151–300 | 0.5" | ≥ 0.25" | ≥ 0.375" |
  | 301–500 | 0.625" | ≥ 0.25" | ≥ 0.375" |
  | 501–700 | 0.75" | ≥ 0.25" | ≥ 0.375" |
  | 701–828 | 0.875" | ≥ 0.25" | ≥ 0.375" |

  Because the gutter depends on page count, layout runs twice: once to count pages, once with the final gutter.
- **Page count:** minimum 24 (72 for standard color); maximum depends on trim, ink and paper (e.g., 828 for 6" × 9" black ink on white). KDP rounds up to an even number. [G201857950]
- **Images** at least 300 DPI; KDP recommends at most 600 DPI to keep files under 650 MB. [G201857950]
- **Fonts** embedded; minimum 7 pt. [G201857950]
- **Clean PDF:** no crop or trim marks, **no bookmarks**, comments, annotations, invisible objects, placeholder text **or document metadata**; transparencies flattened; not encrypted. Typst writes a bookmark outline and metadata by default, so the export step strips them (`pdf-lib` post-pass) and pre-flight checks they are gone. [G201857950]
- **Pagination:** even numbers on left pages, odd on right. [G201857950]

### Cover generator

- One PDF: back + spine + front as a single image. [G201953020]
- **Cover width** = 0.125" bleed + back width + spine width + front width + 0.125" bleed; **cover height** = 0.125" + trim height + 0.125". [G201953020]
- **Spine width** = page count × paper factor: white 0.002252", cream 0.0025", groundwood 0.00235", premium color 0.002347", standard color 0.002252". [G201953020, G201857950]
- **Spine text** only when the book has more than 79 pages, with at least 0.0625" clearance on each side of the spine. [G201953020]
- Front and back text at least 0.125" inside the trim lines; nothing meant to survive trimming closer than 0.25" to the outside edge. [G201953020, G201857950]
- Images at least 300 DPI; no spot colors; no embedded color profiles (KDP strips them). [G201953020]
- Cover text must match the title-setup details exactly (title, author, edition). [G201953020]

### Ebook

- EPUB 3 (reflowable by default; equations as MathML with image fallback), plus an ebook cover image. KDP no longer accepts MOBI: support ended for reflowable books on August 1, 2021 and for fixed-layout books on March 18, 2025.

### Metadata helper

- Title, subtitle, description, keywords, categories.
- **[revised] Title-creation limit:** KDP lets an account create only **2 titles per book format per week**. The tool warns when a user queues more than that, so a batch of generated books doesn't stall at upload. [G201857950]

### AI disclosure checklist **[revised]**

- KDP asks about AI-generated **text, images and translations** separately; images include cover and interior art. [G200672390]
- KDP's definitions: content **created by** an AI tool is "AI-generated" **even after substantial human edits**; content a person created and then polished, error-checked or brainstormed with AI is "AI-assisted" and does not need disclosing. [G200672390]
- Consequence for this tool: body text drafted by the pipeline is AI-generated, so the checklist defaults text to **Yes** and records per-section provenance (drafted by model / written by user). Code-drawn figures produced by deterministic scripts are recorded as such; AI-generated illustrations are recorded per image.

### Pre-flight checker

Validates interior and cover files against every rule above before export, with a pass/fail report.

## Security specifics for this tool

- API key stored in the operating system (OS) keychain (desktop) or session memory (web, opt-in to persist); never logged or exported.
- Fetched papers and web content treated as untrusted input to the model (prompt-injection defenses); rendered output sanitized.
- Uploaded files validated by type and size; no execution of uploaded content.
- Per-book spending cap and rate limiting on model calls.
- **[revised] Release integrity:** downloadable builds are built by Continuous Integration (CI) from tagged commits and published with SHA-256 checksums **plus GitHub artifact attestations** (Sigstore-backed build provenance via `actions/attest-build-provenance`), so "signed checksums" in milestone 4 means something checkable: `gh attestation verify <file> --repo <owner>/scriptorium`.

## README must-have visuals for THIS repo

- Hero animation: topic typed in → outline → pages filling with figures → exported book.
- Animated pipeline diagram of the 9 stages with the two human checkpoints highlighted.
- Before/after: raw draft vs. finished illustrated page.
- Gallery of sample pages from each domain profile.
- Diagram of the security model (what stays local, what goes to the model provider).
- Screenshot sequence of the KDP export and pre-flight report.

## Milestones

1. **MVP:** engineering profile only, 3-chapter sample book, web export + PDF. Commit the sample to `examples/`.
2. Add chemistry, medicine, biology profiles with 3D viewers.
3. EPUB, cover generator, KDP pre-flight.
4. Desktop builds with SHA-256 checksums and build-provenance attestations; GitHub Pages live demo.

## Sources for the KDP rules

- [G200672390] Amazon KDP, "Content Guidelines" (section: Artificial intelligence (AI) content). https://kdp.amazon.com/en_US/help/topic/G200672390
- [G201857950] Amazon KDP, "Paperback Submission Guidelines." https://kdp.amazon.com/en_US/help/topic/G201857950
- [G201953020] Amazon KDP, "Create a Paperback Cover." https://kdp.amazon.com/en_US/help/topic/G201953020
- Amazon KDP, "MOBI support FAQ." https://kdp.amazon.com/en_US/help/topic/GULSQMHU5MNH4EZM

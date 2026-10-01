# Adding a domain

A domain (engineering, chemistry, medicine, biology, …) is **one JSON file** in `profiles/`. The pipeline reads it to choose the citation style, the databases to search, the figure types to offer the model, the unit conventions to enforce, and the safety text every book in that domain carries. No code changes are needed for a new domain unless it needs a new database or figure renderer.

## 1. Write the profile

Copy the closest existing profile and edit it. Example: `profiles/physics.json`.

```json
{
  "id": "physics",
  "name": "Physics",
  "description": "Mechanics, waves, electromagnetism, thermodynamics and modern physics.",
  "citationStyle": "ieee",
  "databases": ["crossref", "openalex"],
  "figureTypes": [
    { "id": "plot", "name": "Plot from equations", "description": "Curves drawn from the book's own equations with the worked-example values." },
    { "id": "free-body", "name": "Free-body diagram", "description": "Labeled force arrows on a simple body, drawn by code." }
  ],
  "units": {
    "system": "SI",
    "conventions": ["Write units with a space: 9.81 m/s², not 9.81m/s².", "Use scientific notation for very large or small numbers."]
  },
  "safetyNotes": ["This book explains physics; it is not a laboratory manual."],
  "restrictedDetail": ["Design details for weapons or devices meant to cause harm"],
  "requiresProfessionalReview": false,
  "draftingNotes": ["Separate classical results from their quantum or relativistic limits."]
}
```

| Field | What it does |
|---|---|
| `id` | Lower-case, letters and hyphens; must match the file name. |
| `citationStyle` | A Citation Style Language (CSL) style. The file `styles/<citationStyle>.csl` must exist (see step 2). |
| `databases` | Where research searches. Crossref is always searched; `openalex` and `pubmed` add their results; `pubchem` and `pdb` let drafts request 3D structures. `arxiv` is accepted by the schema but not searched yet. |
| `figureTypes` | The figure kinds offered to the drafting model. A type with id `molecule-3d` or `structure-3d` enables 3D structure blocks. |
| `units.conventions` | Rules added to the drafting prompt and checked by the reviewer. |
| `safetyNotes` | Printed in the preface of every book in the domain. |
| `restrictedDetail` | Topics kept at textbook level: the drafting prompt forbids procedural detail, and the reviewer flags it. |
| `requiresProfessionalReview` | `true` marks every book as needing review by a licensed professional: a preface callout, a `problem` item in the report, and a warning on every build. |
| `draftingNotes` | Extra drafting instructions. They ship with the repository, so they are trusted. |

## 2. Add the citation style (if new)

Download the style from the official CSL repository (`https://github.com/citation-style-language/styles`) into `styles/`. Prefer a numeric style; author–date styles work but the in-text numbers become author–year. The styles are licensed CC BY-SA 3.0; keep their license header.

## 3. Check it

```bash
npm test                 # tests/unit/profiles.test.ts parses every profile and checks its style file exists
npm run app              # the new domain appears in the Domain list; the style follows it
```

`tests/unit/profiles.test.ts` lists the expected profiles; add your file name there.

## 4. Add a gallery sample (recommended)

A one-chapter sample shows the domain working end to end and keeps it tested.

1. Create `examples/<name>/` with `book.json`, `references.json` and, for code-drawn figures, `figures.ts` exporting `drawAll(root)` that writes `figures/<name>.svg` and `<name>.dark.svg` (and `models/*.json` for 3D) and returns the relative paths. Copy `examples/cells-and-dna/` as a template.
2. Every reference must be real and checked: give a DOI, PMID, URL or ISBN, and a `verification` record saying what you read and which claims it supports. **Never invent a reference.**
3. Add `tests/equations/test_<name>.py` re-deriving every equation and worked example with SymPy and Pint, and point each equation's `example.check` at its test.
4. Build and check:

```bash
npm run build -- examples/<name> --epubcheck
npm run test:equations
npm run assets:check     # figures in the repo match figures.ts
```

`tests/unit/book.test.ts` picks the new sample up automatically and checks that every figure and model view exists in light and dark.

## 5. New databases or figure renderers

- **Database:** add a client under `src/research/` (use `get()` from `scholarly.ts` for plain-language network errors, keep only whitelisted fields, treat every reply as untrusted), add its id to `Database` in `src/core/profile.ts`, call it in `stageResearch` in `src/core/pipeline.ts`, and add its host to the app's Content Security Policy in `web/index.html`.
- **Figure renderer:** register a block kind with `extraHtmlBlocks` (`src/render/html.ts`) and `extraTypstBlocks` (`src/render/typst.ts`), follow [STYLE.md](STYLE.md), and write the light and dark versions.

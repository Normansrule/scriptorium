# Security model

This page lists what Scriptorium protects, what it trusts, and how each threat is handled. Report a vulnerability through [SECURITY.md](../SECURITY.md), not a public issue.

## What we protect

| Asset | Why it matters |
|---|---|
| Your model-provider API key | Anyone holding it can spend your money. |
| Your book project (drafts, outline, notes) | Unpublished work; may be commercially sensitive. |
| The integrity of a published book | A reader must be able to trust that sources exist and say what the book claims. |
| Your machine and browser | Generated or downloaded content must never run as code. |

## Trust boundaries

Everything that arrives from outside the code in this repository is **untrusted data**:

- model replies (outline, drafts, review findings, plot expressions, structure requests);
- search results and abstracts from Crossref, OpenAlex and PubMed;
- 3D structure files from PubChem and the Protein Data Bank (RCSB PDB);
- project files, model files and figures you load into the command line or the app.

Untrusted data can be wrong or hostile. It is never executed, never treated as instructions, and never inserted into a page without escaping and sanitizing.

## What leaves your machine

| Destination | What is sent | What is never sent |
|---|---|---|
| Model provider (`api.anthropic.com`) | Your API key (request header), topic, outline, reference titles and abstracts, drafts | Anything else on your machine |
| Crossref, OpenAlex, PubMed | Search keywords, DOIs, PubMed IDs, and (optional) the contact e-mail in `CROSSREF_MAILTO` | Your key, drafts or project |
| PubChem, RCSB PDB | A compound name or a four-character PDB ID | Your key, drafts or project |

There is no telemetry. The web app's Content Security Policy only allows network connections to the hosts above.

## Threats and mitigations

| # | Threat | Mitigation | Where |
|---|---|---|---|
| T1 | API key leaks into logs, exports, errors or the repository | Key read from the environment (command line), kept in tab memory (web app; saved to local storage only if you tick *Remember on this device*), or stored in the operating system's keychain (desktop app). Never written to project files or error messages; tests assert this. `.env` is git-ignored; `.env.example` has no value. GitHub secret scanning and push protection are on. | `src/llm/provider.ts`, `tests/unit/untrusted.test.ts` |
| T2 | Prompt injection from an abstract or web page ("ignore previous instructions…") | Untrusted text is cleaned (control and bidirectional characters removed, length capped) and wrapped in clearly delimited data blocks; the system prompt says such blocks are data. Model output must pass a strict schema, so injected instructions cannot add new kinds of action. | `src/llm/untrusted.ts`, `src/llm/prompts.ts` |
| T3 | Invented or swapped references | A reference is used only after its DOI resolves in Crossref (or its PMID in PubMed) and the title (Jaccard ≥ 0.8), year and first author match. Drafts may cite only verified IDs; a citation guard removes anything else and records it. | `src/research/`, `src/core/pipeline.ts` |
| T4 | Code execution through plot expressions | Expressions go through a small recursive-descent parser with a fixed list of functions and variables; no `eval`, no property access, own-property lookups only (`constructor`, `__proto__` fail). | `src/core/expr.ts`, `tests/unit/expr.test.ts` |
| T5 | Code execution through LaTeX | KaTeX runs with `trust: false` and `strict: 'error'`; the LaTeX-to-Typst converter accepts an allow-list of commands and refuses the rest. | `src/render/html.ts`, `src/render/latex-typst.ts` |
| T6 | Script injection into the web book, EPUB or app proof | Every string is HTML-escaped when rendered; the page body is then sanitized with DOMPurify (scripts, styles, iframes, forms and event handlers removed). EPUB pages are sanitized and re-serialized as XHTML. | `src/node/export-web.ts`, `src/node/export-epub.ts`, `web/src/main.ts` |
| T7 | Malicious 3D model or structure download | Downloads are size-limited (5 MB) and parsed by strict XYZ/PDB/SDF parsers into numbers and short labels; models are schema-checked again in the viewer before use. Compound names and PDB IDs are pattern-checked before any request. | `src/research/structures.ts`, `src/core/molecule.ts`, `src/render/viewer3d-client.ts` |
| T8 | The 3D viewer as an attack surface | Web books without models allow no scripts at all (`default-src 'none'`, no `script-src`). Books with models load exactly one script of our own (`assets/viewer3d.js`, `script-src 'self'`); it reads only `data-model` JSON, re-validates it, and draws with the same escaping SVG renderer as the print stills. If it does not run, the stills remain. | `src/render/html.ts` (CSP), `src/render/viewer3d-client.ts` |
| T9 | Hostile project file (`build-project`) | Figure names must match `^[a-z0-9-]+(\.dark)?\.svg$` and may not contain script or event handlers; model paths must match `^models/[a-z0-9-]+\.json$` and are re-serialized from the schema. Nothing is written outside `books/<slug>/`. | `src/cli/main.ts` |
| T10 | Runaway spending | A per-book token cap is checked before every model call, plus a requests-per-minute limit. | `src/llm/budget.ts`, `tests/unit/budget.test.ts` |
| T11 | Hazardous or harmful content | Each domain profile lists restricted detail (for example dosing instructions, pathogen methods); drafting prompts forbid it, the reviewer checks for it. Medicine books carry an educational disclaimer and are flagged for licensed-professional review in the report and at build time. | `profiles/*.json`, `src/core/pipeline.ts` |
| T12 | Compromised dependency | Exact versions in `package-lock.json` and `requirements.txt`; Dependabot and CodeQL; `npm audit --audit-level=high` in CI. | `.github/` |
| T13 | Over-privileged CI | Workflows default to `contents: read`; only the Pages job gets `pages: write` and `id-token: write`, and only the release publish job gets `contents: write`, `id-token: write` and `attestations: write`. | `.github/workflows/` |
| T14 | The desktop shell as an attack surface | The webview may call exactly three commands (`key_get`, `key_set`, `key_delete`), granted by `src-tauri/capabilities/default.json` through an app manifest; no file-system, shell or HTTP plugins. The same strict Content Security Policy applies, with `ipc:` added for those commands. Links to other sites open in the system browser instead of loading inside the app window; downloads go to the Downloads folder. Key errors never include the key. | `src-tauri/` |
| T15 | Tampered installers | Release installers are built by GitHub Actions from a tagged commit, published with `SHA256SUMS.txt`, and carry Sigstore-backed build-provenance attestations (`gh attestation verify <file> --repo Normansrule/scriptorium`). They are not code-signed yet, so the operating system warns on first launch. | `.github/workflows/release.yml` |

## Known limits

- Verification proves a source **exists and is the one named**. Whether it supports a specific claim is checked by the reviewer model against the abstract and flagged for a human when it cannot be confirmed; it is not proof.
- A determined prompt injection can still make a draft *wrong* (not unsafe). The schema, citation guard and review make this visible; a human reads the proof before export.
- In the web app, saving the key to local storage means any script running on that origin could read it. The app loads only its own bundle under a strict policy, but the safest choice is not to tick *Remember on this device* — or to use the desktop app, which keeps the key in the operating system's keychain.

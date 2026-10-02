# Contributing

Thanks for helping. The bar for this repository is "the best-documented, most visual, most trustworthy repo a newcomer has ever opened", so a change is done when its code, tests, visuals and docs are done together.

## Set up

```bash
npm ci
python -m pip install -r requirements.txt
npm test && npm run test:equations && npm run demo
npm run desktop                                   # optional: the desktop app (needs Rust; see README Quick start)
npm run build:all -- --allow-short --epubcheck   # all four sample books; EPUBCheck needs Java 11+
```

## Before you open a pull request

- `npm run typecheck`, `npm test` and `npm run test:equations` pass.
- `npm run assets` has been run if you touched anything that draws a figure or diagram, and `npm run assets:check` passes (CI fails on stale art).
- New visuals follow [docs/STYLE.md](docs/STYLE.md): palette roles, direct labels or a legend, light and dark versions, alt text, a numbered caption that states the takeaway, and a credit line.
- New equations in a book follow the pattern: intuition sentence → equation → symbol list with units → worked example with a test in `tests/equations/` → where it stops being valid.
- New factual claims cite a source you opened yourself; record how you verified it in `references.json`. Never add a reference you have not checked.
- No secrets, keys or personal data in commits (push protection is on).
- Acronyms are written out in full on first use.

## Adding a domain

See [docs/ADDING_A_DOMAIN.md](docs/ADDING_A_DOMAIN.md): one JSON file in `profiles/`, a CSL style, and ideally a one-chapter sample book in `examples/`.

## Commit messages

Short imperative subject ("Add chemistry profile"), then a body explaining why.

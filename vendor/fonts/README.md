# Fonts for the in-app Typst compiler

The command-line Typst compiler has these fonts built in. The WebAssembly compiler used by
the web and desktop app does not, so the same files are shipped here and loaded only when you
export a book in the app. Copied unchanged from the Typst project's asset repository
(`typst/typst-assets`, folder `files/fonts`).

| File | Font | License |
|---|---|---|
| `NewCMMath-Book.otf` | New Computer Modern Math (equations in print) | GUST Font License (an LPPL-based free font license) |
| `DejaVuSansMono.ttf` | DejaVu Sans Mono (code in print) | Bitstream Vera / DejaVu fonts license (free, permissive) |

Body text uses Source Serif 4 and Source Sans 3 (SIL Open Font License 1.1), installed from npm.

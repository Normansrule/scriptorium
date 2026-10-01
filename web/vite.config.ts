import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const here = import.meta.dirname;

// Relative base so the same build works at https://<user>.github.io/scriptorium/ and inside the desktop app.
export default defineConfig({
  root: resolve(here),
  base: './',
  publicDir: false,
  // KaTeX, citeproc, Zod, four CSL styles and the four sample books make one ~1.3 MB chunk
  // (~325 kB gzipped); acceptable for a tool page that works offline after loading.
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true, sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { fs: { allow: [resolve(here, '..')] } },
});

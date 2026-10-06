import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { buildSync } from 'esbuild';

const here = import.meta.dirname;

/**
 * `import js from 'virtual:viewer3d'` gives the 3D viewer (src/render/viewer3d-client.ts) as one
 * minified classic script, the same one the command line writes into web editions.
 */
function viewer3d(): Plugin {
  const id = 'virtual:viewer3d';
  const entry = resolve(here, '../src/render/viewer3d-client.ts');
  return {
    name: 'scriptorium-viewer3d',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(loaded) {
      if (loaded !== `\0${id}`) return null;
      const res = buildSync({ entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, write: false, legalComments: 'none', metafile: true });
      for (const input of Object.keys(res.metafile.inputs)) this.addWatchFile(resolve(here, '..', input));
      return `export default ${JSON.stringify(res.outputFiles[0]!.text)};`;
    },
  };
}

// Relative base so the same build works at https://<user>.github.io/scriptorium/ and inside the desktop app.
export default defineConfig({
  root: resolve(here),
  base: './',
  publicDir: false,
  plugins: [viewer3d()],
  // KaTeX, citeproc, Zod, four CSL styles and the four sample books make one ~1.3 MB chunk
  // (~325 kB gzipped); acceptable for a tool page that works offline after loading.
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true, sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { fs: { allow: [resolve(here, '..')] } },
});

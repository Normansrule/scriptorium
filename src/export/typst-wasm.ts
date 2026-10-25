/**
 * TypstEngine on the WebAssembly build of Typst (typst.ts), for the web and desktop app.
 * Runs in the browser and in Node (tests). Nothing is fetched by this module: the caller
 * supplies the two WebAssembly binaries and the font files, so the app works offline and
 * under a Content Security Policy that allows no third-party hosts.
 */
import { createTypstCompiler, createTypstRenderer, type BeforeBuildFn, type TypstCompiler, type TypstRenderer } from '@myriaddreamin/typst.ts';
import type { TypstEngine } from './engine.ts';

export interface WasmAssets {
  /** typst_ts_web_compiler_bg.wasm (bytes, or a URL the runtime can fetch) */
  compilerWasm: Uint8Array | string;
  /** typst_ts_renderer_bg.wasm, needed only for svg() */
  rendererWasm?: Uint8Array | string;
  /** every font the documents use (Source Serif 4, Source Sans 3, New Computer Modern Math, DejaVu Sans Mono) */
  fonts: Uint8Array[];
}

const MAIN = '/main.typ';
const PDF = 1; // CompileFormatEnum.pdf
const VECTOR = 0; // CompileFormatEnum.vector

export interface WasmEngine extends TypstEngine {
  /** Replace the book files the documents can read (paths relative to the book, e.g. `figures/x.svg`). */
  setFiles(files: Record<string, Uint8Array>): void;
}

/**
 * Font loader that hands our font bytes straight to the compiler. typst.ts's own loadFonts()
 * builds a `new Function(...)` for dynamic imports, which a strict Content Security Policy
 * (no 'unsafe-eval') refuses; this loader needs neither eval nor the network. The two marker
 * properties tell typst.ts that fonts are handled and no default font assets should be fetched.
 */
function ownFonts(fonts: Uint8Array[]): BeforeBuildFn {
  const loader = async (_: unknown, ctx: { builder: { add_raw_font(font: Uint8Array): Promise<void> } }) => {
    for (const f of fonts) await ctx.builder.add_raw_font(f);
  };
  return Object.assign(loader, { _kind: 'fontLoader', _preloadRemoteFontOptions: { assets: false } }) as unknown as BeforeBuildFn;
}

/**
 * The Typst WebAssembly glue creates a few placeholder JavaScript functions with the Function
 * constructor (`new Function("return 0")` and similar). A Content Security Policy without
 * 'unsafe-eval' refuses that, so while Typst code runs, the constructor is wrapped: these exact,
 * known bodies get equivalent closures — no eval — and every other string still goes to the
 * real constructor, which the policy keeps refusing.
 */
const KNOWN_BODIES: Record<string, (...args: unknown[]) => unknown> = {
  '=>return 0': () => 0,
  '=>return true': () => true,
  '=>return this': () => globalThis,
  'path=>return path': (path: unknown) => path,
  "=>throw new Error('Dummy AccessModel, please initialize compiler with withAccessModel()')": () => {
    throw new Error('Dummy AccessModel, please initialize compiler with withAccessModel()');
  },
  "=>throw new Error('Dummy Registry, please initialize compiler with withPackageRegistry()')": () => {
    throw new Error('Dummy Registry, please initialize compiler with withPackageRegistry()');
  },
};

const RealFunction = globalThis.Function;
let shimDepth = 0;

export async function withoutEval<T>(run: () => Promise<T>): Promise<T> {
  if (shimDepth++ === 0) {
    const make = (args: unknown[]) => {
      const strs = args.map(String);
      const key = `${strs.slice(0, -1).join(',')}=>${strs.at(-1) ?? ''}`;
      return Object.prototype.hasOwnProperty.call(KNOWN_BODIES, key) ? KNOWN_BODIES[key] : undefined;
    };
    globalThis.Function = new Proxy(RealFunction, {
      construct: (target, args, newTarget) => make(args) ?? Reflect.construct(target, args, newTarget),
      apply: (target, thisArg, args) => make(args) ?? Reflect.apply(target, thisArg, args),
    });
  }
  try {
    return await run();
  } finally {
    // restore only when the outermost call ends, so overlapping calls never leave the shim behind
    if (--shimDepth === 0) globalThis.Function = RealFunction;
  }
}

export async function createWasmEngine(assets: WasmAssets): Promise<WasmEngine> {
  const compiler: TypstCompiler = createTypstCompiler();
  await withoutEval(() =>
    compiler.init({
      getModule: () => assets.compilerWasm,
      beforeBuild: [ownFonts(assets.fonts)],
    }),
  );
  let renderer: TypstRenderer | null = null;
  // One document at a time: the compiler has a single main file and one set of mapped files.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };

  const compile = async (source: string, format: number) => {
    compiler.addSource(MAIN, source);
    const res = await withoutEval(() => compiler.compile({ mainFilePath: MAIN, format, diagnostics: 'full' } as never));
    const diags = (res.diagnostics ?? []) as Array<{ severity?: string; message?: string; range?: string }>;
    const errors = diags.filter((d) => d.severity === 'error' || d.severity === 'Error');
    if (!res.result || errors.length) throw new Error(`Typst could not compile the book:\n${errors.map((d) => `${d.message}${d.range ? ` (${d.range})` : ''}`).join('\n') || 'unknown error'}`);
    return res.result as Uint8Array;
  };

  return {
    setFiles(files) {
      compiler.resetShadow();
      for (const [path, bytes] of Object.entries(files)) compiler.mapShadow(`/${path.replace(/^\/+/, '')}`, bytes);
    },
    async pdf(source) {
      const pdf = await serial(() => compile(source, PDF));
      // Count pages from the PDF itself (`/Type /Page` objects), without parsing it twice.
      const { PDFDocument } = await import('pdf-lib');
      const pages = (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
      return { pdf, pages };
    },
    async svg(source) {
      if (!assets.rendererWasm) throw new Error('The Typst renderer is not loaded.');
      const vector = await serial(() => compile(source, VECTOR));
      if (!renderer) {
        const r = createTypstRenderer();
        await withoutEval(() => r.init({ getModule: () => assets.rendererWasm! }));
        renderer = r;
      }
      const rr = renderer;
      return withoutEval(() => rr.renderSvg({ artifactContent: vector } as never));
    },
    async query(source, label) {
      return serial(async () => {
        compiler.addSource(MAIN, source);
        const found = (await withoutEval(() => compiler.query({ mainFilePath: MAIN, selector: `<${label}>` } as never))) as Array<{ value?: unknown }>;
        return (found ?? []).map((m) => m.value);
      });
    },
  };
}

/// <reference types="vite/client" />
declare module '*.csl?raw' {
  const s: string;
  export default s;
}
declare module '*.xml?raw' {
  const s: string;
  export default s;
}
/** The 3D viewer for web editions, bundled at build time by the plugin in web/vite.config.ts. */
declare module 'virtual:viewer3d' {
  const js: string;
  export default js;
}

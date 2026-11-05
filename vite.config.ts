import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "web",
  // assetsInlineLimit 0: no data: URIs, which the CSP (default-src 'self') would block.
  build: { outDir: "../dist/web", emptyOutDir: true, assetsInlineLimit: 0 },
  // The API server owns 5173; the dev server sits next to it and proxies /api and /tiles.
  server: { port: 5174, host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:5173", "/tiles": "http://127.0.0.1:5173" } },
  // Vitest would otherwise inherit root "web" and miss test/.
  test: { root: "." },
});

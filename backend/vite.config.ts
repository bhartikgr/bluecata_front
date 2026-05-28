import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "@capavate/cap-table-engine": path.resolve(import.meta.dirname, "packages/cap-table-engine/src/index.ts"),
      "@capavate/cap-table-engine-ref": path.resolve(import.meta.dirname, "packages/cap-table-engine-ref/src/index.ts"),
      "@capavate/telemetry": path.resolve(import.meta.dirname, "packages/telemetry/src/index.ts"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  // v23.4.4 — absolute base for BrowserRouter.
  //
  // Sprint 16's `base: "./"` was paired with the hash-router (the SPA only
  // ever loaded from /index.html, so relative asset paths worked). With
  // BrowserRouter (v23.4.3) every deep link loads from a different
  // pathname, and relative `./assets/...` URLs resolve against the
  // current path — e.g. on /founder/dashboard the browser asks for
  // /founder/assets/index.js, which 404s. Absolute `/` base fixes that.
  base: "/",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});

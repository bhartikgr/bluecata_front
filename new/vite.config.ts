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
  // Sprint 16 hotfix: relative base required because the deploy proxy serves
  // the site under a long token-prefixed URL. Absolute /assets/... paths 404.
  // Hash-router handles deep links; main.tsx rewrites /founder/... → /#/founder/...
  base: "./",
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

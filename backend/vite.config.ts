import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { execSync } from "node:child_process";

// Build-time markers. Never fail the build if git is unavailable — degrade to
// "unknown" so a git-less build (tarball, CI without .git) still succeeds.
function safeBuildSha(): string {
  if (process.env.VITE_BUILD_SHA) return process.env.VITE_BUILD_SHA;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || "unknown";
  } catch {
    return "unknown";
  }
}

const BUILD_SHA = safeBuildSha();
const BUILD_TIME = process.env.VITE_BUILD_TIME || new Date().toISOString();

export default defineConfig({
  define: {
    "import.meta.env.VITE_BUILD_SHA": JSON.stringify(BUILD_SHA),
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(BUILD_TIME),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      "@capavate/cap-table-engine": path.resolve(import.meta.dirname, "packages/cap-table-engine/src/index.ts"),
      "@capavate/cap-table-engine-ref": path.resolve(import.meta.dirname, "packages/cap-table-engine-ref/src/index.ts"),
      "@capavate/telemetry": path.resolve(import.meta.dirname, "packages/telemetry/src/index.ts"),
      // WAVE 9 M-1a. tsconfig.json:24 already mapped @capavate/math-fns, so
      // `tsc` resolved it and the type-checker was happy — but Vite has its own
      // resolver and did NOT, so any client import of the CANONICAL fund-math
      // package (ENGINE_REGISTRY C-4) failed at bundle time. That asymmetry is
      // why the package sat orphaned with zero consumers. Both trees now agree.
      "@capavate/math-fns": path.resolve(import.meta.dirname, "packages/math-fns/src/index.ts"),
      "@capavate/math-fns-ref": path.resolve(import.meta.dirname, "packages/math-fns-ref/src/index.ts"),
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

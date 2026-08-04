/**
 * Wave B (v26.4.0) Stage 3 — Retirement guard tests.
 *
 * Enforces that the Wave B Stage 2 retirement of `spvFundStore` as a
 * route-registration module holds as a code artifact:
 *
 *   (G-1) `server/routes.ts` no longer imports from `./spvFundStore`
 *   (G-2) `server/routes.ts` no longer calls `registerSpvFundRoutes(app)`
 *   (G-3) `server/spvLegacyAdapters.ts` exists and exports
 *         `registerSpvLegacyAdapterRoutes`
 *   (G-4) `server/routes.ts` DOES import and call
 *         `registerSpvLegacyAdapterRoutes` (positive assertion — retirement
 *         happened AND the replacement is wired)
 *   (G-5) The sole remaining `spvFundStore` imports outside test files are:
 *         - `server/lib/hydrateStores.ts` (hydration, retires in Wave B.5)
 *         - `server/spvEngineStore.ts`   (Stage 2 delegation)
 *         - `server/partnerWorkspaceStore.ts` (dynamic require for shadow-persist,
 *            actually rewired to spvEngineStore in Stage 1 — assert it does NOT
 *            require spvFundStore any more)
 *   (G-6) `server/partnerWorkspaceStore.ts` no longer contains
 *         `require("./spvFundStore")` (Stage 1 rewired both call sites to
 *         `require("./spvEngineStore")`)
 *   (G-7) `server/lib/seedDemoData.ts` no longer imports from `./spvFundStore`
 *         (Stage 1 repointed to spvEngineStore.createSpv)
 *   (G-8) Sacred baseline is still self-consistent (40/40)
 *
 * These are cheap static checks that catch regressions where a future edit
 * accidentally re-imports `spvFundStore` into the route or seed layer.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(__dirname, "..", "..");
const ROUTES_TS = path.join(ROOT, "server", "routes.ts");
const ADAPTER_TS = path.join(ROOT, "server", "spvLegacyAdapters.ts");
const ENGINE_TS = path.join(ROOT, "server", "spvEngineStore.ts");
const HYDRATE_TS = path.join(ROOT, "server", "lib", "hydrateStores.ts");
const WORKSPACE_TS = path.join(ROOT, "server", "partnerWorkspaceStore.ts");
const SEED_TS = path.join(ROOT, "server", "lib", "seedDemoData.ts");
const SACRED_MANIFEST = path.join(ROOT, "sacred_baseline", "SACRED_SHA256.txt");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

describe("Wave B (v26.4.0) Stage 2 — Retirement guard", () => {
  /* ---------- G-1: routes.ts no longer imports from spvFundStore ---------- */
  it("(G-1) server/routes.ts does NOT import from './spvFundStore'", () => {
    const src = read(ROUTES_TS);
    // Match either a plain import or a dynamic require. Grep-tolerant regex.
    const badImport = /import\s+.*\s+from\s+["']\.\/spvFundStore["']/;
    const badRequire = /require\s*\(\s*["']\.\/spvFundStore["']\s*\)/;
    expect(src).not.toMatch(badImport);
    expect(src).not.toMatch(badRequire);
  });

  /* ---------- G-2: routes.ts no longer calls registerSpvFundRoutes(app) ---------- */
  it("(G-2) server/routes.ts does NOT call registerSpvFundRoutes(app) as a live registration", () => {
    const src = read(ROUTES_TS);
    // Strip comments so a comment referencing the historical call doesn't false-positive.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/registerSpvFundRoutes\s*\(\s*app\s*\)/);
  });

  /* ---------- G-3: adapter file exists and exports registerSpvLegacyAdapterRoutes ---------- */
  it("(G-3) server/spvLegacyAdapters.ts exists and exports registerSpvLegacyAdapterRoutes", () => {
    expect(fs.existsSync(ADAPTER_TS)).toBe(true);
    const src = read(ADAPTER_TS);
    expect(src).toMatch(/^export\s+function\s+registerSpvLegacyAdapterRoutes\s*\(/m);
  });

  /* ---------- G-4: routes.ts imports AND calls registerSpvLegacyAdapterRoutes ---------- */
  it("(G-4) server/routes.ts imports and calls registerSpvLegacyAdapterRoutes(app)", () => {
    const src = read(ROUTES_TS);
    expect(src).toMatch(
      /import\s*\{\s*registerSpvLegacyAdapterRoutes\s*\}\s*from\s*["']\.\/spvLegacyAdapters["']/,
    );
    // Strip comments before verifying the live call
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).toMatch(/registerSpvLegacyAdapterRoutes\s*\(\s*app\s*\)/);
  });

  /* ---------- G-5: the ONLY remaining spvFundStore imports are documented ---------- */
  it("(G-5) The whitelist of files that may import from spvFundStore is exactly {hydrateStores, spvEngineStore}", () => {
    // Walk server/**/*.ts and collect every file that imports/requires spvFundStore.
    // (Test files under __tests__ are exempt — they exercise the store as an
    //  internal implementation module, which is legitimate.)
    const offenders: string[] = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(p);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (entry.name.endsWith(".d.ts")) continue;
        // Skip the retiring file itself.
        if (p === path.join(ROOT, "server", "spvFundStore.ts")) continue;
        const src = fs.readFileSync(p, "utf8");
        // Match either static import or dynamic require of ./spvFundStore.
        const importRe = /import\s+[^;]*\s+from\s+["'][^"']*\/spvFundStore["']/;
        const requireRe = /require\s*\(\s*["'][^"']*\/spvFundStore["']\s*\)/;
        if (importRe.test(src) || requireRe.test(src)) {
          offenders.push(path.relative(ROOT, p));
        }
      }
    }
    walk(path.join(ROOT, "server"));

    // Expected whitelist (paths relative to project ROOT).
    const WHITELIST = new Set([
      "server/lib/hydrateStores.ts",
      "server/spvEngineStore.ts",
    ]);

    const unexpected = offenders.filter((f) => !WHITELIST.has(f));
    expect(unexpected, `Unexpected spvFundStore importers: ${unexpected.join(", ")}`).toEqual([]);

    // And every WHITELIST entry must actually be present — otherwise Stage 2
    // regressed by removing an intended import.
    for (const wl of WHITELIST) {
      expect(offenders, `Missing expected importer: ${wl}`).toContain(wl);
    }
  });

  /* ---------- G-6: partnerWorkspaceStore has NO runtime require to engine or fund stores ---------- */
  //
  // v26.4.0-fix2 (Opus DEFECT-12) update: the dual shadow-persist was MOVED
  // to spvEngineStore.createSpv / .subscribe (the actual LIVE paths). The
  // partnerWorkspaceStore methods that once carried the requires
  // (partnerSpvStore.create / .addPosition) are dead per
  // spvUnifiedCanonical.test.ts:148, so we no longer need the requires here.
  //
  // G-6 now asserts BOTH negative: no requires to spvFundStore OR
  // spvEngineStore in partnerWorkspaceStore.ts. This closes G-5's failure
  // ('partnerWorkspaceStore.ts' unexpected in the whitelist) and prevents a
  // future refactor from silently re-introducing the coupling.
  it("(G-6) server/partnerWorkspaceStore.ts has NO runtime require to spvFundStore OR spvEngineStore", () => {
    const src = read(WORKSPACE_TS);
    // Strip comments so a comment referencing the historical requires doesn't
    // false-positive.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/require\s*\(\s*["']\.\/spvFundStore["']\s*\)/);
    expect(stripped).not.toMatch(/require\s*\(\s*["']\.\/spvEngineStore["']\s*\)/);
  });

  /* ---------- G-7: seedDemoData no longer imports from spvFundStore ---------- */
  it("(G-7) server/lib/seedDemoData.ts does NOT import from '../spvFundStore'", () => {
    const src = read(SEED_TS);
    expect(src).not.toMatch(
      /import\s+.*\s+from\s+["']\.\.\/spvFundStore["']/,
    );
    // And POSITIVE assertion — repointed to spvEngineStore
    expect(src).toMatch(/from\s+["']\.\.\/spvEngineStore["']/);
  });

  /* ---------- G-8: Sacred manifest still 40/40 ---------- */
  it("(G-8) Sacred baseline is self-consistent (40/40)", () => {
    const manifest = fs.readFileSync(SACRED_MANIFEST, "utf8");
    const lines = manifest
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    let ok = 0;
    let total = 0;
    const mismatches: string[] = [];
    for (const line of lines) {
      // Format: "<sha> <filepath>" (whitespace-delimited)
      const m = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
      if (!m) continue;
      total++;
      const [, expected, rel] = m;
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) {
        mismatches.push(`${rel} — file missing`);
        continue;
      }
      const actual = sha256File(abs);
      if (actual === expected) {
        ok++;
      } else {
        mismatches.push(`${rel} — expected ${expected.slice(0, 12)}… got ${actual.slice(0, 12)}…`);
      }
    }
    expect(total).toBe(40); // Baseline size invariant
    expect(mismatches).toEqual([]);
    expect(ok).toBe(40);
  });
});

/* ============================================================
 * Bonus — Wave B additions are actually present (not just no-diff)
 * ============================================================ */

describe("Wave B (v26.4.0) Stage 2 — Positive assertions on new code", () => {
  it("Engine exports all 11 Stage 2 adapter methods", () => {
    const src = read(ENGINE_TS);
    const expected = [
      "engineAddCommitment",
      "engineTransitionCommitment",
      "engineRecordCapitalCall",
      "engineRecordDistribution",
      "engineRecordLegacyPosition",
      "engineListLegacyCommitments",
      "engineListCapitalCalls",
      "engineListLegacyDistributions",
      "engineListLegacyPositions",
      "engineReconcileLegacySpv",
      "engineGetLegacySpvById",
    ];
    for (const name of expected) {
      expect(src, `missing export: ${name}`).toMatch(
        new RegExp(`^\\s*export\\s+function\\s+${name}\\s*\\(`, "m"),
      );
    }
  });

  it("Engine exports Wave B Stage 1 shadow-persist helpers", () => {
    const src = read(ENGINE_TS);
    expect(src).toMatch(/^\s*export\s+function\s+shadowPersistPartnerSpvToEngine\s*\(/m);
    expect(src).toMatch(/^\s*export\s+function\s+shadowCommitmentToEngine\s*\(/m);
  });

  it("adminKpiDbReads exports the 3 new SPV KPI functions", () => {
    const src = read(path.join(ROOT, "server", "lib", "adminKpiDbReads.ts"));
    expect(src).toMatch(/^\s*export\s+function\s+dbTotalSpvCommittedMinor\s*\(/m);
    expect(src).toMatch(/^\s*export\s+function\s+dbTotalSpvWiredMinor\s*\(/m);
    expect(src).toMatch(/^\s*export\s+function\s+dbTotalActiveSpvs\s*\(/m);
  });

  it("Migration 0125 exists at both sites and is byte-identical", () => {
    const a = path.join(ROOT, "migrations", "0125_wave_b_backups.sql");
    const b = path.join(ROOT, "server", "db", "migrations", "0125_wave_b_backups.sql");
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    expect(sha256File(a)).toBe(sha256File(b));
  });

  it("Version was bumped to 26.4.0", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.version).toBe("26.4.0");
  });
});

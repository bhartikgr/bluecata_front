#!/usr/bin/env tsx
/**
 * scripts/silent-drop-guard/guard.ts
 *
 * Anti-Silent-Drop Build Guard — CLI entry (v26.1.x, pre-wave).
 *
 * The "presence" analog of the sacred byte-check. It hard-fails the build when
 * PRIMARY FUNCTIONALITY (server routes, client routes/pages, shell nav entries)
 * present in the committed baseline has DISAPPEARED and has NOT been explicitly
 * approved for removal via the checked-in allow-list.
 *
 *   DISAPPEARED = baseline − current − allowlist
 *
 * If DISAPPEARED is non-empty → print a grouped report naming every dropped
 * identifier and exit(1). Otherwise print a green summary and exit(0). ADDED
 * items are reported for information only and NEVER fail.
 *
 * Flags:
 *   --update-baseline   Regenerate and overwrite baseline.json from the current
 *                       tree. Deliberate, logged acceptance of the current
 *                       inventory (use only after Ozan-approved changes).
 *
 * This tool is itself a no-silent-drop tool: it only ADDS files and never
 * removes any tracked functionality. ESM only — no require().
 *
 * Usage:
 *   npm run guard                    # verify current tree against baseline
 *   tsx scripts/silent-drop-guard/guard.ts --update-baseline
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { buildInventory, type Inventory } from "./extract-inventory.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Repo root is two levels up from scripts/silent-drop-guard/.
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BASELINE_PATH = path.join(__dirname, "baseline.json");
const ALLOWLIST_PATH = path.join(__dirname, "allowlist.json");

interface Baseline {
  generatedAt: string;
  gitHead: string;
  routes: string[];
  clientRoutes: string[];
  nav: string[];
}

interface AllowlistEntry {
  id: string;
  reason?: string;
  approvedBy?: string;
  date?: string;
}

interface Allowlist {
  removedRoutes: Array<string | AllowlistEntry>;
  removedClientRoutes: Array<string | AllowlistEntry>;
  removedNav: Array<string | AllowlistEntry>;
  note?: string;
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

function currentGitHead(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function toIds(entries: Array<string | AllowlistEntry> | undefined): Set<string> {
  const ids = new Set<string>();
  for (const e of entries ?? []) {
    if (typeof e === "string") ids.add(e);
    else if (e && typeof e.id === "string") ids.add(e.id);
  }
  return ids;
}

/** DISAPPEARED = baseline − current − allowlist (order-stable, sorted). */
function computeDisappeared(
  baseline: string[],
  current: string[],
  allowlisted: Set<string>,
): string[] {
  const currentSet = new Set(current);
  return baseline
    .filter((id) => !currentSet.has(id) && !allowlisted.has(id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** ADDED = current − baseline (informational only). */
function computeAdded(baseline: string[], current: string[]): string[] {
  const baselineSet = new Set(baseline);
  return current
    .filter((id) => !baselineSet.has(id))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function writeBaseline(inv: Inventory): Baseline {
  const baseline: Baseline = {
    generatedAt: new Date().toISOString(),
    gitHead: currentGitHead(),
    routes: inv.routes,
    clientRoutes: inv.clientRoutes,
    nav: inv.nav,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf-8");
  return baseline;
}

/**
 * Core guard logic. Extracted so tests can drive it deterministically with
 * synthetic baselines / inventories. Returns an exit code (0 = OK, 1 = drop)
 * and a printable report string. Does NOT call process.exit.
 */
export function runGuard(opts: {
  baseline: Baseline;
  current: Inventory;
  allowlist: Allowlist;
}): { code: 0 | 1; report: string } {
  const { baseline, current, allowlist } = opts;
  const lines: string[] = [];

  const disRoutes = computeDisappeared(baseline.routes, current.routes, toIds(allowlist.removedRoutes));
  const disClient = computeDisappeared(
    baseline.clientRoutes,
    current.clientRoutes,
    toIds(allowlist.removedClientRoutes),
  );
  const disNav = computeDisappeared(baseline.nav, current.nav, toIds(allowlist.removedNav));

  const addRoutes = computeAdded(baseline.routes, current.routes);
  const addClient = computeAdded(baseline.clientRoutes, current.clientRoutes);
  const addNav = computeAdded(baseline.nav, current.nav);

  const totalDropped = disRoutes.length + disClient.length + disNav.length;
  const totalAdded = addRoutes.length + addClient.length + addNav.length;

  // Informational: additions never fail the build.
  if (totalAdded > 0) {
    lines.push(`INFO: ${totalAdded} new item(s) added since baseline (informational, not a failure):`);
    if (addRoutes.length) {
      lines.push(`  + Server routes (${addRoutes.length}):`);
      for (const r of addRoutes) lines.push(`      ${r}`);
    }
    if (addClient.length) {
      lines.push(`  + Client routes/pages (${addClient.length}):`);
      for (const r of addClient) lines.push(`      ${r}`);
    }
    if (addNav.length) {
      lines.push(`  + Nav entries (${addNav.length}):`);
      for (const r of addNav) lines.push(`      ${r.replace(/\t/g, "  |  ")}`);
    }
  }

  if (totalDropped > 0) {
    lines.push("");
    lines.push("=".repeat(72));
    lines.push("SILENT DROP DETECTED — build BLOCKED");
    lines.push("=".repeat(72));
    lines.push(
      `${totalDropped} primary-functionality item(s) present in the baseline have DISAPPEARED`,
    );
    lines.push("and are NOT in the allow-list. This is a hard failure (rule #8).");
    lines.push("");
    if (disRoutes.length) {
      lines.push(`REMOVED server routes (${disRoutes.length}):`);
      for (const r of disRoutes) lines.push(`   - ${r}`);
      lines.push("");
    }
    if (disClient.length) {
      lines.push(`REMOVED client routes/pages (${disClient.length}):`);
      for (const r of disClient) lines.push(`   - ${r}`);
      lines.push("");
    }
    if (disNav.length) {
      lines.push(`REMOVED nav entries (${disNav.length}):`);
      for (const r of disNav) lines.push(`   - ${r.replace(/\t/g, "  |  ")}`);
      lines.push("");
    }
    lines.push("To resolve, either:");
    lines.push("  1. Restore the missing functionality (preferred), OR");
    lines.push(
      "  2. If the removal is intentional AND Ozan-approved, add each id above to",
    );
    lines.push(
      "     scripts/silent-drop-guard/allowlist.json (with reason/approvedBy/date), OR",
    );
    lines.push(
      "  3. Run `tsx scripts/silent-drop-guard/guard.ts --update-baseline` after approval.",
    );
    return { code: 1, report: lines.join("\n") };
  }

  lines.push(
    `OK: ${current.routes.length} routes, ${current.clientRoutes.length} pages, ${current.nav.length} nav — no silent drops`,
  );
  return { code: 0, report: lines.join("\n") };
}

function main(): void {
  const argv = process.argv.slice(2);
  const current = buildInventory(REPO_ROOT);

  if (argv.includes("--update-baseline")) {
    const b = writeBaseline(current);
    console.log(
      `baseline.json updated from current tree @ ${b.gitHead}: ` +
        `${b.routes.length} routes, ${b.clientRoutes.length} pages, ${b.nav.length} nav`,
    );
    process.exit(0);
  }

  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(
      `ERROR: baseline.json missing at ${BASELINE_PATH}. ` +
        `Generate it with: tsx scripts/silent-drop-guard/guard.ts --update-baseline`,
    );
    process.exit(1);
  }

  const baseline = readJson<Baseline>(BASELINE_PATH);
  const allowlist = fs.existsSync(ALLOWLIST_PATH)
    ? readJson<Allowlist>(ALLOWLIST_PATH)
    : { removedRoutes: [], removedClientRoutes: [], removedNav: [] };

  const { code, report } = runGuard({ baseline, current, allowlist });
  if (code === 0) console.log(report);
  else console.error(report);
  process.exit(code);
}

// Only run the CLI when executed directly (not when imported by tests).
const isDirectRun = (() => {
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return invoked === __filename;
})();
if (isDirectRun) {
  main();
}

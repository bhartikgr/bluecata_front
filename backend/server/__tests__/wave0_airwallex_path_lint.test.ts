/**
 * Wave 0 deliverable 0-13 — Airwallex path lint.
 *
 * Enforces the frozen Airwallex path list checked in at
 * `wave0/AIRWALLEX_PATH.txt`. Every file that matches `grep -l airwallex`
 * across `server/`, `shared/`, `client/` must be on either the tiered path
 * list OR the exclusion list. A grep-matching file on neither list is a
 * new file that has not been triaged. A path-list entry that no longer
 * exists is a stale entry.
 *
 * Sourced from ENGINEERING_REPORT_V7.md §7.1.1. Owner's standing rule:
 * "no Airwallex integration code is modified in this programme, and any
 * wave that would require it stops and escalates."
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PATH_LIST = resolve(REPO_ROOT, "wave0", "AIRWALLEX_PATH.txt");

interface AirwallexEntry {
  tier: string; // "1"–"5" or "X"
  path: string;
  reason?: string;
}

function parsePathList(): AirwallexEntry[] {
  const text = readFileSync(PATH_LIST, "utf8");
  const entries: AirwallexEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("|");
    if (parts.length < 2) continue;
    entries.push({
      tier: parts[0].trim(),
      path: parts[1].trim(),
      reason: parts[2]?.trim(),
    });
  }
  return entries;
}

function grepAirwallexFiles(): string[] {
  // Use grep -l on the tracked source directories only. Exclude
  // node_modules, dist, and any docs directory.
  try {
    const out = execSync(
      `grep -rl -i "airwallex" server/ shared/ client/ 2>/dev/null || true`,
      { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((p) => !p.includes("node_modules"))
      .filter((p) => !p.endsWith(".test.ts") && !p.endsWith(".test.tsx"))
      .filter((p) => !p.endsWith(".test.mjs") && !p.endsWith("_e2e.mjs"))
      .filter((p) => !p.includes("__tests__/")) // test fixture files
      .filter((p) => !p.includes("server/public/")) // built client bundles
      .filter((p) => !p.includes("/dist/")) // any dist output
      .filter((p) => !p.includes("/migrations/")) // gated by ADR-6 mirror-drift, not this list
      .sort();
  } catch {
    return [];
  }
}

describe("Wave 0 deliverable 0-13 — Airwallex path lint", () => {
  it("wave0/AIRWALLEX_PATH.txt exists and parses cleanly", () => {
    expect(existsSync(PATH_LIST)).toBe(true);
    const entries = parsePathList();
    expect(entries.length).toBeGreaterThan(0);
    // Every entry must have a valid tier.
    for (const e of entries) {
      expect(["1", "2", "3", "4", "5", "X"]).toContain(e.tier);
      expect(e.path.length).toBeGreaterThan(0);
    }
  });

  it("every path-list entry that names a source file exists on disk", () => {
    const entries = parsePathList();
    const missing: string[] = [];
    for (const e of entries) {
      const p = resolve(REPO_ROOT, e.path);
      if (!existsSync(p)) missing.push(`[tier ${e.tier}] ${e.path}`);
    }
    // A stale path entry is a real problem — the list has rotted.
    expect(missing, `stale path list entries:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no source file matching 'airwallex' exists outside the path list", () => {
    const entries = parsePathList();
    const tracked = new Set(entries.map((e) => e.path));
    const grepped = grepAirwallexFiles();
    const untriaged = grepped.filter((p) => !tracked.has(p));
    // Any new file that mentions Airwallex must be triaged onto tier 1-5 or
    // onto the exclusion list. Fail if any grep-matching file is unclassified.
    expect(
      untriaged,
      `Files matching 'airwallex' but not on wave0/AIRWALLEX_PATH.txt:\n${untriaged.join("\n")}\n\nTriage each onto a tier (1-5) or the exclusion list (X) with a reason.`,
    ).toEqual([]);
  });

  it("tier 1 gateway files are exactly two (owner's rule)", () => {
    const tier1 = parsePathList().filter((e) => e.tier === "1");
    expect(tier1.length).toBe(2);
    const paths = tier1.map((e) => e.path).sort();
    expect(paths).toEqual([
      "server/lib/airwallexCollective.ts",
      "server/lib/airwallexGateway.ts",
    ]);
  });
});

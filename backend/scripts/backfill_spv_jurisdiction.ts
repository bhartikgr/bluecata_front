#!/usr/bin/env node
/**
 * scripts/backfill_spv_jurisdiction.ts — WAVE 3C / J-2 (OQ-6 backfill).
 *
 * PURPOSE
 * -------
 * Reconcile the canonical `spv.jurisdiction` enum column with the GP-entered
 * `terms_json.jurisdictionCountry`. Live on capavate.com the two DISAGREE on 4
 * of 6 vehicles, because `deriveEngineJurisdiction()` (client) and the
 * `canonicalJurisdiction` fallbacks (server/partnerRoutes.ts:1639,:1760,
 * server/lib/partnerFeeAdminRoutes.ts:377) collapsed every country outside
 * US/Cayman/BVI/Canada onto "delaware". That is what put SEC Form-D copy on a
 * BVI company and a Dutch syndicate.
 *
 * WAVE 3C widens `SPV_JURISDICTIONS` so the country can be stored faithfully.
 * This script repairs the rows that were written under the old, narrow enum.
 *
 * AUTHORITY
 * ---------
 * OQ-6 (spec/OWNER_RULINGS_2026_08_09.md:11): "Backfill automatically. All
 * legacy vehicles are test entries."
 *
 * DESIGN CONSTRAINTS (deliberate)
 * -------------------------------
 *  • NOT an inline migration. It is never called from application boot and it
 *    is not registered in db/migrate.ts. Nothing in server/db/connection.ts or
 *    db/migrate.ts is imported, read or written by this file — both are sacred.
 *    The SQLite path is resolved with the SAME rules connection.ts uses
 *    (documented at server/db/connection.ts:127-146) but independently, so a
 *    run can never trigger the self-heal migration chain.
 *  • IDEMPOTENT. A second --apply run reports 0 changes: the target value is
 *    computed from the row's own terms, so once written it already matches.
 *  • REVERSIBLE. --apply writes a journal file recording (id, before, after)
 *    for every row it touched. --revert <journal> restores the before-values,
 *    and refuses any row whose current value is no longer the after-value it
 *    wrote (i.e. it will not clobber a later, deliberate edit).
 *  • CONSERVATIVE. A row is only changed when its `terms.jurisdictionCountry`
 *    resolves to a KNOWN ontology member. A missing, blank or unmappable
 *    free-text country is reported and SKIPPED — the script never guesses, and
 *    in particular never writes "delaware".
 *
 * HASH COLUMNS
 * ------------
 * `spv.prev_hash` / `spv.curr_hash` are LEFT UNTOUCHED. They form an
 * append-order chain seeded from the last row at boot
 * (server/spvEngineStore.ts:2628); rewriting one row's digest in isolation
 * would produce a chain that is internally inconsistent, and rewriting the
 * whole chain is a far larger, riskier operation than an owner-approved repair
 * of six test rows. The journal file is the audit record for this change.
 *
 * USAGE
 * -----
 *   npx tsx scripts/backfill_spv_jurisdiction.ts                  # dry-run (default)
 *   npx tsx scripts/backfill_spv_jurisdiction.ts --json           # dry-run, machine readable
 *   npx tsx scripts/backfill_spv_jurisdiction.ts --apply
 *   npx tsx scripts/backfill_spv_jurisdiction.ts --apply --journal ./j.json
 *   npx tsx scripts/backfill_spv_jurisdiction.ts --revert ./j.json
 *   npx tsx scripts/backfill_spv_jurisdiction.ts --db ./data.db   # explicit DB file
 *
 * Exit codes: 0 = success (including "nothing to do"), 1 = error / refused.
 */

import { createRequire } from "node:module";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveSpvJurisdiction, SPV_JURISDICTION_LABELS, isSpvJurisdiction } from "../shared/spvEngine";

const _require = createRequire(import.meta.url);

/* ── CLI ────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
function flagValue(name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}
const isApply = argv.includes("--apply");
const isJson = argv.includes("--json");
const revertPath = flagValue("--revert");
const journalArg = flagValue("--journal");
const dbArg = flagValue("--db");

/* ── DB path (mirrors server/db/connection.ts:127-146, minus :memory:) ──── */
function resolveDbPath(): string {
  if (dbArg) return dbArg;
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    throw new Error(
      "DATABASE_URL points at Postgres. This repair script is SQLite-only; " +
      "run the equivalent UPDATE through your Postgres tooling using the plan " +
      "this script prints in --json dry-run mode.",
    );
  }
  if (url && url.startsWith("file:")) return url.slice(5);
  if (url && url.startsWith("sqlite:")) return url.slice(7);
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  return "./data.db";
}

interface SpvRow { id: string; name: string; jurisdiction: string; terms_json: string | null; updated_at: string }

interface PlanRow {
  id: string;
  name: string;
  country: string | null;
  before: string;
  after: string;
  action: "change" | "already-correct" | "skip-no-country" | "skip-unmappable";
  reason: string;
}

interface Journal {
  script: "backfill_spv_jurisdiction";
  version: 1;
  appliedAt: string;
  dbPath: string;
  rows: Array<{ id: string; name: string; before: string; after: string }>;
}

function readTermsCountry(terms: string | null): string | null {
  if (!terms) return null;
  try {
    const t = JSON.parse(terms) as Record<string, unknown>;
    const c = t?.jurisdictionCountry;
    if (typeof c === "string" && c.trim()) return c.trim();
    // Legacy shim rows keep the original free text here instead.
    const legacy = t?.legacyJurisdiction;
    if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
    return null;
  } catch {
    return null;
  }
}

function buildPlan(rows: SpvRow[]): PlanRow[] {
  return rows.map((r) => {
    const country = readTermsCountry(r.terms_json);
    if (!country) {
      return {
        id: r.id, name: r.name, country: null, before: r.jurisdiction, after: r.jurisdiction,
        action: "skip-no-country",
        reason: "terms.jurisdictionCountry is absent — nothing authoritative to reconcile against.",
      };
    }
    const resolved = resolveSpvJurisdiction(country);
    if (resolved === "other") {
      return {
        id: r.id, name: r.name, country, before: r.jurisdiction, after: r.jurisdiction,
        action: "skip-unmappable",
        reason: `"${country}" is not in the 15-country ontology. Left as-is rather than guessed.`,
      };
    }
    if (r.jurisdiction === resolved) {
      return {
        id: r.id, name: r.name, country, before: r.jurisdiction, after: resolved,
        action: "already-correct",
        reason: "enum column already agrees with terms.jurisdictionCountry.",
      };
    }
    return {
      id: r.id, name: r.name, country, before: r.jurisdiction, after: resolved,
      action: "change",
      reason: `terms.jurisdictionCountry = "${country}" → ${SPV_JURISDICTION_LABELS[resolved]}; stored enum was "${r.jurisdiction}".`,
    };
  });
}

function openDb(path: string): any {
  if (!existsSync(path)) throw new Error(`SQLite file not found: ${path}`);
  const Database = _require("better-sqlite3");
  return new Database(path);
}

function defaultJournalPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(process.cwd(), `scripts/backfill_journals/spv_jurisdiction_${stamp}.json`);
}

/* ── revert ─────────────────────────────────────────────────────────────── */
function runRevert(path: string): number {
  const journal = JSON.parse(readFileSync(path, "utf8")) as Journal;
  if (journal.script !== "backfill_spv_jurisdiction") throw new Error(`Not a jurisdiction-backfill journal: ${path}`);
  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  const sel = db.prepare("SELECT id, jurisdiction FROM spv WHERE id = ?");
  const upd = db.prepare("UPDATE spv SET jurisdiction = ? WHERE id = ? AND jurisdiction = ?");
  const restored: string[] = [];
  const refused: Array<{ id: string; current: string; expected: string }> = [];
  const tx = db.transaction(() => {
    for (const r of journal.rows) {
      const cur = sel.get(r.id) as { id: string; jurisdiction: string } | undefined;
      if (!cur) { refused.push({ id: r.id, current: "<row missing>", expected: r.after }); continue; }
      if (cur.jurisdiction !== r.after) { refused.push({ id: r.id, current: cur.jurisdiction, expected: r.after }); continue; }
      upd.run(r.before, r.id, r.after);
      restored.push(r.id);
    }
  });
  tx();
  db.close();
  if (isJson) {
    process.stdout.write(JSON.stringify({ mode: "revert", dbPath, restored, refused }, null, 2) + "\n");
  } else {
    console.log(`revert from ${path} (db: ${dbPath})`);
    console.log(`  restored: ${restored.length}${restored.length ? ` → ${restored.join(", ")}` : ""}`);
    for (const r of refused) console.log(`  REFUSED ${r.id}: current "${r.current}" ≠ value this journal wrote ("${r.expected}") — left untouched.`);
  }
  return refused.length ? 1 : 0;
}

/* ── main ───────────────────────────────────────────────────────────────── */
function main(): number {
  if (revertPath) return runRevert(revertPath);

  const dbPath = resolveDbPath();
  const db = openDb(dbPath);
  const rows = db.prepare("SELECT id, name, jurisdiction, terms_json, updated_at FROM spv ORDER BY created_at, id").all() as SpvRow[];
  const plan = buildPlan(rows);
  const changes = plan.filter((p) => p.action === "change");

  // Every value we would write must be a valid member of the widened enum.
  for (const c of changes) {
    if (!isSpvJurisdiction(c.after)) throw new Error(`refusing to write non-enum jurisdiction "${c.after}" for ${c.id}`);
  }

  let journalPath: string | null = null;
  if (isApply && changes.length) {
    const journal: Journal = {
      script: "backfill_spv_jurisdiction",
      version: 1,
      appliedAt: new Date().toISOString(),
      dbPath,
      rows: changes.map((c) => ({ id: c.id, name: c.name, before: c.before, after: c.after })),
    };
    journalPath = journalArg ? resolve(journalArg) : defaultJournalPath();
    mkdirSync(dirname(journalPath), { recursive: true });
    // Journal FIRST, so an interrupted run is still revertible.
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));

    // Guarded UPDATE: the WHERE clause pins the expected before-value, so a
    // concurrent writer cannot be silently overwritten, and a re-run is a no-op.
    const upd = db.prepare("UPDATE spv SET jurisdiction = ? WHERE id = ? AND jurisdiction = ?");
    const tx = db.transaction(() => { for (const c of changes) upd.run(c.after, c.id, c.before); });
    tx();
  }
  db.close();

  const summary = {
    mode: isApply ? "apply" : "dry-run",
    dbPath,
    journalPath,
    totals: {
      scanned: plan.length,
      changed: isApply ? changes.length : 0,
      wouldChange: changes.length,
      alreadyCorrect: plan.filter((p) => p.action === "already-correct").length,
      skippedNoCountry: plan.filter((p) => p.action === "skip-no-country").length,
      skippedUnmappable: plan.filter((p) => p.action === "skip-unmappable").length,
    },
    rows: plan,
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return 0;
  }

  console.log(`SPV jurisdiction reconciliation — ${summary.mode} (db: ${dbPath})`);
  console.log(`scanned ${summary.totals.scanned} vehicle(s)\n`);
  for (const p of plan) {
    const mark = p.action === "change" ? (isApply ? "CHANGED" : "WOULD CHANGE") : p.action.toUpperCase();
    console.log(`  [${mark}] ${p.id} — ${p.name}`);
    console.log(`      jurisdiction: "${p.before}"${p.action === "change" ? ` → "${p.after}"` : ""}`);
    console.log(`      ${p.reason}`);
  }
  console.log(
    `\nwould change ${summary.totals.wouldChange} · already correct ${summary.totals.alreadyCorrect} · ` +
    `skipped ${summary.totals.skippedNoCountry + summary.totals.skippedUnmappable}`,
  );
  if (journalPath) console.log(`journal (revert with --revert): ${journalPath}`);
  if (!isApply && changes.length) console.log("dry-run only — re-run with --apply to write.");
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  console.error(`[backfill_spv_jurisdiction] ${(e as Error).message}`);
  process.exitCode = 1;
}

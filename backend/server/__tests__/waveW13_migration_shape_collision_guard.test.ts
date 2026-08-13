/**
 * WAVE 13 — PERMANENT GUARD: no table may be created by more than one migration
 * with a different column set unless the divergence is RECONCILED.
 *
 * THE DEFECT THIS PINS
 *   `migrations/0153_wave5_money_captable.sql` creates `partner_subscription`
 *   with (partner_id, cadence, period_start, …). `migrations/0167_wave11_
 *   partner_subscription_engine.sql` creates it AGAIN with (subject_kind,
 *   subject_id, cycle, current_period_*, …). Because both use
 *   `CREATE TABLE IF NOT EXISTS` and 0153 sorts first, 0167's CREATE is a
 *   silent no-op; the runner then downgrades 0167's two subject-keyed
 *   CREATE INDEX statements to "skipped perf index" WARNINGS
 *   (server/db/migrate.ts:isNonFatalIndexError) and the chain exits 0. Nothing
 *   in review or in CI said a word, while every consumer of `subject_kind` was
 *   pointed at a column that does not exist on a fresh database.
 *
 * THE RULE
 *   For every table declared by 2+ migrations with DIFFERING column sets, the
 *   shape that actually lands after applying the whole chain MUST equal the
 *   LAST declaration. That is what "reconciled" means: a later migration
 *   (0169 for partner_subscription) rebuilds the table into the declared shape
 *   instead of leaving the first declaration silently winning.
 *
 *   Twelve such collisions predate this wave (0002 vs 0020, 0000 vs 0123, …).
 *   They are PINNED in KNOWN_UNRECONCILED below with a digest of both declared
 *   column sets, so they cannot grow, drift, or be joined by a new one without
 *   this test failing. `partner_subscription` is deliberately NOT pinnable —
 *   test 3 fails if anybody tries.
 *
 * FALSIFICATION (build_log/WAVE13_REPORT.md records the raw output)
 *   Run against the tree BEFORE migration 0169 existed: test 1 FAILS naming
 *   partner_subscription, expected subject_kind/subject_id/cycle and got
 *   partner_id/cadence. After 0169 it passes. The guard detects the very bug it
 *   was written for.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import {
  findShapeCollisions,
  listMigrationFiles,
  fingerprint,
  type ShapeCollision,
} from "../lib/migrationTableShapeIndex";
import { splitStatements } from "../db/migrate";

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(ROOT, "migrations");
const MIRROR = path.join(ROOT, "server", "db", "migrations");

/**
 * Collisions that predate WAVE 13 and are NOT reconciled. Each is pinned by the
 * exact declaring files plus a digest over both declared column sets, so:
 *   • a NEW collision is not covered and fails test 1;
 *   • a CHANGE to one of these shapes breaks its digest and fails test 2.
 * Nothing here is endorsed — it is quarantined, with the reason it is out of
 * scope for this wave (all twelve are 2024-era baseline-vs-feature duplicates
 * that predate the numbered runner and carry live production data).
 */
const KNOWN_UNRECONCILED: Array<{ table: string; files: string[]; digest: string }> = [
  { table: "chapters", files: ["0002_slow_medusa.sql", "0020_chapters.sql"], digest: "bdfa2d628e2dff0c" },
  { table: "collective_waitlist", files: ["0002_slow_medusa.sql", "0017_collective_waitlist.sql"], digest: "1df8053f439a733f" },
  { table: "dsc_feedback", files: ["0002_slow_medusa.sql", "0018_dsc_feedback.sql"], digest: "87b03d7fba2520d2" },
  { table: "dsc_votes", files: ["0002_slow_medusa.sql", "0019_dsc_votes.sql"], digest: "a64c4e4ad77394b0" },
  { table: "founder_tiers", files: ["0002_slow_medusa.sql", "0004_company_profile_extended.sql"], digest: "a3ba6b4663cefe1e" },
  { table: "investor_nominations", files: ["0002_slow_medusa.sql", "0025_investor_nominations.sql"], digest: "b8e16b3a880aafce" },
  { table: "partner_crm_contacts", files: ["0002_slow_medusa.sql", "0038_partner_workspace_db_migration.sql"], digest: "2246a1272e99d237" },
  { table: "partner_deal_pipeline", files: ["0002_slow_medusa.sql", "0038_partner_workspace_db_migration.sql"], digest: "b285152e9c28e8a7" },
  { table: "partner_deal_promotions", files: ["0002_slow_medusa.sql", "0029_partner_deal_promotions.sql"], digest: "e696cc3c741f1b09" },
  { table: "platform_config", files: ["0000_numerous_roxanne_simpson.sql", "0123_wave0_platform_config.sql"], digest: "5419e71644f2ac33" },
  { table: "rounds", files: ["0000_numerous_roxanne_simpson.sql", "0014_rounds.sql"], digest: "3315c502ece37d75" },
  { table: "tenants", files: ["0000_numerous_roxanne_simpson.sql", "0002_v12_tenants_softdelete.sql"], digest: "3ecdd02a65ec33bf" },
];

/** Pre-existing mirror-only files (out of scope for WAVE 13, pinned so the set cannot grow). */
const MIRROR_ONLY_LEGACY = [
  "0001_sprint17_sync_and_auth.sql",
  "0002_sprint18_phase2.sql",
  "0092_v25_51_founder_crm_first_last_company.sql",
  "0093_v25_51_name_split_phase1.sql",
  "0095_v25_51_name_split_phase4.sql",
];

function collisionDigest(c: ShapeCollision): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(c.declarations.map((d) => [d.file, d.columns])))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Apply every migration into a brand-new in-memory database and return the
 * resulting column set per table.
 *
 * Statement-level errors are COLLECTED, not thrown: seven migrations (0040,
 * 0096, 0099, 0123, 0130, 0131, 0136) depend on tables the SACRED
 * server/db/connection.ts bootstrap creates rather than on earlier migrations,
 * so a bare chain apply legitimately cannot satisfy them. That is pre-existing
 * and out of scope; what matters here is the SHAPE that survives.
 */
function applyChain(): { shapes: Map<string, string[]>; errors: Array<{ file: string; message: string }> } {
  const require_ = createRequire(path.join(ROOT, "_"));
  const Better = require_("better-sqlite3");
  const db = new Better(":memory:");
  const errors: Array<{ file: string; message: string }> = [];
  for (const file of listMigrationFiles(MIGRATIONS)) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const stmt of splitStatements(sql)) {
      try {
        db.exec(stmt);
      } catch (err) {
        errors.push({ file, message: (err as Error).message });
      }
    }
  }
  const shapes = new Map<string, string[]>();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>;
  for (const t of tables) {
    const cols = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t.name) as Array<{
      name: string;
    }>;
    shapes.set(
      t.name,
      cols.map((c) => c.name).sort(),
    );
  }
  db.close();
  return { shapes, errors };
}

describe("WAVE 13 — migration table-shape collision guard", () => {
  const collisions = findShapeCollisions(MIGRATIONS);
  const { shapes } = applyChain();

  it("1: every differing duplicate CREATE TABLE is reconciled to its LAST declaration", () => {
    const violations: string[] = [];
    for (const c of collisions) {
      const last = c.declarations[c.declarations.length - 1];
      const actual = shapes.get(c.table);
      const reconciled = actual !== undefined && fingerprint(actual) === fingerprint(last.columns);
      if (reconciled) continue;
      const pinned = KNOWN_UNRECONCILED.find((k) => k.table === c.table);
      if (pinned) continue;
      violations.push(
        `${c.table}: declared by ${c.declarations.map((d) => d.file).join(" then ")}; ` +
          `LAST declaration (${last.file}) wants [${last.columns.join(", ")}] ` +
          `but the applied chain ends with [${(actual ?? ["<table absent>"]).join(", ")}]. ` +
          `CREATE TABLE IF NOT EXISTS silently discarded the later shape.`,
      );
    }
    expect(violations, `unreconciled schema collisions:\n  ${violations.join("\n  ")}`).toEqual([]);
  });

  it("2: the pre-existing-collision allowlist is exact — no stale entries, no drifted shapes", () => {
    const problems: string[] = [];
    for (const pin of KNOWN_UNRECONCILED) {
      const c = collisions.find((x) => x.table === pin.table);
      if (!c) {
        problems.push(`${pin.table}: pinned as an unreconciled collision but is no longer one — delete the pin.`);
        continue;
      }
      const files = c.declarations.map((d) => d.file);
      if (JSON.stringify(files) !== JSON.stringify(pin.files)) {
        problems.push(`${pin.table}: declaring files changed — pinned ${pin.files.join(",")}, found ${files.join(",")}`);
      }
      const digest = collisionDigest(c);
      if (digest !== pin.digest) {
        problems.push(
          `${pin.table}: declared column sets changed (digest ${pin.digest} → ${digest}). ` +
            `Either reconcile the table or re-pin deliberately.`,
        );
      }
    }
    expect(problems, `allowlist drift:\n  ${problems.join("\n  ")}`).toEqual([]);
  });

  it("3: partner_subscription is never allowed into the allowlist", () => {
    expect(KNOWN_UNRECONCILED.map((k) => k.table)).not.toContain("partner_subscription");
    // And it must really still be a collision the guard is watching (0153 vs
    // 0167 vs the 0169 reconciliation) — otherwise test 1 would pass vacuously.
    const c = collisions.find((x) => x.table === "partner_subscription");
    expect(c, "partner_subscription must remain in the collision index").toBeTruthy();
    const last = c!.declarations[c!.declarations.length - 1];
    expect(last.columns).toContain("subject_kind");
    expect(last.columns).toContain("subject_id");
    expect(last.columns).toContain("cycle");
    expect(shapes.get("partner_subscription")).toEqual(last.columns);
  });

  it("4: migrations/ and server/db/migrations/ agree byte-for-byte on every shared file", () => {
    const drift: string[] = [];
    for (const f of listMigrationFiles(MIRROR)) {
      const a = path.join(MIGRATIONS, f);
      if (!fs.existsSync(a)) {
        // Five files exist only in the mirror and predate this wave (they were
        // applied from server/db/migrations before `migrations/` became the
        // runner's default dir). Pinned so a SIXTH one is caught here.
        if (!MIRROR_ONLY_LEGACY.includes(f)) {
          drift.push(`${f}: present in server/db/migrations but missing from migrations/ (unpinned)`);
        }
        continue;
      }
      if (fs.readFileSync(a, "utf8") !== fs.readFileSync(path.join(MIRROR, f), "utf8")) {
        drift.push(`${f}: mirrors differ`);
      }
    }
    expect(drift, `mirror drift:\n  ${drift.join("\n  ")}`).toEqual([]);
  });
});

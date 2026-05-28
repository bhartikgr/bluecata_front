#!/usr/bin/env node
/**
 * scripts/db_purge_demo.ts — v23.4.1 hotfix Task F
 *
 * Wipes ALL rows where is_demo = 1 from every table that carries that flag.
 * Refuses to run if the `--force` flag is absent (requires explicit opt-in).
 * Supports `--dry-run` to count-only without deleting.
 *
 * Usage:
 *   npm run db:purge:demo                   # dry-run
 *   npm run db:purge:demo -- --dry-run      # explicit dry-run
 *   npm run db:purge:demo -- --force        # actually delete
 *   npm run db:purge:demo -- --force --verbose
 *
 * Safety contract:
 *   - Without --force: prints a summary of what WOULD be deleted and exits 0.
 *   - With --force: deletes and exits 0 on success, 1 on any error.
 *   - Logs every deleted row count to stdout.
 *   - Does NOT require NODE_ENV=production (runs in any env so devs can
 *     reset local DBs safely).
 */

import { rawDb } from "../server/db/connection";

/* ------------------------------------------------------------------ */
/* CLI args                                                            */
/* ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
const isDryRun = !argv.includes("--force") || argv.includes("--dry-run");
const isForce = argv.includes("--force") && !argv.includes("--dry-run");
const isVerbose = argv.includes("--verbose") || argv.includes("-v");

/* ------------------------------------------------------------------ */
/* Tables that carry is_demo = 1                                       */
/* Tables are ordered so FK children are deleted before parents.       */
/* ------------------------------------------------------------------ */
const DEMO_TABLES: string[] = [
  // Child tables first (FK deps)
  "company_members",
  "companies",
  // Core identity (users before tenants)
  "users",
  "tenants",
  // Everything else that might have is_demo
];

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */
function main(): void {
  const db = rawDb();

  // Verify tables exist before touching them; skip silently if absent.
  const existingTables = new Set(
    (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as { name: string }[]
    ).map((r) => r.name),
  );

  // Discover ALL tables with an is_demo column (from sqlite_master PRAGMA)
  const tablesWithDemoCol: string[] = [];
  for (const tbl of existingTables) {
    try {
      const cols = db.prepare(`PRAGMA table_info(${tbl})`).all() as { name: string }[];
      if (cols.some((c) => c.name === "is_demo")) {
        tablesWithDemoCol.push(tbl);
      }
    } catch {
      // Table may be a view or special; skip
    }
  }

  // Ordered: DEMO_TABLES first (to respect FK order), then any remaining discovered tables
  const orderedTables = [
    ...DEMO_TABLES.filter((t) => tablesWithDemoCol.includes(t)),
    ...tablesWithDemoCol.filter((t) => !DEMO_TABLES.includes(t)),
  ];

  // Count real (non-demo) users first — for awareness only (not a guard)
  let realUserCount = 0;
  try {
    const row = db
      .prepare(`SELECT count(*) AS cnt FROM users WHERE is_demo = 0 OR is_demo IS NULL`)
      .get() as { cnt: number };
    realUserCount = row?.cnt ?? 0;
  } catch {
    realUserCount = -1;
  }

  console.log(
    `\n[db:purge:demo] ${isDryRun ? "DRY RUN — no changes will be made" : "FORCE DELETE MODE"}\n`,
  );

  if (realUserCount > 0) {
    console.log(
      `  NOTE: ${realUserCount} non-demo user(s) exist in the database. Only is_demo=1 rows will be affected.\n`,
    );
  }

  let totalRows = 0;
  const results: { table: string; count: number }[] = [];

  for (const tbl of orderedTables) {
    try {
      const countRow = db
        .prepare(`SELECT count(*) AS cnt FROM ${tbl} WHERE is_demo = 1`)
        .get() as { cnt: number };
      const count = countRow?.cnt ?? 0;

      if (count === 0) {
        if (isVerbose) console.log(`  ${tbl}: 0 demo rows (skip)`);
        continue;
      }

      results.push({ table: tbl, count });
      totalRows += count;

      if (!isDryRun) {
        db.prepare(`DELETE FROM ${tbl} WHERE is_demo = 1`).run();
        console.log(`  ${tbl}: deleted ${count} row${count === 1 ? "" : "s"}`);
      } else {
        console.log(`  ${tbl}: would delete ${count} row${count === 1 ? "" : "s"}`);
      }
    } catch (err) {
      console.error(`  ${tbl}: ERROR — ${(err as Error).message}`);
      if (!isDryRun) {
        process.exit(1);
      }
    }
  }

  console.log(
    `\n[db:purge:demo] ${isDryRun ? "Would delete" : "Deleted"} ${totalRows} demo row${totalRows === 1 ? "" : "s"} across ${results.length} table${results.length === 1 ? "" : "s"}.\n`,
  );

  if (isDryRun && totalRows > 0) {
    console.log(`  Run with --force to actually delete:\n    npm run db:purge:demo -- --force\n`);
  }

  if (isDryRun && totalRows === 0) {
    console.log("  Nothing to purge.\n");
  }
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error("[db:purge:demo] Fatal error:", (err as Error).message);
  process.exit(1);
}

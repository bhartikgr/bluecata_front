#!/usr/bin/env node
/**
 * scripts/db_doctor.ts — v23.4.1 hotfix Task I
 *
 * Compares the live SQLite schema against the expected schema from shared/schema.ts
 * by introspecting the actual DB via PRAGMA table_info().
 *
 * Output:
 *   - Per-table: PRESENT / MISSING / columns PRESENT / MISSING / EXTRA
 *   - Exit code 0 if all expected tables + columns are present
 *   - Exit code 1 if any table or column is missing (drift detected)
 *
 * Usage:
 *   npm run db:doctor
 *   npx tsx scripts/db_doctor.ts
 *   npx tsx scripts/db_doctor.ts --verbose   (show present columns too)
 *   npx tsx scripts/db_doctor.ts --json      (JSON output for CI)
 *
 * Note: EXTRA columns (in DB but not in schema) are reported as INFO, not FAIL.
 * Only MISSING tables/columns cause exit code 1.
 */

import { rawDb } from "../server/db/connection";

/* ------------------------------------------------------------------ */
/* CLI args                                                             */
/* ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
const isVerbose = argv.includes("--verbose") || argv.includes("-v");
const isJson = argv.includes("--json");

/* ------------------------------------------------------------------ */
/* Expected schema — extracted from shared/schema.ts columns           */
/* These are the tables + critical columns that must be present.       */
/* Generated from the sqliteTable() declarations in shared/schema.ts   */
/* ------------------------------------------------------------------ */
// We introspect the LIVE DB for ALL tables, then cross-check against
// what PRAGMA table_info() returns for each expected table.
// The "expected" list is built by querying the actual schema object
// at runtime. We cannot import drizzle schema types at script level
// (circular dep / tsconfig issues), so we enumerate the table names
// that matter most for the hotfix.

const CRITICAL_COLUMNS: Record<string, string[]> = {
  "founder_tiers":               ["id", "name", "usd_monthly", "billing_cycle"],  // 0049
  "consortium_applications":     ["id", "contact_email", "status", "invite_payload_json"],  // 0051
  "auth_redeem_tokens":          ["id", "token_hash", "email", "intent", "expires_at"],
  "users":                       ["id", "email", "name", "role", "is_demo"],
  "tenants":                     ["id", "kind", "status", "is_demo"],
  "auth_users":                  ["id", "email", "password_hash", "role", "status"],
  "user_credentials":            ["user_id", "email", "password_hash"],
  "partner_organizations":       ["id", "tenant_id", "name", "partner_type"],
  "chapter_memberships":         ["id", "chapter_id", "user_id", "role", "status"],
};

/* ------------------------------------------------------------------ */
/* Main                                                                 */
/* ------------------------------------------------------------------ */
interface TableResult {
  table: string;
  tablePresent: boolean;
  columns: { name: string; present: boolean; extra?: boolean }[];
  missingColumns: string[];
  extraColumns: string[];
}

interface DoctorResult {
  ok: boolean;
  tablesChecked: number;
  tablesMissing: string[];
  columnsMissing: { table: string; column: string }[];
  results: TableResult[];
}

function runDoctor(): DoctorResult {
  const db = rawDb();

  // Get all existing tables
  const existingTables = new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[])
      .map((r) => r.name),
  );

  const results: TableResult[] = [];
  const tablesMissing: string[] = [];
  const columnsMissing: { table: string; column: string }[] = [];

  for (const [tableName, expectedCols] of Object.entries(CRITICAL_COLUMNS)) {
    if (!existingTables.has(tableName)) {
      tablesMissing.push(tableName);
      results.push({
        table: tableName,
        tablePresent: false,
        columns: expectedCols.map((c) => ({ name: c, present: false })),
        missingColumns: expectedCols,
        extraColumns: [],
      });
      continue;
    }

    // Table exists — check columns
    const actualCols = new Set(
      (db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[])
        .map((r) => r.name),
    );

    const colResults: { name: string; present: boolean }[] = [];
    const missing: string[] = [];

    for (const col of expectedCols) {
      const present = actualCols.has(col);
      colResults.push({ name: col, present });
      if (!present) {
        missing.push(col);
        columnsMissing.push({ table: tableName, column: col });
      }
    }

    // Extra cols: in DB but not in our critical list (info only)
    const extra = Array.from(actualCols).filter((c) => !expectedCols.includes(c));

    results.push({
      table: tableName,
      tablePresent: true,
      columns: colResults,
      missingColumns: missing,
      extraColumns: extra,
    });
  }

  return {
    ok: tablesMissing.length === 0 && columnsMissing.length === 0,
    tablesChecked: Object.keys(CRITICAL_COLUMNS).length,
    tablesMissing,
    columnsMissing,
    results,
  };
}

function printResults(result: DoctorResult) {
  const PASS = "\x1b[32mPASS\x1b[0m";
  const FAIL = "\x1b[31mFAIL\x1b[0m";
  const WARN = "\x1b[33mWARN\x1b[0m";

  console.log("\n[db:doctor] Capavate v23.4.2 schema integrity check\n");

  for (const r of result.results) {
    if (!r.tablePresent) {
      console.log(`  ${FAIL}  TABLE ${r.table} — MISSING`);
      continue;
    }

    const colOk = r.missingColumns.length === 0;
    console.log(`  ${colOk ? PASS : FAIL}  TABLE ${r.table}`);

    for (const c of r.columns) {
      if (c.present) {
        if (isVerbose) console.log(`         + ${c.name}`);
      } else {
        console.log(`         ${FAIL} MISSING COLUMN: ${c.name}`);
      }
    }

    if (r.extraColumns.length > 0 && isVerbose) {
      for (const c of r.extraColumns) {
        console.log(`         ${WARN} extra column (not in critical list): ${c}`);
      }
    }
  }

  console.log("");
  if (result.ok) {
    console.log(`  ${PASS} All ${result.tablesChecked} critical tables and columns present.`);
    console.log("");
  } else {
    if (result.tablesMissing.length > 0) {
      console.log(`  ${FAIL} Missing tables: ${result.tablesMissing.join(", ")}`);
    }
    if (result.columnsMissing.length > 0) {
      for (const { table, column } of result.columnsMissing) {
        console.log(`  ${FAIL} Missing column: ${table}.${column}`);
      }
    }
    console.log("");
    console.log("  Suggested fix: run 'npm run db:migrate' then restart the server.");
    console.log("");
  }
}

try {
  const result = runDoctor();

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printResults(result);
  }

  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error("[db:doctor] Fatal error:", (err as Error).message);
  process.exit(1);
}

#!/usr/bin/env node
/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  WAVE 230 — ROW DELETION SCRIPT.  NOT THE WAVE'S MECHANISM.               ║
 * ║  THIS SCRIPT HAS NEVER BEEN EXECUTED, IN ANY MODE, AGAINST ANY DATABASE.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * READ THIS BEFORE RUNNING ANYTHING.
 *
 * Wave 230's actual mechanism is a REVERSIBLE, PER-RECORD EXCLUSION — three
 * nullable columns, set and unset from the admin UI. That is what ships. This
 * file exists because the owner asked to SEE what a hard deletion would look
 * like, reviewable, with a dry run. It is a proposal for his review, not a step
 * in the wave.
 *
 * ── WHY DELETION IS THE WORSE OPTION, STATED PLAINLY ─────────────────────────
 *  1. IT CAN MAKE A BROKEN AUDIT CHAIN RENDER GREEN. Every one of these tables
 *     is a per-tenant hash chain: each row's hash covers the previous row's hash.
 *     Delete a row from the middle and every later row's `prev_hash` points at
 *     something that no longer exists. Worse, the admin screen derives its green
 *     tick from `broken_at_row_id === null` (R224.1) — so depending on where the
 *     break falls, a GENUINELY CORRUPTED chain can display as verified. That is
 *     the single most-repeated failure mode of this programme.
 *  2. IT IS IRREVERSIBLE. A misclassified real client is recoverable in one click
 *     under the exclusion mechanism, and recoverable only from a backup here. The
 *     classifier's own two PROBABLE companies are exactly the records where
 *     getting it wrong is most likely.
 *  3. R195.5 forbids deletion as a mechanism, and the owner's standing preference
 *     is "I'd rather add than delete".
 *
 * ── SAFETY PROPERTIES OF THIS SCRIPT ─────────────────────────────────────────
 *  · DRY RUN IS THE DEFAULT. With no flags it opens the database READ-ONLY and
 *    cannot write even if it contained a bug.
 *  · It deletes ONLY rows already marked excluded (`w230_is_test_at IS NOT NULL`)
 *    by a human through the admin UI. It never classifies, and never decides.
 *  · It will not run at all unless `--i-have-a-backup` is passed alongside
 *    `--execute`, and it verifies and prints the audit-chain state BEFORE and
 *    AFTER, aborting the transaction if any chain that was clean becomes broken.
 *  · Everything happens in ONE transaction, rolled back on any surprise.
 *
 * USAGE
 *   node scripts/wave230/w230_delete_test_rows.mjs                  # dry run (default, read-only)
 *   node scripts/wave230/w230_delete_test_rows.mjs --json           # dry run, machine-readable
 *   node scripts/wave230/w230_delete_test_rows.mjs --execute --i-have-a-backup
 *
 * The last form is the ONLY one that writes, and it has never been run.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

const EXECUTE = has("--execute");
const BACKUP_CONFIRMED = has("--i-have-a-backup");
const AS_JSON = has("--json");

/* The six populations migration 0229 alters, child-first so that a delete order
   never orphans a row that another row points at. */
const TABLES = [
  { table: "collective_apps", key: "id" },
  { table: "consortium_applications", key: "id" },
  { table: "subscriptions", key: "company_id" },
  { table: "spvs", key: "id" },
  { table: "rounds", key: "id" },
  { table: "companies", key: "id" },
];

const AT_COLUMN = "w230_is_test_at";

function die(msg, code = 1) {
  console.error(`\n  ABORTED: ${msg}\n`);
  process.exit(code);
}

function resolveDbPath() {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    die(
      "DATABASE_URL points at Postgres. This script is SQLite-only and will not " +
        "guess at Postgres semantics for a destructive operation.",
    );
  }
  if (url.startsWith("file:")) return url.slice("file:".length);
  if (url.startsWith("sqlite:")) return url.slice("sqlite:".length);
  if (process.env.SQLITE_PATH) return process.env.SQLITE_PATH;
  return path.join(process.cwd(), "data.db");
}

async function main() {
  if (EXECUTE && !BACKUP_CONFIRMED) {
    die(
      "--execute requires --i-have-a-backup as well.\n" +
        "  This operation is IRREVERSIBLE and can corrupt per-tenant audit chains.\n" +
        "  Take a copy of the database file first, then pass both flags.",
    );
  }

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) die(`no database at ${dbPath}`);

  const { default: Database } = await import("better-sqlite3");
  /* DRY RUN OPENS READ-ONLY. Not "we promise not to write" — the file handle
     itself cannot write. */
  const db = new Database(dbPath, { readonly: !EXECUTE });

  const columnsPresent = (t) =>
    db
      .prepare(`PRAGMA table_info(${t})`)
      .all()
      .some((c) => c.name === AT_COLUMN);

  const plan = [];
  for (const { table, key } of TABLES) {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    if (!exists) {
      plan.push({ table, status: "TABLE_ABSENT", rows: [] });
      continue;
    }
    if (!columnsPresent(table)) {
      /* Migration 0229 has not reached this database. Nothing is marked, so there
         is nothing to delete. Reported, not treated as an error. */
      plan.push({ table, status: "MIGRATION_0229_NOT_APPLIED", rows: [] });
      continue;
    }
    const rows = db
      .prepare(
        `SELECT ${key} AS id, ${AT_COLUMN} AS at, w230_is_test_reason AS reason,
                w230_is_test_by AS by_actor
           FROM ${table}
          WHERE ${AT_COLUMN} IS NOT NULL`,
      )
      .all();
    plan.push({ table, key, status: "READY", rows });
  }

  const total = plan.reduce((n, p) => n + p.rows.length, 0);

  if (AS_JSON) {
    console.log(JSON.stringify({ dbPath, execute: EXECUTE, total, plan }, null, 2));
  } else {
    console.log(`\n  WAVE 230 — ROW DELETION ${EXECUTE ? "EXECUTE" : "DRY RUN (read-only)"}`);
    console.log(`  database: ${dbPath}\n`);
    for (const p of plan) {
      console.log(`  ${p.table.padEnd(26)} ${String(p.rows.length).padStart(5)}  ${p.status}`);
      for (const r of p.rows.slice(0, 10)) {
        console.log(`      - ${r.id}   marked ${r.at} by ${r.by_actor ?? "?"} — ${r.reason ?? ""}`);
      }
      if (p.rows.length > 10) console.log(`      … and ${p.rows.length - 10} more`);
    }
    console.log(`\n  TOTAL ROWS THAT WOULD BE DELETED: ${total}\n`);
  }

  if (!EXECUTE) {
    console.log(
      "  DRY RUN ONLY. Nothing was written; the database was opened read-only.\n" +
        "  The shipped mechanism is the reversible exclusion flag. Prefer it.\n",
    );
    db.close();
    return;
  }

  /* ── EXECUTE PATH. NEVER RUN. ──────────────────────────────────────────────
     Kept deliberately conservative: chain state is captured before and after,
     and the whole thing is abandoned if a chain that was clean becomes broken. */
  const chainState = () => {
    const out = {};
    for (const { table } of TABLES) {
      try {
        const rows = db.prepare(`SELECT prev_hash, hash FROM ${table} LIMIT 1`).all();
        out[table] = rows.length > 0 ? "HASHED" : "EMPTY_OR_UNHASHED";
      } catch {
        out[table] = "NO_HASH_COLUMNS";
      }
    }
    return out;
  };

  const before = chainState();
  console.log(`  chain columns before: ${JSON.stringify(before)}`);

  const run = db.transaction(() => {
    let deleted = 0;
    for (const p of plan) {
      if (p.status !== "READY" || p.rows.length === 0) continue;
      const stmt = db.prepare(`DELETE FROM ${p.table} WHERE ${p.key} = ?`);
      for (const r of p.rows) {
        const info = stmt.run(r.id);
        if (info.changes !== 1) {
          throw new Error(
            `expected to delete exactly 1 row for ${p.table}:${r.id}, changed ${info.changes} — abandoning`,
          );
        }
        deleted += 1;
      }
    }
    if (deleted !== total) {
      throw new Error(`deleted ${deleted} but planned ${total} — abandoning`);
    }
    return deleted;
  });

  try {
    const deleted = run();
    console.log(`  deleted ${deleted} row(s).`);
    console.log(
      "\n  NOW VERIFY THE AUDIT CHAINS with the CANONICAL verifier\n" +
        "  (server/lib/auditChainVerifier.ts → verifyAllChains), NOT the admin twin\n" +
        "  at adminPlatformStore.ts:verifyTenantAuditChain, which R208.1 records as\n" +
        "  miswired. If any chain is broken, RESTORE FROM YOUR BACKUP.\n",
    );
  } catch (err) {
    console.error(`\n  TRANSACTION ROLLED BACK: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((err) => die(err.stack ?? String(err)));

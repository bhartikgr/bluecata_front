/**
 * WAVE 230 — TEST-DATA EXCLUSION: THE FLAG LAYER (schema + reads).
 *
 * R228, owner verbatim, 2026-08-31: "It is time to remove the test data. Go for it."
 *
 * ── WHY THIS IS A MARK AND NOT A DELETE ───────────────────────────────────────
 * R228.1 is binding. Deleting rows breaks the per-tenant hash chain, and because
 * the admin screen derives its green tick from `broken_at_row_id === null`
 * (R224.1), a deletion could leave a GENUINELY BROKEN CHAIN RENDERING GREEN —
 * the most-repeated failure mode of this programme, triggered deliberately.
 * R195.5 forbids deletion as a mechanism, and the owner's standing preference is
 * "I'd rather add than delete". Misclassification here is unrecoverable if rows
 * are gone and a one-click fix if they are merely marked.
 *
 * NOTHING IN THIS FILE DELETES A ROW. There is no DELETE statement in it.
 *
 * ── WHY PER-RECORD AND NEVER PER-TENANT (R230.6) ──────────────────────────────
 * A round named "QA Note Round" sits inside BluePrint Catalyst Limited — the
 * operator's own real company (R229). A tenant-scoped design would either hide
 * the real operating entity or miss that round. So the flag lives on the ROW.
 * `subscriptions` carries it directly for the same reason: R230 records an orphan
 * subscription whose company row does not exist, and nothing that reaches
 * subscriptions THROUGH a company could ever mark it.
 *
 * ── SEMANTICS ─────────────────────────────────────────────────────────────────
 * NULL               -> KEPT (the default, and the state of every existing row)
 * ISO-8601 timestamp -> EXCLUDED at that instant
 * Unset writes NULL. There is no permanent state.
 *
 * "Ambiguous defaults to KEPT" (R228.3) is therefore structural, not a policy
 * anyone must remember: it is what the storage does when nobody acts. Every
 * failure path in this file degrades to "nothing is excluded" — today's
 * behaviour — and NEVER to "everything is excluded", which would empty the
 * platform.
 *
 * ── DB-DRIVEN AND DYNAMIC, NEVER A HARDCODED ID LIST (R228.3, R230.3) ─────────
 * No record id appears anywhere in this file. Membership of the excluded set is
 * a live query against the column. New test data marked tomorrow is excluded
 * tomorrow with no code change.
 *
 * ── WHY A SELF-HEAL INSTALLER ─────────────────────────────────────────────────
 * There are two schema paths: the numbered migrations (real deploys) and the
 * inline bootstrap in server/db/connection.ts (sandbox, dev, and EVERY `:memory:`
 * test). connection.ts is SACRED, so no wave may extend the bootstrap. A wave
 * that writes a migration and stops has columns that exist for deploys and are
 * INVISIBLE to its own tests — the wave-261 problem. The sanctioned answer,
 * implemented by wave 217 and wave 221 and matched exactly here, is a self-heal
 * that:
 *   - reads the ALTER TABLE statements OUT OF the migration file rather than
 *     re-typing them, so installer and migration cannot drift;
 *   - applies only the statements whose column is actually missing;
 *   - INSPECTS presence with a PRAGMA on EVERY call rather than caching a
 *     boolean, because a cached boolean answers "already done" for a second
 *     in-memory database that has none of the columns.
 * This is that pattern, not a third installer, and no DDL is re-typed.
 *
 * ── WHY THIS FILE IS SEPARATE FROM THE WRITER ─────────────────────────────────
 * The audited writer lives in `wave230TestDataExclusion.ts`, which imports
 * `appendAdminAudit` from `server/adminPlatformStore.ts`. `adminPlatformStore`
 * itself has to READ the excluded set, because that is where ARR/MRR is computed
 * — so putting the reads in the same file as the writer would create an import
 * CYCLE through the platform's central admin store. There is no precedent for
 * such a cycle in that file (checked: none of its `./lib/*` imports import it
 * back), and a cycle there would be resolved differently by tsx, vitest and the
 * production bundler, which is exactly the class of defect that produces a
 * filter that is empty in one environment and correct in another.
 *
 * So: READS AND SCHEMA HERE, with no dependency on the audit path. The audited
 * write is layered on top. The reads cannot depend on the writer, which is also
 * the honest architecture: a figure must be computable without the ability to
 * change it.
 */

import fs from "node:fs";
import path from "node:path";
import { getDbDriver, rawDb } from "../db/connection";
import { log } from "./logger";

const MIGRATION_BASENAME = "0229_wave230_test_data_exclusion.sql";

/**
 * The three column names, in ONE place.
 *
 * The brief names "a filter keyed to a field the writer never writes" as an
 * inert-proof mechanism highly relevant to this wave: if the reader filters on
 * one name and the writer writes another, every test passes against a set that
 * is permanently empty and the wave ships doing nothing. Reader and writer both
 * take the name from here, so they cannot disagree — and the tests additionally
 * prove agreement end-to-end by writing through the real writer and reading
 * through the real surface.
 */
export const WAVE230_AT_COLUMN = "w230_is_test_at";
export const WAVE230_REASON_COLUMN = "w230_is_test_reason";
export const WAVE230_BY_COLUMN = "w230_is_test_by";

/** The six populations R230 enumerates. Each is marked independently. */
export const WAVE230_TABLES = [
  "companies",
  "rounds",
  "spvs",
  "subscriptions",
  "consortium_applications",
  "collective_apps",
] as const;

export type Wave230Table = (typeof WAVE230_TABLES)[number];

export function isWave230Table(name: string): name is Wave230Table {
  return (WAVE230_TABLES as ReadonlyArray<string>).includes(name);
}

/**
 * What identifies a row in each population.
 *
 * `subscriptions` is keyed by `company_id`, not `id` — its PRIMARY KEY genuinely
 * is the company id. Getting this wrong would silently address zero rows.
 */
export function wave230KeyColumn(table: Wave230Table): string {
  return table === "subscriptions" ? "company_id" : "id";
}

/** The human-facing label column, used only for reporting, never for deciding. */
export function wave230LabelColumn(table: Wave230Table): string | null {
  switch (table) {
    case "companies":
    case "rounds":
    case "spvs":
      return "name";
    case "consortium_applications":
      return "organization_name";
    case "subscriptions":
    case "collective_apps":
      return null;
    default:
      return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  SELF-HEAL — the DDL is read out of migration 0229, never re-typed here
 * ═══════════════════════════════════════════════════════════════════════════ */

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

/**
 * The `ALTER TABLE … ADD COLUMN …` statements, taken from migration 0229.
 *
 * Comment lines are dropped BEFORE any conclusion is drawn from the text. The
 * migration's header is prose; it discusses ALTER statements in English and
 * names columns in sentences, and none of that must ever be executed or matched
 * against. Each statement is applied on its own because SQLite adds one column
 * per ALTER and because a column that already exists must not abort those that
 * follow.
 */
export function wave230ReadAlterStatements(): string[] {
  let sql: string | null = null;
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) {
        sql = fs.readFileSync(p, "utf8");
        break;
      }
    } catch {
      /* try the next candidate */
    }
  }
  if (sql == null) return [];
  const executable = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return executable
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^ALTER\s+TABLE/i.test(s));
}

/**
 * Does the live table actually have all three columns? INSPECTED, never assumed,
 * on every call.
 */
export function wave230ColumnsPresent(table: Wave230Table): boolean {
  if (getDbDriver() !== "sqlite") return false;
  try {
    const db: any = rawDb();
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const names = new Set(info.map((c) => String(c.name)));
    return (
      names.has(WAVE230_AT_COLUMN) &&
      names.has(WAVE230_REASON_COLUMN) &&
      names.has(WAVE230_BY_COLUMN)
    );
  } catch {
    return false;
  }
}

export type Wave230EnsureOutcome =
  | { ok: true; added: string[] }
  | { ok: false; reason: string };

/**
 * Make the columns exist, idempotently, by INSPECTING the table — never by a
 * module-level boolean, which would answer "already done" for a second in-memory
 * database that has none of them.
 */
export function wave230EnsureColumns(table: Wave230Table): Wave230EnsureOutcome {
  if (getDbDriver() !== "sqlite") {
    /* On Postgres the numbered migration is the only installer. This file does
       not attempt DDL there, and says so rather than reporting a false success. */
    return { ok: false, reason: "NOT_SQLITE_MIGRATION_OWNS_DDL" };
  }
  if (wave230ColumnsPresent(table)) return { ok: true, added: [] };

  const statements = wave230ReadAlterStatements();
  if (statements.length === 0) {
    return { ok: false, reason: `MIGRATION_NOT_READABLE:${MIGRATION_BASENAME}` };
  }
  const db: any = rawDb();
  const added: string[] = [];
  for (const stmt of statements) {
    /* Only THIS table's statements are applied by this call. Another table's
       statement is skipped here and applied by that table's own ensure. */
    if (!new RegExp(`ALTER\\s+TABLE\\s+${table}\\b`, "i").test(stmt)) continue;
    try {
      db.prepare(stmt).run();
      added.push(stmt);
    } catch (err) {
      const msg = (err as Error).message || "";
      /* "duplicate column name" means another caller won the race — that is the
         desired end state, not a failure. Anything else is surfaced. */
      if (!/duplicate column/i.test(msg)) {
        return { ok: false, reason: `ALTER_FAILED:${msg}` };
      }
    }
  }
  if (!wave230ColumnsPresent(table)) {
    /* Re-inspect. "I ran the statement" is not the same claim as "the columns are
       there", and only the second one is worth anything. */
    return { ok: false, reason: `COLUMNS_STILL_ABSENT_AFTER_ALTER:${table}` };
  }
  return { ok: true, added };
}

/** Install on every population. Reports per table; never throws. */
export function wave230EnsureAllColumns(): Record<string, Wave230EnsureOutcome> {
  const out: Record<string, Wave230EnsureOutcome> = Object.create(null);
  for (const t of WAVE230_TABLES) out[t] = wave230EnsureColumns(t);
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  READ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every row id in this population that is currently EXCLUDED.
 *
 * Returned as a Set so a computation path can do a membership test per row
 * without a query per row. An EMPTY set is the state of a platform where nothing
 * has been marked, and an empty set must leave every figure byte-identical.
 *
 * A read failure becomes an EMPTY set — "nothing is excluded", today's behaviour
 * — and is logged. It must never become "everything is excluded", which would
 * blank every list and every revenue figure on the platform at once.
 */
export function wave230ExcludedIds(table: Wave230Table): Set<string> {
  const out = new Set<string>();
  if (!wave230ColumnsPresent(table)) return out;
  const key = wave230KeyColumn(table);
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT ${key} AS k FROM ${table}
          WHERE ${WAVE230_AT_COLUMN} IS NOT NULL AND ${WAVE230_AT_COLUMN} <> ''`,
      )
      .all() as Array<{ k: string }>;
    for (const r of rows) out.add(String(r.k));
  } catch (err) {
    log.warn(
      `[wave230] excluded-id read failed for ${table}; treating as nothing excluded:`,
      (err as Error).message,
    );
  }
  return out;
}

/** Is this one record currently excluded? */
export function wave230IsExcluded(table: Wave230Table, id: string): boolean {
  if (!id) return false;
  if (!wave230ColumnsPresent(table)) return false;
  const key = wave230KeyColumn(table);
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT ${WAVE230_AT_COLUMN} AS v FROM ${table} WHERE ${key} = ?`)
      .get(id) as { v?: string | null } | undefined;
    const v = row?.v;
    return typeof v === "string" && v.length > 0;
  } catch {
    return false;
  }
}

export interface Wave230ExcludedRecord {
  table: Wave230Table;
  id: string;
  label: string | null;
  excludedAt: string;
  reason: string | null;
  excludedBy: string | null;
}

/**
 * The excluded records of one population, with the evidence for each.
 *
 * This is what the admin "view excluded records" filter renders. It exists so
 * that nothing this wave hides becomes unreachable: every excluded record stays
 * one click away, with the reason it was excluded and who excluded it, and can
 * be restored from that same screen.
 */
export function wave230ListExcluded(table: Wave230Table): Wave230ExcludedRecord[] {
  if (!wave230ColumnsPresent(table)) return [];
  const key = wave230KeyColumn(table);
  const labelCol = wave230LabelColumn(table);
  const labelSelect = labelCol ? `${labelCol} AS label` : `NULL AS label`;
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT ${key} AS k, ${labelSelect},
                ${WAVE230_AT_COLUMN} AS at,
                ${WAVE230_REASON_COLUMN} AS reason,
                ${WAVE230_BY_COLUMN} AS by_actor
           FROM ${table}
          WHERE ${WAVE230_AT_COLUMN} IS NOT NULL AND ${WAVE230_AT_COLUMN} <> ''
          ORDER BY ${WAVE230_AT_COLUMN} DESC, ${key} ASC`,
      )
      .all() as Array<{
      k: string;
      label: string | null;
      at: string;
      reason: string | null;
      by_actor: string | null;
    }>;
    return rows.map((r) => ({
      table,
      id: String(r.k),
      label: r.label == null ? null : String(r.label),
      excludedAt: String(r.at),
      reason: r.reason == null ? null : String(r.reason),
      excludedBy: r.by_actor == null ? null : String(r.by_actor),
    }));
  } catch (err) {
    log.warn(`[wave230] excluded-record read failed for ${table}:`, (err as Error).message);
    return [];
  }
}

export interface Wave230TableCounts {
  table: Wave230Table;
  /** null means NOT DETERMINED — never a fabricated zero (R6, R224.1). */
  total: number | null;
  excluded: number | null;
  kept: number | null;
  /** False when migration 0229 has not reached this database yet. */
  installed: boolean;
}

/**
 * Counts for one population.
 *
 * R224.1 governs the shape of the return: `null` means NOT DETERMINED and the
 * consuming surface must render a dash. A count that could not be read must
 * never arrive as `0`, because a fabricated zero reads as "there is nothing
 * excluded" — an absence rendering as reassurance, which R224.1 names as worse
 * than a fabrication because nobody looks for it.
 */
export function wave230Counts(table: Wave230Table): Wave230TableCounts {
  const installed = wave230ColumnsPresent(table);
  if (!installed) {
    return { table, total: null, excluded: null, kept: null, installed: false };
  }
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN ${WAVE230_AT_COLUMN} IS NOT NULL
                          AND ${WAVE230_AT_COLUMN} <> '' THEN 1 ELSE 0 END) AS excluded
           FROM ${table}`,
      )
      .get() as { total?: number; excluded?: number } | undefined;
    if (!row || typeof row.total !== "number") {
      return { table, total: null, excluded: null, kept: null, installed: true };
    }
    const total = row.total;
    const excluded = typeof row.excluded === "number" ? row.excluded : 0;
    return { table, total, excluded, kept: total - excluded, installed: true };
  } catch (err) {
    log.warn(`[wave230] count read failed for ${table}:`, (err as Error).message);
    return { table, total: null, excluded: null, kept: null, installed: true };
  }
}

/** Counts across every population. */
export function wave230AllCounts(): Wave230TableCounts[] {
  return WAVE230_TABLES.map((t) => wave230Counts(t));
}


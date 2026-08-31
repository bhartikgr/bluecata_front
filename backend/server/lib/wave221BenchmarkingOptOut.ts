/**
 * WAVE 221 — the investor / partner benchmarking-and-matchmaking opt-out.
 *
 * R190.10, owner verbatim: "This platform is enabling communication between
 * investors, founders, consortium partners and I feel that this may hinder that
 * communication. I want to keep it open and available. Users should have the option
 * to turn it off by themselves."
 *
 * So: nothing is restricted, nothing is disabled, no audience is narrowed. A user
 * gets a switch. Off by default (§221.4), which means every pre-existing row is
 * NULL and every benchmark on a platform with no takers is byte-identical to
 * today's.
 *
 * ── WHY A DEDICATED COLUMN AND NOT A SETTINGS JSON BLOB ────────────────────────
 * §221.5 says to reuse the settings JSON on the owning row, and to STOP AND REPORT
 * if one genuinely does not exist. For the partner it does exist
 * (`partner_workspace_settings.settings_json`). For the investor it does not:
 *   - `users` (connection.ts:3087) has no JSON/prefs column;
 *   - `user_prefs` (:3103) carries only `active_tenant_id` + `updated_at`;
 *   - `profilestore_investor_profile.profile_json` (:5077) is owned by
 *     server/profileStore.ts, which is FROZEN, and its PATCH
 *     /api/investors/:id/privacy handler validates with a zod schema that STRIPS
 *     unknown keys and then rewrites the row from an in-process Map. Writing a new
 *     key there produces HTTP 200 and the old value on the next read — the exact
 *     silent-revert defect §5.10 calls the worst class of data defect.
 * The parent brief's grant ("take 0228 and 0229 if needed") is therefore used for
 * ONE ordinal, 0228, and the tension with §221.5's stop-and-report clause is
 * reported to the owner rather than buried here.
 *
 * ── WHY A SELF-HEAL INSTALLER ─────────────────────────────────────────────────
 * There are two schema paths: the numbered migrations (real deploys) and the inline
 * bootstrap inside `server/db/connection.ts` (sandbox, dev, and EVERY `:memory:`
 * test). `connection.ts` is SACRED, so no wave may extend the bootstrap. A wave that
 * writes a migration and stops has columns that exist for deploys and are INVISIBLE
 * to its own tests. The sanctioned answer, implemented by
 * `server/wave211MoneyEventAttestationStore.ts` and matched by wave 217, is a
 * self-heal that:
 *   - reads the `ALTER TABLE` statements OUT OF the migration file rather than
 *     re-typing them, so installer and migration cannot drift;
 *   - applies only the statements whose column is actually missing;
 *   - INSPECTS presence with a PRAGMA on every call rather than caching a boolean,
 *     because a cached boolean answers "already done" for a second in-memory
 *     database that has none of the columns.
 * This is the same pattern, not a third installer, and no DDL is re-typed.
 *
 * ── SEMANTICS ─────────────────────────────────────────────────────────────────
 * NULL  → the subject PARTICIPATES (the default, and the state of every existing row)
 * ISO-8601 timestamp → the subject has switched sharing OFF, at that instant.
 * Switching back on sets it to NULL. There is no permanent state.
 */

import fs from "node:fs";
import path from "node:path";
import { getDbDriver, rawDb } from "../db/connection";
import { log } from "./logger";
import { appendAdminAudit } from "../adminPlatformStore";
import { WAVE221_AUDIT_EVENT } from "../../shared/wave221BenchmarkingOptOutCopy";

const MIGRATION_BASENAME = "0228_wave221_benchmarking_opt_out.sql";

/** The one column name, in one place. Both tables use it. */
export const WAVE221_OPT_OUT_COLUMN = "w221_benchmarking_opt_out_at";

export type Wave221Subject = "investor" | "partner";

/** Which table holds which silo's flag, and what the row is keyed by. */
export function wave221TableFor(subject: Wave221Subject): { table: string; keyColumn: string } {
  return subject === "investor"
    ? { table: "users", keyColumn: "id" }
    : { table: "partner_workspace_settings", keyColumn: "partner_id" };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  SELF-HEAL — the DDL is read out of migration 0228, never re-typed here
 * ═══════════════════════════════════════════════════════════════════════════ */

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

/**
 * The `ALTER TABLE … ADD COLUMN …` statements, taken from migration 0228.
 *
 * Comment lines are dropped BEFORE any conclusion is drawn from the text: the
 * migration's header is prose, it names the columns in English, and it must never
 * be executed or matched against. Each statement is applied on its own because
 * SQLite adds one column per ALTER and because a column that already exists must
 * not abort the ones that follow.
 */
export function wave221ReadAlterStatements(): string[] {
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

/** Does the live table actually have the column? INSPECTED, never assumed, every call. */
export function wave221ColumnPresent(subject: Wave221Subject): boolean {
  if (getDbDriver() !== "sqlite") return false;
  const { table } = wave221TableFor(subject);
  try {
    const db: any = rawDb();
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return info.some((c) => String(c.name) === WAVE221_OPT_OUT_COLUMN);
  } catch {
    return false;
  }
}

export type Wave221EnsureOutcome =
  | { ok: true; added: string[] }
  | { ok: false; reason: string };

/**
 * Make the column exist, idempotently, by INSPECTING the table — never by a
 * module-level boolean, which would answer "already done" for a second in-memory
 * database that has none of them.
 */
export function wave221EnsureColumn(subject: Wave221Subject): Wave221EnsureOutcome {
  if (getDbDriver() !== "sqlite") {
    /* On Postgres the numbered migration is the only installer. This file does not
       attempt DDL there, and says so rather than reporting a false success. */
    return { ok: false, reason: "NOT_SQLITE_MIGRATION_OWNS_DDL" };
  }
  const { table } = wave221TableFor(subject);
  if (wave221ColumnPresent(subject)) return { ok: true, added: [] };

  const statements = wave221ReadAlterStatements();
  if (statements.length === 0) {
    return { ok: false, reason: `MIGRATION_NOT_READABLE:${MIGRATION_BASENAME}` };
  }
  const db: any = rawDb();
  const added: string[] = [];
  for (const stmt of statements) {
    /* Only THIS subject's table is touched by this call. A statement for the other
       table is skipped here and applied by that subject's own ensure. */
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
  if (!wave221ColumnPresent(subject)) {
    /* Re-inspect. "I ran the statement" is not the same claim as "the column is
       there", and only the second one is worth anything. */
    return { ok: false, reason: `COLUMN_STILL_ABSENT_AFTER_ALTER:${table}` };
  }
  return { ok: true, added };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  READ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The instant this subject switched sharing off, or null if they participate.
 *
 * Returns null — participate — when the column is absent, so a database that has
 * never seen migration 0228 behaves exactly as it does today. This is what keeps
 * "an opt-out with no takers produces byte-identical output" true even before the
 * installer has ever run.
 */
export function wave221OptOutAt(subject: Wave221Subject, subjectId: string): string | null {
  if (!subjectId) return null;
  if (!wave221ColumnPresent(subject)) return null;
  const { table, keyColumn } = wave221TableFor(subject);
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT ${WAVE221_OPT_OUT_COLUMN} AS v FROM ${table} WHERE ${keyColumn} = ?`)
      .get(subjectId) as { v?: string | null } | undefined;
    const v = row?.v;
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** True when this subject has switched sharing off. */
export function wave221IsOptedOut(subject: Wave221Subject, subjectId: string): boolean {
  return wave221OptOutAt(subject, subjectId) !== null;
}

/**
 * Every subject id in this silo that has switched sharing off.
 *
 * Returned as a Set so the computation path can do a membership test per row
 * without a query per row. An EMPTY set is the state of a platform with no takers,
 * and an empty set must leave the computation byte-identical.
 */
export function wave221OptedOutIds(subject: Wave221Subject): Set<string> {
  const out = new Set<string>();
  if (!wave221ColumnPresent(subject)) return out;
  const { table, keyColumn } = wave221TableFor(subject);
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT ${keyColumn} AS k FROM ${table}
          WHERE ${WAVE221_OPT_OUT_COLUMN} IS NOT NULL AND ${WAVE221_OPT_OUT_COLUMN} <> ''`,
      )
      .all() as Array<{ k: string }>;
    for (const r of rows) out.add(String(r.k));
  } catch (err) {
    /* A read failure must not silently become "everyone opted out", which would
       empty every benchmark on the platform. It becomes "nobody opted out", which
       is today's behaviour, and it is logged. */
    log.warn("[wave221] opted-out id read failed; treating as no takers:", (err as Error).message);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WRITE
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Wave221WriteOutcome =
  | { ok: true; sharingEnabled: boolean; optOutAt: string | null }
  | { ok: false; reason: string };

/**
 * Set this subject's sharing state and audit the change.
 *
 * `sharingEnabled === true`  → participate → column set to NULL.
 * `sharingEnabled === false` → opted out   → column set to the server's clock.
 *
 * The timestamp is SERVER-OBSERVED. A client-supplied instant is never trusted or
 * stored (R187.1).
 *
 * The audit is written through `appendAdminAudit` — the platform's one audit path
 * (§221.5). No second audit writer exists in this wave. Note that the entry's
 * event field is named `eventType`, not `action`/`event`: a filter keyed on the
 * wrong name matches nothing and makes an assertion pass against an empty set.
 */
export function wave221SetSharing(input: {
  subject: Wave221Subject;
  subjectId: string;
  sharingEnabled: boolean;
  actorId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  tenantId?: string;
}): Wave221WriteOutcome {
  const { subject, subjectId, sharingEnabled, actorId } = input;
  if (!subjectId) return { ok: false, reason: "MISSING_SUBJECT_ID" };

  const ensured = wave221EnsureColumn(subject);
  if (!ensured.ok) return { ok: false, reason: ensured.reason };

  const { table, keyColumn } = wave221TableFor(subject);
  const optOutAt = sharingEnabled ? null : new Date().toISOString();
  try {
    const db: any = rawDb();
    const info = db
      .prepare(`UPDATE ${table} SET ${WAVE221_OPT_OUT_COLUMN} = ? WHERE ${keyColumn} = ?`)
      .run(optOutAt, subjectId);
    /* better-sqlite3 reports how many rows the UPDATE actually touched. Zero means
       the row does not exist, and returning ok:true there would be a write that
       "appears to work then silently reverts" on the next read. */
    if (Number(info?.changes ?? 0) === 0) {
      return { ok: false, reason: `SUBJECT_ROW_NOT_FOUND:${table}` };
    }
  } catch (err) {
    return { ok: false, reason: `UPDATE_FAILED:${(err as Error).message}` };
  }

  try {
    appendAdminAudit(
      actorId,
      `${subject}:${subjectId}`,
      WAVE221_AUDIT_EVENT,
      {
        subject,
        subjectId,
        sharingEnabled,
        optOutAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
      input.tenantId,
    );
  } catch (err) {
    /* The preference is already durable. A failed audit append is logged, not
       turned into a 500 that leaves the user unable to change their own setting. */
    log.warn("[wave221] audit append failed:", (err as Error).message);
  }

  return { ok: true, sharingEnabled, optOutAt };
}

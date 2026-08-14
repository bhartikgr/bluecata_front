/**
 * server/lib/migrationIntegrity.ts — WAVE 49 · C-3 (+ A-6B).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Review C, finding C-3: the boot doctor checked 14 columns across 3 tables and
 * printed "[boot] db:doctor passed — schema is current" on a database that had
 * ZERO of Wave 48's 142 triggers, NO migration ledger at all, and NO
 * `partner_invoice` table — the last of which means every partner approval
 * would 409 on invoice creation. The doctor was not wrong about its 14 columns.
 * It was wrong about what it claimed, because 14 columns chosen in v23.4.1 say
 * nothing about migrations 0100–0186.
 *
 * A schema check whose scope is frozen at the moment it was written will always
 * pass, and will therefore always be believed. So this checker is defined
 * against the MIGRATIONS DIRECTORY, not against a hand-list that ages:
 *
 *   1. THE LEDGER EXISTS. `__drizzle_migrations_applied` is created by
 *      `server/db/migrate.ts` the first time it runs. Its absence means the
 *      numbered migration runner has NEVER run against this database, whatever
 *      else is present. That is one fact, it is decisive, and the old doctor
 *      could not see it.
 *   2. THE HIGHEST APPLIED ID MATCHES THE HIGHEST MIGRATION FILE. Compared by
 *      numeric id, so it keeps working as 0187, 0188 … are added, with no edit
 *      here.
 *   3. LOWER-NUMBERED PENDING MIGRATIONS ARE REPORTED. Not fatal — see
 *      `KNOWN_DEFERRED` below, which documents the one real, non-blocking
 *      deferral this tree has — but always named, never hidden.
 *   4. A REPRESENTATIVE SET OF RECENT TABLES/COLUMNS IS PRESENT. Chosen from
 *      migrations 0167–0186, i.e. exactly the range the old 14-column list was
 *      blind to, and including `partner_invoice` because its absence is the
 *      409 Review C measured.
 *   5. WAVE 48'S 142 TRIGGERS ARE PRESENT — parsed from migration 0186 itself,
 *      so the expected count is whatever the file says and cannot drift from it.
 *   6. EVERY INSTALLED TRIGGER'S DEFINITION IS EQUIVALENT TO THE ONE IN 0186.
 *      This is finding A-6B. `CREATE TRIGGER IF NOT EXISTS` matches on NAME
 *      ONLY, so a database carrying a same-named trigger with weaker logic
 *      keeps it and the migration reports success. 0186 has been amended to
 *      DROP-and-recreate (see its header), which fixes every database that runs
 *      it — but the runner SKIPS a migration already recorded in the ledger, so
 *      for databases that recorded 0186 before the amendment the only thing
 *      that can catch a divergent body is a check of the body. This is it.
 *
 * Every failure names the specific thing that is missing or wrong. "Schema is
 * out of date" without a subject is what let C-3 survive.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH POLES
 * ─────────────────────────────────────────────────────────────────────────────
 * A checker that fails on everything is as useless as one that passes on
 * everything: whoever is on call learns to pass `SKIP_DB_DOCTOR=1`, and then it
 * protects nothing. `server/__tests__/wave49_c3_migration_integrity.test.ts`
 * asserts both: PASSES clean on a database built by `npm run db:migrate`, and
 * FAILS — naming the missing thing — on a database that is behind, on one with
 * no ledger, on one with triggers removed, and on one whose trigger body was
 * swapped for a weaker one.
 *
 * NOT SACRED. `server/db/migrate.ts` IS sacred and is NOT touched by this wave;
 * this module only READS what that runner wrote.
 */

import fs from "node:fs";
import path from "node:path";

/** Ledger table written by `server/db/migrate.ts` (sacred, read-only here). */
export const LEDGER_TABLE = "__drizzle_migrations_applied";

/** Trigger family installed by migration 0186 (Wave 48 money type floor). */
export const TYPEFLOOR_TRIGGER_PREFIX = "w48_money_typefloor_";

/** The migration file whose triggers rule 5 and rule 6 are defined against. */
export const TYPEFLOOR_MIGRATION = "0186_wave48_money_column_type_floor.sql";

/**
 * Migrations that legitimately stay PENDING and must NOT fail the doctor.
 *
 * `0040_perf_indexes.sql` is deliberately deferred by the runner: it creates
 * PERFORMANCE indexes, and WAVE 23 · WAIVER-3 made a failing perf index a
 * warning that leaves the migration retryable rather than recording a
 * half-applied file as done. On a fresh migrate it defers on
 * `no such table: main.screening_attendees`. It is a performance hint, not a
 * constraint, so it cannot corrupt data by being absent — but it is listed HERE,
 * by name, with a reason, rather than being silently tolerated. Anything else
 * pending is reported as a warning the operator has to read.
 */
export const KNOWN_DEFERRED: Record<string, string> = {
  "0040_perf_indexes.sql":
    "perf indexes only; WAVE 23 WAIVER-3 keeps it retryable rather than recorded half-applied",
};

/**
 * Representative tables/columns from RECENT migrations (0167–0186) — the range
 * the pre-Wave-49 doctor could not see. Deliberately small: this is a smoke
 * test that the tail of the migration chain actually landed, not a schema dump.
 * Rule 6 does the heavy lifting.
 *
 * EVERY entry here was VERIFIED against a database built by
 * `npx tsx server/db/migrate.ts` — not read off the migration filenames. The
 * first draft of this list guessed `esignature_envelope`, `auth_rate_limit_buckets`
 * and `lock_text_registry` from migration titles; the real tables are
 * `esign_envelope`, `rate_limit_hit` and `platform_lock_text`, and the POLE A
 * test caught all three. A fixture naming a table that does not exist would make
 * the doctor fail on a CORRECTLY migrated database, which is the one-sided
 * failure mode these rules exist to avoid — so do not add an entry here without
 * confirming it against a freshly migrated file.
 */
export const RECENT_MIGRATION_FIXTURES: Array<{
  table: string;
  columns: string[];
  migration: string;
  why: string;
}> = [
  {
    table: "partner_invoice",
    columns: ["id", "partner_id", "status", "total_minor"],
    migration: "0153/0183/0186",
    why:
      "Review C measured this table ABSENT from data.db. Partner approval writes an " +
      "invoice; without the table every approval returns 409.",
  },
  {
    table: "partner_subscription",
    columns: ["id", "subject_kind", "subject_id", "tier_slug", "amount_minor"],
    migration: "0167_wave11_partner_subscription_engine",
    why: "partner subscription engine — the whole partner billing path reads it",
  },
  {
    table: "esign_envelope",
    columns: ["id", "status", "document_sha256"],
    migration: "0168_wave11_esignature_envelope",
    why: "e-signature envelopes; a missing table here silently breaks sign-off",
  },
  {
    table: "rate_limit_hit",
    columns: ["id", "bucket_key", "hit_at"],
    migration: "0173_wave21_durable_rate_limit",
    why: "durable rate limiting — absence silently downgrades to in-memory only",
  },
  {
    table: "spv_template",
    columns: ["id", "name", "carry_fraction_scaled"],
    migration: "0177_wave30_spv_template",
    why: "SPV templates (Wave 30)",
  },
  {
    table: "platform_lock_text",
    columns: ["key", "text"],
    migration: "0180_wave33_lock_text_registry",
    why: "locked legal text registry (Wave 33)",
  },
  {
    table: "round_late_acceptances",
    columns: ["id", "round_id", "reopen_until"],
    migration: "0184_wave43_round_late_acceptances",
    why: "Wave 43 late acceptances",
  },
];

export type Severity = "fail" | "warn";

export interface IntegrityProblem {
  severity: Severity;
  /** Stable machine code, e.g. `ledger_missing`, `trigger_definition_mismatch`. */
  code: string;
  /** Single-line, names the specific subject. */
  detail: string;
}

export interface MigrationIntegrityResult {
  ok: boolean;
  ledgerPresent: boolean;
  migrationFileCount: number;
  highestMigrationFile: string | null;
  highestAppliedMigration: string | null;
  appliedCount: number;
  pendingMigrations: string[];
  unexpectedPending: string[];
  expectedTypefloorTriggers: number;
  installedTypefloorTriggers: number;
  missingTriggers: string[];
  mismatchedTriggers: string[];
  missingTables: string[];
  missingColumns: string[];
  problems: IntegrityProblem[];
}

/** Numeric prefix of a migration filename, or null when it has none. */
export function migrationId(filename: string): number | null {
  const m = /^(\d{4})_/.exec(filename);
  return m ? Number(m[1]) : null;
}

/** Sorted list of `NNNN_*.sql` files in `dir` (ROLLBACK_*.md etc. excluded). */
export function listMigrationFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && migrationId(f) !== null)
    .sort((a, b) => (migrationId(a)! - migrationId(b)!) || a.localeCompare(b));
}

/**
 * Normalise a `CREATE TRIGGER` statement for comparison.
 *
 * SQLite stores the trigger text in `sqlite_master.sql` essentially verbatim,
 * but with `IF NOT EXISTS` REMOVED and the trailing `;` dropped. So both are
 * stripped from the expected text too, whitespace is collapsed, and nothing
 * else is touched — the WHEN clause, the typeof() test and the RAISE(ABORT)
 * message all have to match. This comparison must never be loosened to make a
 * database pass: a "close enough" trigger is a different constraint.
 */
export function normalizeTriggerSql(sql: string): string {
  return sql
    .replace(/^\s*CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS\s+/i, "CREATE TRIGGER ")
    .replace(/^\s*CREATE\s+TRIGGER\s+/i, "CREATE TRIGGER ")
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse every `CREATE TRIGGER … END;` for the type-floor family out of a
 * migration file. Returns name → normalised definition.
 *
 * Reads the file rather than embedding 142 definitions here, so the expectation
 * cannot drift from the migration. `DROP TRIGGER IF EXISTS` lines (added by
 * A-6B) are not statements we compare and are skipped naturally by the regex.
 */
export function parseTypefloorTriggers(migrationSql: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(
    String.raw`CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?(` +
      TYPEFLOOR_TRIGGER_PREFIX +
      String.raw`[A-Za-z0-9_]+)\b[\s\S]*?\bEND\s*;`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(migrationSql)) !== null) {
    out.set(m[1], normalizeTriggerSql(m[0]));
  }
  return out;
}

export interface CheckOptions {
  /** better-sqlite3 handle (or anything exposing `prepare().all()/.get()`). */
  db: any;
  /** Defaults to `<repo>/migrations`, overridable for tests. */
  migrationsDir?: string;
}

function tableExists(db: any, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  return !!row;
}

function columnsOf(db: any, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

/**
 * Locate the migrations directory.
 *
 * `MIGRATIONS_DIR` wins (same env var `server/db/migrate.ts` honours), so the
 * doctor and the runner can never be pointed at different directories.
 * Otherwise walk UP from the working directory looking for a `migrations/`
 * folder that actually contains the type-floor migration.
 *
 * Deliberately does NOT use `__dirname`: `scripts/db_doctor.ts` runs under tsx
 * in ESM mode where `__dirname` is undefined, and the first version of this
 * function threw `__dirname is not defined` there — which the caller correctly
 * reported as "schema state is UNKNOWN" rather than as a pass, but which meant
 * the CLI doctor could never actually check anything. Caught by running it.
 */
export function defaultMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(dir, "migrations");
    if (fs.existsSync(path.join(candidate, TYPEFLOOR_MIGRATION))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Nothing found — return the conventional path so the caller's error names it.
  return path.join(process.cwd(), "migrations");
}

/**
 * Run the full six-rule check. Pure and read-only: it issues SELECTs and
 * PRAGMAs and nothing else, so it is safe to call at boot and safe to call
 * against a production database.
 */
export function checkMigrationIntegrity(opts: CheckOptions): MigrationIntegrityResult {
  const db = opts.db;
  const dir = opts.migrationsDir ?? defaultMigrationsDir();
  const problems: IntegrityProblem[] = [];

  const files = listMigrationFiles(dir);
  const highestMigrationFile = files.length > 0 ? files[files.length - 1] : null;

  /* ── Rule 1 · the ledger exists ─────────────────────────────────────────── */
  const ledgerPresent = tableExists(db, LEDGER_TABLE);
  let applied: string[] = [];
  if (!ledgerPresent) {
    problems.push({
      severity: "fail",
      code: "ledger_missing",
      detail:
        `migration ledger table \`${LEDGER_TABLE}\` does NOT exist — the numbered migration ` +
        `runner (npm run db:migrate) has never completed against this database. ` +
        `${files.length} migration file(s) are on disk` +
        (highestMigrationFile ? `, highest ${highestMigrationFile}` : "") +
        `. Tables created by connection.ts's inline boot DDL may still be present, which is ` +
        `why a column-only check can pass here; it is NOT evidence the migrations ran.`,
    });
  } else {
    applied = (db.prepare(`SELECT name FROM ${LEDGER_TABLE}`).all() as { name: string }[])
      .map((r) => r.name)
      .filter((n) => migrationId(n) !== null)
      .sort((a, b) => (migrationId(a)! - migrationId(b)!) || a.localeCompare(b));
  }

  const appliedSet = new Set(applied);
  const highestAppliedMigration = applied.length > 0 ? applied[applied.length - 1] : null;

  /* ── Rule 2 · highest applied === highest file ──────────────────────────── */
  if (ledgerPresent) {
    const hiFileId = highestMigrationFile ? migrationId(highestMigrationFile) : null;
    const hiAppliedId = highestAppliedMigration ? migrationId(highestAppliedMigration) : null;
    if (hiFileId === null) {
      problems.push({
        severity: "fail",
        code: "no_migration_files",
        detail: `no NNNN_*.sql migration files found in ${dir}`,
      });
    } else if (hiAppliedId === null) {
      problems.push({
        severity: "fail",
        code: "ledger_empty",
        detail:
          `ledger \`${LEDGER_TABLE}\` exists but records NO numbered migration; highest on ` +
          `disk is ${highestMigrationFile}. Run npm run db:migrate.`,
      });
    } else if (hiAppliedId !== hiFileId) {
      problems.push({
        severity: "fail",
        code: "highest_migration_mismatch",
        detail:
          `highest APPLIED migration is ${highestAppliedMigration} (id ${hiAppliedId}) but the ` +
          `highest migration FILE is ${highestMigrationFile} (id ${hiFileId}) — this database is ` +
          `${hiFileId - hiAppliedId} migration id(s) behind. Run npm run db:migrate.`,
      });
    }
  }

  /* ── Rule 3 · pending migrations are named ──────────────────────────────── */
  const pendingMigrations = ledgerPresent ? files.filter((f) => !appliedSet.has(f)) : files.slice();
  const unexpectedPending = pendingMigrations.filter((f) => !(f in KNOWN_DEFERRED));
  if (ledgerPresent && unexpectedPending.length > 0) {
    problems.push({
      severity: "warn",
      code: "migrations_pending",
      detail:
        `${unexpectedPending.length} migration(s) on disk are NOT recorded as applied: ` +
        `${unexpectedPending.join(", ")}. Run npm run db:migrate.`,
    });
  }
  for (const f of pendingMigrations.filter((x) => x in KNOWN_DEFERRED)) {
    problems.push({
      severity: "warn",
      code: "migration_known_deferred",
      detail: `${f} is pending but KNOWN-DEFERRED: ${KNOWN_DEFERRED[f]}`,
    });
  }

  /* ── Rule 4 · representative recent tables/columns ──────────────────────── */
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  for (const fx of RECENT_MIGRATION_FIXTURES) {
    if (!tableExists(db, fx.table)) {
      missingTables.push(fx.table);
      problems.push({
        severity: "fail",
        code: "recent_table_missing",
        detail: `table \`${fx.table}\` (from ${fx.migration}) is MISSING — ${fx.why}`,
      });
      continue;
    }
    const cols = columnsOf(db, fx.table);
    for (const c of fx.columns) {
      if (!cols.has(c)) {
        missingColumns.push(`${fx.table}.${c}`);
        problems.push({
          severity: "fail",
          code: "recent_column_missing",
          detail: `column \`${fx.table}.${c}\` (from ${fx.migration}) is MISSING`,
        });
      }
    }
  }

  /* ── Rules 5 & 6 · the 142 type-floor triggers, by name AND by body ─────── */
  let expected = new Map<string, string>();
  const typefloorPath = path.join(dir, TYPEFLOOR_MIGRATION);
  try {
    expected = parseTypefloorTriggers(fs.readFileSync(typefloorPath, "utf8"));
  } catch (err) {
    problems.push({
      severity: "fail",
      code: "typefloor_migration_unreadable",
      detail:
        `cannot read ${typefloorPath} to determine the expected money type-floor triggers: ` +
        `${(err as Error).message}`,
    });
  }

  const installedRows = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name LIKE ? ORDER BY name",
    )
    .all(`${TYPEFLOOR_TRIGGER_PREFIX}%`) as { name: string; sql: string | null }[];
  const installed = new Map(installedRows.map((r) => [r.name, normalizeTriggerSql(r.sql ?? "")]));

  const missingTriggers: string[] = [];
  const mismatchedTriggers: string[] = [];
  for (const [name, def] of Array.from(expected.entries())) {
    const got = installed.get(name);
    if (got === undefined) {
      missingTriggers.push(name);
    } else if (got !== def) {
      mismatchedTriggers.push(name);
    }
  }

  if (expected.size > 0 && missingTriggers.length > 0) {
    const shown = missingTriggers.slice(0, 5).join(", ");
    problems.push({
      severity: "fail",
      code: "typefloor_triggers_missing",
      detail:
        `${missingTriggers.length} of ${expected.size} money type-floor triggers from ` +
        `${TYPEFLOOR_MIGRATION} are MISSING (installed: ${installed.size}). Missing include: ` +
        `${shown}${missingTriggers.length > 5 ? `, +${missingTriggers.length - 5} more` : ""}. ` +
        `Without them a money column accepts 'not-a-number'. Run npm run db:migrate.`,
    });
  }
  if (mismatchedTriggers.length > 0) {
    const shown = mismatchedTriggers.slice(0, 5).join(", ");
    problems.push({
      severity: "fail",
      code: "trigger_definition_mismatch",
      detail:
        `${mismatchedTriggers.length} money type-floor trigger(s) EXIST but their installed ` +
        `definition differs from ${TYPEFLOOR_MIGRATION} (finding A-6B: a same-named trigger with ` +
        `different logic). Divergent: ${shown}` +
        `${mismatchedTriggers.length > 5 ? `, +${mismatchedTriggers.length - 5} more` : ""}. ` +
        `The enforced constraint is NOT the one this build ships. Drop the listed trigger(s) and ` +
        `re-run migration ${TYPEFLOOR_MIGRATION}.`,
    });
  }

  return {
    ok: !problems.some((p) => p.severity === "fail"),
    ledgerPresent,
    migrationFileCount: files.length,
    highestMigrationFile,
    highestAppliedMigration,
    appliedCount: applied.length,
    pendingMigrations,
    unexpectedPending,
    expectedTypefloorTriggers: expected.size,
    installedTypefloorTriggers: installed.size,
    missingTriggers,
    mismatchedTriggers,
    missingTables,
    missingColumns,
    problems,
  };
}

/** Human-readable multi-line summary. Used by boot and by `npm run db:doctor`. */
export function formatMigrationIntegrity(r: MigrationIntegrityResult): string {
  const lines: string[] = [];
  lines.push(
    `migration ledger: ${r.ledgerPresent ? "present" : "MISSING"} · applied ${r.appliedCount}` +
      `/${r.migrationFileCount} file(s) · highest applied ${r.highestAppliedMigration ?? "none"}` +
      ` · highest on disk ${r.highestMigrationFile ?? "none"}`,
  );
  lines.push(
    `money type-floor triggers: ${r.installedTypefloorTriggers} installed / ` +
      `${r.expectedTypefloorTriggers} expected · missing ${r.missingTriggers.length} · ` +
      `definition mismatches ${r.mismatchedTriggers.length}`,
  );
  for (const p of r.problems) {
    lines.push(`  ${p.severity === "fail" ? "FAIL" : "WARN"} [${p.code}] ${p.detail}`);
  }
  if (r.ok && r.problems.length === 0) lines.push("  all checks passed");
  return lines.join("\n");
}

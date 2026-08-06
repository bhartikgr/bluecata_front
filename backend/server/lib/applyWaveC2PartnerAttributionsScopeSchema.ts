// server/lib/applyWaveC2PartnerAttributionsScopeSchema.ts
// Wave C-2 v26.6.0 — Self-heal for migration 0129 (LOCK 2 columns + unique index).
//
// V33-1-B1 pattern (spec §4.1): PRAGMA-guarded, idempotent, tolerates
// duplicate-column errors, safe to run before OR after the numbered migration.
//
// Runs at first rawDb() call of the process via applyInlineMigrations
// (server/db/connection.ts:191-341). Guarantees the LOCK-2 columns exist even
// if the operator has not yet run migration 0129 — the delegated-agency
// resolver (§7.2-D) can then read them without a NULL-column crash.
//
// Ownership: Wave C-2 owns this file end-to-end. No other wave has an edit claim.
//
// R2 FIX (root fix 5, SHARED-B1 item 4 / Opus BLOCK batch): this file's header
// previously claimed path `server/db/schemaHeals/applyWaveC2PartnerAttributionsScopeSchema.ts`.
// That directory does not exist in the real tree (`ls server/db/` -> `__tests__
// connection.ts index.ts migrate.ts migrations portable.ts schema.ts syncRepo.ts`).
// Corrected to `server/lib/`, matching the other four Wave C-2.b-f self-heal
// files and the spec's own §2/0131 V33-F1 instruction that these functions are
// registered from `server/db/connection.ts`. From `server/lib/`, `log` resolves
// via `./logger` (server/lib/logger.ts is a sibling file, not `../lib/logger`).
//
// R2 FIX (root fix 3, Opus BLOCKER B-b2 / V33-1-B1 violation): this was the
// ONLY self-heal in the C-2.b-f batch without a top-level try/catch. Wrapped
// the entire function body below in try { ... } catch (err) { log.warn(...) }
// following the applyWaveC2AuthorityArtifactsSchema.ts precedent
// (wave_c2_build/waves/c2_c_0130/). An unhandled throw here would take down
// the entire DB layer at first rawDb() call — the exact failure mode V33-1-B1
// exists to prevent.
//
// R2 FIX (root fix 2, Opus BLOCKER B-b1 / shared skip_log schema conflict):
// c2_backfill_skip_log now matches spec §2.1's canonical shape exactly:
// (id, source_table, source_id, missing_fk CHECK(...), reason, skipped_at).
// The previous shape (migration, subject_table, subject_id, payload_json,
// created_at) conflicted with 0132's CREATE TABLE IF NOT EXISTS of the same
// table — whichever ran first would win, and the other's INSERT would throw
// "table c2_backfill_skip_log has no column named ...". Also removed the
// false provenance claim ("created by migration 0125_wave_b_backups.sql") —
// grep-verified 0 hits for c2_backfill_skip_log anywhere in the tree; no
// migration creates this table today. This self-heal (and 0132's) is the
// actual origin.
//
// R2 FIX (root fix 6, SHARED-M1 / Opus MAJOR M-b2): the numbered migration's
// SQL (0129_wave_c2_partner_attributions_scope.sql) now carries an explicit
// pre-flight RAISE(ABORT) guard immediately before CREATE UNIQUE INDEX, so
// that if this TypeScript self-heal never ran (e.g. on the `npm run
// db:migrate` path, which never touches connection.ts / applyInlineMigrations)
// and live duplicate active pairs are present, the migration fails LOUDLY
// instead of having migrate.ts::isIdempotentSqliteError silently swallow the
// resulting `UNIQUE constraint failed` and record the migration as applied
// with the constraint actually absent. See the SQL file's own comment block
// for the exact guard statement.

import { log } from "./logger";

interface DbLike {
  /* APPLY-TIME FIX (A-APPLY-TS1): `all` was declared `all(): any[]` (zero-arity), matching
   * the eight sibling self-heal modules, but this is the ONLY one of the nine that binds
   * parameters into `.all(...)` — the duplicate-grain tie-break read at ~:160 calls
   * `.all(pair.partner_id, pair.company_id)`. Zero-arity therefore produced
   * `TS2554: Expected 0 arguments, but got 2`. Widened to variadic `any[]`, exactly
   * matching the `get`/`run` signatures already on this same interface. Type-only change:
   * no runtime behaviour is affected, and the other eight modules are left untouched
   * because none of them bind parameters. */
  prepare(sql: string): { all(...args: any[]): any[]; get(...args: any[]): any; run(...args: any[]): { changes: number; lastInsertRowid: number | bigint } };
  exec(sql: string): void;
}

/**
 * Adds the five LOCK-2 columns to `partner_attributions` and creates the
 * `uq_partner_attributions_active` partial unique index. Idempotent under
 * re-run; safe as a first-boot heal or as a post-migration verification pass.
 *
 * Pre-flight duplicate-grain check + tie-break rule are executed BEFORE the
 * unique index is created. If the pre-flight finds any (partner_id, company_id)
 * pair with >1 active row, all but the latest attributed_at are administratively
 * revoked with revoked_by='system:c2_migration_0129', and a row per revoked
 * attribution is appended to c2_backfill_skip_log for auditability
 * (missing_fk='duplicate_grain', per spec §2.1's CHECK vocabulary).
 *
 * V33-1-B1: catches all errors, log.warn-and-continue. Never throws — R2 fix,
 * this function previously had no top-level try/catch (Opus BLOCKER B-b2).
 */
export function applyWaveC2PartnerAttributionsScopeSchema(db: DbLike): void {
  try {
    // Guard: if partner_attributions does not exist yet (fresh boot, zero
    // migrations run), silently no-op — the numbered migration 0114 must run
    // first to create the base table.
    const tableExists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='partner_attributions'`
    ).get() as { name: string } | undefined;
    if (!tableExists) return;

    // Inspect existing columns via PRAGMA (avoids duplicate-column errors on re-run).
    const existingCols = new Set(
      (db.prepare(`PRAGMA table_info(partner_attributions)`).all() as Array<{ name: string }>)
        .map((r) => r.name)
    );

    // Five LOCK-2 columns: additive TEXT, no defaults, no NOT NULL. All nullable
    // by design — a legacy attribution row with none of them set means "no
    // operational engagement letter, no client_authority_scope, no linked artifact"
    // which the resolver (§7.2-D) fails closed on with typed 403.
    const lock2Columns: Array<[string, string]> = [
      // authority_artifact_id: BARE TEXT, no REFERENCES clause (V32-M8, spec §2.2/0129).
      // Application-layer enforcement only (§9.4 artifact-upload flow validates the
      // referenced authority_artifacts.id exists in the same transaction).
      ["authority_artifact_id", "TEXT"],
      ["client_authority_scope_json", "TEXT"],
      ["engagement_letter_effective_at", "TEXT"],
      ["engagement_letter_expires_at", "TEXT"],
      ["engagement_letter_revoked_at", "TEXT"],
    ];

    for (const [colName, colDef] of lock2Columns) {
      if (existingCols.has(colName)) continue;
      try {
        db.exec(`ALTER TABLE partner_attributions ADD COLUMN ${colName} ${colDef};`);
      } catch (e: any) {
        // Defense in depth: PRAGMA can race with a concurrent boot in dev; catch the
        // specific duplicate-column error and continue. Any other error re-throws
        // to the outer try/catch below (log.warn-and-continue, never kills boot).
        const msg = String(e?.message ?? "");
        if (!/duplicate column name/i.test(msg)) {
          throw e;
        }
      }
    }

    // Pre-flight duplicate-grain check (spec §5.2 canonical form).
    // Only run if partner_attributions has any rows AND revoked_at column exists
    // (which it does since migration 0114 created the base table with revoked_at).
    const dupePairs = db.prepare(
      `SELECT partner_id, company_id, COUNT(*) AS n
         FROM partner_attributions
        WHERE revoked_at IS NULL
        GROUP BY partner_id, company_id
       HAVING COUNT(*) > 1`
    ).all() as Array<{ partner_id: string; company_id: string; n: number }>;

    if (dupePairs.length > 0) {
      const migrationRunAt = new Date().toISOString();
      // c2_backfill_skip_log: spec §2.1 canonical shape, shared across
      // 0129/0132/0136. R2 fix — this table is NOT created by any existing
      // migration (grep-verified 0 hits for "c2_backfill_skip_log" in the
      // pre-Wave-C2 tree); the previous header's claim that migration 0125
      // created it was false and has been removed. CREATE TABLE IF NOT
      // EXISTS makes ownership order-independent between this self-heal and
      // 0132's identical declaration.
      db.exec(`
        CREATE TABLE IF NOT EXISTS c2_backfill_skip_log (
          id TEXT PRIMARY KEY NOT NULL,
          source_table TEXT NOT NULL,
          source_id TEXT NOT NULL,
          missing_fk TEXT NOT NULL CHECK (missing_fk IN ('company_id', 'partner_id', 'legacy_id', 'duplicate_grain', 'none')),
          reason TEXT NOT NULL,
          skipped_at TEXT NOT NULL
        );
      `);

      for (const pair of dupePairs) {
        // Fetch all active rows for this pair, ordered by attributed_at DESC.
        const activeRows = db.prepare(
          `SELECT id, attributed_at
             FROM partner_attributions
            WHERE partner_id = ? AND company_id = ? AND revoked_at IS NULL
            ORDER BY attributed_at DESC, id ASC`
        ).all(pair.partner_id, pair.company_id) as Array<{ id: string; attributed_at: string }>;
        // First row (latest attributed_at) is the keeper; all others are revoked.
        const toRevoke = activeRows.slice(1);
        for (const row of toRevoke) {
          db.prepare(
            `UPDATE partner_attributions
                SET revoked_at = ?, revoked_by = ?
              WHERE id = ?`
          ).run(migrationRunAt, "system:c2_migration_0129", row.id);
          db.prepare(
            `INSERT INTO c2_backfill_skip_log
               (id, source_table, source_id, missing_fk, reason, skipped_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(
            `skip_0129_${row.id}`,
            "partner_attributions",
            row.id,
            "duplicate_grain",
            "tie_break_active_duplicate",
            migrationRunAt,
          );
        }
      }
    }

    // Create the partial unique index (idempotent via IF NOT EXISTS).
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_attributions_active
        ON partner_attributions(partner_id, company_id)
        WHERE revoked_at IS NULL;
    `);
  } catch (err) {
    log.warn("[wave-c2-partner-attributions] self-heal skipped:", (err as Error).message);
  }
}

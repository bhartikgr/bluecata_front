/**
 * server/lib/platformConfigShapeSchema.ts — WAVE 314b · R265.5.
 *
 * GENERATED. Source of truth: migrations/0231_wave314_platform_config_shape_convergence.sql
 * (byte-identically mirrored at
 *  server/db/migrations/0231_wave314_platform_config_shape_convergence.sql).
 *
 * WHY THIS FILE EXISTS — THE MISSING INLINE-BOOTSTRAP MIRROR (R204, R265.5).
 * ------------------------------------------------------------------------
 * This platform has TWO schema paths:
 *   PATH 1  migrations/NNNN_*.sql, applied by server/db/migrate.ts. What a real
 *           deploy gets.
 *   PATH 2  the inline bootstrap inside server/db/connection.ts, which builds the
 *           sandbox database, the dev database and EVERY `:memory:` test database.
 *
 * W314 shipped migration 0231 into PATH 1 only. R265.5 called that disqualifying,
 * and `npm run lint:schema-path-parity` AGREES MECHANICALLY: before this file
 * existed the check exited rc=1 with eleven NEW divergences, one per column 0231
 * adds. That is not an argument, it is a gate.
 *
 * WHY THE MIRROR IS *HERE* AND NOT IN connection.ts.
 * `server/db/connection.ts` is SACRED-FROZEN — scripts/sacred_check.sh enforces
 * sha256 8a73c3d1…defeef0 for it (ADDED_WAVE50), and it already carries WAIVER-6.
 * Editing it would break the 48/48 sacred gate and require a TENTH waiver, which
 * the brief forbids absolutely. The tree's established answer to exactly this
 * situation is a self-heal installer beside the frozen file that executes the
 * CANONICAL MIGRATION TEXT rather than a hand-copied paraphrase that could drift
 * — the arrangement used by server/lib/mfaSchema.ts (W305),
 * server/lib/rateLimitStoreSchema.ts (W21) and eight others.
 * scripts/lint/schema-path-parity.mjs names that as the accepted remedy in its
 * own failure message.
 *
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT DO.
 *   · It applies ONLY the `ALTER TABLE platform_config ADD COLUMN` statements
 *     parsed out of the migration text, and only those whose column is ABSENT
 *     per `PRAGMA table_info`. It re-inspects on every call, so it is correct on
 *     a database another path has already widened.
 *   · It executes NO INSERT. The bootstrap seeds its own six genesis rows through
 *     the audited history-first path in connection.ts; replaying 0231's seed here
 *     would be a second writer of the same rows. Row parity between the two paths
 *     is PROVED by probe, not assumed.
 *   · It contains no DROP, no DELETE, no table rebuild (R195.5).
 *
 * DRIFT IS FAILED LOUDLY, NOT ASSUMED AWAY: server/__tests__/w314b_platform_config_shape_mirror.test.ts
 * asserts PLATFORM_CONFIG_SHAPE_SQL is byte-identical to BOTH .sql copies.
 */

/** The migration this module mirrors. Referenced as a VALUE, not in a comment,
 *  so scripts/lint/schema-path-parity.mjs (which strips comments first) can see
 *  it. */
export const PLATFORM_CONFIG_SHAPE_MIGRATION =
  "0231_wave314_platform_config_shape_convergence.sql";

/** The migration file, verbatim. Only \\ ` and ${ are escaped for the template
 *  literal; JS unescapes them back to the exact file bytes. */
export const PLATFORM_CONFIG_SHAPE_SQL = `-- 0231 · WAVE 314 · platform_config SHAPE CONVERGENCE (ADDITIVE ONLY)
--
-- THE DEFECT (reproduced empirically, build_log/wave314/probes/w314_premise_repro.mjs).
-- Two migrations create \`platform_config\` with two INCOMPATIBLE shapes:
--
--   migrations/0000_numerous_roxanne_simpson.sql:166  (OLD shape, non-STRICT)
--     key, value, version, prev_hash, hash, updated_at, updated_by
--
--   migrations/0123_wave0_platform_config.sql:34      (NEW shape, STRICT)
--     key, value_json, value_type, description, is_secret, version,
--     prev_revision_hash, revision_hash, created_at, updated_at,
--     created_by, updated_by
--
-- 0123 uses \`CREATE TABLE IF NOT EXISTS\`. When 0000 has already created the
-- table, 0123's CREATE is a no-op — the OLD shape survives and the NEW shape
-- never lands. 0123 then CONTINUES: it creates \`platform_config_history\` in the
-- NEW shape, both indexes, and all eight triggers, and finally ABORTS on its own
-- genesis seed with the exact string the live server printed:
--
--     table platform_config has no column named value_json
--
-- The observable end state on such a database is:
--   · platform_config     — OLD shape, ZERO rows (the genesis seed never landed)
--   · platform_config_history — NEW shape, 6 genesis rows, all 8 triggers present
--   · every \`value_json\` read throws  \`no such column: value_json\`
--   · every write throws              \`no such column: NEW.revision_hash\`
--     (raised from inside trg_pc_chain_guard, which 0123 DID install)
--
-- Both directions have live consumers, so neither column set may be abandoned:
--   · NEW columns are read/written by server/lib/platformConfigWriter.ts and its
--     eight importing stores (see W314_BUILD.md for the full enumeration).
--   · OLD columns are read/written by server/adminPlatformStore.ts through the
--     drizzle table \`platformConfig\` in shared/schema.ts:743.
--
-- THE REPAIR. Converge the COLUMN SET to the UNION of both shapes, on whichever
-- shape the database happens to have. Every statement below is an additive
-- \`ALTER TABLE ... ADD COLUMN\` or a guarded \`UPDATE\`. Nothing is dropped,
-- recreated, rewritten or deleted. Every ADD COLUMN is nullable or carries a
-- constant default, which is the only form SQLite permits and also the only form
-- that cannot fail against existing rows.
--
-- IDEMPOTENCE. On a database that already has a column, \`ADD COLUMN\` fails with
-- \`duplicate column name\`, which server/db/migrate.ts:296 isIdempotentSqliteError()
-- classifies as idempotent and skips. Re-running this file is therefore a no-op.
-- That is also precisely why this file is safe on BOTH shapes: each ALTER lands
-- on the shape that lacks the column and is skipped on the shape that has it.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO.
--   · It does NOT make the OLD-shape table STRICT and does NOT add the
--     table-level CHECK constraints from 0123. SQLite cannot add either with
--     ALTER TABLE; both would require a table rebuild, which is forbidden here.
--     \`sqlite_master\` therefore CANNOT be made byte-identical between a
--     0000-built and a 0123-built database without destructive SQL. The COLUMN
--     SET converges; the table's STRICT-ness and its table-level CHECKs do not.
--     This is stated plainly in W314_FOR_THE_OWNER.md rather than papered over.
--   · It does NOT fix server/adminPlatformStore.ts. On a NEW-shape database that
--     store's write path is blocked by trg_pc_no_direct_insert regardless of
--     which columns exist, because it does not write the audit history row that
--     trigger demands. That is a code defect, not a schema defect.

-- ---------------------------------------------------------------- NEW columns,
-- added when the database was built the 0000 way. Skipped as \`duplicate column
-- name\` when it was built the 0123 way.

ALTER TABLE platform_config ADD COLUMN value_json TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN value_type TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN description TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN prev_revision_hash TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN revision_hash TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN created_at TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN created_by TEXT;
--> statement-breakpoint

-- ---------------------------------------------------------------- OLD columns,
-- added when the database was built the 0123 way. Skipped as \`duplicate column
-- name\` when it was built the 0000 way. These exist so that the drizzle table in
-- shared/schema.ts:743 — which server/adminPlatformStore.ts selects through —
-- cannot throw a column-drift error on a NEW-shape database.

ALTER TABLE platform_config ADD COLUMN value TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN prev_hash TEXT;
--> statement-breakpoint
ALTER TABLE platform_config ADD COLUMN hash TEXT;
--> statement-breakpoint

-- ------------------------------------------------- GENESIS SEED REPLAY (DATA).
-- WHY THE DATA REPAIR IS *THIS* AND NOT AN \`UPDATE\`.
-- The audit chain is a sha256 over a canonical string, computed in TypeScript
-- (computeRevisionHash, server/lib/platformConfigWriter.ts:59). SQLite has no
-- sha256, so a .sql file CANNOT compute a valid revision_hash. Any hash a
-- migration invented would be rejected by trg_pch_chain_integrity, or worse,
-- accepted and then fail every later chain verification. A pure-SQL data
-- backfill of this table is therefore not merely awkward, it is impossible to
-- do correctly. Proven empirically: seeding a forged genesis row aborts with
-- PLATFORM_CONFIG_HISTORY_CHAIN_BREAK (build_log/wave314/probes/).
--
-- What CAN be done correctly is to replay 0123's OWN genesis seed, whose hashes
-- were computed by that same TypeScript function and are literals in the file.
-- Above, the ALTERs have just made \`value_json\` exist, so the INSERT that
-- aborted on the live server can now land. \`INSERT OR IGNORE\` makes it a no-op
-- where the rows are already present, which is the 0123-built case.
--
-- This is also why no \`UPDATE\` appears anywhere in this file: on a 0000-built
-- database \`platform_config\` is EMPTY (0123's seed aborted before inserting a
-- single row, and trg_pc_chain_guard makes any subsequent OLD-shape INSERT
-- raise \`no such column: NEW.revision_hash\`), so there is nothing to update and
-- nothing that can be lost. Both facts are asserted by the probe harness.
--
-- The rows below are byte-identical to migrations/0123_wave0_platform_config.sql.

INSERT OR IGNORE INTO platform_config_history
  (history_id, config_key, version, snapshot_json, prev_revision_hash, revision_hash, changed_at, changed_by, change_kind)
VALUES
  ('pch_gen_quota_default_period', 'quota.default_period', 1,
   '{"v":1,"key":"quota.default_period","vt":"string","val":"\\"monthly\\""}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   'e99068df51f72853c7b31758d7b4009464e6fb2f73c202c5bc8432db1e12cc8d',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_billing_cycle_default', 'billing_cycle.default', 1,
   '{"v":1,"key":"billing_cycle.default","vt":"string","val":"\\"annual\\""}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a2115296c7d01f78918ddc8870d3cbbee938213439a50162838e29a3c939fd66',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_feeds_provider_default', 'feeds.provider.default', 1,
   '{"v":1,"key":"feeds.provider.default","vt":"string","val":"\\"none\\""}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   '952b9e62c6fd7ef2c44ab8564fb9a65191a30a14a607e962009a3d725eec841a',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_review_window', 'collective.partner_membership.review_window_days', 1,
   '{"v":1,"key":"collective.partner_membership.review_window_days","vt":"number","val":"30"}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a326ea08fc5a968ff83d51e594c4bcb3053402bcb1ac01b057e3f5765d935d80',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_grace_days', 'collective.partner_membership.grace_days_after_expiry', 1,
   '{"v":1,"key":"collective.partner_membership.grace_days_after_expiry","vt":"number","val":"0"}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   'afe1b04a5296ff5c36ebd93aba71c9d143e834280d7d36faebc985b79058c815',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis'),
  ('pch_gen_kyc_gate_mode', 'kyc.capital_call.gate_mode', 1,
   '{"v":1,"key":"kyc.capital_call.gate_mode","vt":"string","val":"\\"warn\\""}',
   '0000000000000000000000000000000000000000000000000000000000000000',
   '22d5b402c900a307e5c14da41dac3713bbd64c3915b1b4e71a2b7664010a5834',
   '2026-08-01T00:00:00Z', 'system:wave0_seed', 'genesis');

-- Now the current-state rows, which trg_pc_no_direct_insert lets through only
-- because the matching history genesis rows now exist.
-- Hashes are canonical-JSON-preimage deterministic (see file header). Formula:
--   sha256hex(JSON.stringify({v: 1, key, vt: value_type, val: value_json,
--                             prev: '0'*64}))
-- Preimage examples in the header comment of each row below.
-- ONE DELIBERATE DIFFERENCE FROM 0123's SEED, AND WHY.
-- 0123's seed does not list \`value\`. On the OLD shape \`value\` is \`TEXT NOT NULL\`
-- with no default, so that seed aborts with \`NOT NULL constraint failed:
-- platform_config.value\` — and because the statement is \`INSERT OR IGNORE\`, the
-- abort is SWALLOWED and the statement inserts NOTHING while reporting success.
-- The first draft of this migration shipped exactly that silent no-op and the
-- probe harness caught it (0 rows seeded, 0 errors reported). \`value\` is
-- therefore listed here and set to the SAME JSON text as \`value_json\`, which
-- both satisfies the OLD shape's NOT NULL and gives the OLD-shape reader in
-- server/adminPlatformStore.ts a real value instead of NULL. Every
-- revision_hash below is unchanged from 0123, so the audit chain still verifies.

INSERT OR IGNORE INTO platform_config
  (key, value, value_json, value_type, description, is_secret, version, prev_revision_hash, revision_hash, created_at, updated_at, created_by, updated_by)
VALUES
  -- Preimage: {"v":1,"key":"quota.default_period","vt":"string","val":"\\"monthly\\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('quota.default_period', '"monthly"', '"monthly"', 'string',
   'Default quota period for partner tier plans. Editable in Wave F (F-QP1).', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'e99068df51f72853c7b31758d7b4009464e6fb2f73c202c5bc8432db1e12cc8d',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"billing_cycle.default","vt":"string","val":"\\"annual\\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('billing_cycle.default', '"annual"', '"annual"', 'string',
   'Default billing cycle for new partners. Owner decision 5.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a2115296c7d01f78918ddc8870d3cbbee938213439a50162838e29a3c939fd66',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"feeds.provider.default","vt":"string","val":"\\"none\\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('feeds.provider.default', '"none"', '"none"', 'string',
   'Default market-data feeds provider. Wave F admin surface configures per-tenant.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   '952b9e62c6fd7ef2c44ab8564fb9a65191a30a14a607e962009a3d725eec841a',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"collective.partner_membership.review_window_days","vt":"number","val":"30","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('collective.partner_membership.review_window_days', '30', '30', 'number',
   'Days admin has to review annual Collective-membership renewal. Owner decision 7.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'a326ea08fc5a968ff83d51e594c4bcb3053402bcb1ac01b057e3f5765d935d80',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"collective.partner_membership.grace_days_after_expiry","vt":"number","val":"0","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('collective.partner_membership.grace_days_after_expiry', '0', '0', 'number',
   'Grace days after Collective membership expiry before access is revoked. Owner decision 7.', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   'afe1b04a5296ff5c36ebd93aba71c9d143e834280d7d36faebc985b79058c815',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed'),
  -- Preimage: {"v":1,"key":"kyc.capital_call.gate_mode","vt":"string","val":"\\"warn\\"","prev":"0000000000000000000000000000000000000000000000000000000000000000"}
  ('kyc.capital_call.gate_mode', '"warn"', '"warn"', 'string',
   'KYC gate behavior on capital calls: warn|block. Owner decision 9 (soft warn everywhere).', 0, 1,
   '0000000000000000000000000000000000000000000000000000000000000000',
   '22d5b402c900a307e5c14da41dac3713bbd64c3915b1b4e71a2b7664010a5834',
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'system:wave0_seed', 'system:wave0_seed');

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_platform_config_updated_at ON platform_config(updated_at);
`;

/** Every `ALTER TABLE platform_config ADD COLUMN <c> …` statement in the
 *  migration, parsed out of the canonical text. Comments are stripped first so a
 *  commented-out ALTER cannot be counted (the decoy class of R237.4). */
export function platformConfigShapeAlters(): Array<{ column: string; sql: string }> {
  const stripped = PLATFORM_CONFIG_SHAPE_SQL.split("\n")
    .map((l) => (l.trimStart().startsWith("--") ? "" : l))
    .join("\n");
  const out: Array<{ column: string; sql: string }> = [];
  const re = /ALTER\s+TABLE\s+platform_config\s+ADD\s+COLUMN\s+([A-Za-z0-9_]+)[^;]*;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    out.push({ column: m[1].toLowerCase(), sql: m[0].replace(/\s+/g, " ").trim() });
  }
  return out;
}

export interface PlatformConfigShapeResult {
  /** false when the table does not exist at all — nothing was attempted. */
  tablePresent: boolean;
  /** columns this call added. */
  applied: string[];
  /** columns already present, so skipped. */
  alreadyPresent: string[];
  /** columns whose ALTER threw for a reason other than duplication. */
  failed: Array<{ column: string; message: string }>;
}

/**
 * Converge `platform_config` to the migration's column set on the handle given.
 *
 * READ THE RESULT. It reports what it did; it does not report success it did not
 * achieve (R265.1). It throws only if the caller passes something that is not a
 * database handle.
 */
export function ensurePlatformConfigShape(db: {
  prepare: (sql: string) => { all: (...a: unknown[]) => unknown[] };
  exec: (sql: string) => unknown;
}): PlatformConfigShapeResult {
  const res: PlatformConfigShapeResult = {
    tablePresent: false,
    applied: [],
    alreadyPresent: [],
    failed: [],
  };
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_config'")
    .all() as Array<{ name: string }>;
  if (tables.length === 0) return res;
  res.tablePresent = true;
  const have = new Set(
    (db.prepare("PRAGMA table_info(platform_config)").all() as Array<{ name: string }>).map((r) =>
      String(r.name).toLowerCase(),
    ),
  );
  for (const a of platformConfigShapeAlters()) {
    if (have.has(a.column)) {
      res.alreadyPresent.push(a.column);
      continue;
    }
    try {
      db.exec(a.sql);
      res.applied.push(a.column);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (/duplicate column name/i.test(msg)) res.alreadyPresent.push(a.column);
      else res.failed.push({ column: a.column, message: msg });
    }
  }
  return res;
}

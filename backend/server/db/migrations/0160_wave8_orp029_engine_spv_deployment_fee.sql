-- migrations/0160_wave8_orp029_engine_spv_deployment_fee.sql
-- WAVE 8 — ORP-029 / DEF-029. "Charge the SPV deployment fee for engine-created
-- SPVs." PLATFORM_ORPHAN_AUDIT finding #3 / §E1, severity CRITICAL, class
-- ACCIDENTAL. OQ-15 recorded this capability as BUILT; it is built, but the
-- trigger is wrong, so it has never fired for a single engine SPV.
--
-- THE DEFECT, RE-VERIFIED AGAINST THIS TREE ON 2026-08-10 (line numbers in the
-- audit had drifted; the facts had not):
--   * server/lib/spvDeploymentFee.ts:58   chargeSpvDeploymentFee() — the fee.
--   * server/spvFundStore.ts:1204         its SOLE production call site, guarded
--                                         by `next.status === "active" && spv.status !== "active"`.
--                                         (Audit cited :1114 — the guard is now
--                                         at :1204. Claim verified, line stale.)
--   * shared/spvEngine.ts:70              SPV_STATUSES = draft | open | closed |
--                                         deployed | distributing | wound_down.
--                                         There is NO "active". (Audit cited
--                                         :42-44; the enum is now at :70.)
--   * `grep -n "DeploymentFee" server/spvEngineStore.ts` → no matches. The
--     canonical engine charges nothing when it emits spv.deployed (:1455).
--   Net effect: the consortium partner SPV deployment fee is never charged.
--   Direct revenue loss.
--
-- WHY THIS MIGRATION IS NEEDED AT ALL — THE PART THE AUDIT DID NOT SAY.
--   The two SPV systems use two different tables:
--     legacy  spvFundStore  → `spvs`  (HAS deployment_fee_minor,
--                             deployment_fee_currency, deployment_fee_payer,
--                             deployment_fee_paid_at, deployment_fee_schedule_id)
--     engine  spvEngineStore→ `spv`   (has NONE of them)
--   chargeSpvDeploymentFee() stamps `spvs` by name. Simply calling it from the
--   engine's deploy transition would have billed the partner while UPDATE-ing
--   zero rows — a charge with no record on the SPV, and an idempotency probe
--   (`SELECT deployment_fee_paid_at ... FROM spvs`) that can never see its own
--   write. That is precisely the "fix that sits where the data does not flow"
--   failure mode. This migration gives the engine's table the same five
--   columns so the stamp lands on the row that actually exists.
--
-- MIGRATION NUMBER — 0160. RENUMBERED FROM 0152 UNDER A LIVE COLLISION WARNING.
--   This file was first written as 0152, verified at the time as the first free
--   number (both directories then ended at 0151_wave3e_fee_settlement_
--   authorization.sql). Three waves were writing this tree concurrently and
--   0152 was reported as claimed by two of them, so it was renumbered rather
--   than raced. Re-verified on disk at renumber time (2026-08-10): both
--   `migrations/` and `server/db/migrations/` hold 0150, 0151, 0152 (this file,
--   now moved), 0153 (Wave 5), 0156 and 0157 (Wave 6), and 0159 (Wave 9).
--   0160 is above every number present in either directory and is held by
--   nobody, so it also sorts AFTER Wave 9's 0159 and cannot be skipped by a
--   sequential runner that has already advanced past it. Nothing in the tree
--   referenced the old filename (grepped across *.ts, *.json, *.sh). The 0135,
--   0154, 0155 and 0158 gaps are not backfilled.
--
-- SACRED FILES: none touched. server/db/connection.ts and server/db/migrate.ts
-- are not modified by this wave. This is a new file only, mirrored
-- byte-identically into server/db/migrations/.
--
-- IDEMPOTENCY: SQLite has no `ADD COLUMN IF NOT EXISTS`. The runner
-- (server/db/migrate.ts:290, sacred, unmodified) executes each statement
-- separately and treats /duplicate column name/i as "already applied" and
-- swallows it — this is the established in-tree pattern for additive columns,
-- not a new convention invented here. A second run of this file is therefore a
-- no-op, and the index is `IF NOT EXISTS`. Verified by running the migration
-- twice against a fixture DB and diffing the schema (see the migration test).
--
-- ROLLBACK: the five columns are nullable and additive. Leaving them in place
-- is harmless; no code path requires them to be non-null. A rollback that
-- wanted them gone would need a table rebuild, which is NOT worth doing for
-- nullable additive columns and is explicitly not provided.
-- ─────────────────────────────────────────────────────────────────────────────

-- The five deployment-fee columns, mirroring the legacy `spvs` shape exactly so
-- one helper can stamp either table. All nullable: an SPV that has not been
-- deployed, or whose partner tier has no configured fee band, correctly carries
-- NULLs rather than a guessed zero.
ALTER TABLE spv ADD COLUMN deployment_fee_minor INTEGER;
ALTER TABLE spv ADD COLUMN deployment_fee_currency TEXT;
ALTER TABLE spv ADD COLUMN deployment_fee_payer TEXT;
ALTER TABLE spv ADD COLUMN deployment_fee_paid_at TEXT;
ALTER TABLE spv ADD COLUMN deployment_fee_schedule_id TEXT;

-- Idempotency + lookup: the fee hook probes "has this SPV already been
-- charged?" against partner_billing_entries first (that table is shared by both
-- the legacy and the engine path and is the authoritative money record). This
-- index makes that probe an index seek rather than a scan of every billing row.
CREATE INDEX IF NOT EXISTS idx_pbe_spv_fund_entry_kind
  ON partner_billing_entries (spv_fund_id, entry_kind);

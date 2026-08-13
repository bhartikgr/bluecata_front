-- migrations/0162_wave3f_deployment_fee_billing.sql
-- WAVE 3F — ITEM 4. W10 REVIEW A, MAJOR: "Deployment-fee failure is swallowed
-- after deployment, and the only commit route cannot retry it."
--
-- THE DEFECT.
--   server/spvEngineStore.ts   — persists `deployed` and the cap-table ledger
--                                reference BEFORE invoking the fee hook.
--   server/lib/spvEngineDeploymentFeeHook.ts:105-136 — raw-DB, configuration and
--                                unexpected failures all return { charged:false }
--                                and the deployment stands.
--   server/spvEngineRoutes.ts:506 — any subsequent commit returns
--                                409 ALREADY_COMMITTED.
--   No fee retry/re-trigger operation exists anywhere in the frozen routes.
-- Net effect: a transient driver failure, a missing fee band or an unresolvable
-- partner tier leaves a DEPLOYED SPV PERMANENTLY UNBILLED, and the hook's own
-- log line tells an admin to "re-trigger" something that cannot be re-triggered.
-- The un-charged SPV was described as "queryable" only as the absence of a
-- value (NULL deployment_fee_minor) — an absence carries no reason, no attempt
-- count and no partner, so it cannot drive a retry.
--
-- WHAT THIS MIGRATION ADDS. `spv_deployment_fee_billing`: ONE durable row per
-- deployed engine SPV recording that a deployment fee is OWED, who owes it, how
-- many times collection has been attempted and why the last attempt failed.
--   state = 'pending' → owed and not yet collected. THIS IS THE RETRY QUEUE.
--   state = 'charged' → collected (or already collected upstream). Terminal.
-- The row is written BEFORE the charge is attempted, so the obligation survives
-- even a crash mid-charge, and the idempotent retry
-- (`retryEngineSpvDeploymentFee`, exposed as
--  POST /api/admin/consortium-spv/:spvId/deployment-fee/retry) works off it.
--
-- IDEMPOTENCY OF THE MONEY, UNCHANGED. This table does not become a second
-- source of truth for whether money moved. `chargeSpvDeploymentFee` still
-- short-circuits on an existing `partner_billing_entries` row or a non-NULL
-- `deployment_fee_minor`, so a replayed retry cannot double-charge even if this
-- row were stale.
--
-- MIGRATION NUMBER — 0162. Verified on disk 2026-08-10: highest present in both
-- `migrations/` and `server/db/migrations/` was 0160; 0161 is this wave's
-- partner-tier canon, written immediately before this file. 0152, 0154, 0155
-- and 0158 remain BURNT per ruling A-17 and are not reused.
--
-- SACRED FILES: none touched. New file only, mirrored BYTE-IDENTICALLY into
-- server/db/migrations/0162_wave3f_deployment_fee_billing.sql.
--
-- IDEMPOTENCY: CREATE TABLE / CREATE INDEX IF NOT EXISTS only. Re-running is a
-- no-op. ROLLBACK: DROP TABLE spv_deployment_fee_billing — no other table
-- references it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spv_deployment_fee_billing (
  spv_id           TEXT PRIMARY KEY NOT NULL,
  partner_id       TEXT NOT NULL,
  -- 'pending' = owed, collection not yet successful (the retry queue).
  -- 'charged' = collected. Terminal.
  state            TEXT NOT NULL CHECK (state IN ('pending','charged')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_reason      TEXT,
  last_attempt_at  TEXT,
  amount_minor     INTEGER,
  currency         TEXT,
  charged_at       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) STRICT;

-- The worker/admin query: "which deployed SPVs still owe a deployment fee?"
CREATE INDEX IF NOT EXISTS idx_sdfb_state_updated
  ON spv_deployment_fee_billing (state, updated_at);
CREATE INDEX IF NOT EXISTS idx_sdfb_partner
  ON spv_deployment_fee_billing (partner_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- WAVE 207 · ITEM A · R195.1 / R180.3 — A CAPITAL BASIS BECOMES UNREPRESENTABLE.
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THE OWNER ASKED FOR, VERBATIM
--   "Remove the capital dimension. Do NOT change the amount resolution."
--   "Make a capital band structurally unrepresentable, not merely unused."
--   "Keep the banding mechanism. I need to have the option/flexibility to charge in
--    the future so do not archive the functionality."
--
-- WHAT WAS TRUE BEFORE THIS MIGRATION, MEASURED — NOT ASSUMED
--   `pickBandRow()` (server/lib/partnerFeeResolver.ts:114-135) picks WHICH ROW of a
--   precedence level applies by testing a size against size_band_min/size_band_max.
--   The size it is handed is confirmed capital
--   (server/lib/spvEngineDeploymentFeeHook.ts:419-432). But the only spv_deployment
--   rows that carry bands are the four PLATFORM-DEFAULT rows pfs_def_spv_band1..4
--   seeded by 0054, all priced amount_minor = 0 — and resolveSpvDeploymentFee
--   DISCARDS a platform_default answer in favour of the flat authoritative
--   platform_fees row `consortium.spv_deployment_fee`. So capital was computed and
--   passed on every charge while NO PRICED CAPITAL BAND DECIDED ANY AMOUNT.
--   Full evidence: build_log/wave207/W207_PREFLIGHT.md §1.
--
-- ── WHAT THIS MIGRATION DOES NOT DO ─────────────────────────────────────────────
--   It inserts NO priced row. It updates NO existing row. It deletes and expires
--   NOTHING. It does not touch size_band_min, size_band_max, amount_minor, currency,
--   or any resolver. Every fee resolves to exactly the amount it resolved to before,
--   because nothing this file creates is read by any amount-deciding code path.
--   A new column with a default cannot move a number; a trigger that only ever
--   REFUSES A WRITE cannot move one either.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────────────────
--   1. `basis_dimension` on partner_fee_schedules, NOT NULL DEFAULT
--      'flat_per_vehicle', with a CHECK naming the permitted set explicitly. The set
--      contains no dimension that measures money, so a row CANNOT declare that it is
--      decided by capital, target raise, amount invested or transaction value. This
--      is the fence: not a policy, not a code branch, a constraint. Proved by
--      attempting the raw insert — see
--      server/__tests__/wave207_itemA_fee_basis_dimension.test.ts.
--
--   2. Two triggers refusing the SHAPE "a band on a flat basis". The column alone
--      stops a row from DECLARING capital; these stop a row from being SILENTLY
--      capital-banded while declaring itself flat.
--
--      WHY THE UPDATE TRIGGER IS CONDITIONAL. An unconditional "flat basis means the
--      bands must be NULL" rule would make the four legacy $0 band rows uneditable:
--      an administrator could no longer change their amount or expire them, which
--      would be a functional regression introduced by a fence. So the UPDATE arm
--      fires only when the update INTRODUCES OR ALTERS a band. Amount-only and
--      window-only edits of legacy banded rows keep working exactly as before.
--
--      The four legacy rows themselves are left alone and are not rewritten to claim
--      a dimension they do not have. A CHECK is not evaluated against rows that
--      already exist, and a label applied by a migration would be an assertion the
--      platform cannot support. They stay as they are: priced 0, demoted out of the
--      decision, and documented.
--
-- ── THE BANDING MECHANISM SURVIVES ──────────────────────────────────────────────
--   Bands remain fully available. What changes is what a band is allowed to MEAN:
--   the number of investors, the jurisdictions involved, the number of documents, or
--   how long the vehicle is administered. A future rate can still be banded. It can
--   never again be banded on money.
--
-- ── THE PERMITTED SET IS DECLARED IN TWO PLACES ON PURPOSE ──────────────────────
--   Here (enforced) and in shared/wave207FeeBasisDimension.ts (rendered). The
--   wave-207 test parses BOTH and asserts the lists are identical, so they cannot
--   drift apart in silence.
--
-- ── THE platform_config KEY IS NOT WRITTEN HERE ─────────────────────────────────
--   `platform_config` rows are hash-chained (0123: revision_hash over canonical JSON
--   of {v,key,vt,val,prev}). No migration in this tree inserts one, because the
--   preimage is computed in TypeScript. `fee.vehicle.basis_dimension` is therefore
--   seeded by ensureWave207FeeBasisDimension() in server/lib/wave207FeeBasisPolicy.ts
--   through the existing attributed writer ensurePlatformConfigKey(). Writing it in
--   raw SQL here would have meant hand-rolling a hash chain in a migration.
--
-- Three-place rule (ADR-6):
--   1. migrations/0217_wave207_fee_basis_dimension.sql (this file)
--   2. server/db/migrations/0217_wave207_fee_basis_dimension.sql (byte-identical mirror)
--   3. ensureWave207FeeBasisDimension() in server/lib/wave207FeeBasisPolicy.ts —
--      NOT in server/db/connection.ts, which is SACRED and frozen (WAVE50/WAIVER-6).
--      The installer lives in a non-sacred module that the fee write path calls for
--      itself, exactly as wave 152 did for migrations 0160 and 0200.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE partner_fee_schedules
  ADD COLUMN basis_dimension TEXT NOT NULL DEFAULT 'flat_per_vehicle'
    CHECK (basis_dimension IN (
      'flat_per_vehicle',
      'investor_count',
      'jurisdiction_complexity',
      'document_count',
      'duration'
    ));

DROP TRIGGER IF EXISTS w207_fee_basis_no_capital_band_ins;
CREATE TRIGGER w207_fee_basis_no_capital_band_ins
  BEFORE INSERT ON "partner_fee_schedules"
  FOR EACH ROW WHEN NEW."basis_dimension" = 'flat_per_vehicle'
    AND (NEW."size_band_min" IS NOT NULL OR NEW."size_band_max" IS NOT NULL)
  BEGIN SELECT RAISE(ABORT, 'WAVE207/0217 fee basis: a flat per-vehicle fee cannot carry a size band. Bands are read against investors, jurisdictions, documents or duration — never capital. Set basis_dimension to one of those first.'); END;

DROP TRIGGER IF EXISTS w207_fee_basis_no_capital_band_upd;
CREATE TRIGGER w207_fee_basis_no_capital_band_upd
  BEFORE UPDATE ON "partner_fee_schedules"
  FOR EACH ROW WHEN NEW."basis_dimension" = 'flat_per_vehicle'
    AND (NEW."size_band_min" IS NOT NULL OR NEW."size_band_max" IS NOT NULL)
    AND (IFNULL(NEW."size_band_min", -1) <> IFNULL(OLD."size_band_min", -1)
      OR IFNULL(NEW."size_band_max", -1) <> IFNULL(OLD."size_band_max", -1))
  BEGIN SELECT RAISE(ABORT, 'WAVE207/0217 fee basis: a size band cannot be added to or changed on a flat per-vehicle fee. Bands are read against investors, jurisdictions, documents or duration — never capital.'); END;

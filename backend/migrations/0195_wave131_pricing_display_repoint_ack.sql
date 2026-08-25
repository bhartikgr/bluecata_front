-- migrations/0195_wave131_pricing_display_repoint_ack.sql
--
-- WAVE 131 — R96 requirement 5: **DO NOT SILENTLY REPRICE A LIVE CUSTOMER.**
--
-- ── THE DEFECT THIS TABLE EXISTS TO MAKE SAFE ──────────────────────────────
--
-- Three fee kinds are DISPLAYED from one table and CHARGED from another:
--
--   * `server/lib/wave15FeeScheduleAggregate.ts` resolved
--     `subscription_monthly`, `subscription_annual` and `spv_deployment`
--     through `resolvePartnerFee(...)` — i.e. through `partner_fee_schedules`,
--     the SECOND admin-writable table, whose migration seeds are every one
--     `amount_minor = 0` (migrations/0054_v25_33_partner_payment_model.sql:149-156).
--   * The CHARGE paths read elsewhere: subscriptions from `partner_tier_price`
--     (`server/lib/partnerEffectivePlan.ts`, `server/lib/partnerTiers.ts`), and
--     the SPV deployment fee from `platform_fees` key
--     `consortium.spv_deployment_fee` (`server/lib/spvDeploymentFeeSource.ts`).
--
-- Wave 131 repoints the DISPLAY onto the authoritative source so displayed ==
-- charged. But flipping that read is, for any partner whose displayed number
-- differs from the authoritative number, a REPRICE OF WHAT THEY ARE SHOWN. R96
-- requirement 5 forbids doing that silently. So the repoint is not a code flag:
-- it is an ADMIN DECISION, recorded here, per fee kind, with BOTH numbers as
-- they stood at the moment of the decision.
--
-- Until a row exists for a fee kind, the partner keeps seeing exactly what they
-- see today and the admin console shows the divergence with a Confirm control.
-- After the row exists, the display reads the authoritative source. Nothing is
-- deleted and nothing is auto-migrated.
--
-- MONEY. Integer minor units, exactly as the resolvers return them. No `/100`,
-- no `*100`, no float, and no amount is defaulted: an unresolvable side is
-- stored as NULL so "we could not read it" stays distinguishable from "$0".
--
-- ADDITIVE ONLY. One new table. No ALTER of an existing table, no data
-- rewrite, no DROP. `server/db/connection.ts` is SACRED (WAVE50 manifest entry)
-- and is NOT touched: the store self-heals with a
-- `CREATE TABLE IF NOT EXISTS` guard for dev/test harnesses that boot from
-- connection.ts rather than the numbered runner, which is the same pattern
-- migrations 0188 and 0193 record.
--
-- IDEMPOTENT. `CREATE TABLE IF NOT EXISTS` plus a named `CREATE INDEX IF NOT
-- EXISTS`, so re-running is a no-op rather than an error the runner has to
-- swallow.

CREATE TABLE IF NOT EXISTS pricing_display_repoint_ack (
  id                          TEXT PRIMARY KEY,
  -- One row per fee kind. UNIQUE so a second confirmation updates the decision
  -- rather than silently stacking a second, contradictory one.
  fee_kind                    TEXT NOT NULL UNIQUE,
  -- What partners were being SHOWN (resolved from partner_fee_schedules) at the
  -- moment of the decision. NULL means the legacy read could not answer.
  displayed_amount_minor      INTEGER,
  displayed_currency          TEXT,
  -- What they will be shown afterwards: the authoritative source's answer.
  authoritative_amount_minor  INTEGER,
  authoritative_currency      TEXT,
  -- The table that becomes the display source: 'partner_tier_price' for the
  -- subscription kinds, 'platform_fees' for spv_deployment. Stored as text so
  -- the decision remains readable after any future code rename.
  authoritative_source        TEXT NOT NULL,
  -- The period the authoritative row carries ('annual', 'monthly', 'one_off').
  -- Carried, never assumed: a NULL cadence must stay NULL.
  billing_period              TEXT,
  acknowledged_by_user_id     TEXT,
  acknowledged_at             TEXT NOT NULL,
  note                        TEXT
);

CREATE INDEX IF NOT EXISTS idx_pricing_display_repoint_ack_kind
  ON pricing_display_repoint_ack (fee_kind);

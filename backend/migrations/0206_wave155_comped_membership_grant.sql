-- ═══════════════════════════════════════════════════════════════════════════
-- 0206 · WAVE 155 — THE ADMIN-GRANTED (COMPED) MEMBERSHIP LEDGER.
--                                            R123.1, R124.4.3, R114.3, R113.3, R77
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS TABLE EXISTS. R124.4.3 established that `capavate_subscriptions` has
-- exactly two writers — the payment flow (`server/subscriptionStore.ts:248`) and
-- the gateway webhook (`server/paymentGatewayAdapter.ts:1649`) — and R123.1
-- established that the table holds ZERO rows while the live payment path is
-- unconfigured. With the eligibility gate at `enforced` that combination refuses
-- every SPV create, every fund create and every create-on-behalf for every
-- partner, WITH NO WAY FOR ANYONE TO CLEAR IT. This ledger is the missing way:
-- the owner can put one company, or one partner account, in good standing
-- without a card.
--
-- WHY IT IS A SEPARATE TABLE AND NOT A ROW IN `capavate_subscriptions`.
-- Two independent reasons, both load-bearing:
--   1. `server/subscriptionStore.ts` is SACRED and CALL-ONLY. Its exported
--      writers mint rows against a real Airwallex PaymentIntent and its
--      `failByPaymentIntent` deliberately REFUSES to downgrade an active row, so
--      a grant that could be REVOKED cannot be expressed through it at all
--      without editing it. It is not edited.
--   2. A comped membership IS NOT REVENUE. Writing it into the billing table is
--      how a comp silently becomes an MRR line. Kept out of that table, it
--      cannot reach `partnerRevShare`, `canonicalPlanResolver`,
--      `founderBillingExtensions`, `partnerSelfServiceRoutes`, or the
--      MRR/ARR aggregation in `adminPlatformStore` — none of which query this
--      table — BY CONSTRUCTION rather than by a filter someone must remember.
--
-- IT IS A LEDGER, NOT A FLAG (the `spv_launch_gate_override` precedent, 0203):
--   · `reason` is NOT NULL. A comp with no stated reason is not a decision.
--   · Withdrawing a grant STAMPS `revoked_at`/`revoked_by`/`revoke_reason`.
--     ROWS ARE NEVER DELETED and never rewritten, so "who was comped, by whom,
--     why, and when did it stop" stays answerable forever.
--   · There is no `active` column. "Is this grant live right now" is
--     `revoked_at IS NULL` AND any `expires_at` still in the future, evaluated
--     at read time. A derived boolean stored beside its own inputs is the bug
--     class this batch exists to remove.
--
-- SUBJECT KINDS mirror the two things the gate reads:
--   subject_kind='company' → subject_id is a company id; satisfies
--                            `resolveCompanyMembership` (the target-company check).
--   subject_kind='partner' → subject_id is a partner account id; satisfies
--                            `resolvePartnerAccountMembership` (the R122.2
--                            blind-pool / no-target check).
-- The CHECK constraint means a third kind cannot be invented by a typo — an
-- unknown kind is a write failure, not a silent no-op that grants nothing.
--
-- NO AMOUNT COLUMN, DELIBERATELY. There is no money here to store. A comp has no
-- price, no currency and no invoice, and giving it an amount column is the first
-- step towards something summing it.
--
-- NO SETTINGS ARE SEEDED HERE (`trg_pc_no_direct_insert`; see 0203's note).
--
-- IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS only. No UPDATE, no DELETE, no
-- data movement — re-running this file changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS comped_membership_grant (
  id            TEXT PRIMARY KEY NOT NULL,
  subject_kind  TEXT NOT NULL CHECK (subject_kind IN ('company','partner')),
  subject_id    TEXT NOT NULL,
  reason        TEXT NOT NULL,
  granted_at    TEXT NOT NULL,
  granted_by    TEXT NOT NULL,
  expires_at    TEXT,
  revoked_at    TEXT,
  revoked_by    TEXT,
  revoke_reason TEXT,
  UNIQUE (subject_kind, subject_id, granted_at)
);

CREATE INDEX IF NOT EXISTS idx_cmg_subject
  ON comped_membership_grant (subject_kind, subject_id);

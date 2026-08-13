# Rollback — 0169 (WAVE 13 `partner_subscription` shape reconciliation)

This is the explicit, reversible, **row-preserving** rollback for
`0169_wave13_partner_subscription_shape_reconcile.sql`, which reshaped
`partner_subscription` from the superseded Wave 5 declaration
(`partner_id` / `cadence` / `period_start` / `period_end`) to the canonical
persona-agnostic shape (`subject_kind` + `subject_id` / `cycle` /
`current_period_start` / `current_period_end`).

Unlike an additive migration, 0169 rebuilds the table, so the rollback is also a
rebuild. It is written to preserve every row and to be re-runnable.

## Before you run it — read this

Rolling back is a **data-losing operation for non-partner subjects.** The
canonical shape can hold `subject_kind = 'founder'` or `'collective'`; the Wave 5
shape has only `partner_id` and cannot express them. The script below therefore
**refuses to run** while such a row exists, rather than silently coercing a
founder subscription into a partner one. Resolve those rows first (cancel them,
or export them) and decide explicitly what should happen to each.

Rolling back also requires reverting the code that reads the canonical columns —
otherwise the code and the schema disagree again, which is the exact defect Wave
13 fixed:

- `server/lib/partnerSubscriptionStore.ts`, `server/lib/subscriptionChangeStore.ts`,
  `server/lib/subscriptionEnforcementWorker.ts` — all read/write `subject_kind`,
  `subject_id`, `cycle`, `current_period_*` and were canonical BEFORE Wave 13.
  They would all break. There is no version of this table that satisfies both
  them and the Wave 5 shape; that is why the collision had to be resolved.
- `server/lib/partnerBillingStore.ts` — repointed by Wave 13; revert the
  `SUBJECT_KIND_PARTNER` block to `partner_id` / `cadence` / `period_*`.
- `server/lib/applyWave13SubscriptionShape.ts` — delete the calls to it in
  `server/lib/applyWave5MoneySchema.ts` and
  `server/lib/applyWave11SubscriptionSchema.ts`, or both self-heal installers
  will re-apply 0169 on the next boot and undo the rollback.
- `migrations/0153_wave5_money_captable.sql` — restore its `partner_subscription`
  declaration (the block is preserved as a comment naming this file), and mirror
  the change into `server/db/migrations/`.
- Delete the ledger row so the runner does not consider 0169 applied:
  `DELETE FROM __drizzle_migrations_applied WHERE name LIKE '0169_%';`

## Rollback statements

Run inside a single transaction, and with `-bail` if you use the `sqlite3` CLI —
**without `-bail` the CLI keeps going after a failed statement**, which would let
the swap in step 4 run even though the copy in step 2 failed:

```bash
( echo "BEGIN;"; cat rollback_0169.sql; echo "COMMIT;" ) | sqlite3 -bail data.db
```

Verified on a copy of a real migrated database (see
`build_log/WAVE13_REPORT.md`): the rollback restores the Wave 5 shape with the
row and every field intact, and refuses to run when a founder-subject row is
present.

```sql
-- 0. REFUSE to run if any non-partner subject exists. The scratch table's CHECK
--    fails with "CHECK constraint failed: non_partner_rows = 0" and aborts the
--    transaction, on purpose. Comment this block out only after deciding
--    explicitly what happens to those rows.
CREATE TABLE w13_rollback_guard (
  non_partner_rows INTEGER NOT NULL CHECK (non_partner_rows = 0)
);
INSERT INTO w13_rollback_guard (non_partner_rows)
SELECT COUNT(*) FROM partner_subscription WHERE subject_kind <> 'partner';
DROP TABLE w13_rollback_guard;

-- 1. Recreate the Wave 5 shape under a scratch name.
CREATE TABLE partner_subscription_w5_old (
  id                    TEXT    PRIMARY KEY NOT NULL,
  partner_id            TEXT    NOT NULL,
  tier_slug             TEXT    NOT NULL,
  cadence               TEXT    NOT NULL CHECK (cadence IN ('monthly','annual','quarterly','one_time')),
  status                TEXT    NOT NULL
                          CHECK (status IN ('pending','active','past_due','cancelled','grandfathered','superseded')),
  amount_minor          INTEGER NOT NULL CHECK (amount_minor >= 0),
  list_amount_minor     INTEGER NOT NULL CHECK (list_amount_minor >= 0),
  discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  discount_code         TEXT,
  currency              TEXT    NOT NULL DEFAULT 'USD',
  price_derivation      TEXT    NOT NULL DEFAULT 'tier_price_row'
                          CHECK (price_derivation IN ('tier_price_row','partner_override','legacy_x12','grandfathered_free')),
  period_start          TEXT,
  period_end            TEXT,
  payment_intent_id     TEXT,
  grandfathered_from    TEXT,
  superseded_by         TEXT,
  superseded_reason     TEXT,
  cancelled_at          TEXT,
  created_at            TEXT    NOT NULL
                          CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  updated_at            TEXT    NOT NULL
                          CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  created_by            TEXT,
  CHECK (amount_minor = list_amount_minor - discount_minor)
) STRICT;

-- 2. Copy EVERY row back, reversing the carry.
--
--    Two coercions are unavoidable and are made explicit rather than hidden:
--      * list_amount_minor is NOT NULL in the Wave 5 shape but nullable in the
--        canonical one. Where it is NULL it is DERIVED from the schema invariant
--        amount = list - discount, i.e. list = amount + discount. Nothing is
--        invented.
--      * Wave 11-only statuses ('grace','suspended','failed') do not exist in
--        the Wave 5 CHECK. They are mapped to their nearest Wave 5 meaning:
--        grace/failed → 'past_due' (still owed, not yet cut off),
--        suspended → 'cancelled' (entitlement withdrawn). THIS LOSES
--        INFORMATION; the original value is preserved in the audit trail only.
--      * activated_at, grace_until, suspended_at, merchant_order_id have no
--        Wave 5 column and are DROPPED. Export them first if they matter:
--        SELECT id, activated_at, grace_until, suspended_at, merchant_order_id
--          FROM partner_subscription;
INSERT INTO partner_subscription_w5_old
  (id, partner_id, tier_slug, cadence, status, amount_minor, list_amount_minor,
   discount_minor, discount_code, currency, price_derivation, period_start,
   period_end, payment_intent_id, grandfathered_from, superseded_by,
   superseded_reason, cancelled_at, created_at, updated_at, created_by)
SELECT
   id,
   subject_id,
   tier_slug,
   cycle,
   CASE status
     WHEN 'grace'     THEN 'past_due'
     WHEN 'failed'    THEN 'past_due'
     WHEN 'suspended' THEN 'cancelled'
     ELSE status
   END,
   amount_minor,
   COALESCE(list_amount_minor, amount_minor + discount_minor),
   discount_minor,
   discount_code,
   currency,
   COALESCE(price_derivation, 'tier_price_row'),
   current_period_start,
   current_period_end,
   payment_intent_id,
   grandfathered_from,
   superseded_by,
   superseded_reason,
   cancelled_at,
   created_at,
   updated_at,
   created_by
FROM partner_subscription;

-- 3. Verify the copy BEFORE dropping anything. If these two counts differ, stop
--    and ROLLBACK.
--    SELECT (SELECT COUNT(*) FROM partner_subscription) AS canonical_rows,
--           (SELECT COUNT(*) FROM partner_subscription_w5_old) AS restored_rows;

-- 4. Swap.
DROP TABLE partner_subscription;
PRAGMA legacy_alter_table = ON;   -- see the note in 0169: an unrelated broken
ALTER TABLE partner_subscription_w5_old RENAME TO partner_subscription;
PRAGMA legacy_alter_table = OFF;  -- trigger elsewhere must not abort this rename

-- 5. Restore the Wave 5 indexes and drop the canonical ones.
DROP INDEX IF EXISTS idx_partner_subscription_subject;
DROP INDEX IF EXISTS idx_partner_subscription_status;
DROP INDEX IF EXISTS idx_psub_subject;
DROP INDEX IF EXISTS uq_psub_intent;
DROP INDEX IF EXISTS uq_psub_one_live;
CREATE INDEX IF NOT EXISTS idx_psub_partner ON partner_subscription(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_psub_intent  ON partner_subscription(payment_intent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_psub_one_live
  ON partner_subscription(partner_id)
  WHERE status IN ('pending','active','past_due','grandfathered');
```

## Notes / caveats

- **Idempotence.** Re-running after a completed rollback fails at step 2 with
  "no such column: subject_id", which is the correct, loud outcome: there is
  nothing left to roll back. It does not corrupt anything, because the whole
  script runs in one transaction.
- **Postgres.** These trees are SQLite for `partner_subscription`; the runner's
  Postgres adapter has never applied 0153/0167/0169 against a Postgres database.
  If that changes, the rebuild becomes a plain `ALTER TABLE … RENAME COLUMN`
  sequence and this file must be rewritten for it.
- **The guard test.** `server/__tests__/waveW13_migration_shape_collision_guard.test.ts`
  will FAIL after a rollback that restores 0153's declaration, because
  `partner_subscription` would again be declared twice with differing shapes and
  is deliberately not allowlistable. That failure is the guard doing its job.

-- 0167_wave11_partner_subscription_engine.sql
--
-- WAVE 11 — EN-6 / EN-7 / EN-8: the partner subscription lifecycle.
--
-- WHY A NEW TABLE AND NOT A COLUMN ON capavate_subscriptions
-- ----------------------------------------------------------
-- `server/subscriptionStore.ts` is SACRED (sacred_check.sh manifest, BASE row
-- 75ae1008…). It owns `capavate_subscriptions`, creates it lazily in its own
-- `ensureTable()`, and requires `company_id NOT NULL` plus ownership of the
-- company by the caller — which a managing partner never has. That is exactly
-- why `POST /api/partner/me/subscribe` could only ever return a quote: the
-- founder charge path it pointed at (`/api/billing/plan`,
-- server/routes.ts:4592-4600) 403s a partner on the `ctx.founder.companies`
-- ownership check.
--
-- So the money row stays where it is — the sacred store still mints it, byte
-- for byte, via `recordPendingSubscription` — and this table carries the
-- PARTNER-SIDE subscription record keyed to the same `payment_intent_id`. One
-- charge, one gateway intent, two rows that cannot disagree because they are
-- written in the same call and joined on the intent id.
--
-- PERSONA-AGNOSTIC BY CONSTRUCTION (EN-8). `subject_kind` + `subject_id` are
-- the only identity this table knows. The enforcement worker sweeps on those
-- columns, so adding a founder or collective subject later needs no schema
-- change and no second worker — which is the whole complaint behind DEF-077
-- ("the only worker is Collective-scoped").
--
-- MONEY. Every amount is INTEGER MINOR UNITS. There is no REAL column here and
-- no percentage: the proration ratio is computed in BigInt at the call site
-- (server/lib/subscriptionChangeStore.ts) and only its integer result lands.
--
-- Mirrored byte-identically into server/db/migrations/.

-- ---------------------------------------------------------------------------
-- 1. The canonical partner subscription record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_subscription (
  id                    TEXT PRIMARY KEY NOT NULL,
  -- Persona-agnostic subject. 'partner' today; 'founder'/'collective' are
  -- accepted so EN-8 can sweep them without a migration.
  subject_kind          TEXT NOT NULL CHECK (subject_kind IN ('partner','founder','collective')),
  subject_id            TEXT NOT NULL,
  tier_slug             TEXT NOT NULL,
  cycle                 TEXT NOT NULL CHECK (cycle IN ('monthly','annual')),
  -- The amount actually charged, in minor units.
  amount_minor          INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency              TEXT NOT NULL,
  -- List price before any promotion, so a discount is auditable after the fact.
  list_amount_minor     INTEGER,
  discount_minor        INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  discount_code         TEXT,
  -- 'admin_annual_price' | 'legacy_x12' | 'partner_override' — carried from the
  -- quote so "why was I charged this" is answerable from the row alone.
  price_derivation      TEXT,
  payment_intent_id     TEXT UNIQUE,
  merchant_order_id     TEXT,
  status                TEXT NOT NULL CHECK (status IN
                          ('pending','active','past_due','grace','suspended','cancelled','failed')),
  created_at            TEXT NOT NULL,
  activated_at          TEXT,
  current_period_start  TEXT,
  current_period_end    TEXT,
  -- Set by the enforcement worker from the DB-configured grace window.
  grace_until           TEXT,
  suspended_at          TEXT,
  cancelled_at          TEXT,
  updated_at            TEXT NOT NULL,
  created_by            TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_subscription_subject
  ON partner_subscription(subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS idx_partner_subscription_status
  ON partner_subscription(status, current_period_end);
CREATE INDEX IF NOT EXISTS idx_partner_subscription_intent
  ON partner_subscription(payment_intent_id);

-- ---------------------------------------------------------------------------
-- 2. Append-only lifecycle audit. Every status transition, every charge, every
--    enforcement decision. UPDATE and DELETE are refused by trigger, not by
--    convention — a log the application can rewrite is not evidence.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_subscription_event (
  id               TEXT PRIMARY KEY NOT NULL,
  subscription_id  TEXT NOT NULL,
  event_kind       TEXT NOT NULL,
  from_status      TEXT,
  to_status        TEXT,
  amount_minor     INTEGER,
  currency         TEXT,
  detail_json      TEXT,
  actor            TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_subscription_event_sub
  ON partner_subscription_event(subscription_id, created_at);

DROP TRIGGER IF EXISTS trg_w11_pse_no_update;
CREATE TRIGGER trg_w11_pse_no_update
BEFORE UPDATE ON partner_subscription_event
BEGIN
  SELECT RAISE(ABORT, 'partner_subscription_event is append-only (WAVE 11 EN-6)');
END;

DROP TRIGGER IF EXISTS trg_w11_pse_no_delete;
CREATE TRIGGER trg_w11_pse_no_delete
BEFORE DELETE ON partner_subscription_event
BEGIN
  SELECT RAISE(ABORT, 'partner_subscription_event is append-only (WAVE 11 EN-6)');
END;

-- ---------------------------------------------------------------------------
-- 3. EN-7 — plan changes and their proration arithmetic, stored so the credit
--    can be re-derived and re-checked years later.
--
--    unused_credit_minor + new_charge_minor + net_due_minor are all integer
--    minor units. net_due_minor MAY be negative: a downgrade owes the partner
--    a credit rather than a charge, and rounding that up to zero would be a
--    silent transfer of money to the platform.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS partner_subscription_change (
  id                   TEXT PRIMARY KEY NOT NULL,
  subscription_id      TEXT NOT NULL,
  change_kind          TEXT NOT NULL CHECK (change_kind IN
                         ('upgrade','downgrade','cycle_change','cancel','reactivate')),
  from_tier            TEXT,
  to_tier              TEXT,
  from_cycle           TEXT,
  to_cycle             TEXT,
  from_amount_minor    INTEGER,
  to_amount_minor      INTEGER,
  currency             TEXT NOT NULL,
  -- Proration inputs, kept so the result is reproducible without re-guessing
  -- the clock: period_days is the whole billing period, remaining_days the
  -- unconsumed remainder at effective_at.
  period_days          INTEGER NOT NULL CHECK (period_days > 0),
  remaining_days       INTEGER NOT NULL CHECK (remaining_days >= 0),
  unused_credit_minor  INTEGER NOT NULL DEFAULT 0,
  new_charge_minor     INTEGER NOT NULL DEFAULT 0,
  net_due_minor        INTEGER NOT NULL DEFAULT 0,
  payment_intent_id    TEXT,
  payment_entry_id     TEXT,
  status               TEXT NOT NULL CHECK (status IN ('previewed','applied','failed')),
  effective_at         TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  actor                TEXT
);

CREATE INDEX IF NOT EXISTS idx_partner_subscription_change_sub
  ON partner_subscription_change(subscription_id, created_at);

-- An APPLIED change is history. Only a 'previewed' row may be mutated (to
-- 'applied' or 'failed'); once it is applied or failed it is frozen.
DROP TRIGGER IF EXISTS trg_w11_psc_applied_frozen;
CREATE TRIGGER trg_w11_psc_applied_frozen
BEFORE UPDATE ON partner_subscription_change
WHEN OLD.status IN ('applied','failed')
BEGIN
  SELECT RAISE(ABORT, 'an applied plan change is immutable (WAVE 11 EN-7)');
END;

DROP TRIGGER IF EXISTS trg_w11_psc_no_delete;
CREATE TRIGGER trg_w11_psc_no_delete
BEFORE DELETE ON partner_subscription_change
BEGIN
  SELECT RAISE(ABORT, 'partner_subscription_change is append-only (WAVE 11 EN-7)');
END;

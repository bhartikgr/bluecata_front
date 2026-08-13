-- migrations/0151_wave3e_fee_settlement_authorization.sql
-- WAVE 3E — fee-settlement authority moves from PROCESS MEMORY onto DURABLE DB
-- RECORDS. Owner ruling, verbatim: "All db-driven. No in-memory anywhere."
--
-- WHAT THIS REPLACES
--   server/lib/feeSettlementAuthority.ts (pre-WAVE-3E):
--     :73  const BRAND: unique symbol = Symbol("capavate.feeSettlementAuthorization");
--     :77  const ISSUED   = new WeakSet<object>();     -- the issue registry
--     :81  const CONSUMED = new WeakMap<object, string[]>();  -- the replay counter
--     :104 mint()                                      -- registry insert
--     :122 consumeSettlementAuthorization()            -- read-then-write on the WeakMap
--
--   The CRYPTOGRAPHIC IDEA (a settlement outcome is an unforgeable capability,
--   not a value) is sound and is PRESERVED. The STORAGE was process-local:
--     * an authorization did not survive a restart;
--     * a second process could not see that an authorization was already spent,
--       so REPLAY PROTECTION did not hold across processes;
--     * `CONSUMED.get(...)` then `CONSUMED.set(...)` is a read-then-write, which
--       is not atomic with the money write it guards.
--
--   WAVE 1A closed five partner-reachable sinks with that mechanism. This
--   migration re-homes the AUTHORITY, not the mechanism: the DB row is now the
--   authority and the in-process Symbol brand is retained purely as
--   defence-in-depth. Both must pass. Neither alone is sufficient.
--
-- MIGRATION NUMBER — 0151. Verified against THIS tree on 2026-08-10, not assumed:
--   * `ls migrations/*.sql | tail` and `ls server/db/migrations/*.sql | tail` —
--     the highest number present on disk in BOTH directories is 0150
--     (`0150_wave3d_combined_carry_cap.sql`, WAVE 3D).
--   * spec/00_SHARED_STANDARDS.md §4 centrally allocates 0138-0148 to other
--     in-flight waves; 0149 is Wave 4B and 0150 is Wave 3D, both already on disk.
--     The 0135 gap is pre-existing and is not backfilled.
--   * 0151 is therefore the first free number AFTER 0148 and after the highest
--     number actually present. Nothing here renumbers or reuses.
--
-- SACRED FILES: `server/db/migrate.ts` (the runner) and `server/db/connection.ts`
-- are NOT touched by this wave. This migration is a new file only, mirrored
-- byte-identically into server/db/migrations/.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ATOMICITY CONTRACT (the load-bearing property)
-- ─────────────────────────────────────────────────────────────────────────────
-- Consumption is a single CONDITIONAL UPDATE whose WHERE clause carries every
-- precondition, executed inside the SAME transaction as the money write:
--
--   UPDATE fee_settlement_authorization
--      SET uses_consumed = uses_consumed + 1, ...
--    WHERE id = :id
--      AND uses_consumed < uses_max          -- single-use / bounded-use
--      AND purpose = :purpose                -- scope
--      AND spv_id  = :spvId                  -- scope
--      AND (obligation_id IS NULL OR obligation_id = :obligationId)
--      AND (amount_minor IS NULL OR amount_minor = :amountMinor)
--      AND (currency IS NULL OR currency = :currency)
--      AND expires_at > :now                 -- expiry
--      AND revoked_at IS NULL
--
-- The application asserts `changes === 1`. There is NO read-then-write anywhere
-- on this path, so two concurrent consumers of the same row cannot both observe
-- `uses_consumed < uses_max`: SQLite serialises the writes and the loser's
-- UPDATE affects ZERO rows. Because the UPDATE and the money write share one
-- transaction, a crash between them rolls BOTH back — an authorization can never
-- be spent with no settlement, nor a settlement recorded against an unspent
-- authorization.
--
-- FAIL CLOSED. Missing row, expired row, revoked row, exhausted row, scope
-- mismatch, or a table that does not exist at all: every one of these produces
-- ZERO affected rows or a thrown error, and the caller REJECTS. There is no
-- code path on which the absence of a record means "allow".
--
-- IDEMPOTENT: every statement is IF NOT EXISTS. Re-running this migration
-- against an already-migrated database is a no-op. NOTE (spec §4): this
-- migration creates NEW tables that no legacy shape can collide with — it never
-- relies on IF NOT EXISTS to reshape an existing table.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The authorization record. THIS ROW IS THE AUTHORITY.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_settlement_authorization (
  -- IDENTITY
  id              TEXT    PRIMARY KEY NOT NULL,

  -- SCOPE — exactly what this authorization may settle. Every one of these is
  -- re-checked in the consuming UPDATE's WHERE clause; a mismatch consumes
  -- nothing and rejects.
  purpose         TEXT    NOT NULL CHECK (purpose IN ('fee_obligation','distribution_carry')),
  spv_id          TEXT    NOT NULL CHECK (spv_id <> ''),
  -- The bound fee obligation. NOT NULL for 'fee_obligation'. NULL is permitted
  -- ONLY for 'distribution_carry', whose obligation ids are minted inside
  -- `_collectCarryObligation` and therefore cannot be known at issue time; that
  -- case is bounded instead by uses_max and by the per-use ledger in table 2.
  obligation_id   TEXT,
  -- WHICH AMOUNT. NULL means "not pinned at issue time" (the carry case, whose
  -- leg amounts are computed by the waterfall). When non-NULL it is matched
  -- exactly in the consuming UPDATE.
  amount_minor    INTEGER CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency        TEXT    CHECK (currency IS NULL OR length(currency) = 3),

  -- THE OUTCOME. 'demo' is deliberately absent: WAVE 1A / SINK 4.
  outcome         TEXT    NOT NULL CHECK (outcome IN ('succeeded','failed')),

  -- ISSUER / PROVENANCE. `source` records HOW the outcome was established; it is
  -- never supplied by a caller. 'test' is only ever written by the NODE_ENV-
  -- guarded test mint.
  source          TEXT    NOT NULL CHECK (source IN ('gateway','platform_admin','test')),
  issued_by       TEXT    NOT NULL CHECK (issued_by <> ''),
  issued_at       TEXT    NOT NULL
                    CHECK (issued_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  reason          TEXT    NOT NULL CHECK (reason <> ''),

  -- EXPIRY. Mandatory and strictly after issue: an authorization is never
  -- eternal, so a leaked handle stops being useful.
  expires_at      TEXT    NOT NULL
                    CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),

  -- SINGLE-USE CONSUMPTION STATE. uses_max is 1 for a named fee obligation and
  -- 2 for a distribution's two carry legs (management + platform) — the same
  -- bound the WeakMap counter enforced, now durable.
  uses_max        INTEGER NOT NULL CHECK (uses_max >= 1 AND uses_max <= 2),
  uses_consumed   INTEGER NOT NULL DEFAULT 0 CHECK (uses_consumed >= 0),
  -- Set on the consumption that exhausts the authorization. A non-NULL value is
  -- the durable "already consumed" fact that replaces the WeakMap.
  consumed_at     TEXT
                    CHECK (consumed_at IS NULL OR consumed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),

  -- Operational kill switch. A revoked row can never be consumed.
  revoked_at      TEXT
                    CHECK (revoked_at IS NULL OR revoked_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),

  CHECK (uses_consumed <= uses_max),
  CHECK (expires_at > issued_at),
  -- A fee-obligation authorization MUST name its obligation and MUST be single
  -- use. Nothing may issue an unbound, multi-use fee-obligation capability.
  CHECK (purpose <> 'fee_obligation' OR (obligation_id IS NOT NULL AND obligation_id <> '' AND uses_max = 1)),
  -- consumed_at is set exactly when the authorization is exhausted.
  CHECK ((consumed_at IS NULL) = (uses_consumed < uses_max))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_fsa_scope
  ON fee_settlement_authorization(spv_id, purpose, obligation_id);
CREATE INDEX IF NOT EXISTS idx_fsa_open
  ON fee_settlement_authorization(consumed_at, expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The per-use consumption ledger. Append-only, and the PRIMARY KEY is the
--    durable successor to the WeakMap's per-obligation dedup list: the same
--    authorization can never settle the same obligation twice, even across
--    processes, even after a restart, and even if uses_max were > 1.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_settlement_authorization_use (
  authorization_id TEXT    NOT NULL,
  -- The obligation actually settled by this use. '' is never written: the
  -- consuming call always supplies a concrete obligation id.
  obligation_id    TEXT    NOT NULL CHECK (obligation_id <> ''),
  use_index        INTEGER NOT NULL CHECK (use_index >= 1),
  consumed_at      TEXT    NOT NULL
                     CHECK (consumed_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*'),
  consumed_by      TEXT    NOT NULL CHECK (consumed_by <> ''),
  PRIMARY KEY (authorization_id, obligation_id)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fsau_slot
  ON fee_settlement_authorization_use(authorization_id, use_index);
CREATE INDEX IF NOT EXISTS idx_fsau_obligation
  ON fee_settlement_authorization_use(obligation_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Immutability triggers. Consumption is MONOTONIC and scope is FROZEN at
--    issue time, enforced by the database rather than by convention. Without
--    these, "un-consume then replay" is a single UPDATE away.
-- ─────────────────────────────────────────────────────────────────────────────

-- Consumption can only ever go UP, and never past uses_max.
CREATE TRIGGER IF NOT EXISTS trg_fsa_monotonic_use
  BEFORE UPDATE ON fee_settlement_authorization
  WHEN NEW.uses_consumed < OLD.uses_consumed OR NEW.uses_consumed > OLD.uses_max
  BEGIN SELECT RAISE(ABORT, 'SETTLEMENT_AUTHORIZATION_USE_NOT_MONOTONIC'); END;

-- A consumed authorization can never be un-consumed.
CREATE TRIGGER IF NOT EXISTS trg_fsa_no_unconsume
  BEFORE UPDATE ON fee_settlement_authorization
  WHEN OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS NULL
  BEGIN SELECT RAISE(ABORT, 'SETTLEMENT_AUTHORIZATION_ALREADY_CONSUMED'); END;

-- Scope, outcome, provenance and expiry are frozen at issue.
CREATE TRIGGER IF NOT EXISTS trg_fsa_immutable_scope
  BEFORE UPDATE ON fee_settlement_authorization
  WHEN NEW.id            <> OLD.id
    OR NEW.purpose       <> OLD.purpose
    OR NEW.spv_id        <> OLD.spv_id
    OR NEW.outcome       <> OLD.outcome
    OR NEW.source        <> OLD.source
    OR NEW.issued_by     <> OLD.issued_by
    OR NEW.issued_at     <> OLD.issued_at
    OR NEW.expires_at    <> OLD.expires_at
    OR NEW.uses_max      <> OLD.uses_max
    OR (NEW.obligation_id IS NOT OLD.obligation_id)
    OR (NEW.amount_minor  IS NOT OLD.amount_minor)
    OR (NEW.currency      IS NOT OLD.currency)
  BEGIN SELECT RAISE(ABORT, 'SETTLEMENT_AUTHORIZATION_IMMUTABLE'); END;

-- Deleting an authorization would erase the durable "already consumed" fact.
CREATE TRIGGER IF NOT EXISTS trg_fsa_no_delete
  BEFORE DELETE ON fee_settlement_authorization
  BEGIN SELECT RAISE(ABORT, 'SETTLEMENT_AUTHORIZATION_IMMUTABLE'); END;

-- The use ledger is append-only.
CREATE TRIGGER IF NOT EXISTS trg_fsau_no_update
  BEFORE UPDATE ON fee_settlement_authorization_use
  BEGIN SELECT RAISE(ABORT, 'SETTLEMENT_AUTHORIZATION_USE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_fsau_no_delete
  BEFORE DELETE ON fee_settlement_authorization_use
  BEGIN SELECT RAISE(ABORT, 'SETTLEMENT_AUTHORIZATION_USE_IMMUTABLE'); END;

-- NO SEED. There is deliberately no genesis row: an authorization must be
-- MINTED by server/lib/feeSettlementAuthority.ts (gateway or Capavate platform
-- admin). An empty table means nothing can settle, which is the correct
-- fail-closed state.

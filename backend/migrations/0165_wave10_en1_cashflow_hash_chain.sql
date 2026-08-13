-- migrations/0165_wave10_en1_cashflow_hash_chain.sql
-- WAVE 10 — EN-1. Make the ILPA cash-flow ledger APPEND-ONLY AND HASH-CHAINED.
--
-- WHAT WAS ALREADY THERE, AND WHAT WAS NOT.
--   `vehicle_cashflow` was created by 0159_wave9_reporting_audit.sql:48-86 with
--   the full 14-type ILPA taxonomy, integer minor units and the XIRR sign
--   convention. So EN-1's table is NOT absent — this is the tenth time in this
--   build that something believed missing already existed. What is genuinely
--   absent is the half of EN-1 the item actually names: "one APPEND-ONLY
--   HASH-CHAINED table". 0159 gave the ledger no chain columns and no
--   immutability guard, so any row could be silently amended or deleted after
--   the fact and no reader could tell. For a ledger whose output is an IRR
--   quoted to a limited partner, a mutable row is a fabricated number.
--
-- WHAT THIS MIGRATION ADDS.
--   1. `prev_hash` / `curr_hash` / `chain_seq`, matching the chain columns the
--      SPV engine already uses (`spv_capital_calls.prev_hash` / `curr_hash`,
--      written by server/spvFundStore.ts recordCapitalCall via
--      `chainTipForSpvScoped()` + `computeHash()`). Same shape, so an operator
--      reading two ledgers reads one idiom.
--   2. Three triggers making the table append-only at the STORAGE layer.
--
-- WHY TRIGGERS AND NOT AN APPLICATION RULE.
--   An application rule protects the rows that go through the application. The
--   whole reason this ledger is worth chaining is the case where something does
--   NOT go through the application — a console session, a support script, a
--   restored backup. `allocation_rule` (0157) already establishes this idiom in
--   this codebase: immutability enforced by trigger, not by convention.
--
-- WHY THE CHAIN IS PER (vehicle_kind, vehicle_id) AND NOT GLOBAL.
--   Exactly the partitioning server/spvFundStore.ts:435 uses for the SPV
--   chains: "Chains are partitioned per spv_id". A global chain would serialise
--   every vehicle's writes behind one tip and make a single vehicle's export
--   unverifiable in isolation. Per-vehicle, an LP can be handed the flows for
--   THEIR vehicle plus the chain and verify them without seeing anyone else's.
--
-- SIGN CONVENTION IS NOT RE-ASSERTED HERE.
--   0159 documented it in a comment only; the CHECK constraints do not enforce
--   it. This migration does not add a CHECK either, deliberately: SQLite cannot
--   express "negative iff the txn_type is one of these seven" without repeating
--   the taxonomy a second time, and a second copy of the taxonomy is a drift
--   source. It is enforced in one place, `assertSignConvention()` in
--   packages/math-fns/src/ilpa.ts:119, which every writer must go through —
--   see server/lib/ilpaCashflowLedger.ts, which is the ONLY writer.
--
-- ADDITIVE + IDEMPOTENT. No DROP, no rewrite of an existing row.
--
-- BACKFILL. Deliberately none. At the time this ships `vehicle_cashflow` has
-- zero production rows — 0159 created it and `recordCashflow()`
-- (server/wave9ReportingStore.ts:144) had no non-test caller until WAVE 10
-- wired one. Rather than pretend to chain rows whose history nobody witnessed,
-- any pre-chain row keeps NULL hashes and `verifyVehicleChain()` reports it as
-- `unchained`, NOT as verified. A chain verifier that returns "OK" for rows it
-- never checked is the vacuous-green failure this build has already been
-- bitten by once (WAVE 7B, DA-3's scope fence).

-- ---------------------------------------------------------------------------
-- 1. Chain columns.
-- ---------------------------------------------------------------------------
-- ALTER TABLE ADD COLUMN is idempotent-by-swallow in this runner (duplicate
-- column errors are tolerated, see server/lib/migrationRunner.ts), and STRICT
-- tables accept a nullable added column with no default.
ALTER TABLE vehicle_cashflow ADD COLUMN chain_seq INTEGER;
ALTER TABLE vehicle_cashflow ADD COLUMN prev_hash TEXT;
ALTER TABLE vehicle_cashflow ADD COLUMN curr_hash TEXT;

-- One chain per vehicle: no two rows may claim the same sequence number, and
-- no two rows may share a hash. Partial (WHERE NOT NULL) so pre-chain rows do
-- not collide with each other on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_w10_vcf_chain_seq
  ON vehicle_cashflow(vehicle_kind, vehicle_id, chain_seq)
  WHERE chain_seq IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_w10_vcf_curr_hash
  ON vehicle_cashflow(curr_hash)
  WHERE curr_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Append-only enforcement.
-- ---------------------------------------------------------------------------
-- DELETE is refused outright. A cash flow that should not have been recorded is
-- reversed by appending its opposite, which is what an accountant does and what
-- leaves an audit trail. Deleting it leaves none.
DROP TRIGGER IF EXISTS trg_w10_vcf_no_delete;
CREATE TRIGGER trg_w10_vcf_no_delete
BEFORE DELETE ON vehicle_cashflow
BEGIN
  SELECT RAISE(ABORT, 'VEHICLE_CASHFLOW_APPEND_ONLY: rows may not be deleted; append a reversing flow instead');
END;

-- UPDATE is refused on every field that participates in the hash or in the
-- money. Nothing else on the row is updatable either, but naming the fields
-- makes the failure message tell the operator WHY.
DROP TRIGGER IF EXISTS trg_w10_vcf_no_update;
CREATE TRIGGER trg_w10_vcf_no_update
BEFORE UPDATE OF
  id, tenant_id, vehicle_kind, vehicle_id, lp_id, txn_type, value_date,
  amount_minor, currency, is_recallable, source_kind, source_ref,
  created_by, created_at, chain_seq, prev_hash, curr_hash
ON vehicle_cashflow
BEGIN
  SELECT RAISE(ABORT, 'VEHICLE_CASHFLOW_APPEND_ONLY: rows are immutable; append a reversing flow instead');
END;

-- A chained insert must not fork the chain. The writer supplies chain_seq and
-- prev_hash; this asserts they agree with what is already on disk for that
-- vehicle. Concurrency safety comes from the unique index above (two writers
-- racing to the same chain_seq — one loses), not from this trigger.
DROP TRIGGER IF EXISTS trg_w10_vcf_chain_forward_only;
CREATE TRIGGER trg_w10_vcf_chain_forward_only
BEFORE INSERT ON vehicle_cashflow
WHEN NEW.chain_seq IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'VEHICLE_CASHFLOW_CHAIN_FORK: chain_seq must be exactly one past the current tip for this vehicle')
  WHERE NEW.chain_seq <> 1 + COALESCE(
    (SELECT MAX(chain_seq) FROM vehicle_cashflow
      WHERE vehicle_kind = NEW.vehicle_kind
        AND vehicle_id   = NEW.vehicle_id
        AND chain_seq IS NOT NULL), 0);

  -- ...and prev_hash must be the tip's curr_hash. The seq check ALONE is not
  -- enough: seq 3 after a 2-row chain is "forward", so a row carrying a
  -- fabricated prev_hash slid straight past the trigger and only the
  -- application-level verifier caught it. Found by
  -- server/__tests__/waveW10_en1_cashflow_ledger.test.ts, which asserted the
  -- DB would refuse it and was RIGHT that it should. A chain whose links are
  -- only checked by the reader is a chain an attacker writes freely.
  SELECT RAISE(ABORT, 'VEHICLE_CASHFLOW_CHAIN_BREAK: prev_hash must equal the curr_hash of the current tip for this vehicle')
  WHERE COALESCE(NEW.prev_hash, '') <> COALESCE(
    (SELECT curr_hash FROM vehicle_cashflow
      WHERE vehicle_kind = NEW.vehicle_kind
        AND vehicle_id   = NEW.vehicle_id
        AND chain_seq IS NOT NULL
      ORDER BY chain_seq DESC LIMIT 1), '');
END;

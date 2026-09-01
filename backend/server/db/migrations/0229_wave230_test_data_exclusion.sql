-- 0229 — WAVE 230 · test-data exclusion (REVERSIBLE MARKING, NOT DELETION)
--
-- R228, owner verbatim, 2026-08-31: "It is time to remove the test data. Go for it."
--
-- R228.1 rules that the removal is implemented as MARKING PLUS EXCLUSION, never as
-- row deletion, for three reasons that this file exists to honour:
--
--   1. The audit ledger is hash-chained PER TENANT and verifies 730/730 clean.
--      Deleting rows breaks the chain of that tenant -- and the admin screen
--      derives its "chain verified clean" tick from `broken_at_row_id === null`
--      (R224.1), so a deletion could leave a GENUINELY BROKEN CHAIN RENDERING
--      GREEN. That is the single most-repeated failure mode of this programme.
--   2. The owner's standing preference is "I'd rather add than delete", and
--      R195.5 forbids deletion as a mechanism throughout.
--   3. Misclassification is UNRECOVERABLE. Excluding a real client is an
--      inconvenience corrected in one click; deleting one is a catastrophe.
--
-- ── PER-RECORD, NEVER PER-TENANT (R230.6) ─────────────────────────────────────
-- A fundraising round named "QA Note Round" lives on BluePrint Catalyst Limited,
-- the OPERATOR'S OWN REAL COMPANY RECORD (R229), created by the owner's own
-- account. Any tenant-scoped design would either hide the real operating entity
-- or silently miss that round. So the flag goes on the ROW, on each population
-- independently: `rounds` is marked while its parent `companies` row is not.
--
-- The same requirement is why `subscriptions` carries the flag directly. Its
-- primary key IS `company_id`, and R230 records an orphan subscription
-- (`co_qa_1780955984396`, $2,988.00/yr) whose company row does not exist. A
-- design that reached subscriptions through their company could never mark it.
--
-- ── SEMANTICS: NULL = KEPT. THIS IS THE SAFETY PROPERTY, AND IT IS STRUCTURAL ──
--   NULL               -> the record is KEPT. Included everywhere, as today.
--   ISO-8601 timestamp -> the record is EXCLUDED, as of that instant.
--   Unsetting writes NULL back. There is no permanent state; nothing here is
--   one-way, and no row is ever removed.
--
-- Because NULL is the column default, EVERY PRE-EXISTING ROW IS KEPT WITHOUT
-- ANYONE DECIDING ANYTHING, and a database that has never seen this migration
-- behaves byte-identically to today. R228.3's "ambiguous rows default to KEPT,
-- never to removed" is therefore not a policy someone has to remember -- it is
-- what the storage does when nobody acts.
--
-- `w230_is_test_reason` records WHY, so an exclusion can be explained to the
-- owner and reviewed rather than merely observed. `w230_is_test_by` records WHO,
-- server-observed at write time; a client-supplied actor is never stored (R187.1).
-- Neither is ever used to decide the exclusion -- only `w230_is_test_at` is -- so
-- a missing reason cannot silently include or exclude anything.
--
-- ── WHY NOT AN EXISTING COLUMN ────────────────────────────────────────────────
--   `is_demo`      exists on companies/tenants/users ONLY, and
--                  server/lib/eventBusPillarHelpers.ts:200 states it is
--                  "deliberately NOT filtered: demo companies are real portfolio
--                  rows". It marks seeded personas that are meant to be visible.
--   `archive_status`/`archived_at` are a LIFECYCLE state with a retention clock
--                  and a legal meaning. A test record was never alive; filing it
--                  as archived would tell the owner the platform once had 32 more
--                  clients than it did.
--   `deleted_at`   means "the user removed this", and hides the row from the store
--                  readers -- including the admin filter the owner needs in order
--                  to REVIEW these decisions. Reusing it would make the
--                  classification irreversible in practice.
-- Three different questions, so a third column. Nothing existing is overloaded.
--
-- ── NOT DECLARED IN THE DRIZZLE SCHEMA, DELIBERATELY ──────────────────────────
-- Drizzle names every declared column in its INSERT statements. Leaving these
-- undeclared keeps every existing insert in the tree byte-unchanged. The columns
-- are read and written by raw SQL in server/lib/wave230TestDataExclusion.ts.
--
-- ── THE HASH CHAINS ARE UNAFFECTED, AND THIS WAS CHECKED RATHER THAN ASSUMED ──
-- Every chain payload enumerates its fields by name:
-- `payloadConsortiumApplications` (server/lib/auditChainVerifier.ts:166) lists ten
-- named fields, and `hashRevision(prev, body)` in server/subscriptionsStore.ts
-- hashes an explicit object literal rather than the row. No payload can observe a
-- column that did not exist when it was written, so adding one cannot change a
-- single stored hash. Proved empirically before and after with the CANONICAL
-- verifier (server/lib/auditChainVerifier.ts), never the miswired admin twin
-- (`verifyTenantAuditChain`, R208.1).
--
-- ── SELF-HEAL ─────────────────────────────────────────────────────────────────
-- Every statement below is also applied by the self-heal installer in
-- server/lib/wave230TestDataExclusion.ts, which READS THEM OUT OF THIS FILE
-- rather than re-typing them, so installer and migration cannot drift. This is
-- required because server/db/connection.ts is SACRED and its inline bootstrap --
-- the schema every `:memory:` test receives -- cannot be extended. A wave that
-- writes only a migration has columns that exist for deploys and are INVISIBLE
-- to its own tests, which is the wave-261 problem.
--
-- This file is mirrored BYTE-IDENTICALLY into `migrations/` and
-- `server/db/migrations/`. server/db/migrate.ts:20 defaults MIGRATIONS_DIR to
-- `./migrations`, so the ROOT directory is what deploys read.

-- ── companies · 67 rows live; 32 CERTAIN test, ~22 PROBABLE, ~9 real (R230.2) ──
ALTER TABLE companies ADD COLUMN w230_is_test_at TEXT;

ALTER TABLE companies ADD COLUMN w230_is_test_reason TEXT;

ALTER TABLE companies ADD COLUMN w230_is_test_by TEXT;

-- ── rounds · 62 of 122 QA-named, INCLUDING "QA Note Round" inside the real
--    operating tenant, which is why this column exists at all (R230.6) ─────────
ALTER TABLE rounds ADD COLUMN w230_is_test_at TEXT;

ALTER TABLE rounds ADD COLUMN w230_is_test_reason TEXT;

ALTER TABLE rounds ADD COLUMN w230_is_test_by TEXT;

-- ── spvs · ~15 of 18 QA-named (R230.2) ────────────────────────────────────────
ALTER TABLE spvs ADD COLUMN w230_is_test_at TEXT;

ALTER TABLE spvs ADD COLUMN w230_is_test_reason TEXT;

ALTER TABLE spvs ADD COLUMN w230_is_test_by TEXT;

-- ── subscriptions · the money. 31 "active" summing to $26,928.00 while the whole
--    payment ledger contains ten records totalling $2,530.06 (R230.1). Excluding
--    test subscriptions will make reported revenue FALL, CORRECTLY, and R228.2
--    requires the before-and-after to be reported explicitly and prominently and
--    NEVER adjusted silently. ────────────────────────────────────────────────────
ALTER TABLE subscriptions ADD COLUMN w230_is_test_at TEXT;

ALTER TABLE subscriptions ADD COLUMN w230_is_test_reason TEXT;

ALTER TABLE subscriptions ADD COLUMN w230_is_test_by TEXT;

-- ── consortium_applications · 28 of 31 single-letter or nonsense org names ─────
ALTER TABLE consortium_applications ADD COLUMN w230_is_test_at TEXT;

ALTER TABLE consortium_applications ADD COLUMN w230_is_test_reason TEXT;

ALTER TABLE consortium_applications ADD COLUMN w230_is_test_by TEXT;

-- ── collective_apps · 2 of 4 certain test, one containing Lorem Ipsum (R230.4) ─
ALTER TABLE collective_apps ADD COLUMN w230_is_test_at TEXT;

ALTER TABLE collective_apps ADD COLUMN w230_is_test_reason TEXT;

ALTER TABLE collective_apps ADD COLUMN w230_is_test_by TEXT;

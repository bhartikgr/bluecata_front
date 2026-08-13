-- migrations/0166_wave10_en3_investor_identity_alias.sql
-- WAVE 10 — EN-3. LP self-serve surface via `investor_identity_alias`.
--
-- THE DEFECT, AT SOURCE (verified, not taken from the citation).
--   server/spvEngineRoutes.ts:830-832, the partner "seat an LP" path:
--       const stableKey  = sha256(investorEmail).slice(0, 16);
--       const investorId = `ext_${stableKey}`;
--   That synthetic id is what gets written into the SACRED unified cap-table
--   ledger by `commitFunded()` (server/captableCommitStore.ts). Meanwhile every
--   self-serve read keys off the platform user id:
--       listCommitsForUser(userId)   server/captableCommitStore.ts:444-451
--   filters `captable_commits.investor_id = :userId`.
--
--   So when a partner seats Jane at jane@example.com, and Jane later registers
--   on the platform as user `usr_...`, her own position is INVISIBLE to her.
--   The ledger says `ext_9f2c...`; her session says `usr_...`; nothing joins
--   them. She is on the cap table and cannot see it.
--
-- WHY NOT JUST REWRITE THE LEDGER ROW.
--   Two reasons, either one sufficient.
--   1. `captableCommitStore.ts` is SACRED — this build may not edit it.
--   2. The unified cap-table ledger is append-only and sequenced
--      (`captable_commits.seq`). Rewriting `investor_id` on a historical row
--      would mutate a settled money record. The whole point of an immutable
--      ledger is that yesterday's row still reads the way it read yesterday.
--   The identity therefore resolves at READ time, through an alias, and the
--   ledger is never touched. Hence the item's own wording: "no sacred edit, no
--   chain break".
--
-- WHAT AN ALIAS IS, PRECISELY.
--   A claim that two identifiers denote the same investor, with a recorded
--   basis for the claim and a recorded verifier. It is NOT an access grant.
--   Resolving an alias lets a reader see rows that were ALREADY theirs under a
--   different spelling of their name. Every consumer must still run its own
--   authorisation — the alias widens the id set, never the permission set.
--   This mirrors the PT-5 discipline that classification is reporting-and-
--   filtering only and must never touch permissions, nav or access.
--
-- ADDITIVE + IDEMPOTENT. New table only. No DROP, no data rewrite.

CREATE TABLE IF NOT EXISTS investor_identity_alias (
  id                TEXT PRIMARY KEY NOT NULL,
  tenant_id         TEXT NOT NULL,

  -- The id as written into the ledger, e.g. 'ext_9f2c1a...'. This is the side
  -- that can never be changed, because it is already in an immutable row.
  alias_investor_id TEXT NOT NULL,

  -- The canonical platform identity the alias resolves to, e.g. 'usr_...'.
  canonical_user_id TEXT NOT NULL,

  -- The lowercase email the alias hash was derived from. Kept so an operator
  -- can re-derive `ext_<sha256(email)[0:16]>` by hand and check the link,
  -- rather than trusting a row they cannot reproduce.
  match_email       TEXT,

  -- HOW the link was established. 'email_verified' is the only basis that is
  -- self-service; the others require a human and are recorded as such.
  --   email_verified — the canonical user proved control of match_email
  --   admin_manual   — an admin asserted the link
  --   partner_manual — the seating partner asserted the link
  --   import         — carried in from a migration or bulk load
  basis             TEXT NOT NULL DEFAULT 'email_verified'
                      CHECK (basis IN ('email_verified','admin_manual','partner_manual','import')),

  -- Lifecycle. A revoked alias stops resolving but is NOT deleted: an identity
  -- claim that was once acted upon has to stay auditable.
  state             TEXT NOT NULL DEFAULT 'active'
                      CHECK (state IN ('active','revoked')),

  verified_by       TEXT,
  verified_at       TEXT,
  revoked_by        TEXT,
  revoked_at        TEXT,
  revoke_reason     TEXT,

  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
) STRICT;

-- One alias id resolves to at most one canonical user AT A TIME. Partial on
-- state so a revoked alias can be superseded by a new active one without
-- deleting the history. This is the constraint that stops the alias table
-- becoming an identity-confusion vector: you cannot have `ext_9f2c` pointing
-- at two live users.
CREATE UNIQUE INDEX IF NOT EXISTS uq_w10_alias_active
  ON investor_identity_alias(alias_investor_id)
  WHERE state = 'active';

CREATE INDEX IF NOT EXISTS idx_w10_alias_canonical
  ON investor_identity_alias(canonical_user_id, state);
CREATE INDEX IF NOT EXISTS idx_w10_alias_email
  ON investor_identity_alias(match_email);
CREATE INDEX IF NOT EXISTS idx_w10_alias_tenant
  ON investor_identity_alias(tenant_id);

-- An alias may not point at itself. A self-alias would look harmless and would
-- silently double every row in a resolved id set.
DROP TRIGGER IF EXISTS trg_w10_alias_no_self;
CREATE TRIGGER trg_w10_alias_no_self
BEFORE INSERT ON investor_identity_alias
WHEN NEW.alias_investor_id = NEW.canonical_user_id
BEGIN
  SELECT RAISE(ABORT, 'INVESTOR_ALIAS_SELF_REFERENCE: alias_investor_id must differ from canonical_user_id');
END;

-- An alias may not chain: the target of an alias must not itself be aliased.
-- Chains turn a lookup into a graph walk, and a cycle turns it into a hang.
-- One hop, always.
DROP TRIGGER IF EXISTS trg_w10_alias_no_chain;
CREATE TRIGGER trg_w10_alias_no_chain
BEFORE INSERT ON investor_identity_alias
WHEN EXISTS (SELECT 1 FROM investor_identity_alias
              WHERE alias_investor_id = NEW.canonical_user_id AND state = 'active')
BEGIN
  SELECT RAISE(ABORT, 'INVESTOR_ALIAS_CHAIN: canonical_user_id is itself an active alias; resolve to the terminal identity');
END;

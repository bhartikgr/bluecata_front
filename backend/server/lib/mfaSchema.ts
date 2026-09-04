/**
 * server/lib/mfaSchema.ts — WAVE 305 · R251.
 *
 * GENERATED. Source of truth: migrations/0230_wave305_mfa_enrolment.sql
 * (byte-identically mirrored at server/db/migrations/0230_wave305_mfa_enrolment.sql).
 *
 * WHY THIS EXISTS
 * ---------------
 * The MFA tables must exist on the `:memory:` test path and on any database that
 * has not yet run the migration runner. `applyInlineMigrations()` in
 * `server/db/connection.ts` is the project's normal third home for that, but this
 * wave does not edit that file. The bootstrap therefore lives beside the module
 * that owns the tables (server/lib/mfaStore.ts) and executes the CANONICAL
 * MIGRATION TEXT VERBATIM rather than a hand-copied paraphrase that could drift.
 * This is the same arrangement WAVE 21 used for rateLimitStoreSchema.ts and
 * WAVE 3E used for feeSettlementAuthoritySchema.ts.
 *
 * The text below is the migration file with ONLY backslash / backtick / ${ }
 * sequences escaped for the template literal; JS unescapes them back to the exact
 * file bytes. `server/__tests__/w305_mfa_migration_mirror.test.ts` asserts that
 * byte-equality against BOTH .sql copies, so drift fails loudly.
 */

export const MFA_SCHEMA_SQL = `-- migrations/0230_wave305_mfa_enrolment.sql
-- WAVE 305 · R251 — MFA ENROLMENT, RECOVERY AND POLICY.
--
-- WHAT THIS IS FOR
--   \`auth_users.totp_secret\` already exists (0001_sprint17_sync_and_auth.sql:194)
--   and is UNCHANGED by this migration. Today the ONLY thing that writes it is a
--   scaffold route (\`server/lib/secureAuthRoutes.ts\` POST /api/auth/secure/2fa/setup)
--   which writes the secret BEFORE any code has been verified, and whose sibling
--   verify route accepts ANY six digits without reading the secret at all.
--
--   So a stored secret is not evidence of anything. This migration adds the state
--   that turns a stored secret into a CONFIRMED enrolment, so that a secret ALONE
--   can never enforce anything and can never lock anybody out.
--
-- THE LOCK-OUT PREVENTION IS STRUCTURAL, NOT A CONVENTION (R251.3)
--   \`mfa_policy.mode\` has a CHECK constraint over exactly two values:
--     'off'            — no account is ever challenged.
--     'enrolled_only'  — challenge ONLY an account whose mfa_enrolment.state
--                        is 'confirmed'.
--   There is deliberately NO 'required' mode and no role list. An administrator
--   therefore CANNOT set a value that challenges an account which has not
--   enrolled, because the database refuses to store one. Retroactive enforcement
--   is not "forbidden by policy" — it is UNREPRESENTABLE.
--
--   If the owner ever wants true mandatory MFA, that is a future wave which must
--   add a mode, an enrolment grace period and a break-glass path, with its own
--   preflight. It is explicitly out of W305.
--
-- MIGRATION NUMBER — 0230. Verified against THIS tree on 2026-09-03, not assumed:
--   \`ls migrations/*.sql | sort | tail -1\` and
--   \`ls server/db/migrations/*.sql | sort | tail -1\` BOTH end at
--   0229_wave230_test_data_exclusion.sql. 0230 is the next free id in both
--   directories. 0231 is left free.
--
-- MIRRORING — this file is mirrored BYTE-IDENTICALLY into
--   server/db/migrations/0230_wave305_mfa_enrolment.sql, and its text is executed
--   VERBATIM for the \`:memory:\` test path by server/lib/mfaSchema.ts (the same
--   arrangement WAVE 21 used for rateLimitStoreSchema.ts, so no hand-copied
--   paraphrase can drift). A test asserts all three are byte-equal.
--
-- NOTHING IS DROPPED AND NOTHING IS ALTERED DESTRUCTIVELY (R195.5).

-- ---------------------------------------------------------------------------
-- One row per user who has begun or completed enrolment.
--
-- \`state\` is the ONLY thing enforcement ever reads. \`auth_users.totp_secret\` is
-- never consulted by the login gate, so the scaffold's stray secrets are inert.
--
-- \`last_used_step\` is the RFC 6238 counter of the last ACCEPTED code. It is a
-- COLUMN and not a cache because replay protection must survive a restart: a
-- code accepted at step N must be refused for the remainder of its own validity
-- window even across a deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_enrolment (
  user_id        TEXT PRIMARY KEY NOT NULL,
  method         TEXT NOT NULL CHECK (method IN ('totp')),
  state          TEXT NOT NULL CHECK (state IN ('pending','confirmed','disabled')),
  confirmed_at   INTEGER,
  last_used_step INTEGER,
  disabled_at    INTEGER,
  -- THE SHARED SECRET LIVES HERE, NOT ON auth_users.
  -- Wave 305 originally reused \`auth_users.totp_secret\` and that was wrong twice
  -- over. First, that column is POLLUTED: the retired scaffold wrote undecodable
  -- values into it for anybody who ever opened the old setup screen, and any
  -- future reader that mistakes a non-empty value for "MFA is on" reintroduces
  -- exactly the lock-out this wave exists to prevent. Second, not every account
  -- HAS an \`auth_users\` row — the legacy/seeded personas do not — so an enrolment
  -- keyed there silently failed to store anything and the user could never
  -- confirm. Keeping the secret on the enrolment row makes the rule
  -- "enforcement reads state, never a secret" structural rather than a
  -- convention: the gate reads this table's \`state\` column and nothing in the
  -- login path reads \`totp_secret\` at all, in either table.
  totp_secret    TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_mfa_enrolment_state
  ON mfa_enrolment (state);

-- ---------------------------------------------------------------------------
-- Single-use recovery codes. The PLAINTEXT CODE IS NEVER STORED: \`code_hash\`
-- holds the platform's existing scrypt hash (\`server/lib/auth.ts\` hashPassword,
-- format \`s2$N$r$p$salt$hash\`). No new hashing scheme is introduced.
--
-- \`used_at\` NULL means unused. A used row is NEVER deleted and never re-issued,
-- so consumption is auditable from the table itself.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_recovery_code (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL,
  code_hash  TEXT    NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_mfa_recovery_user
  ON mfa_recovery_code (user_id, used_at);

-- ---------------------------------------------------------------------------
-- Platform-wide policy. Exactly one row (\`CHECK (id = 1)\`).
--
-- THE CHECK CONSTRAINT ON \`mode\` IS THE LOCK-OUT PREVENTION. There is no value
-- in this domain that challenges an un-enrolled account. Attempting to insert a
-- third value must be refused BY THE DATABASE, and a test proves it is.
--
-- \`scope_json\` is reserved and NULL today. It is not read by any code path in
-- W305; it exists so that a future scoped policy does not need a migration to
-- widen a column. It is deliberately NOT a role list, because a role list would
-- be a way to express the retroactive enforcement this design refuses.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_policy (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  mode        TEXT    NOT NULL CHECK (mode IN ('off','enrolled_only')),
  scope_json  TEXT,
  updated_by  TEXT,
  updated_at  INTEGER NOT NULL
);

-- The default is 'enrolled_only'. That is SAFE precisely because of the domain
-- above: with zero confirmed enrolments on the platform it challenges NOBODY,
-- and it can only ever challenge an account that has already proved it can
-- produce a working code. It is not "MFA on"; it is "MFA honoured for whoever
-- has opted in".
INSERT OR IGNORE INTO mfa_policy (id, mode, scope_json, updated_by, updated_at)
  VALUES (1, 'enrolled_only', NULL, NULL, 0);
`;

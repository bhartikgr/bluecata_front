-- 0064_v25_45_4_profile_wizard_state.sql
--
-- v25.45.4 M-4 (Ozan live QA wave) — Profile Wizard DB-backed persistence.
--
-- ADDITIVE ONLY. The founder Profile Wizard (/founder/profile/wizard) held its
-- step values in in-memory React state only, so Step 2/3 values were lost by the
-- time Step 4 Confirm rendered (showed "0/3 jurisdictions filled" despite the
-- founder having typed values), violating Tier 5 #28 (zero in-memory) and Tier 6
-- #48 (Save -> Restart -> Load). This table durably persists the wizard state
-- per (company_id, user_id) so every Step Next round-trips to the DB and every
-- step Load hydrates from it.
--
-- One row per (company_id, user_id). state_json holds the full wizard payload
-- (all step fields); updated_at lets us pick the freshest row. No DROP, no
-- destructive ALTER. CREATE TABLE IF NOT EXISTS is safe to re-run.

CREATE TABLE IF NOT EXISTS profile_wizard_state (
  company_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  state_json  TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (company_id, user_id)
);

-- 0112_captable_unpriced_instrument.sql
-- W-SAFE (2026-07-14) — unpriced-instrument (SAFE / convertible note) commit support.
--
-- Additive + idempotent. Existing rows keep instrument_class='priced' (default), so
-- NO historical commit is reinterpreted and NO existing hash changes. New unpriced
-- rows carry principal_amount + valuation_cap + discount_pct; these three plus
-- instrument_class enter the commit hash body (buildCommitBody) so the immutable
-- ledger cryptographically commits the SAFE's economic substance.
--
-- Mirrored to server/db/migrations/0112_captable_unpriced_instrument.sql and
-- self-healed inline in server/db/connection.ts (ADD COLUMN guarded by try/duplicate).

ALTER TABLE captable_commits ADD COLUMN instrument_class TEXT NOT NULL DEFAULT 'priced';
ALTER TABLE captable_commits ADD COLUMN principal_amount TEXT;
ALTER TABLE captable_commits ADD COLUMN valuation_cap TEXT;
ALTER TABLE captable_commits ADD COLUMN discount_pct TEXT;

ALTER TABLE funded_queue ADD COLUMN instrument_class TEXT NOT NULL DEFAULT 'priced';

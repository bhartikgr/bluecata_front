-- 0121_wave0_currency_ref.sql — Wave 0 deliverable 0-1 part 1.
-- Ships `currency_ref` as immutable FK-target reference data per V7 §5.0 and
-- DECISION_LOG D-4-Rev. Runtime money math continues to use server/lib/currency.ts
-- (single truth source); this table exists only so FK-target integrity is DB-enforced
-- for Waves D and E.
--
-- DEPLOYMENT STATUS: Wave 0 migrations 0121-0123 have NEVER been applied to
-- any live environment. Migration IDs have been edited in place across
-- v1->v2->v3->v4 review rounds, which is safe ONLY while the wave remains
-- pre-code. If Wave 0 ever ships to a live DB before this constraint is
-- lifted, subsequent schema changes MUST bump to fresh migration IDs and
-- rewrite as re-shape migrations. See v3 review Opus M5. This file is the
-- primary carrier of the legacy risk (13 metal/fund rows that a pre-existing
-- v0 DB would retain and that no trigger permits deleting).
--
-- Wave 0 Increment 1 review correction (Aug 2026):
--   - Exponents corrected to ISO 4217 canonical values (HUF=2, TWD=2, CLF=4, UYW=4).
--     Historical divergence from ISO was safe to correct: zero DB rows and zero
--     tests referenced the pre-correction values.
--   - Metals and fund codes REMOVED from seed (13 codes): XAG, XAU, XBA, XBB, XBC, XBD, XDR, XPD, XPT, XSU, XTS, XUA, XXX.
--     ISO 4217 defines no minor unit for these. They are not settlement currencies
--     for this platform. Removal is a NAMED decision, not a silent drop.
--   - CHECK constraint tightened to IN (0, 2, 3, 4) — the four exponents ISO 4217
--     actually defines. Values 1 and 5+ are provably invalid.
--
-- Three-place rule: this file + server/db/migrations/0121_*.sql (byte-identical
-- mirror) + applyWave0CurrencyRefSchema() in server/db/connection.ts. All three
-- MUST agree on the 167-code seed with matching exponents.

CREATE TABLE IF NOT EXISTS currency_ref (
  code                TEXT PRIMARY KEY NOT NULL
                        CHECK (length(code) = 3 AND code = upper(code)),
  minor_unit_exponent INTEGER NOT NULL
                        CHECK (minor_unit_exponent IN (0, 2, 3, 4)),
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) STRICT;

-- Immutability: `code` and `minor_unit_exponent` are permanent facts about the
-- currency (ISO 4217 canonical). Blocklist trigger — the only mutable column is
-- `is_active`, and any future column added to the table defaults to mutable
-- (an ADR note captures this trade-off).
CREATE TRIGGER IF NOT EXISTS trg_currency_ref_immutable
  BEFORE UPDATE ON currency_ref
  WHEN NEW.code <> OLD.code OR NEW.minor_unit_exponent <> OLD.minor_unit_exponent
  BEGIN
    SELECT RAISE(ABORT, 'CURRENCY_REF_IMMUTABLE');
  END;

CREATE TRIGGER IF NOT EXISTS trg_currency_ref_no_delete
  BEFORE DELETE ON currency_ref
  BEGIN
    SELECT RAISE(ABORT, 'CURRENCY_REF_NO_DELETE');
  END;

-- Seed: 167 ISO 4217 active alphabetic codes (fiat only; metals/funds excluded).
-- Exponents mirror server/lib/currency.ts CURRENCY_EXPONENT_OVERRIDES.
-- INSERT OR IGNORE is safe for a fresh install (empty table) and idempotent on
-- re-run (existing rows already present). Drift detection is enforced by
-- server/__tests__/wave0_new_guards.test.ts (Wave 0 Increment 1 item 7).
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('AED', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('AFN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ALL', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('AMD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ANG', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('AOA', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ARS', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('AUD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('AWG', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('AZN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BAM', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BBD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BDT', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BGN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BHD', 3, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BIF', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BMD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BND', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BOB', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BOV', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BRL', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BSD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BTN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BWP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BYN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('BZD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CAD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CDF', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CHE', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CHF', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CHW', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CLF', 4, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CLP', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CNY', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('COP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('COU', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CRC', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CUC', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CUP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CVE', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('CZK', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('DJF', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('DKK', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('DOP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('DZD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('EGP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ERN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ETB', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('EUR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('FJD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('FKP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('GBP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('GEL', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('GHS', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('GIP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('GMD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('GNF', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('GTQ', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('GYD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('HKD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('HNL', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('HTG', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('HUF', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('IDR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ILS', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('INR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('IQD', 3, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('IRR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ISK', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('JMD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('JOD', 3, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('JPY', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('KES', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('KGS', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('KHR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('KMF', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('KPW', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('KRW', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('KWD', 3, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('KYD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('KZT', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('LAK', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('LBP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('LKR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('LRD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('LSL', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('LYD', 3, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MAD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MDL', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MGA', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MKD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MMK', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MNT', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MOP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MRU', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MUR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MVR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MWK', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MXN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MXV', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MYR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('MZN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('NAD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('NGN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('NIO', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('NOK', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('NPR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('NZD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('OMR', 3, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('PAB', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('PEN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('PGK', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('PHP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('PKR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('PLN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('PYG', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('QAR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('RON', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('RSD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('RUB', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('RWF', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SAR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SBD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SCR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SDG', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SEK', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SGD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SHP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SLE', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SOS', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SRD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SSP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('STN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SVC', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SYP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('SZL', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('THB', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('TJS', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('TMT', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('TND', 3, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('TOP', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('TRY', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('TTD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('TWD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('TZS', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('UAH', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('UGX', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('USD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('USN', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('UYI', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('UYU', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('UYW', 4, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('UZS', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('VED', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('VES', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('VND', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('VUV', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('WST', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('XAF', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('XCD', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('XCG', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('XOF', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('XPF', 0, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('YER', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ZAR', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ZMW', 2, 1);
INSERT OR IGNORE INTO currency_ref (code, minor_unit_exponent, is_active) VALUES ('ZWG', 2, 1);

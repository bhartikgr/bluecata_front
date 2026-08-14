-- WAVE 48 · ITEM 1 · OWNER RULING R14 ("Fix it.") — A TYPE FLOOR ON EVERY
-- MONEY-SHAPED COLUMN THAT DID NOT HAVE ONE.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE DEFECT, MEASURED AND REPRODUCED — NOT INFERRED FROM SQL TEXT
-- ─────────────────────────────────────────────────────────────────────────────
-- Review 4A (finding N3) reported "43 non-STRICT tables carry money-shaped
-- numeric columns, and they accept 'not-a-number'". Wave 48 re-measured that
-- claim against a database built end-to-end by the shipped migrator
-- (`server/db/migrate.ts`, 166 migrations) rather than against the ad-hoc
-- `/tmp/r4a_prod.db` copy the original probe used:
--
--     tables with a money-shaped numeric column ............. 64
--       of which STRICT (already have a type floor) ......... 21   (0183 et al.)
--       of which non-STRICT (NO type floor) ................. 43
--     money-shaped columns on those non-STRICT tables ....... 71
--
-- 43 non-STRICT tables — the owner's number reconciles exactly. The full
-- enumeration is `build_log/wave48/money_column_inventory.tsv`; every count in
-- the wave report is derived from that file.
--
-- Reproduction before the fix (`build_log/wave48/poles_before.txt`), on nine of
-- the tables below, each insert rolled back so nothing was mutated:
--
--     INSERT INTO invoices(amount_minor) VALUES ('not-a-number')
--        -> ACCEPTED, stored text "not-a-number"
--     INSERT INTO invoices(amount_minor) VALUES ('12.5')
--        -> ACCEPTED, stored real 12.5
--
-- In a non-STRICT SQLite table `INTEGER` is an AFFINITY, not a type: a string
-- that cannot be losslessly converted is stored verbatim, and one that looks
-- numeric is silently converted to REAL. A money column that can hold
-- `'not-a-number'` — or a REAL 12.5 where the contract is integer minor units —
-- has no floor at all. These are audit, telemetry, config and legacy-mirror
-- tables rather than the ledger of record (partner balances are computed from
-- `partner_invoice_line`; the cap-table ledger is the hash-chained, sacred
-- `captable_commits`), which is why this is hardening and not an emergency. It
-- is NOT a reason to leave it: these rows are read back and rendered to
-- operators and investors.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY TRIGGERS AND NOT 43 TABLE REBUILDS — STATED PLAINLY
-- ─────────────────────────────────────────────────────────────────────────────
-- SQLite cannot add STRICT, and cannot add a CHECK constraint, to an existing
-- table. Both require the 12-step rebuild that migration 0183 performed for the
-- six event tables: create a twin, copy every row, DROP the original (which
-- drops its indexes and triggers with it), rename, then recreate every index
-- and trigger by hand. 0183 did that for SIX tables and needed 533 lines to do
-- it honestly.
--
-- Doing it for 43 tables — several of which are referenced by foreign keys,
-- carry append-only triggers, back views, and (measured) already hold live rows
-- — would mean dropping and hand-recreating on the order of a hundred indexes
-- and triggers inside one migration. The dominant risk of that migration is not
-- the type floor: it is SILENTLY LOSING AN INDEX OR A TRIGGER during the
-- rebuild, which is exactly the class of silent drop this project forbids.
--
-- A BEFORE INSERT / BEFORE UPDATE trigger raising RAISE(ABORT) gives the
-- IDENTICAL write-time refusal, in place, with no rebuild:
--   * it drops nothing — every existing index, trigger, view and FK survives
--     untouched, so there is no silent-drop surface at all;
--   * it is safe on a POPULATED table (measured: these tables hold live rows in
--     `work/data.db`, `test.db` and `data/opus_audit.db`), because no row is
--     copied and no historical row is rewritten;
--   * it is enforced by the database engine on every write path — application
--     code, a raw `sqlite3` shell, a future ORM — not by application validation;
--   * it is idempotent and re-runnable — see the WAVE 49 note below on HOW.
--
-- ──────────────────────────────────────────────────────────────────────
-- WAVE 49 · A-6B — DROP-AND-RECREATE, NOT `IF NOT EXISTS`
-- ──────────────────────────────────────────────────────────────────────
-- As first written, all 142 triggers below used `CREATE TRIGGER IF NOT EXISTS`.
-- Review A finding A-6B: that is not idempotent, it is CONDITIONAL — SQLite
-- matches on NAME ONLY. A database that already carries a trigger of the same
-- name but DIFFERENT logic (an earlier revision of this file, a hand-applied
-- hotfix, a partial apply someone patched up by hand) silently keeps the old
-- body, and this migration reports success. The type floor would then be
-- whatever that other definition says, while the ledger claims 0186 is applied.
-- A weaker floor that LOOKS applied is worse than no floor, because nobody
-- re-checks it.
--
-- Every trigger is therefore now `DROP TRIGGER IF EXISTS <name>;` immediately
-- followed by an unconditional `CREATE TRIGGER <name>`. After this migration
-- runs, each of the 142 triggers is definitionally the body written in THIS
-- file, whatever was there before.
--
-- This is safe to do here, and specifically it is not the "silent drop" this
-- project forbids:
--   * `server/db/migrate.ts:applyOne()` wraps every statement of a migration
--     file in ONE `db.transaction(...)`, and SQLite DDL is transactional — so
--     the DROP and the CREATE either both land or neither does. There is no
--     committed state in which a floor has been dropped and not replaced.
--   * The DROP is scoped by exact name to the 142 `w48_money_typefloor_*`
--     triggers this file owns. It cannot touch an append-only guard, an
--     immutability trigger, or anything else.
--   * Dropping a BEFORE INSERT/UPDATE trigger mutates no row, so a populated
--     table is unaffected.
--
-- Amended in place rather than adding 0187: see build_log/WAVE49_REPORT.md for
-- why, including what to do if a database has ALREADY recorded 0186 as applied
-- (the runner skips a recorded file, so for that population the guarantee comes
-- from the boot doctor's per-trigger definition check, not from this file).
--
-- WHAT THIS DELIBERATELY DOES NOT DO, so nobody is misled: it does not
-- retroactively validate historical rows (a rebuild-with-CHECK would have
-- failed the copy instead). Wave 48 surveyed every one of the 71 columns in
-- four databases and found ZERO existing non-conforming cells
-- (`build_log/wave48/existing_row_survey.txt`), so there is nothing to
-- quarantine today; the floor governs writes from here on.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- BOTH POLES ARE PART OF THE CONSTRAINT ITSELF
-- ─────────────────────────────────────────────────────────────────────────────
--   * A legitimate integer minor-unit value still inserts. `1250` (USD, exponent
--     2) and `1234` (JPY, exponent 0 — the same integer means ¥1,234, unscaled)
--     both pass. No `/100` or `*100` appears anywhere in this migration.
--   * NULL is STILL PERMITTED wherever the column is nullable. R6's
--     honest-refusal rule (Waves 42 and 46) depends on "never entered" being
--     representable as NULL and rendered "Not provided". A floor that rejected
--     NULL would silently convert an honest refusal into a forced zero. Every
--     trigger below is guarded by `WHEN NEW.<col> IS NOT NULL`.
--   * Columns already declared NOT NULL keep refusing NULL — that is their
--     pre-existing contract and this migration does not touch it.
--
-- TWO DELIBERATE, DISCLOSED DISTINCTIONS
--   1. 65 columns are declared INTEGER and are integer minor units (or, for
--      `investor_crm_contacts.check_size_usd` and `founder_tiers.annual_price_cents`,
--      integer whole units). Floor: `typeof(col) = 'integer'`.
--   2. 6 columns are declared REAL and are LEGACY MAJOR-UNIT float columns
--      (partner_deal_pipeline.deal_size_usd, rounds.raised_amount, rounds.target_amount, securities.investment_amount, soft_circles.amount, your_decision_records.amount).
--      Forcing `typeof = 'integer'` on those would REJECT LEGITIMATE WRITES —
--      that would be a new defect, not a fix. Their floor is therefore
--      `typeof(col) IN ('integer','real')`: text and blob are refused, numbers
--      are not. This is honest hardening of a column whose contract is a float;
--      it is NOT an endorsement of float money and it does not migrate them.
--   3. `audit_chain_verifications.total_rows` is matched by the `total_` money
--      heuristic but is a ROW COUNT, not money. An integer floor is correct and
--      harmless for it, so it is kept rather than exempted (an exemption list is
--      a thing that rots; a correct constraint is not).
--
-- ONE MIGRATION, BATCHED. 43 separate migrations would be unmanageable and
-- would make the invariant impossible to read. Every statement below is
-- generated from the measured inventory by
-- `build_log/wave48/gen_0186.py` — no hand-written table list exists.
--
-- MIRROR: this file has a byte-identical twin in `server/db/migrations/`
-- (`w9_migration_mirror_drift.test.ts` enforces it; a missing mirror was Wave
-- 43's only regression).


-- ── audit_chain_verifications ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_audit_chain_verifications_total_rows;
CREATE TRIGGER w48_money_typefloor_ins_audit_chain_verifications_total_rows
  BEFORE INSERT ON "audit_chain_verifications"
  FOR EACH ROW WHEN NEW."total_rows" IS NOT NULL AND typeof(NEW."total_rows") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: audit_chain_verifications.total_rows accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_audit_chain_verifications_total_rows;
CREATE TRIGGER w48_money_typefloor_upd_audit_chain_verifications_total_rows
  BEFORE UPDATE OF "total_rows" ON "audit_chain_verifications"
  FOR EACH ROW WHEN NEW."total_rows" IS NOT NULL AND typeof(NEW."total_rows") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: audit_chain_verifications.total_rows accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── billing_disputes ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_billing_disputes_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_billing_disputes_amount_minor
  BEFORE INSERT ON "billing_disputes"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: billing_disputes.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_billing_disputes_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_billing_disputes_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "billing_disputes"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: billing_disputes.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── chapters ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_chapters_membership_fee_annual_minor;
CREATE TRIGGER w48_money_typefloor_ins_chapters_membership_fee_annual_minor
  BEFORE INSERT ON "chapters"
  FOR EACH ROW WHEN NEW."membership_fee_annual_minor" IS NOT NULL AND typeof(NEW."membership_fee_annual_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: chapters.membership_fee_annual_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_chapters_membership_fee_annual_minor;
CREATE TRIGGER w48_money_typefloor_upd_chapters_membership_fee_annual_minor
  BEFORE UPDATE OF "membership_fee_annual_minor" ON "chapters"
  FOR EACH ROW WHEN NEW."membership_fee_annual_minor" IS NOT NULL AND typeof(NEW."membership_fee_annual_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: chapters.membership_fee_annual_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── collective_application_fee_config ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_collective_application_fee_config_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_collective_application_fee_config_amount_minor
  BEFORE INSERT ON "collective_application_fee_config"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_application_fee_config.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_collective_application_fee_config_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_collective_application_fee_config_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "collective_application_fee_config"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_application_fee_config.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── collective_invoices ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_collective_invoices_total_minor;
CREATE TRIGGER w48_money_typefloor_ins_collective_invoices_total_minor
  BEFORE INSERT ON "collective_invoices"
  FOR EACH ROW WHEN NEW."total_minor" IS NOT NULL AND typeof(NEW."total_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_invoices.total_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_collective_invoices_total_minor;
CREATE TRIGGER w48_money_typefloor_upd_collective_invoices_total_minor
  BEFORE UPDATE OF "total_minor" ON "collective_invoices"
  FOR EACH ROW WHEN NEW."total_minor" IS NOT NULL AND typeof(NEW."total_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_invoices.total_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── collective_payment_entries ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_collective_payment_entries_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_collective_payment_entries_amount_minor
  BEFORE INSERT ON "collective_payment_entries"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_payment_entries.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_collective_payment_entries_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_collective_payment_entries_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "collective_payment_entries"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_payment_entries.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── collective_payment_schedules ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_collective_payment_schedules_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_collective_payment_schedules_amount_minor
  BEFORE INSERT ON "collective_payment_schedules"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_payment_schedules.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_collective_payment_schedules_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_collective_payment_schedules_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "collective_payment_schedules"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_payment_schedules.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── collective_subscription_configs ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_collective_subscription_configs_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_collective_subscription_configs_amount_minor
  BEFORE INSERT ON "collective_subscription_configs"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_subscription_configs.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_collective_subscription_configs_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_collective_subscription_configs_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "collective_subscription_configs"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: collective_subscription_configs.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── founder_tiers ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_founder_tiers_annual_price_cents;
CREATE TRIGGER w48_money_typefloor_ins_founder_tiers_annual_price_cents
  BEFORE INSERT ON "founder_tiers"
  FOR EACH ROW WHEN NEW."annual_price_cents" IS NOT NULL AND typeof(NEW."annual_price_cents") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: founder_tiers.annual_price_cents accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_founder_tiers_annual_price_cents;
CREATE TRIGGER w48_money_typefloor_upd_founder_tiers_annual_price_cents
  BEFORE UPDATE OF "annual_price_cents" ON "founder_tiers"
  FOR EACH ROW WHEN NEW."annual_price_cents" IS NOT NULL AND typeof(NEW."annual_price_cents") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: founder_tiers.annual_price_cents accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── investor_crm_contacts ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_investor_crm_contacts_check_size_usd;
CREATE TRIGGER w48_money_typefloor_ins_investor_crm_contacts_check_size_usd
  BEFORE INSERT ON "investor_crm_contacts"
  FOR EACH ROW WHEN NEW."check_size_usd" IS NOT NULL AND typeof(NEW."check_size_usd") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: investor_crm_contacts.check_size_usd accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_investor_crm_contacts_check_size_usd;
CREATE TRIGGER w48_money_typefloor_upd_investor_crm_contacts_check_size_usd
  BEFORE UPDATE OF "check_size_usd" ON "investor_crm_contacts"
  FOR EACH ROW WHEN NEW."check_size_usd" IS NOT NULL AND typeof(NEW."check_size_usd") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: investor_crm_contacts.check_size_usd accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── invoices ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_invoices_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_invoices_amount_minor
  BEFORE INSERT ON "invoices"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: invoices.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_invoices_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_invoices_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "invoices"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: invoices.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_invoices_tax_minor;
CREATE TRIGGER w48_money_typefloor_ins_invoices_tax_minor
  BEFORE INSERT ON "invoices"
  FOR EACH ROW WHEN NEW."tax_minor" IS NOT NULL AND typeof(NEW."tax_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: invoices.tax_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_invoices_tax_minor;
CREATE TRIGGER w48_money_typefloor_upd_invoices_tax_minor
  BEFORE UPDATE OF "tax_minor" ON "invoices"
  FOR EACH ROW WHEN NEW."tax_minor" IS NOT NULL AND typeof(NEW."tax_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: invoices.tax_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_invoices_total_minor;
CREATE TRIGGER w48_money_typefloor_ins_invoices_total_minor
  BEFORE INSERT ON "invoices"
  FOR EACH ROW WHEN NEW."total_minor" IS NOT NULL AND typeof(NEW."total_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: invoices.total_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_invoices_total_minor;
CREATE TRIGGER w48_money_typefloor_upd_invoices_total_minor
  BEFORE UPDATE OF "total_minor" ON "invoices"
  FOR EACH ROW WHEN NEW."total_minor" IS NOT NULL AND typeof(NEW."total_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: invoices.total_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── partner_billing_entries ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_billing_entries_amount_funded_minor;
CREATE TRIGGER w48_money_typefloor_ins_partner_billing_entries_amount_funded_minor
  BEFORE INSERT ON "partner_billing_entries"
  FOR EACH ROW WHEN NEW."amount_funded_minor" IS NOT NULL AND typeof(NEW."amount_funded_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_billing_entries.amount_funded_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_billing_entries_amount_funded_minor;
CREATE TRIGGER w48_money_typefloor_upd_partner_billing_entries_amount_funded_minor
  BEFORE UPDATE OF "amount_funded_minor" ON "partner_billing_entries"
  FOR EACH ROW WHEN NEW."amount_funded_minor" IS NOT NULL AND typeof(NEW."amount_funded_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_billing_entries.amount_funded_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_billing_entries_commission_minor;
CREATE TRIGGER w48_money_typefloor_ins_partner_billing_entries_commission_minor
  BEFORE INSERT ON "partner_billing_entries"
  FOR EACH ROW WHEN NEW."commission_minor" IS NOT NULL AND typeof(NEW."commission_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_billing_entries.commission_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_billing_entries_commission_minor;
CREATE TRIGGER w48_money_typefloor_upd_partner_billing_entries_commission_minor
  BEFORE UPDATE OF "commission_minor" ON "partner_billing_entries"
  FOR EACH ROW WHEN NEW."commission_minor" IS NOT NULL AND typeof(NEW."commission_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_billing_entries.commission_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── partner_deal_pipeline ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_deal_pipeline_deal_size_usd;
CREATE TRIGGER w48_money_typefloor_ins_partner_deal_pipeline_deal_size_usd
  BEFORE INSERT ON "partner_deal_pipeline"
  FOR EACH ROW WHEN NEW."deal_size_usd" IS NOT NULL AND typeof(NEW."deal_size_usd") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_deal_pipeline.deal_size_usd accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_deal_pipeline_deal_size_usd;
CREATE TRIGGER w48_money_typefloor_upd_partner_deal_pipeline_deal_size_usd
  BEFORE UPDATE OF "deal_size_usd" ON "partner_deal_pipeline"
  FOR EACH ROW WHEN NEW."deal_size_usd" IS NOT NULL AND typeof(NEW."deal_size_usd") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_deal_pipeline.deal_size_usd accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;


-- ── partner_fee_schedules ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_fee_schedules_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_partner_fee_schedules_amount_minor
  BEFORE INSERT ON "partner_fee_schedules"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_fee_schedules.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_fee_schedules_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_partner_fee_schedules_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "partner_fee_schedules"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_fee_schedules.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── partner_portfolio_companies ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_portfolio_companies_lead_invested_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_partner_portfolio_companies_lead_invested_amount_minor
  BEFORE INSERT ON "partner_portfolio_companies"
  FOR EACH ROW WHEN NEW."lead_invested_amount_minor" IS NOT NULL AND typeof(NEW."lead_invested_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_portfolio_companies.lead_invested_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_portfolio_companies_lead_invested_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_partner_portfolio_companies_lead_invested_amount_minor
  BEFORE UPDATE OF "lead_invested_amount_minor" ON "partner_portfolio_companies"
  FOR EACH ROW WHEN NEW."lead_invested_amount_minor" IS NOT NULL AND typeof(NEW."lead_invested_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_portfolio_companies.lead_invested_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── partner_subscription_change ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_subscription_change_from_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_partner_subscription_change_from_amount_minor
  BEFORE INSERT ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."from_amount_minor" IS NOT NULL AND typeof(NEW."from_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.from_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_subscription_change_from_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_partner_subscription_change_from_amount_minor
  BEFORE UPDATE OF "from_amount_minor" ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."from_amount_minor" IS NOT NULL AND typeof(NEW."from_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.from_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_subscription_change_net_due_minor;
CREATE TRIGGER w48_money_typefloor_ins_partner_subscription_change_net_due_minor
  BEFORE INSERT ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."net_due_minor" IS NOT NULL AND typeof(NEW."net_due_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.net_due_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_subscription_change_net_due_minor;
CREATE TRIGGER w48_money_typefloor_upd_partner_subscription_change_net_due_minor
  BEFORE UPDATE OF "net_due_minor" ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."net_due_minor" IS NOT NULL AND typeof(NEW."net_due_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.net_due_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_subscription_change_new_charge_minor;
CREATE TRIGGER w48_money_typefloor_ins_partner_subscription_change_new_charge_minor
  BEFORE INSERT ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."new_charge_minor" IS NOT NULL AND typeof(NEW."new_charge_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.new_charge_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_subscription_change_new_charge_minor;
CREATE TRIGGER w48_money_typefloor_upd_partner_subscription_change_new_charge_minor
  BEFORE UPDATE OF "new_charge_minor" ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."new_charge_minor" IS NOT NULL AND typeof(NEW."new_charge_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.new_charge_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_subscription_change_to_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_partner_subscription_change_to_amount_minor
  BEFORE INSERT ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."to_amount_minor" IS NOT NULL AND typeof(NEW."to_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.to_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_subscription_change_to_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_partner_subscription_change_to_amount_minor
  BEFORE UPDATE OF "to_amount_minor" ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."to_amount_minor" IS NOT NULL AND typeof(NEW."to_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.to_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_partner_subscription_change_unused_credit_minor;
CREATE TRIGGER w48_money_typefloor_ins_partner_subscription_change_unused_credit_minor
  BEFORE INSERT ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."unused_credit_minor" IS NOT NULL AND typeof(NEW."unused_credit_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.unused_credit_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_partner_subscription_change_unused_credit_minor;
CREATE TRIGGER w48_money_typefloor_upd_partner_subscription_change_unused_credit_minor
  BEFORE UPDATE OF "unused_credit_minor" ON "partner_subscription_change"
  FOR EACH ROW WHEN NEW."unused_credit_minor" IS NOT NULL AND typeof(NEW."unused_credit_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: partner_subscription_change.unused_credit_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── platform_fees ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_platform_fees_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_platform_fees_amount_minor
  BEFORE INSERT ON "platform_fees"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: platform_fees.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_platform_fees_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_platform_fees_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "platform_fees"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: platform_fees.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── pricing_models ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_pricing_models_base_price_minor;
CREATE TRIGGER w48_money_typefloor_ins_pricing_models_base_price_minor
  BEFORE INSERT ON "pricing_models"
  FOR EACH ROW WHEN NEW."base_price_minor" IS NOT NULL AND typeof(NEW."base_price_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: pricing_models.base_price_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_pricing_models_base_price_minor;
CREATE TRIGGER w48_money_typefloor_upd_pricing_models_base_price_minor
  BEFORE UPDATE OF "base_price_minor" ON "pricing_models"
  FOR EACH ROW WHEN NEW."base_price_minor" IS NOT NULL AND typeof(NEW."base_price_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: pricing_models.base_price_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── rounds ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_rounds_raised_amount;
CREATE TRIGGER w48_money_typefloor_ins_rounds_raised_amount
  BEFORE INSERT ON "rounds"
  FOR EACH ROW WHEN NEW."raised_amount" IS NOT NULL AND typeof(NEW."raised_amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: rounds.raised_amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_rounds_raised_amount;
CREATE TRIGGER w48_money_typefloor_upd_rounds_raised_amount
  BEFORE UPDATE OF "raised_amount" ON "rounds"
  FOR EACH ROW WHEN NEW."raised_amount" IS NOT NULL AND typeof(NEW."raised_amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: rounds.raised_amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_rounds_target_amount;
CREATE TRIGGER w48_money_typefloor_ins_rounds_target_amount
  BEFORE INSERT ON "rounds"
  FOR EACH ROW WHEN NEW."target_amount" IS NOT NULL AND typeof(NEW."target_amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: rounds.target_amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_rounds_target_amount;
CREATE TRIGGER w48_money_typefloor_upd_rounds_target_amount
  BEFORE UPDATE OF "target_amount" ON "rounds"
  FOR EACH ROW WHEN NEW."target_amount" IS NOT NULL AND typeof(NEW."target_amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: rounds.target_amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;


-- ── securities ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_securities_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_securities_amount_minor
  BEFORE INSERT ON "securities"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: securities.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_securities_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_securities_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "securities"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: securities.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_securities_investment_amount;
CREATE TRIGGER w48_money_typefloor_ins_securities_investment_amount
  BEFORE INSERT ON "securities"
  FOR EACH ROW WHEN NEW."investment_amount" IS NOT NULL AND typeof(NEW."investment_amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: securities.investment_amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_securities_investment_amount;
CREATE TRIGGER w48_money_typefloor_upd_securities_investment_amount
  BEFORE UPDATE OF "investment_amount" ON "securities"
  FOR EACH ROW WHEN NEW."investment_amount" IS NOT NULL AND typeof(NEW."investment_amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: securities.investment_amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;


-- ── soft_circles ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_soft_circles_amount;
CREATE TRIGGER w48_money_typefloor_ins_soft_circles_amount
  BEFORE INSERT ON "soft_circles"
  FOR EACH ROW WHEN NEW."amount" IS NOT NULL AND typeof(NEW."amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: soft_circles.amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_soft_circles_amount;
CREATE TRIGGER w48_money_typefloor_upd_soft_circles_amount
  BEFORE UPDATE OF "amount" ON "soft_circles"
  FOR EACH ROW WHEN NEW."amount" IS NOT NULL AND typeof(NEW."amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: soft_circles.amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_soft_circles_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_soft_circles_amount_minor
  BEFORE INSERT ON "soft_circles"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: soft_circles.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_soft_circles_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_soft_circles_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "soft_circles"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: soft_circles.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_cap_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_cap_minor
  BEFORE INSERT ON "spv"
  FOR EACH ROW WHEN NEW."cap_minor" IS NOT NULL AND typeof(NEW."cap_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv.cap_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_cap_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_cap_minor
  BEFORE UPDATE OF "cap_minor" ON "spv"
  FOR EACH ROW WHEN NEW."cap_minor" IS NOT NULL AND typeof(NEW."cap_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv.cap_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_deployment_fee_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_deployment_fee_minor
  BEFORE INSERT ON "spv"
  FOR EACH ROW WHEN NEW."deployment_fee_minor" IS NOT NULL AND typeof(NEW."deployment_fee_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv.deployment_fee_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_deployment_fee_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_deployment_fee_minor
  BEFORE UPDATE OF "deployment_fee_minor" ON "spv"
  FOR EACH ROW WHEN NEW."deployment_fee_minor" IS NOT NULL AND typeof(NEW."deployment_fee_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv.deployment_fee_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_min_check_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_min_check_minor
  BEFORE INSERT ON "spv"
  FOR EACH ROW WHEN NEW."min_check_minor" IS NOT NULL AND typeof(NEW."min_check_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv.min_check_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_min_check_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_min_check_minor
  BEFORE UPDATE OF "min_check_minor" ON "spv"
  FOR EACH ROW WHEN NEW."min_check_minor" IS NOT NULL AND typeof(NEW."min_check_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv.min_check_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_target_raise_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_target_raise_minor
  BEFORE INSERT ON "spv"
  FOR EACH ROW WHEN NEW."target_raise_minor" IS NOT NULL AND typeof(NEW."target_raise_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv.target_raise_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_target_raise_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_target_raise_minor
  BEFORE UPDATE OF "target_raise_minor" ON "spv"
  FOR EACH ROW WHEN NEW."target_raise_minor" IS NOT NULL AND typeof(NEW."target_raise_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv.target_raise_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_capital_calls ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_capital_calls_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_capital_calls_amount_minor
  BEFORE INSERT ON "spv_capital_calls"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_capital_calls.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_capital_calls_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_capital_calls_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "spv_capital_calls"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_capital_calls.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_commitments ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_commitments_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_commitments_amount_minor
  BEFORE INSERT ON "spv_commitments"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_commitments.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_commitments_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_commitments_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "spv_commitments"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_commitments.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_deployment ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_deployment_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_deployment_amount_minor
  BEFORE INSERT ON "spv_deployment"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_deployment.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_deployment_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_deployment_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "spv_deployment"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_deployment.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_deployments ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_deployments_fee_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_deployments_fee_minor
  BEFORE INSERT ON "spv_deployments"
  FOR EACH ROW WHEN NEW."fee_minor" IS NOT NULL AND typeof(NEW."fee_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_deployments.fee_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_deployments_fee_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_deployments_fee_minor
  BEFORE UPDATE OF "fee_minor" ON "spv_deployments"
  FOR EACH ROW WHEN NEW."fee_minor" IS NOT NULL AND typeof(NEW."fee_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_deployments.fee_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_distribution ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_distribution_gp_carry_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_distribution_gp_carry_minor
  BEFORE INSERT ON "spv_distribution"
  FOR EACH ROW WHEN NEW."gp_carry_minor" IS NOT NULL AND typeof(NEW."gp_carry_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_distribution.gp_carry_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_distribution_gp_carry_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_distribution_gp_carry_minor
  BEFORE UPDATE OF "gp_carry_minor" ON "spv_distribution"
  FOR EACH ROW WHEN NEW."gp_carry_minor" IS NOT NULL AND typeof(NEW."gp_carry_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_distribution.gp_carry_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_distribution_gross_proceeds_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_distribution_gross_proceeds_minor
  BEFORE INSERT ON "spv_distribution"
  FOR EACH ROW WHEN NEW."gross_proceeds_minor" IS NOT NULL AND typeof(NEW."gross_proceeds_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_distribution.gross_proceeds_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_distribution_gross_proceeds_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_distribution_gross_proceeds_minor
  BEFORE UPDATE OF "gross_proceeds_minor" ON "spv_distribution"
  FOR EACH ROW WHEN NEW."gross_proceeds_minor" IS NOT NULL AND typeof(NEW."gross_proceeds_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_distribution.gross_proceeds_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_distribution_platform_carry_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_distribution_platform_carry_minor
  BEFORE INSERT ON "spv_distribution"
  FOR EACH ROW WHEN NEW."platform_carry_minor" IS NOT NULL AND typeof(NEW."platform_carry_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_distribution.platform_carry_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_distribution_platform_carry_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_distribution_platform_carry_minor
  BEFORE UPDATE OF "platform_carry_minor" ON "spv_distribution"
  FOR EACH ROW WHEN NEW."platform_carry_minor" IS NOT NULL AND typeof(NEW."platform_carry_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_distribution.platform_carry_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_distributions ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_distributions_total_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_distributions_total_minor
  BEFORE INSERT ON "spv_distributions"
  FOR EACH ROW WHEN NEW."total_minor" IS NOT NULL AND typeof(NEW."total_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_distributions.total_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_distributions_total_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_distributions_total_minor
  BEFORE UPDATE OF "total_minor" ON "spv_distributions"
  FOR EACH ROW WHEN NEW."total_minor" IS NOT NULL AND typeof(NEW."total_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_distributions.total_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_fee ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_fee_fixed_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_fee_fixed_amount_minor
  BEFORE INSERT ON "spv_fee"
  FOR EACH ROW WHEN NEW."fixed_amount_minor" IS NOT NULL AND typeof(NEW."fixed_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_fee.fixed_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_fee_fixed_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_fee_fixed_amount_minor
  BEFORE UPDATE OF "fixed_amount_minor" ON "spv_fee"
  FOR EACH ROW WHEN NEW."fixed_amount_minor" IS NOT NULL AND typeof(NEW."fixed_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_fee.fixed_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_fee_obligation ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_fee_obligation_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_fee_obligation_amount_minor
  BEFORE INSERT ON "spv_fee_obligation"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_fee_obligation.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_fee_obligation_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_fee_obligation_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "spv_fee_obligation"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_fee_obligation.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_mandate ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_mandate_check_max_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_mandate_check_max_minor
  BEFORE INSERT ON "spv_mandate"
  FOR EACH ROW WHEN NEW."check_max_minor" IS NOT NULL AND typeof(NEW."check_max_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_mandate.check_max_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_mandate_check_max_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_mandate_check_max_minor
  BEFORE UPDATE OF "check_max_minor" ON "spv_mandate"
  FOR EACH ROW WHEN NEW."check_max_minor" IS NOT NULL AND typeof(NEW."check_max_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_mandate.check_max_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_mandate_check_min_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_mandate_check_min_minor
  BEFORE INSERT ON "spv_mandate"
  FOR EACH ROW WHEN NEW."check_min_minor" IS NOT NULL AND typeof(NEW."check_min_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_mandate.check_min_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_mandate_check_min_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_mandate_check_min_minor
  BEFORE UPDATE OF "check_min_minor" ON "spv_mandate"
  FOR EACH ROW WHEN NEW."check_min_minor" IS NOT NULL AND typeof(NEW."check_min_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_mandate.check_min_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_positions ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_positions_basis_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_positions_basis_minor
  BEFORE INSERT ON "spv_positions"
  FOR EACH ROW WHEN NEW."basis_minor" IS NOT NULL AND typeof(NEW."basis_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_positions.basis_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_positions_basis_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_positions_basis_minor
  BEFORE UPDATE OF "basis_minor" ON "spv_positions"
  FOR EACH ROW WHEN NEW."basis_minor" IS NOT NULL AND typeof(NEW."basis_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_positions.basis_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_subscription ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_subscription_commitment_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_subscription_commitment_minor
  BEFORE INSERT ON "spv_subscription"
  FOR EACH ROW WHEN NEW."commitment_minor" IS NOT NULL AND typeof(NEW."commitment_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_subscription.commitment_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_subscription_commitment_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_subscription_commitment_minor
  BEFORE UPDATE OF "commitment_minor" ON "spv_subscription"
  FOR EACH ROW WHEN NEW."commitment_minor" IS NOT NULL AND typeof(NEW."commitment_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_subscription.commitment_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_subscription_wired_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_subscription_wired_minor
  BEFORE INSERT ON "spv_subscription"
  FOR EACH ROW WHEN NEW."wired_minor" IS NOT NULL AND typeof(NEW."wired_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_subscription.wired_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_subscription_wired_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_subscription_wired_minor
  BEFORE UPDATE OF "wired_minor" ON "spv_subscription"
  FOR EACH ROW WHEN NEW."wired_minor" IS NOT NULL AND typeof(NEW."wired_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_subscription.wired_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_template ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_template_cap_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_template_cap_minor
  BEFORE INSERT ON "spv_template"
  FOR EACH ROW WHEN NEW."cap_minor" IS NOT NULL AND typeof(NEW."cap_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_template.cap_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_template_cap_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_template_cap_minor
  BEFORE UPDATE OF "cap_minor" ON "spv_template"
  FOR EACH ROW WHEN NEW."cap_minor" IS NOT NULL AND typeof(NEW."cap_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_template.cap_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_template_min_check_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_template_min_check_minor
  BEFORE INSERT ON "spv_template"
  FOR EACH ROW WHEN NEW."min_check_minor" IS NOT NULL AND typeof(NEW."min_check_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_template.min_check_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_template_min_check_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_template_min_check_minor
  BEFORE UPDATE OF "min_check_minor" ON "spv_template"
  FOR EACH ROW WHEN NEW."min_check_minor" IS NOT NULL AND typeof(NEW."min_check_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_template.min_check_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_template_target_raise_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_template_target_raise_minor
  BEFORE INSERT ON "spv_template"
  FOR EACH ROW WHEN NEW."target_raise_minor" IS NOT NULL AND typeof(NEW."target_raise_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_template.target_raise_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_template_target_raise_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_template_target_raise_minor
  BEFORE UPDATE OF "target_raise_minor" ON "spv_template"
  FOR EACH ROW WHEN NEW."target_raise_minor" IS NOT NULL AND typeof(NEW."target_raise_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_template.target_raise_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spv_transfer ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spv_transfer_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_spv_transfer_amount_minor
  BEFORE INSERT ON "spv_transfer"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_transfer.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spv_transfer_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_spv_transfer_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "spv_transfer"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spv_transfer.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── spvs ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spvs_called_minor;
CREATE TRIGGER w48_money_typefloor_ins_spvs_called_minor
  BEFORE INSERT ON "spvs"
  FOR EACH ROW WHEN NEW."called_minor" IS NOT NULL AND typeof(NEW."called_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.called_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spvs_called_minor;
CREATE TRIGGER w48_money_typefloor_upd_spvs_called_minor
  BEFORE UPDATE OF "called_minor" ON "spvs"
  FOR EACH ROW WHEN NEW."called_minor" IS NOT NULL AND typeof(NEW."called_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.called_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spvs_committed_minor;
CREATE TRIGGER w48_money_typefloor_ins_spvs_committed_minor
  BEFORE INSERT ON "spvs"
  FOR EACH ROW WHEN NEW."committed_minor" IS NOT NULL AND typeof(NEW."committed_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.committed_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spvs_committed_minor;
CREATE TRIGGER w48_money_typefloor_upd_spvs_committed_minor
  BEFORE UPDATE OF "committed_minor" ON "spvs"
  FOR EACH ROW WHEN NEW."committed_minor" IS NOT NULL AND typeof(NEW."committed_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.committed_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spvs_deployment_fee_minor;
CREATE TRIGGER w48_money_typefloor_ins_spvs_deployment_fee_minor
  BEFORE INSERT ON "spvs"
  FOR EACH ROW WHEN NEW."deployment_fee_minor" IS NOT NULL AND typeof(NEW."deployment_fee_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.deployment_fee_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spvs_deployment_fee_minor;
CREATE TRIGGER w48_money_typefloor_upd_spvs_deployment_fee_minor
  BEFORE UPDATE OF "deployment_fee_minor" ON "spvs"
  FOR EACH ROW WHEN NEW."deployment_fee_minor" IS NOT NULL AND typeof(NEW."deployment_fee_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.deployment_fee_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spvs_distributed_minor;
CREATE TRIGGER w48_money_typefloor_ins_spvs_distributed_minor
  BEFORE INSERT ON "spvs"
  FOR EACH ROW WHEN NEW."distributed_minor" IS NOT NULL AND typeof(NEW."distributed_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.distributed_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spvs_distributed_minor;
CREATE TRIGGER w48_money_typefloor_upd_spvs_distributed_minor
  BEFORE UPDATE OF "distributed_minor" ON "spvs"
  FOR EACH ROW WHEN NEW."distributed_minor" IS NOT NULL AND typeof(NEW."distributed_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.distributed_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_spvs_target_minor;
CREATE TRIGGER w48_money_typefloor_ins_spvs_target_minor
  BEFORE INSERT ON "spvs"
  FOR EACH ROW WHEN NEW."target_minor" IS NOT NULL AND typeof(NEW."target_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.target_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_spvs_target_minor;
CREATE TRIGGER w48_money_typefloor_upd_spvs_target_minor
  BEFORE UPDATE OF "target_minor" ON "spvs"
  FOR EACH ROW WHEN NEW."target_minor" IS NOT NULL AND typeof(NEW."target_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: spvs.target_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── subscriptions ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_subscriptions_annual_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_subscriptions_annual_amount_minor
  BEFORE INSERT ON "subscriptions"
  FOR EACH ROW WHEN NEW."annual_amount_minor" IS NOT NULL AND typeof(NEW."annual_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: subscriptions.annual_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_subscriptions_annual_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_subscriptions_annual_amount_minor
  BEFORE UPDATE OF "annual_amount_minor" ON "subscriptions"
  FOR EACH ROW WHEN NEW."annual_amount_minor" IS NOT NULL AND typeof(NEW."annual_amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: subscriptions.annual_amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_subscriptions_past_due_minor;
CREATE TRIGGER w48_money_typefloor_ins_subscriptions_past_due_minor
  BEFORE INSERT ON "subscriptions"
  FOR EACH ROW WHEN NEW."past_due_minor" IS NOT NULL AND typeof(NEW."past_due_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: subscriptions.past_due_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_subscriptions_past_due_minor;
CREATE TRIGGER w48_money_typefloor_upd_subscriptions_past_due_minor
  BEFORE UPDATE OF "past_due_minor" ON "subscriptions"
  FOR EACH ROW WHEN NEW."past_due_minor" IS NOT NULL AND typeof(NEW."past_due_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: subscriptions.past_due_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── wave_b_backup_spv_capital_calls ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_wave_b_backup_spv_capital_calls_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_wave_b_backup_spv_capital_calls_amount_minor
  BEFORE INSERT ON "wave_b_backup_spv_capital_calls"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spv_capital_calls.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_wave_b_backup_spv_capital_calls_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_wave_b_backup_spv_capital_calls_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "wave_b_backup_spv_capital_calls"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spv_capital_calls.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── wave_b_backup_spv_commitments ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_wave_b_backup_spv_commitments_amount_minor;
CREATE TRIGGER w48_money_typefloor_ins_wave_b_backup_spv_commitments_amount_minor
  BEFORE INSERT ON "wave_b_backup_spv_commitments"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spv_commitments.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_wave_b_backup_spv_commitments_amount_minor;
CREATE TRIGGER w48_money_typefloor_upd_wave_b_backup_spv_commitments_amount_minor
  BEFORE UPDATE OF "amount_minor" ON "wave_b_backup_spv_commitments"
  FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spv_commitments.amount_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── wave_b_backup_spv_distributions ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_wave_b_backup_spv_distributions_total_minor;
CREATE TRIGGER w48_money_typefloor_ins_wave_b_backup_spv_distributions_total_minor
  BEFORE INSERT ON "wave_b_backup_spv_distributions"
  FOR EACH ROW WHEN NEW."total_minor" IS NOT NULL AND typeof(NEW."total_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spv_distributions.total_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_wave_b_backup_spv_distributions_total_minor;
CREATE TRIGGER w48_money_typefloor_upd_wave_b_backup_spv_distributions_total_minor
  BEFORE UPDATE OF "total_minor" ON "wave_b_backup_spv_distributions"
  FOR EACH ROW WHEN NEW."total_minor" IS NOT NULL AND typeof(NEW."total_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spv_distributions.total_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── wave_b_backup_spv_positions ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_wave_b_backup_spv_positions_basis_minor;
CREATE TRIGGER w48_money_typefloor_ins_wave_b_backup_spv_positions_basis_minor
  BEFORE INSERT ON "wave_b_backup_spv_positions"
  FOR EACH ROW WHEN NEW."basis_minor" IS NOT NULL AND typeof(NEW."basis_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spv_positions.basis_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_wave_b_backup_spv_positions_basis_minor;
CREATE TRIGGER w48_money_typefloor_upd_wave_b_backup_spv_positions_basis_minor
  BEFORE UPDATE OF "basis_minor" ON "wave_b_backup_spv_positions"
  FOR EACH ROW WHEN NEW."basis_minor" IS NOT NULL AND typeof(NEW."basis_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spv_positions.basis_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── wave_b_backup_spvs ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_wave_b_backup_spvs_called_minor;
CREATE TRIGGER w48_money_typefloor_ins_wave_b_backup_spvs_called_minor
  BEFORE INSERT ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."called_minor" IS NOT NULL AND typeof(NEW."called_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.called_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_wave_b_backup_spvs_called_minor;
CREATE TRIGGER w48_money_typefloor_upd_wave_b_backup_spvs_called_minor
  BEFORE UPDATE OF "called_minor" ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."called_minor" IS NOT NULL AND typeof(NEW."called_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.called_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_wave_b_backup_spvs_committed_minor;
CREATE TRIGGER w48_money_typefloor_ins_wave_b_backup_spvs_committed_minor
  BEFORE INSERT ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."committed_minor" IS NOT NULL AND typeof(NEW."committed_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.committed_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_wave_b_backup_spvs_committed_minor;
CREATE TRIGGER w48_money_typefloor_upd_wave_b_backup_spvs_committed_minor
  BEFORE UPDATE OF "committed_minor" ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."committed_minor" IS NOT NULL AND typeof(NEW."committed_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.committed_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_wave_b_backup_spvs_deployment_fee_minor;
CREATE TRIGGER w48_money_typefloor_ins_wave_b_backup_spvs_deployment_fee_minor
  BEFORE INSERT ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."deployment_fee_minor" IS NOT NULL AND typeof(NEW."deployment_fee_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.deployment_fee_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_wave_b_backup_spvs_deployment_fee_minor;
CREATE TRIGGER w48_money_typefloor_upd_wave_b_backup_spvs_deployment_fee_minor
  BEFORE UPDATE OF "deployment_fee_minor" ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."deployment_fee_minor" IS NOT NULL AND typeof(NEW."deployment_fee_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.deployment_fee_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_wave_b_backup_spvs_distributed_minor;
CREATE TRIGGER w48_money_typefloor_ins_wave_b_backup_spvs_distributed_minor
  BEFORE INSERT ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."distributed_minor" IS NOT NULL AND typeof(NEW."distributed_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.distributed_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_wave_b_backup_spvs_distributed_minor;
CREATE TRIGGER w48_money_typefloor_upd_wave_b_backup_spvs_distributed_minor
  BEFORE UPDATE OF "distributed_minor" ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."distributed_minor" IS NOT NULL AND typeof(NEW."distributed_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.distributed_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


DROP TRIGGER IF EXISTS w48_money_typefloor_ins_wave_b_backup_spvs_target_minor;
CREATE TRIGGER w48_money_typefloor_ins_wave_b_backup_spvs_target_minor
  BEFORE INSERT ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."target_minor" IS NOT NULL AND typeof(NEW."target_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.target_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_wave_b_backup_spvs_target_minor;
CREATE TRIGGER w48_money_typefloor_upd_wave_b_backup_spvs_target_minor
  BEFORE UPDATE OF "target_minor" ON "wave_b_backup_spvs"
  FOR EACH ROW WHEN NEW."target_minor" IS NOT NULL AND typeof(NEW."target_minor") <> 'integer'
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: wave_b_backup_spvs.target_minor accepts integer minor units or NULL; a non-numeric value is refused'); END;


-- ── your_decision_records ──────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS w48_money_typefloor_ins_your_decision_records_amount;
CREATE TRIGGER w48_money_typefloor_ins_your_decision_records_amount
  BEFORE INSERT ON "your_decision_records"
  FOR EACH ROW WHEN NEW."amount" IS NOT NULL AND typeof(NEW."amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: your_decision_records.amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;

DROP TRIGGER IF EXISTS w48_money_typefloor_upd_your_decision_records_amount;
CREATE TRIGGER w48_money_typefloor_upd_your_decision_records_amount
  BEFORE UPDATE OF "amount" ON "your_decision_records"
  FOR EACH ROW WHEN NEW."amount" IS NOT NULL AND typeof(NEW."amount") NOT IN ('integer','real')
  BEGIN SELECT RAISE(ABORT, 'WAVE48/0186 money type floor: your_decision_records.amount accepts legacy REAL major units (text/blob refused) or NULL; a non-numeric value is refused'); END;


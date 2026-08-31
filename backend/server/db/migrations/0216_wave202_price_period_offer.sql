-- ═══════════════════════════════════════════════════════════════════════════════
-- WAVE 202 · ITEM A · R178.1 — THE BILLING PERIOD BECOMES THE OWNER'S CHOICE,
--                              PER PRICE, INSTEAD OF ONE PLATFORM-WIDE RULE.
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THE OWNER ASKED FOR, VERBATIM
--   "the admin area pricing section should allow me to choose between annual
--    and/or monthly pricing. Whatever I choose should be dynamically displayed in
--    the frontend."
--
-- WHAT HE HAD RULED BEFORE, AND WHY THAT IS NOT A CONTRADICTION
--   "The platform is annual and/or fixed only. Therefore there really should not
--    be a displayed as monthly."
--   Wave 199 implemented that as a PLATFORM-WIDE suppression driven by the
--   partner_pricing_model_config singleton (monthly_purchasable = 0). He never
--   asked for monthly to be forced ON; he asked not to have it forced on him. What
--   he is asking for now is CONTROL: annual, monthly, or both, chosen BY HIM, per
--   price. A single global switch cannot express "annual for Capavate Annual,
--   monthly for the Collective membership".
--
-- WHY A NEW TABLE AND NOT A COLUMN ON partner_pricing_model_config
--   That singleton is read by partnerTiers.ts, subscriptionTierStore.ts and
--   partnerSelfServiceRoutes.ts, and its monthly_purchasable / annual_purchasable
--   columns DECIDE WHAT MAY BE PURCHASED. This table decides only what may be
--   DISPLAYED, and it is keyed per price rather than being a singleton. Putting a
--   per-price display preference into a singleton whose other columns gate
--   checkout would force a future reader to work out which columns affect money —
--   the same separation wave 188 made for the same reason.
--
-- ── ZERO ROWS. THIS IS THE SAFETY PROPERTY, NOT AN OMISSION ──────────────────
--   This migration inserts NOTHING. An empty table means every price scope
--   resolves to the wave-199 platform-wide answer, which today is
--   monthly_purchasable = 0, i.e. monthly is not displayed. So on the day this
--   lands, EVERY SCREEN BEHAVES EXACTLY AS WAVE 199 LEFT IT. Monthly cannot
--   re-appear anywhere until the owner deliberately writes a row through the
--   admin-only, actor-attributed writer. There is no code path, and now no data
--   path, in which "no decision recorded" means "show monthly".
--
--   Seeding rows would have been the mistake. A seeded row is a decision made in a
--   migration on the owner's behalf, and R156.2 forbids compiling in a pricing
--   decision. Absence of a row is the honest representation of "he has not chosen
--   yet".
--
-- ── ×12 IS UNREPRESENTABLE, NOT MERELY FORBIDDEN ─────────────────────────────
--   partner_pricing_model_config.forbid_x12_derivation = 1 forbids turning a
--   monthly figure into an annual one by multiplication, and partner_tier_price's
--   derivation column can hold 'derived_x12' even though no row in this database
--   does. This table's annual_derivation CHECK admits ONLY 'unset' and
--   'admin_set'. A derived annual figure therefore cannot be STORED here at all.
--   A schema constraint outlives a code comment.
--
-- ── THE COLLECTIVE MEMBERSHIP: THE CONTROL, WITH THE VALUE LEFT UNSET ────────
--   collective.member_subscription.standard is on record as 24900 USD MONTHLY and
--   there is no annual row for it in platform_fees, partner_tier_price,
--   founder_tiers or the pricing-model store. The owner asked for a screen where
--   he can set one. annual_amount_minor is NULLABLE WITH NO DEFAULT, and NULL
--   means UNSET — not zero. R143.4: "Capavate will not show a zero total for a
--   figure it does not hold." The reader is required to report absence in words
--   and is forbidden from substituting 0 or a multiplied monthly figure.
--
-- ── THIS TABLE HOLDS NO MONTHLY AMOUNT, DELIBERATELY ─────────────────────────
--   Every amount the platform charges stays in its existing home (platform_fees,
--   partner_tier_price, founder_tiers, kv_pricingModelStore). A second authority
--   for the same amount is how two screens come to disagree. The ONE amount column
--   here is an annual gap-filler for a scope whose canonical store holds no annual
--   row at all, provenance-tagged so its origin is visible on the screen — the
--   same gap-fill-with-provenance shape already ratified under R176.3.
--
-- ── NO FOREIGN KEY, DELIBERATELY ─────────────────────────────────────────────
--   scope_key spans four different stores (a platform_fees key, a
--   partner_tier_price slug, a pricing-model id), so there is no single parent
--   table to reference. More importantly, an FK would let the DATABASE choose the
--   failure mode for an unknown scope. That decision belongs in the store, which
--   answers with the platform-wide default and names the condition, rather than in
--   an opaque constraint failure on a pricing screen.
--
-- ── NOTHING ELSE IS READ OR WRITTEN ──────────────────────────────────────────
--   There is no UPDATE, no DELETE, no ALTER and no INSERT against any existing
--   table in this file. No fee, tier, price, subscription or invoice is touched.
--
-- ── NOT A CHARGE PATH ────────────────────────────────────────────────────────
--   No charge path reads this table. resolveChargeTier(), assertTierPurchasable(),
--   partnerBillingStore.ts and every subscription path are unchanged and continue
--   to consult monthly_purchasable / annual_purchasable. R159.3's display-is-not-
--   charge fence is intact.
--
-- RULING: R178.1 (this wave), R173.6 (the display follows the admin), R156.1 /
--         R156.2 (no conversion, nothing hardcoded), R143.4 (no invented zero),
--         R176.1 (absence never compared as a value), R159.3 (display ≠ charge),
--         R3 (the database is the only source of a price).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS price_period_offer (
  -- One row per PRICE, not per platform. The key is namespaced by the store that
  -- owns the price, e.g. 'platform_fee:collective.member_subscription.standard'.
  -- Namespacing is what lets one table serve platform_fees keys, partner tier
  -- slugs and pricing-model ids without them colliding.
  scope_key            TEXT    PRIMARY KEY,

  -- The owner's choice for THIS price. Both may be 1 ("annual and/or monthly" —
  -- his words), and both may be 0, which means he has chosen to show no period at
  -- all beside this figure. A row is only ever written by an admin.
  annual_offered       INTEGER NOT NULL DEFAULT 0 CHECK (annual_offered  IN (0, 1)),
  monthly_offered      INTEGER NOT NULL DEFAULT 0 CHECK (monthly_offered IN (0, 1)),

  -- An annual amount for a scope whose canonical store holds NO annual row.
  -- NULL = UNSET, and unset is a state the screen must report in words. NOT a
  -- second home for an amount that already exists elsewhere.
  annual_amount_minor  INTEGER          CHECK (annual_amount_minor IS NULL OR annual_amount_minor >= 0),

  -- The ISO code the amount above is denominated in. Never defaulted (R156.2) and
  -- never converted (R156.1). NULL whenever annual_amount_minor is NULL.
  annual_currency      TEXT,

  -- 'unset'      — no annual amount recorded here.
  -- 'admin_set'  — a named administrator typed this figure.
  -- There is deliberately NO 'derived_x12'. See the note above.
  annual_derivation    TEXT    NOT NULL DEFAULT 'unset' CHECK (annual_derivation IN ('unset', 'admin_set')),

  updated_at           TEXT    NOT NULL,
  updated_by           TEXT    NOT NULL,

  -- Free text an admin route may leave for the next reader.
  notes                TEXT,

  -- An amount without a currency is not a price, and a currency without an amount
  -- is noise. They travel together or not at all.
  CHECK (
    (annual_amount_minor IS NULL     AND annual_currency IS NULL     AND annual_derivation = 'unset')
    OR
    (annual_amount_minor IS NOT NULL AND annual_currency IS NOT NULL AND annual_derivation = 'admin_set')
  )
);

-- Reading "every scope the owner has decided" is the admin screen's main query.
CREATE INDEX IF NOT EXISTS idx_price_period_offer_updated_at
  ON price_period_offer (updated_at);

-- NO INSERT. See "ZERO ROWS" above. This migration is a behavioural no-op until
-- the owner makes a choice.

-- ═══════════════════════════════════════════════════════════════════════════════
-- WAVE 188 · ITEM A · R159.3 — THE FEE-ADMIN DISPLAY POLICY.
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT THE OWNER ASKED FOR, VERBATIM
--   "How can I mute 'tiers' so that I only have one tier for all consortium
--    partners?"
--
-- WHY A NEW TABLE AND NOT A DELETION
--   The owner's standing rule is "I'd rather add than delete", and R159.3 says no
--   functionality may be removed. There are five tiers in partner_tier_lifecycle
--   and five in PARTNER_TIERS, and 31 rows in partner_tier_price keyed by slug.
--   Deleting or archiving tiers to satisfy "only one tier" would destroy the
--   capability the owner explicitly wants preserved, and — far worse — archiving
--   a tier changes what resolveConsortiumPricing() advertises, which is a
--   CHARGED-SURFACE change. R159.3 forbids altering any charged figure.
--
--   So this migration adds a table that NO CHARGE PATH READS. It records which
--   tier the ADMIN SCREEN should present as the only one, and nothing else. Every
--   tier row, every tier price, every capability grant and every line of tier code
--   survives untouched; the machinery is muted on one surface, never removed.
--
-- WHY IT IS NOT A COLUMN ON partner_pricing_model_config
--   That singleton is read by partnerTiers.ts, subscriptionTierStore.ts and
--   partnerSelfServiceRoutes.ts, and its flags DECIDE WHAT MAY BE PURCHASED. A
--   display preference does not belong in a table whose other columns gate
--   checkout: a future reader glancing at that row must not have to work out
--   which of its columns affect money. Separate concerns, separate tables.
--
-- ── NO DEFAULT TIER NAME. THIS IS THE POINT, NOT AN OMISSION ─────────────────
--   canonical_tier_slug is NULLABLE WITH NO DEFAULT. R156.2 forbids hardcoding a
--   fee or pricing value anywhere, and a compiled-in canonical tier name is
--   exactly that: it would decide, in code, which tier's price the owner sees.
--   The seeded row therefore has single_tier_mode = 0 and canonical_tier_slug
--   NULL, which is the honest state: NO POLICY HAS BEEN SET.
--
--   The reader (server/lib/partnerFeeAdminDisplayPolicy.ts) is required to REFUSE
--   and NAME THE MISSING FACT when single_tier_mode = 1 and canonical_tier_slug
--   is NULL or does not resolve to a live partner_tier_lifecycle row. It must
--   never substitute a tier. A screen that quietly picked "catalyst" because it
--   happened to be the only priced tier would be the R158.1 mistake again in a
--   new place: a figure whose origin the owner cannot see.
--
-- ── REVERSIBLE FROM THE UI, WHICH IS WHY THE FLAG IS A COLUMN ────────────────
--   R159.3 requires the mute be reversible from the UI. It is one UPDATE of
--   single_tier_mode back to 0, issued by PUT /api/admin/fee-admin-display-policy.
--   The chosen slug is deliberately KEPT when the mode is switched off, so that
--   turning it back on does not ask the owner to re-answer a question they have
--   already answered.
--
-- ── ZERO ROWS OF ANY OTHER TABLE ARE TOUCHED ─────────────────────────────────
--   There is no UPDATE, no DELETE and no ALTER in this file against any existing
--   table. It creates one table and inserts one row into it. No tier, no price,
--   no fee schedule, no subscription and no invoice is read or written.
--
-- ── NO FOREIGN KEY TO partner_tier_lifecycle, DELIBERATELY ──────────────────
--   An FK would make the policy row undeletable-by-proxy and, more importantly,
--   would let the DATABASE decide the failure mode for an unresolvable slug. That
--   decision belongs in one readable place: the store, which refuses in words the
--   owner can act on ("single-tier mode is on but no tier has been chosen"), not
--   in an opaque constraint failure. Referential validity is checked on read
--   against listTiers(), which is also the exact set the dropdown offers, so the
--   check and the picker can never disagree.
--
-- ── THE SINGLETON SHAPE ──────────────────────────────────────────────────────
--   id TEXT PRIMARY KEY CHECK (id = 'singleton') is the same shape
--   partner_pricing_model_config uses, so there is one and only one policy and a
--   second cannot be inserted by accident.
--
-- RULING: R159.3 (this wave), R156.2 (nothing hardcoded), R158.1 (a value whose
--         origin cannot be read is not configured), R3 (the database is the only
--         source of a price).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS partner_tier_admin_display_policy (
  -- Exactly one row, ever.
  id                  TEXT    PRIMARY KEY CHECK (id = 'singleton'),

  -- 0 = every tier is offered in the admin pickers (the shipped state).
  -- 1 = the admin pickers present canonical_tier_slug as the only tier.
  --     NOTHING about what is CHARGED changes at either setting.
  single_tier_mode    INTEGER NOT NULL DEFAULT 0 CHECK (single_tier_mode IN (0, 1)),

  -- The tier the admin surface treats as the only one. NULL = not chosen.
  -- NO DEFAULT: see the note above. A NULL here with single_tier_mode = 1 is a
  -- REFUSAL condition, never a licence to pick one.
  canonical_tier_slug TEXT,

  updated_at          TEXT    NOT NULL,
  updated_by          TEXT    NOT NULL,

  -- Free text the owner or an admin route may leave for the next reader.
  notes               TEXT
);

-- The honest starting state: no policy set, so every tier is offered exactly as
-- it is today. This row's existence is what lets the admin screen READ a policy
-- without a create-on-first-write dance, and its values are what make this
-- migration a no-op for every current behaviour.
INSERT OR IGNORE INTO partner_tier_admin_display_policy
  (id, single_tier_mode, canonical_tier_slug, updated_at, updated_by, notes)
VALUES
  ('singleton', 0, NULL, '2026-08-28T00:00:00.000Z', 'migration_0215',
   'No single-tier display policy set. Every tier is offered in the admin pickers. Turning single-tier mode on requires choosing a tier from the live tier list; the platform will refuse rather than pick one. This setting affects the ADMIN SCREEN ONLY and changes no charged amount.');

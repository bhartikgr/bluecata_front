-- 0177_wave30_spv_template.sql
-- WAVE 30 · ENGINE 3 — `spv_template`
--
-- WHY THIS EXISTS
-- ---------------
-- A sponsoring partner that runs the same deal structure repeatedly (same
-- jurisdiction, same carry basis, same minimum check, same LP visibility) has
-- had to re-enter every one of those fields into the SPV wizard on every
-- launch. `docs/WAVE_D_LINE_DELTA_AUDIT.md:121` tracked `spv_template` as an
-- expected surface with "zero hits anywhere" — this migration is the first
-- half of closing that, and Wave 30's store/routes/UI are the second.
--
-- WHAT A TEMPLATE IS, AND DELIBERATELY IS NOT
-- -------------------------------------------
-- A template is a saved set of DEFAULTS for the SPV create form. It is NOT an
-- SPV, and applying one does NOT create an SPV.
--
-- That boundary is load-bearing for authorization, not merely tidy. SPV
-- creation is gated by the Wave 1c launch sign-off: the route records a
-- durable, attested signature (signer legal name + versioned attestation, from
-- the SESSION identity) BEFORE any SPV row exists, and fails closed if that
-- record cannot be persisted. If "apply template" minted an SPV directly it
-- would route straight around that gate. So apply returns a PREFILL PAYLOAD;
-- the operator still passes through the ordinary signed create path.
--
-- MONEY
-- -----
-- `min_check_minor`, `target_raise_minor` and `cap_minor` are INTEGER MINOR
-- UNITS, and `currency` is stored ALONGSIDE them and is NOT NULL. A minor-unit
-- integer is meaningless without its currency: 5000 is $50.00 in USD and ¥5,000
-- in JPY, which is a zero-decimal currency. Nothing here may be summed across
-- templates of differing currency, and the read model does not offer a total.
--
-- Absent amounts are NULL, never 0. "No minimum check" and "a minimum check of
-- zero" are different statements about a deal and the UI renders them
-- differently — a NULL renders as an explicit "Not set", never as a currency
-- amount.
--
-- CARRY
-- -----
-- `carry_fraction_scaled` is an INTEGER, being the carry FRACTION multiplied by
-- `CARRY_FRACTION_SCALE` (1e9, `server/lib/money.ts:324`). 20% carry is stored
-- as 200000000. It is NOT a percent-as-written number and NOT a float.
--
-- This is the single most important choice in the table. Wave 5 / P-4 records
-- what the alternative costs: the SPV wizard's "Hurdle %" field posted the
-- number 8 for an 8% hurdle, the store read it as a fraction, `Math.min(1, n)`
-- clamped it, and the SPV silently acquired a 100% preferred return. The
-- ambiguity is in the representation, so the representation is what changes
-- here: an integer count of billionths cannot be misread as a percent. A
-- CHECK constraint additionally refuses anything outside [0, 1e9] at the
-- database, so an out-of-domain value cannot be persisted even by a caller
-- that bypasses the store.
--
-- IDEMPOTENT. Safe to re-run.

CREATE TABLE IF NOT EXISTS spv_template (
  id                    TEXT PRIMARY KEY NOT NULL,
  tenant_id             TEXT NOT NULL,
  partner_id            TEXT NOT NULL,

  name                  TEXT NOT NULL,
  description           TEXT,

  -- Structure defaults. Validated by the store against the SAME shared
  -- predicates the SPV create path uses (`shared/spvEngine.ts`), so a template
  -- that would be rejected at apply time cannot be saved in the first place.
  spv_type              TEXT NOT NULL DEFAULT 'spv',
  jurisdiction          TEXT NOT NULL,
  carry_basis           TEXT NOT NULL,
  distribution_scope    TEXT,
  lp_visibility         TEXT,

  -- Money: integer minor units, NULL when unset (never 0-as-unset).
  currency              TEXT NOT NULL DEFAULT 'USD',
  min_check_minor       INTEGER,
  target_raise_minor    INTEGER,
  cap_minor             INTEGER,

  -- Carry as an integer count of billionths of 1. See the header note.
  carry_fraction_scaled INTEGER,

  is_archived           INTEGER NOT NULL DEFAULT 0,
  usage_count           INTEGER NOT NULL DEFAULT 0,
  last_applied_at       TEXT,

  created_at            TEXT NOT NULL,
  created_by            TEXT,
  updated_at            TEXT NOT NULL,
  deleted_at            TEXT,

  -- Amounts are either absent or non-negative. A negative minimum check is not
  -- a business case, it is a corrupted write.
  CHECK (min_check_minor    IS NULL OR min_check_minor    >= 0),
  CHECK (target_raise_minor IS NULL OR target_raise_minor >= 0),
  CHECK (cap_minor          IS NULL OR cap_minor          >= 0),

  -- Carry is a FRACTION scaled by 1e9. Anything above 1e9 would be a carry
  -- above 100%, which is the exact Wave 5 / P-4 defect class, refused here.
  CHECK (
    carry_fraction_scaled IS NULL
    OR (carry_fraction_scaled >= 0 AND carry_fraction_scaled <= 1000000000)
  ),

  CHECK (is_archived IN (0, 1))
);

-- One live template name per partner. Re-using a name would make the picker in
-- the create wizard ambiguous at exactly the moment the operator is committing
-- capital terms. Partial index so that soft-deleted templates do not hold a
-- name hostage forever.
CREATE UNIQUE INDEX IF NOT EXISTS ux_spv_template_partner_name
  ON spv_template (partner_id, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_spv_template_partner
  ON spv_template (partner_id, is_archived, updated_at);

CREATE INDEX IF NOT EXISTS idx_spv_template_tenant
  ON spv_template (tenant_id);

-- Append-only application log. `usage_count` on the parent is a denormalised
-- convenience for the list view; THIS is the record of truth, and the two are
-- reconcilable. A count with no underlying rows cannot be audited, and "which
-- template did we launch that vehicle from?" is a question a partner will be
-- asked by an LP.
CREATE TABLE IF NOT EXISTS spv_template_application (
  id            TEXT PRIMARY KEY NOT NULL,
  tenant_id     TEXT NOT NULL,
  template_id   TEXT NOT NULL,
  partner_id    TEXT NOT NULL,
  applied_by    TEXT,
  -- NULL until (and unless) the prefilled draft is actually launched. Applying
  -- a template does not create an SPV, so this is legitimately empty for any
  -- application the operator abandoned — and that gap is itself information.
  resulting_spv_id TEXT,
  applied_at    TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES spv_template (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spv_template_application_template
  ON spv_template_application (template_id, applied_at);

CREATE INDEX IF NOT EXISTS idx_spv_template_application_partner
  ON spv_template_application (partner_id, applied_at);

// server/lib/partnerFeeAdminDisplayPolicy.ts
//
// WAVE 188 · ITEM A · R159.3 — "one tier for all consortium partners", muted and
// never deleted.
//
// THE OWNER'S WORDS
//   "How can I mute 'tiers' so that I only have one tier for all consortium
//    partners?"
//
// WHAT THIS FILE IS, IN ONE SENTENCE
//   A DISPLAY policy for the admin fee screen: which tier the admin pickers should
//   present as the only one. It is read by the admin surface and by nothing else.
//
// WHAT THIS FILE IS NOT, AND WHY THAT MATTERS MORE THAN WHAT IT IS
//   It is NOT a charge policy. R159.3 forbids altering any charged figure, and the
//   fastest way to break that would be a "single tier" switch that actually
//   repointed billing. So this module deliberately has NO relationship with any of
//   resolveChargeTier(), requireChargeTier(), assertTierPurchasable(),
//   resolveConsortiumPricing(), resolveHistoricalTier(), partner_tier_price,
//   partner_fee_schedules, partnerEffectivePlan.ts or partnerBillingStore.ts. It
//   reads one row of one table that no charge path opens. Turning single-tier mode
//   on and off cannot move a single cent, and the adversarial test for this wave
//   proves that by resolving every fee for every tier with the mode on and off and
//   asserting the two result sets are identical.
//
//   It also does NOT filter PartnerTierLifecycleAdmin. The tier machinery must stay
//   reachable while the mode is on, or "mute" would have become "hide the way
//   back" — and an owner who cannot see the way back will not touch the switch.
//
// NO HARDCODED TIER NAME (R156.2)
//   There is no default canonical tier anywhere in this file. If single-tier mode
//   is on and no tier has been chosen — or the chosen slug is not a live
//   partner_tier_lifecycle row — this module REFUSES and NAMES THE MISSING FACT.
//   It never substitutes a tier, not even when exactly one tier happens to be
//   priced. Silently choosing the only priced tier would recreate the R158.1
//   defect this wave exists to correct: a figure whose origin the owner cannot see.
//
// VALIDATED AGAINST THE SAME LIST THE PICKER OFFERS
//   The chosen slug is checked against listTiers() — the exact set behind
//   GET /api/admin/partner-tiers, which is the dropdown's source. Validation and
//   the picker therefore cannot disagree. This is also why migration 0215 has no
//   foreign key: the failure mode belongs here, in words, not in an opaque
//   constraint error.
//
// SCHEMA AVAILABILITY
//   Numbered migrations do not auto-run, and NODE_ENV=test opens a fresh
//   :memory: database built from DDL inlined in the SACRED server/db/connection.ts,
//   which predates this table. Without an installer every test here would either
//   fail outright or PASS VACUOUSLY against a table that does not exist. The DDL is
//   NOT re-typed: it is READ FROM migration 0215 itself, the same
//   parity-by-construction the Wave 45 and Wave 56 installers use, so installer and
//   migration cannot drift.
//
// RULING: R159.3, R156.2, R158.1, R3.

import fs from "node:fs";
import path from "node:path";
import { wave45Db } from "./applyWave45PricingSchema";
import { listTiers } from "./partnerTierLifecycleStore";

const MIGRATION_BASENAME = "0215_wave188_fee_admin_display_policy.sql";

export const POLICY_TABLE = "partner_tier_admin_display_policy";
export const POLICY_ID = "singleton";

/** Both trees hold a byte-identical copy; either will do. */
function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, "server", "db", "migrations", MIGRATION_BASENAME),
    path.join(cwd, "migrations", MIGRATION_BASENAME),
  ];
}

function readMigrationSql(): string {
  for (const p of candidatePaths()) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    `WAVE188_MIGRATION_MISSING: cannot find ${MIGRATION_BASENAME} in server/db/migrations/ or migrations/. ` +
      `The fee-admin display policy schema is defined only there and is never re-typed in code.`,
  );
}

/**
 * Idempotent by INSPECTION of sqlite_master, not by a module-level boolean. A memo
 * would answer "already done" for a second in-memory database that has none of it —
 * which is precisely the "check that passed while checking nothing" shape this
 * build's history is full of.
 */
export function ensureFeeAdminDisplayPolicySchema(): void {
  // wave45Db() installs the Wave 45 pricing schema itself before returning, so the
  // tables this policy sits beside are guaranteed present.
  const db = wave45Db();
  const present = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(POLICY_TABLE) as { name: string } | undefined;
  if (present) return;
  // Executed as ONE script, never split on ';'.
  db.exec(readMigrationSql());
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  READ
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface TierChoice {
  slug: string;
  /** The human label from partner_tier_lifecycle.display_name. */
  label: string;
  /**
   * True when the tier has no human-readable name on record. The caller then
   * shows the slug plus a STATED fallback — never a blank, never an invented
   * name (R159.3 Item B req 1).
   */
  labelIsFallback: boolean;
  state: string;
}

export interface FeeAdminDisplayPolicy {
  singleTierMode: boolean;
  /** Exactly as stored. NULL/absent means NOT CHOSEN, never "pick one for me". */
  canonicalTierSlug: string | null;
  /** The resolved human label, or null when unresolved. */
  canonicalTierLabel: string | null;
  /**
   * Set when the policy CANNOT be honoured, naming the missing fact in words an
   * owner can act on. Non-null means the caller must offer every tier and show
   * this sentence — never quietly substitute a tier.
   */
  refusal: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  notes: string | null;
  /** Every live tier, in rank order. The dropdown's contents. */
  tiers: TierChoice[];
  /**
   * The tiers the admin pickers should offer given the policy. Equal to `tiers`
   * unless single-tier mode is on AND resolvable.
   */
  offeredTiers: TierChoice[];
}

function tierChoices(): TierChoice[] {
  let rows: ReturnType<typeof listTiers> = [];
  try {
    rows = listTiers();
  } catch {
    // A missing lifecycle table must not become an invented tier list.
    return [];
  }
  return rows.map((t) => {
    const label = typeof t.label === "string" ? t.label.trim() : "";
    return {
      slug: t.slug,
      label: label.length > 0 ? label : t.slug,
      labelIsFallback: label.length === 0,
      state: String(t.state),
    };
  });
}

export function readFeeAdminDisplayPolicy(): FeeAdminDisplayPolicy {
  ensureFeeAdminDisplayPolicySchema();
  const db = wave45Db();
  const row = db
    .prepare(
      `SELECT single_tier_mode, canonical_tier_slug, updated_at, updated_by, notes
         FROM ${POLICY_TABLE} WHERE id = ?`,
    )
    .get(POLICY_ID) as
    | {
        single_tier_mode: number;
        canonical_tier_slug: string | null;
        updated_at: string | null;
        updated_by: string | null;
        notes: string | null;
      }
    | undefined;

  const tiers = tierChoices();

  // No row is the honest "no policy set", which is the shipped behaviour: every
  // tier offered. It is NOT an excuse to invent a canonical tier.
  const singleTierMode = row ? row.single_tier_mode === 1 : false;
  const canonicalTierSlug = row?.canonical_tier_slug ?? null;

  let refusal: string | null = null;
  let canonicalTierLabel: string | null = null;
  let offeredTiers = tiers;

  if (singleTierMode) {
    if (!canonicalTierSlug) {
      refusal =
        "Single-tier mode is turned on, but no tier has been chosen yet. " +
        "Pick the tier that should apply to all consortium partners from the tier list, then save. " +
        "Until then every tier is being offered, exactly as before.";
    } else {
      const match = tiers.find((t) => t.slug === canonicalTierSlug);
      if (!match) {
        refusal =
          `Single-tier mode is turned on and set to "${canonicalTierSlug}", but there is no tier on record with that name. ` +
          "Choose a tier from the list, then save. Until then every tier is being offered, exactly as before.";
      } else {
        canonicalTierLabel = match.label;
        offeredTiers = [match];
      }
    }
  }

  return {
    singleTierMode,
    canonicalTierSlug,
    canonicalTierLabel,
    refusal,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
    notes: row?.notes ?? null,
    tiers,
    offeredTiers,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WRITE
 * ═══════════════════════════════════════════════════════════════════════════ */

export class FeeAdminDisplayPolicyRefusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FeeAdminDisplayPolicyRefusal";
    this.code = code;
  }
}

export interface WriteFeeAdminDisplayPolicyArgs {
  singleTierMode: boolean;
  /**
   * The tier to treat as the only one. Required when turning the mode ON.
   * `undefined` when the mode is off KEEPS whatever was chosen before, so that
   * turning the mode back on does not ask the owner to re-answer a question they
   * have already answered.
   */
  canonicalTierSlug?: string | null;
  actor: string;
  notes?: string | null;
}

export function writeFeeAdminDisplayPolicy(
  args: WriteFeeAdminDisplayPolicyArgs,
): FeeAdminDisplayPolicy {
  ensureFeeAdminDisplayPolicySchema();

  const actor = typeof args.actor === "string" ? args.actor.trim() : "";
  if (!actor) {
    throw new FeeAdminDisplayPolicyRefusal(
      "ACTOR_REQUIRED",
      "Refusing to record a display-policy change with no identified admin. Every change to this setting is attributed.",
    );
  }

  const tiers = tierChoices();
  const existing = readFeeAdminDisplayPolicy();

  // `undefined` = leave as-is; `null` = explicitly clear the choice.
  const requested =
    args.canonicalTierSlug === undefined
      ? existing.canonicalTierSlug
      : args.canonicalTierSlug === null
        ? null
        : String(args.canonicalTierSlug).trim() || null;

  // Turning the mode ON with nothing to point at is REFUSED and the missing fact
  // is named. It is never resolved by choosing a tier on the owner's behalf.
  if (args.singleTierMode) {
    if (!requested) {
      throw new FeeAdminDisplayPolicyRefusal(
        "CANONICAL_TIER_NOT_CHOSEN",
        "Cannot turn on single-tier mode without choosing which tier applies to all consortium partners. " +
          "The platform will not pick one for you, because you would then be looking at a price whose origin you cannot see.",
      );
    }
    if (tiers.length === 0) {
      throw new FeeAdminDisplayPolicyRefusal(
        "NO_TIERS_ON_RECORD",
        "Cannot turn on single-tier mode because there are no tiers on record to choose from.",
      );
    }
    if (!tiers.some((t) => t.slug === requested)) {
      throw new FeeAdminDisplayPolicyRefusal(
        "CANONICAL_TIER_UNKNOWN",
        `Cannot set single-tier mode to "${requested}" because there is no tier on record with that name. ` +
          `The tiers on record are: ${tiers.map((t) => t.slug).join(", ")}.`,
      );
    }
  } else if (requested && !tiers.some((t) => t.slug === requested)) {
    // Mode off: an unknown remembered slug is cleared rather than stored, so the
    // owner is never shown a stale name they cannot act on.
    throw new FeeAdminDisplayPolicyRefusal(
      "CANONICAL_TIER_UNKNOWN",
      `There is no tier on record named "${requested}".`,
    );
  }

  const db = wave45Db();
  db.prepare(
    `INSERT INTO ${POLICY_TABLE}
       (id, single_tier_mode, canonical_tier_slug, updated_at, updated_by, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       single_tier_mode    = excluded.single_tier_mode,
       canonical_tier_slug = excluded.canonical_tier_slug,
       updated_at          = excluded.updated_at,
       updated_by          = excluded.updated_by,
       notes               = excluded.notes`,
  ).run(
    POLICY_ID,
    args.singleTierMode ? 1 : 0,
    requested,
    new Date().toISOString(),
    actor,
    args.notes ?? existing.notes ?? null,
  );

  return readFeeAdminDisplayPolicy();
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  ITEM C — WHICH BILLING PERIOD IS OFFERED
 * ═══════════════════════════════════════════════════════════════════════════ *
 *  THE OWNER'S WORDS
 *    "Remember, I don't want to have 'monthly' at this point (although it should
 *     be an option on the platform). I want annual fees."
 *
 *  The mechanism ALREADY EXISTS in the database: partner_pricing_model_config
 *  holds monthly_purchasable / annual_purchasable, and the shipped row is already
 *  monthly=0, annual=1 — exactly what the owner asked for. What did not exist
 *  anywhere in the tree is a WRITER, or any surface that shows the setting. The
 *  owner therefore could not see that annual-only was already true, which is why
 *  the pricing section reads as "sometimes confusing to navigate".
 *
 *  So this wave adds READ + WRITE for the existing flags and changes no default.
 *  Monthly is not deleted, not un-implemented and not un-priceable: it is
 *  "supported, not currently offered", and one switch re-opens it.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface BillingPeriodOffer {
  annualOffered: boolean;
  monthlyOffered: boolean;
  /** 'flat_annual' | 'tiered', straight from the row. */
  model: string;
  forbidX12Derivation: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  notes: string | null;
}

export function readBillingPeriodOffer(): BillingPeriodOffer {
  const db = wave45Db();
  const row = db
    .prepare(
      `SELECT model, monthly_purchasable, annual_purchasable, forbid_x12_derivation,
              updated_at, updated_by, notes
         FROM partner_pricing_model_config WHERE id = 'singleton'`,
    )
    .get() as
    | {
        model: string;
        monthly_purchasable: number;
        annual_purchasable: number;
        forbid_x12_derivation: number;
        updated_at: string | null;
        updated_by: string | null;
        notes: string | null;
      }
    | undefined;

  // Absent config reports the R3 shipped state — the SAME fail-closed answer
  // partnerTiers.readPricingModelConfig() gives, so the screen and the resolver
  // can never disagree about what is being sold.
  if (!row) {
    return {
      annualOffered: true,
      monthlyOffered: false,
      model: "flat_annual",
      forbidX12Derivation: true,
      updatedAt: null,
      updatedBy: null,
      notes: null,
    };
  }
  return {
    annualOffered: row.annual_purchasable === 1,
    monthlyOffered: row.monthly_purchasable === 1,
    model: row.model === "tiered" ? "tiered" : "flat_annual",
    forbidX12Derivation: row.forbid_x12_derivation === 1,
    updatedAt: row.updated_at ?? null,
    updatedBy: row.updated_by ?? null,
    notes: row.notes ?? null,
  };
}

export function writeBillingPeriodOffer(args: {
  annualOffered: boolean;
  monthlyOffered: boolean;
  actor: string;
}): BillingPeriodOffer {
  const actor = typeof args.actor === "string" ? args.actor.trim() : "";
  if (!actor) {
    throw new FeeAdminDisplayPolicyRefusal(
      "ACTOR_REQUIRED",
      "Refusing to record a billing-period change with no identified admin. Every change to what the platform sells is attributed.",
    );
  }

  // Both periods off would leave NOTHING purchasable: partnerSelfServiceRoutes.ts
  // refuses every subscription when no cadence is purchasable, so this state would
  // silently close checkout. Refused, with the reason named. This is a NEW
  // refusal, not a removed capability — neither period is being taken away.
  if (!args.annualOffered && !args.monthlyOffered) {
    throw new FeeAdminDisplayPolicyRefusal(
      "NO_PERIOD_OFFERED",
      "Refusing to turn off both annual and monthly. That would leave partners with nothing they could buy, " +
        "and every new subscription would be declined. Keep at least one period switched on.",
    );
  }

  const db = wave45Db();
  const before = readBillingPeriodOffer();
  db.prepare(
    `UPDATE partner_pricing_model_config
        SET monthly_purchasable = ?, annual_purchasable = ?, updated_at = ?, updated_by = ?
      WHERE id = 'singleton'`,
  ).run(
    args.monthlyOffered ? 1 : 0,
    args.annualOffered ? 1 : 0,
    new Date().toISOString(),
    actor,
  );

  const after = readBillingPeriodOffer();
  // The model column is NOT written here. Switching which period is OFFERED is a
  // different decision from switching the pricing MODEL between flat and tiered,
  // and conflating them in one write is how a screen changes something the
  // operator did not ask it to.
  if (after.model !== before.model) {
    throw new FeeAdminDisplayPolicyRefusal(
      "MODEL_UNEXPECTEDLY_CHANGED",
      "The pricing model changed during a billing-period update. Refusing to report success.",
    );
  }
  return after;
}

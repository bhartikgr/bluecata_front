/**
 * server/lib/pricingDisplaySourceRepoint.ts
 *
 * WAVE 131 — ONE AUTHORITATIVE SOURCE PER PRICE (R95), REPOINTED WITHOUT
 * SILENTLY REPRICING A LIVE CUSTOMER (R96 requirement 5).
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 *
 * `server/lib/wave15FeeScheduleAggregate.ts` resolves the partner's DISPLAYED
 * fee schedule for three fee kinds through `resolvePartnerFee(...)`, i.e.
 * through `partner_fee_schedules` — a table whose migration seeds are every one
 * `amount_minor = 0` (migrations/0054_v25_33_partner_payment_model.sql:149-156)
 * and whose live values were typed in by hand. Meanwhile the CHARGE paths read
 * somewhere else entirely:
 *
 *   | fee kind              | charged from                                   |
 *   |-----------------------|------------------------------------------------|
 *   | subscription_annual   | `partner_tier_price` via `requireChargeTier`   |
 *   | subscription_monthly  | `partner_tier_price` via `requireChargeTier`   |
 *   | spv_deployment        | `platform_fees` via `resolveSpvDeploymentFee`  |
 *
 * A platform that displays one fee and charges another is the worst version of
 * this defect, so the display is repointed onto the CHARGE resolvers. After the
 * repoint, "displayed" and "charged" are the same function call.
 *
 * ── WHY THERE IS AN ACKNOWLEDGEMENT AND NOT JUST A FIX ─────────────────────
 *
 * For any partner whose displayed number differs from the authoritative number,
 * flipping that read CHANGES WHAT THEY SEE. R96 requirement 5 forbids doing
 * that silently. So the flip is an admin decision, per fee kind, recorded in
 * `pricing_display_repoint_ack` (migration 0195) together with BOTH numbers as
 * they stood when it was taken:
 *
 *   * no ack row  → the partner keeps seeing today's value, and the console
 *                   shows displayed vs authoritative with a Confirm control;
 *   * ack row     → the display reads the authoritative source.
 *
 * Nothing is deleted. `partner_fee_schedules` survives and keeps a genuinely
 * different purpose — DELIBERATE per-partner and per-tier NEGOTIATED overrides,
 * which still win, and which the console and the partner surface both NAME on
 * screen rather than leaving as an unexplained difference.
 *
 * MONEY. Integer minor units end to end, exactly as the resolvers return them.
 * No `Number()`, no `parseInt`, no `parseFloat`, no `/100`, no `*100`, no float
 * arithmetic. An unresolvable amount is `null`, never `0`.
 *
 * SACRED. Nothing here edits a sacred file. `server/db/connection.ts` is SACRED,
 * so the table is created by migration 0195 and, for harnesses that boot from
 * connection.ts alone, by an idempotent `CREATE TABLE IF NOT EXISTS` guard in
 * this module — the pattern migrations 0188 and 0193 record.
 */
import { rawDb } from "../db/connection";
import { resolvePartnerFee, FeeResolutionError, type FeeKind } from "./partnerFeeResolver";
import { resolveSpvDeploymentFee, SpvDeploymentFeeUnconfiguredError } from "./spvDeploymentFeeSource";
import { resolveChargeTier, PartnerTierPriceUnresolvedError } from "./partnerTiers";
import type { PartnerTier } from "../adminContactsStoreShim";
/* WAVE 208 · ITEM A.4 — EXTENDING WAVE 199 RATHER THAN DUPLICATING IT. This is
   wave 202's per-price resolver over wave 199's platform-wide answer over wave
   188's admin row `partner_pricing_model_config`. No new table, no new flag and
   no second policy is introduced by wave 208: the partner fee-schedule surface
   simply becomes one more consumer of the choice the admin already makes. */
import { resolvePricePeriodOffer, partnerTierScopeKey } from "./pricePeriodOffer";
/* WAVE 208 — the 240-character client gate (`looksHuman`) as a shared helper,
   reused rather than re-implemented for the fifth time. */
import { fitToGate, boundedFragment } from "../../shared/refusalHeadlineGate";

/** The fee kinds whose DISPLAY this wave repoints. Ordered for stable render. */
export const REPOINTABLE_FEE_KINDS: readonly string[] = Object.freeze([
  "subscription_monthly",
  "subscription_annual",
  "spv_deployment",
]);

/**
 * The ONE authoritative table per repointable fee kind. Exported as data so
 * "which table decides this price" is answerable without reading a resolver.
 */
export const AUTHORITATIVE_SOURCE_BY_FEE_KIND: Readonly<Record<string, string>> = Object.freeze({
  subscription_monthly: "partner_tier_price",
  subscription_annual: "partner_tier_price",
  spv_deployment: "platform_fees",
});

/**
 * Plain-English name for the surviving second table's purpose, shown on screen
 * so a difference between the authoritative catalogue price and what a specific
 * partner is quoted is EXPLAINED rather than merely different (R96 req 2).
 */
export const NEGOTIATED_OVERRIDE_PURPOSE =
  "Negotiated override — a deliberate per-partner price and its audit history, kept in the " +
  "fee-schedule table against the authoritative catalogue price. It is not a second price list.";

export interface RepointAckRow {
  id: string;
  feeKind: string;
  displayedAmountMinor: number | null;
  displayedCurrency: string | null;
  authoritativeAmountMinor: number | null;
  authoritativeCurrency: string | null;
  authoritativeSource: string;
  billingPeriod: string | null;
  acknowledgedByUserId: string | null;
  acknowledgedAt: string;
  note: string | null;
}

function handle(raw?: any): any | null {
  if (raw) return raw;
  try {
    return rawDb();
  } catch {
    return null;
  }
}

/**
 * Idempotent self-heal for harnesses that boot the schema from the SACRED
 * `connection.ts` instead of the numbered runner. Mirrors migration 0195
 * exactly; never migrates data.
 */
function ensureTable(db: any): void {
  try {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS pricing_display_repoint_ack (
         id                          TEXT PRIMARY KEY,
         fee_kind                    TEXT NOT NULL UNIQUE,
         displayed_amount_minor      INTEGER,
         displayed_currency          TEXT,
         authoritative_amount_minor  INTEGER,
         authoritative_currency      TEXT,
         authoritative_source        TEXT NOT NULL,
         billing_period              TEXT,
         acknowledged_by_user_id     TEXT,
         acknowledged_at             TEXT NOT NULL,
         note                        TEXT
       )`,
    ).run();
  } catch {
    /* A pre-existing table, or a read-only handle: both are fine. */
  }
}

/** Every recorded repoint decision, newest first. */
export function listRepointAcks(raw?: any): RepointAckRow[] {
  const db = handle(raw);
  if (!db) return [];
  ensureTable(db);
  try {
    const rows = db
      .prepare(
        `SELECT id, fee_kind, displayed_amount_minor, displayed_currency,
                authoritative_amount_minor, authoritative_currency,
                authoritative_source, billing_period, acknowledged_by_user_id,
                acknowledged_at, note
           FROM pricing_display_repoint_ack
          ORDER BY acknowledged_at DESC`,
      )
      .all() as any[];
    return rows.map((r) => ({
      id: String(r.id),
      feeKind: String(r.fee_kind),
      displayedAmountMinor: r.displayed_amount_minor === null || r.displayed_amount_minor === undefined ? null : (r.displayed_amount_minor as number),
      displayedCurrency: r.displayed_currency ?? null,
      authoritativeAmountMinor:
        r.authoritative_amount_minor === null || r.authoritative_amount_minor === undefined ? null : (r.authoritative_amount_minor as number),
      authoritativeCurrency: r.authoritative_currency ?? null,
      authoritativeSource: String(r.authoritative_source),
      billingPeriod: r.billing_period ?? null,
      acknowledgedByUserId: r.acknowledged_by_user_id ?? null,
      acknowledgedAt: String(r.acknowledged_at),
      note: r.note ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Has an admin explicitly accepted that this fee kind's DISPLAY moves onto its
 * authoritative source? Fail-closed: when the table cannot be read the answer
 * is "no", so an unreadable database can never reprice what a partner sees.
 */
export function isRepointAcknowledged(feeKind: string, raw?: any): boolean {
  const db = handle(raw);
  if (!db) return false;
  ensureTable(db);
  try {
    const row = db
      .prepare(`SELECT 1 AS present FROM pricing_display_repoint_ack WHERE fee_kind = ? LIMIT 1`)
      .get(feeKind) as { present?: number } | undefined;
    return Boolean(row?.present);
  } catch {
    return false;
  }
}

export interface AcknowledgeRepointArgs {
  feeKind: string;
  displayedAmountMinor: number | null;
  displayedCurrency: string | null;
  authoritativeAmountMinor: number | null;
  authoritativeCurrency: string | null;
  billingPeriod: string | null;
  acknowledgedByUserId: string | null;
  note?: string | null;
  raw?: any;
}

/**
 * Record the decision. Both numbers are stored as given, in minor units, so the
 * record says what the change actually was rather than what it is now.
 */
export function acknowledgeRepoint(args: AcknowledgeRepointArgs): RepointAckRow {
  if (!REPOINTABLE_FEE_KINDS.includes(args.feeKind)) {
    throw new Error(
      `REPOINT_FEE_KIND_UNKNOWN: "${args.feeKind}" is not one of ${REPOINTABLE_FEE_KINDS.join(", ")}`,
    );
  }
  const db = handle(args.raw);
  if (!db) throw new Error("REPOINT_ACK_NO_DB: no database handle available to record the decision");
  ensureTable(db);
  const source = AUTHORITATIVE_SOURCE_BY_FEE_KIND[args.feeKind];
  const at = new Date().toISOString();
  const id = `pdra_${args.feeKind}`;
  db.prepare(
    `INSERT INTO pricing_display_repoint_ack
       (id, fee_kind, displayed_amount_minor, displayed_currency,
        authoritative_amount_minor, authoritative_currency, authoritative_source,
        billing_period, acknowledged_by_user_id, acknowledged_at, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(fee_kind) DO UPDATE SET
       displayed_amount_minor     = excluded.displayed_amount_minor,
       displayed_currency         = excluded.displayed_currency,
       authoritative_amount_minor = excluded.authoritative_amount_minor,
       authoritative_currency     = excluded.authoritative_currency,
       authoritative_source       = excluded.authoritative_source,
       billing_period             = excluded.billing_period,
       acknowledged_by_user_id    = excluded.acknowledged_by_user_id,
       acknowledged_at            = excluded.acknowledged_at,
       note                       = excluded.note`,
  ).run(
    id,
    args.feeKind,
    args.displayedAmountMinor,
    args.displayedCurrency,
    args.authoritativeAmountMinor,
    args.authoritativeCurrency,
    source,
    args.billingPeriod,
    args.acknowledgedByUserId,
    at,
    args.note ?? null,
  );
  return {
    id,
    feeKind: args.feeKind,
    displayedAmountMinor: args.displayedAmountMinor,
    displayedCurrency: args.displayedCurrency,
    authoritativeAmountMinor: args.authoritativeAmountMinor,
    authoritativeCurrency: args.authoritativeCurrency,
    authoritativeSource: source,
    billingPeriod: args.billingPeriod,
    acknowledgedByUserId: args.acknowledgedByUserId,
    acknowledgedAt: at,
    note: args.note ?? null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE RESOLUTIONS — LEGACY (what is displayed today) vs AUTHORITATIVE
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface SourcedAmount {
  amountMinor: number | null;
  currency: string | null;
  /** Provenance, machine-readable. Humanised by the client, never shown raw. */
  computedVia: string | null;
  feeScheduleId: string | null;
  billingPeriod: string | null;
  /** Set instead of an amount when resolution failed. Never a silent 0. */
  error: string | null;
  /**
   * WAVE 208 · ITEM A — OPTIONAL, ADDITIVE, AND NEVER SHOWN TO A PARTNER.
   *
   * When wave 208's reconciliation refuses, `error` carries the plain sentence a
   * partner reads and this field carries the UNDERLYING machine reason the
   * authoritative resolver or the billing-period policy actually gave. Two
   * separate facts, so making the screen readable cannot destroy the diagnosis.
   * Absent on every path that existed before wave 208.
   */
  refusedBecause?: string | null;
}

const UNRESOLVED: SourcedAmount = Object.freeze({
  amountMinor: null,
  currency: null,
  computedVia: null,
  feeScheduleId: null,
  billingPeriod: null,
  error: "UNRESOLVED",
});

/** The period a fee kind is expressed in. Carried from the row where there is one. */
export function periodForFeeKind(feeKind: string, tierCadence?: string | null): string | null {
  if (feeKind === "spv_deployment") return "one_off";
  if (feeKind === "subscription_annual") return tierCadence ?? "annual";
  if (feeKind === "subscription_monthly") return tierCadence ?? "monthly";
  return tierCadence ?? null;
}

/**
 * What the partner is shown TODAY: `partner_fee_schedules` through the
 * unmodified 3-level resolver. Retained so the console can show the difference
 * and so an un-acknowledged fee kind keeps its current behaviour byte for byte.
 */
export function resolveLegacyDisplayedFee(
  partnerId: string,
  tier: string,
  feeKind: string,
  opts: { sizeMinor?: number | null } = {},
): SourcedAmount {
  try {
    const r = resolvePartnerFee(partnerId, tier as PartnerTier, feeKind as FeeKind, {
      sizeMinor: opts.sizeMinor ?? null,
    });
    return {
      amountMinor: r.amountMinor,
      currency: r.currency,
      computedVia: r.computedVia,
      feeScheduleId: r.feeScheduleId ?? null,
      billingPeriod: periodForFeeKind(feeKind),
      error: null,
    };
  } catch (err) {
    const code = err instanceof FeeResolutionError ? `${err.code}: ${err.message}` : String(err);
    return { ...UNRESOLVED, error: code };
  }
}

/**
 * What the partner is CHARGED — and therefore, once acknowledged, what they are
 * shown. Per-partner and per-tier NEGOTIATED overrides still win: they are
 * deliberate decisions, not a second source, and both surfaces name them.
 */
export function resolveAuthoritativeDisplayedFee(
  partnerId: string,
  tier: string,
  feeKind: string,
  opts: { sizeMinor?: number | null } = {},
): SourcedAmount {
  if (feeKind === "spv_deployment") {
    try {
      const r = resolveSpvDeploymentFee(partnerId, tier as PartnerTier, {
        sizeMinor: opts.sizeMinor ?? null,
      });
      return {
        amountMinor: r.amountMinor,
        currency: r.currency,
        computedVia: r.computedVia,
        feeScheduleId: r.feeScheduleId,
        billingPeriod: periodForFeeKind(feeKind),
        error: null,
      };
    } catch (err) {
      const code =
        err instanceof SpvDeploymentFeeUnconfiguredError
          ? `${err.code}: ${err.message}`
          : err instanceof FeeResolutionError
            ? `${err.code}: ${err.message}`
            : String(err);
      return { ...UNRESOLVED, error: code };
    }
  }

  /* Subscription kinds. A per-partner override is the ONLY fee-schedule answer
   * accepted here — a tier/platform default row must not become a partner's
   * displayed subscription price, because the CHARGE path
   * (server/lib/partnerEffectivePlan.ts) does not read one either. */
  let override: SourcedAmount | null = null;
  try {
    const r = resolvePartnerFee(partnerId, tier as PartnerTier, feeKind as FeeKind, {
      sizeMinor: opts.sizeMinor ?? null,
    });
    if (r.computedVia === "partner_override") {
      override = {
        amountMinor: r.amountMinor,
        currency: r.currency,
        computedVia: r.computedVia,
        feeScheduleId: r.feeScheduleId ?? null,
        /* An override is labelled with ITS OWN cadence, never re-labelled onto
         * the annual tier row (the same rule partnerEffectivePlan.ts:212 keeps). */
        billingPeriod: periodForFeeKind(feeKind),
        error: null,
      };
    }
  } catch (err) {
    if (!(err instanceof FeeResolutionError)) throw err;
  }
  if (override) return override;

  try {
    const t = resolveChargeTier(tier);
    if (!t) {
      return {
        ...UNRESOLVED,
        error: `TIER_PRICE_UNRESOLVED: no active priced ${AUTHORITATIVE_SOURCE_BY_FEE_KIND[feeKind]} row for tier "${tier}"`,
      };
    }
    /* R3 retired monthly PURCHASES; the authoritative table holds an annual
     * cadence. Reporting the annual amount under a monthly label would restate
     * the price, so a monthly line whose authoritative row is not monthly
     * REFUSES and says why rather than quoting the wrong period. */
    const cadence = t.billingPeriod || null;
    if (feeKind === "subscription_monthly" && cadence !== "monthly") {
      return {
        ...UNRESOLVED,
        billingPeriod: null,
        error: `CADENCE_MISMATCH: the authoritative tier row for "${tier}" is priced ${cadence ?? "with no cadence"}, not monthly`,
      };
    }
    return {
      amountMinor: t.amountMinor,
      currency: t.currency,
      computedVia: "partner_tier_price_authoritative",
      feeScheduleId: null,
      billingPeriod: cadence,
      error: null,
    };
  } catch (err) {
    const code =
      err instanceof PartnerTierPriceUnresolvedError ? `${err.name}: ${err.message}` : String(err);
    return { ...UNRESOLVED, error: code };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 201 · ITEM B — THE FAULT THAT CHARGED A PRICE NOBODY WAS SHOWN
 *
 *  MEASURED BEHAVIOUR THIS CLOSES (build_log/wave201/W201_PREFLIGHT.md §2):
 *  For `spv_deployment` the CHARGE path resolves, on every tier, to the flat
 *  `platform_fees` row `consortium.spv_deployment_fee` — the row the admin
 *  console writes, R22/wave 46 having made it authoritative. The DISPLAY path
 *  was left on `partner_fee_schedules`, where every `spv_deployment` row is
 *  SIZE-BANDED (`pfs_def_spv_band1..4`). `pickBandRow` in partnerFeeResolver.ts
 *  contains, correctly for its own contract:
 *
 *      // Banded: require a size to choose a band.
 *      if (sizeMinor === null) return null;
 *
 *  Every display caller asks for the price WITHOUT an SPV size — the console
 *  route passes no `opts` at all, and `wave15FeeScheduleAggregate` passes
 *  `committedMinor` which is absent outside a specific commitment. So no band
 *  can ever be chosen, both the tier level and the platform-default level miss,
 *  and the display refuses with `no_fee_schedule_configured` while the charge
 *  path answers $240.00.
 *
 *  ROOT CAUSE, ONE SENTENCE: wave 46 repointed the CHARGE side of this fee onto
 *  a flat, size-independent source and left the DISPLAY side reading a
 *  size-banded table that is never given a size. Not a missing row — the rows
 *  are all present and were measured. A structurally unanswerable question.
 *
 *  THE FIX, AND WHY IT IS NOT A SECOND SOURCE OF TRUTH: when the legacy display
 *  resolution produces NOTHING AT ALL and the authoritative source — the one
 *  R22 already named for this fee — does resolve, the display shows THE
 *  AUTHORITATIVE FIGURE rather than a refusal. This completes R22 instead of
 *  working around it.
 *
 *  WHY THIS DOES NOT BREACH R96 REQ 5 (never silently reprice a live customer).
 *  The acknowledgement gate exists so that a partner who is SHOWN a number is
 *  not moved onto a different number without an admin deciding. This path fires
 *  ONLY when the legacy side shows no number whatsoever. You cannot silently
 *  reprice a price that is not being displayed. Where a figure IS displayed the
 *  gate is untouched and the ack is still required, byte for byte.
 *
 *  WHY THIS DOES NOT BREACH R156.2 (never hardcode a fee or currency). No
 *  amount and no currency appears here. The figure is read at request time from
 *  the same admin-editable row the charge path reads, through the existing
 *  resolver. Change the number in Admin → Fees and both sides move together.
 *  No `Number()`, no `parseInt`, no `parseFloat`, no arithmetic of any kind is
 *  performed on the amount — it is carried through untouched with its currency,
 *  so R156.1 cannot be breached either.
 *
 *  SCOPE. Restricted to `REPOINTABLE_FEE_KINDS`, the three fee kinds that have a
 *  declared authoritative source. Measured effect on the live data today: the
 *  five `spv_deployment` rows move from "Not resolvable" to $240.00 USD, which
 *  is what they are charged. NO `subscription_*` row changes, because their
 *  legacy side already resolves. NO charged figure changes anywhere.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Provenance suffix appended when the authoritative source filled a hole the
 * legacy display left. Kept as a named constant so "why is this partner seeing
 * the authoritative number before any repoint was confirmed" is answerable by
 * grep, and so the console can say it in plain English rather than implying it.
 */
export const GAP_FILLED_VIA_SUFFIX = "_shown_because_no_displayed_price";

/**
 * The displayed resolution AS A PARTNER ACTUALLY EXPERIENCES IT, before the
 * acknowledgement question is asked. Legacy first, byte for byte. Only when
 * legacy yields no figure at all does the authoritative source answer.
 *
 * When NEITHER side can answer, the LEGACY error is returned deliberately: the
 * displayed side is the side that is missing, and naming the wrong side would
 * reproduce in a new place the exact defect wave 201 exists to fix.
 */
export function resolveEffectiveDisplayedFee(
  partnerId: string,
  tier: string,
  feeKind: string,
  opts: { sizeMinor?: number | null; raw?: any } = {},
): SourcedAmount {
  const legacy = resolveLegacyDisplayedFee(partnerId, tier, feeKind, opts);
  const legacyAnswered = legacy.error === null && legacy.amountMinor !== null;
  if (legacyAnswered) return legacy;
  if (!REPOINTABLE_FEE_KINDS.includes(feeKind)) return legacy;
  const authoritative = resolveAuthoritativeDisplayedFee(partnerId, tier, feeKind, opts);
  if (authoritative.error !== null || authoritative.amountMinor === null) return legacy;
  return {
    amountMinor: authoritative.amountMinor,
    currency: authoritative.currency,
    computedVia: `${authoritative.computedVia ?? "authoritative"}${GAP_FILLED_VIA_SUFFIX}`,
    feeScheduleId: authoritative.feeScheduleId,
    billingPeriod: authoritative.billingPeriod,
    error: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 208 · ITEM A — RECONCILE DISPLAYED TO AUTHORITATIVE, OR REFUSE
 *
 *  THE OWNER'S INSTRUCTION THAT MADE THIS POSSIBLE. R195.2 capped a divergence
 *  at "the lower value governs", which is why waves 195–201 could report this
 *  defect but not close it: on every `subscription_*` row the lower value was a
 *  seeded $0.00. The owner has now ruled that all data is test mode, lifting
 *  that cap, and that "the correct fix is now available: make displayed and
 *  authoritative AGREE, with the admin-configured value as the single source of
 *  truth." And: "Reconciling is not cosmetic; it removes a class defect."
 *
 *  ── THE DEFECT, MEASURED IN THIS TREE (build_log/wave208/W208_PREFLIGHT.md §1)
 *
 *  Wave 201 closed HALF of the divergence. Its rule is LEGACY-FIRST: the
 *  authoritative source answers only when `partner_fee_schedules` produces
 *  nothing at all. For `spv_deployment` that was enough, because the display
 *  side produced nothing (a size-banded question asked with no size). For the
 *  subscriptions it could never fire, because the display side DOES produce
 *  something — the seeded platform-default rows `pfs_def_sub_y` / `pfs_def_sub_m`,
 *  `tier IS NULL`, `amount_minor = 0`. Measured on tier `catalyst`:
 *
 *      displayed      $0.00   via `platform_default`      (a seed placeholder)
 *      authoritative  $840.00 via `partner_tier_price`    (admin_set, R110.1)
 *
 *  So the root cause of the surviving half is NOT a missing row. It is a WRONG
 *  PRECEDENCE: a seeded zero outranking an admin-configured price on the display
 *  side, while the charge side reads the admin-configured price. Wave 201 said as
 *  much in its own scope note — "NO `subscription_*` row changes, because their
 *  legacy side already resolves."
 *
 *  ── THE FIX, AND WHY IT IS NOT A FOURTH SOURCE OF TRUTH ────────────────────
 *
 *  For the three `REPOINTABLE_FEE_KINDS` the DISPLAYED figure now IS the
 *  authoritative figure. This is not a new source; it is the SAME source R22 and
 *  R95 already named, finally reached by the display. `partner_fee_schedules` is
 *  not deleted and not disabled — every DELIBERATE level of it still wins,
 *  because `resolveAuthoritativeDisplayedFee` honours `partner_override` first
 *  for the subscriptions and `resolveSpvDeploymentFee` honours `partner_override`
 *  AND `tier_default` first for the deployment fee. The ONLY level demoted out of
 *  the display decision is `platform_default`: the seeded $0 placeholder. That is
 *  precisely the demotion R22 already performed for `spv_deployment`, applied to
 *  the two subscription kinds.
 *
 *  ── WHERE THE AUTHORITATIVE SIDE DOES NOT RESOLVE, THIS REFUSES ────────────
 *
 *  R-ASSERT is absolute and the owner was explicit: "Do not invent a value…
 *  Do not add a ninth [waiver]. The screen must say plainly that no authoritative
 *  price is on file." So an unresolved authoritative side yields a NULL amount and
 *  a named, plain-English refusal — NEVER the legacy $0.00. Eleven of this tree's
 *  eighteen tier × fee-kind rows take this branch, and every one of them was
 *  previously showing a $0.00 that no admin ever typed.
 *
 *  ── THE MONTHLY CADENCE CONTRADICTION IS NOT A RECONCILIATION ──────────────
 *
 *  A monthly rate displayed for a tier whose authoritative row is priced ANNUAL
 *  is not two numbers to reconcile; it is a contradiction, and quoting the annual
 *  amount under a monthly label would RESTATE the price. It refuses. The refusal
 *  is decided by `resolvePricePeriodOffer` — wave 202's per-price resolver, over
 *  wave 199's platform-wide answer, over wave 188's admin row — so the answer is
 *  100% admin-configured and dynamic: flip `monthly_purchasable` to 1 and the
 *  monthly line resolves again by itself. Wave 199 gated four surfaces and
 *  recorded in build_log/wave199/W199_BUILD.md §2.4 that it deliberately did not
 *  reach `PartnerBilling.tsx`; this is that fifth surface, reached from the SERVER
 *  because wave 208 owns no client file. Nothing about monthly is deleted or
 *  un-implemented: the schema, the resolvers, the admin switches and R135.5's
 *  retained `<option value="monthly">` are all untouched. A control is not a rate.
 *
 *  ── WHAT IS DELIBERATELY LEFT BYTE-FOR-BYTE ALONE ──────────────────────────
 *
 *  `resolveLegacyDisplayedFee`, `resolveAuthoritativeDisplayedFee`,
 *  `resolveEffectiveDisplayedFee`, `GAP_FILLED_VIA_SUFFIX`, the `divergent`
 *  boolean, the acknowledgement machinery and `classifyFeeComparison`. Wave 201's
 *  three states are not weakened, not re-implemented and not bypassed: this
 *  reconciliation adds a SIBLING resolver and leaves the classifier the only
 *  thing in the tree that can report agreement. A row where NEITHER side resolves
 *  still reports `incomplete` / `both` — a finding, not a pass.
 *
 *  MONEY. No arithmetic of any kind. Amounts are integer minor units carried
 *  through with the currency they arrived with. No `Number()`, no `parseInt`, no
 *  `parseFloat`, no `/100`, no `*100`, no conversion (R156.1), no cross-currency
 *  total (R165.1). No amount, currency or cadence literal appears anywhere below
 *  (R156.2) — every figure is read at request time from an admin-editable row.
 *
 *  R176.1. "Did this side answer" is always `error === null && amountMinor !== null`.
 *  A missing value never participates in an equality comparison as if it were one.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Refusal code: the authoritative source holds no price for this fee and tier. */
export const NO_AUTHORITATIVE_PRICE_CODE = "NO_AUTHORITATIVE_PRICE_ON_FILE";

/** Refusal code: the admin does not currently offer monthly, so no monthly rate. */
export const MONTHLY_NOT_OFFERED_CODE = "MONTHLY_NOT_OFFERED";

/**
 * The sentence a partner reads when no authoritative price is on file.
 *
 * SHAPED FOR `humanizeMachineKey` (client/src/lib/partnerDisplay.ts:177), which
 * is what the fee-schedule table already renders in the Source column: it spaces
 * the SCREAMING_SNAKE code, lower-cases the rest and capitalises the first
 * letter. So this reads on screen as "No authoritative price on file: no price is
 * on file for …". ONE sentence deliberately — a second sentence would arrive
 * lower-cased. Bounded through `fitToGate` so a pathological tier slug cannot
 * push it over the client's 240-character gate and get discarded entirely.
 */
export function noAuthoritativePriceOnFileMessage(feeKind: string, tier: string): string {
  return fitToGate(
    (b) =>
      `${NO_AUTHORITATIVE_PRICE_CODE}: no price is on file for "${boundedFragment(feeKind, b)}" ` +
      `on tier "${boundedFragment(tier, b)}", so none is shown until an administrator sets one`,
  );
}

/**
 * The sentence a partner reads when the admin does not offer monthly billing.
 * States the SETTING, not a policy of this file — it fires only while the row
 * says monthly is not offered, and stops firing the moment it says otherwise.
 */
export function monthlyNotOfferedMessage(tier: string): string {
  return fitToGate(
    (b) =>
      `${MONTHLY_NOT_OFFERED_CODE}: monthly billing is not currently offered, so no monthly ` +
      `rate is on file for tier "${boundedFragment(tier, b)}" and none is shown`,
  );
}

/**
 * Is a monthly RATE allowed to be displayed for this tier at all?
 *
 * Delegates entirely to `resolvePricePeriodOffer`, which is per-price if the
 * owner recorded a choice for this tier, wave 199's platform-wide answer if he
 * did not, and fail-closed if neither can be read. This function adds no policy
 * of its own and holds no default.
 */
function monthlyRateDisplayAllowed(tier: string): { allowed: boolean; reason: string } {
  const offer = resolvePricePeriodOffer(partnerTierScopeKey(tier));
  return {
    allowed: offer.monthlyOffered === true,
    /* The machine diagnosis, kept separate from the partner-facing sentence. */
    reason: `${MONTHLY_NOT_OFFERED_CODE}: resolvePricePeriodOffer(${partnerTierScopeKey(
      tier,
    )}) reports monthlyOffered=false via source=${offer.source}`,
  };
}

/**
 * WAVE 208 — THE DISPLAYED RESOLUTION, RECONCILED TO THE AUTHORITATIVE SOURCE.
 *
 * A sibling of `resolveEffectiveDisplayedFee`, not a replacement for it: wave
 * 201's function is exported, tested and left exactly as it was.
 *
 * Contract:
 *   · a fee kind with no declared authoritative source is untouched and falls
 *     through to wave 201's behaviour, byte for byte;
 *   · `subscription_monthly` REFUSES while the admin does not offer monthly;
 *   · otherwise the authoritative resolution decides, carrying its OWN
 *     `computedVia` so the screen names the real source;
 *   · an authoritative side that does not resolve REFUSES. It never falls back
 *     to the legacy figure, because a seeded zero is an absence wearing a
 *     number's clothes and a partner reading it would believe it.
 */
export function resolveReconciledDisplayedFee(
  partnerId: string,
  tier: string,
  feeKind: string,
  opts: { sizeMinor?: number | null; raw?: any } = {},
): SourcedAmount {
  /* A fee kind outside the repointable set has no authoritative source declared,
     so there is nothing to reconcile TO. Wave 201's path, unchanged. */
  if (!REPOINTABLE_FEE_KINDS.includes(feeKind)) {
    return resolveEffectiveDisplayedFee(partnerId, tier, feeKind, opts);
  }

  if (feeKind === "subscription_monthly") {
    const monthly = monthlyRateDisplayAllowed(tier);
    if (!monthly.allowed) {
      return {
        ...UNRESOLVED,
        billingPeriod: null,
        error: monthlyNotOfferedMessage(tier),
        refusedBecause: monthly.reason,
      };
    }
  }

  const authoritative = resolveAuthoritativeDisplayedFee(partnerId, tier, feeKind, opts);
  const authoritativeAnswered =
    authoritative.error === null && authoritative.amountMinor !== null;
  if (!authoritativeAnswered) {
    return {
      ...UNRESOLVED,
      billingPeriod: null,
      error: noAuthoritativePriceOnFileMessage(feeKind, tier),
      /* The authoritative resolver's own words, preserved. `CADENCE_MISMATCH: …`
         and `TIER_PRICE_UNRESOLVED: …` are diagnoses worth keeping; they are just
         not the sentence to put in front of a partner. */
      refusedBecause: authoritative.error,
    };
  }

  /* RECONCILED. The amount and its currency are carried through untouched, and
     the provenance is the authoritative source's own — `AGG_VIA_LABELS` already
     maps both of them to plain English ("Your tier's published price", "Platform
     fee, as published", "Negotiated for you"), so no client edit is required and
     no storage key reaches a human. */
  return {
    amountMinor: authoritative.amountMinor,
    currency: authoritative.currency,
    computedVia: authoritative.computedVia,
    feeScheduleId: authoritative.feeScheduleId,
    billingPeriod: authoritative.billingPeriod,
    error: null,
  };
}

/**
 * The resolution the DISPLAY should use right now: authoritative once the fee
 * kind has been acknowledged, otherwise today's value untouched.
 */
export function resolveDisplayedFee(
  partnerId: string,
  tier: string,
  feeKind: string,
  opts: { sizeMinor?: number | null; raw?: any } = {},
): SourcedAmount & { authoritative: boolean; pendingRepoint: boolean } {
  const repointable = REPOINTABLE_FEE_KINDS.includes(feeKind);
  const acked = repointable ? isRepointAcknowledged(feeKind, opts.raw) : false;
  if (repointable && acked) {
    /* WAVE 208 · ITEM A — was `resolveAuthoritativeDisplayedFee` directly, and
       that was a HOLE, found by attacking this wave's own fix rather than by a
       failing test (build_log/wave208/W208_TESTS.md, attack A2). An ack row made
       this branch bypass the cadence policy entirely: the moment any tier is
       given an active monthly `partner_tier_price` row while the admin still has
       `monthly_purchasable = 0`, an acknowledged fee kind would print a monthly
       rate the platform does not sell. Not reachable on today's data — every
       monthly tier row is `unpriced` and inactive — which is exactly why it would
       have shipped unnoticed. Both branches now answer through the same
       reconciliation; the ack still decides the `authoritative` FLAG and the copy
       that hangs off it, which is all R96 requirement 5 ever asked of it. */
    return {
      ...resolveReconciledDisplayedFee(partnerId, tier, feeKind, opts),
      authoritative: true,
      pendingRepoint: false,
    };
  }
  /* WAVE 201 · ITEM B — was `resolveLegacyDisplayedFee`. `pendingRepoint` is
     LEFT AS IT WAS on purpose: the formal repoint genuinely has not been
     acknowledged, and changing that flag would alter partner-facing copy this
     wave has no mandate to touch.

     WAVE 208 · ITEM A — was `resolveEffectiveDisplayedFee`. Same reasoning one
     step further: wave 201 let the authoritative source answer when the legacy
     side produced NOTHING; the owner has now ruled that it answers when the
     legacy side produces a SEEDED PLACEHOLDER too, and that where it cannot
     answer at all the screen refuses instead of printing that placeholder.
     `pendingRepoint` still says exactly what it said: no ack row exists. */
  const resolution = resolveReconciledDisplayedFee(partnerId, tier, feeKind, opts);
  return { ...resolution, authoritative: false, pendingRepoint: repointable };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE CONSOLE VIEW — displayed vs charged, per fee kind, with the period
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 201 · ITEM A — THREE STATES, NOT TWO
 *
 *  THE OWNER'S RULING (R173.7): "A badge reporting OK when it has not compared
 *  anything is reporting a false assurance. In audit terms an incomplete control
 *  is a finding, not a pass." And: "'We cannot compare' and 'the two disagree'
 *  are different facts and must be visually and textually distinct. Do not
 *  collapse the third into either of the others."
 *
 *  WHAT WAS ACTUALLY WRONG, MEASURED RATHER THAN INHERITED. The wave brief said
 *  a one-sided gap reported OK. It did not — verified by executing this module
 *  against a copy of the live database (build_log/wave201/PROBE_1, §1 of the
 *  preflight). The single boolean `divergent` was computed as:
 *
 *      const bothResolved = displayed.amountMinor !== null && authoritative.amountMinor !== null;
 *      const divergent = bothResolved ? <compare amount and currency>
 *                                     : displayed.amountMinor !== authoritative.amountMinor;
 *
 *  so a one-sided gap (`null` vs `24000`) took the else branch, `null !== 24000`
 *  is true, and the row was reported as a MISMATCH and handed a destructive
 *  "Confirm repricing" button. The FALSE ASSURANCE lived one case further on:
 *  when NEITHER side resolved, `null !== null` is FALSE, so `divergent` was
 *  false and the screen printed "Displayed matches charged" having compared
 *  nothing at all. Reachable by one ordinary admin action — expiring a
 *  platform-default fee-schedule row — and proved reachable in
 *  build_log/wave201/PROBE_3_false_ok_reachability.txt.
 *
 *  Both are the same fault: a two-valued boolean carrying a three-valued
 *  question. `divergent` is LEFT EXACTLY AS IT WAS — other code and existing
 *  tests read it, and silently redefining a shared boolean is how a small fix
 *  becomes a regression. The three-valued answer is added ALONGSIDE it.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The three facts a comparison can yield. `"incomplete"` is a FINDING. It is
 * neither a pass nor a mismatch and no caller may fold it into either.
 */
export type FeeComparisonState = "match" | "mismatch" | "incomplete";

/** Which side failed to resolve. `null` only when the state is not incomplete. */
export type FeeComparisonMissingSide = "displayed" | "charged" | "both" | null;

export interface FeeComparison {
  comparisonState: FeeComparisonState;
  missingSide: FeeComparisonMissingSide;
}

/**
 * Classify one comparison. THE ONLY PLACE `"match"` IS PRODUCED, and it is
 * produced only after both sides have been confirmed to hold a figure — so a
 * pass cannot be reported by a comparison that did not happen.
 *
 * A resolution counts as answered only when it carries BOTH no error AND an
 * amount. `error === null` alone is not enough: a row could in principle carry
 * neither, and "no error" is not the same fact as "an answer".
 */
export function classifyFeeComparison(
  displayed: SourcedAmount,
  authoritative: SourcedAmount,
): FeeComparison {
  const displayedAnswered = displayed.error === null && displayed.amountMinor !== null;
  const authoritativeAnswered = authoritative.error === null && authoritative.amountMinor !== null;
  if (!displayedAnswered && !authoritativeAnswered) {
    return { comparisonState: "incomplete", missingSide: "both" };
  }
  if (!displayedAnswered) return { comparisonState: "incomplete", missingSide: "displayed" };
  if (!authoritativeAnswered) return { comparisonState: "incomplete", missingSide: "charged" };
  const sameAmount = displayed.amountMinor === authoritative.amountMinor;
  const sameCurrency = (displayed.currency ?? null) === (authoritative.currency ?? null);
  return { comparisonState: sameAmount && sameCurrency ? "match" : "mismatch", missingSide: null };
}

export interface RepointPreviewRow {
  feeKind: string;
  authoritativeSource: string;
  billingPeriod: string | null;
  displayed: SourcedAmount;
  authoritative: SourcedAmount;
  /** True when the two numbers (or their currencies) do not agree. */
  divergent: boolean;
  /**
   * WAVE 201 · ITEM A. The three-valued answer. `"incomplete"` means one side
   * did not resolve, so NO comparison took place — a finding, never a pass.
   */
  comparisonState: FeeComparisonState;
  /** WAVE 201 · ITEM A.3 — WHICH side is missing, so the screen can name it. */
  missingSide: FeeComparisonMissingSide;
  acknowledged: boolean;
  ack: RepointAckRow | null;
  /**
   * WAVE 208 · ITEM A — NOTHING IS HIDDEN BY BEING DEMOTED.
   *
   * `displayed` above is now the RECONCILED figure, i.e. exactly what the
   * partner's own page serves, which is what the "Displayed now" column claims
   * to be. The figure `partner_fee_schedules` would have produced on its own is
   * kept here rather than dropped, together with the comparison it produces
   * against the authoritative source — computed by the SAME
   * `classifyFeeComparison`, so the pre-wave-208 finding remains readable and
   * auditable for as long as those seeded rows exist.
   *
   * NOT YET RENDERED. `AdminFeesConsolidated.tsx` is being edited by a
   * concurrent wave; surfacing these three fields is recorded as follow-up in
   * build_log/wave208/W208_BUILD.md and is NOT claimed as done here.
   */
  legacyDisplayed: SourcedAmount;
  /** `divergent` as it stood before wave 208: legacy figure vs authoritative. */
  legacyDivergent: boolean;
  /** Wave 201's three-valued answer for the legacy pair. Never collapsed. */
  legacyComparisonState: FeeComparisonState;
  /** Which side of the legacy pair is missing, or null when both resolved. */
  legacyMissingSide: FeeComparisonMissingSide;
}

/**
 * Build the "Displayed vs Charged" table for one partner and tier. This is the
 * evidence an admin confirms against: it never changes anything by being read.
 */
export function buildRepointPreview(
  partnerId: string,
  tier: string,
  opts: { sizeMinor?: number | null; raw?: any } = {},
): RepointPreviewRow[] {
  const acks = new Map(listRepointAcks(opts.raw).map((a) => [a.feeKind, a]));
  return REPOINTABLE_FEE_KINDS.map((feeKind) => {
    /* WAVE 201 · ITEM B — was `resolveLegacyDisplayedFee`. This column is
       headed "Displayed now" and its hint says it is "the amount a partner sees
       on their own billing page today", so it must resolve the way the partner
       page resolves. Reading a different function from the partner surface is
       what let a $240.00 charge sit behind a blank display unnoticed.

       WAVE 208 · ITEM A — was `resolveEffectiveDisplayedFee`, and this call is
       deliberately the SAME function the partner surface reaches through
       `resolveDisplayedFee`. That identity is the whole point: the console and
       the partner page must never again be able to answer this question
       differently. The figure the legacy source would have produced on its own
       is not thrown away — it is carried on `legacyDisplayed` below, with its
       own three-state comparison, so demoting a seeded zero does not also erase
       the evidence that it was there. */
    const displayed = resolveReconciledDisplayedFee(partnerId, tier, feeKind, opts);
    const legacyDisplayed = resolveEffectiveDisplayedFee(partnerId, tier, feeKind, opts);
    const authoritative = resolveAuthoritativeDisplayedFee(partnerId, tier, feeKind, opts);
    /* `legacyDivergent` MIRRORS THE PRE-208 `divergent` EXPRESSION EXACTLY,
       including its unresolved branch where a null takes part in the comparison.
       That is deliberate and is not a new R176.1 breach: this field exists to
       report what an admin was shown BEFORE this wave, and altering the formula
       would make it report something else. The R176.1-safe answer for the same
       pair is the sibling immediately below it, `legacyComparisonState`, which
       comes from wave 201's three-state classifier and says "cannot compare"
       instead of guessing. Nothing keys an action off `legacyDivergent`. */
    const legacyBothResolved =
      legacyDisplayed.amountMinor !== null && authoritative.amountMinor !== null;
    const legacyDivergent = legacyBothResolved
      ? legacyDisplayed.amountMinor !== authoritative.amountMinor ||
        (legacyDisplayed.currency ?? null) !== (authoritative.currency ?? null)
      : legacyDisplayed.amountMinor !== authoritative.amountMinor;
    const legacyComparison = classifyFeeComparison(legacyDisplayed, authoritative);
    const bothResolved = displayed.amountMinor !== null && authoritative.amountMinor !== null;
    const divergent = bothResolved
      ? displayed.amountMinor !== authoritative.amountMinor ||
        (displayed.currency ?? null) !== (authoritative.currency ?? null)
      : displayed.amountMinor !== authoritative.amountMinor;
    /* WAVE 201 · ITEM A — the three-valued answer, added alongside `divergent`
       rather than replacing it. See classifyFeeComparison above. */
    const comparison = classifyFeeComparison(displayed, authoritative);
    return {
      feeKind,
      authoritativeSource: AUTHORITATIVE_SOURCE_BY_FEE_KIND[feeKind],
      billingPeriod: authoritative.billingPeriod ?? periodForFeeKind(feeKind),
      displayed,
      authoritative,
      divergent,
      comparisonState: comparison.comparisonState,
      missingSide: comparison.missingSide,
      acknowledged: acks.has(feeKind),
      ack: acks.get(feeKind) ?? null,
      /* WAVE 208 · ITEM A — appended as static siblings (R143.1). */
      legacyDisplayed,
      legacyDivergent,
      legacyComparisonState: legacyComparison.comparisonState,
      legacyMissingSide: legacyComparison.missingSide,
    };
  });
}

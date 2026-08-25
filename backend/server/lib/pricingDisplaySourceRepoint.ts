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
    return {
      ...resolveAuthoritativeDisplayedFee(partnerId, tier, feeKind, opts),
      authoritative: true,
      pendingRepoint: false,
    };
  }
  const legacy = resolveLegacyDisplayedFee(partnerId, tier, feeKind, opts);
  return { ...legacy, authoritative: false, pendingRepoint: repointable };
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE CONSOLE VIEW — displayed vs charged, per fee kind, with the period
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface RepointPreviewRow {
  feeKind: string;
  authoritativeSource: string;
  billingPeriod: string | null;
  displayed: SourcedAmount;
  authoritative: SourcedAmount;
  /** True when the two numbers (or their currencies) do not agree. */
  divergent: boolean;
  acknowledged: boolean;
  ack: RepointAckRow | null;
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
    const displayed = resolveLegacyDisplayedFee(partnerId, tier, feeKind, opts);
    const authoritative = resolveAuthoritativeDisplayedFee(partnerId, tier, feeKind, opts);
    const bothResolved = displayed.amountMinor !== null && authoritative.amountMinor !== null;
    const divergent = bothResolved
      ? displayed.amountMinor !== authoritative.amountMinor ||
        (displayed.currency ?? null) !== (authoritative.currency ?? null)
      : displayed.amountMinor !== authoritative.amountMinor;
    return {
      feeKind,
      authoritativeSource: AUTHORITATIVE_SOURCE_BY_FEE_KIND[feeKind],
      billingPeriod: authoritative.billingPeriod ?? periodForFeeKind(feeKind),
      displayed,
      authoritative,
      divergent,
      acknowledged: acks.has(feeKind),
      ack: acks.get(feeKind) ?? null,
    };
  });
}

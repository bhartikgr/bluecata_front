/**
 * server/lib/wave15FeeScheduleAggregate.ts
 *
 * WAVE 15 — CP-BRG-07 (register row PRM-195): the `feeSchedule` SSE aggregate.
 * spec/PARTNER_BUILT_VS_PROMISED.md:444 records BRG-07 as ABSENT P1.
 *
 * WHAT "SSE AGGREGATE" MEANS HERE, AND WHY.
 * A partner's effective fee schedule is not one row. It is composed from three
 * separate resolvers, each with its own precedence chain:
 *   - `resolvePartnerFee`      (server/lib/partnerFeeResolver.ts:145) — partner
 *     override -> tier default -> platform default, per fee kind;
 *   - `resolveCommissionRate`  (:270) — the commission rate and its provenance;
 *   - `listFeeSchedules`       (server/lib/spvFeeScheduleStore.ts:387) — the SPV
 *     fee-schedule rows in force.
 * A client that wants "my fees" therefore had to make three calls and re-derive
 * precedence itself, which is how two surfaces end up disagreeing about a price.
 * This module composes ONE payload with `computedVia` preserved per line, and
 * publishes an invalidation frame when any input changes.
 *
 * TRANSPORT — NO SACRED EDIT. `server/lib/sseHub.ts` is SACRED, so `SSE_TOPICS`
 * cannot gain a `fee-schedule` member. The aggregate is published on the
 * EXISTING partner-scoped topic `partner-workspace`, whose established
 * convention (server/collectiveSseRoutes.ts:220-253) is `chapterId = partnerId`.
 * That needs no `chapter_id` query param, so it works for a partner with no
 * chapter — which is exactly why `/api/stream` (ORP-052) is the right subscribe
 * path for it.
 *
 * MONEY. Every amount is an integer minor unit exactly as the resolvers return
 * it. Rates are FRACTIONS; nothing here multiplies by 100 — the client formats
 * with `client/src/lib/percentDisplay.ts`.
 */
import { publish } from "./sseHub";
import { log } from "./logger";
import { rawDb } from "../db/connection";
import {
  resolvePartnerFee,
  resolveCommissionRate,
  FeeResolutionError,
  type FeeKind,
  type ResolvedFee,
} from "./partnerFeeResolver";
import { listFeeSchedules } from "./spvFeeScheduleStore";
import { resolveCanonicalPartnerTier, PARTNER_TIER_TABLE } from "./partnerTierResolver";

/** The fee kinds the aggregate reports. Ordered for stable rendering. */
export const AGGREGATE_FEE_KINDS: readonly FeeKind[] = Object.freeze([
  "subscription_monthly",
  "subscription_annual",
  "spv_deployment",
] as const) as readonly FeeKind[];

export interface AggregateLine {
  feeKind: string;
  ok: boolean;
  amountMinor: number | null;
  currency: string | null;
  computedVia: string | null;
  feeScheduleId: string | null;
  /** Populated instead of the amount when resolution FAILED. Never a silent 0. */
  error: string | null;
}

export interface FeeScheduleAggregate {
  partnerId: string;
  tier: string | null;
  tierError: string | null;
  commission: { rateFraction: number | null; via: string | null; error: string | null };
  lines: AggregateLine[];
  spvFeeSchedules: Array<Record<string, unknown>>;
  computedAt: string;
  /** A stable fingerprint of the payload, so a client can skip a no-op refetch. */
  revision: string;
}

function fingerprint(o: unknown): string {
  const s = JSON.stringify(o);
  // FNV-1a, 32-bit. Not a security hash — a cheap change detector.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `r${h.toString(16)}`;
}

/**
 * Build the aggregate for one partner.
 *
 * FAIL-CLOSED PER LINE. A fee kind that cannot be resolved reports
 * `ok: false` with the resolver's error code and a NULL amount. It never reports
 * 0, because a zero price is a real price and a partner reading it would
 * believe it.
 */
export function buildFeeScheduleAggregate(
  partnerId: string,
  opts?: { committedMinor?: number },
): FeeScheduleAggregate {
  /* The tier is resolved FAIL-CLOSED by the canonical resolver (migration 0161).
   * Without a tier no fee line can be resolved at all, so the aggregate reports
   * the tier error once and marks every line unresolved rather than guessing a
   * tier and pricing against it. */
  let tier: string | null = null;
  let tierError: string | null = null;
  try {
    tier = resolveCanonicalPartnerTier(partnerId);
  } catch (err) {
    tierError = (err as any)?.code ?? (err instanceof Error ? err.message : String(err));
  }

  const lines: AggregateLine[] = AGGREGATE_FEE_KINDS.map((kind) => {
    if (!tier) {
      return {
        feeKind: String(kind),
        ok: false,
        amountMinor: null,
        currency: null,
        computedVia: null,
        feeScheduleId: null,
        error: tierError ?? "TIER_UNRESOLVED",
      };
    }
    try {
      const r: ResolvedFee = resolvePartnerFee(partnerId, tier as any, kind, {
        sizeMinor: opts?.committedMinor ?? null,
      });
      return {
        feeKind: String(kind),
        ok: true,
        amountMinor: r.amountMinor,
        currency: r.currency,
        computedVia: r.computedVia,
        feeScheduleId: r.feeScheduleId ?? null,
        error: null,
      };
    } catch (err) {
      const code = err instanceof FeeResolutionError ? `${err.code}: ${err.message}` : String(err);
      return {
        feeKind: String(kind),
        ok: false,
        amountMinor: null,
        currency: null,
        computedVia: null,
        feeScheduleId: null,
        error: code,
      };
    }
  });

  let commission: FeeScheduleAggregate["commission"] = { rateFraction: null, via: null, error: null };
  try {
    if (tier) {
      const c = resolveCommissionRate(partnerId, tier as any);
      // `rate` is a FRACTION on the resolver's contract. Renamed here to
      // `rateFraction` so no client can read the field name as a percentage.
      commission = { rateFraction: c.rate, via: c.via, error: null };
    } else {
      commission.error = tierError ?? "TIER_UNRESOLVED";
    }
  } catch (err) {
    commission.error = err instanceof Error ? err.message : String(err);
  }

  let spvFeeSchedules: Array<Record<string, unknown>> = [];
  try {
    spvFeeSchedules = listFeeSchedules() as any[];
  } catch (err) {
    log.warn(`[w15-fee-agg] listFeeSchedules failed: ${String(err)}`);
  }

  const core = { partnerId, tier, commission, lines, spvFeeSchedules };
  return {
    ...core,
    tierError,
    computedAt: new Date().toISOString(),
    revision: fingerprint(core),
  };
}

/**
 * Publish an invalidation frame for a partner's fee aggregate.
 *
 * The frame carries the REVISION, not the payload: an SSE frame that carried
 * prices would be a second source of truth for money, and the two could diverge.
 * The client refetches the aggregate route when the revision it holds differs.
 *
 * @param partnerId used as the SSE scope, per the partner-workspace convention.
 */
export function publishFeeScheduleChanged(partnerId: string, reason: string): void {
  if (!partnerId) return;
  try {
    const agg = buildFeeScheduleAggregate(partnerId);
    publish(partnerId, "partner-workspace", {
      kind: "feeSchedule.changed",
      partnerId,
      revision: agg.revision,
      reason,
      at: agg.computedAt,
    });
  } catch (err) {
    // A publish failure must never fail the write that triggered it.
    log.warn(`[w15-fee-agg] publish failed for ${partnerId}: ${String(err)}`);
  }
}

/**
 * WAVE 16 / CP-BRG-07 — TIER-SCOPED fanout.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL. A per-partner override is not the
 * only thing that changes a partner's effective price. Two admin writes are
 * TIER-scoped and change the price for every partner on that tier without
 * touching a single partner row:
 *   - `partner_fee_schedules` create/update/expire
 *     (server/lib/partnerFeeAdminRoutes.ts) — the tier_default / platform_default
 *     legs of `resolvePartnerFee`;
 *   - `partner_commission_rate_config` upsert
 *     (server/lib/partnerCommissionRateResolver.ts:120, routed at
 *     server/adminCollectiveFeeRoutes.ts:153) — the commission leg.
 * Publishing only on the per-partner path would have left a partner staring at
 * a stale price after a tier repricing, which is the exact class of silent drop
 * this aggregate exists to prevent.
 *
 * AFFECTED SET IS READ FROM THE DB, never assumed. The table name is IMPORTED
 * as `PARTNER_TIER_TABLE` from `partnerTierResolver` rather than re-spelled
 * here, so the fanout set can never be read from a different table than the one
 * that prices the fee. `partner_tier_current` (migration 0161) is the durable
 * canon consulted by `resolveCanonicalPartnerTier`. `tier === null` means the PLATFORM-DEFAULT row
 * changed, which is a price input for every partner, so every partner is
 * notified.
 *
 * The frame still carries only the revision. Never throws: a fanout failure
 * must not roll back an admin's legitimate repricing write.
 */
export function publishFeeScheduleChangedForTier(tier: string | null, reason: string): number {
  let ids: string[] = [];
  try {
    const rows = (
      tier === null
        ? rawDb().prepare(`SELECT partner_id FROM ${PARTNER_TIER_TABLE}`).all()
        : rawDb().prepare(`SELECT partner_id FROM ${PARTNER_TIER_TABLE} WHERE tier = ?`).all(tier)
    ) as Array<{ partner_id: string }>;
    ids = rows.map((r) => String(r.partner_id)).filter((s) => s.length > 0);
  } catch (err) {
    log.warn(`[w15-fee-agg] tier fanout lookup failed (tier=${String(tier)}): ${String(err)}`);
    return 0;
  }
  for (const id of ids) publishFeeScheduleChanged(id, reason);
  return ids.length;
}

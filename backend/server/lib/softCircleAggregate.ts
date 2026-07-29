/**
 * server/lib/softCircleAggregate.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.3 as extended by v6 §3 (soft-circle aggregate
 * PROVENANCE).
 *
 * THE PROBLEM. `/api/collective/soft-circles` presents two numbers as facts:
 *
 *   targetUsd:        (round as ...)?.targetAmountUsd ?? 0
 *   softCircledTotal: circles.reduce((s, sc) => s + (sc.amount ?? 0), 0)
 *   fillPct:          targetUsd > 0 ? pct(total, targetUsd) : null
 *
 * Three things are wrong with that, and all three are visible to members:
 *
 *  1. `targetUsd` is read off `canonicalRounds`, which is the EMPTY ARRAY (dead
 *     seed data). So every round reports `targetUsd: 0` — the UI then hides the
 *     progress bar and the round looks like it has no target at all, while the
 *     durable `rounds.target_amount` column holds the real figure.
 *
 *  2. `softCircledTotal` sums `canonicalSoftCircles` (seed) together with
 *     `listForCollective()` output. `listForCollective()` FAILS OPEN to the
 *     in-process `memCircles` cache on any DB error (softCircleStore.ts:428-433),
 *     so a transient read failure silently produces a smaller total that is
 *     presented with exactly the same confidence as a durable one. Members make
 *     allocation decisions on this number.
 *
 *  3. The field is named `…Usd` and summed across rows whose `currency` column
 *     may be anything (`soft_circles.currency` defaults to `"USD"` but is
 *     free-text). Adding a CAD row to a USD row and labelling the result USD is
 *     currency INFERENCE, which this module refuses to do.
 *
 * THE CONTRACT. Amounts are reported ONLY when they can be proven from durable
 * rows in a single currency. Otherwise `softCircledTotal` is `null` and
 * `amountsUnavailable` is `true`, so the client can render "—" instead of a
 * confident wrong number. `softCircledCount` is NOT computed here: per v6 §3 the
 * count keeps its existing (seed+live) semantics, because a count is not an
 * amount and members already read it as "how many parties are circling".
 *
 * INVARIANTS (each has a test):
 *   • Never falls back to `memCircles` or to seed arrays. This module's queries
 *     go straight to `soft_circles` / `rounds` and `catch → unavailable`.
 *   • `targetUsd` is null when the round is missing, soft-deleted, or its
 *     `target_amount` is <= 0. `0` is NEVER reported as a target.
 *   • `fillPct` is null whenever either operand is null.
 *   • Mixed currencies, or any currency other than USD, ⇒ total null +
 *     `amountsUnavailable`. No conversion, no inference.
 *   • Read-only, parameterised.
 */
import { rawDb } from "../db/connection";
import { log } from "./logger";

export interface DurableRoundTarget {
  /** The round's target in USD, or null when it cannot be stated. */
  targetUsd: number | null;
  /** The durable `rounds.company_id`, or null. */
  companyId: string | null;
  /** The durable `rounds.name`, or null. Never a raw `rnd_…` id. */
  roundName: string | null;
  reason?: "no_id" | "not_found" | "no_target" | "non_usd" | "read_error";
}

/**
 * Durable read of a round's identity and target.
 *
 * `rounds.currency` is nullable and historically unset; a null/empty currency is
 * treated as USD because `target_amount` has always been populated in USD by the
 * round-creation path. A round that explicitly declares a NON-USD currency
 * returns `targetUsd: null` rather than a mislabelled figure.
 */
export function readDurableRoundTarget(roundId: string | null | undefined): DurableRoundTarget {
  const id = (roundId ?? "").trim();
  if (!id) return { targetUsd: null, companyId: null, roundName: null, reason: "no_id" };
  try {
    const row = rawDb()
      .prepare(
        `SELECT name, company_id, target_amount, currency
           FROM rounds
          WHERE id = ? AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(id) as
      | { name?: string; company_id?: string; target_amount?: number; currency?: string | null }
      | undefined;
    if (!row) {
      return { targetUsd: null, companyId: null, roundName: null, reason: "not_found" };
    }
    const roundName = String(row.name ?? "").trim() || null;
    const companyId = String(row.company_id ?? "").trim() || null;
    const currency = String(row.currency ?? "").trim().toUpperCase();
    if (currency && currency !== "USD") {
      return { targetUsd: null, companyId, roundName, reason: "non_usd" };
    }
    const target = Number(row.target_amount ?? 0);
    if (!Number.isFinite(target) || target <= 0) {
      return { targetUsd: null, companyId, roundName, reason: "no_target" };
    }
    return { targetUsd: target, companyId, roundName };
  } catch (err) {
    log.warn("[softCircleAggregate] rounds read failed for", id, "-", (err as Error).message);
    return { targetUsd: null, companyId: null, roundName: null, reason: "read_error" };
  }
}

export interface DurableSoftCircleTotal {
  /** Sum of durable USD soft-circle amounts, or null when not provable. */
  totalUsd: number | null;
  /** How many durable rows the total is built from. Zero when unavailable. */
  durableCount: number;
  /** The set of durable soft-circle ids, so a caller can detect seed-only rows. */
  durableIds: Set<string>;
  reason?: "no_id" | "read_error" | "mixed_currency" | "non_usd";
}

/**
 * Durable, collective-visible soft-circle total for one round.
 *
 * Mirrors `listForCollective()`'s row filter (`collective_visible = 1 AND
 * deleted_at IS NULL`) so the total covers exactly the rows the founder chose to
 * expose — but WITHOUT its in-memory fallback.
 */
export function readDurableSoftCircleTotal(
  roundId: string | null | undefined,
): DurableSoftCircleTotal {
  const empty = (reason: DurableSoftCircleTotal["reason"]): DurableSoftCircleTotal => ({
    totalUsd: null,
    durableCount: 0,
    durableIds: new Set<string>(),
    reason,
  });
  const id = (roundId ?? "").trim();
  if (!id) return empty("no_id");
  try {
    const rows = rawDb()
      .prepare(
        `SELECT id, amount, currency FROM soft_circles
          WHERE round_id = ? AND collective_visible = 1 AND deleted_at IS NULL`,
      )
      .all(id) as { id?: string; amount?: number; currency?: string | null }[];
    const durableIds = new Set<string>();
    const currencies = new Set<string>();
    let total = 0;
    for (const r of rows) {
      if (r.id) durableIds.add(String(r.id));
      currencies.add(String(r.currency ?? "USD").trim().toUpperCase() || "USD");
      total += Number(r.amount ?? 0);
    }
    if (currencies.size > 1) {
      return { totalUsd: null, durableCount: rows.length, durableIds, reason: "mixed_currency" };
    }
    const only = currencies.values().next().value as string | undefined;
    if (only && only !== "USD") {
      return { totalUsd: null, durableCount: rows.length, durableIds, reason: "non_usd" };
    }
    return { totalUsd: total, durableCount: rows.length, durableIds };
  } catch (err) {
    log.warn("[softCircleAggregate] soft_circles read failed for", id, "-", (err as Error).message);
    return empty("read_error");
  }
}

export interface SoftCircleAmountProvenance {
  softCircledTotal: number | null;
  targetUsd: number | null;
  fillPct: number | null;
  /** True whenever any amount on this round could not be stated durably. */
  amountsUnavailable: boolean;
  /** Diagnostic only — never rendered. */
  amountsReason?: string;
}

/**
 * Compose the provenance-checked amounts for one round.
 *
 * @param presentedCircleIds the ids the route is presenting for this round
 *        (seed + live). Any id absent from the durable set means the presented
 *        set is wider than what is provable, so the total is withheld rather
 *        than under-reported against a count the member can also see.
 */
export function resolveSoftCircleAmounts(
  roundId: string,
  presentedCircleIds: readonly string[],
  pct: (part: number, whole: number) => number,
): SoftCircleAmountProvenance {
  const target = readDurableRoundTarget(roundId);
  const durable = readDurableSoftCircleTotal(roundId);

  const nonDurable = presentedCircleIds.filter((cid) => !durable.durableIds.has(cid));
  const reasons: string[] = [];
  if (durable.reason) reasons.push(`total:${durable.reason}`);
  if (nonDurable.length > 0) reasons.push(`total:non_durable_rows(${nonDurable.length})`);
  if (target.reason) reasons.push(`target:${target.reason}`);

  const softCircledTotal =
    durable.totalUsd !== null && nonDurable.length === 0 ? durable.totalUsd : null;
  const targetUsd = target.targetUsd;
  const fillPct =
    softCircledTotal !== null && targetUsd !== null && targetUsd > 0
      ? pct(softCircledTotal, targetUsd)
      : null;

  return {
    softCircledTotal,
    targetUsd,
    fillPct,
    amountsUnavailable: softCircledTotal === null || targetUsd === null,
    amountsReason: reasons.length ? reasons.join(",") : undefined,
  };
}

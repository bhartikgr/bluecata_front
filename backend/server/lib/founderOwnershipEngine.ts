/**
 * WAVE 75 · ITEM 1 — FOUNDER OWNERSHIP, COMPUTED FROM THE ENGINE (owner ruling R70).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG
 * ═══════════════════════════════════════════════════════════════════════════
 * `server/paymentGatewayAdapter.ts:630` and `:765` built a brand-new company's
 * KPI block with the literal `ownershipPct: 1.0`. The founder dashboard consumes
 * that field as a FRACTION (`client/src/pages/founder/Dashboard.tsx:283` does
 * `Number(raw) * 100`), so a company with `capTableHolders: 0` and no securities
 * at all rendered a confident **100.00%** on its very first screen — and went on
 * rendering it after the first SAFE was signed, because a literal is not a
 * computation. Every sibling writer stores `0` under R48, whose own in-code
 * comment says `1` "would assert 100% founder ownership as a fact".
 *
 * The owner ruled (R70): *"Change it. Has to be dynamic and real-time. No hard
 * codes."* — deliberately stronger than the dash this agent recommended. The
 * figure must be **computed**; a dash is honest only where the engine has
 * nothing to compute from.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AND WHY IT IS NOT A SECOND COMPUTATION (R46 / R57 / R70·1)
 * ═══════════════════════════════════════════════════════════════════════════
 * `shared/roundMathEngineAdapter.ts::runEngine` is the SINGLE source of cap-table
 * truth in this tree (R57, verified: `client/src/lib/engineDemo.ts` is a re-export
 * shim, and `/founder/captable`, `CapitalizationJourney.tsx` and
 * `GET /api/founder/rounds/:id/round-math` all call the same function). This
 * module CALLS it. It adds no arithmetic of its own beyond the aggregation R57
 * explicitly blessed:
 *
 *   > "Its `useMemo` at `:274` merely sums the engine's own rows by holder type.
 *   >  **An aggregation of engine output, not a rival calculation.**"
 *
 * `client/src/pages/founder/CapTable.tsx:282-289` performs exactly this sum for
 * the `/founder/captable` "Founder ownership" tile, and `:581` divides it by the
 * engine's own `totalShares`. This module reproduces THAT DEFINITION so the
 * dashboard and the cap table can never disagree — which R46 names as the reason
 * the defect existed. It deliberately does NOT read the stored
 * `kpi.ownershipPct`, which R57 named the one remaining outlier.
 *
 * `shared/roundMathEngineAdapter.ts` IS NOT EDITED. It is pinned byte-for-byte by
 * `server/__tests__/w58g_waiver7_single_conversion_authority.test.ts:326`
 * (`9c0c1140…`), so hoisting the aggregation into it — R57's optional suggestion —
 * would trip that tripwire. The aggregation lives here instead, in one place, on
 * the server, callable and testable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ABSENT IS ABSENT — NEVER `?? 0`, NEVER `|| 1` (R47 / R70·3)
 * ═══════════════════════════════════════════════════════════════════════════
 * `null` is returned, and `null` alone, when the engine has nothing to compute
 * from: no securities provider wired, no securities on record, an engine refusal,
 * or a genuine zero denominator. `client/src/lib/format.ts::fmtPct(null)` already
 * renders the platform's em-dash, so `null` reaches a founder as `—`. A fabricated
 * default is the defect this module removes; there is no coalesce in this file.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW THE ROWS ARE REACHED — THE INJECTION PATTERN, NOT A THIRD READER
 * ═══════════════════════════════════════════════════════════════════════════
 * `server/routes.ts::buildCompanySecurities` is the ONE place `ApiSecurity` rows
 * are built (W-SAFE unpriced bridge and W-CAP priced bridge included), and it
 * lives inside `registerRoutes`'s closure. `server/routes.ts` already solves this
 * by INJECTION for the round-math routes:
 *
 *     registerRoundMathRoutes(app, (cid) => buildCompanySecurities(cid) as never);
 *
 * and `server/track1Routes.ts` (WAVE 71 · D11) uses the identical pattern for the
 * waterfall's common-share rows. The same pattern is used here rather than
 * inventing a second way to reach the cap table. A provider that was never
 * supplied means "not on record" and this module returns `null` — it never falls
 * back to a number.
 */
import { Decimal } from "decimal.js";
import { runEngine, type ApiSecurity } from "@shared/roundMathEngineAdapter";

export type CompanySecuritiesProvider = (companyId: string) => Array<Record<string, unknown>>;

let companySecuritiesProvider: CompanySecuritiesProvider | null = null;

/**
 * Wire the ONE securities builder. Called once from `server/routes.ts`, beside
 * the existing `registerRoundMathRoutes` injection.
 */
export function setFounderOwnershipSecuritiesProvider(p: CompanySecuritiesProvider | null): void {
  companySecuritiesProvider = p;
}

/** Test/diagnostic visibility: is the provider wired at all? */
export function founderOwnershipProviderWired(): boolean {
  return companySecuritiesProvider !== null;
}

/**
 * Why no figure could be computed. Returned alongside the value so a caller —
 * and a test — can tell "no securities yet" from "the engine refused", instead of
 * both arriving as an indistinguishable `null`.
 */
export type FounderOwnershipReason =
  | "computed"
  | "no_securities_provider"
  | "no_securities_on_record"
  | "engine_refused"
  | "zero_total_shares"
  | "no_founder_holding_on_record";

export type FounderOwnershipResult = {
  /** Fully-diluted founder ownership as a FRACTION in [0,1] — or `null`. */
  fraction: number | null;
  /** The engine's own exact decimal for the same quantity, or `null`. */
  exact: string | null;
  reason: FounderOwnershipReason;
  /** Engine totals, for a report that has to show its work. */
  founderShares: string | null;
  totalShares: string | null;
};

/**
 * THE ONE ENTRY POINT. Computes fully-diluted founder ownership for one company
 * from the engine, right now, from whatever is on the cap table right now.
 *
 * `fully_diluted` and region `"US"` match `GET /api/founder/rounds/:id/round-math`
 * and the `/founder/captable` default, and the pricing-order mode is deliberately
 * OMITTED so this call is byte-identical in behaviour to `CapTable.tsx:262`'s
 * `runEngine(securitiesAsOf, view, region)`. Two different modes for one quantity
 * would be exactly the divergence R46 forbids.
 */
export function computeFounderOwnership(companyId: unknown): FounderOwnershipResult {
  const empty = (reason: FounderOwnershipReason): FounderOwnershipResult => ({
    fraction: null, exact: null, reason, founderShares: null, totalShares: null,
  });
  const cid = String(companyId ?? "").trim();
  if (!cid) return empty("no_securities_on_record");
  if (!companySecuritiesProvider) return empty("no_securities_provider");

  let rows: Array<Record<string, unknown>>;
  try {
    rows = companySecuritiesProvider(cid) ?? [];
  } catch {
    /* A provider that throws is not evidence of ownership. */
    return empty("no_securities_provider");
  }
  if (rows.length === 0) return empty("no_securities_on_record");

  let result: ReturnType<typeof runEngine>;
  try {
    result = runEngine(rows as unknown as ApiSecurity[], "fully_diluted", "US");
  } catch {
    /* The adapter's named refusals (an unpriced conversion with no price, an
       unknown anti-dilution term, …) are REFUSALS, not zeros. */
    return empty("engine_refused");
  }

  const total = result.totalShares as unknown as bigint;
  /* R47, verbatim: "a percentage of zero shares is undefined, not zero". */
  if (!(total > BigInt(0))) {
    return { fraction: null, exact: null, reason: "zero_total_shares", founderShares: null, totalShares: String(total) };
  }
  /* THE AGGREGATION, identical to CapTable.tsx:285-289's `sumByType("founder")`. */
  const founderRows = result.rows.filter((r) => r.holderType === "founder");
  /* ── ZERO IS NOT AN ANSWER HERE EITHER (R47) ────────────────────────────────
     A cap table that carries securities but NO founder holding does not tell us
     the founder owns nothing; it tells us the founder's holding is not on record.
     Returning `0` would print a confident `0.00%` — the same fabrication as the
     `100.00%` this module removed, with the opposite sign, and precisely the defect
     `/founder/captable` still shows for such a company (see WAVE75_REPORT.md §1,
     finding F-1). So this is `null`, and `null` reaches the founder as `—`. */
  if (founderRows.length === 0) {
    return {
      fraction: null, exact: null, reason: "no_founder_holding_on_record",
      founderShares: null, totalShares: String(total),
    };
  }
  const founder = founderRows.reduce<bigint>(
    (s, r) => s + (r.shares as unknown as bigint),
    BigInt(0),
  );
  /* EXACT first, float second. The division happens in decimal.js at the
     engine's own 38-digit precision and is only then narrowed to the IEEE-754
     double the JSON KPI field carries. */
  const exact = new Decimal(String(founder)).div(new Decimal(String(total)));
  return {
    fraction: exact.toNumber(),
    exact: exact.toFixed(),
    reason: "computed",
    founderShares: String(founder),
    totalShares: String(total),
  };
}

/**
 * The KPI-shaped convenience wrapper: the fraction, or `null`. This is what the
 * two `paymentGatewayAdapter.ts` sites call in place of the literal `1.0`, and
 * what `multiCompanyStore.ts` overlays onto the KPI block it serves.
 */
export function computeFounderOwnershipFraction(companyId: unknown): number | null {
  return computeFounderOwnership(companyId).fraction;
}

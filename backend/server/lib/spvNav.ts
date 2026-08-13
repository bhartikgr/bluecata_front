/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 1 — NAV.
 *
 * WHAT THIS IS. The net asset value of an SPV, DERIVED from the vehicle's real
 * holdings (`spv_deployment`) multiplied by the EFFECTIVE valuation mark for
 * each held company. It reuses the existing marks/valuation engine
 * (`server/wave9ReportingStore.ts`, migrations 0159 + 0174) rather than
 * introducing a second source of truth for what a holding is worth.
 *
 * OWNER RULING Q5, honoured end to end:
 *   · marks AUTO-DERIVE from the last priced round      -> deriveMarkForCompany
 *   · marks are BADGED                                   -> badge on every line
 *   · marks go STALE at 180 days and EXPIRE at 365       -> thresholds are rows
 *                                                           in wave9_reporting_config,
 *                                                           never literals here
 *   · marks are GP-OVERRIDABLE                           -> effectiveMarkForCompany
 *   · the override REQUIRES APPROVAL (migration 0174)    -> the approval gate is
 *                                                           inside
 *                                                           overrideIsEffective();
 *                                                           this module does not
 *                                                           re-decide it, so a
 *                                                           pending override
 *                                                           CANNOT move a NAV
 *
 * THE RULE THAT SHAPES EVERY BRANCH BELOW. Investment banks are in adoption
 * conversations and this is what a fund-admin diligence process inspects. A
 * fabricated NAV is far worse than a blank. So:
 *
 *   · A holding with NO effective mark does NOT fall back to cost. Cost is a
 *     historical fact, not a valuation, and presenting it as one is the exact
 *     defect PRIOR_ART_SWEEP §A documents in `portfolioAnalyticsStore.ts:100`
 *     ("currentValue: safeInvested"), where every MOIC silently became 1.0.
 *   · A NAV over a portfolio containing ANY unmarked holding is NOT a smaller
 *     NAV. It is an UNKNOWN one. `totalNavMinor` is null and `status` says why.
 *   · Holdings spanning multiple currencies produce NO total. Summing minor
 *     units across currencies produces a number that is not money — four sites
 *     in this tree did it and all four were fixed.
 *   · Nulls, never zeros, for unknown money, with a rendered refusal.
 *
 * MONEY. Fair value per holding is `shares × pricePerShare`, computed in EXACT
 * BigInt decimal arithmetic — the share count and the price are parsed from
 * their decimal strings and multiplied as integers, so no binary double ever
 * holds the value. The single unavoidable rounding (a product may land between
 * two minor units) is HALF-EVEN and is applied to a WHOLE-HOLDING total, never
 * to a per-party share. Per-LP NAV shares go through the money.ts
 * largest-remainder allocator instead, so they sum exactly to the total.
 */
import {
  currencyExponent,
  allocateResidualCents,
} from "./money";
import {
  effectiveMarkForCompany,
  getMarkThresholds,
  type DerivedMark,
  type MarkBadge,
} from "../wave9ReportingStore";

/* ==========================================================================
 * 1. EXACT SHARES × PRICE ARITHMETIC
 * ======================================================================== */

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** Parsed exact decimal: value === digits / 10^scale. `digits` may be negative. */
interface ExactDecimal {
  digits: bigint;
  scale: number;
}

/**
 * Parse a decimal string EXACTLY. Returns null rather than throwing, because
 * every caller here turns an unparseable input into an explicit refusal line on
 * the NAV, not into an exception that would take down a whole vehicle's read.
 */
export function parseExactDecimal(raw: string | number | null | undefined): ExactDecimal | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const m = DECIMAL_RE.exec(s);
  if (!m) return null;
  const [, sign, intPartRaw, fracPartRaw, expRaw] = m;
  const intPart = intPartRaw ?? "";
  const fracPart = fracPartRaw ?? "";
  if (intPart === "" && fracPart === "") return null;
  const exp = expRaw ? parseInt(expRaw, 10) : 0;
  if (!Number.isFinite(exp) || Math.abs(exp) > 400) return null;
  let digits = BigInt((intPart === "" ? "0" : intPart) + fracPart);
  if (sign === "-") digits = -digits;
  // value = digits * 10^(exp - fracLen)  ==>  scale = fracLen - exp
  return { digits, scale: fracPart.length - exp };
}

function pow10(n: number): bigint {
  let out = BigInt(1);
  const TEN = BigInt(10);
  for (let i = 0; i < n; i++) out *= TEN;
  return out;
}

/**
 * Divide `num` by `den` (both positive) rounding HALF TO EVEN.
 *
 * Half-even, not half-up: half-up applied repeatedly across a portfolio biases
 * the total upward, and a NAV that drifts upward by construction is the kind of
 * finding a fund administrator writes down. `basisPoints()` in money.ts uses
 * the same tie-break, so the two modules round the same way.
 */
function divRoundHalfEven(num: bigint, den: bigint): bigint {
  const ZERO = BigInt(0);
  const ONE = BigInt(1);
  const TWO = BigInt(2);
  if (den <= ZERO) throw new RangeError("divRoundHalfEven: denominator must be positive");
  const neg = num < ZERO;
  const n = neg ? -num : num;
  const q = n / den;
  const r = n % den;
  const twice = r * TWO;
  let out: bigint;
  if (twice < den) out = q;
  else if (twice > den) out = q + ONE;
  else out = q % TWO === ZERO ? q : q + ONE;
  return neg ? -out : out;
}

/**
 * `shares × pricePerShare` in MINOR units of `currency`, exactly.
 *
 * Returns null when either input is not a parseable decimal or is negative — a
 * holding whose share count the platform does not actually know is UNMARKED,
 * not zero-valued.
 */
export function holdingFairValueMinor(
  shares: string | number | null | undefined,
  pricePerShare: string | number | null | undefined,
  currency: string,
): bigint | null {
  const sh = parseExactDecimal(shares);
  const pps = parseExactDecimal(pricePerShare);
  if (!sh || !pps) return null;
  if (sh.digits < BigInt(0) || pps.digits < BigInt(0)) return null;
  // value(major) = (sh.digits * pps.digits) / 10^(sh.scale + pps.scale)
  // value(minor) = value(major) * 10^exponent
  const exponent = currencyExponent(currency);
  const numerator = sh.digits * pps.digits * pow10(Math.max(0, exponent));
  const totalScale = sh.scale + pps.scale + Math.max(0, -exponent);
  if (totalScale <= 0) return numerator * pow10(-totalScale);
  return divRoundHalfEven(numerator, pow10(totalScale));
}

/* ==========================================================================
 * 2. NAV COMPUTATION
 * ======================================================================== */

/** One deployed holding, as the NAV engine needs it. Deliberately a plain
 *  structural type so the engine is testable without the whole SPV store. */
export interface NavHoldingInput {
  deploymentId: string;
  companyId: string;
  /** Decimal string as stored on `spv_deployment.shares`; may be null. */
  shares: string | null;
  /** Cost, for display alongside the mark. NEVER substituted for a mark. */
  costMinor: number;
  currency: string;
  status: string;
}

export type NavStatus = "complete" | "partial_unmarked" | "no_holdings" | "mixed_currency";

export interface NavHoldingLine {
  deploymentId: string;
  companyId: string;
  shares: string | null;
  costMinor: number;
  currency: string;
  /** null when this holding could not be valued. Never a fallback to cost. */
  fairValueMinor: number | null;
  pricePerShare: number | null;
  valuationDate: string | null;
  markBadge: MarkBadge | null;
  markMethod: string | null;
  ageDays: number | null;
  /** Machine-readable reason this line has no fair value. */
  refusal:
    | null
    | "NO_PRICED_ROUND"
    | "SHARE_COUNT_UNKNOWN"
    | "NOT_DEPLOYED";
}

export interface SpvNavResult {
  spvId: string;
  asOfDate: string;
  currency: string;
  status: NavStatus;
  /** NULL whenever `status !== "complete"`. Never 0 for unknown. */
  totalNavMinor: number | null;
  /** Total COST of the holdings, which is always known. Presented next to the
   *  NAV so the reader can see the basis — never as a stand-in for it. */
  totalCostMinor: number | null;
  worstMarkBadge: MarkBadge | null;
  markedHoldings: number;
  unmarkedHoldings: number;
  holdings: NavHoldingLine[];
  thresholds: { staleWarnDays: number; staleExpiredDays: number };
  /** Human-readable statement of WHY there is no number, when there is none. */
  refusalCopy: string | null;
}

/** Ordering used to pick the worst badge across holdings. Higher is worse. */
const BADGE_SEVERITY: Record<string, number> = {
  fresh: 0,
  gp_override: 1,
  stale: 2,
  expired: 3,
};

/**
 * A deployment only contributes to NAV once it is genuinely held. A pending or
 * cancelled deployment is not an asset of the vehicle. This is a DENYLIST of
 * non-holding states rather than an allowlist of holding states on purpose: a
 * future status added to `SPV_DEPLOYMENT_STATUSES` should be reviewed before it
 * silently starts or stops contributing to a reported NAV, and the review is
 * forced by the test that pins this set.
 */
export const NON_HOLDING_DEPLOYMENT_STATES = new Set(["pending", "cancelled", "failed", "rejected"]);

export function isHoldingState(status: string): boolean {
  return !NON_HOLDING_DEPLOYMENT_STATES.has(String(status ?? "").toLowerCase());
}

/**
 * Compute a vehicle's NAV.
 *
 * `markLookup` is injected so the engine can be falsified against constructed
 * marks without a rounds fixture; production passes `effectiveMarkForCompany`.
 */
export function computeSpvNav(args: {
  spvId: string;
  asOfDate: string;
  /** The vehicle's own currency, used when it holds nothing. */
  vehicleCurrency: string;
  holdings: NavHoldingInput[];
  markLookup?: (companyId: string, asOf: string) => DerivedMark | null;
  thresholds?: { staleWarnDays: number; staleExpiredDays: number };
}): SpvNavResult {
  const asOfDate = args.asOfDate.slice(0, 10);
  const lookup =
    args.markLookup ?? ((companyId: string, asOf: string) => effectiveMarkForCompany(companyId, { asOf }));
  const thresholds = args.thresholds ?? (() => {
    const t = getMarkThresholds();
    return { staleWarnDays: t.staleWarnDays, staleExpiredDays: t.staleExpiredDays };
  })();

  const held = args.holdings.filter((h) => isHoldingState(h.status));

  if (held.length === 0) {
    return {
      spvId: args.spvId,
      asOfDate,
      currency: args.vehicleCurrency,
      status: "no_holdings",
      totalNavMinor: null,
      totalCostMinor: null,
      worstMarkBadge: null,
      markedHoldings: 0,
      unmarkedHoldings: 0,
      holdings: [],
      thresholds,
      refusalCopy:
        "No NAV: this vehicle has not deployed capital into a holding yet. A NAV is reported once there is something to value.",
    };
  }

  // NEVER SUM ACROSS CURRENCIES. Detected before any addition happens, so the
  // wrong number is not computed and then discarded — it is never computed.
  const currencies = new Set(held.map((h) => h.currency));
  const mixedCurrency = currencies.size > 1;
  const currency = mixedCurrency ? args.vehicleCurrency : (Array.from(currencies.values())[0] ?? args.vehicleCurrency);

  const lines: NavHoldingLine[] = [];
  let marked = 0;
  let unmarked = 0;
  let worst: MarkBadge | null = null;
  let totalFair = BigInt(0);
  let totalCost = BigInt(0);

  for (const h of held) {
    totalCost += BigInt(Math.trunc(h.costMinor));
    const mark = lookup(h.companyId, asOfDate);
    if (!mark) {
      unmarked += 1;
      lines.push({
        deploymentId: h.deploymentId, companyId: h.companyId, shares: h.shares,
        costMinor: h.costMinor, currency: h.currency, fairValueMinor: null,
        pricePerShare: null, valuationDate: null, markBadge: null, markMethod: null,
        ageDays: null, refusal: "NO_PRICED_ROUND",
      });
      continue;
    }
    const fv = holdingFairValueMinor(h.shares, mark.pricePerShare, h.currency);
    if (fv === null) {
      unmarked += 1;
      lines.push({
        deploymentId: h.deploymentId, companyId: h.companyId, shares: h.shares,
        costMinor: h.costMinor, currency: h.currency, fairValueMinor: null,
        pricePerShare: mark.pricePerShare, valuationDate: mark.valuationDate,
        markBadge: mark.badge, markMethod: mark.method, ageDays: mark.ageDays,
        refusal: "SHARE_COUNT_UNKNOWN",
      });
      continue;
    }
    marked += 1;
    totalFair += fv;
    if (worst === null || (BADGE_SEVERITY[mark.badge] ?? 0) > (BADGE_SEVERITY[worst] ?? 0)) {
      worst = mark.badge;
    }
    lines.push({
      deploymentId: h.deploymentId, companyId: h.companyId, shares: h.shares,
      costMinor: h.costMinor, currency: h.currency, fairValueMinor: Number(fv),
      pricePerShare: mark.pricePerShare, valuationDate: mark.valuationDate,
      markBadge: mark.badge, markMethod: mark.method, ageDays: mark.ageDays,
      refusal: null,
    });
  }

  let status: NavStatus;
  let refusalCopy: string | null;
  if (mixedCurrency) {
    status = "mixed_currency";
    refusalCopy =
      `No single NAV: this vehicle holds positions in ${currencies.size} currencies ` +
      `(${Array.from(currencies.values()).sort().join(", ")}). Amounts in different currencies cannot be added. ` +
      `Each holding is valued below in its own currency.`;
  } else if (unmarked > 0) {
    status = "partial_unmarked";
    refusalCopy =
      `No NAV: ${unmarked} of ${held.length} holdings have no valuation mark, so the total is unknown rather than lower. ` +
      `A holding is never valued at cost as a stand-in for a mark. The marked holdings are shown individually below.`;
  } else {
    status = "complete";
    refusalCopy = null;
  }

  return {
    spvId: args.spvId,
    asOfDate,
    currency,
    status,
    totalNavMinor: status === "complete" ? Number(totalFair) : null,
    totalCostMinor: mixedCurrency ? null : Number(totalCost),
    worstMarkBadge: worst,
    markedHoldings: marked,
    unmarkedHoldings: unmarked,
    holdings: lines,
    thresholds,
    refusalCopy,
  };
}

/* ==========================================================================
 * 3. PER-LP NAV SHARE
 *
 * An LP's share of NAV is an ALLOCATION of a total, so it goes through the
 * money.ts largest-remainder allocator with the pinned comparator
 * (remainder DESC, weight DESC, index ASC). It is never `Math.round(total *
 * ownershipPct)` — that is the per-party rounding this codebase forbids, and it
 * does not conserve cents.
 * ======================================================================== */

export interface LpNavShare {
  investorId: string;
  commitmentMinor: number;
  /** null whenever the vehicle NAV itself is null. Unknown, not zero. */
  navShareMinor: number | null;
}

export function allocateLpNavShares(
  totalNavMinor: number | null,
  register: Array<{ investorId: string; commitmentMinor: number }>,
): LpNavShare[] {
  if (totalNavMinor === null) {
    return register.map((r) => ({
      investorId: r.investorId,
      commitmentMinor: r.commitmentMinor,
      navShareMinor: null,
    }));
  }
  if (register.length === 0) return [];
  const weights = register.map((r) => BigInt(Math.trunc(r.commitmentMinor)));
  const totalWeight = weights.reduce((a, b) => a + b, BigInt(0));
  if (totalWeight <= BigInt(0)) {
    // No committed capital: there is no basis on which to allocate. Unknown,
    // not an even split invented by this function.
    return register.map((r) => ({
      investorId: r.investorId,
      commitmentMinor: r.commitmentMinor,
      navShareMinor: null,
    }));
  }
  const shares = allocateResidualCents(BigInt(Math.trunc(totalNavMinor)), weights);
  return register.map((r, i) => ({
    investorId: r.investorId,
    commitmentMinor: r.commitmentMinor,
    navShareMinor: Number(shares[i]),
  }));
}

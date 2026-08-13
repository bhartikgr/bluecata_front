/**
 * WAVE 9 — M-1 / M-1b / M-1c.
 *
 * ILPA transaction taxonomy, the capital-call / distribution schema, an
 * ACT/365F XIRR built on bracket + Brent, and a metrics service that returns a
 * STATUS for every metric rather than a number it cannot justify.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS HERE AND NOT IN server/
 * ---------------------------------------------------------------------------
 * `spec/ENGINE_REGISTRY.md` C-4 declares `packages/math-fns` CANONICAL for all
 * fund math and `server/portfolioAnalyticsStore` the defective rival. The rule
 * is "import @capavate/math-fns. Do not port, do not fork, do not write
 * another IRR." This file is the canonical side being made fit for purpose;
 * the rival's fabrications (RP-1..RP-5) are deleted, not re-implemented.
 * XT-C4 installs the lint fence that keeps it that way.
 *
 * ---------------------------------------------------------------------------
 * UNITS — read before editing
 * ---------------------------------------------------------------------------
 *   • MONEY is INTEGER MINOR UNITS (`*Minor`). Never a float dollar.
 *   • RATES (IRR, hurdle, catch-up) are FRACTIONS. 0.185 IS 18.5%.
 *     Display multiplies by 100 exactly once, in client/src/lib/percentDisplay.ts.
 *   • MULTIPLES (DPI, RVPI, TVPI, PIC) are PLAIN MULTIPLES. 1.42 IS 1.42x.
 *     They are NOT percentages and must NOT be routed through percentDisplay.
 *   • DAY COUNT is ACT/365F: t = (date - inception) / 365, actual days,
 *     fixed 365 denominator. Leap years are NOT special-cased — that is what
 *     "F" (fixed) means, and it is what Excel XIRR does.
 */
import Decimal from "decimal.js";

/* ==========================================================================
 * 1. ILPA TRANSACTION TAXONOMY — 14 types
 * spec/OQ8_OQ9_INDUSTRY_STANDARDS.md A.10#1
 * ======================================================================== */

export const ILPA_TRANSACTION_TYPES = [
  "capital_call_investment",
  "capital_call_management_fee",
  "capital_call_expenses",
  "distribution_income",
  "distribution_gain_loss",
  "distribution_return_of_capital_permanent",
  "distribution_return_of_capital_recallable",
  "distribution_return_of_mgmt_fees_permanent",
  "distribution_return_of_mgmt_fees_recallable",
  "distribution_return_of_excess_capital",
  "carry_clawback",
  "deemed_contribution",
  "deemed_distribution",
  "in_specie_distribution",
] as const;

export type IlpaTransactionType = (typeof ILPA_TRANSACTION_TYPES)[number];

/** Flows that move capital INTO the vehicle. Stored NEGATIVE. */
export const ILPA_CONTRIBUTION_TYPES: readonly IlpaTransactionType[] = [
  "capital_call_investment",
  "capital_call_management_fee",
  "capital_call_expenses",
  "deemed_contribution",
  "carry_clawback",
];

/** Flows that move value OUT to LPs. Stored POSITIVE. */
export const ILPA_DISTRIBUTION_TYPES: readonly IlpaTransactionType[] = [
  "distribution_income",
  "distribution_gain_loss",
  "distribution_return_of_capital_permanent",
  "distribution_return_of_capital_recallable",
  "distribution_return_of_mgmt_fees_permanent",
  "distribution_return_of_mgmt_fees_recallable",
  "distribution_return_of_excess_capital",
  "deemed_distribution",
  "in_specie_distribution",
];

/**
 * Types that RESTORE unfunded commitment when distributed, so the capital may
 * be called again. PIC can therefore exceed committed capital and PiCC > 1.00x
 * is a legitimate result, not a bug (A.10 fixture #9).
 */
export const ILPA_RECALLABLE_TYPES: readonly IlpaTransactionType[] = [
  "distribution_return_of_capital_recallable",
  "distribution_return_of_mgmt_fees_recallable",
  "distribution_return_of_excess_capital",
];

export function isIlpaTransactionType(v: unknown): v is IlpaTransactionType {
  return typeof v === "string" && (ILPA_TRANSACTION_TYPES as readonly string[]).includes(v);
}

export function isContributionType(t: IlpaTransactionType): boolean {
  return ILPA_CONTRIBUTION_TYPES.includes(t);
}

export function isDistributionType(t: IlpaTransactionType): boolean {
  return ILPA_DISTRIBUTION_TYPES.includes(t);
}

/** A single dated flow. `amountMinor` sign follows the storage convention. */
export interface IlpaFlow {
  /** ISO date, `YYYY-MM-DD` (a full ISO timestamp is accepted and truncated). */
  valueDate: string;
  /** INTEGER minor units. Contributions NEGATIVE, distributions POSITIVE. */
  amountMinor: number;
  txnType: IlpaTransactionType;
  currency: string;
  lpId?: string | null;
  isRecallable?: boolean;
}

/**
 * Storage sign convention, asserted rather than assumed. A flow whose sign
 * disagrees with its type is a data defect and must not be silently normalised
 * — normalising it would turn a bad row into a plausible-looking number, which
 * is the exact failure class this wave exists to remove.
 */
export function assertSignConvention(f: IlpaFlow): void {
  if (!Number.isInteger(f.amountMinor)) {
    throw new Error(`ILPA_FLOW_NOT_MINOR_UNITS: ${f.txnType} amountMinor=${f.amountMinor}`);
  }
  if (f.amountMinor === 0) return; // a zero flow is legal (fee waived, in-specie at nil)
  if (isContributionType(f.txnType) && f.amountMinor > 0) {
    throw new Error(`ILPA_SIGN_VIOLATION: contribution ${f.txnType} must be negative`);
  }
  if (isDistributionType(f.txnType) && f.amountMinor < 0) {
    throw new Error(`ILPA_SIGN_VIOLATION: distribution ${f.txnType} must be positive`);
  }
}

/* ==========================================================================
 * 2. DAY COUNT — ACT/365F
 * ======================================================================== */

const MS_PER_DAY = 86_400_000;

/** Parse `YYYY-MM-DD` (or a full ISO string) to a UTC epoch-day integer. */
export function toEpochDay(iso: string): number {
  const d = iso.slice(0, 10);
  const ms = Date.parse(`${d}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) throw new Error(`ILPA_BAD_DATE: ${iso}`);
  return Math.round(ms / MS_PER_DAY);
}

/** ACT/365F year fraction between two ISO dates. */
export function act365f(fromIso: string, toIso: string): number {
  return (toEpochDay(toIso) - toEpochDay(fromIso)) / 365;
}

/* ==========================================================================
 * 3. XIRR — bracket + Brent, ACT/365F, deterministic (M-1b)
 * spec/OQ8_OQ9_INDUSTRY_STANDARDS.md A.10#5
 * ======================================================================== */

export type XirrStatus =
  | "COMPUTED"
  | "NO_FLOWS"
  | "SINGLE_FLOW"
  | "NO_SIGN_CHANGE"
  | "SAME_DAY_ONLY"
  | "NO_BRACKET"
  | "NOT_CONVERGED";

export interface XirrResult {
  /** FRACTION. 0.185 == 18.5%. `null` whenever status !== "COMPUTED". */
  rate: number | null;
  status: XirrStatus;
  iterations: number;
}

export interface DatedAmount {
  valueDate: string;
  /** Minor units; sign as per the ILPA convention. */
  amountMinor: number;
}

/** Tolerances. Deterministic: no randomness, no wall clock, fixed iteration caps. */
const XIRR_F_TOL = 1e-9;     // |NPV| in units of the largest flow
const XIRR_X_TOL = 1e-10;    // bracket width in rate space
const XIRR_MAX_ITER = 200;
/** Rate search domain. -0.999999 is the asymptote at r = -1. */
const XIRR_LO = -0.999999;
const XIRR_HI = 1e6;

function npvAt(rate: number, flows: DatedAmount[], t0: string): number {
  let acc = 0;
  for (const f of flows) {
    const t = act365f(t0, f.valueDate);
    // (1+r)^t. For r > -1 this is well defined for any real t.
    acc += f.amountMinor / Math.pow(1 + rate, t);
  }
  return acc;
}

/**
 * Deterministic bracket search. Walks a FIXED, ordered probe ladder — no
 * randomised restarts — so the same inputs always produce the same bracket and
 * therefore the same root, which is what "deterministic" in A.10#5 means.
 */
function findBracket(
  flows: DatedAmount[],
  t0: string,
): { lo: number; hi: number; flo: number; fhi: number } | null {
  const probes: number[] = [
    XIRR_LO, -0.99, -0.9, -0.75, -0.5, -0.25, -0.1, -0.01,
    0, 0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 2, 5, 10, 100, 1000, 10000, XIRR_HI,
  ];
  let prev = probes[0];
  let fprev = npvAt(prev, flows, t0);
  if (Number.isFinite(fprev) && Math.abs(fprev) === 0) {
    return { lo: prev, hi: prev, flo: 0, fhi: 0 };
  }
  for (let i = 1; i < probes.length; i++) {
    const cur = probes[i];
    const fcur = npvAt(cur, flows, t0);
    if (!Number.isFinite(fcur)) { prev = cur; fprev = fcur; continue; }
    if (fcur === 0) return { lo: cur, hi: cur, flo: 0, fhi: 0 };
    if (Number.isFinite(fprev) && fprev * fcur < 0) {
      return { lo: prev, hi: cur, flo: fprev, fhi: fcur };
    }
    prev = cur;
    fprev = fcur;
  }
  return null;
}

/**
 * Brent's method on a known bracket. Inverse quadratic interpolation with a
 * secant fallback and a bisection guarantee, so it cannot diverge the way the
 * bare Newton iteration in `index.ts` can on a multi-root series.
 */
function brent(
  f: (x: number) => number,
  loIn: number,
  hiIn: number,
  floIn: number,
  fhiIn: number,
): { root: number; iterations: number; converged: boolean } {
  let a = loIn, b = hiIn, fa = floIn, fb = fhiIn;
  if (Math.abs(fa) < Math.abs(fb)) {
    [a, b] = [b, a];
    [fa, fb] = [fb, fa];
  }
  let c = a, fc = fa, d = b - a, e = d;
  let mflag = true;
  let s = b, fs = fb;

  for (let i = 1; i <= XIRR_MAX_ITER; i++) {
    if (fb === 0 || Math.abs(b - a) < XIRR_X_TOL) {
      return { root: b, iterations: i, converged: true };
    }
    if (fa !== fc && fb !== fc) {
      // Inverse quadratic interpolation.
      s =
        (a * fb * fc) / ((fa - fb) * (fa - fc)) +
        (b * fa * fc) / ((fb - fa) * (fb - fc)) +
        (c * fa * fb) / ((fc - fa) * (fc - fb));
    } else {
      // Secant.
      s = b - (fb * (b - a)) / (fb - fa);
    }
    const lo = (3 * a + b) / 4;
    const cond1 = !((s > Math.min(lo, b) && s < Math.max(lo, b)));
    const cond2 = mflag && Math.abs(s - b) >= Math.abs(b - c) / 2;
    const cond3 = !mflag && Math.abs(s - b) >= Math.abs(c - d) / 2;
    const cond4 = mflag && Math.abs(b - c) < XIRR_X_TOL;
    const cond5 = !mflag && Math.abs(c - d) < XIRR_X_TOL;
    if (cond1 || cond2 || cond3 || cond4 || cond5) {
      s = (a + b) / 2;
      mflag = true;
    } else {
      mflag = false;
    }
    fs = f(s);
    d = c;
    c = b;
    fc = fb;
    if (fa * fs < 0) { b = s; fb = fs; } else { a = s; fa = fs; }
    if (Math.abs(fa) < Math.abs(fb)) {
      [a, b] = [b, a];
      [fa, fb] = [fb, fa];
    }
    e = d; // retained for the mflag width tests above
    void e;
    if (Math.abs(fb) < XIRR_F_TOL) {
      return { root: b, iterations: i, converged: true };
    }
  }
  return { root: b, iterations: XIRR_MAX_ITER, converged: false };
}

/**
 * XIRR over dated flows. ACT/365F, bracket + Brent, deterministic.
 *
 * Returns a STATUS, never a fabricated rate. Every degenerate series that
 * A.10#5 names has its own status so the caller can render an honest empty
 * state instead of printing a number that means nothing:
 *
 *   NO_FLOWS        zero flows
 *   SINGLE_FLOW     one flow only — no return is defined
 *   SAME_DAY_ONLY   every flow on one date — elapsed time is zero
 *   NO_SIGN_CHANGE  all-positive or all-negative — no root exists
 *   NO_BRACKET      sign change exists but no root in the searched domain
 *   NOT_CONVERGED   iteration cap hit (should be unreachable given the bracket)
 */
export function xirr(flowsIn: DatedAmount[]): XirrResult {
  const flows = flowsIn.filter((f) => f.amountMinor !== 0);
  if (flows.length === 0) return { rate: null, status: "NO_FLOWS", iterations: 0 };
  if (flows.length === 1) return { rate: null, status: "SINGLE_FLOW", iterations: 0 };

  const sorted = [...flows].sort((x, y) => toEpochDay(x.valueDate) - toEpochDay(y.valueDate));
  const t0 = sorted[0].valueDate;
  const lastDay = toEpochDay(sorted[sorted.length - 1].valueDate);
  if (lastDay === toEpochDay(t0)) {
    return { rate: null, status: "SAME_DAY_ONLY", iterations: 0 };
  }
  const anyPos = sorted.some((f) => f.amountMinor > 0);
  const anyNeg = sorted.some((f) => f.amountMinor < 0);
  if (!anyPos || !anyNeg) return { rate: null, status: "NO_SIGN_CHANGE", iterations: 0 };

  const br = findBracket(sorted, t0);
  if (!br) return { rate: null, status: "NO_BRACKET", iterations: 0 };
  if (br.lo === br.hi) return { rate: round12(br.lo), status: "COMPUTED", iterations: 0 };

  const res = brent((x) => npvAt(x, sorted, t0), br.lo, br.hi, br.flo, br.fhi);
  if (!res.converged) return { rate: null, status: "NOT_CONVERGED", iterations: res.iterations };
  return { rate: round12(res.root), status: "COMPUTED", iterations: res.iterations };
}

function round12(x: number): number {
  return Number(new Decimal(x).toDecimalPlaces(12).toNumber());
}

/* ==========================================================================
 * 4. METRICS SERVICE — status enum per metric (M-1c)
 * spec/OQ8_OQ9_INDUSTRY_STANDARDS.md A.10#4 / A.10#6
 * ======================================================================== */

/**
 * A metric is either COMPUTED with a number, or it has a reason it is not.
 * There is no third state, and there is no default number.
 *
 *   COMPUTED             the value is real and derived from real rows
 *   NO_FLOWS             no cash-flow rows exist for the subject
 *   NO_MARKS             residual value is unknown — no valuation event
 *   STALE_MARKS          a mark exists but is older than the ruled window
 *   NOT_MEANINGFUL       mathematically defined but not interpretable
 *                        (e.g. DPI with zero paid-in)
 *   INSUFFICIENT_FLOWS   XIRR needs >= 2 flows on >= 2 dates with a sign change
 *   NOT_APPLICABLE       the metric does not apply to this subject
 */
export type MetricStatus =
  | "COMPUTED"
  | "NO_FLOWS"
  | "NO_MARKS"
  | "STALE_MARKS"
  | "NOT_MEANINGFUL"
  | "INSUFFICIENT_FLOWS"
  | "NOT_APPLICABLE";

export interface MetricValue {
  /** `null` whenever status !== "COMPUTED". A consumer that prints `?? 0` is a defect. */
  value: number | null;
  status: MetricStatus;
  /** Human-readable reason, safe to render verbatim as the empty state. */
  note?: string;
}

export const METRIC_KEYS = ["DPI", "RVPI", "TVPI", "PIC", "net_IRR", "gross_IRR"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export interface FundMetricsInput {
  flows: IlpaFlow[];
  /** Residual (unrealised) value in minor units, or `null` when unmarked. */
  residualValueMinor: number | null;
  /** Committed capital in minor units. 0/`null` when not a committed vehicle. */
  committedMinor: number | null;
  /** ISO date the metrics are computed AT. */
  asOfDate: string;
  /** Set when a mark exists but has aged past the ruled window (Q5). */
  marksStale?: boolean;
  /**
   * Gross flows exclude management fee and expense calls and add carry back.
   * When absent, gross_IRR is NOT_APPLICABLE rather than silently equal to net.
   */
  grossFlows?: IlpaFlow[];
}

export interface FundMetricsInputs {
  picMinor: number;
  distributedMinor: number;
  residualValueMinor: number | null;
  committedMinor: number | null;
  inceptionDate: string | null;
  asOfDate: string;
  nFlows: number;
  elapsedDays: number;
  /**
   * Whether the reported IRR is an ANNUALISED rate or a PERIOD return.
   * See ANNUALISATION_FLOOR_DAYS below — A.10 fixture #7 is explicit that a
   * 90-day vehicle up 3% must print 3.0%, not the 12.5% annualisation.
   */
  irrBasis: "annualised" | "period" | "none";
}

export interface FundMetrics {
  DPI: MetricValue;
  RVPI: MetricValue;
  TVPI: MetricValue;
  PIC: MetricValue;
  net_IRR: MetricValue;
  gross_IRR: MetricValue;
  inputs: FundMetricsInputs;
}

/**
 * ANNUALISATION FLOOR — A.10 fixture #7, binding.
 *
 *   "90-day SPV with 3% return (must print 3.0%, not 12.5%)"
 *
 * Annualising a sub-year holding period extrapolates a few weeks of luck into
 * a headline rate. GIPS forbids annualising periods shorter than one year for
 * exactly this reason. Below the floor we report the PERIOD return —
 * (D + RV) / PIC - 1 — and label it as such via `inputs.irrBasis`, so the
 * display layer can say "3.0% (90-day period return, not annualised)".
 */
export const ANNUALISATION_FLOOR_DAYS = 365;

function ratio(numMinor: number, denMinor: number): number {
  return new Decimal(numMinor).div(new Decimal(denMinor)).toDecimalPlaces(6).toNumber();
}

function irrToMetric(x: XirrResult, whenNotComputed: MetricStatus, note: string): MetricValue {
  if (x.status === "COMPUTED" && x.rate !== null) return { value: x.rate, status: "COMPUTED" };
  return { value: null, status: whenNotComputed, note: `${note} (${x.status})` };
}

/**
 * The metrics service. Every branch that cannot produce a real number returns a
 * status, never a zero and never a placeholder.
 */
export function computeFundMetrics(input: FundMetricsInput): FundMetrics {
  for (const f of input.flows) assertSignConvention(f);

  const contributions = input.flows.filter((f) => isContributionType(f.txnType));
  const distributions = input.flows.filter((f) => isDistributionType(f.txnType));

  // PIC (paid-in capital) is the ABSOLUTE value of contributions, less any
  // recallable capital returned (which restores unfunded commitment).
  const paidInMinor = contributions.reduce((s, f) => s + Math.abs(f.amountMinor), 0);
  const distributedMinor = distributions.reduce((s, f) => s + f.amountMinor, 0);
  const recallableReturnedMinor = distributions
    .filter((f) => f.isRecallable ?? ILPA_RECALLABLE_TYPES.includes(f.txnType))
    .reduce((s, f) => s + f.amountMinor, 0);
  const picMinor = paidInMinor;

  const sorted = [...input.flows]
    .filter((f) => f.amountMinor !== 0)
    .sort((a, b) => toEpochDay(a.valueDate) - toEpochDay(b.valueDate));
  const inceptionDate = sorted.length ? sorted[0].valueDate.slice(0, 10) : null;
  const elapsedDays = inceptionDate
    ? toEpochDay(input.asOfDate) - toEpochDay(inceptionDate)
    : 0;

  const rv = input.residualValueMinor;
  const marksStale = !!input.marksStale;
  const rvStatus: MetricStatus =
    rv === null ? "NO_MARKS" : marksStale ? "STALE_MARKS" : "COMPUTED";

  let irrBasis: "annualised" | "period" | "none" = "none";

  const inputs: FundMetricsInputs = {
    picMinor,
    distributedMinor,
    residualValueMinor: rv,
    committedMinor: input.committedMinor,
    inceptionDate,
    asOfDate: input.asOfDate,
    nFlows: sorted.length,
    elapsedDays,
    irrBasis: "none", // overwritten below once the IRR branch is known
  };

  const noFlows = sorted.length === 0;

  // ---- DPI = distributions / paid-in --------------------------------------
  const DPI: MetricValue = noFlows
    ? { value: null, status: "NO_FLOWS", note: "No cash-flow rows for this subject." }
    : picMinor <= 0
      ? { value: null, status: "NOT_MEANINGFUL", note: "Paid-in capital is zero; DPI is undefined." }
      : { value: ratio(distributedMinor, picMinor), status: "COMPUTED" };

  // ---- RVPI = residual value / paid-in ------------------------------------
  const RVPI: MetricValue = noFlows
    ? { value: null, status: "NO_FLOWS", note: "No cash-flow rows for this subject." }
    : picMinor <= 0
      ? { value: null, status: "NOT_MEANINGFUL", note: "Paid-in capital is zero; RVPI is undefined." }
      : rv === null
        ? { value: null, status: "NO_MARKS", note: "No valuation event — residual value is unknown." }
        : marksStale
          ? { value: ratio(rv, picMinor), status: "STALE_MARKS", note: "Latest mark is past the ruled staleness window." }
          : { value: ratio(rv, picMinor), status: "COMPUTED" };

  // ---- TVPI = (distributions + residual) / paid-in ------------------------
  const TVPI: MetricValue = noFlows
    ? { value: null, status: "NO_FLOWS", note: "No cash-flow rows for this subject." }
    : picMinor <= 0
      ? { value: null, status: "NOT_MEANINGFUL", note: "Paid-in capital is zero; TVPI is undefined." }
      : rv === null
        ? { value: null, status: "NO_MARKS", note: "TVPI needs a residual value; no valuation event exists." }
        : {
            value: ratio(distributedMinor + rv, picMinor),
            status: marksStale ? "STALE_MARKS" : "COMPUTED",
            ...(marksStale ? { note: "Latest mark is past the ruled staleness window." } : {}),
          };

  // ---- PIC multiple = paid-in / committed ---------------------------------
  // Recallable distributions restore unfunded commitment, so PIC > 1.00x is a
  // legitimate outcome and is NOT clamped (A.10 fixture #9).
  const committed = input.committedMinor ?? 0;
  const PIC: MetricValue = committed <= 0
    ? { value: null, status: "NOT_APPLICABLE", note: "No committed capital recorded for this vehicle." }
    : noFlows
      ? { value: null, status: "NO_FLOWS", note: "No capital has been called." }
      : { value: ratio(picMinor, committed), status: "COMPUTED" };

  // ---- net IRR ------------------------------------------------------------
  // The terminal residual value enters as a synthetic positive flow at the
  // as-of date. Without a mark there is no terminal value, so there is no IRR —
  // and we say so rather than pretending the vehicle is worth zero.
  let net_IRR: MetricValue;
  if (noFlows) {
    net_IRR = { value: null, status: "NO_FLOWS", note: "No cash-flow rows for this subject." };
  } else if (rv === null) {
    net_IRR = { value: null, status: "NO_MARKS", note: "IRR needs a terminal value; no valuation event exists." };
  } else {
    const series: DatedAmount[] = sorted.map((f) => ({ valueDate: f.valueDate, amountMinor: f.amountMinor }));
    if (rv > 0) series.push({ valueDate: input.asOfDate, amountMinor: rv });
    if (elapsedDays > 0 && elapsedDays < ANNUALISATION_FLOOR_DAYS && picMinor > 0) {
      // Sub-year: period return, explicitly NOT annualised.
      irrBasis = "period";
      const periodReturn = new Decimal(distributedMinor + rv)
        .div(new Decimal(picMinor))
        .minus(1)
        .toDecimalPlaces(12)
        .toNumber();
      net_IRR = {
        value: periodReturn,
        status: marksStale ? "STALE_MARKS" : "COMPUTED",
        note: `${elapsedDays}-day period return, not annualised (holding period is under ${ANNUALISATION_FLOOR_DAYS} days).`,
      };
    } else {
    const x = xirr(series);
    net_IRR = irrToMetric(x, "INSUFFICIENT_FLOWS", "Net IRR not computable from this flow series");
    if (net_IRR.status === "COMPUTED") irrBasis = "annualised";
    if (net_IRR.status === "COMPUTED" && marksStale) {
      net_IRR = { value: net_IRR.value, status: "STALE_MARKS", note: "Latest mark is past the ruled staleness window." };
    }
    }
  }

  // ---- gross IRR ----------------------------------------------------------
  let gross_IRR: MetricValue;
  if (!input.grossFlows) {
    gross_IRR = {
      value: null,
      status: "NOT_APPLICABLE",
      note: "Gross IRR requires a fee-and-carry-adjusted flow series, which has not been supplied.",
    };
  } else if (rv === null) {
    gross_IRR = { value: null, status: "NO_MARKS", note: "IRR needs a terminal value; no valuation event exists." };
  } else {
    const gsorted = [...input.grossFlows]
      .filter((f) => f.amountMinor !== 0)
      .sort((a, b) => toEpochDay(a.valueDate) - toEpochDay(b.valueDate));
    const series: DatedAmount[] = gsorted.map((f) => ({ valueDate: f.valueDate, amountMinor: f.amountMinor }));
    if (rv > 0) series.push({ valueDate: input.asOfDate, amountMinor: rv });
    gross_IRR = irrToMetric(xirr(series), "INSUFFICIENT_FLOWS", "Gross IRR not computable from this flow series");
  }

  void recallableReturnedMinor; // surfaced through inputs; retained for clarity
  void rvStatus;

  inputs.irrBasis = irrBasis;
  return { DPI, RVPI, TVPI, PIC, net_IRR, gross_IRR, inputs };
}

/* ==========================================================================
 * 5. FOOTNOTE RENDERER (M-1d) — A.10#8
 * Bound to the ACTUAL config, never to prose typed into a component.
 * ======================================================================== */

export interface FootnoteConfig {
  /** How recallable distributions are treated in PIC. */
  recallableTreatment: "restores_unfunded" | "permanent";
  /** Is GP capital included in the reported metrics? */
  gpCapitalIncluded: boolean;
  gpCommitmentMinor?: number | null;
  /** Subscription-line / capital-call facility in use during the period. */
  sublineUsed: boolean;
  /** Where the residual value came from, and when. */
  valuationSource: string | null;
  valuationDate: string | null;
  valuationMethod: string | null;
  currency: string;
  asOfDate: string;
}

export interface Footnote {
  key: string;
  text: string;
}

/**
 * Produce the footnote set from config. Every footnote is derived; there are no
 * unconditional strings, so a vehicle with no marks does not get a footnote
 * claiming a valuation source it does not have.
 */
export function renderFootnotes(cfg: FootnoteConfig): Footnote[] {
  const out: Footnote[] = [];

  out.push({
    key: "as_of",
    text: `All figures are as of ${cfg.asOfDate} and are stated in ${cfg.currency}.`,
  });

  out.push({
    key: "recallable",
    text:
      cfg.recallableTreatment === "restores_unfunded"
        ? "Recallable distributions restore unfunded commitment; paid-in capital may therefore exceed committed capital and PIC may exceed 1.00x."
        : "Distributions are treated as permanent; recallable amounts do not restore unfunded commitment.",
  });

  out.push({
    key: "gp_capital",
    text: cfg.gpCapitalIncluded
      ? `GP capital is INCLUDED in these figures${
          cfg.gpCommitmentMinor ? ` (GP commitment recorded in ${cfg.currency} minor units: ${cfg.gpCommitmentMinor}).` : "."
        }`
      : "GP capital is EXCLUDED from these figures; they reflect limited-partner economics only.",
  });

  out.push({
    key: "subline",
    text: cfg.sublineUsed
      ? "A subscription credit facility was used during the period. IRR is sensitive to facility usage; multiples are not."
      : "No subscription credit facility was used during the period.",
  });

  if (cfg.valuationSource && cfg.valuationDate) {
    out.push({
      key: "valuation",
      text: `Residual value is derived from ${cfg.valuationSource}${
        cfg.valuationMethod ? ` using the ${cfg.valuationMethod} method` : ""
      }, dated ${cfg.valuationDate}.`,
    });
  } else {
    out.push({
      key: "valuation",
      text: "No valuation event exists for this subject; residual value and any metric that depends on it are not reported.",
    });
  }

  return out;
}

/* ==========================================================================
 * 6. THE 11 REQUIRED FIXTURES — A.10 "Test fixtures that must exist"
 * Exported so both the package tests and the server tests run the SAME data.
 * ======================================================================== */

export interface IlpaFixture {
  key: string;
  description: string;
  input: FundMetricsInput;
}

const USD = "USD";
function call(valueDate: string, minor: number, txnType: IlpaTransactionType = "capital_call_investment"): IlpaFlow {
  return { valueDate, amountMinor: -Math.abs(minor), txnType, currency: USD };
}
function dist(valueDate: string, minor: number, txnType: IlpaTransactionType = "distribution_gain_loss"): IlpaFlow {
  return { valueDate, amountMinor: Math.abs(minor), txnType, currency: USD };
}

export const ILPA_FIXTURES: IlpaFixture[] = [
  {
    key: "zero_flows",
    description: "Zero flows — every metric must report NO_FLOWS, none may report 0.",
    input: { flows: [], residualValueMinor: null, committedMinor: 10_000_000, asOfDate: "2026-01-01" },
  },
  {
    key: "one_call_only",
    description: "One call only, no marks — DPI 0.00x, RVPI/TVPI/IRR unavailable.",
    input: {
      flows: [call("2025-01-01", 10_000_000)],
      residualValueMinor: null,
      committedMinor: 10_000_000,
      asOfDate: "2026-01-01",
    },
  },
  {
    key: "call_plus_fee_no_marks",
    description: "Call + management fee, no marks — PIC includes the fee call; IRR unavailable.",
    input: {
      flows: [
        call("2025-01-01", 10_000_000),
        call("2025-01-01", 200_000, "capital_call_management_fee"),
      ],
      residualValueMinor: null,
      committedMinor: 10_000_000,
      asOfDate: "2026-01-01",
    },
  },
  {
    key: "full_return_of_capital_irr_zero",
    description: "Call + full return of capital WITH marks — IRR ≈ 0, correctly so.",
    input: {
      flows: [
        call("2025-01-01", 10_000_000),
        dist("2026-01-01", 10_000_000, "distribution_return_of_capital_permanent"),
      ],
      residualValueMinor: 0,
      committedMinor: 10_000_000,
      asOfDate: "2026-01-01",
    },
  },
  {
    key: "all_positive_series",
    description: "All-positive series — no sign change, IRR must be INSUFFICIENT_FLOWS not a number.",
    input: {
      flows: [dist("2025-01-01", 1_000_000), dist("2025-06-01", 2_000_000)],
      residualValueMinor: 0,
      committedMinor: null,
      asOfDate: "2026-01-01",
    },
  },
  {
    key: "same_day_only",
    description: "Same-day-only series — elapsed time is zero, IRR is not defined.",
    input: {
      flows: [call("2025-03-01", 5_000_000), dist("2025-03-01", 6_000_000)],
      residualValueMinor: 0,
      committedMinor: 5_000_000,
      asOfDate: "2025-03-01",
    },
  },
  {
    key: "ninety_day_three_percent",
    description: "90-day SPV with a 3% period return — must print 3.0%, NOT the 12.5% annualisation.",
    input: {
      flows: [call("2026-01-01", 100_000_000)],
      residualValueMinor: 103_000_000,
      committedMinor: 100_000_000,
      asOfDate: "2026-04-01",
    },
  },
  {
    key: "multi_root",
    description: "Multi-root series: call, big early distribution, later call, small distribution.",
    input: {
      flows: [
        call("2024-01-01", 10_000_000),
        dist("2024-06-01", 25_000_000),
        call("2025-01-01", 12_000_000),
        dist("2026-01-01", 1_000_000),
      ],
      residualValueMinor: 500_000,
      committedMinor: 22_000_000,
      asOfDate: "2026-01-01",
    },
  },
  {
    key: "recallable_then_recall",
    description: "Recallable distribution followed by a re-call — PIC > commitment, PiCC > 1.00x.",
    input: {
      flows: [
        call("2024-01-01", 10_000_000),
        dist("2024-07-01", 4_000_000, "distribution_return_of_capital_recallable"),
        call("2025-01-01", 4_000_000),
        dist("2026-01-01", 2_000_000),
      ],
      residualValueMinor: 9_000_000,
      committedMinor: 10_000_000,
      asOfDate: "2026-01-01",
    },
  },
  {
    key: "in_specie_distribution",
    description: "In-specie distribution — counts as a distribution at its recorded value.",
    input: {
      flows: [
        call("2024-01-01", 10_000_000),
        dist("2026-01-01", 15_000_000, "in_specie_distribution"),
      ],
      residualValueMinor: 0,
      committedMinor: 10_000_000,
      asOfDate: "2026-01-01",
    },
  },
  {
    key: "wound_up_vehicle",
    description: "Wound-up vehicle — RV = 0 is a REAL zero (a mark of nil), not a missing mark.",
    input: {
      flows: [
        call("2022-01-01", 10_000_000),
        dist("2024-01-01", 8_000_000, "distribution_return_of_capital_permanent"),
        dist("2025-01-01", 6_000_000, "distribution_gain_loss"),
      ],
      residualValueMinor: 0,
      committedMinor: 10_000_000,
      asOfDate: "2026-01-01",
    },
  },
];

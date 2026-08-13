/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 3 — K-1 COMPUTATION (pure).
 *
 * A Schedule K-1 is a TAX FILING. It is the single artifact in this wave where
 * a made-up number is not an embarrassment but a filed misstatement, so the
 * governing rule here is stricter than anywhere else in the platform:
 *
 *   ANY FIGURE THIS ENGINE CANNOT DERIVE FROM REAL ROWS IS `null`, CARRIES A
 *   NAMED REFUSAL, AND IS RENDERED AS A REFUSAL. NEVER 0. NEVER ESTIMATED.
 *
 * A zero on a K-1 asserts "this LP contributed nothing / received nothing /
 * was allocated nothing", which is a factual claim. Absence of data is not
 * that claim. Every nullable box below is nullable for that reason, and
 * `refusals` is non-empty exactly when some box is null — a blank is always
 * explained.
 *
 * ── WHAT IS DERIVED, AND FROM WHAT ────────────────────────────────────────
 *   contributions       <- confirmed OFFLINE FUNDS RECEIPTS dated inside the
 *                          tax year (`spv.terms._fundsConfirmations`). A
 *                          commitment is a promise, not a contribution, so an
 *                          LP with a commitment and no confirmed receipt gets
 *                          `null` + NO_FUNDS_CONFIRMATION — never their
 *                          commitment amount dressed up as cash.
 *   distributions       <- the LP's `netMinor` across `spv_distribution` rows
 *                          dated inside the year. Always derivable (possibly 0
 *                          distributions, which IS a real zero: the register
 *                          existed and received nothing).
 *   carry allocated     <- the LP's `carryMinor` over the same rows, so a
 *                          side-letter LP's K-1 shows the carry they actually
 *                          bore and not the fund default.
 *   allocated income    <- the LP's share of each event's REALIZED PROFIT (the
 *                          `carry_base` tier), allocated by that event's own
 *                          per-LP gross weights with `allocateResidualCents`,
 *                          so the LPs' allocated income sums EXACTLY to the
 *                          vehicle's realized profit for the year.
 *   beginning capital   <- the same roll-forward applied to every year BEFORE
 *                          the tax year. Unknown if contributions are unknown.
 *   ending capital      <- beginning + contributions + income − distributions.
 *                          Unknown if ANY input is unknown; a partial sum is a
 *                          wrong number, not a partial number.
 *
 * ── MONEY ─────────────────────────────────────────────────────────────────
 * Integer minor units throughout. Allocations go through
 * `server/lib/money.ts`. Currencies are NEVER summed across: a vehicle whose
 * distributions span currencies refuses the whole statement
 * (MIXED_CURRENCY) rather than adding minor units that mean different things.
 * Ownership is a FRACTION (0.25 = 25%), never a percent.
 */
import { allocateResidualCents } from "./money";

export type K1RefusalCode =
  | "NO_FUNDS_CONFIRMATION"
  | "DEPENDS_ON_UNKNOWN_CONTRIBUTIONS"
  | "MIXED_CURRENCY"
  | "NO_COMMITTED_REGISTER"
  | "NOT_A_MEMBER_IN_YEAR"
  | "UNKNOWN_REALIZED_PROFIT";

export interface K1Refusal {
  field: string;
  code: K1RefusalCode;
  /** Server-authored, rendered verbatim. The UI never invents tax copy. */
  copy: string;
}

/** One recorded distribution, as the K-1 engine needs to see it. */
export interface K1DistributionInput {
  id: string;
  /** ISO timestamp; the tax year is taken from its first four characters. */
  createdAt: string;
  currency: string;
  grossProceedsMinor: number;
  /** The event's realized profit — the `carry_base` waterfall tier. */
  realizedProfitMinor: number | null;
  allocations: Array<{ investorId: string; grossMinor: number; carryMinor: number; netMinor: number }>;
}

/** One confirmed offline receipt of cash from an LP. */
export interface K1ContributionInput {
  investorId: string;
  /** ISO timestamp of the confirmation. */
  confirmedAt: string;
  receivedMinor: number;
}

export interface K1ComputeArgs {
  spvId: string;
  taxYear: number;
  vehicleCurrency: string;
  /** The committed register — commitment weights for the ownership fraction. */
  register: ReadonlyArray<{ investorId: string; commitmentMinor: number }>;
  distributions: ReadonlyArray<K1DistributionInput>;
  contributions: ReadonlyArray<K1ContributionInput>;
}

export interface K1Statement {
  investorId: string;
  taxYear: number;
  currency: string;
  beginningCapitalMinor: number | null;
  contributionsMinor: number | null;
  distributionsMinor: number | null;
  allocatedIncomeMinor: number | null;
  carryAllocatedMinor: number | null;
  endingCapitalMinor: number | null;
  /** A FRACTION in [0,1]. Null when the register has no weight to divide. */
  ownershipFraction: number | null;
  refusals: K1Refusal[];
  /** Distribution ids the figures were derived from. */
  sourceIds: string[];
}

const COPY: Record<K1RefusalCode, string> = {
  NO_FUNDS_CONFIRMATION:
    "No confirmed capital receipt on record for this partner. A commitment is not a contribution, so this box is left blank rather than filled with the committed amount.",
  DEPENDS_ON_UNKNOWN_CONTRIBUTIONS:
    "Cannot be computed because contributed capital is unknown. A partial roll-forward would be a wrong figure, not a partial one.",
  MIXED_CURRENCY:
    "This vehicle recorded distributions in more than one currency. Amounts in different currencies cannot be added, so no statement is produced.",
  NO_COMMITTED_REGISTER:
    "This vehicle has no committed capital on the register, so no ownership fraction can be derived.",
  NOT_A_MEMBER_IN_YEAR:
    "This partner had no committed position in this vehicle during the tax year.",
  UNKNOWN_REALIZED_PROFIT:
    "At least one recorded distribution does not state the realized profit it was computed from, so the allocated share of income cannot be derived. Left blank rather than estimated.",
};

function refusal(field: string, code: K1RefusalCode): K1Refusal {
  return { field, code, copy: COPY[code] };
}

function yearOf(iso: string): number {
  return Number(String(iso).slice(0, 4));
}

/**
 * Allocate one event's realized profit across the LPs who shared in it, using
 * that event's OWN per-LP gross weights. Exact: the parts sum to the profit.
 */
function allocateProfit(
  profitMinor: number,
  allocations: K1DistributionInput["allocations"],
): Map<string, number> {
  const out = new Map<string, number>();
  const weights = allocations.map((a) => BigInt(Math.trunc(a.grossMinor)));
  const total = weights.reduce((a, w) => a + w, BigInt(0));
  if (total === BigInt(0) || profitMinor === 0) {
    for (const a of allocations) out.set(a.investorId, 0);
    return out;
  }
  // A loss is legitimately negative; allocate its magnitude and re-sign, so the
  // largest-remainder comparator sees the non-negative total it is defined for.
  const negative = profitMinor < 0;
  const shares = allocateResidualCents(BigInt(Math.abs(Math.trunc(profitMinor))), weights);
  allocations.forEach((a, i) => {
    const v = Number(shares[i]);
    out.set(a.investorId, negative ? -v : v);
  });
  return out;
}

/** Every K-1 for one vehicle and one tax year. */
export function computeK1Statements(args: K1ComputeArgs): K1Statement[] {
  const { taxYear, vehicleCurrency, register, distributions, contributions } = args;

  /* NEVER SUM ACROSS CURRENCIES. Checked over the whole history, not just the
     tax year: a roll-forward reaches back through prior years. */
  const currencies = new Set<string>([vehicleCurrency, ...distributions.map((d) => d.currency)]);
  if (currencies.size > 1) {
    return register.map((r) => ({
      investorId: r.investorId,
      taxYear,
      currency: vehicleCurrency,
      beginningCapitalMinor: null,
      contributionsMinor: null,
      distributionsMinor: null,
      allocatedIncomeMinor: null,
      carryAllocatedMinor: null,
      endingCapitalMinor: null,
      ownershipFraction: null,
      refusals: [
        refusal("beginningCapitalMinor", "MIXED_CURRENCY"),
        refusal("contributionsMinor", "MIXED_CURRENCY"),
        refusal("distributionsMinor", "MIXED_CURRENCY"),
        refusal("allocatedIncomeMinor", "MIXED_CURRENCY"),
        refusal("carryAllocatedMinor", "MIXED_CURRENCY"),
        refusal("endingCapitalMinor", "MIXED_CURRENCY"),
      ],
      sourceIds: [],
    }));
  }

  const totalCommitment = register.reduce((a, r) => a + Math.trunc(r.commitmentMinor), 0);

  // Pre-allocate every event's profit once, not once per LP.
  const profitByDist = new Map<string, Map<string, number>>();
  for (const d of distributions) {
    if (d.realizedProfitMinor === null) continue;
    profitByDist.set(d.id, allocateProfit(d.realizedProfitMinor, d.allocations));
  }

  return register.map((r) => {
    const refusals: K1Refusal[] = [];
    const sourceIds: string[] = [];

    /* CONTRIBUTIONS — confirmed cash only. */
    const myConfirmations = contributions.filter((c) => c.investorId === r.investorId);
    const inYear = myConfirmations.filter((c) => yearOf(c.confirmedAt) === taxYear);
    const priorYears = myConfirmations.filter((c) => yearOf(c.confirmedAt) < taxYear);
    let contributionsMinor: number | null;
    if (myConfirmations.length === 0) {
      contributionsMinor = null;
      refusals.push(refusal("contributionsMinor", "NO_FUNDS_CONFIRMATION"));
    } else {
      contributionsMinor = inYear.reduce((a, c) => a + Math.trunc(c.receivedMinor), 0);
    }

    /* DISTRIBUTIONS, CARRY, ALLOCATED INCOME — from real recorded events. */
    let distributionsMinor = 0;
    let carryAllocatedMinor = 0;
    let allocatedIncomeMinor = 0;
    let priorDistributions = 0;
    let priorIncome = 0;
    let anyIncomeUnknown = false;

    for (const d of distributions) {
      const mine = d.allocations.find((a) => a.investorId === r.investorId);
      if (!mine) continue;
      const y = yearOf(d.createdAt);
      const profitShare = profitByDist.get(d.id)?.get(r.investorId);
      if (d.realizedProfitMinor === null) anyIncomeUnknown = true;
      if (y === taxYear) {
        distributionsMinor += Math.trunc(mine.netMinor);
        carryAllocatedMinor += Math.trunc(mine.carryMinor);
        allocatedIncomeMinor += profitShare ?? 0;
        sourceIds.push(d.id);
      } else if (y < taxYear) {
        priorDistributions += Math.trunc(mine.netMinor);
        priorIncome += profitShare ?? 0;
      }
    }

    /* BEGINNING CAPITAL — the roll-forward of everything before the year. It is
       unknown exactly when the cash side is unknown; nothing is assumed to be
       zero to keep the arithmetic tidy. */
    let beginningCapitalMinor: number | null;
    if (contributionsMinor === null) {
      beginningCapitalMinor = null;
      refusals.push(refusal("beginningCapitalMinor", "DEPENDS_ON_UNKNOWN_CONTRIBUTIONS"));
    } else {
      const priorContrib = priorYears.reduce((a, c) => a + Math.trunc(c.receivedMinor), 0);
      beginningCapitalMinor = priorContrib + priorIncome - priorDistributions;
    }

    /* An event that does not state its realized profit poisons the income box
       and everything downstream of it. Named, not silently zeroed. */
    if (anyIncomeUnknown) {
      refusals.push(refusal("allocatedIncomeMinor", "UNKNOWN_REALIZED_PROFIT"));
    }

    let endingCapitalMinor: number | null;
    if (beginningCapitalMinor === null) {
      endingCapitalMinor = null;
      refusals.push(refusal("endingCapitalMinor", "DEPENDS_ON_UNKNOWN_CONTRIBUTIONS"));
    } else if (anyIncomeUnknown) {
      endingCapitalMinor = null;
      refusals.push(refusal("endingCapitalMinor", "UNKNOWN_REALIZED_PROFIT"));
    } else {
      endingCapitalMinor = beginningCapitalMinor + contributionsMinor! + allocatedIncomeMinor - distributionsMinor;
    }

    let ownershipFraction: number | null;
    if (totalCommitment <= 0) {
      ownershipFraction = null;
      refusals.push(refusal("ownershipFraction", "NO_COMMITTED_REGISTER"));
    } else {
      // A FRACTION. 0.25 means 25%. Nothing here multiplies by 100.
      ownershipFraction = Math.trunc(r.commitmentMinor) / totalCommitment;
    }

    return {
      investorId: r.investorId,
      taxYear,
      currency: vehicleCurrency,
      beginningCapitalMinor,
      contributionsMinor,
      distributionsMinor,
      allocatedIncomeMinor: anyIncomeUnknown ? null : allocatedIncomeMinor,
      carryAllocatedMinor,
      endingCapitalMinor,
      ownershipFraction,
      refusals,
      sourceIds,
    };
  });
}

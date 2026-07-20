/* W-FIX1c (2026-07-19) — warrant EXERCISE lifecycle (A5).
 *
 * Warrants are modeled as priced-via-`strikePrice` securities (the strike is the
 * effective price-per-share), so they count in fully-diluted at GRANT. What was
 * MISSING is the exercise event that actually ISSUES shares:
 *   - cash exercise    : holder pays `strike × qty`  → receives `qty` shares
 *   - cashless / net   : holder pays nothing         → receives the NET shares
 *                        `floor(qty × (FMV − strike) / FMV)` (min 0)
 *   - expiry           : unexercised warrants expire → NO shares issued
 *
 * All share issuance flows through the SACRED `commitFunded` money path — this
 * module only CALLS it; it never writes the ledger directly and adds no parallel
 * money path. The exercise commit IS the durable record (no new store): an
 * exercised warrant is the presence of its exercise commit in the ledger.
 *
 * SACRED files only CALLED here, never modified:
 *   - commitFunded (server/captableCommitStore.ts)
 * READ-only:
 *   - getRoundById (server/roundsStore.ts)
 */
import Decimal from "decimal.js";
import { commitFunded } from "../captableCommitStore";
import { getRoundById } from "../roundsStore";

export type ExerciseMode = "cash" | "cashless" | "expire";

export interface ExerciseInput {
  companyId: string;
  /** The warrant round the grant lives on (its strike is the effective pps). */
  roundId: string;
  investorId: string;
  /** Number of warrants being exercised (whole shares). */
  quantity: string | number;
  mode: ExerciseMode;
  /** Fair market value per share — REQUIRED for cashless (current round pps). */
  fmv?: string | number | null;
  /** Override the round's strike (else resolved from the round). */
  strikePrice?: string | number | null;
  /** Reconciliation key for this issuance (unique per exercise). */
  invitationId?: string;
  currency?: string;
}

export interface ExerciseComputation {
  /** Shares that WILL be issued (0 for expiry / out-of-the-money cashless). */
  sharesIssued: string;
  /** Cash the holder pays out-of-pocket ("0" for cashless / expiry). */
  cashPaid: string;
  /** Ledger reconciliation basis price-per-share (strike, or round pps). */
  ppsBasis: string;
  /** Ledger `amount` = sharesIssued × ppsBasis (the reconcile basis). */
  ledgerAmount: string;
}

const asDecimal = (v: unknown): Decimal | null => {
  try {
    const s = String(v ?? "").trim();
    if (!s) return null;
    const d = new Decimal(s);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
};

/** Net shares for a cashless (net) exercise: floor(qty × (FMV − strike) / FMV). */
export function computeNetShares(quantity: unknown, fmv: unknown, strike: unknown): string {
  const q = asDecimal(quantity);
  const f = asDecimal(fmv);
  const k = asDecimal(strike);
  if (!q || !f || !k) return "0";
  if (q.lte(0) || f.lte(0)) return "0";
  // Out-of-the-money (or at-the-money): a cashless exercise yields nothing.
  if (f.lte(k)) return "0";
  const net = q.times(f.minus(k)).dividedBy(f).floor();
  return net.lt(0) ? "0" : net.toFixed(0);
}

/**
 * Pure computation of an exercise (no side effects). Determines shares issued,
 * cash paid, and the ledger reconcile basis. `getRoundById` is a READ.
 */
export function computeExercise(input: ExerciseInput): ExerciseComputation {
  const round = getRoundById(input.roundId) as (Record<string, unknown> & { pricePerShare?: number | null }) | undefined;
  const strike =
    asDecimal(input.strikePrice) ??
    asDecimal(round?.strikePrice) ??
    // fall back to the round pps if a strike wasn't recorded separately
    asDecimal(round?.pricePerShare) ??
    new Decimal(0);
  // Reconcile basis: warrant rounds carry no pps (reconcile is format-only), but
  // if a pps IS present we honor it so `amount = shares × pps` always matches.
  const roundPps = asDecimal(round?.pricePerShare);
  const ppsBasis = roundPps && roundPps.gt(0) ? roundPps : strike;

  if (input.mode === "expire") {
    return { sharesIssued: "0", cashPaid: "0", ppsBasis: ppsBasis.toFixed(), ledgerAmount: "0" };
  }

  let sharesIssued: string;
  let cashPaid: string;
  if (input.mode === "cashless") {
    sharesIssued = computeNetShares(input.quantity, input.fmv, strike);
    cashPaid = "0";
  } else {
    const q = asDecimal(input.quantity);
    sharesIssued = q && q.gt(0) ? q.floor().toFixed(0) : "0";
    cashPaid = q && q.gt(0) ? q.floor().times(strike).toFixed() : "0";
  }

  const ledgerAmount = new Decimal(sharesIssued).times(ppsBasis).toFixed();
  return { sharesIssued, cashPaid, ppsBasis: ppsBasis.toFixed(), ledgerAmount };
}

/**
 * Deterministic idempotency key for an exercise when the caller does not supply
 * one. Derived from the grant identity (roundId + investorId), the mode, and the
 * floored quantity — so a retry of the SAME exercise request maps to the SAME
 * `commitFunded` DB id (`ccm_<sha256(invitationId)>`), whose unique constraint
 * rejects the duplicate insert. This makes retries idempotent: no double-issue.
 * (Previously a `Date.now()` suffix produced a fresh id on every retry.)
 */
export function deterministicExerciseKey(input: ExerciseInput): string {
  const q = asDecimal(input.quantity);
  const qty = q && q.gt(0) ? q.floor().toFixed(0) : "0";
  return `wex_${input.roundId}_${input.investorId}_${input.mode}_${qty}`;
}

export type ExerciseResult =
  | { ok: true; mode: ExerciseMode; sharesIssued: string; cashPaid: string; expired: boolean; entry?: unknown }
  | { ok: false; error: string };

/**
 * Execute a warrant exercise. Cash + cashless issue shares through the SACRED
 * `commitFunded` path; expiry issues nothing. Fails fast on invalid input and
 * surfaces the sacred ledger's own error verbatim (never silently swallowed).
 */
export function exerciseWarrant(input: ExerciseInput): ExerciseResult {
  const round = getRoundById(input.roundId);
  if (!round) return { ok: false, error: "round_not_found" };

  const comp = computeExercise(input);

  if (input.mode === "expire") {
    return { ok: true, mode: "expire", sharesIssued: "0", cashPaid: "0", expired: true };
  }

  if (input.mode === "cashless") {
    const fmv = asDecimal(input.fmv);
    if (!fmv || fmv.lte(0)) return { ok: false, error: "fmv_required_for_cashless" };
    if (comp.sharesIssued === "0") {
      // Out-of-the-money cashless: nothing to issue, but not an error.
      return { ok: true, mode: "cashless", sharesIssued: "0", cashPaid: "0", expired: false };
    }
  } else {
    const q = asDecimal(input.quantity);
    if (!q || q.lte(0)) return { ok: false, error: "invalid_quantity" };
  }

  const invitationId = input.invitationId ?? deterministicExerciseKey(input);
  const res = commitFunded({
    invitationId,
    roundId: input.roundId,
    companyId: input.companyId,
    investorId: input.investorId,
    amount: comp.ledgerAmount,
    currency: input.currency ?? "USD",
    shares: comp.sharesIssued,
  });

  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    mode: input.mode,
    sharesIssued: comp.sharesIssued,
    cashPaid: comp.cashPaid,
    expired: false,
    entry: res.entry,
  };
}

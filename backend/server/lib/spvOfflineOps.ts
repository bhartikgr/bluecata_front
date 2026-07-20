/* W-FIX1e (2026-07-19) — SPV offline-first core math (SPV-CORE-1/2/3).
 *
 * Pure, DB-independent helpers for the three offline GP actions. They compute;
 * they never move money and never block. The SACRED `commitFunded` money path
 * (server/captableCommitStore.ts) is CALLED at the route layer for the actual
 * cap-table seat — never here. All amounts are integer MINOR units (cents).
 *
 *   SPV-CORE-1  computeFundsConfirmation  — expected vs received + reference;
 *               a mismatch is an EDUCATIONAL flag, never a block.
 *   SPV-CORE-2  computeDistributionSplit  — return-of-capital + carry, with an
 *               OPTIONAL preferred-return / GP-catch-up tier that only engages
 *               when a hurdle is set (else the simple waterfall is unchanged).
 *               computeCapitalAccounts    — per-LP contributed/confirmed/distributed.
 *   SPV-CORE-3  computeCloseSummary       — confirmed vs target; under-target
 *               NEVER blocks (suggests set-target = raised instead).
 *               canReopenClose            — rolling closes within a window.
 */

export type FundsConfirmationStatus = "matched" | "short" | "over";

export interface FundsConfirmation {
  status: FundsConfirmationStatus;
  expectedMinor: number;
  receivedMinor: number;
  deltaMinor: number;
  /** True when received ≠ expected. Surfaces an educational flag; never blocks. */
  mismatch: boolean;
  reference: string | null;
  /** Plain-language note for the GP. */
  note: string;
}

const asMinor = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** SPV-CORE-1 — reconcile an offline LP wire. Never throws, never blocks. */
export function computeFundsConfirmation(
  expected: unknown,
  received: unknown,
  reference?: unknown,
): FundsConfirmation {
  const expectedMinor = Math.max(0, asMinor(expected));
  const receivedMinor = Math.max(0, asMinor(received));
  const deltaMinor = receivedMinor - expectedMinor;
  const ref = typeof reference === "string" && reference.trim() ? reference.trim() : null;
  let status: FundsConfirmationStatus = "matched";
  if (deltaMinor < 0) status = "short";
  else if (deltaMinor > 0) status = "over";
  const mismatch = status !== "matched";
  const note =
    status === "matched"
      ? "Received amount matches the expected commitment."
      : status === "short"
        ? "Received less than expected — recorded the received amount and flagged the shortfall for your follow-up. This does not change the LP's committed seat and does not block the SPV."
        : "Received more than expected — recorded the received amount and flagged the overage for your follow-up. This does not change the LP's committed seat and does not block the SPV.";
  return { status, expectedMinor, receivedMinor, deltaMinor, mismatch, reference: ref, note };
}

export interface DistributionTier {
  tier: string;
  amountMinor: number;
}
export interface DistributionSplit {
  tiers: DistributionTier[];
  /** Total paid to LPs across all tiers (return of capital + profit share). */
  lpTotalMinor: number;
  /** Total to the GP (catch-up + carry). */
  gpTotalMinor: number;
  /** True when the optional preferred-return / catch-up tiers engaged. */
  tiered: boolean;
}

export interface DistributionInput {
  grossProceedsMinor: number;
  /** LP capital to return before any profit split (return-of-capital basis). */
  contributedMinor: number;
  /** GP carry on profit, as a fraction 0..1. */
  carryPct: number;
  /** OPTIONAL preferred return rate on contributed capital (fraction 0..1). */
  hurdleRatePct?: number | null;
  /** OPTIONAL GP catch-up rate (fraction 0..1); defaults to full (1) if a hurdle is set. */
  gpCatchUpPct?: number | null;
}

const frac = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n; // accept either 0.2 or 20 (%)
};

/**
 * SPV-CORE-2 — waterfall split. With NO hurdle this is the simple model
 * (return of capital, then carry on profit) — byte-for-byte the current
 * behavior. With a hurdle set it adds the preferred-return + GP-catch-up tiers.
 */
export function computeDistributionSplit(input: DistributionInput): DistributionSplit {
  const gross = Math.max(0, asMinor(input.grossProceedsMinor));
  const contributed = Math.max(0, asMinor(input.contributedMinor));
  const carryPct = Math.min(1, Math.max(0, frac(input.carryPct)));
  const hurdle = frac(input.hurdleRatePct);

  const tiers: DistributionTier[] = [];
  let remaining = gross;
  let lpTotal = 0;
  let gpTotal = 0;

  // Tier 1 — return of capital to LPs.
  const roc = Math.min(remaining, contributed);
  tiers.push({ tier: "return_of_capital", amountMinor: roc });
  remaining -= roc;
  lpTotal += roc;

  if (hurdle <= 0) {
    // Simple model — carry on the remaining profit, rest to LPs.
    const carry = Math.round(remaining * carryPct);
    gpTotal += carry;
    lpTotal += remaining - carry;
    tiers.push({ tier: "gp_carry", amountMinor: carry });
    tiers.push({ tier: "lp_profit", amountMinor: remaining - carry });
    return { tiers, lpTotalMinor: lpTotal, gpTotalMinor: gpTotal, tiered: false };
  }

  // Tier 2 — preferred return to LPs.
  const pref = Math.min(remaining, Math.round(contributed * hurdle));
  tiers.push({ tier: "preferred_return", amountMinor: pref });
  remaining -= pref;
  lpTotal += pref;

  // Tier 3 — GP catch-up so the GP reaches carryPct of (pref + catch-up).
  const catchUpPct = (() => {
    const c = frac(input.gpCatchUpPct);
    return c > 0 ? Math.min(1, c) : 1; // default: full catch-up
  })();
  let gpCatch = 0;
  if (carryPct > 0 && carryPct < 1) {
    const fullCatch = Math.round((carryPct * pref) / (1 - carryPct));
    gpCatch = Math.min(remaining, Math.round(fullCatch * catchUpPct));
  }
  tiers.push({ tier: "gp_catch_up", amountMinor: gpCatch });
  remaining -= gpCatch;
  gpTotal += gpCatch;

  // Tier 4 — residual carry split.
  const resCarry = Math.round(remaining * carryPct);
  gpTotal += resCarry;
  lpTotal += remaining - resCarry;
  tiers.push({ tier: "gp_carry", amountMinor: resCarry });
  tiers.push({ tier: "lp_residual", amountMinor: remaining - resCarry });

  return { tiers, lpTotalMinor: lpTotal, gpTotalMinor: gpTotal, tiered: true };
}

export interface CapitalAccountRow {
  investorId: string;
  contributedMinor: number;
  confirmedMinor: number;
  distributedMinor: number;
}

/**
 * SPV-CORE-2 — minimal per-LP capital accounts (D10). `contributed` is the
 * committed amount on the register; `confirmed` is what has actually been
 * confirmed-received; `distributed` sums the LP's net distribution allocations.
 */
export function computeCapitalAccounts(
  register: ReadonlyArray<{ investorId: string; commitmentMinor: number }>,
  confirmedByInvestor: Readonly<Record<string, number>>,
  distributions: ReadonlyArray<{ allocations: ReadonlyArray<{ investorId: string; netMinor: number }> }>,
): CapitalAccountRow[] {
  return register.map((r) => {
    const distributedMinor = distributions.reduce(
      (sum, d) => sum + d.allocations.filter((a) => a.investorId === r.investorId).reduce((s, a) => s + a.netMinor, 0),
      0,
    );
    return {
      investorId: r.investorId,
      contributedMinor: r.commitmentMinor,
      confirmedMinor: asMinor(confirmedByInvestor[r.investorId] ?? 0),
      distributedMinor,
    };
  });
}

export interface CloseSummary {
  confirmedCount: number;
  confirmedMinor: number;
  targetMinor: number | null;
  /** True when a target is set AND confirmed capital is below it. */
  underTarget: boolean;
  /** How far under target (0 when at/over target or no target). */
  shortfallMinor: number;
  /** For the one-click "set target = raised" affordance. */
  suggestedTargetMinor: number;
  note: string;
}

/**
 * SPV-CORE-3 — close summary. Under-target NEVER blocks: it proceeds with the
 * confirmed amount and offers to set the target to what was actually raised.
 */
export function computeCloseSummary(
  subs: ReadonlyArray<{ status: string; commitmentMinor: number }>,
  targetMinor?: number | null,
): CloseSummary {
  const committed = subs.filter((s) => s.status === "committed");
  const confirmedMinor = committed.reduce((a, s) => a + Math.max(0, asMinor(s.commitmentMinor)), 0);
  const target = targetMinor != null && Number.isFinite(Number(targetMinor)) && Number(targetMinor) > 0 ? asMinor(targetMinor) : null;
  const underTarget = target != null && confirmedMinor < target;
  const shortfallMinor = underTarget ? target! - confirmedMinor : 0;
  const note = underTarget
    ? "Confirmed capital is below the original target. You can close anyway with the amount raised — the platform will proceed, and you may set the target to the confirmed amount."
    : target != null
      ? "Target met. Ready to close to new LPs and deploy."
      : "No target set. Ready to close to new LPs with the confirmed capital.";
  return {
    confirmedCount: committed.length,
    confirmedMinor,
    targetMinor: target,
    underTarget,
    shortfallMinor,
    suggestedTargetMinor: confirmedMinor,
    note,
  };
}

/**
 * SPV-CORE-3 — may a closed SPV reopen for a later (rolling) close? Allowed
 * while within `windowDays` of the recorded close date. Fail-OPEN on bad input
 * (missing or unparseable close date → allowed), consistent with the never-block
 * philosophy; only a fully-elapsed window returns not-allowed.
 */
export function canReopenClose(
  status: string,
  closeDate: string | null | undefined,
  windowDays: number,
  now: Date = new Date(),
): { allowed: boolean; reason: string } {
  if (status !== "closed") return { allowed: false, reason: "not_closed" };
  if (!closeDate) return { allowed: true, reason: "no_close_date_recorded" };
  const closed = new Date(closeDate);
  if (Number.isNaN(closed.getTime())) return { allowed: true, reason: "unparseable_close_date" };
  const days = (now.getTime() - closed.getTime()) / 86400000;
  if (days <= Math.max(0, windowDays)) return { allowed: true, reason: "within_rolling_close_window" };
  return { allowed: false, reason: "rolling_close_window_elapsed" };
}

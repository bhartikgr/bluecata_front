/**
 * WAVE 18 — ORP-040 (DEF-040).
 *
 * WHY THIS FILE EXISTS, stated plainly rather than dressed up as architecture.
 * The `GET /api/investor/discover` projection converts a round's MAJOR-unit
 * `targetAmount` into integer minor units. That conversion is exactly the kind of
 * line a hardcoded `×100` hides in, and RULE 1 says a check that cannot fail is
 * worthless. Through the route it CANNOT be exercised at more than one exponent:
 * the feed's only source is the rounds the caller is INVITED to (the sole other
 * predicate, `discoverable === true`, is set by nothing in the codebase —
 * measured: `grep -rn discoverable server shared` finds no writer), and every
 * seeded invitation is USD. USD is precisely the currency in which a `×100` and a
 * correct exponent-aware conversion print IDENTICALLY.
 *
 * So the conversion is lifted out here as a pure function, where a unit test can
 * drive JPY (ISO-4217 exponent 0), KWD (exponent 3) and a null target through it.
 * The route calls this and nothing else, so a mutation to the arithmetic is caught
 * by the suite instead of sitting in an untestable branch.
 *
 * Money rules honoured: integer minor units only, exponent from `toMinor`
 * (server/lib/currency.ts), and a null target stays NULL — never a fabricated 0,
 * which would render as a real "$0 target" to an investor.
 */
import { toMinor } from "./currency";

export interface DiscoverRoundInput {
  id?: string;
  companyId?: string;
  name?: string | null;
  status?: string | null;
  targetAmount?: number | null;
  currency?: string | null;
  deletedAt?: string | null;
  discoverable?: boolean;
}

export interface DiscoverRoundProjection {
  id: string;
  companyId: string;
  name: string | null;
  status: string;
  /** MAJOR units, verbatim from the row — kept for existing consumers. */
  targetAmount: number | null;
  /** Exact integer MINOR units, or null when there is no target at all. */
  targetAmountMinor: number | null;
  currency: string | null;
  invited: boolean;
}

/** True when the round belongs in an investor's discover feed. */
export function isDiscoverableForInvestor(
  round: DiscoverRoundInput,
  invitedRoundIds: ReadonlySet<string>,
): boolean {
  if (round?.status && String(round.status).toLowerCase() === "closed") return false;
  if (round?.deletedAt) return false;
  return invitedRoundIds.has(String(round?.id)) || round?.discoverable === true;
}

/**
 * Project ONE round. `targetAmountMinor` is exponent-aware; a missing or
 * non-finite target yields null so the client renders "not set" copy rather than
 * a number nobody entered.
 */
export function projectDiscoverRound(
  round: DiscoverRoundInput,
  invitedRoundIds: ReadonlySet<string>,
): DiscoverRoundProjection {
  const currency = round?.currency ?? null;
  const target =
    typeof round?.targetAmount === "number" && Number.isFinite(round.targetAmount)
      ? round.targetAmount
      : null;
  return {
    id: String(round?.id ?? ""),
    companyId: String(round?.companyId ?? ""),
    name: round?.name ?? null,
    status: round?.status ?? "open",
    targetAmount: target,
    targetAmountMinor: target === null ? null : toMinor(target, currency ?? "USD"),
    currency,
    invited: invitedRoundIds.has(String(round?.id)),
  };
}

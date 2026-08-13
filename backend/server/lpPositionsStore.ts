/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 5 — LP POSITIONS (the investor-portal data).
 *
 * ── THE RULING THIS FILE IMPLEMENTS ──────────────────────────────────────
 * "The LP portal is NOT a separate portal. It is the existing investor portal."
 * (`spec/LP_SCOPED_VIEW_DESIGN.md`.) So there is no LP app, no LP login and no
 * LP account type here — only a reader that answers, for ONE session identity:
 * "which vehicles do you hold an LP interest in, and what is YOUR position?"
 *
 * **SCOPE FOLLOWS THE POSITION, NOT THE ACCOUNT.** There is no `is_lp` column,
 * no role flag and nothing to provision. A person is an LP of a vehicle exactly
 * when they appear on that vehicle's COMMITTED register, and the same person can
 * simultaneously hold a direct cap-table position elsewhere and see it in full.
 * A flag would force one or the other and would silently over-expose whoever it
 * was set wrong for.
 *
 * ── LP PRIVACY (WAVE 29 / WAIVER-4) ──────────────────────────────────────
 * Two passive LPs in one vehicle must not be able to discover each other. Every
 * reader below is scoped by `investor_id` IN THE SQL or filters to the caller
 * before any other LP's figure is placed in a returned structure. The register
 * itself, the co-investor list and other LPs' commitments are NEVER included in
 * anything this module returns. `capTableMembership.ts` (sacred) is neither
 * re-implemented nor bypassed: an LP interest is an interest in the VEHICLE,
 * and the vehicle — not the LP — is the cap-table member.
 *
 * ── THE OPEN OWNER QUESTION, BUILT AS A FLAG ─────────────────────────────
 * Whether a partner-sponsored SPV's EXTERNAL LPs also receive Collective deal
 * flow is undecided (design §6). The built default is `vehicle_only`, least
 * privilege. It is a named constant with one call site, not an architecture, so
 * ruling the other way is a configuration change. It is deliberately NOT read
 * from `process.env`: a test must establish its own preconditions, and a scope
 * that changes with the ambient environment cannot be asserted at both poles.
 */
import { rawDb } from "./db/connection";
import { spvBasics, lpOwnNavPosition } from "./spvNavStore";
import type { SpvNavResult } from "./lib/spvNav";
import { k1DistributionsForSpv, k1ContributionsForSpv } from "./spvK1Store";
import { lpOwnSideLetter } from "./spvSideLetterStore";

/**
 * What an LP's session reaches beyond their own vehicles.
 *   `vehicle_only`      — least privilege, the built default and the
 *                         recommendation in the design: a partner's LP
 *                         relationships are the partner's asset.
 *   `collective_access` — reserved for an owner ruling the other way.
 */
export type LpCollectiveScope = "vehicle_only" | "collective_access";
export const LP_COLLECTIVE_SCOPE: LpCollectiveScope = "vehicle_only";

export interface LpPosition {
  spvId: string;
  spvName: string;
  jurisdiction: string;
  currency: string;
  /** ALWAYS the string literal below. An LP interest must never be mistakable
   *  for a direct holding in the portfolio company: they own a slice of a
   *  vehicle; the vehicle owns the shares. */
  positionType: "spv_lp_interest";
  commitmentMinor: number;
  /** Confirmed cash actually received from THIS LP. Null when none is on
   *  record — a commitment is not called capital. */
  calledCapitalMinor: number | null;
  /** Sum of this LP's `netMinor` across recorded distributions. */
  distributionsReceivedMinor: number;
  /** A FRACTION of the vehicle (0.25 = 25%), never a percent. */
  ownershipFraction: number | null;
  /** Capital account: called + income − distributions is NOT computed here;
   *  the honest account is called capital less distributions received, with
   *  unrealised value carried by the NAV share below. Null when unknown. */
  capitalAccountMinor: number | null;
  /** The vehicle's NAV and THIS LP's share of it, with the staleness badge. */
  navTotalMinor: number | null;
  navShareMinor: number | null;
  navAsOfDate: string;
  navBadge: string | null;
  navRefusalCopy: string | null;
  /** Whether this LP has their own side letter. Never anyone else's. */
  hasSideLetter: boolean;
  /** Server-authored copy for anything that could not be derived. */
  refusalCopy: string | null;
}

/** The vehicles this identity is a committed LP of. Scoped in the SQL. */
export function lpVehicleIdsFor(investorId: string): string[] {
  return (rawDb()
    .prepare(`SELECT spv_id FROM spv_subscription
              WHERE investor_id = ? AND status = 'committed'
              ORDER BY created_at ASC, id ASC`)
    .all(investorId) as Array<{ spv_id: string }>).map((r) => r.spv_id);
}

function spvMeta(spvId: string): { name: string; jurisdiction: string } {
  const r = rawDb().prepare(`SELECT name, jurisdiction FROM spv WHERE id = ?`).get(spvId) as
    | { name?: string; jurisdiction?: string }
    | undefined;
  return { name: String(r?.name ?? spvId), jurisdiction: String(r?.jurisdiction ?? "") };
}

function ownCommitment(spvId: string, investorId: string): number | null {
  const r = rawDb()
    .prepare(`SELECT commitment_minor FROM spv_subscription
              WHERE spv_id = ? AND investor_id = ? AND status = 'committed' LIMIT 1`)
    .get(spvId, investorId) as { commitment_minor?: number } | undefined;
  return r ? Number(r.commitment_minor ?? 0) : null;
}

/**
 * The ownership fraction of a vehicle.
 *
 * This needs the whole register's TOTAL, which is a vehicle-level aggregate —
 * and an aggregate is not a disclosure of any individual co-investor. Only the
 * SUM crosses this boundary; no other LP's id or commitment is read into a
 * returned structure.
 */
function ownershipFractionOf(spvId: string, ownCommitmentMinor: number): number | null {
  const r = rawDb()
    .prepare(`SELECT SUM(commitment_minor) AS total FROM spv_subscription
              WHERE spv_id = ? AND status = 'committed'`)
    .get(spvId) as { total?: number } | undefined;
  const total = Number(r?.total ?? 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  return ownCommitmentMinor / total;
}

/**
 * ONE LP's position in ONE vehicle, or null if they are not a committed LP of
 * it. Fail-closed, matching the `NOT_AN_LP` posture of
 * `spvEngineStore.lpRosterForViewer` (spvEngineStore.ts:1560).
 */
export function lpPositionFor(spvId: string, investorId: string): LpPosition | null {
  const basics = spvBasics(spvId);
  if (!basics) return null;
  const commitmentMinor = ownCommitment(spvId, investorId);
  if (commitmentMinor === null) return null;

  const meta = spvMeta(spvId);

  /* CALLED CAPITAL — confirmed receipts only, and only this LP's. A commitment
     is a promise; reporting it as called capital would overstate what the LP
     has actually funded. */
  const mine = k1ContributionsForSpv(spvId).filter((c) => c.investorId === investorId);
  const calledCapitalMinor = mine.length === 0 ? null : mine.reduce((a, c) => a + c.receivedMinor, 0);

  /* DISTRIBUTIONS — this LP's own net across recorded events. Currencies are
     never summed: a vehicle with mixed-currency distributions refuses. */
  const dists = k1DistributionsForSpv(spvId);
  const mixedCurrency = new Set([basics.currency, ...dists.map((d) => d.currency)]).size > 1;
  let distributionsReceivedMinor = 0;
  for (const d of dists) {
    const line = d.allocations.find((a) => a.investorId === investorId);
    if (line) distributionsReceivedMinor += line.netMinor;
  }

  const ownershipFraction = ownershipFractionOf(spvId, commitmentMinor);

  let nav: SpvNavResult | null = null;
  let navShareMinor: number | null = null;
  try {
    const r = lpOwnNavPosition(spvId, investorId);
    nav = r.nav;
    navShareMinor = r.own?.navShareMinor ?? null;
  } catch {
    nav = null;
  }

  const refusals: string[] = [];
  if (calledCapitalMinor === null) {
    refusals.push("No confirmed capital receipt is on record for your commitment yet, so called capital is shown as unavailable rather than as zero.");
  }
  if (mixedCurrency) {
    refusals.push("This vehicle has recorded distributions in more than one currency. Amounts in different currencies are not added together, so no combined total is shown.");
  }
  if (nav && nav.refusalCopy) refusals.push(nav.refusalCopy);

  return {
    spvId,
    spvName: meta.name,
    jurisdiction: meta.jurisdiction,
    currency: basics.currency,
    positionType: "spv_lp_interest",
    commitmentMinor,
    calledCapitalMinor,
    distributionsReceivedMinor: mixedCurrency ? 0 : distributionsReceivedMinor,
    ownershipFraction,
    capitalAccountMinor:
      calledCapitalMinor === null || mixedCurrency
        ? null
        : calledCapitalMinor - distributionsReceivedMinor,
    navTotalMinor: nav?.totalNavMinor ?? null,
    navShareMinor,
    navAsOfDate: nav?.asOfDate ?? "",
    navBadge: nav?.worstMarkBadge ?? null,
    navRefusalCopy: nav?.refusalCopy ?? null,
    hasSideLetter: lpOwnSideLetter(spvId, investorId) !== null,
    refusalCopy: refusals.length === 0 ? null : refusals.join(" "),
  };
}

/** Every LP position this identity holds. Never anyone else's. */
export function lpPositionsFor(investorId: string): LpPosition[] {
  const out: LpPosition[] = [];
  for (const spvId of lpVehicleIdsFor(investorId)) {
    const p = lpPositionFor(spvId, investorId);
    if (p) out.push(p);
  }
  return out;
}

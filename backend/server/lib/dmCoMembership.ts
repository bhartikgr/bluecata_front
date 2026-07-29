/**
 * W-AVI65 FIX 2 — DM co-membership predicate (caller-side widening).
 *
 * PROBLEM (confirmed live): a founder↔investor DM renders as "Private Investor"
 * even when the investor is a committed holder on that founder's cap table. The
 * masking happens in SACRED server/lib/userPrivacyResolver.ts:222-224, which
 * returns "Private Investor" whenever `opts.isCoMember !== true`. commsStore
 * computes that flag with SACRED areCoMembersOnAnyCapTable(), which self-joins
 * captable_commits on `investor_id` for BOTH sides — so it can only ever be true
 * for an INVESTOR↔INVESTOR pair. A founder is never an `investor_id` row on
 * their own cap table, so a founder never qualifies.
 *
 * Both of those files are SACRED and are NOT edited. This helper lives on the
 * CALLER side and widens the predicate for the DM case only:
 *
 *   (1) viewer is an active founder/co_founder member of a company on whose
 *       cap table the counterparty is a committed holder;
 *   (2) the reverse (counterparty founds a company where the viewer holds);
 *   (3) areCoMembersOnAnyCapTable(a, b) — the SACRED investor↔investor rule,
 *       called UNCHANGED.
 *   (4) W-COLLECTIVE Wave 1 (v4 §1.2): either side founds a company owning a
 *       round on which the other holds a live (non-declined, non-deleted)
 *       soft-circle row. (1)-(3) all require a `committed` captable_commits row,
 *       which a soft-circling investor does not have yet.
 *
 * LEAK GUARANTEES (all still enforced downstream / here):
 *  - The `visibleToCoMembers` opt-out is evaluated BEFORE isCoMember in the
 *    resolver (userPrivacyResolver.ts:222), so widening isCoMember can NEVER
 *    unmask a user who opted out.
 *  - Co-membership is proven ONLY from durable rows (company_members +
 *    captable_commits). It is never inferred from "a DM channel exists", from
 *    canDM/privacyMode, or from any in-memory cache.
 *  - Fail-closed: malformed input, self-pairs, missing tables, and any DB error
 *    all return FALSE (→ the resolver masks).
 *  - Read-only + parameterized SQL. Nothing here mutates.
 */
import { rawDb } from "../db/connection";
import { areCoMembersOnAnyCapTable } from "./capTableMembership";
import type { SoftCircleStatus } from "../softCircleStore";

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Roles on company_members that represent the company side (not a holder). */
const FOUNDER_ROLES = ["founder", "co_founder"] as const;

/**
 * W-COLLECTIVE Wave 1 (v4 §1.2) — soft-circle participation counts as DM
 * co-membership.
 *
 * THE GAP. The two predicates above both require a `captable_commits` row in
 * state `'committed'`. A soft-circling investor has no such row yet — the commit
 * is only written at close — so a founder DMing an investor who has already
 * signalled into their round still sees "Private Investor". That is the single
 * most common founder↔investor DM on the platform.
 *
 * The status list is derived from an EXHAUSTIVE switch over `SoftCircleStatus`
 * rather than a hand-written array, so adding a state to that union fails the
 * build here instead of silently defaulting to unmasked or masked.
 */
function isParticipatingStatus(s: SoftCircleStatus): boolean {
  switch (s) {
    case "intent":
    case "confirmed":
    case "wired":
    case "committed":
      return true;
    case "declined":
      return false;
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

const ALL_SOFT_CIRCLE_STATUSES: readonly SoftCircleStatus[] = [
  "intent",
  "confirmed",
  "wired",
  "committed",
  "declined",
];

/** The statuses that prove participation. Never includes `declined`. */
const PARTICIPATING_SOFT_CIRCLE_STATUSES: readonly SoftCircleStatus[] =
  ALL_SOFT_CIRCLE_STATUSES.filter(isParticipatingStatus);

/**
 * TRUE iff `founderUserId` is an active founder/co_founder of a company that
 * owns a round on which `investorUserId` holds a live soft-circle row.
 *
 * `status IS NULL` counts as participation: the column is NOT NULL in
 * `shared/schema.ts` but `softCircleStore.mapRow` defensively reads
 * `(r.status ?? "intent")` (softCircleStore.ts:365, :484), i.e. a physically
 * NULL status is treated as `intent` everywhere else, and this predicate must
 * not disagree with the rest of the system.
 *
 * Resolved through `rounds` (soft_circles.company_id is NULLABLE, so it cannot
 * be the join key) and read DIRECTLY off `soft_circles` — NOT via
 * `listForCollective()`, which falls back to the in-memory `memCircles` cache on
 * a DB error (softCircleStore.ts:428-433) and would let a transient read failure
 * unmask an identity from non-durable state.
 *
 * Every table in the join is soft-delete-aware. Review fix B12 — `rounds` was
 * the one join without a `deleted_at IS NULL` predicate, so a soft-deleted round
 * still unmasked a legal name. That was inconsistent with the sibling predicate
 * `foundsCompanyWhereOtherHolds`, which checks `deleted_at` on BOTH of its join
 * tables, and it is the wrong direction for a privacy predicate: deleting a
 * round must never widen who can see an investor's legal identity.
 *
 * DB-direct, parameterised, read-only. Fail-closed FALSE on any error.
 */
function foundsCompanyWhereOtherSoftCircles(
  founderUserId: string,
  investorUserId: string,
): boolean {
  try {
    const db: any = rawDb();
    const roleMarks = FOUNDER_ROLES.map(() => "?").join(",");
    const statusMarks = PARTICIPATING_SOFT_CIRCLE_STATUSES.map(() => "?").join(",");
    const row = db
      .prepare(
        `SELECT 1 AS hit
           FROM company_members cm
           JOIN rounds r
             ON r.company_id = cm.company_id
           JOIN soft_circles sc
             ON sc.round_id = r.id
          WHERE cm.user_id = ?
            AND cm.role IN (${roleMarks})
            AND cm.is_active = 1
            AND cm.deleted_at IS NULL
            AND r.deleted_at IS NULL
            AND sc.investor_user_id = ?
            AND (sc.status IN (${statusMarks}) OR sc.status IS NULL)
            AND sc.deleted_at IS NULL
          LIMIT 1`,
      )
      .get(
        founderUserId,
        ...FOUNDER_ROLES,
        investorUserId,
        ...PARTICIPATING_SOFT_CIRCLE_STATUSES,
      ) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false;
  }
}

/**
 * TRUE iff `founderUserId` is an active founder/co_founder of some company on
 * whose cap table `holderUserId` is a committed, non-deleted holder.
 *
 * DB-direct (no in-memory canonical state). Fail-closed FALSE on any error.
 */
function foundsCompanyWhereOtherHolds(founderUserId: string, holderUserId: string): boolean {
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT 1 AS hit
           FROM company_members cm
           JOIN captable_commits cc
             ON cc.company_id = cm.company_id
          WHERE cm.user_id = ?
            AND cm.role IN (${FOUNDER_ROLES.map(() => "?").join(",")})
            AND cm.is_active = 1
            AND cm.deleted_at IS NULL
            AND cc.investor_id = ?
            AND cc.state = 'committed'
            AND cc.deleted_at IS NULL
          LIMIT 1`,
      )
      .get(founderUserId, ...FOUNDER_ROLES, holderUserId) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false;
  }
}

/**
 * Co-membership predicate for DIRECT MESSAGE identity resolution.
 *
 * Symmetric by construction: founder→holder, holder→founder, and the SACRED
 * investor↔investor ledger rule. Returns FALSE for self-pairs and on any error.
 */
export function areDmCoMembers(userIdA: string, userIdB: string): boolean {
  if (!isValidId(userIdA) || !isValidId(userIdB)) return false;
  const a = userIdA.trim();
  const b = userIdB.trim();
  if (a === b) return false;
  try {
    // (3) existing investor↔investor rule — SACRED fn, called unchanged.
    if (areCoMembersOnAnyCapTable(a, b)) return true;
    // (1) A founds a company where B holds.
    if (foundsCompanyWhereOtherHolds(a, b)) return true;
    // (2) the reverse.
    if (foundsCompanyWhereOtherHolds(b, a)) return true;
    // (4) v4 §1.2 — A founds a round B soft-circles, and the reverse.
    if (foundsCompanyWhereOtherSoftCircles(a, b)) return true;
    if (foundsCompanyWhereOtherSoftCircles(b, a)) return true;
    return false;
  } catch {
    return false;
  }
}

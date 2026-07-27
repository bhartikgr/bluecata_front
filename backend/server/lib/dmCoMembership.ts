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

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Roles on company_members that represent the company side (not a holder). */
const FOUNDER_ROLES = ["founder", "co_founder"] as const;

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
    return false;
  } catch {
    return false;
  }
}

/**
 * server/lib/chapterGovernanceRules.ts
 * W-COLLECTIVE Wave 2 — STAGE D BLOCKER FIX (B1/B2/B3), owner Option A.
 *
 * ── READ THIS BEFORE TOUCHING `chapter_memberships` ─────────────────────────
 * `chapter_memberships` IS A MONEY TABLE. It is NOT a social/visibility
 * relation. Live consumers that make an authorisation decision from it:
 *
 *   server/collectiveBillingStore.ts:190   `isChapterMember()` — and through it
 *     :1351  create an Airwallex payment INTENT (upgrade)   → non-member = 403
 *     :1498  the self-service billing PORTAL                → non-member = 403
 *     :1555  CANCEL a subscription                          → non-member = 403
 *     :1635  RESUME a cancelled subscription                → non-member = 403
 *     :1806  tier/entitlement read used by the above
 *   server/collectiveDscVoteRoutes.ts:136-145  `countActiveChapterMembers` —
 *     the DSC vote QUORUM DENOMINATOR. Adding/revoking a member changes the
 *     outcome of an open vote.
 *   server/lib/maAuthzGate.ts:111-118        M&A intel authorisation.
 *   server/lib/requireChapterMember.ts:55, server/promotionModerationRoutes.ts:61.
 *
 * The consequence that this module exists to make STRUCTURALLY IMPOSSIBLE:
 * revoking the chapter membership of a user who holds a live subscription
 * leaves them BILLED and simultaneously 403'd out of the cancel endpoint —
 * they cannot stop the money. Every predicate below therefore FAILS CLOSED:
 * a read that cannot be completed is a REFUSAL, never a warning and never an
 * implicit "no billing found".
 *
 * ── THE TWO SHARED RULES (single source of truth; do not re-implement) ──────
 *   RULE_LAST_ADMIN     — a chapter must never be left with zero active admins.
 *                         `server/chapterAdminRoutes.ts` (demote) and
 *                         `server/lib/chapterMembershipWriter.ts` (revoke,
 *                         implicit demotion) BOTH call
 *                         `chapterHasOtherActiveAdmin()` from here, so the two
 *                         surfaces cannot drift apart.
 *   RULE_NO_REVOKE_WHILE_BILLABLE — see `billingPrecondition()`.
 *
 * This module NEVER writes `collective_memberships_billing` and never changes
 * any behaviour in `collectiveBillingStore.ts`; it only calls its exported
 * reader `getBillingForUser()` plus one independent, parameterised, read-only
 * confirmation query. All SQL is parameterised.
 */
import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../db/connection";
import { collectiveMembershipsBilling as billingTable, chapterMemberships as chapterMembershipsTable } from "@shared/schema";
import { getBillingForUser } from "../collectiveBillingStore";
import { appendAdminAudit } from "../adminPlatformStore";
import { log } from "./logger";

export const RULE_LAST_ADMIN = "chapter.governance.last_admin_protected" as const;
export const RULE_NO_REVOKE_WHILE_BILLABLE =
  "chapter.governance.no_revoke_while_billable" as const;

/** Guard error codes. Stable strings — clients and tests key off these. */
export const GUARD_ERRORS = {
  SUBSCRIPTION_ACTIVE_CANCEL_FIRST: "SUBSCRIPTION_ACTIVE_CANCEL_FIRST",
  BILLING_STATE_UNVERIFIABLE: "BILLING_STATE_UNVERIFIABLE",
  LAST_CHAPTER_ADMIN: "LAST_CHAPTER_ADMIN",
  ADMIN_STATE_UNVERIFIABLE: "ADMIN_STATE_UNVERIFIABLE",
  NOT_CHAPTER_ADMIN: "NOT_CHAPTER_ADMIN",
  AUDIT_UNAVAILABLE: "AUDIT_UNAVAILABLE",
} as const;

export type GuardVerdict =
  | { allow: true }
  | { allow: false; error: string; message: string; rule: string; details?: Record<string, unknown> };

/**
 * Billing statuses that mean "this row can still take money, or still needs a
 * cancellation the member can only perform while they are a chapter member".
 * `collectiveBillingStore.BillingStatus` is the closed set
 * `pending | active | past_due | cancelled | expired`; anything OUTSIDE the
 * settled set below is treated as billable, so a future status added to that
 * union defaults to REFUSE rather than to silently allowing a strand.
 */
export const SETTLED_BILLING_STATUSES: ReadonlySet<string> = new Set([
  "cancelled",
  "expired",
]);

/** TRUE iff this (status, cancelAtPeriodEnd) pair still needs the member inside the chapter. */
export function billingRowIsBillable(
  status: string | null | undefined,
  cancelAtPeriodEnd: boolean,
): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "") return true; // unreadable status ⇒ assume billable (fail closed)
  if (SETTLED_BILLING_STATUSES.has(s)) return false;
  /* An `active` row already flagged cancel-at-period-end takes no further
     payment and needs no further member action, so it is NOT billable. Every
     other state (pending / active / past_due / anything unrecognised) is. */
  if (s === "active" && cancelAtPeriodEnd) return false;
  return true;
}

/**
 * Independent, read-only confirmation of the billing row for (user, chapter).
 * THROWS on any read failure — the caller MUST convert a throw into a refusal.
 * Deliberately NOT tenant-scoped: for a fail-closed check a superset of rows is
 * the safe direction, and `collective_memberships_billing` is UNIQUE
 * (user_id, chapter_id) (server/db/connection.ts:2817).
 */
function confirmBillingRowStrict(
  chapterId: string,
  userId: string,
): { status: string; cancelAtPeriodEnd: boolean; deletedAt: string | null } | null {
  const db: any = getDb();
  const rows = db
    .select({
      status: (billingTable as any).status,
      cancelAtPeriodEnd: (billingTable as any).cancelAtPeriodEnd,
      deletedAt: (billingTable as any).deletedAt,
    })
    .from(billingTable)
    .where(
      and(
        eq((billingTable as any).userId, userId),
        eq((billingTable as any).chapterId, chapterId),
      ),
    )
    .limit(1)
    .all() as any[];
  const r = rows[0];
  if (!r) return null;
  return {
    status: String(r.status ?? ""),
    cancelAtPeriodEnd: !!r.cancelAtPeriodEnd,
    deletedAt: (r.deletedAt ?? null) as string | null,
  };
}

/**
 * RULE_NO_REVOKE_WHILE_BILLABLE — hard precondition for removing (or demoting
 * out of) a chapter membership.
 *
 * PRECONDITION, stated exactly: the revoke is allowed ONLY IF both independent
 * reads of `collective_memberships_billing` for (userId, chapterId) complete
 * WITHOUT error AND neither reports a live row whose status is billable
 * (`billingRowIsBillable`). Reads are:
 *   (a) `collectiveBillingStore.getBillingForUser()` — the sanctioned,
 *       tenant-scoped reader used by the payment routes themselves;
 *   (b) `confirmBillingRowStrict()` — an unscoped confirmation that THROWS
 *       instead of returning null on failure, so "read broke" can never be
 *       mistaken for "no subscription".
 * If (b) throws, the verdict is BILLING_STATE_UNVERIFIABLE (refuse). There is
 * no code path in which an unreadable billing state permits a revoke.
 */
export function billingPrecondition(chapterId: string, userId: string): GuardVerdict {
  let confirmed: { status: string; cancelAtPeriodEnd: boolean; deletedAt: string | null } | null;
  try {
    confirmed = confirmBillingRowStrict(chapterId, userId);
  } catch (err) {
    log.error({
      route: "chapterGovernanceRules.billingPrecondition",
      errorType: "BILLING_STATE_UNVERIFIABLE",
      chapterId,
      userId,
      message: (err as Error).message,
    });
    return {
      allow: false,
      error: GUARD_ERRORS.BILLING_STATE_UNVERIFIABLE,
      message:
        "Billing state for this member could not be read. Refusing the membership change: a revoke against unknown billing state can strand a paying member.",
      rule: RULE_NO_REVOKE_WHILE_BILLABLE,
    };
  }

  if (confirmed && !confirmed.deletedAt && billingRowIsBillable(confirmed.status, confirmed.cancelAtPeriodEnd)) {
    return {
      allow: false,
      error: GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST,
      message:
        "This member holds a live Collective subscription in this chapter. Cancel the subscription first (POST /api/collective/membership/cancel), then revoke the membership. Revoking now would keep billing them while locking them out of the cancel endpoint.",
      rule: RULE_NO_REVOKE_WHILE_BILLABLE,
      details: { billingStatus: confirmed.status, cancelAtPeriodEnd: confirmed.cancelAtPeriodEnd },
    };
  }

  /* Second, independent opinion from the payment routes' own reader. It returns
     null both for "absent" and for "read failed", which is why it can only ever
     ADD a refusal here, never authorise one. */
  const sanctioned = getBillingForUser(userId, chapterId);
  if (sanctioned && billingRowIsBillable(sanctioned.status, sanctioned.cancelAtPeriodEnd)) {
    return {
      allow: false,
      error: GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST,
      message:
        "This member holds a live Collective subscription in this chapter. Cancel the subscription first, then revoke the membership.",
      rule: RULE_NO_REVOKE_WHILE_BILLABLE,
      details: { billingStatus: sanctioned.status, cancelAtPeriodEnd: sanctioned.cancelAtPeriodEnd },
    };
  }
  return { allow: true };
}

export interface ChapterMembershipState {
  role: string;
  status: string;
  deletedAt: string | null;
}

/**
 * The membership row for (chapter, user), live or not. THROWS on read failure.
 */
export function readMembershipStrict(
  chapterId: string,
  userId: string,
): ChapterMembershipState | null {
  const db: any = getDb();
  const rows = db
    .select({
      role: (chapterMembershipsTable as any).role,
      status: (chapterMembershipsTable as any).status,
      deletedAt: (chapterMembershipsTable as any).deletedAt,
    })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq((chapterMembershipsTable as any).chapterId, chapterId),
        eq((chapterMembershipsTable as any).userId, userId),
      ),
    )
    .limit(1)
    .all() as any[];
  const r = rows[0];
  if (!r) return null;
  return {
    role: String(r.role ?? "member"),
    status: String(r.status ?? ""),
    deletedAt: (r.deletedAt ?? null) as string | null,
  };
}

/**
 * RULE_LAST_ADMIN — the SHARED last-admin reader. THROWS on read failure.
 * Mirrors `listChapterAdmins()` in server/chapterAdminRoutes.ts exactly
 * (role='admin' AND status='active' AND deleted_at IS NULL) and is now the
 * single implementation both surfaces decide from.
 */
export function activeChapterAdminUserIdsStrict(chapterId: string): string[] {
  const db: any = getDb();
  const rows = db
    .select({ userId: (chapterMembershipsTable as any).userId })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq((chapterMembershipsTable as any).chapterId, chapterId),
        eq((chapterMembershipsTable as any).role, "admin"),
        eq((chapterMembershipsTable as any).status, "active"),
        isNull((chapterMembershipsTable as any).deletedAt),
      ),
    )
    .all() as any[];
  return rows
    .map((r) => String(r?.userId ?? ""))
    .filter((u) => u.length > 0);
}

/**
 * TRUE iff the chapter retains at least one ACTIVE admin other than `userId`.
 * THROWS on read failure so callers fail closed.
 */
export function chapterHasOtherActiveAdmin(chapterId: string, userId: string): boolean {
  const admins = activeChapterAdminUserIdsStrict(chapterId);
  return admins.some((u) => u !== userId);
}

/**
 * RULE_LAST_ADMIN as a verdict. `intent` only shapes the message.
 */
export function lastAdminPrecondition(
  chapterId: string,
  userId: string,
  currentRole: string,
  intent: "revoke" | "demote",
): GuardVerdict {
  if (String(currentRole).trim().toLowerCase() !== "admin") return { allow: true };
  let hasOther: boolean;
  try {
    hasOther = chapterHasOtherActiveAdmin(chapterId, userId);
  } catch (err) {
    log.error({
      route: "chapterGovernanceRules.lastAdminPrecondition",
      errorType: "ADMIN_STATE_UNVERIFIABLE",
      chapterId,
      userId,
      message: (err as Error).message,
    });
    return {
      allow: false,
      error: GUARD_ERRORS.ADMIN_STATE_UNVERIFIABLE,
      message:
        "The chapter's admin roster could not be read. Refusing the change rather than risk leaving the chapter with zero admins.",
      rule: RULE_LAST_ADMIN,
    };
  }
  if (hasOther) return { allow: true };
  return {
    allow: false,
    error: GUARD_ERRORS.LAST_CHAPTER_ADMIN,
    message:
      intent === "revoke"
        ? "Cannot revoke the last active admin of this chapter. Promote another admin first."
        : "Cannot demote the last chapter admin.",
    rule: RULE_LAST_ADMIN,
  };
}

/**
 * AUDIT — append-only, and a HARD precondition rather than a courtesy.
 * `appendAdminAudit` does not throw; it returns a sentinel entry with
 * `hash === ""` when the audit_log write failed (adminPlatformStore.ts:558-569).
 * We therefore inspect the sentinel and treat an unaudited write as a refusal.
 *
 * Called BEFORE the mutation, with the intended before/after state, so a write
 * that cannot be recorded is never performed.
 */
export function auditChapterGovernance(
  eventType: string,
  actorUserId: string,
  chapterId: string,
  targetUserId: string,
  before: { role: string | null; status: string | null },
  after: { role: string | null; status: string | null },
  extra: Record<string, unknown> = {},
): GuardVerdict {
  try {
    const entry = appendAdminAudit(
      actorUserId || "unknown_actor",
      `chapter_membership:${chapterId}:${targetUserId}`,
      eventType,
      {
        chapterId,
        targetUserId,
        actorUserId,
        previousRole: before.role,
        previousStatus: before.status,
        newRole: after.role,
        newStatus: after.status,
        ...extra,
      },
    );
    if (!entry || entry.hash === "") {
      return {
        allow: false,
        error: GUARD_ERRORS.AUDIT_UNAVAILABLE,
        message:
          "The governance audit entry could not be written, so the membership change was not performed.",
        rule: "chapter.governance.audited_or_refused",
      };
    }
    return { allow: true };
  } catch (err) {
    log.error({
      route: "chapterGovernanceRules.auditChapterGovernance",
      errorType: "AUDIT_UNAVAILABLE",
      message: (err as Error).message,
    });
    return {
      allow: false,
      error: GUARD_ERRORS.AUDIT_UNAVAILABLE,
      message:
        "The governance audit entry could not be written, so the membership change was not performed.",
      rule: "chapter.governance.audited_or_refused",
    };
  }
}

/** Guard failures that a route should surface as 409 (conflict), not 400. */
export const CONFLICT_GUARD_ERRORS: ReadonlySet<string> = new Set([
  GUARD_ERRORS.SUBSCRIPTION_ACTIVE_CANCEL_FIRST,
  GUARD_ERRORS.LAST_CHAPTER_ADMIN,
]);

/** Guard failures that a route should surface as 503 (state unverifiable / degraded). */
export const UNAVAILABLE_GUARD_ERRORS: ReadonlySet<string> = new Set([
  GUARD_ERRORS.BILLING_STATE_UNVERIFIABLE,
  GUARD_ERRORS.ADMIN_STATE_UNVERIFIABLE,
  GUARD_ERRORS.AUDIT_UNAVAILABLE,
]);

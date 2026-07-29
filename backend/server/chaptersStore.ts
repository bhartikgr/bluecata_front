/**
 * v17 Phase A — chaptersStore.
 *
 * Real Drizzle store for chapters + chapter_memberships. NO in-memory Map
 * cache (v17 Phase A is DB-only; the brief reserves the hybrid Map+DB
 * pattern for v17 Phase B stores). NO mock data. NO TODOs.
 *
 * Every write goes through `getDb().transaction(async (tx) => {...})`
 * per V19_BUILD_BRIEF.md Rule 6. NO trailing `()` on the callback —
 * Drizzle invokes it itself. (Wave 1 hit this bug; do not repeat.)
 *
 * Every query is paired with the correct tenant filter. Chapter-membership
 * lookups are intentionally cross-tenant because chapter_memberships is the
 * table that ESTABLISHES the active chapter scope (same pattern as
 * user_prefs in `withTenant.getCurrentTenantId`).
 */

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./db/connection";
import { chapters, chapterMemberships } from "../shared/schema";
import {
  GUARD_ERRORS,
  billingPrecondition,
  lastAdminPrecondition,
  readMembershipStrict,
  type ChapterMembershipState,
  type GuardVerdict,
} from "./lib/chapterGovernanceRules";
import {
  revokeChapterMembership as revokeChapterMembershipGuarded,
  type ChapterWriteActor,
  type ChapterWriteResult,
} from "./lib/chapterMembershipWriter";

/**
 * ⚠ `chapter_memberships` IS A MONEY TABLE (not a social relation).
 * `collectiveBillingStore.isChapterMember()` gates Airwallex payment-intent
 * creation, the billing portal, and subscription CANCEL / RESUME. So any write
 * here that REDUCES a member's standing can leave them billed and 403'd out of
 * their own cancel button. The single source of truth for the two rules that
 * prevent that is `server/lib/chapterGovernanceRules.ts` — this store IMPORTS
 * and CALLS it (`billingPrecondition`, `lastAdminPrecondition`) rather than
 * re-implementing anything, so this surface and
 * `server/lib/chapterMembershipWriter.ts` cannot drift apart.
 *
 * Semantics are identical to the HTTP writer's: billable ⇒ refuse with
 * `SUBSCRIPTION_ACTIVE_CANCEL_FIRST`; unreadable billing ⇒ refuse with
 * `BILLING_STATE_UNVERIFIABLE`; last active admin ⇒ refuse with
 * `LAST_CHAPTER_ADMIN`; unreadable admin roster ⇒ `ADMIN_STATE_UNVERIFIABLE`.
 *
 * A refusal is THROWN as `ChapterGovernanceRefusalError` (never swallowed,
 * never a silent drop) so it surfaces to the existing callers without changing
 * any function signature.
 *
 * NOTE ON SCOPE, stated honestly: `joinChapter()` below can only ever set
 * `status = 'active'` — it has no revoke/deactivate branch, and its update
 * branch is unreachable for a LIVE ACTIVE row (that case early-returns with the
 * role preserved). The gate is therefore evaluated on every membership
 * transition it performs and is a structural guarantee for future callers; the
 * reachable revoke entry point is `revokeChapterMembership()` at the bottom of
 * this file, which delegates to the already-guarded production writer.
 */
export class ChapterGovernanceRefusalError extends Error {
  readonly code: string;
  readonly rule: string;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, rule: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ChapterGovernanceRefusalError";
    this.code = code;
    this.rule = rule;
    this.details = details;
  }
}

function refuse(verdict: GuardVerdict): void {
  if (verdict.allow) return;
  throw new ChapterGovernanceRefusalError(
    verdict.error,
    verdict.message,
    verdict.rule,
    verdict.details,
  );
}

/**
 * The SHARED preconditions, applied to a proposed (chapter, user) transition.
 * `nextStatus`/`nextRole` describe what the caller is about to write.
 *
 * - A transition that DEACTIVATES a live membership (next status is not
 *   'active') runs `billingPrecondition` + `lastAdminPrecondition`.
 * - A transition that DEMOTES a live ACTIVE admin runs `lastAdminPrecondition`.
 * - A transition that only raises standing (pending/revoked → active, or a new
 *   row) runs neither: it cannot strand anyone and cannot empty the admin
 *   roster.
 * Reads fail closed: an unreadable membership row is a refusal, never an
 * assumed "no row".
 */
function assertGovernedTransition(
  chapterId: string,
  userId: string,
  nextRole: string,
  nextStatus: string,
): void {
  let current: ChapterMembershipState | null;
  try {
    current = readMembershipStrict(chapterId, userId);
  } catch (err) {
    throw new ChapterGovernanceRefusalError(
      "MEMBERSHIP_STATE_UNVERIFIABLE",
      `The current chapter-membership row could not be read, so no write was attempted: ${(err as Error).message}`,
      "chapter.governance.fail_closed",
    );
  }
  const liveActive = !!current && current.status === "active" && current.deletedAt === null;
  const deactivating = liveActive && String(nextStatus).trim().toLowerCase() !== "active";
  const demoting =
    liveActive &&
    String(current!.role).trim().toLowerCase() === "admin" &&
    String(nextRole).trim().toLowerCase() !== "admin";

  if (deactivating) {
    refuse(billingPrecondition(chapterId, userId));
  }
  if (deactivating || demoting) {
    refuse(
      lastAdminPrecondition(
        chapterId,
        userId,
        current!.role,
        deactivating ? "revoke" : "demote",
      ),
    );
  }
}

export interface ChapterRow {
  id: string;
  tenantId: string;
  name: string;
  region: string;
  city: string | null;
  status: string;
  adminUserId: string | null;
  partnerOrgId: string | null;
  membershipFeeAnnualMinor: number | null;
  founded: string | null;
}

export interface ChapterMembershipRow {
  id: string;
  chapterId: string;
  userId: string;
  role: string;          // 'member' | 'admin'
  status: string;        // 'active' | 'pending' | 'revoked'
  joinedAt: string;
}

/**
 * List all live (non-soft-deleted) chapters in the system. Used by
 * /api/chapters (public for waitlist/apply flows) and by the chapter
 * selector in the Collective shell topbar.
 */
export function listAllChapters(): ChapterRow[] {
  const db = getDb();
  // CROSS-TENANT (admin) — justified because chapters is the table that
  // defines the chapter scope itself; listing chapters is inherently
  // cross-tenant (a user picking which chapter to join must see all).
  const rows = db
    .select({
      id: chapters.id,
      tenantId: chapters.tenantId,
      name: chapters.name,
      region: chapters.region,
      city: chapters.city,
      status: chapters.status,
      adminUserId: chapters.adminUserId,
      partnerOrgId: chapters.partnerOrgId,
      membershipFeeAnnualMinor: chapters.membershipFeeAnnualMinor,
      founded: chapters.founded,
    })
    .from(chapters)
    .where(isNull(chapters.deletedAt))
    .all() as ChapterRow[];
  return rows;
}

/**
 * List a user's chapter memberships (joined with chapter rows).
 * Used by GET /api/me/chapters to render the chapter selector dropdown.
 *
 * Filters out revoked memberships and soft-deleted chapters. A user is
 * "in" a chapter when their row has status='active' AND chapter.deleted_at
 * IS NULL.
 */
export function listChaptersForUser(userId: string): Array<ChapterRow & {
  membershipId: string;
  membershipRole: string;
  membershipStatus: string;
  joinedAt: string;
}> {
  const db = getDb();
  // CROSS-TENANT (admin) — justified because chapter_memberships keys on
  // user_id (which belongs to the global identity scope, not a tenant) and
  // a user may hold memberships across multiple chapter tenants.
  const memberships = db
    .select({
      id: chapterMemberships.id,
      chapterId: chapterMemberships.chapterId,
      role: chapterMemberships.role,
      status: chapterMemberships.status,
      joinedAt: chapterMemberships.joinedAt,
    })
    .from(chapterMemberships)
    .where(
      and(
        eq(chapterMemberships.userId, userId),
        eq(chapterMemberships.status, "active"),
        isNull(chapterMemberships.deletedAt),
      ),
    )
    .all();

  if (memberships.length === 0) return [];

  // Fetch the chapter rows in a single pass (small N — most users belong
  // to 1–3 chapters; SQLite IN-list is fine).
  const allChapters = listAllChapters();
  const chaptersById = new Map<string, ChapterRow>(
    allChapters.map((c) => [c.id, c]),
  );

  type MembershipRow = (typeof memberships)[number];
  type Joined = ChapterRow & {
    membershipId: string;
    membershipRole: string;
    membershipStatus: string;
    joinedAt: string;
  };
  return memberships
    .map((m: MembershipRow): Joined | null => {
      const ch = chaptersById.get(m.chapterId);
      if (!ch) return null; // dangling membership (chapter soft-deleted) — drop
      return {
        ...ch,
        membershipId: m.id,
        membershipRole: m.role,
        membershipStatus: m.status,
        joinedAt: m.joinedAt,
      };
    })
    .filter((x: Joined | null): x is Joined => x !== null);
}

/**
 * Join a user into a chapter as a member (or upgrade pending → active).
 *
 * Every write goes through a real Drizzle transaction. Idempotent: if the
 * row already exists active, this is a no-op return of the existing row.
 *
 * Returns the row id (existing or newly created) inside the transaction.
 */
export async function joinChapter(opts: {
  userId: string;
  chapterId: string;
  role?: "member" | "admin";
}): Promise<{ id: string; created: boolean }> {
  const { userId, chapterId, role = "member" } = opts;
  const now = new Date().toISOString();
  const db = getDb();

  // Resolve the chapter's tenant_id once outside the txn so the membership
  // row carries the correct tenantId for downstream withTenant() queries.
  // CROSS-TENANT (admin) — justified because we're looking up the chapter
  // by its global id to determine the tenant scope to write into.
  const chapterRows = db
    .select({ id: chapters.id, tenantId: chapters.tenantId })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), isNull(chapters.deletedAt)))
    .limit(1)
    .all();
  const chapter = chapterRows[0];
  if (!chapter) {
    throw new Error(`chapter_not_found: ${chapterId}`);
  }

  // NOTE: Drizzle invokes the transaction callback itself. NO trailing `()`.
  // v25.52 Track 3.0 C-1 fix — better-sqlite3's db.transaction() callback MUST
  // be SYNCHRONOUS: it throws "Transaction function cannot return a promise" if
  // the callback is async. This function was never called by any route before
  // v25.52 (that was C-1 itself), so the latent async-callback bug was never
  // exercised. The body below is already fully synchronous (all .all()/.run()),
  // so we simply drop the `async` on the callback (and the outer `await`). The
  // enclosing joinChapter() stays async so its Promise signature is unchanged.
  return db.transaction((tx: any) => {
    // CROSS-TENANT (admin) — justified because chapter_memberships keys
    // on user_id across all chapter tenants; we're upserting per
    // (chapter_id, user_id), not per tenant.
    const existing = tx
      .select({
        id: chapterMemberships.id,
        status: chapterMemberships.status,
      })
      .from(chapterMemberships)
      .where(
        and(
          eq(chapterMemberships.userId, userId),
          eq(chapterMemberships.chapterId, chapterId),
          isNull(chapterMemberships.deletedAt),
        ),
      )
      .limit(1)
      .all();

    if (existing.length > 0 && existing[0].status === "active") {
      return { id: existing[0].id, created: false };
    }

    /* MONEY-TABLE GATE — the shared preconditions from
       `chapterGovernanceRules.ts`, evaluated against the transition this write
       is actually about to perform (role = `role`, status = 'active'). It is
       placed AFTER the live-active early return above so the no-op path keeps
       its exact previous behaviour, and INSIDE the transaction so a refusal
       leaves nothing written. Any refusal THROWS and surfaces to the caller. */
    assertGovernedTransition(chapterId, userId, role, "active");

    // Either no row, or a non-active row. Upsert.
    const id =
      existing[0]?.id ??
      `chmem_${userId.replace(/^u_/, "")}_${chapterId.replace(/^chap_/, "")}_${Math.random().toString(36).slice(2, 8)}`;

    if (existing.length === 0) {
      tx.insert(chapterMemberships)
        .values({
          id,
          tenantId: chapter.tenantId,
          chapterId,
          userId,
          role,
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .run();
    } else {
      tx.update(chapterMemberships)
        .set({ status: "active", role, updatedAt: now })
        .where(eq(chapterMemberships.id, existing[0].id))
        .run();
    }

    return { id, created: existing.length === 0 };
  });
}

/**
 * REVOKE / DEACTIVATE a chapter membership from the store layer.
 *
 * This is a pure DELEGATION to `server/lib/chapterMembershipWriter.ts`'s
 * `revokeChapterMembership`, which runs the SAME shared preconditions from
 * `server/lib/chapterGovernanceRules.ts` that the HTTP writer uses:
 *   - `billingPrecondition`  — billable ⇒ `SUBSCRIPTION_ACTIVE_CANCEL_FIRST`,
 *                              unreadable ⇒ `BILLING_STATE_UNVERIFIABLE`;
 *   - `lastAdminPrecondition` — last active admin ⇒ `LAST_CHAPTER_ADMIN`,
 *                              unreadable roster ⇒ `ADMIN_STATE_UNVERIFIABLE`;
 *   - audit-before-mutation   — unauditable ⇒ `AUDIT_UNAVAILABLE`.
 * NOTHING is re-implemented here, so the two surfaces cannot drift.
 *
 * It exists so that a caller reaching for "the chapters store" to remove a
 * member lands on the guarded path instead of writing raw SQL against the money
 * table. The refusal is RETURNED (`{ ok: false, error }`) exactly as the writer
 * reports it — never swallowed.
 */
export function revokeChapterMembership(opts: {
  chapterId: string;
  userId: string;
  actor: ChapterWriteActor;
}): ChapterWriteResult {
  return revokeChapterMembershipGuarded(opts.chapterId, opts.userId, opts.actor);
}

/** Re-exported so callers can branch on the shared codes without a second import. */
export { GUARD_ERRORS };

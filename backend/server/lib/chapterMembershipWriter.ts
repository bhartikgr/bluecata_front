/**
 * W-COLLECTIVE Wave 2 STAGE D (D2) — the PRODUCTION WRITER for
 * `chapter_memberships`, and the durable answer to "is this user in that
 * chapter?".
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Audience ROW 5 in `server/lib/networkPostAudience.ts` ("shared ACTIVE
 * chapter, anchored on the post") is INERT on LIVE. Its own header says so:
 * nothing in production writes `chapter_memberships` (only the
 * `migrations/0096` backfill, `server/lib/seedDemoData.ts` and
 * `server/lib/testDebugEndpoints.ts` do) and nothing sets
 * `network_posts.chapter_id`. Row 5 therefore never fires. This module is the
 * missing writer; `server/chapterMembershipRoutes.ts` is the surface that calls
 * it, and `POST /api/comms/posts` now sets the post anchor.
 *
 * ── ROW 5 STAYS POST-ANCHORED ──────────────────────────────────────────────
 * A post with a NULL `chapter_id` remains invisible under row 5, and this
 * module does nothing to relax that. The anchor requirement is what stops row 5
 * degenerating into a platform-wide broadcast, because the platform has a single
 * DEFAULT chapter (`server/lib/chapterDefaults.ts`) that most members belong to.
 * For the same reason `setPostChapterAnchor` REFUSES to anchor a post to a
 * chapter the author is not an ACTIVE member of.
 *
 * ── FAIL CLOSED ────────────────────────────────────────────────────────────
 *   - the chapter must exist, be non-deleted and have `status = 'active'`;
 *   - the user must have a non-deleted `users` row;
 *   - `tenant_id` is copied from the chapter, never invented, so `withTenant()`
 *     scoping elsewhere keeps working;
 *   - every failure returns a structured `{ ok: false, error }` — no silent
 *     success, no partially-written row.
 *
 * ── UPSERT SHAPE ───────────────────────────────────────────────────────────
 * `uq_chapter_memberships_chapter_user` (server/db/connection.ts:1673) is UNIQUE
 * on `(chapter_id, user_id)`, so adding a member is an upsert that clears
 * `deleted_at` and restores `status='active'`. Revoking sets BOTH
 * `status='revoked'` AND `deleted_at`, because row 5 requires
 * `status = 'active' AND deleted_at IS NULL` on both sides and a revoke must be
 * unambiguous under either test. Revoke is reversible by re-adding.
 *
 * ── ⚠ THIS IS A MONEY TABLE. IT IS *NOT* A SOCIAL RELATION. ⚠ ──────────────
 * (The header used to claim `chapter_memberships` was "a social/visibility
 * relation only". That was FALSE and it is how a strand-a-paying-member defect
 * got shipped. Do not restore that sentence.)
 *
 * An authorisation decision is taken from this table by, at minimum:
 *   server/collectiveBillingStore.ts:190 `isChapterMember()`, which gates
 *     :1351  Airwallex payment-INTENT creation (upgrade)  → non-member = 403
 *     :1498  the self-service billing portal              → non-member = 403
 *     :1555  subscription CANCEL                          → non-member = 403
 *     :1635  subscription RESUME                          → non-member = 403
 *     :1806  the tier/entitlement read used by the above
 *   server/collectiveDscVoteRoutes.ts:136-145 — DSC vote QUORUM DENOMINATOR.
 *   server/lib/maAuthzGate.ts:111-118 — M&A intel authorisation.
 *   server/lib/requireChapterMember.ts:55, server/promotionModerationRoutes.ts:61.
 *
 * So revoking a membership can (a) keep billing a member while 403'ing them out
 * of their own cancel endpoint, (b) move a live vote's quorum, (c) drop M&A
 * access. Every write below therefore runs the HARD preconditions in
 * `server/lib/chapterGovernanceRules.ts` first and FAILS CLOSED — an
 * unreadable billing or admin state is a REFUSAL, never a warning.
 * This module still writes exactly one table and never writes any billing row.
 *
 * All SQL is parameterised. This module never reads or writes in-memory state.
 */
import { randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import {
  GUARD_ERRORS,
  auditChapterGovernance,
  billingPrecondition,
  lastAdminPrecondition,
  readMembershipStrict,
  type GuardVerdict,
} from "./chapterGovernanceRules";
import { log } from "./logger";

const isValidId = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const nowIso = (): string => new Date().toISOString();

export type ChapterMemberRole = "member" | "admin";

export type ChapterWriteResult =
  | {
      ok: true;
      chapterId: string;
      userId: string;
      status: "active" | "revoked";
      role?: ChapterMemberRole;
      /** TRUE when an existing live role was preserved instead of being changed (B3). */
      roleUnchanged?: boolean;
      /** TRUE when there was nothing to revoke. */
      idempotent?: boolean;
    }
  | { ok: false; error: string; message?: string; rule?: string; details?: Record<string, unknown> };

/**
 * Who is performing the write. Authority is re-checked HERE, not only in the
 * route, so no future caller can reach the table without it.
 */
export interface ChapterWriteActor {
  userId: string;
  isPlatformAdmin?: boolean;
}

function denied(v: Extract<GuardVerdict, { allow: false }>): ChapterWriteResult {
  return { ok: false, error: v.error, message: v.message, rule: v.rule, details: v.details };
}

/**
 * Chapter-admin (or platform-admin) authority, fail-closed. `allowSelf` covers
 * a member removing their own membership.
 */
function authorityCheck(
  chapterId: string,
  actor: ChapterWriteActor | undefined,
  targetUserId: string,
  allowSelf: boolean,
): GuardVerdict {
  if (!actor || !isValidId(actor.userId)) {
    return {
      allow: false,
      error: GUARD_ERRORS.NOT_CHAPTER_ADMIN,
      message: "No actor identity supplied for a chapter-membership write.",
      rule: "chapter.governance.admin_only",
    };
  }
  if (actor.isPlatformAdmin === true) return { allow: true };
  if (allowSelf && actor.userId.trim() === targetUserId.trim()) return { allow: true };
  if (isChapterAdmin(chapterId, actor.userId)) return { allow: true };
  return {
    allow: false,
    error: GUARD_ERRORS.NOT_CHAPTER_ADMIN,
    message: "Only a chapter admin or a platform admin may change chapter membership.",
    rule: "chapter.governance.admin_only",
  };
}

export interface ChapterRow {
  id: string;
  tenantId: string;
  name: string;
  status: string;
}

/** The chapter, only if it exists, is not deleted and is ACTIVE. */
export function activeChapter(chapterId: string): ChapterRow | undefined {
  if (!isValidId(chapterId)) return undefined;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT id, tenant_id, name, status
           FROM chapters
          WHERE id = ?
            AND deleted_at IS NULL
            AND status = 'active'
          LIMIT 1`,
      )
      .get(chapterId.trim()) as
      | { id: string; tenant_id: string; name: string; status: string }
      | undefined;
    if (!row) return undefined;
    return { id: row.id, tenantId: row.tenant_id, name: row.name, status: row.status };
  } catch {
    return undefined;
  }
}

/** TRUE iff a non-deleted `users` row exists. */
function userExists(userId: string): boolean {
  if (!isValidId(userId)) return false;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT 1 AS hit FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`)
      .get(userId.trim()) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false;
  }
}

/**
 * TRUE iff the user holds an ACTIVE, non-deleted membership of the chapter —
 * the exact same predicate `networkPostAudience.ts` row 5 applies to both sides.
 */
export function isActiveChapterMember(chapterId: string, userId: string): boolean {
  if (!isValidId(chapterId) || !isValidId(userId)) return false;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT 1 AS hit
           FROM chapter_memberships
          WHERE chapter_id = ?
            AND user_id = ?
            AND status = 'active'
            AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(chapterId.trim(), userId.trim()) as { hit?: number } | undefined;
    return !!row?.hit;
  } catch {
    return false;
  }
}

/** TRUE iff the user is an ACTIVE ADMIN of the chapter. */
export function isChapterAdmin(chapterId: string, userId: string): boolean {
  if (!isValidId(chapterId) || !isValidId(userId)) return false;
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT 1 AS hit
           FROM chapter_memberships
          WHERE chapter_id = ?
            AND user_id = ?
            AND role = 'admin'
            AND status = 'active'
            AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(chapterId.trim(), userId.trim()) as { hit?: number } | undefined;
    if (row?.hit) return true;
    // `chapters.admin_user_id` is the bootstrap admin, set when the chapter is
    // created and before any membership row exists. Honoured so a brand-new
    // chapter is manageable without a chicken-and-egg problem.
    const owner = db
      .prepare(
        `SELECT 1 AS hit FROM chapters
          WHERE id = ? AND admin_user_id = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(chapterId.trim(), userId.trim()) as { hit?: number } | undefined;
    return !!owner?.hit;
  } catch {
    return false;
  }
}

/**
 * PRODUCTION WRITER — add or restore an ACTIVE chapter membership.
 * Idempotent: calling it twice leaves exactly one active row.
 *
 * HARD PRECONDITIONS, in order (any failure ⇒ nothing is written):
 *   1. ids valid, role in {member, admin};
 *   2. chapter exists / non-deleted / active; target `users` row live;
 *   3. actor is platform-admin OR an active admin of THIS chapter;
 *   4. the current membership row is READABLE (a read error refuses);
 *   5. NO IMPLICIT ROLE CHANGE (B3): if a LIVE membership already exists its
 *      role is preserved verbatim — this call can never demote an admin, and
 *      cannot promote either. Role changes go through the separately-guarded
 *      `/api/admin/chapters/:chapterId/admins` surface, which enforces
 *      RULE_LAST_ADMIN from `chapterGovernanceRules.ts`. A revoked/dead row is
 *      re-created with the requested role;
 *   6. the audit entry is written BEFORE the mutation and must succeed.
 */
export function addChapterMembership(
  chapterId: string,
  userId: string,
  actor: ChapterWriteActor,
  role: ChapterMemberRole = "member",
): ChapterWriteResult {
  if (!isValidId(chapterId) || !isValidId(userId)) return { ok: false, error: "invalid_ids" };
  if (role !== "member" && role !== "admin") return { ok: false, error: "invalid_role" };
  const chapter = activeChapter(chapterId);
  if (!chapter) return { ok: false, error: "chapter_not_active" };
  if (!userExists(userId)) return { ok: false, error: "user_not_found" };

  const authz = authorityCheck(chapterId, actor, userId, false);
  if (!authz.allow) return denied(authz);

  /* (4) current state — a read failure must NOT be read as "no row". */
  let existing: { role: string; status: string; deletedAt: string | null } | null;
  try {
    existing = readMembershipStrict(chapterId.trim(), userId.trim());
  } catch (err) {
    log.error({
      route: "chapterMembershipWriter.addChapterMembership",
      errorType: "MEMBERSHIP_STATE_UNVERIFIABLE",
      chapterId,
      userId,
      message: (err as Error).message,
    });
    return {
      ok: false,
      error: "membership_state_unverifiable",
      message: "The current membership row could not be read, so no write was attempted.",
      rule: "chapter.governance.fail_closed",
    };
  }

  const liveExisting = !!existing && existing.status === "active" && existing.deletedAt === null;
  /* (5) NO SILENT DEMOTION and no silent promotion. */
  const effectiveRole = (liveExisting ? (existing as { role: string }).role : role) as ChapterMemberRole;
  const roleUnchanged = liveExisting && effectiveRole !== role;

  const audited = auditChapterGovernance(
    "collective.chapter_membership.added",
    actor?.userId ?? "",
    chapterId.trim(),
    userId.trim(),
    { role: existing?.role ?? null, status: existing?.status ?? null },
    { role: effectiveRole, status: "active" },
    { requestedRole: role, roleChangeIgnored: roleUnchanged },
  );
  if (!audited.allow) return denied(audited);

  try {
    const db: any = rawDb();
    const ts = nowIso();
    db.prepare(
      /* The SQL repeats the JS decision on purpose: even a future caller that
         computes `effectiveRole` wrongly cannot demote a LIVE membership, and
         `tenant_id` of an existing row is never overwritten. */
      `INSERT INTO chapter_memberships
         (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)
       ON CONFLICT(chapter_id, user_id) DO UPDATE SET
         role       = CASE
                        WHEN chapter_memberships.status = 'active'
                             AND chapter_memberships.deleted_at IS NULL
                          THEN chapter_memberships.role
                        ELSE excluded.role
                      END,
         status     = 'active',
         tenant_id  = COALESCE(chapter_memberships.tenant_id, excluded.tenant_id),
         updated_at = excluded.updated_at,
         deleted_at = NULL`,
    ).run(
      `chm_${randomBytes(10).toString("hex")}`,
      chapter.tenantId,
      chapterId.trim(),
      userId.trim(),
      effectiveRole,
      ts,
      ts,
      ts,
    );
    return {
      ok: true,
      chapterId: chapterId.trim(),
      userId: userId.trim(),
      status: "active",
      role: effectiveRole,
      ...(roleUnchanged ? { roleUnchanged: true } : {}),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * PRODUCTION WRITER — revoke a chapter membership. Sets BOTH `status='revoked'`
 * and `deleted_at`, so row 5 denies under either half of its test. Reversible
 * via `addChapterMembership`.
 *
 * HARD PRECONDITIONS, in order (any failure ⇒ the row is NOT touched):
 *   1. ids valid;
 *   2. actor is platform-admin, an active admin of THIS chapter, or the target
 *      themselves;
 *   3. the membership row is READABLE (read error ⇒ refuse). No live row ⇒
 *      idempotent no-op;
 *   4. RULE_NO_REVOKE_WHILE_BILLABLE — the target must have NO billable
 *      `collective_memberships_billing` row for this chapter, proven by two
 *      independent reads, one of which refuses on error. A billable row ⇒
 *      `SUBSCRIPTION_ACTIVE_CANCEL_FIRST`. This is what makes "revoked while
 *      subscribed, then 403 on cancel" unreachable;
 *   5. RULE_LAST_ADMIN — the chapter must retain another active admin;
 *   6. audit written BEFORE the mutation, and it must succeed.
 */
export function revokeChapterMembership(
  chapterId: string,
  userId: string,
  actor: ChapterWriteActor,
): ChapterWriteResult {
  if (!isValidId(chapterId) || !isValidId(userId)) return { ok: false, error: "invalid_ids" };

  const authz = authorityCheck(chapterId, actor, userId, true);
  if (!authz.allow) return denied(authz);

  let existing: { role: string; status: string; deletedAt: string | null } | null;
  try {
    existing = readMembershipStrict(chapterId.trim(), userId.trim());
  } catch (err) {
    log.error({
      route: "chapterMembershipWriter.revokeChapterMembership",
      errorType: "MEMBERSHIP_STATE_UNVERIFIABLE",
      chapterId,
      userId,
      message: (err as Error).message,
    });
    return {
      ok: false,
      error: "membership_state_unverifiable",
      message: "The membership row could not be read, so the revoke was refused.",
      rule: "chapter.governance.fail_closed",
    };
  }
  if (!existing || existing.deletedAt !== null || existing.status !== "active") {
    /* Nothing live to revoke. Reported honestly rather than as a mutation. */
    return {
      ok: true,
      chapterId: chapterId.trim(),
      userId: userId.trim(),
      status: "revoked",
      idempotent: true,
    };
  }

  /* (4) MONEY PRECONDITION — hard, fail-closed, before anything is written. */
  const billing = billingPrecondition(chapterId.trim(), userId.trim());
  if (!billing.allow) return denied(billing);

  /* (5) governance precondition — shared rule, same one chapterAdminRoutes uses. */
  const lastAdmin = lastAdminPrecondition(chapterId.trim(), userId.trim(), existing.role, "revoke");
  if (!lastAdmin.allow) return denied(lastAdmin);

  const audited = auditChapterGovernance(
    "collective.chapter_membership.revoked",
    actor?.userId ?? "",
    chapterId.trim(),
    userId.trim(),
    { role: existing.role, status: existing.status },
    { role: existing.role, status: "revoked" },
    { selfRemoval: actor?.userId?.trim() === userId.trim() },
  );
  if (!audited.allow) return denied(audited);

  try {
    const db: any = rawDb();
    const ts = nowIso();
    db.prepare(
      `UPDATE chapter_memberships
          SET status = 'revoked', deleted_at = ?, updated_at = ?
        WHERE chapter_id = ?
          AND user_id = ?
          AND deleted_at IS NULL`,
    ).run(ts, ts, chapterId.trim(), userId.trim());
    return { ok: true, chapterId: chapterId.trim(), userId: userId.trim(), status: "revoked" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface ChapterMemberRecord {
  userId: string;
  role: string;
  status: string;
  joinedAt: string;
}

/** ACTIVE roster of a chapter. Identity resolution is the CALLER's job. */
export function listActiveChapterMembers(chapterId: string): ChapterMemberRecord[] {
  if (!isValidId(chapterId)) return [];
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT user_id, role, status, joined_at
           FROM chapter_memberships
          WHERE chapter_id = ?
            AND status = 'active'
            AND deleted_at IS NULL
          ORDER BY joined_at ASC, user_id ASC`,
      )
      .all(chapterId.trim()) as Array<{
      user_id?: string | null;
      role?: string | null;
      status?: string | null;
      joined_at?: string | null;
    }>;
    return rows
      .filter((r) => isValidId(r?.user_id))
      .map((r) => ({
        userId: (r.user_id as string).trim(),
        role: r.role ?? "member",
        status: r.status ?? "active",
        joinedAt: r.joined_at ?? "",
      }));
  } catch {
    return [];
  }
}

/**
 * Set `network_posts.chapter_id` — the POST ANCHOR that row 5 requires.
 *
 * REFUSES unless the post's DURABLE author holds an ACTIVE membership of that
 * chapter. Anchoring a post to a chapter its author does not belong to would
 * hand visibility to a group the author never addressed, so this is a hard
 * fail-closed check rather than a filter.
 */
export function setPostChapterAnchor(postId: string, chapterId: string): ChapterWriteResult {
  if (!isValidId(postId) || !isValidId(chapterId)) return { ok: false, error: "invalid_ids" };
  if (!activeChapter(chapterId)) return { ok: false, error: "chapter_not_active" };
  try {
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT author_user_id FROM network_posts
          WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(postId.trim()) as { author_user_id?: string | null } | undefined;
    if (!row || !isValidId(row.author_user_id)) return { ok: false, error: "post_not_found" };
    if (!isActiveChapterMember(chapterId, row.author_user_id.trim())) {
      return { ok: false, error: "author_not_chapter_member" };
    }
    db.prepare(`UPDATE network_posts SET chapter_id = ? WHERE id = ?`).run(
      chapterId.trim(),
      postId.trim(),
    );
    return {
      ok: true,
      chapterId: chapterId.trim(),
      userId: row.author_user_id.trim(),
      status: "active",
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

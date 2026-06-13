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
  return await db.transaction(async (tx: any) => {
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

/**
 * Patch v10 — Collective Membership Store (C-CORE-1 / P0-10).
 *
 * v17 Phase B — MIGRATED FROM IN-MEMORY ONLY TO DB-BACKED HYBRID.
 *
 * Source of truth for whether a user holds an *active* Collective membership
 * (after admin approval). Distinct from `membershipStore.ts` which exposes
 * derived cap-table positions + the demo membership snapshot.
 *
 * The data model is intentionally minimal:
 *   - One row per userId.
 *   - `active`/`suspended` flag with `since`/`until` timestamps.
 *   - Optional `tier` (standard | plus) for forward compatibility.
 *
 * Hard-rule compliance:
 *   - All writes wrapped in `getDb().transaction(async (tx) => {...})` (no `()`).
 *   - Tenant-scoped: every row stamps `tenant_id` + `chapter_id`.
 *   - Sequential hydration via HYDRATE_ORDER.
 *   - Sync read getters preserved (Map mirror).
 */
import { isNull, eq } from "drizzle-orm";
import { collectiveMemberships as collectiveMembershipsTable } from "@shared/schema";
import { getDb } from "./db/connection";
import { DEFAULT_CHAPTER_ID, DEFAULT_CHAPTER_TENANT_ID } from "./lib/chapterDefaults";
import { log } from "./lib/logger";

export type CollectiveMembershipRow = {
  userId: string;
  status: "active" | "suspended";
  tier: "standard" | "plus";
  activatedAt: string;
  activatedBy: string; // admin userId
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  /** v17 Phase B — chapter scoping. */
  chapterId?: string;
  tenantId?: string;
};

const memberships = new Map<string, CollectiveMembershipRow>();

export function activate(
  userId: string,
  byAdminUserId: string,
  tier: "standard" | "plus" = "standard",
  opts?: { chapterId?: string },
): CollectiveMembershipRow {
  const chapterId = opts?.chapterId ?? DEFAULT_CHAPTER_ID;
  const tenantId = `tenant_chap_${chapterId}`;
  const now = new Date().toISOString();
  const row: CollectiveMembershipRow = {
    userId,
    status: "active",
    tier,
    activatedAt: now,
    activatedBy: byAdminUserId,
    deactivatedAt: null,
    deactivatedBy: null,
    chapterId,
    tenantId,
  };

  // v17 Phase B — DB write-through, transaction-wrapped.
  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      // Upsert by userId PK. Try insert; on conflict, update.
      try {
        tx.insert(collectiveMembershipsTable).values({
          userId,
          tenantId,
          chapterId,
          status: "active",
          tier,
          activatedAt: now,
          activatedBy: byAdminUserId,
          deactivatedAt: null,
          deactivatedBy: null,
          createdAt: now,
          updatedAt: now,
        } as any).run();
      } catch (_e) {
        tx.update(collectiveMembershipsTable)
          .set({
            tenantId,
            chapterId,
            status: "active",
            tier,
            activatedAt: now,
            activatedBy: byAdminUserId,
            deactivatedAt: null,
            deactivatedBy: null,
            updatedAt: now,
          } as any)
          .where(eq((collectiveMembershipsTable as any).userId, userId))
          .run();
      }
    });
  } catch (err) {
    log.warn(
      "[collectiveMembershipStore.activate] DB write failed (memory only):",
      (err as Error).message,
    );
  }

  memberships.set(userId, row);
  return row;
}

export function deactivate(userId: string, byAdminUserId: string): CollectiveMembershipRow | null {
  const existing = memberships.get(userId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const row: CollectiveMembershipRow = {
    ...existing,
    status: "suspended",
    deactivatedAt: now,
    deactivatedBy: byAdminUserId,
  };

  try {
    const db: any = getDb();
    db.transaction((tx: any) => {
      tx.update(collectiveMembershipsTable)
        .set({
          status: "suspended",
          deactivatedAt: now,
          deactivatedBy: byAdminUserId,
          updatedAt: now,
        } as any)
        .where(eq((collectiveMembershipsTable as any).userId, userId))
        .run();
    });
  } catch (err) {
    log.warn(
      "[collectiveMembershipStore.deactivate] DB update failed (memory only):",
      (err as Error).message,
    );
  }

  memberships.set(userId, row);
  return row;
}

export function isActive(userId: string): boolean {
  const row = memberships.get(userId);
  return !!row && row.status === "active";
}

export function get(userId: string): CollectiveMembershipRow | null {
  return memberships.get(userId) ?? null;
}

export function listActive(): CollectiveMembershipRow[] {
  return Array.from(memberships.values()).filter((m) => m.status === "active");
}

export function listAll(): CollectiveMembershipRow[] {
  return Array.from(memberships.values());
}

/** Test-only reset. */
export function _resetForTests(): void {
  memberships.clear();
}

/* ---------- v17 Phase B — hydrator ---------- */
export async function hydrateCollectiveMembershipStore(): Promise<void> {
  memberships.clear();
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(collectiveMembershipsTable)
      .where(isNull((collectiveMembershipsTable as any).deletedAt))
      .all() as any[];
    for (const r of rows) {
      const userId = r.user_id ?? r.userId;
      const row: CollectiveMembershipRow = {
        userId,
        status: (r.status ?? "active") as "active" | "suspended",
        tier: (r.tier ?? "standard") as "standard" | "plus",
        activatedAt: r.activated_at ?? r.activatedAt,
        activatedBy: r.activated_by ?? r.activatedBy,
        deactivatedAt: r.deactivated_at ?? r.deactivatedAt ?? null,
        deactivatedBy: r.deactivated_by ?? r.deactivatedBy ?? null,
        chapterId: r.chapter_id ?? r.chapterId,
        tenantId: r.tenant_id ?? r.tenantId,
      };
      memberships.set(userId, row);
    }
    if (rows.length > 0) {
      log.info(`[hydrate] collectiveMembershipStore: ${rows.length} memberships restored`);
    }
    // Suppress unused warning.
    void DEFAULT_CHAPTER_TENANT_ID;
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] collectiveMembershipStore: DB read failed:", msg);
    }
  }
}

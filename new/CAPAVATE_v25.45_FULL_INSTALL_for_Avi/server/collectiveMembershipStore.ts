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
import { getDb, rawDb } from "./db/connection";
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
  // v25.35 — FAIL-CLOSED: a swallowed DB write previously left the membership
  // in RAM only (lost on restart) while still returning success. Now we throw
  // so the caller route returns 500, and the cache mutation moves AFTER the
  // successful commit.
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
    // v25.35 — fail-closed: do NOT mutate cache; surface to route as 500.
    log.error(
      "[collectiveMembershipStore.activate] DB write failed:",
      (err as Error).message,
    );
    throw err;
  }

  // v25.35 — cache write-through only AFTER successful commit.
  memberships.set(userId, row);
  return row;
}

export function deactivate(userId: string, byAdminUserId: string): CollectiveMembershipRow | null {
  // v25.35 (item #50) — DB fallback on cache miss so a cold cache does not
  // produce a false 404 when deactivating a genuinely-existing membership.
  let existing = memberships.get(userId);
  if (!existing) {
    const dbRow = readMembershipFromDb(userId);
    if (dbRow) {
      memberships.set(userId, dbRow);
      existing = dbRow;
    }
  }
  if (!existing) return null;
  const now = new Date().toISOString();
  const row: CollectiveMembershipRow = {
    ...existing,
    status: "suspended",
    deactivatedAt: now,
    deactivatedBy: byAdminUserId,
  };

  // v25.35 — FAIL-CLOSED: previously swallowed the DB update and mutated the
  // cache anyway. Now throw on failure; cache mutation moves after commit.
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
    // v25.35 — fail-closed: do NOT mutate cache; surface to route as 500.
    log.error(
      "[collectiveMembershipStore.deactivate] DB update failed:",
      (err as Error).message,
    );
    throw err;
  }

  // v25.35 — cache write-through only AFTER successful commit.
  memberships.set(userId, row);
  return row;
}

/**
 * v25.35 — DB-direct single-row reader used as a fallback for cold-cache reads.
 * Uses rawDb() (better-sqlite3) so it works even when the Drizzle layer's Map
 * mirror has not been hydrated yet (e.g. immediately after restart, or in a
 * cross-process write scenario). Returns null on genuine absence or DB error
 * (callers treat a read error as a miss; write paths remain fail-closed).
 */
function readMembershipFromDb(userId: string): CollectiveMembershipRow | null {
  try {
    const r: any = rawDb()
      .prepare(
        "SELECT user_id, tenant_id, chapter_id, status, tier, activated_at, activated_by, deactivated_at, deactivated_by FROM collective_memberships WHERE user_id = ? AND deleted_at IS NULL",
      )
      .get(userId);
    if (!r) return null;
    return {
      userId: r.user_id,
      status: (r.status ?? "active") as "active" | "suspended",
      tier: (r.tier ?? "standard") as "standard" | "plus",
      activatedAt: r.activated_at,
      activatedBy: r.activated_by,
      deactivatedAt: r.deactivated_at ?? null,
      deactivatedBy: r.deactivated_by ?? null,
      chapterId: r.chapter_id,
      tenantId: r.tenant_id,
    };
  } catch (err) {
    log.warn(
      "[collectiveMembershipStore.readMembershipFromDb] DB fallback failed:",
      (err as Error).message,
    );
    return null;
  }
}

export function isActive(userId: string): boolean {
  // v25.35 (item #10/#11) — cache-first, DB-fallback. A cold cache after
  // restart previously locked active members out (403) because the Map was the
  // sole read authority. Now we consult the DB when the cache misses.
  const row = memberships.get(userId);
  if (row) return row.status === "active";
  const dbRow = readMembershipFromDb(userId);
  if (dbRow) {
    memberships.set(userId, dbRow); // opportunistic repopulate
    return dbRow.status === "active";
  }
  return false;
}

export function get(userId: string): CollectiveMembershipRow | null {
  // v25.35 (item #10) — cache-first, DB-fallback for cold-cache correctness.
  const cached = memberships.get(userId);
  if (cached) return cached;
  const dbRow = readMembershipFromDb(userId);
  if (dbRow) {
    memberships.set(userId, dbRow);
    return dbRow;
  }
  return null;
}

export function listActive(): CollectiveMembershipRow[] {
  // v24.5 GAP-1 fix: DB-fallback pattern (mirrors partnerTeamStore.findByUserId
  // from v24.4.1). The in-memory Map may be stale if:
  //   (a) The bootstrap activate() DB write succeeded but the Map.set() was
  //       somehow skipped (e.g. the server process received the write from a
  //       concurrent CLI invocation), or
  //   (b) The previous boot's hydration ran before a bootstrap POST was
  //       processed and the Map was not refreshed.
  // Strategy: read the DB, merge any rows not already present in the Map,
  // then return all active rows. Map stays as fast read-cache; DB is the
  // authoritative source for list operations.
  try {
    const db: any = getDb();
    const rows = db
      .select()
      .from(collectiveMembershipsTable)
      .all() as any[];
    for (const r of rows) {
      const userId = r.user_id ?? r.userId;
      if (!userId) continue;
      // v25.13 NM7 — prefer DB row when it is newer than the cached one.
      // The previous code unconditionally skipped any user already in the
      // Map, which meant a DB-side reactivation (e.g., direct write or
      // cross-process update) could not overwrite a stale "suspended"
      // entry until restart. We now compare the DB row's `updatedAt`
      // timestamp against the cached row's most-recent change timestamp
      // and let DB win when it is strictly newer.
      const status = (r.status ?? "active") as "active" | "suspended";
      const dbRow: CollectiveMembershipRow = {
        userId,
        status,
        tier: (r.tier ?? "standard") as "standard" | "plus",
        activatedAt: r.activated_at ?? r.activatedAt ?? new Date().toISOString(),
        activatedBy: r.activated_by ?? r.activatedBy ?? "",
        deactivatedAt: r.deactivated_at ?? r.deactivatedAt ?? null,
        deactivatedBy: r.deactivated_by ?? r.deactivatedBy ?? null,
        chapterId: r.chapter_id ?? r.chapterId,
        tenantId: r.tenant_id ?? r.tenantId,
      };
      const cached = memberships.get(userId);
      if (!cached) {
        memberships.set(userId, dbRow);
        continue;
      }
      const dbUpdated = r.updated_at ?? r.updatedAt ?? null;
      const cachedNewest =
        cached.deactivatedAt && cached.deactivatedAt > cached.activatedAt
          ? cached.deactivatedAt
          : cached.activatedAt;
      if (dbUpdated && cachedNewest && String(dbUpdated) > String(cachedNewest)) {
        memberships.set(userId, dbRow);
      }
    }
  } catch {
    // Non-fatal: fall through to Map-only read if DB is unavailable.
  }
  return Array.from(memberships.values()).filter((m) => m.status === "active");
}

export function listAll(): CollectiveMembershipRow[] {
  // v25.35 (item #10) — DB-merge before returning so a cold cache does not
  // under-report. Mirrors listActive()'s merge strategy: DB is authoritative,
  // Map is a fast read-cache. Read errors degrade to Map-only (non-fatal).
  try {
    const rows = rawDb()
      .prepare(
        "SELECT user_id, tenant_id, chapter_id, status, tier, activated_at, activated_by, deactivated_at, deactivated_by FROM collective_memberships WHERE deleted_at IS NULL",
      )
      .all() as any[];
    for (const r of rows) {
      if (!r.user_id) continue;
      if (!memberships.has(r.user_id)) {
        memberships.set(r.user_id, {
          userId: r.user_id,
          status: (r.status ?? "active") as "active" | "suspended",
          tier: (r.tier ?? "standard") as "standard" | "plus",
          activatedAt: r.activated_at,
          activatedBy: r.activated_by,
          deactivatedAt: r.deactivated_at ?? null,
          deactivatedBy: r.deactivated_by ?? null,
          chapterId: r.chapter_id,
          tenantId: r.tenant_id,
        });
      }
    }
  } catch {
    // Non-fatal: degrade to Map-only read.
  }
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

/**
 * Patch v10 — Collective Membership Store (C-CORE-1 / P0-10).
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
 * This store is consumed by:
 *   - `adminCollectiveRoutes.ts`         — approve/reject application → activate row.
 *   - `adminDscRoutes.ts`                — DSC promotion verifies `isActive(userId)`.
 *   - `collectiveRoutes.ts` (downstream) — capability gates can read `isActive(userId)`.
 *   - `routes.ts` (`/api/me/membership`) — client-side surface check.
 *
 * No persistence layer — in-memory map matching the rest of the audit tree.
 */
export type CollectiveMembershipRow = {
  userId: string;
  status: "active" | "suspended";
  tier: "standard" | "plus";
  activatedAt: string;
  activatedBy: string; // admin userId
  deactivatedAt: string | null;
  deactivatedBy: string | null;
};

const memberships = new Map<string, CollectiveMembershipRow>();

export function activate(userId: string, byAdminUserId: string, tier: "standard" | "plus" = "standard"): CollectiveMembershipRow {
  const row: CollectiveMembershipRow = {
    userId,
    status: "active",
    tier,
    activatedAt: new Date().toISOString(),
    activatedBy: byAdminUserId,
    deactivatedAt: null,
    deactivatedBy: null,
  };
  memberships.set(userId, row);
  return row;
}

export function deactivate(userId: string, byAdminUserId: string): CollectiveMembershipRow | null {
  const existing = memberships.get(userId);
  if (!existing) return null;
  const row: CollectiveMembershipRow = {
    ...existing,
    status: "suspended",
    deactivatedAt: new Date().toISOString(),
    deactivatedBy: byAdminUserId,
  };
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

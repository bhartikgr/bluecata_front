/**
 * Sprint 11 — Investor membership toggle + strict gating.
 *
 * Per audit: an investor on a Capavate cap table CAN apply to the Capavate
 * Collective. If their membership lapses (renewal not paid), the toggle
 * disappears and they lose Collective access — but they retain access to
 * Capavate communications gated by their cap-table position.
 *
 * The strict-gating model says: an investor NOT on any cap table sees
 * 0 communications, 0 company info, 0 dataroom files, 0 messages. Server
 * guards return 403 on every related endpoint when the requester fails
 * the cap-table check.
 *
 * Routes:
 *   GET  /api/collective/membership-status
 *   GET  /api/founder/access-check?investorId=...&companyId=...
 */
import type { Express, Request, Response } from "express";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { getLedger } from "./captableCommitStore";
import { persistEntry, hydrateEntries } from "./lib/storePersistenceShim";

const PERSIST_STORE = "membershipStore";

type MembershipStatus = {
  userId: string;
  isCollectiveMember: boolean;
  memberSince: string | null;
  expiresAt: string | null;
  lapsed: boolean;
  reason: string;
  capTablePositions: Array<{ companyId: string; companyName: string; ownershipPct: number }>;
  canApplyToCollective: boolean;
};

// Demo: a small set of mock investor users with diverse states.
// Patch v4: only populated when demo gate is on.
const MOCK_MEMBERSHIP: Record<string, MembershipStatus> = DEMO_SEED_ENABLED ? {
  u_aisha_patel: {
    userId: "u_aisha_patel",
    isCollectiveMember: true,
    memberSince: "2025-03-01",
    expiresAt: "2026-12-31",
    lapsed: false,
    reason: "Active member on cap table for 2 companies.",
    capTablePositions: [
      { companyId: "co_novapay",  companyName: "NovaPay AI",     ownershipPct: 0.041 },
      { companyId: "co_arboreal", companyName: "Arboreal Health", ownershipPct: 0.012 },
    ],
    canApplyToCollective: true,
  },
  u_lapsed_lp: {
    userId: "u_lapsed_lp",
    isCollectiveMember: false,
    memberSince: "2024-04-01",
    expiresAt: "2025-12-31",
    lapsed: true,
    reason: "Membership renewal lapsed; Collective access removed but cap-table comms remain.",
    capTablePositions: [
      { companyId: "co_novapay", companyName: "NovaPay AI", ownershipPct: 0.018 },
    ],
    canApplyToCollective: false,
  },
  u_no_position: {
    userId: "u_no_position",
    isCollectiveMember: false,
    memberSince: null,
    expiresAt: null,
    lapsed: false,
    reason: "No cap-table positions — strict gating denies all Capavate access.",
    capTablePositions: [],
    canApplyToCollective: false,
  },
} : {};

/**
 * V4 (Patch v8) — Derive cap-table positions from the canonical ledger.
 *
 * Previously, MOCK_MEMBERSHIP was the single source of truth for whether an
 * investor was "on the cap table" of a company. Commits to captableCommitStore
 * were never reflected in entitlement gates. This function reads the ledger
 * for `committed` entries belonging to `userId` and exposes them as
 * `capTablePositions`, with a small in-memory index keyed by
 * (investorId, companyId) keyed off the ledger length to avoid scanning.
 *
 * IMPORTANT: this does NOT touch packages/cap-table-engine* math. It only
 * reads getLedger() and projects committed entries.
 */
let _ledgerIndexLen = -1;
let _ledgerIndex: Map<string, Map<string, { companyId: string; ownershipPct: number; companyName: string }>> = new Map();

function rebuildLedgerIndexIfStale(): void {
  const ledger = getLedger();
  if (ledger.length === _ledgerIndexLen) return;
  const idx = new Map<string, Map<string, { companyId: string; ownershipPct: number; companyName: string }>>();
  for (const e of ledger) {
    if (e.state !== "committed") continue;
    let perUser = idx.get(e.investorId);
    if (!perUser) { perUser = new Map(); idx.set(e.investorId, perUser); }
    // ownershipPct is unknown from ledger alone; use 0 as a sentinel — gates only
    // care about presence/absence. UI surfaces should compute pct from the engine.
    perUser.set(e.companyId, { companyId: e.companyId, ownershipPct: 0, companyName: e.companyId });
  }
  _ledgerIndex = idx;
  _ledgerIndexLen = ledger.length;
}

function derivedPositionsFor(userId: string): Array<{ companyId: string; companyName: string; ownershipPct: number }> {
  rebuildLedgerIndexIfStale();
  const per = _ledgerIndex.get(userId);
  if (!per) return [];
  return Array.from(per.values()).map((p) => ({
    companyId: p.companyId,
    companyName: p.companyName,
    ownershipPct: p.ownershipPct,
  }));
}

/**
 * Merge MOCK_MEMBERSHIP seed (for tests/dev) with ledger-derived positions
 * (for runtime cap-table commits). Ledger wins on companyId conflict.
 */
function mergedMembership(userId: string): MembershipStatus | null {
  const seed = MOCK_MEMBERSHIP[userId] ?? null;
  const derived = derivedPositionsFor(userId);
  if (!seed && derived.length === 0) return null;
  const base: MembershipStatus = seed ?? {
    userId,
    isCollectiveMember: false,
    memberSince: null,
    expiresAt: null,
    lapsed: false,
    reason: derived.length > 0 ? `Active member on cap table for ${derived.length} compan${derived.length === 1 ? "y" : "ies"}.` : "No cap-table positions.",
    capTablePositions: [],
    canApplyToCollective: derived.length > 0,
  };
  if (derived.length === 0) return base;
  const seen = new Set(base.capTablePositions.map((p) => p.companyId));
  const merged = base.capTablePositions.slice();
  for (const p of derived) {
    if (!seen.has(p.companyId)) {
      merged.push(p);
      seen.add(p.companyId);
    }
  }
  return { ...base, capTablePositions: merged, canApplyToCollective: base.canApplyToCollective || merged.length > 0 };
}

/**
 * v16 F-coll-X3 — dual-write helper for admin approval.
 *
 * `collectiveMembershipStore` (admin approval target) and this module's
 * `MOCK_MEMBERSHIP` overlay (the source `buildCollectiveOverlay` /
 * `gate("collective.active")` reads) used to diverge: admin approval wrote
 * to ONE map, the entitlement gate read the OTHER. v16 unifies by having
 * the admin approval call BOTH stores.
 *
 * This helper upserts a minimal active record so `getMembership(userId)`
 * returns `isCollectiveMember: true`. It does NOT fabricate cap-table
 * positions — those still flow from the ledger via `mergedMembership`.
 */
export function upsertActiveMembership(
  userId: string,
  opts?: { memberSince?: string; expiresAt?: string },
): MembershipStatus {
  const now = new Date().toISOString();
  const existing = MOCK_MEMBERSHIP[userId];
  const next: MembershipStatus = existing
    ? {
        ...existing,
        isCollectiveMember: true,
        memberSince: existing.memberSince ?? opts?.memberSince ?? now,
        expiresAt: opts?.expiresAt ?? existing.expiresAt ?? null,
        lapsed: false,
        reason: "Activated by admin approval (v16 unified write).",
        canApplyToCollective: true,
      }
    : {
        userId,
        isCollectiveMember: true,
        memberSince: opts?.memberSince ?? now,
        expiresAt: opts?.expiresAt ?? null,
        lapsed: false,
        reason: "Activated by admin approval (v16 unified write).",
        capTablePositions: [],
        canApplyToCollective: true,
      };
  MOCK_MEMBERSHIP[userId] = next;
  /* v25.9 — persist so admin approval survives restart.
   * Avi: "Most of the records are being saved in memory instead of the DB." */
  persistEntry(PERSIST_STORE, userId, next);
  return next;
}

/**
 * v16 F-coll-X3 — companion deactivation helper for symmetric admin flows.
 * Marks the membership as not-collective without dropping cap-table positions.
 */
export function deactivateMembership(userId: string): MembershipStatus | null {
  const existing = MOCK_MEMBERSHIP[userId];
  if (!existing) return null;
  const next: MembershipStatus = {
    ...existing,
    isCollectiveMember: false,
    lapsed: true,
    reason: "Deactivated by admin (v16 unified write).",
  };
  MOCK_MEMBERSHIP[userId] = next;
  /* v25.9 — persist deactivation */
  persistEntry(PERSIST_STORE, userId, next);
  return next;
}

export function isCollectiveMember(userId: string, asOf: Date = new Date()): boolean {
  const m = MOCK_MEMBERSHIP[userId];
  if (!m) return false;
  if (!m.isCollectiveMember) return false;
  if (m.expiresAt && new Date(m.expiresAt) < asOf) return false;
  return true;
}

export function getMembership(userId: string): MembershipStatus | null {
  return mergedMembership(userId);
}

export function isOnCapTable(userId: string, companyId?: string): boolean {
  const m = mergedMembership(userId);
  if (!m) return false;
  if (!companyId) return m.capTablePositions.length > 0;
  return m.capTablePositions.some((p) => p.companyId === companyId);
}

/**
 * V4 — Public API used by routes/entitlement gates. Returns all
 * users currently on a company's cap table (derived from the ledger
 * plus the seed map).
 */
export function listMembersForCompany(companyId: string): Array<{ userId: string; companyId: string; ownershipPct: number }> {
  const out: Array<{ userId: string; companyId: string; ownershipPct: number }> = [];
  // Seed fixtures
  for (const [uid, m] of Object.entries(MOCK_MEMBERSHIP)) {
    const pos = m.capTablePositions.find((p) => p.companyId === companyId);
    if (pos) out.push({ userId: uid, companyId, ownershipPct: pos.ownershipPct });
  }
  // Ledger commits
  rebuildLedgerIndexIfStale();
  for (const [uid, per] of _ledgerIndex.entries()) {
    if (out.some((r) => r.userId === uid)) continue;
    const pos = per.get(companyId);
    if (pos) out.push({ userId: uid, companyId, ownershipPct: pos.ownershipPct });
  }
  return out;
}

/**
 * Strict-gating middleware.
 * Returns 403 when the requester is an investor with zero cap-table positions.
 * Founders/admins always pass. Pass `?as=founder|admin` to simulate that role.
 */
export function strictGatingGuard(req: Request, res: Response, next: () => void): void {
  const role = String(req.query.as ?? "investor");
  if (role === "founder" || role === "admin") return next();
  // v14 Fix 2: identity comes from session (loadUserContext); query override
  // only honored in non-prod environments for demo/QA harnesses.
  const sessionUserId = (req as any).userContext?.userId as string | undefined;
  const isProd = String(process.env.NODE_ENV ?? "").toLowerCase() === "production";
  const userId = String(
    sessionUserId ?? (isProd ? "" : (req.query.investorId ?? "")),
  );
  if (!userId) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!isOnCapTable(userId)) {
    res.status(403).json({
      error: "strict_gating_denied",
      message: "Investor must be on at least one Capavate cap table to access communications, company info, or dataroom.",
      userId,
    });
    return;
  }
  next();
}

export function registerMembershipRoutes(app: Express): void {
  app.get("/api/collective/membership-status", (req: Request, res: Response) => {
    // v14 — default to caller's identity, never the demo investor persona.
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const queryUserId = typeof req.query.userId === "string" ? req.query.userId : null;
    const userId = queryUserId ?? ctx?.userId ?? null;
    if (!userId) return res.status(401).json({ error: "missing_identity" });
    const m = getMembership(userId);
    if (!m) return res.status(404).json({ error: "user_not_found" });
    res.json(m);
  });

  app.get("/api/founder/access-check", (req: Request, res: Response) => {
    // v14 — require explicit params; no demo persona/company fallback.
    const userId = typeof req.query.investorId === "string" ? req.query.investorId : "";
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : "";
    if (!userId || !companyId) {
      return res.status(400).json({ error: "investorId_and_companyId_required" });
    }
    const onTable = isOnCapTable(userId, companyId);
    res.json({
      userId,
      companyId,
      isOnCapTable: onTable,
      canSeeCompany: onTable,
      canSeeCommunications: onTable,
      canSeeDataroom: onTable,
      enforcedAt: new Date().toISOString(),
    });
  });
}

/**
 * v25.9 — Rehydrate memberships from DB on boot.
 */
export async function hydrateMembershipStore(): Promise<void> {
  try {
    const entries = hydrateEntries<MembershipStatus>(PERSIST_STORE);
    for (const [userId, m] of entries) MOCK_MEMBERSHIP[userId] = m;
    if (entries.length > 0) {
      console.info(`[hydrate] membershipStore: ${entries.length} memberships restored`);
    }
  } catch (err) {
    console.warn(`[hydrate] membershipStore: DB read failed (non-fatal): ${(err as Error).message}`);
  }
}

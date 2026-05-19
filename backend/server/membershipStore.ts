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
  const userId = String(req.query.investorId ?? "u_aisha_patel");
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
    const userId = String(req.query.userId ?? "u_aisha_patel");
    const m = getMembership(userId);
    if (!m) return res.status(404).json({ error: "user_not_found" });
    res.json(m);
  });

  app.get("/api/founder/access-check", (req: Request, res: Response) => {
    const userId = String(req.query.investorId ?? "u_aisha_patel");
    const companyId = String(req.query.companyId ?? "co_novapay");
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

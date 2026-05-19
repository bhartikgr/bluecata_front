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
const MOCK_MEMBERSHIP: Record<string, MembershipStatus> = {
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
};

export function isCollectiveMember(userId: string, asOf: Date = new Date()): boolean {
  const m = MOCK_MEMBERSHIP[userId];
  if (!m) return false;
  if (!m.isCollectiveMember) return false;
  if (m.expiresAt && new Date(m.expiresAt) < asOf) return false;
  return true;
}

export function getMembership(userId: string): MembershipStatus | null {
  return MOCK_MEMBERSHIP[userId] ?? null;
}

export function isOnCapTable(userId: string, companyId?: string): boolean {
  const m = MOCK_MEMBERSHIP[userId];
  if (!m) return false;
  if (!companyId) return m.capTablePositions.length > 0;
  return m.capTablePositions.some((p) => p.companyId === companyId);
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

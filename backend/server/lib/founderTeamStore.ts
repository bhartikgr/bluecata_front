/**
 * v25.7 — Founder team store (real, DB-backed).
 *
 * Closes the v24.x P1 gap where /api/founder/team/invitations and
 * DELETE /api/founder/team/members/:id returned 501 not_implemented.
 *
 * Surface:
 *   POST   /api/founder/team/invitations   — invite a teammate to a company
 *   DELETE /api/founder/team/members/:id   — remove a teammate (own row or owner-only)
 *   GET    /api/founder/team/invitations   — list pending invitations
 *
 * Schema (idempotent CREATE TABLE):
 *   founder_team_invitations(id, company_id, invited_by_user_id, invited_email,
 *                            invited_name, role, status, token_hash,
 *                            expires_at, created_at, accepted_at, deleted_at)
 *   founder_team_members(id, company_id, user_id, email, role,
 *                        joined_at, removed_at)
 *
 * Auth: requireAuth; only the founder who owns the target companyId may invite
 *       or remove. Admin bypass is honored.
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { log } from "./logger";

const VALID_ROLES = ["owner", "admin", "member", "viewer"] as const;
type TeamRole = (typeof VALID_ROLES)[number];

let tableReady = false;
function ensureTables(): void {
  if (tableReady) return;
  try {
    const db: any = rawDb();
    db.exec(`CREATE TABLE IF NOT EXISTS founder_team_invitations (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      invited_by_user_id TEXT NOT NULL,
      invited_email TEXT NOT NULL,
      invited_name TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      status TEXT NOT NULL DEFAULT 'pending',
      token_hash TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      deleted_at TEXT
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fti_company ON founder_team_invitations(company_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_fti_email ON founder_team_invitations(invited_email);`);

    db.exec(`CREATE TABLE IF NOT EXISTS founder_team_members (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      removed_at TEXT
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ftm_company ON founder_team_members(company_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ftm_user ON founder_team_members(user_id);`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ftm_company_user ON founder_team_members(company_id, user_id);`);
    tableReady = true;
  } catch (err) {
    log.warn({
      route: "founderTeamStore.ensureTables",
      message: `CREATE TABLE failed (non-fatal): ${(err as Error).message}`,
    });
    tableReady = true;
  }
}

function ownsCompany(req: Request, companyId: string): boolean {
  const ctx: any = (req as any).userContext;
  if (!ctx) return false;
  if (ctx.isAdmin) return true;
  const owned = Array.isArray(ctx.founder?.companies) ? ctx.founder.companies : [];
  return owned.some((c: any) => (c?.companyId ?? c?.id) === companyId);
}

export function registerFounderTeamRoutes(app: Express): void {
  ensureTables();

  /**
   * POST /api/founder/team/invitations
   * Body: { companyId, email, name?, role? }
   * Creates a real persisted invitation row + emits a bridge event.
   * NOTE the legacy stub at /api/founder/team/invitations in routes.ts MUST be
   * removed/overridden — this function is registered BEFORE that route by
   * routes.ts wiring order (v25.7).
   */
  app.post("/api/founder/team/invitations", async (req: Request, res: Response) => {
    const ctx: any = (req as any).userContext;
    if (!ctx?.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const body = req.body ?? {};
    const companyId = String(body.companyId ?? body.company_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = body.name ? String(body.name).trim() : null;
    const roleRaw = String(body.role ?? "member").toLowerCase();

    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId_required" });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "invalid_email" });
    }
    if (!VALID_ROLES.includes(roleRaw as TeamRole)) {
      return res.status(400).json({ ok: false, error: "invalid_role", allowed: VALID_ROLES });
    }
    if (!ownsCompany(req, companyId)) {
      return res.status(403).json({ ok: false, error: "not_owner" });
    }

    const id = `fti_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const db: any = rawDb();
      /* Idempotency: if a pending invitation already exists for the
       * same company + email, return the existing row (avoid duplicates). */
      const existing = db
        .prepare(
          `SELECT * FROM founder_team_invitations
            WHERE company_id = ? AND invited_email = ? AND status = 'pending' AND deleted_at IS NULL
            LIMIT 1`,
        )
        .get(companyId, email);
      if (existing) {
        return res.json({ ok: true, invitation: existing, idempotent: true });
      }

      db.prepare(
        `INSERT INTO founder_team_invitations (
           id, company_id, invited_by_user_id, invited_email, invited_name,
           role, status, token_hash, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).run(id, companyId, ctx.userId, email, name, roleRaw, tokenHash, expires, now);

      /* Bridge event so other components (e.g. notification campaign worker,
       * partner sync) can react. */
      try {
        const { emitBridge } = require("../bridgeStore");
        emitBridge("founderTeam.invitation_sent", id, "founderTeamInvitation", {
          invitationId: id,
          companyId,
          invitedEmail: email,
          role: roleRaw,
        });
      } catch { /* bridge optional */ }

      return res.status(201).json({
        ok: true,
        invitation: {
          id,
          companyId,
          invitedEmail: email,
          invitedName: name,
          role: roleRaw,
          status: "pending",
          expiresAt: expires,
          createdAt: now,
        },
        redeemUrl: `https://capavate.com/team/invite/${token}`,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "insert_failed", message: (err as Error).message });
    }
  });

  /**
   * GET /api/founder/team/invitations?companyId=...
   * Lists pending invitations for the caller's company.
   */
  app.get("/api/founder/team/invitations", (req: Request, res: Response) => {
    const ctx: any = (req as any).userContext;
    if (!ctx?.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const companyId = String(req.query.companyId ?? "");
    if (!companyId) {
      return res.status(400).json({ ok: false, error: "companyId_required" });
    }
    if (!ownsCompany(req, companyId)) {
      return res.status(403).json({ ok: false, error: "not_owner" });
    }
    try {
      const db: any = rawDb();
      const rows: any[] = db
        .prepare(
          `SELECT * FROM founder_team_invitations
            WHERE company_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC`,
        )
        .all(companyId);
      return res.json({ ok: true, invitations: rows });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "list_failed", message: (err as Error).message });
    }
  });

  /**
   * DELETE /api/founder/team/members/:id
   * Soft-deletes a team member. Owner-only (or admin bypass).
   */
  app.delete("/api/founder/team/members/:id", (req: Request, res: Response) => {
    const ctx: any = (req as any).userContext;
    if (!ctx?.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const memberId = String(req.params.id);
    try {
      const db: any = rawDb();
      const row: any = db
        .prepare("SELECT * FROM founder_team_members WHERE id = ? AND removed_at IS NULL")
        .get(memberId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
      if (!ownsCompany(req, row.company_id)) {
        return res.status(403).json({ ok: false, error: "not_owner" });
      }
      db.prepare(
        "UPDATE founder_team_members SET removed_at = ? WHERE id = ?",
      ).run(new Date().toISOString(), memberId);
      try {
        const { emitBridge } = require("../bridgeStore");
        emitBridge("founderTeam.member_removed", memberId, "founderTeamMember", {
          memberId, companyId: row.company_id, userId: row.user_id,
        });
      } catch { /* bridge optional */ }
      return res.json({ ok: true, memberId, removed: true });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "delete_failed", message: (err as Error).message });
    }
  });
}

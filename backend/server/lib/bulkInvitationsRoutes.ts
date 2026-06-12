/**
 * v25.7 — Bulk round invitations (real implementation).
 *
 * Closes the v24.0 lockdown 501 gap at:
 *   POST /api/rounds/:id/invitations/bulk
 *
 * Behavior:
 *   - Body: { invitations: Array<{ email, name? }>, message? }
 *   - For each row, calls the existing single-invitation create handler logic
 *     by inserting into round_invitations directly (mirrors single-invite
 *     persistence + bridge event).
 *   - Returns { ok, created: <ids>, skipped: <reasons> } so the client can
 *     show "created 8, skipped 2 (already invited)".
 *   - Founder ownership check on the round, mirroring the single-invite path.
 *
 * Limits: max 100 invitations per call (protects against accidental bulk
 * loads). Beyond that the client must paginate.
 */

import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { log } from "./logger";

const MAX_BULK = 100;

function ownsRound(req: Request, roundId: string): { ok: boolean; companyId?: string } {
  const ctx: any = (req as any).userContext;
  if (!ctx) return { ok: false };
  try {
    const db: any = rawDb();
    const row: any = db
      .prepare("SELECT company_id FROM rounds WHERE id = ?")
      .get(roundId);
    if (!row) return { ok: false };
    if (ctx.isAdmin) return { ok: true, companyId: row.company_id };
    const owned = Array.isArray(ctx.founder?.companies) ? ctx.founder.companies : [];
    const owns = owned.some((c: any) => (c?.companyId ?? c?.id) === row.company_id);
    return { ok: owns, companyId: row.company_id };
  } catch {
    return { ok: false };
  }
}

export function registerBulkInvitationsRoutes(app: Express): void {
  /**
   * POST /api/rounds/:id/invitations/bulk
   * Body: { invitations: [{ email, name? }, ...], message? }
   */
  app.post("/api/rounds/:id/invitations/bulk", async (req: Request, res: Response) => {
    const ctx: any = (req as any).userContext;
    if (!ctx?.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const roundId = String(req.params.id);
    const owner = ownsRound(req, roundId);
    if (!owner.ok) {
      return res.status(403).json({ ok: false, error: "not_owner" });
    }
    const body = req.body ?? {};
    const list = Array.isArray(body.invitations) ? body.invitations : [];
    if (list.length === 0) {
      return res.status(400).json({ ok: false, error: "invitations_required" });
    }
    if (list.length > MAX_BULK) {
      return res
        .status(413)
        .json({ ok: false, error: "too_many", max: MAX_BULK, given: list.length });
    }

    const created: Array<{ id: string; email: string; redeemUrl: string }> = [];
    const skipped: Array<{ email: string; reason: string }> = [];

    try {
      const db: any = rawDb();
      const insert = db.prepare(
        `INSERT OR IGNORE INTO round_invitations (
           id, tenant_id, round_id, company_id, investor_email, investor_name,
           state, classification, invited_by_user_id, note,
           sent_at, expires_at, token_hash, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'sent', 'new_registration', ?, ?, ?, ?, ?, ?, ?)`,
      );
      const tenantId = `tenant_co_${owner.companyId}`;
      const now = new Date().toISOString();
      const expiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

      for (const entry of list) {
        const email = String(entry?.email ?? "").trim().toLowerCase();
        const name = entry?.name ? String(entry.name).trim() : null;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          skipped.push({ email: entry?.email ?? "<missing>", reason: "invalid_email" });
          continue;
        }
        /* De-dup: if this round already has a pending invitation for this
         * email, skip and report. */
        const existing = db
          .prepare(
            `SELECT id FROM round_invitations
              WHERE round_id = ? AND investor_email = ? AND state IN ('sent','viewed')
              LIMIT 1`,
          )
          .get(roundId, email);
        if (existing) {
          skipped.push({ email, reason: "already_invited" });
          continue;
        }
        const invId = `inv_${roundId}_${randomBytes(8).toString("hex")}`;
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const result = insert.run(
          invId,
          tenantId,
          roundId,
          owner.companyId,
          email,
          name,
          ctx.userId,
          body.message ? String(body.message).slice(0, 1000) : null,
          now,
          expiry,
          tokenHash,
          now,
          now,
        );
        if (result.changes > 0) {
          created.push({ id: invId, email, redeemUrl: `https://capavate.com/invite/${token}` });
          /* Emit bridge event per invitation so downstream (notifications,
           * CRM auto-link) see them individually. */
          try {
            const { emitBridge } = require("../bridgeStore");
            emitBridge("round.invitation_sent", invId, "roundInvitation", {
              invitationId: invId, roundId, companyId: owner.companyId, investorEmail: email,
            });
          } catch { /* bridge optional */ }
        } else {
          skipped.push({ email, reason: "insert_collision" });
        }
      }

      return res.json({
        ok: true,
        created,
        skipped,
        summary: { created: created.length, skipped: skipped.length, total: list.length },
      });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "bulk_failed", message: (err as Error).message });
    }
  });
}

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
// v25.20 Lane 6 NC fix: bulk CSV invitations previously persisted rows but
// never sent emails — invitees were silently invited and never knew. Mirror
// the single-invitation path: sendMail + escapeHtml + best-effort try/catch.
import { sendMail } from "../emailTransport";
import { escapeHtml as e } from "./htmlEscape";
import { getCompanyNameById } from "../multiCompanyStore";
import { getRoundById } from "../roundsStore";

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
      const existsStmt = db.prepare(
        `SELECT id FROM round_invitations
          WHERE round_id = ? AND investor_email = ? AND state IN ('sent','viewed')
          LIMIT 1`,
      );
      const tenantId = `tenant_co_${owner.companyId}`;
      const now = new Date().toISOString();
      const expiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const noteText = body.message ? String(body.message).slice(0, 1000) : null;

      // v25.20 Lane 1 NM fix: stage validation + token generation first, then
      // apply ALL inserts in a single SQLite transaction. If any insert
      // throws mid-batch, better-sqlite3's atomic transaction wrapper rolls
      // the entire batch back — we never leave half-committed rows. Emails +
      // bridge events run AFTER commit so a slow SMTP server can't hold a
      // write lock and an email failure can't poison a successful DB commit.
      type Pending = {
        invId: string;
        token: string;
        tokenHash: string;
        email: string;
        name: string | null;
      };
      const pending: Pending[] = [];
      const seenInBatch = new Set<string>();

      for (const entry of list) {
        const email = String(entry?.email ?? "").trim().toLowerCase();
        const name = entry?.name ? String(entry.name).trim() : null;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          skipped.push({ email: entry?.email ?? "<missing>", reason: "invalid_email" });
          continue;
        }
        if (seenInBatch.has(email)) {
          // Dedup within the same CSV (someone listed the same address twice).
          skipped.push({ email, reason: "duplicate_in_batch" });
          continue;
        }
        const existing = existsStmt.get(roundId, email);
        if (existing) {
          skipped.push({ email, reason: "already_invited" });
          continue;
        }
        seenInBatch.add(email);
        const invId = `inv_${roundId}_${randomBytes(8).toString("hex")}`;
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        pending.push({ invId, token, tokenHash, email, name });
      }

      // Atomic insert phase.
      const committed: Pending[] = [];
      const insertAll = db.transaction((rows: Pending[]) => {
        for (const r of rows) {
          const result = insert.run(
            r.invId,
            tenantId,
            roundId,
            owner.companyId,
            r.email,
            r.name,
            ctx.userId,
            noteText,
            now,
            expiry,
            r.tokenHash,
            now,
            now,
          );
          if (result.changes > 0) {
            committed.push(r);
          } else {
            // Race: another caller inserted between our pre-check and insert.
            skipped.push({ email: r.email, reason: "insert_collision" });
          }
        }
      });
      insertAll(pending);

      // Post-commit: emails + bridge events. Failures here do NOT roll back
      // the DB rows — the invitations exist; the founder can re-send from UI.
      const baseUrl =
        process.env.INVITATION_BASE_URL ??
        process.env.APP_URL ??
        "https://capavate.com";
      let companyName = "a company";
      let roundName = "a funding round";
      try {
        const resolvedCompany = getCompanyNameById(owner.companyId!);
        if (resolvedCompany && resolvedCompany.trim()) companyName = resolvedCompany.trim();
      } catch { /* non-fatal */ }
      try {
        const resolvedRound = getRoundById(roundId);
        if (resolvedRound?.name && resolvedRound.name.trim()) roundName = resolvedRound.name.trim();
      } catch { /* non-fatal */ }

      for (const r of committed) {
        const link = `${baseUrl}/auth/redeem?token=${encodeURIComponent(r.token)}`;
        try {
          await sendMail({
            to: r.email,
            subject: `[Capavate] You're invited to ${companyName} — ${roundName}`,
            html:
              `<p>Hi ${e(r.name ?? "there")},</p>` +
              `<p>You've been invited to participate in <strong>${e(roundName)}</strong> at <strong>${e(companyName)}</strong>.</p>` +
              `<p><a href="${e(link)}">Click here to view the invitation</a></p>` +
              (noteText ? `<p>Note from the founder: ${e(noteText)}</p>` : "") +
              `<p>This invitation expires in 14 days.</p>`,
            text:
              `You've been invited to participate in ${roundName} at ${companyName} on Capavate.\n` +
              `View it here: ${link}\n` +
              (noteText ? `Note: ${noteText}\n` : "") +
              `This invitation expires in 14 days.`,
          });
        } catch (mailErr) {
          log.warn(
            "[bulkInvitationsRoutes] email send failed (continuing):",
            (mailErr as Error).message,
          );
        }
        created.push({ id: r.invId, email: r.email, redeemUrl: link });
        try {
          const { emitBridge } = require("../bridgeStore");
          emitBridge("round.invitation_sent", r.invId, "roundInvitation", {
            invitationId: r.invId, roundId, companyId: owner.companyId, investorEmail: r.email,
          });
        } catch { /* bridge optional */ }
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

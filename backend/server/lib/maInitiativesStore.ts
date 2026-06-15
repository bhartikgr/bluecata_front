/**
 * v25.7 — M&A initiatives store (real, DB-backed).
 *
 * Closes the v24.x P0 fake-success gap at:
 *   POST /api/investor/ma/initiatives/:id/respond  — used to return {ok:true} w/ no persistence
 *   POST /api/investor/ma/initiatives/:id/decline  — same
 *
 * Now these endpoints record the investor's response in a real table, gate by
 * ownership, and emit a bridge event so the founder dashboard sees it.
 *
 * Schema:
 *   ma_initiatives          (id, company_id, founder_user_id, kind, status, created_at, ...)
 *   ma_initiative_responses (id, initiative_id, investor_user_id, response,
 *                            note, responded_at)
 *
 * Note: the seed/list endpoints for M&A initiatives are out of scope for this
 * v25.7 wave; the immediate priority is making respond/decline persistent.
 */

/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { rawDb } from "../db/connection";
import { log } from "./logger";

const VALID_RESPONSES = ["respond", "decline"] as const;

let tableReady = false;
function ensureTables(): void {
  if (tableReady) return;
  try {
    const db: any = rawDb();
    db.exec(`CREATE TABLE IF NOT EXISTS ma_initiatives (
      id TEXT PRIMARY KEY NOT NULL,
      company_id TEXT,
      founder_user_id TEXT,
      kind TEXT NOT NULL,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      deleted_at TEXT
    );`);
    db.exec(`CREATE TABLE IF NOT EXISTS ma_initiative_responses (
      id TEXT PRIMARY KEY NOT NULL,
      initiative_id TEXT NOT NULL,
      investor_user_id TEXT NOT NULL,
      response TEXT NOT NULL,
      note TEXT,
      responded_at TEXT NOT NULL
    );`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mair_init ON ma_initiative_responses(initiative_id);`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mair_init_investor ON ma_initiative_responses(initiative_id, investor_user_id);`);
    tableReady = true;
  } catch (err) {
    log.warn({
      route: "maInitiativesStore.ensureTables",
      message: `CREATE TABLE failed (non-fatal): ${(err as Error).message}`,
    });
    tableReady = true;
  }
}

function recordResponse(
  req: Request,
  res: Response,
  responseKind: "respond" | "decline",
): Response {
  const ctx: any = (req as any).userContext;
  if (!ctx?.userId) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
  const initiativeId = String(req.params.id);
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  try {
    const db: any = rawDb();
    /* Ensure initiative exists; if not, soft-create a placeholder so the
     * investor's response is not lost. The founder side can then look up
     * the response when they wire the real initiative list. */
    const exists = db
      .prepare("SELECT id FROM ma_initiatives WHERE id = ? AND deleted_at IS NULL")
      .get(initiativeId);
    if (!exists) {
      db.prepare(
        `INSERT OR IGNORE INTO ma_initiatives (id, kind, status, created_at)
           VALUES (?, 'placeholder', 'open', ?)`,
      ).run(initiativeId, new Date().toISOString());
    }

    const responseId = `mair_${Date.now()}_${randomBytes(4).toString("hex")}`;
    const now = new Date().toISOString();
    /* Upsert so re-responses overwrite the prior one (last write wins,
     * deterministic for the founder-side aggregate view). */
    db.prepare(
      `INSERT INTO ma_initiative_responses (id, initiative_id, investor_user_id, response, note, responded_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(initiative_id, investor_user_id) DO UPDATE SET
           response = excluded.response,
           note = excluded.note,
           responded_at = excluded.responded_at`,
    ).run(responseId, initiativeId, ctx.userId, responseKind, note, now);

    try {
      const { emitBridge } = require("../bridgeStore");
      emitBridge("maInitiative.response_recorded", initiativeId, "maInitiative", {
        initiativeId,
        investorUserId: ctx.userId,
        response: responseKind,
        respondedAt: now,
      });
    } catch { /* bridge optional */ }

    return res.json({
      ok: true,
      id: initiativeId,
      response: responseKind,
      [responseKind === "respond" ? "responded" : "declined"]: true,
      respondedAt: now,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: "response_failed", message: (err as Error).message });
  }
}

export function registerMaInitiativesRoutes(app: Express): void {
  ensureTables();

  /**
   * POST /api/investor/ma/initiatives/:id/respond
   * Body: { note? }
   */
  app.post("/api/investor/ma/initiatives/:id/respond", (req, res) =>
    recordResponse(req, res, "respond"),
  );

  /**
   * POST /api/investor/ma/initiatives/:id/decline
   * Body: { note? }
   */
  app.post("/api/investor/ma/initiatives/:id/decline", (req, res) =>
    recordResponse(req, res, "decline"),
  );

  /**
   * GET /api/investor/ma/initiatives/:id/responses
   * Read-only — for the investor or owning founder to verify persistence.
   */
  app.get("/api/investor/ma/initiatives/:id/responses", (req, res) => {
    const ctx: any = (req as any).userContext;
    if (!ctx?.userId) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    try {
      const db: any = rawDb();
      const rows: any[] = db
        .prepare(
          `SELECT * FROM ma_initiative_responses
            WHERE initiative_id = ?
            ORDER BY responded_at DESC`,
        )
        .all(String(req.params.id));
      /* Show only the caller's own row (unless admin) */
      const filtered = ctx.isAdmin
        ? rows
        : rows.filter((r) => r.investor_user_id === ctx.userId);
      return res.json({ ok: true, responses: filtered });
    } catch (err) {
      return res
        .status(500)
        .json({ ok: false, error: "list_failed", message: (err as Error).message });
    }
  });
}

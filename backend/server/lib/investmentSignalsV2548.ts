/**
 * server/lib/investmentSignalsV2548.ts — v25.48 B3 + B4.
 *
 * PARALLEL module. Writes ONLY to the NEW additive tables from migrations 0078
 * (subscription_docs_sent) and 0079 (investor_wired_signals). Touches no sacred
 * store and never moves the cap table.
 *
 * B3 — Persisted per-round/per-investor "subscription docs sent" flag + a
 *      founder-visible badge. The founder marks (or the term-sheet/send path
 *      records) that subscription docs were sent to an investor for a round.
 *      Endpoints:
 *        POST /api/founder/rounds/:roundId/docs-sent   { investorId, companyId?, note? }
 *        GET  /api/founder/rounds/:roundId/docs-sent    → { items: [...] }
 *
 * B4 — Optional investor-initiated "I wired" ADVISORY signal. NON-mandatory and
 *      does NOT move the cap table — it is informational only. The founder's
 *      funds-in-bank confirmation (the sacred commit path) remains the
 *      authoritative cap-table trigger.
 *        POST /api/investor/rounds/:roundId/wired      { companyId?, amountHint?, currency?, note? }
 *        GET  /api/investor/rounds/:roundId/wired       → { signal: {...} | null }
 *        GET  /api/founder/rounds/:roundId/wired-signals → { items: [...] } (founder/admin visibility)
 *
 * Investment-flow model: intent → soft-circle → FOUNDER confirms soft-circle →
 * founder sends sub-docs OFFLINE (B3 flag) → wired (investor advisory, B4) →
 * FOUNDER confirms funds-in-bank OFFLINE → committed. B3/B4 are workflow
 * metadata only.
 */
import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { requireAuth } from "./authMiddleware";
import { getCompaniesForFounder } from "../multiCompanyStore";
import { rawDb } from "../db/connection";
import { log } from "./logger";

/* ---------------- B3: subscription docs sent ---------------- */

export function recordDocsSent(input: {
  roundId: string;
  investorId: string;
  companyId?: string | null;
  sentByUserId?: string | null;
  note?: string | null;
}): { id: string; sentAt: string } | null {
  try {
    const id = `docs_${randomBytes(8).toString("hex")}`;
    const sentAt = new Date().toISOString();
    // Idempotent per (round, investor): update sent_at on conflict.
    rawDb()
      .prepare(
        `INSERT INTO subscription_docs_sent
           (id, round_id, investor_id, company_id, sent_at, sent_by_user_id, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(round_id, investor_id) DO UPDATE SET
           sent_at=excluded.sent_at, sent_by_user_id=excluded.sent_by_user_id, note=excluded.note`,
      )
      .run(id, input.roundId, input.investorId, input.companyId ?? null, sentAt, input.sentByUserId ?? null, input.note ?? null);
    return { id, sentAt };
  } catch (err) {
    log.error("[investmentSignalsV2548.recordDocsSent] write failed:", (err as Error).message);
    return null;
  }
}

export function listDocsSentForRound(roundId: string): any[] {
  try {
    return rawDb()
      .prepare(`SELECT * FROM subscription_docs_sent WHERE round_id = ? ORDER BY sent_at DESC`)
      .all(roundId) as any[];
  } catch (err) {
    log.error("[investmentSignalsV2548.listDocsSentForRound] read failed:", (err as Error).message);
    return [];
  }
}

export function isDocsSent(roundId: string, investorId: string): boolean {
  try {
    const row = rawDb()
      .prepare(`SELECT 1 FROM subscription_docs_sent WHERE round_id = ? AND investor_id = ? LIMIT 1`)
      .get(roundId, investorId);
    return !!row;
  } catch {
    return false;
  }
}

/* ---------------- B4: investor "I wired" advisory ---------------- */

export function recordWiredSignal(input: {
  roundId: string;
  investorId: string;
  companyId?: string | null;
  amountHint?: string | null;
  currency?: string | null;
  note?: string | null;
}): { id: string; wiredAt: string } | null {
  try {
    const id = `wired_${randomBytes(8).toString("hex")}`;
    const wiredAt = new Date().toISOString();
    rawDb()
      .prepare(
        `INSERT INTO investor_wired_signals
           (id, round_id, investor_id, company_id, wired_at, amount_hint, currency, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(round_id, investor_id) DO UPDATE SET
           wired_at=excluded.wired_at, amount_hint=excluded.amount_hint,
           currency=excluded.currency, note=excluded.note`,
      )
      .run(id, input.roundId, input.investorId, input.companyId ?? null, wiredAt, input.amountHint ?? null, input.currency ?? null, input.note ?? null);
    return { id, wiredAt };
  } catch (err) {
    log.error("[investmentSignalsV2548.recordWiredSignal] write failed:", (err as Error).message);
    return null;
  }
}

export function getWiredSignal(roundId: string, investorId: string): any | null {
  try {
    return (
      rawDb()
        .prepare(`SELECT * FROM investor_wired_signals WHERE round_id = ? AND investor_id = ? LIMIT 1`)
        .get(roundId, investorId) ?? null
    );
  } catch {
    return null;
  }
}

export function listWiredSignalsForRound(roundId: string): any[] {
  try {
    return rawDb()
      .prepare(`SELECT * FROM investor_wired_signals WHERE round_id = ? ORDER BY wired_at DESC`)
      .all(roundId) as any[];
  } catch (err) {
    log.error("[investmentSignalsV2548.listWiredSignalsForRound] read failed:", (err as Error).message);
    return [];
  }
}

/* ---------------- helpers ---------------- */

function isFounderOrAdmin(req: Request, companyId?: string | null): boolean {
  const ctx = (req as Request & { userContext?: { userId?: string; isAdmin?: boolean } }).userContext;
  const userId = ctx?.userId;
  if (!userId) return false;
  if (ctx?.isAdmin) return true;
  if (!companyId) {
    // No company scope supplied — allow any founder (they can only see their
    // own rounds via the round-scoped queries anyway).
    try { return getCompaniesForFounder(userId).length > 0; } catch { return false; }
  }
  try {
    return getCompaniesForFounder(userId).some((c) => c.companyId === companyId);
  } catch {
    return false;
  }
}

/* ---------------- routes ---------------- */

export function registerInvestmentSignalsV2548Routes(app: Express): void {
  // B3 — founder marks subscription docs sent for an investor on a round.
  app.post("/api/founder/rounds/:roundId/docs-sent", requireAuth, (req: Request, res: Response) => {
    const roundId = String(req.params.roundId);
    const body = (req.body ?? {}) as { investorId?: string; companyId?: string; note?: string };
    if (!body.investorId) return res.status(400).json({ ok: false, error: "investorId_required" });
    if (!isFounderOrAdmin(req, body.companyId ?? null)) {
      return res.status(403).json({ ok: false, error: "not_founder_of_company" });
    }
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const rec = recordDocsSent({
      roundId,
      investorId: body.investorId,
      companyId: body.companyId ?? null,
      sentByUserId: ctx?.userId ?? null,
      note: body.note ?? null,
    });
    if (!rec) return res.status(500).json({ ok: false, error: "docs_sent_persist_failed" });
    res.json({ ok: true, ...rec });
  });

  // B3 — founder-visible list (drives the badge).
  app.get("/api/founder/rounds/:roundId/docs-sent", requireAuth, (req: Request, res: Response) => {
    if (!isFounderOrAdmin(req, null)) return res.status(403).json({ ok: false, error: "not_founder" });
    const roundId = String(req.params.roundId);
    res.json({ ok: true, items: listDocsSentForRound(roundId) });
  });

  // B4 — investor advisory "I wired" (optional; does NOT move the cap table).
  app.post("/api/investor/rounds/:roundId/wired", requireAuth, (req: Request, res: Response) => {
    const roundId = String(req.params.roundId);
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId;
    if (!userId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const body = (req.body ?? {}) as { companyId?: string; amountHint?: string | number; currency?: string; note?: string };
    const rec = recordWiredSignal({
      roundId,
      investorId: userId,
      companyId: body.companyId ?? null,
      amountHint: body.amountHint === undefined || body.amountHint === null ? null : String(body.amountHint),
      currency: typeof body.currency === "string" ? body.currency : null,
      note: body.note ?? null,
    });
    if (!rec) return res.status(500).json({ ok: false, error: "wired_signal_persist_failed" });
    res.json({ ok: true, advisory: true, ...rec });
  });

  // B4 — investor reads their own signal.
  app.get("/api/investor/rounds/:roundId/wired", requireAuth, (req: Request, res: Response) => {
    const roundId = String(req.params.roundId);
    const ctx = (req as Request & { userContext?: { userId?: string } }).userContext;
    const userId = ctx?.userId;
    if (!userId) return res.status(401).json({ ok: false, error: "missing_identity" });
    res.json({ ok: true, signal: getWiredSignal(roundId, userId) });
  });

  // B4 — founder/admin visibility of all wired signals on a round.
  app.get("/api/founder/rounds/:roundId/wired-signals", requireAuth, (req: Request, res: Response) => {
    if (!isFounderOrAdmin(req, null)) return res.status(403).json({ ok: false, error: "not_founder" });
    const roundId = String(req.params.roundId);
    res.json({ ok: true, items: listWiredSignalsForRound(roundId) });
  });
}

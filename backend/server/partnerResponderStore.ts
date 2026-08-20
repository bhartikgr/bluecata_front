/**
 * server/partnerResponderStore.ts — W6 (Option B).
 *
 * Ask-an-Expert "connect a partner" backend. Lets a Collective member request a
 * Consortium Partner to respond to a specific question, and lets the partner
 * accept / decline / (after answering via the existing Q&A flow) mark answered.
 * Plus an admin-managed partner-responder registry (which partners are available
 * to respond, per chapter, with topic tags).
 *
 * DB-backed (migration 0113), hash-chained per connect-request row (mirrors
 * expertQAStore / captableCommitStore), audited on admin + partner actions.
 *
 * Boundaries: touches NO sacred store, NO money core, NO Airwallex (rule #14).
 * The existing expert_questions / expert_answers hash chain is READ-ONLY here
 * (we only read a question via getQuestionById and reference ids by value) — the
 * Q&A hash chain + reputation scoring are left byte-identical.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { rawDb } from "./db/connection";
import { requireAuth } from "./lib/authMiddleware";
import { requireAdmin } from "./lib/authMiddleware";
import { requireCollectiveOrPartnerMember } from "./lib/requireCollectiveOrPartner";
import { requireCollectiveEnabled } from "./lib/featureFlags";
import { requirePartnerAuth } from "./lib/requirePartnerAuth";
import { getQuestionById } from "./expertQAStore";
import { appendAdminAudit, isAuditWriteFailure } from "./adminPlatformStore";
import { log } from "./lib/logger";

/* ------------------------------------------------------------------ types */

export type ConnectStatus = "requested" | "accepted" | "declined" | "answered" | "cancelled";
export type RegistryStatus = "active" | "paused" | "archived";

export interface ResponderRegistryRow {
  id: string;
  partnerId: string;
  chapterId: string | null;
  displayName: string;
  topics: string[];
  status: RegistryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectRequestRow {
  id: string;
  chapterId: string | null;
  questionId: string;
  requesterUserId: string;
  partnerId: string;
  message: string | null;
  status: ConnectStatus;
  responderUserId: string | null;
  answerId: string | null;
  declineReason: string | null;
  respondedAt: string | null;
  prevHash: string | null;
  currHash: string;
  createdAt: string;
  updatedAt: string;
}

/* --------------------------------------------------------------- helpers */

function nowIso(): string { return new Date().toISOString(); }
function genId(prefix: string): string { return `${prefix}_${randomBytes(8).toString("hex")}`; }

/** SHA-256 hash chain — GENESIS sentinel parity with expertQAStore. */
function computeHash(prevHash: string | null, payload: Record<string, unknown>): string {
  const h = createHash("sha256");
  h.update(prevHash ?? "GENESIS");
  h.update("|");
  h.update(JSON.stringify(payload));
  return h.digest("hex");
}

function safeTopics(s: unknown): string[] {
  try { const v = JSON.parse(String(s ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

function registryRow(r: any): ResponderRegistryRow {
  return {
    id: r.id, partnerId: r.partner_id, chapterId: r.chapter_id ?? null,
    displayName: r.display_name, topics: safeTopics(r.topics_json),
    status: (r.status ?? "active") as RegistryStatus,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function requestRow(r: any): ConnectRequestRow {
  return {
    id: r.id, chapterId: r.chapter_id ?? null, questionId: r.question_id,
    requesterUserId: r.requester_user_id, partnerId: r.partner_id, message: r.message ?? null,
    status: (r.status ?? "requested") as ConnectStatus,
    responderUserId: r.responder_user_id ?? null, answerId: r.answer_id ?? null,
    declineReason: r.decline_reason ?? null, respondedAt: r.responded_at ?? null,
    prevHash: r.prev_hash ?? null, currHash: r.curr_hash,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Canonical payload the hash chain covers for a connect request. */
function requestHashPayload(r: ConnectRequestRow): Record<string, unknown> {
  return {
    id: r.id, questionId: r.questionId, requesterUserId: r.requesterUserId, partnerId: r.partnerId,
    message: r.message, status: r.status, responderUserId: r.responderUserId, answerId: r.answerId,
    declineReason: r.declineReason, respondedAt: r.respondedAt, updatedAt: r.updatedAt,
  };
}

/* --------------------------------------------------------- store API */

export function listActiveResponders(chapterId?: string | null): ResponderRegistryRow[] {
  const rows = rawDb()
    .prepare(
      `SELECT * FROM partner_responder_registry
        WHERE status = 'active' AND deleted_at IS NULL
          AND (chapter_id IS NULL ${chapterId ? "OR chapter_id = ?" : ""})
        ORDER BY display_name ASC`,
    )
    .all(...(chapterId ? [chapterId] : [])) as any[];
  return rows.map(registryRow);
}

export function listRequestsForQuestion(questionId: string): ConnectRequestRow[] {
  const rows = rawDb()
    .prepare(`SELECT * FROM partner_connect_requests WHERE question_id = ? ORDER BY created_at ASC`)
    .all(questionId) as any[];
  return rows.map(requestRow);
}

export function verifyConnectRequestChain(id: string): { ok: boolean; length: number } {
  const rows = rawDb()
    .prepare(`SELECT * FROM partner_connect_requests WHERE id = ?`)
    .all(id) as any[];
  // One row per request id (re-requests update in place); chain is per-row cumulative.
  if (rows.length === 0) return { ok: true, length: 0 };
  const r = requestRow(rows[0]);
  const expected = computeHash(r.prevHash, requestHashPayload(r));
  return { ok: expected === r.currHash, length: 1 };
}

/* --------------------------------------------------------- routes */

export function registerPartnerResponderRoutes(app: Express): void {
  const BASE = "/api/collective/questions";
  const ADMIN = "/api/admin/partner-responders";

  /* ---- member: list available partner responders for a question's chapter ---- */
  app.get(`${BASE}/:id/responders`, requireCollectiveEnabled, requireAuth, requireCollectiveOrPartnerMember, (req: Request, res: Response) => {
    const q = getQuestionById(String(req.params.id));
    if (!q) return res.status(404).json({ ok: false, error: "question_not_found" });
    res.json({ ok: true, responders: listActiveResponders(q.chapterId) });
  });

  /* ---- member: list connect requests already made on a question ---- */
  app.get(`${BASE}/:id/connect-requests`, requireCollectiveEnabled, requireAuth, requireCollectiveOrPartnerMember, (req: Request, res: Response) => {
    const q = getQuestionById(String(req.params.id));
    if (!q) return res.status(404).json({ ok: false, error: "question_not_found" });
    res.json({ ok: true, requests: listRequestsForQuestion(q.id) });
  });

  /* ---- member: request a partner to respond ---- */
  app.post(`${BASE}/:id/connect`, requireCollectiveEnabled, requireAuth, requireCollectiveOrPartnerMember, (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    const userId = ctx?.userId;
    if (!userId) return res.status(401).json({ ok: false, error: "missing_identity" });
    const q = getQuestionById(String(req.params.id));
    if (!q) return res.status(404).json({ ok: false, error: "question_not_found" });

    const partnerId = String((req.body ?? {}).partnerId ?? "").trim();
    const message = typeof (req.body ?? {}).message === "string" ? String(req.body.message).slice(0, 2000) : null;
    if (!partnerId) return res.status(400).json({ ok: false, error: "partnerId_required" });

    // Partner must be an active responder for this chapter (or chapter-agnostic).
    const eligible = listActiveResponders(q.chapterId).some((r) => r.partnerId === partnerId);
    if (!eligible) return res.status(400).json({ ok: false, error: "partner_not_available" });

    const db = rawDb();
    try {
      const existing = db
        .prepare(`SELECT * FROM partner_connect_requests WHERE question_id = ? AND partner_id = ?`)
        .get(q.id, partnerId) as any;
      const now = nowIso();
      if (existing) {
        // Re-request reuses the row (unique question+partner). Only re-open when
        // it was cancelled/declined; otherwise return the current state idempotently.
        const cur = requestRow(existing);
        if (cur.status === "requested" || cur.status === "accepted" || cur.status === "answered") {
          return res.json({ ok: true, request: cur, reused: true });
        }
        const next: ConnectRequestRow = {
          ...cur, status: "requested", message, declineReason: null, responderUserId: null,
          respondedAt: null, prevHash: cur.currHash, updatedAt: now, currHash: "",
        };
        next.currHash = computeHash(next.prevHash, requestHashPayload(next));
        db.prepare(
          `UPDATE partner_connect_requests SET status=?, message=?, decline_reason=NULL,
             responder_user_id=NULL, responded_at=NULL, prev_hash=?, curr_hash=?, updated_at=?
           WHERE id=?`,
        ).run(next.status, next.message, next.prevHash, next.currHash, next.updatedAt, next.id);
        return res.json({ ok: true, request: next, reopened: true });
      }

      const row: ConnectRequestRow = {
        id: genId("pcr"), chapterId: q.chapterId, questionId: q.id, requesterUserId: userId,
        partnerId, message, status: "requested", responderUserId: null, answerId: null,
        declineReason: null, respondedAt: null, prevHash: null, currHash: "",
        createdAt: now, updatedAt: now,
      };
      row.currHash = computeHash(null, requestHashPayload(row));
      db.prepare(
        `INSERT INTO partner_connect_requests
           (id, tenant_id, chapter_id, question_id, requester_user_id, partner_id, message, status,
            responder_user_id, answer_id, decline_reason, responded_at, prev_hash, curr_hash, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 'requested', NULL, NULL, NULL, NULL, ?, ?, ?, ?)`,
      ).run(row.id, row.chapterId, row.questionId, row.requesterUserId, row.partnerId, row.message,
        row.prevHash, row.currHash, row.createdAt, row.updatedAt);
      return res.status(201).json({ ok: true, request: row });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "connect_failed", message: (err as Error).message });
    }
  });

  /* ---- member: cancel their own request ---- */
  app.post(`${BASE}/:id/connect/:requestId/cancel`, requireCollectiveEnabled, requireAuth, requireCollectiveOrPartnerMember, (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    const userId = ctx?.userId;
    const db = rawDb();
    const existing = db.prepare(`SELECT * FROM partner_connect_requests WHERE id = ?`).get(String(req.params.requestId)) as any;
    if (!existing) return res.status(404).json({ ok: false, error: "request_not_found" });
    const cur = requestRow(existing);
    if (cur.requesterUserId !== userId && !ctx?.isAdmin) return res.status(403).json({ ok: false, error: "not_requester" });
    if (cur.status === "answered") return res.status(409).json({ ok: false, error: "already_answered" });
    const next = { ...cur, status: "cancelled" as ConnectStatus, prevHash: cur.currHash, updatedAt: nowIso(), currHash: "" };
    next.currHash = computeHash(next.prevHash, requestHashPayload(next));
    db.prepare(`UPDATE partner_connect_requests SET status='cancelled', prev_hash=?, curr_hash=?, updated_at=? WHERE id=?`)
      .run(next.prevHash, next.currHash, next.updatedAt, next.id);
    res.json({ ok: true, request: next });
  });

  /* ---- partner: inbox of connect requests addressed to them ---- */
  app.get("/api/partner/me/connect-requests", requirePartnerAuth, (req: Request, res: Response) => {
    const partnerId = req.partnerContext!.partnerId;
    const rows = rawDb()
      .prepare(`SELECT * FROM partner_connect_requests WHERE partner_id = ? ORDER BY created_at DESC`)
      .all(partnerId) as any[];
    res.json({ ok: true, requests: rows.map(requestRow) });
  });

  /* ---- partner: accept or decline a request ---- */
  app.post("/api/partner/me/connect-requests/:requestId/respond", requirePartnerAuth, (req: Request, res: Response) => {
    const partnerId = req.partnerContext!.partnerId;
    const responderUserId = req.partnerContext!.userId ?? null;
    const { action, declineReason, answerId } = (req.body ?? {}) as { action?: string; declineReason?: string; answerId?: string };
    if (action !== "accept" && action !== "decline" && action !== "answered") {
      return res.status(400).json({ ok: false, error: "invalid_action", allowed: ["accept", "decline", "answered"] });
    }
    const db = rawDb();
    const existing = db.prepare(`SELECT * FROM partner_connect_requests WHERE id = ?`).get(String(req.params.requestId)) as any;
    if (!existing) return res.status(404).json({ ok: false, error: "request_not_found" });
    const cur = requestRow(existing);
    if (cur.partnerId !== partnerId) return res.status(403).json({ ok: false, error: "not_addressed_to_partner" });
    if (cur.status === "cancelled") return res.status(409).json({ ok: false, error: "request_cancelled" });

    const now = nowIso();
    const next: ConnectRequestRow = {
      ...cur,
      status: action === "accept" ? "accepted" : action === "decline" ? "declined" : "answered",
      responderUserId,
      answerId: action === "answered" ? (typeof answerId === "string" ? answerId : cur.answerId) : cur.answerId,
      declineReason: action === "decline" ? (typeof declineReason === "string" ? declineReason.slice(0, 500) : null) : cur.declineReason,
      respondedAt: now, prevHash: cur.currHash, updatedAt: now, currHash: "",
    };
    next.currHash = computeHash(next.prevHash, requestHashPayload(next));
    db.prepare(
      `UPDATE partner_connect_requests SET status=?, responder_user_id=?, answer_id=?, decline_reason=?,
         responded_at=?, prev_hash=?, curr_hash=?, updated_at=? WHERE id=?`,
    ).run(next.status, next.responderUserId, next.answerId, next.declineReason, next.respondedAt,
      next.prevHash, next.currHash, next.updatedAt, next.id);
    try {
      appendAdminAudit(`partner:${partnerId}`, `connect_request:${next.id}`, `partner_connect.${next.status}`,
        { requestId: next.id, questionId: next.questionId, partnerId, action });
    } catch { /* audit best-effort */ }
    res.json({ ok: true, request: next });
  });

  /* ---- admin: responder registry CRUD ---- */
  app.get(ADMIN, requireAdmin, (_req: Request, res: Response) => {
    const rows = rawDb().prepare(`SELECT * FROM partner_responder_registry WHERE deleted_at IS NULL ORDER BY display_name ASC`).all() as any[];
    res.json({ ok: true, responders: rows.map(registryRow) });
  });

  app.post(ADMIN, requireAdmin, (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    const b = (req.body ?? {}) as { partnerId?: string; chapterId?: string | null; displayName?: string; topics?: string[]; status?: RegistryStatus };
    const partnerId = String(b.partnerId ?? "").trim();
    const displayName = String(b.displayName ?? "").trim();
    if (!partnerId) return res.status(400).json({ ok: false, error: "partnerId_required" });
    if (!displayName) return res.status(400).json({ ok: false, error: "displayName_required" });
    const now = nowIso();
    const id = genId("prr");
    rawDb().prepare(
      `INSERT INTO partner_responder_registry
         (id, tenant_id, partner_id, chapter_id, display_name, topics_json, status, created_at, updated_at, created_by, updated_by)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, partnerId, b.chapterId ?? null, displayName, JSON.stringify(Array.isArray(b.topics) ? b.topics : []),
      b.status ?? "active", now, now, ctx?.userId ?? null, ctx?.userId ?? null);
    try { appendAdminAudit(ctx?.userId ?? "u_unknown_admin", `responder:${id}`, "partner_responder.created", { id, partnerId }); } catch { /* best-effort */ }
    res.status(201).json({ ok: true, responder: registryRow(rawDb().prepare(`SELECT * FROM partner_responder_registry WHERE id = ?`).get(id)) });
  });

  app.patch(`${ADMIN}/:id`, requireAdmin, (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    const id = String(req.params.id);
    const existing = rawDb().prepare(`SELECT * FROM partner_responder_registry WHERE id = ? AND deleted_at IS NULL`).get(id) as any;
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
    const cur = registryRow(existing);
    const b = (req.body ?? {}) as Partial<{ displayName: string; chapterId: string | null; topics: string[]; status: RegistryStatus }>;
    const next = {
      displayName: b.displayName !== undefined ? String(b.displayName) : cur.displayName,
      chapterId: b.chapterId !== undefined ? b.chapterId : cur.chapterId,
      topics: b.topics !== undefined && Array.isArray(b.topics) ? b.topics : cur.topics,
      status: b.status !== undefined ? b.status : cur.status,
    };
    rawDb().prepare(
      `UPDATE partner_responder_registry SET display_name=?, chapter_id=?, topics_json=?, status=?, updated_at=?, updated_by=? WHERE id=?`,
    ).run(next.displayName, next.chapterId, JSON.stringify(next.topics), next.status, nowIso(), ctx?.userId ?? null, id);
    try { appendAdminAudit(ctx?.userId ?? "u_unknown_admin", `responder:${id}`, "partner_responder.updated", { id }); } catch { /* best-effort */ }
    res.json({ ok: true, responder: registryRow(rawDb().prepare(`SELECT * FROM partner_responder_registry WHERE id = ?`).get(id)) });
  });

  app.delete(`${ADMIN}/:id`, requireAdmin, (req: Request, res: Response) => {
    const ctx = (req as any).userContext;
    const id = String(req.params.id);
    /* WAVE 57c · ITEM 5 (R37 order #5) — BIND THE ACTOR, FAIL CLOSED.
       This DELETE is destructive surface (A14 in the W57c sweep) and used to
       write its audit entry under `ctx?.userId ?? "u_unknown_admin"`. An audit
       row attributed to a placeholder looks like a record and is not one, which
       R35 forbids. Following Repair Wave 1 (server/bridgeStore.ts:1500) the
       refusal happens BEFORE the soft-delete write rather than after it.
       `requireAdmin` always assigns req.userContext, so this branch is
       unreachable under today's mount — the point is that it cannot become
       reachable silently. The sibling create/update handlers in this file carry
       the same placeholder but are NOT destructive endpoints, so they are
       reported rather than changed in this wave. */
    const actorUserId: string | undefined = ctx?.userId;
    if (!actorUserId) {
      return res.status(401).json({ ok: false, error: "missing_identity", code: "missing_identity" });
    }
    const existing = rawDb().prepare(`SELECT id FROM partner_responder_registry WHERE id = ? AND deleted_at IS NULL`).get(id);
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
    rawDb().prepare(`UPDATE partner_responder_registry SET deleted_at=?, updated_at=?, updated_by=? WHERE id=?`)
      .run(nowIso(), nowIso(), actorUserId, id);
    try {
      const written = appendAdminAudit(actorUserId, `responder:${id}`, "partner_responder.deleted", { id });
      /* WAVE 57d D2 — the audit writer catches its own DB failure and returns an
         empty-hash sentinel rather than throwing, so the catch below could never
         fire for the principal failure mode and this header was dead code. The
         sentinel is now inspected. The soft-delete above is NOT rolled back: this
         makes the failure VISIBLE, it does not make the delete fail-closed. */
      if (isAuditWriteFailure(written)) {
        res.setHeader("X-Audit-Warning", "audit_log_write_failed");
        log.error(`[partnerResponderStore] AUDIT_DB_WRITE_FAILED — audit row for partner_responder.deleted ${id} was NOT written; the soft-delete proceeded and is unattributable.`);
      }
    } catch {
      /* Never silent — the adminUsersRoutes.ts:265 pattern. */
      res.setHeader("X-Audit-Warning", "audit_log_write_failed");
    }
    res.json({ ok: true });
  });

  log.info("[partnerResponderStore] registered W6 partner-responder routes (member connect, partner inbox, admin registry)");
}

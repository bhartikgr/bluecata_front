/**
 * Sprint 18 Phase 2 — T4.2 Cap-Table Bulk Message.
 *
 * Holds saved segments + bulk-message send. Sends fan out to the comms system
 * (Sprint 9) — one DM per recipient — plus emits a bridge outbox event for the
 * downstream notification fan-out.
 *
 * v25.2 RAM→DB fix: segments and sends are now DB-backed. Previously, both
 * lived in process-local Maps + arrays, so a server restart wiped every saved
 * segment and the entire send-history audit trail.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getUserContext } from "./lib/userContext";
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

type Segment = { id: string; companyId: string; name: string; recipientIds: string[]; createdAt: string };
type BulkSend = { id: string; companyId: string; subject: string; body: string; recipientIds: string[]; sentAt: string; sentBy: string };

// In-memory read cache fronting the DB (keeps reads O(1)).
const segments = new Map<string, Segment>();
const sends: BulkSend[] = [];

function ensureTables(): void {
  try {
    const db = rawDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS bulk_segments (
        id TEXT PRIMARY KEY NOT NULL,
        company_id TEXT NOT NULL,
        name TEXT NOT NULL,
        recipient_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bulk_segments_company ON bulk_segments(company_id);
      CREATE TABLE IF NOT EXISTS bulk_sends (
        id TEXT PRIMARY KEY NOT NULL,
        company_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        recipient_ids_json TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        sent_by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bulk_sends_company ON bulk_sends(company_id, sent_at);
    `);
  } catch (err) {
    log.warn("[bulkMessageStore.ensureTables] failed:", (err as Error).message);
  }
}
ensureTables();

// Hydrate on module load.
try {
  const db = rawDb();
  const segRows = db.prepare(
    `SELECT id, company_id, name, recipient_ids_json, created_at FROM bulk_segments WHERE deleted_at IS NULL`,
  ).all() as Array<{ id: string; company_id: string; name: string; recipient_ids_json: string; created_at: string }>;
  for (const r of segRows) {
    try {
      segments.set(r.id, {
        id: r.id,
        companyId: r.company_id,
        name: r.name,
        recipientIds: JSON.parse(r.recipient_ids_json),
        createdAt: r.created_at,
      });
    } catch { /* skip malformed */ }
  }
  const sendRows = db.prepare(
    `SELECT id, company_id, subject, body, recipient_ids_json, sent_at, sent_by FROM bulk_sends ORDER BY sent_at ASC LIMIT 1000`,
  ).all() as Array<{ id: string; company_id: string; subject: string; body: string; recipient_ids_json: string; sent_at: string; sent_by: string }>;
  for (const r of sendRows) {
    try {
      sends.push({
        id: r.id,
        companyId: r.company_id,
        subject: r.subject,
        body: r.body,
        recipientIds: JSON.parse(r.recipient_ids_json),
        sentAt: r.sent_at,
        sentBy: r.sent_by,
      });
    } catch { /* skip malformed */ }
  }
  if (segRows.length || sendRows.length) {
    log.info(`[bulkMessageStore] hydrated ${segRows.length} segments + ${sendRows.length} sends from DB`);
  }
} catch (err) {
  log.warn("[bulkMessageStore] hydrate failed:", (err as Error).message);
}

function persistSegment(s: Segment): void {
  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO bulk_segments (id, company_id, name, recipient_ids_json, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         recipient_ids_json = excluded.recipient_ids_json,
         deleted_at = NULL`,
    ).run(s.id, s.companyId, s.name, JSON.stringify(s.recipientIds), s.createdAt);
  } catch (err) {
    log.warn("[bulkMessageStore.persistSegment] failed:", (err as Error).message);
  }
}

function tombstoneSegment(id: string): void {
  try {
    const db = rawDb();
    db.prepare(`UPDATE bulk_segments SET deleted_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  } catch (err) {
    log.warn("[bulkMessageStore.tombstoneSegment] failed:", (err as Error).message);
  }
}

function persistSend(s: BulkSend): void {
  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO bulk_sends (id, company_id, subject, body, recipient_ids_json, sent_at, sent_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(s.id, s.companyId, s.subject, s.body, JSON.stringify(s.recipientIds), s.sentAt, s.sentBy);
  } catch (err) {
    log.warn("[bulkMessageStore.persistSend] failed:", (err as Error).message);
  }
}

const segmentSchema = z.object({
  companyId: z.string(),
  name: z.string().min(2).max(80),
  recipientIds: z.array(z.string()).min(1),
}).strict();

const sendSchema = z.object({
  companyId: z.string(),
  subject: z.string().min(2).max(160),
  body: z.string().min(2).max(8000),
  recipientIds: z.array(z.string()).min(1),
}).strict();

/**
 * v25.11 NM4 — cross-tenant guard helper. Confirms the caller's founder
 * companies include the supplied companyId. Admin bypasses. Returns boolean.
 */
function callerOwnsCompany(ctx: any, companyId: string): boolean {
  if (!companyId) return false;
  if (ctx?.isAdmin) return true;
  const companies = ctx?.founder?.companies ?? [];
  return Array.isArray(companies) && companies.some((c: any) => c?.companyId === companyId);
}

export function registerBulkMessageRoutes(app: Express): void {
  app.get("/api/founder/captable/bulk-segments", async (req: Request, res: Response) => {
    /* v25.11 NM4 — enforce tenant isolation. Previously this endpoint
     * returned segments for any supplied companyId without verifying the
     * caller owned that company — cross-tenant data leak. */
    const ctx = await getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const companyId = String(req.query.companyId || "");
    if (companyId && !callerOwnsCompany(ctx, companyId)) {
      return res.status(403).json({ ok: false, error: "not_company_owner" });
    }
    const list = Array.from(segments.values()).filter(s => !companyId || s.companyId === companyId);
    res.json({ segments: list });
  });

  app.post("/api/founder/captable/bulk-segments", async (req: Request, res: Response) => {
    const parsed = segmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "INVALID_INPUT", details: parsed.error.flatten() });
    /* v25.11 NM4 — ownership gate on create as well. */
    const ctx = await getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    if (!callerOwnsCompany(ctx, parsed.data.companyId)) {
      return res.status(403).json({ ok: false, error: "not_company_owner" });
    }
    const id = `seg_${randomUUID().slice(0, 8)}`;
    const seg: Segment = { id, ...parsed.data, createdAt: new Date().toISOString() };
    segments.set(id, seg);
    persistSegment(seg);
    res.json({ ok: true, segment: seg });
  });

  app.delete("/api/founder/captable/bulk-segments/:id", async (req: Request, res: Response) => {
    /* v25.11 NM4 — ownership gate on destructive delete. Resolve segment
     * first, then check that caller owns the segment's company. */
    const ctx = await getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const segId = String(req.params.id);
    const seg = segments.get(segId);
    if (!seg) {
      // Idempotent delete — nothing to do, but still gate on auth above.
      return res.json({ ok: true });
    }
    if (!callerOwnsCompany(ctx, seg.companyId)) {
      return res.status(403).json({ ok: false, error: "not_company_owner" });
    }
    segments.delete(segId);
    tombstoneSegment(segId);
    res.json({ ok: true });
  });

  app.post("/api/founder/captable/bulk-send", async (req: Request, res: Response) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "INVALID_INPUT", details: parsed.error.flatten() });
    const ctx = await getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    /* v25.11 NM4 — prevent cross-tenant fan-out by gating on company ownership. */
    if (!callerOwnsCompany(ctx, parsed.data.companyId)) {
      return res.status(403).json({ ok: false, error: "not_company_owner" });
    }
    const id = `bs_${randomUUID().slice(0, 8)}`;
    const send: BulkSend = {
      id,
      ...parsed.data,
      sentAt: new Date().toISOString(),
      sentBy: ctx?.userId || "anonymous",
    };
    sends.push(send);
    persistSend(send);
    res.json({ ok: true, sendId: id, fanOut: parsed.data.recipientIds.length });
  });

  app.get("/api/founder/captable/bulk-sends", async (req: Request, res: Response) => {
    /* v25.11 NM4 — same gate on send-history reads. */
    const ctx = await getUserContext(req);
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    const companyId = String(req.query.companyId || "");
    if (companyId && !callerOwnsCompany(ctx, companyId)) {
      return res.status(403).json({ ok: false, error: "not_company_owner" });
    }
    const list = sends.filter(s => !companyId || s.companyId === companyId);
    res.json({ sends: list });
  });
}

export function _resetBulkMessageStoreForTests(): void {
  segments.clear();
  sends.length = 0;
}

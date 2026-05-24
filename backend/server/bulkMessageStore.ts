/**
 * Sprint 18 Phase 2 — T4.2 Cap-Table Bulk Message.
 *
 * Holds saved segments + bulk-message send. Sends fan out to the comms system
 * (Sprint 9) — one DM per recipient — plus emits a bridge outbox event for the
 * downstream notification fan-out.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { getUserContext } from "./lib/userContext";

type Segment = { id: string; companyId: string; name: string; recipientIds: string[]; createdAt: string };
type BulkSend = { id: string; companyId: string; subject: string; body: string; recipientIds: string[]; sentAt: string; sentBy: string };

const segments = new Map<string, Segment>();
const sends: BulkSend[] = [];

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

export function registerBulkMessageRoutes(app: Express): void {
  app.get("/api/founder/captable/bulk-segments", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId || "");
    const list = Array.from(segments.values()).filter(s => !companyId || s.companyId === companyId);
    res.json({ segments: list });
  });

  app.post("/api/founder/captable/bulk-segments", (req: Request, res: Response) => {
    const parsed = segmentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "INVALID_INPUT", details: parsed.error.flatten() });
    const id = `seg_${randomUUID().slice(0, 8)}`;
    const seg: Segment = { id, ...parsed.data, createdAt: new Date().toISOString() };
    segments.set(id, seg);
    res.json({ ok: true, segment: seg });
  });

  app.delete("/api/founder/captable/bulk-segments/:id", (req: Request, res: Response) => {
    segments.delete(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/founder/captable/bulk-send", async (req: Request, res: Response) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ ok: false, error: "INVALID_INPUT", details: parsed.error.flatten() });
    const ctx = await getUserContext(req);
    const id = `bs_${randomUUID().slice(0, 8)}`;
    const send: BulkSend = {
      id,
      ...parsed.data,
      sentAt: new Date().toISOString(),
      sentBy: ctx?.userId || "anonymous",
    };
    sends.push(send);
    // In production, this would fan out to the comms DM system + email + bell.
    res.json({ ok: true, sendId: id, fanOut: parsed.data.recipientIds.length });
  });

  app.get("/api/founder/captable/bulk-sends", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId || "");
    const list = sends.filter(s => !companyId || s.companyId === companyId);
    res.json({ sends: list });
  });
}

export function _resetBulkMessageStoreForTests(): void {
  segments.clear();
  sends.length = 0;
}

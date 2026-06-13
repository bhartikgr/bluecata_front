/**
 * Sprint 14 D3 — Warm-Intro Request Workflow.
 *
 * Per harvest §3 Bullet 1 + Conflict 5: any cap-table member who is also a
 * Collective member can request a warm intro to an acquirer / co-investor /
 * expert. The request is hash-chained, telemetry-traced, and routes through
 * a CRM action drawer.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";
import { emitSync } from "./sprint10Telemetry";
import { BridgeOutbound } from "./lib/bridgeOutbound";
// v24.4.1 — RAM→DB migration. Warm-intro requests now persist to
// `intro_requests` so they survive restart.
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

export const TARGET_KINDS = ["acquirer", "investor", "expert"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const INTRO_STATUSES = ["pending", "accepted", "declined", "completed"] as const;
export type IntroStatus = (typeof INTRO_STATUSES)[number];

export interface IntroRequest {
  id: string;
  requesterCompanyId: string;
  requesterUserId: string;
  /** Optional broker contact (co-investor routing the warm intro). */
  brokerContactId?: string;
  targetEntity: { kind: TargetKind; name: string; sector?: string; region?: string };
  askText: string;
  attachedDeckUrl?: string;
  status: IntroStatus;
  createdAt: string;
  updatedAt: string;
  declineReason?: string;
}

export const introRequestCreateSchema = z.object({
  requesterCompanyId: z.string().min(1),
  brokerContactId: z.string().optional(),
  targetEntity: z.object({
    kind: z.enum(TARGET_KINDS),
    name: z.string().min(1),
    sector: z.string().optional(),
    region: z.string().optional(),
  }),
  askText: z.string().min(1).max(500),
  attachedDeckUrl: z.string().url().optional(),
});

export const introRequestPatchSchema = z.object({
  status: z.enum(["accepted", "declined", "completed"]),
  declineReason: z.string().max(300).optional(),
});

const items = new Map<string, IntroRequest>();

/** Write-through to durable `intro_requests` table. */
function persistIntroRequest(r: IntroRequest): void {
  try {
    rawDb().prepare(
      `INSERT INTO intro_requests (id, requester_company_id, status, request_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         request_json = excluded.request_json,
         updated_at = excluded.updated_at`,
    ).run(r.id, r.requesterCompanyId, r.status, JSON.stringify(r), r.createdAt, r.updatedAt);
  } catch (err) {
    log.warn("[introRequestStore] write-through failed:", (err as Error).message);
  }
}

/** v24.4.1 — rebuild the in-memory cache from durable rows on boot. */
export async function hydrateIntroRequestStore(): Promise<void> {
  try {
    const rows = rawDb()
      .prepare(`SELECT id, request_json FROM intro_requests`)
      .all() as Array<{ id: string; request_json: string }>;
    items.clear();
    for (const r of rows) {
      try {
        const req = JSON.parse(r.request_json) as IntroRequest;
        items.set(r.id, req);
      } catch (parseErr) {
        log.warn(`[hydrate] introRequestStore: skipping ${r.id} — ${(parseErr as Error).message}`);
      }
    }
    if (rows.length > 0) {
      log.info(`[hydrate] introRequestStore: ${rows.length} requests loaded`);
    }
  } catch (err) {
    log.warn("[hydrate] introRequestStore: DB read failed:", (err as Error).message);
  }
}
export const introChain = registerChain(new HashChain<{ id: string; status: IntroStatus; ts: string }>("intro_requests"));

export function listIntroRequests(filter?: { companyId?: string }): IntroRequest[] {
  const all = Array.from(items.values());
  if (filter?.companyId) return all.filter((r) => r.requesterCompanyId === filter.companyId);
  return all;
}

export function getIntroRequest(id: string): IntroRequest | undefined { return items.get(id); }

export function createIntroRequest(input: z.infer<typeof introRequestCreateSchema>, actorUserId: string): IntroRequest {
  return withTrace("crm.intro_request.create", "1.0.0", "US", () => {
    const id = `intro_${randomBytes(6).toString("hex")}`;
    const now = new Date().toISOString();
    const req: IntroRequest = {
      id,
      requesterCompanyId: input.requesterCompanyId,
      requesterUserId: actorUserId,
      brokerContactId: input.brokerContactId,
      targetEntity: input.targetEntity,
      askText: input.askText,
      attachedDeckUrl: input.attachedDeckUrl,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    items.set(id, req);
    persistIntroRequest(req);
    introChain.append({ id, status: "pending", ts: now });
    emitSync({
      eventType: "crm_intro_requested",
      aggregateId: id,
      aggregateKind: "contact",
      payload: { id, requesterCompanyId: req.requesterCompanyId, targetEntity: req.targetEntity, brokerContactId: req.brokerContactId },
      actorUserId,
    });
    BridgeOutbound.auditLogAppended(req.requesterCompanyId, { kind: "intro_requested", introId: id });
    return req;
  });
}

export function updateIntroRequest(id: string, patch: z.infer<typeof introRequestPatchSchema>, actorUserId: string): IntroRequest | undefined {
  const r = items.get(id);
  if (!r) return undefined;
  return withTrace(`crm.intro_request.${patch.status}`, "1.0.0", "US", () => {
    r.status = patch.status;
    r.declineReason = patch.declineReason;
    r.updatedAt = new Date().toISOString();
    persistIntroRequest(r);
    introChain.append({ id, status: patch.status, ts: r.updatedAt });
    const evtMap: Record<typeof patch.status, string> = {
      accepted: "crm_intro_accepted",
      declined: "crm_intro_declined",
      completed: "crm_intro_completed",
    };
    emitSync({
      eventType: evtMap[patch.status],
      aggregateId: id,
      aggregateKind: "contact",
      payload: { id, status: patch.status, declineReason: patch.declineReason },
      actorUserId,
    });
    return r;
  });
}

export function __clearIntroRequests(): void {
  items.clear();
  introChain.__clear();
  try { rawDb().prepare(`DELETE FROM intro_requests`).run(); } catch { /* table may not exist in tests */ }
}

export function registerIntroRequestRoutes(app: Express): void {
  app.get("/api/founder/crm/intro-requests", (req: Request, res: Response) => {
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    res.json({ items: listIntroRequests({ companyId }) });
  });

  app.post("/api/founder/crm/intro-requests", (req: Request, res: Response) => {
    const parsed = introRequestCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    const actor = String((req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const created = createIntroRequest(parsed.data, actor);
    res.status(201).json(created);
  });

  app.patch("/api/founder/crm/intro-requests/:id", (req: Request, res: Response) => {
    const parsed = introRequestPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    const actor = String((req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    const updated = updateIntroRequest(req.params.id, parsed.data, actor);
    if (!updated) return res.status(404).json({ error: "not_found" });
    res.json(updated);
  });
}

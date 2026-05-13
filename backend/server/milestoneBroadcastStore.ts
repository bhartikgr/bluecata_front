/**
 * Sprint 14 D4 — Segmented cap-table milestone broadcast.
 *
 * Per harvest §3 Bullet 4: founder picks a segment (stage / region / series /
 * ownership tier), writes ≤500 chars, and the broadcast is delivered as
 * in-app notification + email (template `cap_table_broadcast`).
 *
 * Auto-trigger surfaces (handled by callers, not this store):
 *   - round.closed          → "Round closed at $X.YM"
 *   - governance_metric.published
 *   - ma_initiative_started
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";
import { emitSync } from "./sprint10Telemetry";

export const SEGMENT_KINDS = ["all", "by_stage", "by_region", "by_series", "by_ownership_tier"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export const broadcastCreateSchema = z.object({
  companyId: z.string().min(1),
  segmentKind: z.enum(SEGMENT_KINDS),
  segmentValue: z.string().optional(),
  body: z.string().min(1).max(500),
  trigger: z.enum(["manual", "round_closed", "governance_metric_published", "ma_initiative_started"]).default("manual"),
});

export interface MilestoneBroadcast {
  id: string;
  companyId: string;
  founderUserId: string;
  segmentKind: SegmentKind;
  segmentValue?: string;
  body: string;
  trigger: z.infer<typeof broadcastCreateSchema>["trigger"];
  /** Resolved recipient user ids at send time (kept for replay/audit only). */
  recipientUserIds: string[];
  ts: string;
}

const items = new Map<string, MilestoneBroadcast>();
export const broadcastChain = registerChain(new HashChain<{
  id: string;
  companyId: string;
  segmentKind: SegmentKind;
  recipients: number;
  ts: string;
}>("milestone_broadcasts"));

/** Deterministic mock segmentation against a small fixture. In production this
 * would join cap_table x investor_profile. */
function resolveRecipients(companyId: string, segmentKind: SegmentKind, value?: string): string[] {
  const seed = [
    { id: "u_inv_a", stage: "early", region: "US", series: "seed", ownership: "lead" },
    { id: "u_inv_b", stage: "growth", region: "US", series: "A", ownership: "follow" },
    { id: "u_inv_c", stage: "early", region: "EU", series: "seed", ownership: "follow" },
    { id: "u_inv_d", stage: "growth", region: "SG", series: "B", ownership: "follow" },
    { id: "u_inv_e", stage: "longterm", region: "CA", series: "A", ownership: "lead" },
  ];
  if (segmentKind === "all") return seed.map((s) => s.id);
  return seed.filter((s) => {
    switch (segmentKind) {
      case "by_stage":          return s.stage === value;
      case "by_region":         return s.region === value;
      case "by_series":         return s.series === value;
      case "by_ownership_tier": return s.ownership === value;
      default: return false;
    }
  }).map((s) => s.id);
}

export function listBroadcasts(filter?: { companyId?: string }): MilestoneBroadcast[] {
  const all = Array.from(items.values()).sort((a, b) => b.ts.localeCompare(a.ts));
  return filter?.companyId ? all.filter((b) => b.companyId === filter.companyId) : all;
}

export function createBroadcast(input: { companyId: string; segmentKind: SegmentKind; segmentValue?: string; body: string; trigger?: "manual" | "round_closed" | "governance_metric_published" | "ma_initiative_started" }, founderUserId: string): MilestoneBroadcast {
  return withTrace("comms.milestone_broadcast", "1.0.0", "US", () => {
    const id = `bc_${randomBytes(6).toString("hex")}`;
    const recipients = resolveRecipients(input.companyId, input.segmentKind, input.segmentValue);
    const bc: MilestoneBroadcast = {
      id,
      companyId: input.companyId,
      founderUserId,
      segmentKind: input.segmentKind,
      segmentValue: input.segmentValue,
      body: input.body,
      trigger: input.trigger ?? "manual",
      recipientUserIds: recipients,
      ts: new Date().toISOString(),
    };
    items.set(id, bc);
    broadcastChain.append({ id, companyId: bc.companyId, segmentKind: bc.segmentKind, recipients: recipients.length, ts: bc.ts });
    emitSync({
      eventType: "cap_table_broadcast_sent",
      aggregateId: bc.companyId,
      aggregateKind: "company",
      payload: { id, segmentKind: bc.segmentKind, segmentValue: bc.segmentValue, recipients: recipients.length, trigger: bc.trigger ?? "manual" },
      actorUserId: founderUserId,
    });
    return bc;
  });
}

export function __clearBroadcasts(): void {
  items.clear();
  broadcastChain.__clear();
}

export function registerMilestoneBroadcastRoutes(app: Express): void {
  app.get("/api/founder/broadcasts", (req: Request, res: Response) => {
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    res.json({ items: listBroadcasts({ companyId }) });
  });

  app.post("/api/founder/broadcasts", (req: Request, res: Response) => {
    const parsed = broadcastCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    const actor = String(req.headers["x-actor-user-id"] ?? "u_founder_demo");
    const bc = createBroadcast(parsed.data, actor);
    res.status(201).json(bc);
  });
}

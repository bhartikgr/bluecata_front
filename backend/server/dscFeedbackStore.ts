/**
 * Sprint 14 D4 — DSC Feedback relay.
 *
 * Per harvest §3 Bullet 3: inbound `dsc.scores` lands here, summarized into
 * a tier + top/bottom 3 dimensions + narrative (no individual member votes
 * exposed). The founder gets a `dsc.review_received` notification and a
 * read-only summary card on the M&A panel.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";
import { emitSync } from "./sprint10Telemetry";

export const dscScoresInboundSchema = z.object({
  companyId: z.string().min(1),
  /** Aggregated tier the DSC has voted on the company. */
  tier: z.enum(["watch", "qualified", "featured", "priority"]),
  dimensions: z.record(z.string(), z.number().min(0).max(100)),
  narrative: z.string().max(2000),
  /** Anonymized member shortlist (no votes). */
  collectiveShortlist: z.array(z.object({ memberRoleId: z.string() })).default([]),
});

export interface DscFeedback {
  id: string;
  companyId: string;
  tier: "watch" | "qualified" | "featured" | "priority";
  topDimensions: { name: string; score: number }[];
  bottomDimensions: { name: string; score: number }[];
  narrative: string;
  receivedAt: string;
  shortlistCount: number;
}

const items = new Map<string, DscFeedback>();
export const dscFeedbackChain = registerChain(new HashChain<{
  id: string; companyId: string; tier: string; ts: string;
}>("dsc_feedback"));

export function getLatestForCompany(companyId: string): DscFeedback | undefined {
  return Array.from(items.values()).filter((f) => f.companyId === companyId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
}

export function listFeedback(): DscFeedback[] { return Array.from(items.values()); }

export function ingestDscScores(input: {
  companyId: string;
  tier: "watch" | "qualified" | "featured" | "priority";
  dimensions: Record<string, number>;
  narrative: string;
  collectiveShortlist?: { memberRoleId: string }[];
}): DscFeedback {
  return withTrace("comms.dsc.feedback_relay", "1.0.0", "US", () => {
    const dims = Object.entries(input.dimensions).map(([name, score]) => ({ name, score }));
    dims.sort((a, b) => b.score - a.score);
    const top = dims.slice(0, 3);
    const bottom = dims.slice(-3).reverse();
    const id = `dsc_${randomBytes(6).toString("hex")}`;
    const shortlist = input.collectiveShortlist ?? [];
    const f: DscFeedback = {
      id,
      companyId: input.companyId,
      tier: input.tier,
      topDimensions: top,
      bottomDimensions: bottom,
      narrative: input.narrative,
      receivedAt: new Date().toISOString(),
      shortlistCount: shortlist.length,
    };
    items.set(id, f);
    dscFeedbackChain.append({ id, companyId: f.companyId, tier: f.tier, ts: f.receivedAt });
    emitSync({
      eventType: "dsc.review_received",
      aggregateId: input.companyId,
      aggregateKind: "company",
      payload: { id, tier: f.tier, topDimensions: top, bottomDimensions: bottom, shortlistCount: shortlist.length },
      actorUserId: "u_dsc_relay",
    });
    return f;
  });
}

export function __clearDscFeedback(): void {
  items.clear();
  dscFeedbackChain.__clear();
}

export function registerDscFeedbackRoutes(app: Express): void {
  app.get("/api/founder/ma/dsc-feedback", (req: Request, res: Response) => {
    const companyId = String(req.query.companyId ?? "");
    if (!companyId) return res.status(400).json({ error: "companyId required" });
    const f = getLatestForCompany(companyId);
    res.json({ feedback: f ?? null });
  });

  // Mock inbound (in real platform: comes through bridgeInbound)
  app.post("/api/founder/ma/dsc-feedback/_mock_inbound", (req: Request, res: Response) => {
    const parsed = dscScoresInboundSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    const f = ingestDscScores(parsed.data);
    res.status(201).json(f);
  });
}

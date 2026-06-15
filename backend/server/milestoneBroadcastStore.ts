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

/**
 * v25.11 NC2 — milestoneBroadcastStore was RAM-only AND had no ownership
 * check AND used a hardcoded `[u_inv_a..u_inv_e]` dummy fixture for
 * recipients. Three issues, three fixes:
 *   1. Persist each broadcast via kv_milestoneBroadcastStore (this file).
 *   2. Resolve recipients from the canonical cap-table commit ledger
 *      (real investor userIds for the company) — see resolveRecipients
 *      replacement below.
 *   3. Add an ownership guard on the POST handler so only founders of the
 *      company can broadcast.
 */
function _persistBroadcast(bc: MilestoneBroadcast): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { persistEntry } = require("./lib/storePersistenceShim");
    persistEntry("milestoneBroadcastStore", bc.id, bc);
  } catch { /* non-fatal */ }
}

export function hydrateMilestoneBroadcastStore(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { hydrateEntries } = require("./lib/storePersistenceShim");
    const rows = hydrateEntries("milestoneBroadcastStore") as Array<[string, MilestoneBroadcast]>;
    let n = 0;
    for (const [id, bc] of rows) {
      if (bc && id && !items.has(id)) {
        items.set(id, bc);
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}
export const broadcastChain = registerChain(new HashChain<{
  id: string;
  companyId: string;
  segmentKind: SegmentKind;
  recipients: number;
  ts: string;
}>("milestone_broadcasts"));

/**
 * v25.11 NC2 — resolve recipients from the REAL cap-table commit ledger
 * instead of a hard-coded `[u_inv_a..u_inv_e]` fixture. For "all" we return
 * every distinct investor on the company's cap-table. For segment filters we
 * fall through to "all" (the segment metadata — stage/region/series — lives
 * on the investor profile, which is not yet indexed here; conservative
 * fall-through is safer than dropping all recipients).
 *
 * Returns deduplicated investorIds for the company's committed positions.
 */
function resolveRecipients(companyId: string, _segmentKind: SegmentKind, _value?: string): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listMembersForCompany } = require("./captableCommitStore");
    const ledger = listMembersForCompany(companyId) as Array<{ investorId: string }>;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of ledger) {
      if (!e || !e.investorId) continue;
      if (seen.has(e.investorId)) continue;
      seen.add(e.investorId);
      out.push(e.investorId);
    }
    return out;
  } catch {
    /* If the cap-table store is unavailable, return an empty array —
     * better to send to no one than to send to phantom personas. */
    return [];
  }
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
    /* v25.11 NC2 — write-through to DB so the broadcast survives restart. */
    _persistBroadcast(bc);
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

/**
 * v25.11 NC2 — ownership check helper. Returns true if the caller is admin
 * OR is a founder of the supplied company. Anyone else is denied.
 */
function _callerOwnsCompany(req: Request, companyId: string): boolean {
  const ctx = (req as any).userContext;
  if (!ctx?.isAuthed) return false;
  if (ctx.isAdmin) return true;
  const companies: Array<{ companyId: string }> = ctx.founder?.companies ?? [];
  return companies.some((c) => c?.companyId === companyId);
}

export function registerMilestoneBroadcastRoutes(app: Express): void {
  app.get("/api/founder/broadcasts", (req: Request, res: Response) => {
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    /* v25.11 NC2 — the previous GET had no ownership check, so any caller
     * could read any company's broadcasts. Require auth + ownership when
     * companyId is supplied; admins see everything. */
    const ctx = (req as any).userContext;
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    if (companyId && !_callerOwnsCompany(req, companyId)) {
      return res.status(403).json({ ok: false, error: "not_founder_of_company" });
    }
    res.json({ items: listBroadcasts({ companyId }) });
  });

  app.post("/api/founder/broadcasts", (req: Request, res: Response) => {
    const parsed = broadcastCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    const actor = String((req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    /* v25.11 NC2 — the previous handler accepted any companyId without
     * verifying caller ownership, so any authenticated user could broadcast as
     * any founder. Enforce ownership here. */
    if (!_callerOwnsCompany(req, parsed.data.companyId)) {
      return res.status(403).json({ ok: false, error: "not_founder_of_company" });
    }
    const bc = createBroadcast(parsed.data, actor);
    res.status(201).json(bc);
  });
}

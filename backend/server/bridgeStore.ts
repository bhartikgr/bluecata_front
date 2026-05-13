/**
 * Sprint 12 — Capavate ↔ Collective bridge.
 *
 * Implements the canonical envelope from collective_admin_audit.md §13.4:
 * { eventId, eventType, aggregateId, aggregateKind, occurredAt, tenantId,
 *   actor, payload, trace[], auditChain{priorHash,hash}, schemaVersion:"1.0" }
 *
 * Outbound (11 Capavate→Collective):
 *   1. company.profile.updated
 *   2. company.ma_intelligence.updated
 *   3. investor.profile.updated
 *   4. cap_table.mutated
 *   5. eligibility.recomputed
 *   6. lifecycle_policy.changed
 *   7. formula.published
 *   8. audit_log.appended
 *   9. safe.converted
 *  10. note.converted
 *  11. round.closed
 *  (governance_metric.published also supported as bonus)
 *
 * Inbound (4 Collective→Capavate):
 *   1. dsc.scores
 *   2. ma.intelligence_rankings  (nightly)
 *   3. partner.introduction_status
 *   4. network.social_signals
 *
 * Delivery: HMAC-SHA256 over JSON body, Idempotency-Key=eventId,
 * exponential backoff with retry, dead-letter queue captured for /admin/audit-log.
 */
import type { Express, Request, Response } from "express";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { emitMutation } from "./lib/eventBus";

const HMAC_SECRET = process.env.BRIDGE_HMAC_SECRET ?? "capavate-collective-bridge-shared-secret";
const SCHEMA_VERSION = "1.0";

export type OutboundEventType =
  | "company.profile.updated"
  | "company.ma_intelligence.updated"
  | "investor.profile.updated"
  | "cap_table.mutated"
  | "eligibility.recomputed"
  | "lifecycle_policy.changed"
  | "formula.published"
  | "audit_log.appended"
  | "safe.converted"
  | "note.converted"
  | "round.closed"
  | "governance_metric.published"
  // Sprint 16 — round-port gap G1
  | "soft_circle.submitted"
  // Sprint 28 Wave 3 — admin subscription mutations
  | "subscription.updated"
  | "subscription.auto_created_on_company_create"
  // Sprint 28 — pricing model authoring
  | "pricing_model.updated"
  | "pricing_model.published"
  // Sprint 28 Billing — invoice lifecycle
  | "invoice.issued"
  | "invoice.paid"
  | "invoice.refunded"
  | "invoice.voided"
  // Sprint 28 Wave 4 — admin contacts CRM
  | "contact.created"
  | "contact.updated"
  | "contact.verified"
  | "contact.archived"
  // Sprint 28 Wave 5 — region extension workflow
  | "region.proposed"
  | "region.review_submitted"
  | "region.approved"
  | "region.gone_live"
  | "region.rejected"
  // Sprint 28 Wave 6 — notification campaigns
  | "notification_campaign.created"
  | "notification_campaign.scheduled"
  | "notification_campaign.sent"
  | "notification_campaign.canceled"
  // Sprint 28 Wave 7 — email campaigns
  | "email_campaign.created"
  | "email_campaign.scheduled"
  | "email_campaign.sent"
  | "email_campaign.canceled"
  | "email_campaign.test_sent"
  // Sprint 28 Legal — consent ledger
  | "legal_consent.recorded"
  // Sprint 29 KL-01 — company profile
  | "company_profile.updated"
  // Wave C-1 — Founder data authoring
  | "financial.accountant_request_sent"
  | "financial.accountant_filled"
  | "transaction_prep.updated"
  | "profile.completion_changed"
  // Wave C-3 — Collective shell + Deal Room
  | "collective.member.updated"
  | "collective.deal_room.opened"
  // Wave C-4 — DSC scoring engine
  | "dsc.score.recomputed";

export type InboundEventType =
  | "dsc.scores"
  | "ma.intelligence_rankings"
  | "partner.introduction_status"
  | "network.social_signals";

export interface TraceEntry {
  formulaId: string;
  version: string;
  region: string;
  defHash: string;
}

export interface BridgeEnvelope {
  eventId: string;
  eventType: OutboundEventType | InboundEventType;
  aggregateId: string;
  aggregateKind: "company" | "investor" | "round" | "platform";
  occurredAt: string;
  tenantId: string;
  actor: { userId: string; ip?: string };
  payload: Record<string, unknown>;
  trace: TraceEntry[];
  auditChain: { priorHash: string; hash: string };
  schemaVersion: "1.0";
}

export type DeliveryStatus = "queued" | "delivering" | "delivered" | "dead_letter";

export interface OutboxEntry {
  envelope: BridgeEnvelope;
  status: DeliveryStatus;
  attempts: number;
  nextRetryAt: number; // epoch ms
  lastError: string | null;
  hmac: string;
  receivedAck: boolean;
  enqueuedAt: string;
  deliveredAt: string | null;
}

const outbox: OutboxEntry[] = [];
const inbox: BridgeEnvelope[] = [];
let lastChainHash = "0000000000000000000000000000000000000000000000000000000000000000";

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function hmacSign(body: string, secret = HMAC_SECRET): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

export function verifyHmac(body: string, sig: string, secret = HMAC_SECRET): boolean {
  return hmacSign(body, secret) === sig;
}

export const ALL_OUTBOUND_EVENT_TYPES: OutboundEventType[] = [
  "company.profile.updated",
  "company.ma_intelligence.updated",
  "investor.profile.updated",
  "cap_table.mutated",
  "eligibility.recomputed",
  "lifecycle_policy.changed",
  "formula.published",
  "audit_log.appended",
  "safe.converted",
  "note.converted",
  "round.closed",
  "governance_metric.published",
  // Sprint 16 — round-port gap G1
  "soft_circle.submitted",
  // Sprint 28 Wave 3 — admin subscription mutations
  "subscription.updated",
  "subscription.auto_created_on_company_create",
  // Sprint 28 — pricing model authoring
  "pricing_model.updated",
  "pricing_model.published",
  // Sprint 28 Billing — invoice lifecycle
  "invoice.issued",
  "invoice.paid",
  "invoice.refunded",
  "invoice.voided",
  // Sprint 28 Wave 4 — admin contacts CRM
  "contact.created",
  "contact.updated",
  "contact.verified",
  "contact.archived",
  // Sprint 28 Wave 5 — region extension workflow
  "region.proposed",
  "region.review_submitted",
  "region.approved",
  "region.gone_live",
  "region.rejected",
  // Sprint 28 Wave 6 — notification campaigns
  "notification_campaign.created",
  "notification_campaign.scheduled",
  "notification_campaign.sent",
  "notification_campaign.canceled",
  // Sprint 28 Wave 7 — email campaigns
  "email_campaign.created",
  "email_campaign.scheduled",
  "email_campaign.sent",
  "email_campaign.canceled",
  "email_campaign.test_sent",
  // Sprint 28 Legal — consent ledger
  "legal_consent.recorded",
  // Sprint 29 KL-01 — company profile
  "company_profile.updated",
  // Wave C-1 — Founder data authoring
  "financial.accountant_request_sent",
  "financial.accountant_filled",
  "transaction_prep.updated",
  "profile.completion_changed",
  // Wave C-3 — Collective shell + Deal Room
  "collective.member.updated",
  "collective.deal_room.opened",
  // Wave C-4 — DSC scoring engine
  "dsc.score.recomputed",
];

export const ALL_INBOUND_EVENT_TYPES: InboundEventType[] = [
  "dsc.scores",
  "ma.intelligence_rankings",
  "partner.introduction_status",
  "network.social_signals",
];

export interface EmitArgs {
  eventType: OutboundEventType;
  aggregateId: string;
  aggregateKind: BridgeEnvelope["aggregateKind"];
  tenantId?: string;
  actor?: { userId: string; ip?: string };
  payload: Record<string, unknown>;
  trace?: TraceEntry[];
}

/** Emit an outbound bridge event. Returns the envelope. */
export function emitBridgeEvent(args: EmitArgs): OutboxEntry {
  const occurredAt = new Date().toISOString();
  const eventId = `evt_${randomBytes(8).toString("hex")}`;
  const priorHash = lastChainHash;
  const hashBody = `${priorHash}|${eventId}|${args.eventType}|${args.aggregateId}|${occurredAt}`;
  const hash = sha256(hashBody);
  lastChainHash = hash;

  const envelope: BridgeEnvelope = {
    eventId,
    eventType: args.eventType,
    aggregateId: args.aggregateId,
    aggregateKind: args.aggregateKind,
    occurredAt,
    tenantId: args.tenantId ?? "tnt_capavate_us",
    actor: args.actor ?? { userId: "u_admin", ip: "127.0.0.1" },
    payload: args.payload,
    trace: args.trace ?? [],
    auditChain: { priorHash, hash },
    schemaVersion: SCHEMA_VERSION,
  };

  const body = JSON.stringify(envelope);
  const entry: OutboxEntry = {
    envelope,
    status: "queued",
    attempts: 0,
    nextRetryAt: Date.now(),
    lastError: null,
    hmac: hmacSign(body),
    receivedAck: false,
    enqueuedAt: occurredAt,
    deliveredAt: null,
  };
  outbox.push(entry);
  // Fan out to SSE realtime channel so admin Bridge page + collective dashboard update within ~1s
  emitMutation({ aggregate: "bridge", id: entry.envelope.eventId, change: "create" });
  return entry;
}

/**
 * Drain the outbox via direct in-process call to the mock receiver.
 * Returns count delivered.
 */
export async function drainOutbox(deliver: (env: BridgeEnvelope, hmac: string) => Promise<{ ok: boolean; status: number }>): Promise<{ delivered: number; deadLettered: number }> {
  let delivered = 0;
  let deadLettered = 0;
  const now = Date.now();
  for (const e of outbox) {
    if (e.status === "delivered" || e.status === "dead_letter") continue;
    if (e.nextRetryAt > now) continue;
    e.status = "delivering";
    e.attempts += 1;
    try {
      const res = await deliver(e.envelope, e.hmac);
      if (res.ok || res.status === 409) {
        e.status = "delivered";
        e.receivedAck = true;
        e.deliveredAt = new Date().toISOString();
        e.lastError = null;
        delivered++;
      } else {
        e.lastError = `HTTP ${res.status}`;
        if (e.attempts >= 5) {
          e.status = "dead_letter";
          deadLettered++;
        } else {
          e.status = "queued";
          e.nextRetryAt = now + Math.min(60_000, Math.pow(2, e.attempts) * 1000);
        }
      }
    } catch (err) {
      e.lastError = (err as Error).message;
      if (e.attempts >= 5) {
        e.status = "dead_letter";
        deadLettered++;
      } else {
        e.status = "queued";
        e.nextRetryAt = now + Math.min(60_000, Math.pow(2, e.attempts) * 1000);
      }
    }
  }
  return { delivered, deadLettered };
}

export function getOutbox(): OutboxEntry[] {
  return outbox;
}

export function getInbox(): BridgeEnvelope[] {
  return inbox;
}

export function pushInbound(env: BridgeEnvelope): void {
  inbox.push(env);
}

/** Seed a few demo events so the admin surface has something to show. */
export function seedDemoEvents(): void {
  if (outbox.length > 0) return;
  emitBridgeEvent({
    eventType: "company.profile.updated",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    payload: { changedFields: ["legalName", "stage"], stage: "seed_extension" },
    trace: [{ formulaId: "ca-default-v1", version: "1.0.0", region: "US", defHash: sha256("ca-default-v1") }],
  });
  emitBridgeEvent({
    eventType: "cap_table.mutated",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    payload: { roundId: "rnd_novapay_seed", txCount: 3, totalIssued: "12500000" },
    trace: [{ formulaId: "ca-default-v1", version: "1.0.0", region: "US", defHash: sha256("ca-default-v1") }],
  });
  emitBridgeEvent({
    eventType: "eligibility.recomputed",
    aggregateId: "u_aisha_patel",
    aggregateKind: "investor",
    payload: { eligibilityScore: 78, eligibilityFlags: { investorOnCapTable: true } },
  });
  emitBridgeEvent({
    eventType: "lifecycle_policy.changed",
    aggregateId: "platform",
    aggregateKind: "platform",
    payload: { founderTenureDays: 180, archiveRetentionDays: 3650, nonPaymentGraceDays: 30 },
  });
  emitBridgeEvent({
    eventType: "audit_log.appended",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    payload: { entryId: "al_001", priorHash: "0e2af1...", hash: "8b7ce4..." },
  });
  // Sprint 16 G4 — round.closed removed: rnd_novapay_seed is still active
  // (state: soft_circle_open, $2.65M of $4M raised). Closing it in seed creates state confusion.
  emitBridgeEvent({
    eventType: "safe.converted",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    payload: { safeId: "safe_007", priceUsed: "12.50", sharesIssued: "32000" },
  });
  emitBridgeEvent({
    eventType: "note.converted",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    payload: { noteId: "note_002", priceUsed: "11.875", sharesIssued: "21000" },
  });
  emitBridgeEvent({
    eventType: "investor.profile.updated",
    aggregateId: "u_aisha_patel",
    aggregateKind: "investor",
    payload: { changedFields: ["accreditationStatus"], accreditationStatus: "verified" },
  });
  emitBridgeEvent({
    eventType: "company.ma_intelligence.updated",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    payload: { compositeScore: 82, mnaScore: 76, roundScore: 88 },
  });
  emitBridgeEvent({
    eventType: "formula.published",
    aggregateId: "ca-default-v2",
    aggregateKind: "platform",
    payload: { formulaId: "ca-default-v2", version: "2.0.0", testsPassed: 332 },
  });

  // Sprint 16 G5 — bridge the 3 ghost companies (Arboreal Health, Kelvin Energy, Quanta Robotics)
  for (const cid of ["co_arboreal", "co_kelvin", "co_quanta"] as const) {
    emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: cid,
      aggregateKind: "company",
      payload: { changedFields: ["legalName", "stage"], stage: "seed", visibleToCollective: true },
      trace: [{ formulaId: "ca-default-v1", version: "1.0.0", region: "US", defHash: sha256("ca-default-v1") }],
    });
  }

  // Sprint 16 G6 — eligibility.recomputed for the other 3 cap-table investors of NovaPay seed
  for (const uid of ["u_hydra_capital", "u_forge_ventures", "u_bluepoint_partners"] as const) {
    emitBridgeEvent({
      eventType: "eligibility.recomputed",
      aggregateId: uid,
      aggregateKind: "investor",
      payload: { eligibilityScore: 80, eligibilityFlags: { investorOnCapTable: true } },
    });
  }

  // Sprint 16 G1 — seed soft_circle.submitted events (4 soft-circlers on rnd_novapay_seed)
  for (const sc of [
    { id: "sc_001", investorId: "u_aisha_patel",        amountUsd: "250000" },
    { id: "sc_002", investorId: "u_hydra_capital",      amountUsd: "1500000" },
    { id: "sc_003", investorId: "u_forge_ventures",     amountUsd: "500000" },
    { id: "sc_004", investorId: "u_bluepoint_partners", amountUsd: "400000" },
  ]) {
    emitBridgeEvent({
      eventType: "soft_circle.submitted",
      aggregateId: sc.id,
      aggregateKind: "round",
      payload: {
        softCircleId: sc.id,
        roundId: "rnd_novapay_seed",
        companyId: "co_novapay",
        investorId: sc.investorId,
        amountUsd: sc.amountUsd,
        status: "recorded",
      },
    });
  }

  // Seed inbound demo
  inbox.push({
    eventId: `evt_${randomBytes(8).toString("hex")}`,
    eventType: "ma.intelligence_rankings",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    occurredAt: new Date().toISOString(),
    tenantId: "tnt_collective",
    actor: { userId: "u_collective_batch" },
    payload: { compositeScore: 82, sectorBenchmark: 71, autoTier: "A" },
    trace: [],
    auditChain: { priorHash: "abc", hash: "def" },
    schemaVersion: SCHEMA_VERSION,
  });
  inbox.push({
    eventId: `evt_${randomBytes(8).toString("hex")}`,
    eventType: "dsc.scores",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    occurredAt: new Date().toISOString(),
    tenantId: "tnt_collective",
    actor: { userId: "u_dsc_review" },
    payload: { dscScore: 4.2, dscRecommendation: "advance", reviewerIds: ["u_r1", "u_r2"] },
    trace: [],
    auditChain: { priorHash: "abc", hash: "ghi" },
    schemaVersion: SCHEMA_VERSION,
  });
  inbox.push({
    eventId: `evt_${randomBytes(8).toString("hex")}`,
    eventType: "partner.introduction_status",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    occurredAt: new Date().toISOString(),
    tenantId: "tnt_collective",
    actor: { userId: "u_partner_relay" },
    payload: { partnerId: "p_y_combinator", introductionStatus: "warm_intro_made", vouchWeight: 1 },
    trace: [],
    auditChain: { priorHash: "abc", hash: "jkl" },
    schemaVersion: SCHEMA_VERSION,
  });
  inbox.push({
    eventId: `evt_${randomBytes(8).toString("hex")}`,
    eventType: "network.social_signals",
    aggregateId: "co_novapay",
    aggregateKind: "company",
    occurredAt: new Date().toISOString(),
    tenantId: "tnt_collective",
    actor: { userId: "u_social_relay" },
    payload: { followerCount: 12400, mentionCount: 81, networkActivity: "trending" },
    trace: [],
    auditChain: { priorHash: "abc", hash: "mno" },
    schemaVersion: SCHEMA_VERSION,
  });
}

export function registerBridgeRoutes(app: Express): void {
  seedDemoEvents();

  // Mock Collective receiver — accepts envelopes, validates HMAC, idempotency.
  const seenIds = new Set<string>();
  app.post("/api/_mock_collective/inbound", (req: Request, res: Response) => {
    const sig = String(req.headers["x-bridge-signature"] ?? "");
    const idem = String(req.headers["idempotency-key"] ?? "");
    const body = JSON.stringify(req.body ?? {});
    if (!verifyHmac(body, sig)) {
      return res.status(401).json({ error: "invalid_hmac" });
    }
    if (idem && seenIds.has(idem)) {
      return res.status(409).json({ error: "already_received", idempotencyKey: idem });
    }
    if (idem) seenIds.add(idem);
    res.status(200).json({ ok: true, eventId: req.body?.eventId, receivedAt: new Date().toISOString() });
  });

  // List outbound events
  app.get("/api/admin/bridge/outbox", (_req: Request, res: Response) => {
    res.json({
      total: outbox.length,
      delivered: outbox.filter(e => e.status === "delivered").length,
      queued: outbox.filter(e => e.status === "queued").length,
      deadLettered: outbox.filter(e => e.status === "dead_letter").length,
      eventTypes: ALL_OUTBOUND_EVENT_TYPES,
      entries: outbox.slice(-100).map(e => ({
        eventId: e.envelope.eventId,
        eventType: e.envelope.eventType,
        aggregateId: e.envelope.aggregateId,
        aggregateKind: e.envelope.aggregateKind,
        occurredAt: e.envelope.occurredAt,
        status: e.status,
        attempts: e.attempts,
        lastError: e.lastError,
        receivedAck: e.receivedAck,
        priorHash: e.envelope.auditChain.priorHash,
        hash: e.envelope.auditChain.hash,
        hmac: e.hmac.slice(0, 16) + "…",
      })),
    });
  });

  // Get single envelope
  app.get("/api/admin/bridge/event/:id", (req: Request, res: Response) => {
    const e = outbox.find(o => o.envelope.eventId === req.params.id);
    if (!e) return res.status(404).json({ error: "not_found" });
    res.json({ envelope: e.envelope, status: e.status, hmac: e.hmac, attempts: e.attempts });
  });

  // List inbound (Collective→Capavate)
  app.get("/api/admin/bridge/inbox", (_req: Request, res: Response) => {
    res.json({
      total: inbox.length,
      eventTypes: ALL_INBOUND_EVENT_TYPES,
      entries: inbox.slice(-100),
    });
  });

  // Drain — call the in-process mock receiver
  app.post("/api/admin/bridge/drain", async (req: Request, res: Response) => {
    const proto = String(req.headers["x-forwarded-proto"] ?? "http");
    const host = String(req.headers.host ?? `127.0.0.1:5000`);
    const baseUrl = `${proto}://${host}`;
    const result = await drainOutbox(async (env, hmac) => {
      try {
        const r = await fetch(`${baseUrl}/api/_mock_collective/inbound`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bridge-signature": hmac,
            "idempotency-key": env.eventId,
          },
          body: JSON.stringify(env),
        });
        return { ok: r.ok, status: r.status };
      } catch {
        return { ok: false, status: 0 };
      }
    });
    res.json(result);
  });

  // Emit a custom envelope (admin-only test action)
  app.post("/api/admin/bridge/emit", (req: Request, res: Response) => {
    const { eventType, aggregateId, aggregateKind, payload } = req.body ?? {};
    if (!ALL_OUTBOUND_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ error: "invalid_event_type", allowed: ALL_OUTBOUND_EVENT_TYPES });
    }
    const e = emitBridgeEvent({
      eventType,
      aggregateId: aggregateId ?? "co_novapay",
      aggregateKind: aggregateKind ?? "company",
      payload: payload ?? {},
    });
    res.json({ eventId: e.envelope.eventId, hmac: e.hmac });
  });

  // Sprint 16 A4 — demo reset + replay (admin-SES-gated for safety).
  app.post("/api/admin/sync/reset-demo", async (req: Request, res: Response) => {
    const ses = String(req.headers["x-admin-ses"] ?? req.body?.ses ?? "");
    if (!ses || ses.length < 8) {
      return res.status(401).json({ error: "admin_ses_required" });
    }
    const { resetDemoState } = await import("../scripts/reset-demo");
    const summary = resetDemoState();
    res.json({ ok: summary.ok, summary, outbox: outbox.length, inbox: inbox.length });
  });

  // Verify chain integrity
  app.get("/api/admin/bridge/verify-chain", (_req: Request, res: Response) => {
    let prior = "0000000000000000000000000000000000000000000000000000000000000000";
    let broken = -1;
    for (let i = 0; i < outbox.length; i++) {
      const env = outbox[i].envelope;
      if (env.auditChain.priorHash !== prior) { broken = i; break; }
      const expected = sha256(`${prior}|${env.eventId}|${env.eventType}|${env.aggregateId}|${env.occurredAt}`);
      if (env.auditChain.hash !== expected) { broken = i; break; }
      prior = env.auditChain.hash;
    }
    res.json({ ok: broken === -1, brokenAt: broken, totalLinks: outbox.length });
  });
}

export const _testBridge = { sha256, lastChainHash: () => lastChainHash, resetChain: () => { lastChainHash = "0000000000000000000000000000000000000000000000000000000000000000"; outbox.length = 0; inbox.length = 0; } };

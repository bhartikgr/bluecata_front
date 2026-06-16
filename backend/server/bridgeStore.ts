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
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { emitMutation } from "./lib/eventBus";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { getDb } from "./db/connection";
import { rawDb } from "./db/connection";
import { bridgeOutbox as bridgeOutboxTable } from "@shared/schema";
import { log } from "./lib/logger";
import { requireAdmin } from "./lib/authMiddleware"; /* v25.16 NC4 — gate admin bridge routes */

/* ============================================================
 * v24.5 GAP-2 — Bridge event history (circular buffer, 1000 rows)
 *
 * A durable audit log of delivered/dead-letter bridge events so admins
 * can inspect past events even after the outbox drain removes them.
 * Uses a raw SQLite table (NOT in shared/schema.ts — sacred file)
 * created idempotently at module load via CREATE TABLE IF NOT EXISTS.
 * ============================================================ */

const HISTORY_MAX_ROWS = 1000;

/** Idempotently create the bridge_event_history table. */
function ensureHistoryTable(): void {
  try {
    rawDb().exec(
      `CREATE TABLE IF NOT EXISTS bridge_event_history (
        id           TEXT PRIMARY KEY,
        event_type   TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_kind TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        hmac         TEXT NOT NULL,
        status       TEXT NOT NULL,
        attempts     INTEGER NOT NULL DEFAULT 0,
        last_error   TEXT,
        enqueued_at  TEXT NOT NULL,
        resolved_at  TEXT NOT NULL
      )`,
    );
  } catch (err) {
    log.warn("[bridgeStore] ensureHistoryTable failed:", (err as Error).message);
  }
}

// Ensure the table exists at module load time.
try { ensureHistoryTable(); } catch { /* non-fatal */ }

/** Insert an outbox entry into bridge_event_history before drain removes it. */
function insertBridgeHistory(entry: OutboxEntry): void {
  try {
    const db = rawDb();
    db.prepare(
      `INSERT OR IGNORE INTO bridge_event_history
         (id, event_type, aggregate_id, aggregate_kind, envelope_json, hmac,
          status, attempts, last_error, enqueued_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.envelope.eventId,
      entry.envelope.eventType,
      entry.envelope.aggregateId,
      entry.envelope.aggregateKind,
      JSON.stringify(entry.envelope),
      entry.hmac,
      entry.status,
      entry.attempts,
      entry.lastError ?? null,
      entry.enqueuedAt,
      new Date().toISOString(),
    );
    // Prune to last HISTORY_MAX_ROWS (circular buffer semantics).
    db.prepare(
      `DELETE FROM bridge_event_history
        WHERE id IN (
          SELECT id FROM bridge_event_history
          ORDER BY resolved_at DESC
          LIMIT -1 OFFSET ?
        )`,
    ).run(HISTORY_MAX_ROWS);
  } catch (err) {
    log.warn("[bridgeStore] insertBridgeHistory failed:", (err as Error).message);
  }
}

/**
 * Wave C / FIX C3 (Ozan, 24-May-2026) — bridge_outbox DB write-through.
 *
 * Pre-fix the outbox lived ONLY in the `outbox: OutboxEntry[]` Array below.
 * On process restart every queued envelope was lost. The `bridge_outbox`
 * SQL table existed (shared/schema.ts:477) but nothing wrote to it. This
 * patch adds best-effort write-through:
 *   • INSERT on `emitBridgeEvent` (every new envelope).
 *   • UPDATE on `drainOutbox` after each delivery attempt (status,
 *     attempts, deliveredAt, lastError, nextRetryAt).
 * Writes are wrapped in try/catch and logged on failure — the in-memory
 * outbox remains the source of truth at runtime, so a DB outage never
 * blocks a bridge emit. A subsequent boot can rehydrate by querying the
 * table directly; that hydration helper is provided as `_hydrateOutbox`.
 */
function persistOutboxInsert(entry: OutboxEntry): void {
  try {
    const db = getDb();
    db.insert(bridgeOutboxTable)
      .values({
        id: entry.envelope.eventId,
        eventType: entry.envelope.eventType,
        aggregateId: entry.envelope.aggregateId,
        aggregateKind: entry.envelope.aggregateKind,
        envelopeJson: JSON.stringify(entry.envelope),
        hmac: entry.hmac,
        status: entry.status,
        attempts: entry.attempts,
        nextRetryAt: entry.nextRetryAt,
        enqueuedAt: entry.enqueuedAt,
        deliveredAt: entry.deliveredAt,
        lastError: entry.lastError,
      })
      .onConflictDoNothing()
      .run();
  } catch (err) {
    log.warn(
      `[bridgeStore.persistOutboxInsert] DB write-through failed for ${entry.envelope.eventId}: ${(err as Error).message}`,
    );
  }
}

function persistOutboxUpdate(entry: OutboxEntry): void {
  try {
    const db = getDb();
    db.update(bridgeOutboxTable)
      .set({
        status: entry.status,
        attempts: entry.attempts,
        nextRetryAt: entry.nextRetryAt,
        deliveredAt: entry.deliveredAt,
        lastError: entry.lastError,
      })
      .where(eq(bridgeOutboxTable.id, entry.envelope.eventId))
      .run();
  } catch (err) {
    log.warn(
      `[bridgeStore.persistOutboxUpdate] DB write-through failed for ${entry.envelope.eventId}: ${(err as Error).message}`,
    );
  }
}

/**
 * v25.4 — hydrate the in-memory outbox from bridge_outbox on boot.
 *
 * Previously declared in comments but never implemented; queued events were
 * lost on every server restart. This implementation reads every undelivered
 * envelope from DB and rehydrates the runtime outbox so the drain worker can
 * resume delivery. Idempotent: if the outbox already has the entry (e.g. a
 * second hydrate call) we skip.
 */
export function hydrateBridgeStore(): void {
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT id, event_type, aggregate_id, aggregate_kind, envelope_json, hmac,
                status, attempts, next_retry_at, enqueued_at, delivered_at, last_error
           FROM bridge_outbox
          WHERE status IN ('queued','delivering')
          ORDER BY enqueued_at ASC`,
      )
      .all() as any[];
    const seen = new Set(outbox.map((e) => e.envelope.eventId));
    let restored = 0;
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      let envelope: BridgeEnvelope;
      try {
        envelope = JSON.parse(r.envelope_json);
      } catch {
        log.warn(`[bridgeStore.hydrate] skipping malformed envelope ${r.id}`);
        continue;
      }
      outbox.push({
        envelope,
        status: (r.status ?? "queued") as DeliveryStatus,
        attempts: Number(r.attempts ?? 0),
        nextRetryAt: Number(r.next_retry_at ?? Date.now()),
        lastError: r.last_error ?? null,
        hmac: String(r.hmac ?? ""),
        receivedAck: false,
        enqueuedAt: String(r.enqueued_at ?? new Date().toISOString()),
        deliveredAt: r.delivered_at ?? null,
      });
      restored++;
    }
    if (restored > 0) {
      log.info(`[hydrate] bridgeStore: ${restored} queued envelopes restored from bridge_outbox`);
    }
    /* v25.17 Lane E NH4 — restore the hash-chain head from the most recently
       enqueued envelope so subsequent emits continue the chain instead of
       restarting from genesis after a server restart. We query ALL statuses
       (including delivered) so the chain head is preserved even if no
       envelopes are still in-flight. */
    try {
      const tipRows = db
        .prepare(
          `SELECT envelope_json FROM bridge_outbox
             ORDER BY enqueued_at DESC LIMIT 1`,
        )
        .all() as any[];
      if (tipRows.length > 0) {
        const env = JSON.parse(tipRows[0].envelope_json);
        const tipHash = env?.auditChain?.hash;
        if (typeof tipHash === "string" && /^[0-9a-f]{64}$/i.test(tipHash)) {
          lastChainHash = tipHash;
          log.info(`[hydrate] bridgeStore: chain head restored to ${tipHash.slice(0, 12)}…`);
        }
      }
    } catch (chainErr) {
      const msg = (chainErr as Error).message ?? "";
      if (!/no such table/i.test(msg)) {
        log.warn("[hydrate] bridgeStore: chain-head restore failed:", msg);
      }
    }
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (!/no such table/i.test(msg)) {
      log.warn("[hydrate] bridgeStore: DB read failed:", msg);
    }
  }
}

/* v25.16 NM5 — align env var lookup with .env.example (which declares
   BRIDGE_INBOUND_HMAC_SECRET) so deployments following the template actually
   sign with the intended secret rather than the hardcoded default. We accept
   either name for backward compatibility, prefer the canonical inbound name,
   and warn loudly in production if neither is set. */
const HMAC_SECRET =
  process.env.BRIDGE_INBOUND_HMAC_SECRET ??
  process.env.BRIDGE_HMAC_SECRET ??
  "capavate-collective-bridge-shared-secret";
if (process.env.NODE_ENV === "production" && HMAC_SECRET === "capavate-collective-bridge-shared-secret") {
  log.warn("[bridge] BRIDGE_INBOUND_HMAC_SECRET (or BRIDGE_HMAC_SECRET) is not set in production — using insecure default!");
}
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
  // v25.0 Track 2 B1 — Collective interest threads
  | "collective.interest.created"
  // Wave C-4 — DSC scoring engine
  | "dsc.score.recomputed"
  // Foundation — Partner CRM + SPV/Fund record-keeping
  | "partner.onboarded"
  | "partner.tier_changed"
  | "partner.attribution_created"
  | "partner.attribution_revoked"
  | "partner.team_member_added"
  | "partner.team_member_removed"
  | "partner.spv_recorded"
  | "partner.fund_commitment_pledged"
  // Final Partner CRM — promote / refer flow
  | "partner.deal.promoted_to_collective"
  | "partner.deal.referred_to_capavate"
  // v25.13 NM5 — chapter admin promote/demote events.
  | "collective.chapter_admin.promoted"
  | "collective.chapter_admin.demoted"
  // v25.14 — partner cross-component events.
  | "partner.referral.approved"
  | "partner.promotion.approved"
  // v25.24 NM-3 fix — v25.23 NM-O emitBridgeEvent in applyModeration emits
  // these two when the moderation outcome is reject or changes_requested,
  // but they were never added to the type union OR the ALL_OUTBOUND_EVENT_TYPES
  // allowlist, so the bridge worker silently dropped them. Now wired so
  // Collective + Capavate consumers can react.
  | "partner.promotion.rejected"
  | "partner.promotion.changes_requested"
  | "partner.company_linked"
  | "partner.company_unlinked"
  | "partner.suspended"
  | "partner.reactivated"
  | "partner.archived"
  | "partner.application_submitted"
  | "partner.application_approved"
  | "partner.application_rejected";

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
  /* v25.27 — widened to match actual usage. Pre-v25.27 source already passed
   * 'pricing_model', 'invitation', 'application', 'contact', 'captable_entry',
   * 'broadcast', 'report' through this field, but the type was too narrow,
   * producing dozens of TS2322 errors that drove the baseline up. This widening
   * cleans them up without changing any runtime behavior. */
  aggregateKind:
    | "company"
    | "investor"
    | "round"
    | "platform"
    | "pricing_model"
    | "invitation"
    | "application"
    | "contact"
    | "captable_entry"
    | "broadcast"
    | "report";
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
  /* v25.17 Lane B NH1 — constant-time HMAC comparison. Guard against length
     mismatch (timingSafeEqual throws on unequal-length buffers) and ensure both
     sides are valid hex before decoding. */
  if (typeof sig !== "string" || !/^[0-9a-fA-F]+$/.test(sig)) return false;
  const expectedHex = hmacSign(body, secret);
  if (sig.length !== expectedHex.length) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const provided = Buffer.from(sig, "hex");
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
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
  "collective.interest.created",
  // Wave C-4 — DSC scoring engine
  "dsc.score.recomputed",
  // Foundation — Partner CRM + SPV/Fund record-keeping
  "partner.onboarded",
  "partner.tier_changed",
  "partner.attribution_created",
  "partner.attribution_revoked",
  "partner.team_member_added",
  "partner.team_member_removed",
  "partner.spv_recorded",
  "partner.fund_commitment_pledged",
  // Final Partner CRM — promote / refer flow
  "partner.deal.promoted_to_collective",
  "partner.deal.referred_to_capavate",
  // v25.13 NM5 — chapter admin promote/demote events.
  "collective.chapter_admin.promoted",
  "collective.chapter_admin.demoted",
  // v25.14 — partner cross-component events.
  "partner.referral.approved",
  "partner.promotion.approved",
  // v25.24 NM-3 — see type union above for rationale.
  "partner.promotion.rejected",
  "partner.promotion.changes_requested",
  "partner.company_linked",
  "partner.company_unlinked",
  "partner.suspended",
  "partner.reactivated",
  "partner.archived",
  "partner.application_submitted",
  "partner.application_approved",
  "partner.application_rejected",
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
  // Wave C FIX C3 — write-through to bridge_outbox SQL table (best-effort).
  persistOutboxInsert(entry);
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
    // v24.5 GAP-2 — INSERT into history BEFORE the outbox entry is
    // considered ephemeral. We record every terminal transition
    // (delivered or dead_letter) so the circular-buffer audit log
    // captures every event the worker processes.
    if (e.status === "delivered" || e.status === "dead_letter") {
      insertBridgeHistory(e);
    }
    // Wave C FIX C3 — mirror status change into DB (best-effort).
    persistOutboxUpdate(e);
  }
  return { delivered, deadLettered };
}

export function getOutbox(): OutboxEntry[] {
  return outbox;
}

/**
 * v25.19 Lane 4 NC3 (hard close) — DLQ replay primitive.
 *
 * Flips a dead_letter envelope back to queued, resets attempts + lastError +
 * nextRetryAt, and persists the row. The standard `processOutbox()` worker
 * tick picks it up like any other queued envelope.
 *
 * Returns `{ ok: true, entry }` on successful replay, `{ ok: false, error }`
 * when the eventId is unknown or not currently in `dead_letter`.
 */
export function replayDeadLetter(eventId: string): { ok: true; entry: OutboxEntry } | { ok: false; error: string } {
  const e = outbox.find((x) => x.envelope.eventId === eventId);
  if (!e) return { ok: false, error: "event_not_found" };
  if (e.status !== "dead_letter") return { ok: false, error: `not_in_dead_letter:${e.status}` };
  e.status = "queued";
  e.attempts = 0;
  e.lastError = undefined;
  e.nextRetryAt = new Date().toISOString();
  persistOutboxUpdate(e);
  return { ok: true, entry: e };
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
  // Patch v4: demo bridge events only when demo gate on.
  if (DEMO_SEED_ENABLED) {
    seedDemoEvents();
  }

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
  /* v25.16 NC4 — admin bridge endpoints were unauthenticated; gated under requireAdmin. */
  app.get("/api/admin/bridge/outbox", requireAdmin, (_req: Request, res: Response) => {
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
        // v25.5 — defensive against rehydrated envelopes whose audit chain
        // was synthesized from DB-only rows (e.g. test injection or pre-v25.4
        // legacy envelopes with no auditChain JSON field). The original
        // implementation crashed the whole /api/admin/bridge/outbox view
        // when even one envelope lacked auditChain. Now we return null and
        // keep the page rendering.
        priorHash: e.envelope.auditChain?.priorHash ?? null,
        hash: e.envelope.auditChain?.hash ?? null,
        hmac: (e.hmac ?? "").slice(0, 16) + "…",
      })),
    });
  });

  // Get single envelope
  app.get("/api/admin/bridge/event/:id", requireAdmin, (req: Request, res: Response) => {
    const e = outbox.find(o => o.envelope.eventId === req.params.id);
    if (!e) return res.status(404).json({ error: "not_found" });
    res.json({ envelope: e.envelope, status: e.status, hmac: e.hmac, attempts: e.attempts });
  });

  // List inbound (Collective→Capavate)
  app.get("/api/admin/bridge/inbox", requireAdmin, (_req: Request, res: Response) => {
    res.json({
      total: inbox.length,
      eventTypes: ALL_INBOUND_EVENT_TYPES,
      entries: inbox.slice(-100),
    });
  });

  // Drain — call the in-process mock receiver
  app.post("/api/admin/bridge/drain", requireAdmin, async (req: Request, res: Response) => {
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
  app.post("/api/admin/bridge/emit", requireAdmin, (req: Request, res: Response) => {
    const { eventType, aggregateId, aggregateKind, payload } = req.body ?? {};
    if (!ALL_OUTBOUND_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ error: "invalid_event_type", allowed: ALL_OUTBOUND_EVENT_TYPES });
    }
    // v14 — aggregateId must be supplied by the admin caller; no "co_novapay" fallback.
    if (!aggregateId || typeof aggregateId !== "string") {
      return res.status(400).json({ error: "aggregateId_required" });
    }
    const e = emitBridgeEvent({
      eventType,
      aggregateId,
      aggregateKind: aggregateKind ?? "company",
      payload: payload ?? {},
    });
    res.json({ eventId: e.envelope.eventId, hmac: e.hmac });
  });

  // Sprint 16 A4 — demo reset + replay (admin-SES-gated for safety).
  /* v25.16 NC4 — was guarded only by a trivial 8-char string length check on
     x-admin-ses; replaced with proper requireAdmin session middleware. */
  app.post("/api/admin/sync/reset-demo", requireAdmin, async (req: Request, res: Response) => {
    const { resetDemoState } = await import("../scripts/reset-demo");
    const summary = resetDemoState();
    res.json({ ok: summary.ok, summary, outbox: outbox.length, inbox: inbox.length });
  });

  // v24.5 GAP-2 — Admin-visible bridge event history (circular buffer, 1000 rows).
  // Returns the last N resolved events from bridge_event_history.
  // Default N = 100; override via ?limit= (max 1000).
  app.get("/api/admin/bridge/history", requireAdmin, (_req: Request, res: Response) => {
    const rawLimit = _req.query.limit;
    const limitNum = Math.min(
      1000,
      Math.max(1, parseInt(typeof rawLimit === "string" ? rawLimit : "100", 10) || 100),
    );
    try {
      const rows = rawDb().prepare(
        `SELECT id, event_type, aggregate_id, aggregate_kind, status, attempts,
                last_error, enqueued_at, resolved_at
           FROM bridge_event_history
          ORDER BY resolved_at DESC
          LIMIT ?`,
      ).all(limitNum) as Array<Record<string, unknown>>;
      res.json({
        total: rows.length,
        limit: limitNum,
        entries: rows.map((r) => ({
          eventId:       r.id,
          eventType:     r.event_type,
          aggregateId:   r.aggregate_id,
          aggregateKind: r.aggregate_kind,
          status:        r.status,
          attempts:      r.attempts,
          lastError:     r.last_error ?? null,
          enqueuedAt:    r.enqueued_at,
          resolvedAt:    r.resolved_at,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: "history_unavailable", detail: (err as Error).message });
    }
  });

  // Verify chain integrity
  app.get("/api/admin/bridge/verify-chain", requireAdmin, (_req: Request, res: Response) => {
    let prior = "0000000000000000000000000000000000000000000000000000000000000000";
    let broken = -1;
    for (let i = 0; i < outbox.length; i++) {
      const env = outbox[i].envelope;
      // v25.5 — skip envelopes that have no audit chain (rehydrated
      // synthetic / test entries). They cannot be verified but should not
      // crash the verifier.
      if (!env.auditChain) continue;
      if (env.auditChain.priorHash !== prior) { broken = i; break; }
      const expected = sha256(`${prior}|${env.eventId}|${env.eventType}|${env.aggregateId}|${env.occurredAt}`);
      if (env.auditChain.hash !== expected) { broken = i; break; }
      prior = env.auditChain.hash;
    }
    res.json({ ok: broken === -1, brokenAt: broken, totalLinks: outbox.length });
  });
}

export const _testBridge = { sha256, lastChainHash: () => lastChainHash, resetChain: () => { lastChainHash = "0000000000000000000000000000000000000000000000000000000000000000"; outbox.length = 0; inbox.length = 0; } };

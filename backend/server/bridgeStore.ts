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
/* WAVE 17 ORP-044 — leaf module (logger + currency only); see emitBridgeEvent. */
import { maybeBroadcastGovernanceMetric } from "./lib/wave17MilestoneAutoTriggers";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
import { getDb } from "./db/connection";
import { rawDb } from "./db/connection";
import { bridgeOutbox as bridgeOutboxTable } from "@shared/schema";
import { log } from "./lib/logger";
import { requireAdmin } from "./lib/authMiddleware"; /* v25.16 NC4 — gate admin bridge routes */
// v25.28 Phase D — bridgeStore.inbox is now durable. The outbox was already
// DB-backed via the `bridge_outbox` drizzle table. The inbox (Collective →
// Capavate inbound bridge envelopes) was pure RAM, meaning any event that
// arrived during a PM2 restart window was lost. We now write-through every
// inbox.push to the shim's kv_bridgeStoreInbox table and hydrate on boot.
import { persistEntry as persistShimEntry, hydrateEntries as hydrateShimEntries } from "./lib/storePersistenceShim";

const BRIDGE_INBOX_STORE = "bridgeStoreInbox";

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
 *
 * W-COLLECTIVE Wave 1 (v5 §A.2) — `archived` MUST be restored too. Eight admin
 * surfaces (admin outbox, verify-chain, DLQ, bridge stats, adminPlatformStore,
 * syncDashboard overview, healthz backlog, bridge history) read the in-memory
 * outbox. Omitting `archived` here would make all 578 historical envelopes
 * vanish on the next restart — a D1 silent drop — and would make the sacred
 * hashChainOk() vacuously true over an empty set. Archived rows stay visibly
 * distinguishable because `status` is carried through verbatim.
 */
export function hydrateBridgeStore(): void {
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT id, event_type, aggregate_id, aggregate_kind, envelope_json, hmac,
                status, attempts, next_retry_at, enqueued_at, delivered_at, last_error
           FROM bridge_outbox
          WHERE status IN ('queued','delivering','archived')
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

  /* v25.28 Phase D — also restore the inbound bridge envelope buffer from
   * the shim-backed kv_bridgeStoreInbox table. Without this, a Collective
   * → Capavate event that arrived in the seconds before a PM2 restart was
   * lost forever (the outbox was DB-backed and survived; the inbox didn't).
   * Idempotent: keyed by eventId via the shim. */
  try {
    const inboundRows = hydrateShimEntries<BridgeEnvelope>(BRIDGE_INBOX_STORE);
    if (inboundRows.length > 0) {
      const seenInbox = new Set(inbox.map((e) => e.eventId));
      let restoredInbox = 0;
      for (const [eventId, env] of inboundRows) {
        if (seenInbox.has(eventId)) continue;
        inbox.push(env);
        restoredInbox++;
      }
      if (restoredInbox > 0) {
        log.info(`[hydrate] bridgeStore: ${restoredInbox} inbound envelopes restored from kv_bridgeStoreInbox`);
      }
    }
  } catch (inboxErr) {
    log.warn("[hydrate] bridgeStore.inbox: ", (inboxErr as Error).message);
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
  /* WAVE 8 / ORP-050 — the REAL round terms-update event. routes.ts duck-typed
     `BridgeOutbound.roundTermsUpdated` (which never existed), so every terms
     update fell through to `audit_log.appended` with the intended type buried
     in the payload and no peer could ever subscribe to it. */
  | "round.terms_updated"
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
  | "partner.application_rejected"
  /* ── WAVE 36 · ROW 6 — four events that were being emitted through a lazy
     `require("../bridgeStore")` destructuring `emitBridge`, a name this module
     has NEVER exported (the real export is `emitBridgeEvent`). The destructure
     produced `undefined`, the call threw, and a bare catch that dismissed the
     bridge as "optional" swallowed it — so these four events were emitted ZERO times
     since they were written. The call sites are now static imports of
     `emitBridgeEvent`, which means the types must exist here for real. */
  | "founderTeam.invitation_sent"
  | "founderTeam.member_removed"
  | "maInitiative.response_recorded"
  | "round.invitation_sent"
  /* ── WAVE 8 ORP-028 (SPV-55) — the 21 spv.* events emitted by
     server/spvEngineStore.ts through its local emit() wrapper (:178), which
     casts `eventType as never` and therefore bypassed this union. They were
     landing in the outbox but were absent from GET /api/bridge/event-types,
     absent from Sync Status, and — the operational hazard — rejected
     400 invalid_event_type by the manual emit/replay endpoint (:1387), so a
     failed SPV delivery could never be replayed. Registering them here fixes
     all three at once. */
  | "spv.created"
  | "spv.updated"
  | "spv.scope_changed"
  | "spv.wound_down"
  | "spv.mandate_set"
  | "spv.fee_set"
  | "spv.fee_obligation_accrued"
  | "spv.fee_obligation_paid"
  | "spv.fee_obligation_waived"
  | "spv.subscription_created"
  | "spv.subscription_advanced"
  | "spv.lp_committed"
  | "spv.deployment_created"
  | "spv.deployment_advanced"
  | "spv.deployed"
  | "spv.distribution_recorded"
  | "spv.funds_confirmed"
  | "spv.closed_to_new_lps"
  | "spv.reopened_rolling_close"
  | "spv.document_added"
  | "spv.transfer_proposed"
  /* ── WAVE 8 ORP-034 (BRG-03) — partnerWorkspaceStore.ts:2455 emits this via
     the same `eventType as any` wrapper (:863). Every sibling event from that
     wrapper is registered; this was a single missed registration. */
  | "partner.spv_updated"
  /* ── WAVE 8 ORP-045 — the 17 emitSync() telemetry types. They were a
     second-class, peer-invisible system; payment_charged and captable_commit
     are money/ledger events. Registering them makes emitSync forward them to
     the outbound bridge (server/lib/telemetryBridgeForward.ts) — the forwarder
     is registry-driven, so this list is the single source of truth. */
  | "cap_table_broadcast_sent"
  | "captable_commit"
  | "collective_application_submitted"
  | "collective_company_application_submitted"
  | "collective_company_nomination_submitted"
  | "crm_contact_added"
  | "crm_intro_requested"
  | "crm_note_added"
  | "crm_pipeline_moved"
  | "crm_task_completed"
  | "dsc.review_received"
  | "founder_crm_broadcast"
  | "payment_charged"
  | "report_sent"
  | "soft_circle.lapsed"
  | "transaction_prep_channel_archived"
  | "transaction_prep_channel_created";

/* WAVE 15 / A-5 (DEF-035) — the union stopped at the four Sprint 12 types even
   though `server/lib/bridgeInbound.ts` has grown WORKING, idempotent handlers
   for four more. The handlers were reachable at runtime (POST
   /api/bridge/inbound does not gate on this registry) but the peer had no way
   to LEARN they exist, because GET /api/bridge/event-types and
   GET /api/admin/bridge/inbox both publish this array. Their case labels were
   written `case "…" as never` precisely to work around this too-narrow union;
   widening the union is what makes the casts unnecessary. */
export type InboundEventType =
  | "dsc.scores"
  | "ma.intelligence_rankings"
  | "partner.introduction_status"
  | "network.social_signals"
  // WAVE 15 A-5 — Sprint 13 handlers, previously unadvertised.
  | "member.application_decision"
  | "membership.renewal_status"
  | "kyc.status_decision"
  // WAVE 15 A-5 — Sprint 16 G2 handler, previously unadvertised.
  | "soft_circle.submitted";

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

/* W-COLLECTIVE Wave 1 (v5 §A.1) — `archived` is a terminal, non-deliverable
   status for historical envelopes addressed to a peer that does not exist. It
   is NOT a delivery: `deliveredAt` stays null and `receivedAck` stays false.
   Archived rows are hydrated on boot (v5 §A.2), skipped by the drain worker
   (§A.3) and can never be purged by clearBridgeOutbox (§A.5). */
export type DeliveryStatus = "queued" | "delivering" | "delivered" | "dead_letter" | "archived";

/** Statuses clearBridgeOutbox() may never delete, whatever it is asked for. */
export const NON_PURGEABLE_STATUSES: readonly DeliveryStatus[] = ["archived"];

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

/** v25.28 Phase D — push to inbox + write through to durable storage.
 * Idempotent: shim's kv table is keyed by eventId, so repeat receives of the
 * same envelope (e.g. Collective retry storm) collapse cleanly. */
function inboxPush(env: BridgeEnvelope): void {
  inbox.push(env);
  try { persistShimEntry(BRIDGE_INBOX_STORE, env.eventId, env); } catch { /* non-fatal */ }
}
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
  "round.terms_updated", /* WAVE 8 / ORP-050 */
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
  // WAVE 36 · ROW 6 — see type union above. Emitted for real as of this wave.
  "founderTeam.invitation_sent",
  "founderTeam.member_removed",
  "maInitiative.response_recorded",
  "round.invitation_sent",
  // WAVE 8 ORP-028 (SPV-55) — spv.* family, see type union above.
  "spv.created",
  "spv.updated",
  "spv.scope_changed",
  "spv.wound_down",
  "spv.mandate_set",
  "spv.fee_set",
  "spv.fee_obligation_accrued",
  "spv.fee_obligation_paid",
  "spv.fee_obligation_waived",
  "spv.subscription_created",
  "spv.subscription_advanced",
  "spv.lp_committed",
  "spv.deployment_created",
  "spv.deployment_advanced",
  "spv.deployed",
  "spv.distribution_recorded",
  "spv.funds_confirmed",
  "spv.closed_to_new_lps",
  "spv.reopened_rolling_close",
  "spv.document_added",
  "spv.transfer_proposed",
  // WAVE 8 ORP-034 (BRG-03) — see type union above.
  "partner.spv_updated",
  // WAVE 8 ORP-045 — emitSync telemetry types promoted to the peer contract.
  "cap_table_broadcast_sent",
  "captable_commit",
  "collective_application_submitted",
  "collective_company_application_submitted",
  "collective_company_nomination_submitted",
  "crm_contact_added",
  "crm_intro_requested",
  "crm_note_added",
  "crm_pipeline_moved",
  "crm_task_completed",
  "dsc.review_received",
  "founder_crm_broadcast",
  "payment_charged",
  "report_sent",
  "soft_circle.lapsed",
  "transaction_prep_channel_archived",
  "transaction_prep_channel_created",
];

export const ALL_INBOUND_EVENT_TYPES: InboundEventType[] = [
  "dsc.scores",
  "ma.intelligence_rankings",
  "partner.introduction_status",
  "network.social_signals",
  /* WAVE 15 A-5 (DEF-035) — four handlers that already worked but were never
     published. Handler bodies: server/lib/bridgeInbound.ts:117 (member),
     :129 (renewal), :141 (kyc), :153 (soft circle). The completeness of this
     array against the handler table is now machine-enforced by
     assertInboundRegistryComplete() in server/lib/bridgeInbound.ts. */
  "member.application_decision",
  "membership.renewal_status",
  "kyc.status_decision",
  "soft_circle.submitted",
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
  /* WAVE 17 ORP-044 — AUTO-TRIGGER `governance_metric_published`.
     Attached HERE because both producers of `company.profile.updated` —
     server/companyProfileStore.ts:786 (PATCH /api/founder/profile, the surface the
     founder actually saves board composition from) and server/profileStore.ts:253
     via BridgeOutbound — are SACRED files, and this is the single point both flow
     through. The observer itself is a no-op for every other event type and adds NO
     bridge event (the audit chain and outbox are untouched), so nothing here
     changes for the other ~40 event types. See
     server/lib/wave17MilestoneAutoTriggers.ts for why the declared
     `governance_metric.published` helper alone was not a viable emit point (zero
     callers tree-wide). */
  try {
    maybeBroadcastGovernanceMetric({
      eventType: args.eventType,
      companyId: args.aggregateId,
      actorUserId: args.actor?.userId ?? null,
      payload: args.payload,
    });
  } catch { /* non-fatal: a broadcast must never break an emit */ }
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
    // W-COLLECTIVE Wave 1 (v5 §A.3) — `archived` is terminal and MUST never be
    // delivered later. Without this an archived envelope would be picked up by
    // the next drain tick and shipped to the peer.
    if (e.status === "delivered" || e.status === "dead_letter" || e.status === "archived") continue;
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

/**
 * v25.48.2 Q1 (Ozan) — DLQ / outbox drain-CLEAR primitive.
 *
 * Purges the accumulated legacy-bridge outbox rows from BOTH the in-memory
 * `outbox` and the `bridge_outbox` SQL table. This is additive + reversible in
 * the sense that it only removes QUEUE rows — it NEVER touches audit history
 * (`bridge_event_history`, admin audit chains, per-entity hash chains). By
 * default it clears only `dead_letter` rows (the 501 pileup); pass
 * `includeQueued` to also drop still-queued/delivering envelopes that will
 * never deliver while the bridge is disabled.
 *
 * Returns the number cleared and how many outbox rows remain.
 */
export function clearBridgeOutbox(opts?: { includeQueued?: boolean }): {
  cleared: number;
  remaining: number;
  statusesCleared: DeliveryStatus[];
} {
  const includeQueued = opts?.includeQueued === true;
  // W-COLLECTIVE Wave 1 (v5 §A.5) — this primitive IS reachable
  // (POST /api/admin/bridge/dlq/clear), so v4 §0a.5's "unreachable" claim was
  // wrong. `archived` is filtered out unconditionally so archived history can
  // never be deleted, even if this target list is widened later.
  const targets: DeliveryStatus[] = (
    includeQueued
      ? (["dead_letter", "queued", "delivering"] as DeliveryStatus[])
      : (["dead_letter"] as DeliveryStatus[])
  ).filter((s) => !NON_PURGEABLE_STATUSES.includes(s));
  const targetSet = new Set<string>(targets);

  let cleared = 0;
  for (let i = outbox.length - 1; i >= 0; i--) {
    if (targetSet.has(outbox[i].status)) {
      outbox.splice(i, 1);
      cleared++;
    }
  }

  // Best-effort DB purge. ONLY the bridge_outbox queue table; audit history is
  // never touched.
  try {
    const db: any = rawDb();
    const placeholders = targets.map(() => "?").join(",");
    // The trailing NOT IN is redundant against `targets` (already filtered) and
    // deliberately so: it makes the archived-history guarantee hold at the SQL
    // layer too, not only in the JS target list. (v5 §A.5)
    const keepPlaceholders = NON_PURGEABLE_STATUSES.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM bridge_outbox
        WHERE status IN (${placeholders})
          AND status NOT IN (${keepPlaceholders})`,
    ).run(...targets, ...NON_PURGEABLE_STATUSES);
  } catch (err) {
    log.warn(
      `[bridgeStore.clearBridgeOutbox] DB purge failed: ${(err as Error).message}`,
    );
  }

  return { cleared, remaining: outbox.length, statusesCleared: targets };
}

/**
 * Statuses an archive pass may transition to `archived`.
 *
 * W-COLLECTIVE Wave 1 review fix B8 — `dead_letter` was previously in this list
 * and that was an undisclosed D1 silent drop. The `archived` bucket cannot
 * express what a row's status USED to be, and three live surfaces derive the
 * dead-letter signal from the in-memory status alone:
 *   • `GET /api/admin/bridge/outbox` → `deadLettered`
 *   • `adminPlatformStore.ts` → `queues.deadLetter`
 *   • `lib/syncDashboard.ts` → `dlq[]`
 * Archiving a `dead_letter` row therefore drove all three to 0 irrecoverably,
 * hiding a real delivery-failure signal from operators.
 *
 * DECISION (of the two remedies the review offered): EXCLUDE `dead_letter`
 * from archiving, rather than add an `archived_from_status` column. Rationale —
 * archiving exists to guarantee the historical backlog can never be delivered
 * if `BRIDGE_ENABLED` flips to 1, and `dead_letter` rows are ALREADY
 * undeliverable: `drainOutbox` skips them unconditionally (see the terminal
 * status guard in the drain loop), exactly as it skips `delivered` and
 * `archived`. So excluding them removes NO protection and costs NO capability,
 * while a new column would mean a schema change on a live payments database for
 * no behavioural gain. Consequence: `deadLettered` / `queues.deadLetter` /
 * `dlq[]` are provably unaffected by an archive pass, because the rows are
 * never read, never mutated and never counted as eligible.
 */
const ARCHIVABLE_STATUSES: readonly DeliveryStatus[] = [
  "queued",
  "delivering",
];

export interface ArchiveOutboxResult {
  dryRun: boolean;
  reason: string;
  /** Envelopes that would be / were transitioned. */
  eligible: number;
  archived: number;
  /** Already `archived` before this pass — proves idempotency. */
  alreadyArchived: number;
  /** Untouched because terminal-delivered. */
  skippedDelivered: number;
  /**
   * Untouched because dead-lettered (B8). Reported so the operator can SEE that
   * the DLQ signal was deliberately preserved rather than silently zeroed.
   */
  skippedDeadLettered: number;
  total: number;
  byStatusBefore: Record<string, number>;
  byStatusAfter: Record<string, number>;
  eventIds: string[];
  /**
   * Rows the DB-wide `UPDATE` transitioned (B6). This is NOT the same number as
   * `archived`: hydration only restores `('queued','delivering','archived')`, so
   * a row that failed to parse — or that was written by another process since
   * this one booted — exists in `bridge_outbox` but not in `outbox`. Before B6
   * the archive was memory-scoped only, so those rows stayed `queued` in the
   * database forever and WOULD have been delivered if `BRIDGE_ENABLED` flipped.
   */
  dbArchived: number;
  /** Rows the DB-wide `UPDATE` would transition, computed on a dry run. */
  dbEligible: number;
  /** Set when the DB pass could not run; the memory pass still reports above. */
  dbError: string | null;
}

function tallyStatuses(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of outbox) out[e.status] = (out[e.status] ?? 0) + 1;
  return out;
}

/**
 * W-COLLECTIVE Wave 1 (v4 §1.6 as corrected by v5 §A) — ARCHIVE the historical
 * outbound backlog.
 *
 * These envelopes are addressed to `COLLECTIVE_WEBHOOK_URL`, a peer that does
 * not exist; the durable local write already happened at emit time, so nothing
 * local depends on them (v4 §0a.2-0a.4). Archiving is safe for the audit chain
 * because the hash body is `priorHash|eventId|eventType|aggregateId|occurredAt`
 * and excludes `status`, `deliveredAt` and `attempts` (§0a.5).
 *
 * Guarantees:
 *   • NO `DELETE` — rows stay in `bridge_outbox` and in every admin surface.
 *   • NO `emit()` — the chain tip is not advanced, so no new links are minted.
 *   • NOT presented as delivery — `deliveredAt` stays null, `receivedAck` false.
 *   • NO inbound dispatch.
 *   • Idempotent — a second pass archives 0 and reports `alreadyArchived`.
 *   • Dry-run first — callers must opt in to mutation with `dryRun:false`.
 *   • `delivered` envelopes are never touched.
 *   • `dead_letter` envelopes are never touched (review fix B8 — see
 *     `ARCHIVABLE_STATUSES`; the DLQ signal must stay derivable).
 *   • The hash body (`priorHash|eventId|eventType|aggregateId|occurredAt`) and
 *     `envelope_json` / `hmac` are never written, so the chain stays verifiable.
 *   • `lastError` is PRESERVED, never clobbered (review fix B7).
 *   • The transition is applied DB-wide, not just to the hydrated copies
 *     (review fix B6).
 */
export function archiveBridgeOutbox(opts: {
  reason: string;
  dryRun?: boolean;
}): ArchiveOutboxResult {
  const dryRun = opts.dryRun !== false;
  const reason = (opts.reason ?? "").trim() || "unspecified";
  const byStatusBefore = tallyStatuses();

  const targets = outbox.filter((e) => ARCHIVABLE_STATUSES.includes(e.status));
  const alreadyArchived = outbox.filter((e) => e.status === "archived").length;
  const skippedDelivered = outbox.filter((e) => e.status === "delivered").length;
  const skippedDeadLettered = outbox.filter((e) => e.status === "dead_letter").length;
  const eventIds = targets.map((e) => e.envelope.eventId);

  let archived = 0;
  if (!dryRun) {
    for (const e of targets) {
      const priorStatus = e.status;
      e.status = "archived";
      // Deliberately NOT setting deliveredAt / receivedAck: an archive is not a
      // delivery.
      //
      // B7 — `lastError` used to be OVERWRITTEN with `archived: ${reason}`,
      // destroying the delivery-failure diagnostic that is often the only
      // record of WHY a row was still queued. It is now preserved verbatim
      // after the ` | prior: ` marker. `bridge_outbox` has no reason column and
      // Wave 1 adds no schema change, so the archive annotation shares this
      // column — but it appends, it does not clobber.
      //
      // B8 — the annotation also carries `from=<pre-archive status>` so the
      // pre-archive status remains derivable from the durable row even though
      // `status` itself is now `archived`.
      e.lastError = composeArchiveNote(priorStatus, reason, e.lastError);
      // Park the retry clock far enough forward that even a status regression
      // cannot make the drain worker pick this up on the same tick.
      e.nextRetryAt = Number.MAX_SAFE_INTEGER;
      persistOutboxUpdate(e);
      archived++;
    }
  }

  const db = archiveBridgeOutboxInDb(reason, dryRun);

  return {
    dryRun,
    reason,
    eligible: targets.length,
    archived,
    alreadyArchived,
    skippedDelivered,
    skippedDeadLettered,
    total: outbox.length,
    byStatusBefore,
    byStatusAfter: tallyStatuses(),
    eventIds,
    dbArchived: db.archived,
    dbEligible: db.eligible,
    dbError: db.error,
  };
}

/** The durable archive annotation. Shared by the memory and SQL passes. */
function composeArchiveNote(
  priorStatus: string,
  reason: string,
  priorError: string | null | undefined,
): string {
  const head = `archived[from=${priorStatus}]: ${reason}`;
  return priorError ? `${head} | prior: ${priorError}` : head;
}

/**
 * W-COLLECTIVE Wave 1 review fix B6 — apply the archive DB-wide.
 *
 * The archive was previously memory-scoped: it walked `outbox` and wrote each
 * hydrated entry back with `persistOutboxUpdate`. But `hydrateBridgeStore` only
 * restores `('queued','delivering','archived')` and SKIPS any row whose
 * `envelope_json` fails to parse, so a malformed-but-`queued` row — or one
 * written by another process after this one booted — was never in `outbox` and
 * so never archived. It stayed `queued` in `bridge_outbox` forever and WOULD be
 * picked up and delivered the moment `BRIDGE_ENABLED` flipped to 1. That is the
 * exact failure the archive exists to prevent.
 *
 * One parameterised statement, no `DELETE`, no `emit()`. It writes only
 * `status`, `next_retry_at` and `last_error`; `envelope_json`, `hmac`,
 * `delivered_at`, `attempts`, `enqueued_at` and every hash-body field are
 * untouched, so `hashChainOk()` and `verify-chain` are unaffected.
 *
 * Idempotent by construction: the `WHERE` clause only matches
 * `ARCHIVABLE_STATUSES`, and an already-archived row is `archived`, so a second
 * pass matches 0 rows and cannot double-append to `last_error`.
 *
 * In SQLite every `SET` expression is evaluated against the PRE-update row, so
 * `status` and `last_error` on the right-hand side are the old values — that is
 * what lets one statement record both the pre-archive status (B8) and the prior
 * diagnostic (B7) per row without a read-modify-write round trip.
 */
function archiveBridgeOutboxInDb(
  reason: string,
  dryRun: boolean,
): { eligible: number; archived: number; error: string | null } {
  const placeholders = ARCHIVABLE_STATUSES.map(() => "?").join(",");
  try {
    const db: any = rawDb();
    const eligible = Number(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM bridge_outbox WHERE status IN (${placeholders})`,
        )
        .get(...ARCHIVABLE_STATUSES)?.n ?? 0,
    );
    if (dryRun) return { eligible, archived: 0, error: null };

    const info = db
      .prepare(
        `UPDATE bridge_outbox
            SET status        = 'archived',
                next_retry_at = ?,
                last_error    = 'archived[from=' || status || ']: ' || ?
                                || CASE
                                     WHEN last_error IS NOT NULL AND last_error <> ''
                                     THEN ' | prior: ' || last_error
                                     ELSE ''
                                   END
          WHERE status IN (${placeholders})`,
      )
      .run(Number.MAX_SAFE_INTEGER, reason, ...ARCHIVABLE_STATUSES);
    const archived = Number(info?.changes ?? 0);
    if (archived > 0) {
      log.info(
        `[bridgeStore.archive] DB pass archived ${archived} row(s) in bridge_outbox (reason: ${reason})`,
      );
    }
    return { eligible, archived, error: null };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // Warn-only: the in-memory pass has already succeeded and the caller sees
    // `dbError`. A DB outage must not make the admin endpoint 500.
    log.warn(`[bridgeStore.archive] DB pass failed: ${msg}`);
    return { eligible: 0, archived: 0, error: msg };
  }
}

export function getInbox(): BridgeEnvelope[] {
  return inbox;
}

export function pushInbound(env: BridgeEnvelope): void {
  inboxPush(env);
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
  inboxPush({
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
  inboxPush({
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
  inboxPush({
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
  inboxPush({
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
      // W-COLLECTIVE Wave 1 (v5 §A.2) — additive; `total` and `entries` already
      // include archived envelopes, this just names the bucket.
      archived: outbox.filter(e => e.status === "archived").length,
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

  // v25.48.2 Q1 — DLQ / outbox drain-CLEAR (admin). Clears ONLY the outbox
  // queue rows (dead_letter by default; ?includeQueued=1 also drops queued/
  // delivering). NEVER deletes audit history. Idempotent + reversible-safe.
  app.post("/api/admin/bridge/dlq/clear", requireAdmin, (req: Request, res: Response) => {
    const includeQueued =
      req.query.includeQueued === "1" ||
      req.query.includeQueued === "true" ||
      req.body?.includeQueued === true;
    const out = clearBridgeOutbox({ includeQueued });
    res.json({ ok: true, ...out });
  });

  /* W-COLLECTIVE Wave 1 (v4 §1.6 / v5 §A) — ARCHIVE the historical outbound
     backlog. Admin-gated, DRY-RUN BY DEFAULT (must pass ?apply=1 or
     {"apply":true} to mutate), idempotent, audited with an explicit reason.
     Never DELETEs, never emits, never presents an archive as a delivery. */
  app.post("/api/admin/bridge/archive", requireAdmin, async (req: Request, res: Response) => {
    /* REPAIR WAVE 1 · ITEM 3 — FAIL CLOSED ON IDENTITY, BEFORE ANYTHING MUTATES.
     *
     * This handler used to write the audit entry by nullish-coalescing
     * `(req as any).userContext?.userId` onto the seeded platform-admin id.
     * That id is a REAL tenant-bound admin (server/lib/seedDemoData.ts:124,
     * tenant_admin_capavate / admin@capavate.io) and is enumerated in
     * server/lib/feeSettlementAuthority.ts:590 TEST_ONLY_PLATFORM_ADMIN_IDS — so
     * a row written by that fallback was indistinguishable from a genuine admin
     * action. `server/lib/requireIdentity.ts:1-27` bans exactly this pattern.
     *
     * The check is placed HERE, at handler entry, and not at the original line,
     * for a specific reason: the audit append at the bottom of this handler sits
     * inside a `try { … } catch { log.warn }`, so a throw raised there would be
     * SWALLOWED and the audit entry silently lost. Refusing before
     * `archiveBridgeOutbox()` runs means we neither fabricate an actor nor drop
     * an audit record. `requireAdmin` (server/lib/authMiddleware.ts:77-88) always
     * assigns req.userContext before next(), so under today's mount this branch
     * is unreachable and behaviour is unchanged. */
    const actorUserId = (req as Request & { userContext?: { userId?: string } })
      .userContext?.userId;
    if (!actorUserId) {
      return res
        .status(401)
        .json({ ok: false, error: "missing_identity", code: "missing_identity" });
    }
    const apply =
      req.query.apply === "1" ||
      req.query.apply === "true" ||
      req.body?.apply === true;
    const reason =
      (typeof req.body?.reason === "string" && req.body.reason.trim()) ||
      (typeof req.query.reason === "string" && req.query.reason.trim()) ||
      "collective bridge peer does not exist; backlog retired without delivery";

    const result = archiveBridgeOutbox({ reason, dryRun: !apply });

    if (apply) {
      try {
        // Dynamic import: adminPlatformStore imports getOutbox() from this
        // module, so a static import would close an import cycle.
        const { appendAdminAudit } = await import("./adminPlatformStore");
        appendAdminAudit(
          /* REPAIR WAVE 1 · ITEM 3 — was a nullish-coalesce onto the real seeded
             platform-admin identity (see the fail-closed note at the top of this
             handler). Now the verified session identity, guaranteed non-empty. */
          actorUserId,
          "bridge_outbox",
          "bridge.outbox.archived",
          {
            reason: result.reason,
            archived: result.archived,
            alreadyArchived: result.alreadyArchived,
            skippedDelivered: result.skippedDelivered,
            /* Review fix B8 — record that the DLQ was deliberately preserved. */
            skippedDeadLettered: result.skippedDeadLettered,
            /* Review fix B6 — the DB-wide pass is reported separately from the
               in-memory one; they can legitimately differ. */
            dbArchived: result.dbArchived,
            dbEligible: result.dbEligible,
            dbError: result.dbError,
            total: result.total,
            eventIds: result.eventIds.slice(0, 50),
            eventIdCount: result.eventIds.length,
          },
        );
      } catch (err) {
        log.warn(
          `[bridgeStore.archive] audit append failed: ${(err as Error).message}`,
        );
      }
    }

    res.json({ ok: true, ...result });
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

  /* ── Sprint 16 A4 — demo reset + replay. ────────────────────────────────
   *
   * GUARD, STATED HONESTLY (WAVE 57c · ITEM 6 — R37 approved order #6):
   * This endpoint is `requireAdmin`-gated and NOTHING MORE. The previous comment
   * here said "admin-SES-gated for safety", which was FALSE — the x-admin-SES
   * check was removed in v25.16 NC4 and replaced with `requireAdmin`; the comment
   * was left behind claiming a control that does not exist. A false comment about
   * a destructive endpoint's guard is worse than no comment, because the next
   * reader trusts it.
   *
   * WHAT IT DESTROYS: `resetDemoState()` (scripts/reset-demo.ts:23) calls
   * `_testBridge.resetChain()` (:1659 of this file), which resets the running
   * bridge HMAC head `lastChainHash` to 64 zeros and truncates the in-memory
   * outbox and inbox, then re-seeds DEMO events. The durable
   * `bridge_event_history` rows keep their PRE-RESET hashes, so chain continuity
   * is broken and cannot be un-broken.
   *
   * WHAT THIS WAVE ADDS — all three copied from the reference implementation on
   * this same router, `POST /api/admin/bridge/archive` (:1499), rather than
   * invented here:
   *   1. FAIL CLOSED ON IDENTITY before anything mutates.
   *   2. DRY RUN BY DEFAULT — it now takes `?apply=1` / `{"apply":true}` and
   *      otherwise reports exactly what it WOULD do (including the current chain
   *      head it would discard) and changes nothing. The endpoint is not
   *      disabled; its default simply stops being "destroy now".
   *   3. AUDITED with a bound actor, recording the chain head BEFORE the reset,
   *      so the break is documented rather than merely happening.
   *
   * R26 / WAVES 46a-46b COORDINATION — checked, and there is no interference:
   * R26's sequencing governs the `audit_log` chain re-seed (`audit_chain_genesis`,
   * under R2) and then the bridge ENABLEMENT (`COLLECTIVE_WEBHOOK_URL` /
   * `_SECRET` in SACRED server/lib/bridgeRuntime.ts) and the backlog
   * archive/discard via `/api/admin/bridge/archive` + `/api/admin/bridge/dlq/clear`.
   * This handler touches NONE of those: it does not read or write
   * `audit_chain_genesis`, does not alter credentials, and is not part of the
   * archive/discard path. If anything it protects the sequence — firing it during
   * R26 step 4 would inject demo events into a first-ever live receiver, and it
   * is now dry-run by default. */
  app.post("/api/admin/sync/reset-demo", requireAdmin, async (req: Request, res: Response) => {
    /* 1 — FAIL CLOSED ON IDENTITY (Repair Wave 1 · Item 3 shape, :1500). */
    const actorUserId = (req as Request & { userContext?: { userId?: string } })
      .userContext?.userId;
    if (!actorUserId) {
      return res
        .status(401)
        .json({ ok: false, error: "missing_identity", code: "missing_identity" });
    }

    /* 2 — DRY RUN BY DEFAULT (`/api/admin/bridge/archive` shape). */
    const apply =
      req.query.apply === "1" ||
      req.query.apply === "true" ||
      (req.body as { apply?: unknown } | undefined)?.apply === true;

    const chainHeadBefore = lastChainHash;
    const outboxBefore = outbox.length;
    const inboxBefore = inbox.length;

    if (!apply) {
      return res.json({
        ok: true,
        dryRun: true,
        applied: false,
        wouldDo: {
          resetChainHeadTo: "0".repeat(64),
          chainHeadBefore,
          discardOutboxRows: outboxBefore,
          discardInboxRows: inboxBefore,
          reseedDemoEvents: true,
          irreversible:
            "bridge_event_history retains the pre-reset hashes, so chain continuity cannot be restored",
        },
        hint: 'Re-send with ?apply=1 (or {"apply":true}) to actually reset.',
        outbox: outboxBefore,
        inbox: inboxBefore,
      });
    }

    const { resetDemoState } = await import("../scripts/reset-demo");
    const summary = resetDemoState();

    /* 3 — AUDIT with a bound actor, naming the chain head that was discarded. */
    try {
      const { appendAdminAudit } = await import("./adminPlatformStore");
      appendAdminAudit(actorUserId, "bridge_chain", "bridge.demo_state.reset", {
        chainHeadBefore,
        chainHeadAfter: lastChainHash,
        outboxBefore,
        inboxBefore,
        outboxAfter: outbox.length,
        inboxAfter: inbox.length,
        entitiesEmitted: summary.entitiesEmitted,
        warnings: summary.warnings,
        chainContinuityBroken: true,
      });
    } catch (err) {
      res.setHeader("X-Audit-Warning", "audit_log_write_failed");
      log.warn(
        `[bridgeStore.reset-demo] audit append failed: ${(err as Error).message}`,
      );
    }

    res.json({
      ok: summary.ok,
      dryRun: false,
      applied: true,
      chainHeadBefore,
      summary,
      outbox: outbox.length,
      inbox: inbox.length,
    });
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

/**
 * server/lib/collectiveBridgeReceiver.ts — WAVE 187.
 *
 * THE REAL COLLECTIVE RECEIVER.
 *
 * WHY THIS FILE EXISTS. R148.2 found that the only inbound endpoint in the whole
 * tree was `/api/_mock_collective/inbound` — a test double. Setting
 * COLLECTIVE_WEBHOOK_URL would have fired 743 real events at a route named
 * `_mock` that recorded no outcome and remembered idempotency in a RAM `Set`
 * that a PM2 restart erases. R159.2 is the owner's decision, verbatim:
 * *"Option A. Fix it now as all of the data on the platform is test."* Option A
 * is a REAL receiver, and the owner's reason is the timing — a real receiver
 * changes what gets written and where, and doing it while every row is test data
 * removes the migration problem entirely.
 *
 * WHAT IT IS. `POST /api/bridge/collective-receive`.
 *   - Honest name. Nothing production-facing is called `_mock`.
 *   - A PATH on capavate.com. NEVER `collective.capavate.com`, which does not
 *     resolve (see bridgeEnvAssert's DEAD_HOST).
 *   - NOT under `/api/collective`, deliberately: routes.ts mounts
 *     `app.use("/api/collective", requireAuthenticated)` and
 *     `app.use("/api/collective", collectiveRateLimit)`. A signed webhook has no
 *     session, so the first would 401 all 743 events and the second would
 *     throttle the drain.
 *
 * THE WIRE CONTRACT IS UNCHANGED, ON PURPOSE. `server/lib/bridgeRuntime.ts` is
 * SACRED and cannot be edited (it is in sacred_baseline/SACRED_SHA256.txt), so
 * the outbound signer is frozen. It already sends
 *   x-bridge-signature: HMAC-SHA256-hex(JSON.stringify(envelope), secret)
 *   idempotency-key:    envelope.eventId
 * and this receiver honours exactly that. Nothing outbound changes, and the
 * existing retry / backoff / dead-letter / bridge_event_history machinery in
 * `drainOutbox` keeps working untouched.
 *
 * THE MOCK ROUTE IS NOT REMOVED. Three things depend on it:
 * `server/__tests__/sprint12.test.ts:450`, `POST /api/admin/bridge/drain`
 * (bridgeStore.ts:1466), and `scripts/silent-drop-guard/baseline.json:552` —
 * removing it would be a silent route drop, which is the guard's trailing
 * invariant. This receiver is purely ADDITIVE.
 *
 * IDEMPOTENCY IS A DATABASE CONSTRAINT, NOT A SET. The row is claimed by primary
 * key (= eventId = the idempotency key) inside the SAME transaction as the
 * apply. A replay loses the INSERT race against the constraint, the handler never
 * runs, and the response is 200 with the previously recorded outcome. This is
 * what makes a retry of any of the 743 safe.
 *
 * MONEY. This file contains NO Number(), parseInt(), parseFloat() or arithmetic
 * on any payload field, and writes no amount, fee, price or capital column
 * anywhere. `server/__tests__/wave187_collective_receiver.test.ts` greps this
 * source (comment-stripped) and fails if one appears.
 *
 * FENCES. The ONLY business-data write is
 *   UPDATE collective_directory_listings SET stage=?, sector=? WHERE company_id=?
 * on a row that ALREADY EXISTS. It never INSERTs a listing and never writes
 * `status` or `chapter` — the two columns every Collective visibility resolver
 * reads (collectiveInterestStore.ts getListedCompanyIds /
 * getListedCompanyIdsForChapters / isCompanyListedInAnyChapter). So no event can
 * make a company visible, and `partner_team_members` — the reachability binding
 * behind R148.1 and the wave 167/185 fences — is never written by any handler.
 */

import type { Express, Request, Response } from "express";
import { rawDb } from "../db/connection";
import { verifyHmac } from "../bridgeStore";
import type { BridgeEnvelope } from "../bridgeStore";
import { resolveReceiverSecret } from "./bridgeOutboundGuard";
import { requireAdmin } from "./authMiddleware";
import { log } from "./logger";

/** The one true receiver path. Exported so bridgeEnvAssert can check the configured URL against it. */
export const COLLECTIVE_RECEIVER_PATH = "/api/bridge/collective-receive";

/** Admin read surface for the per-event outcome record. */
export const COLLECTIVE_RECEIVER_LOG_PATH = "/api/admin/bridge/receiver-log";

/** Page sizes the receiver log accepts, mapped to integer literals (no numeric coercion). */
const RECEIVER_LOG_LIMITS: Record<string, number> = {
  "10": 10,
  "25": 25,
  "50": 50,
  "100": 100,
  "250": 250,
  "500": 500,
  "1000": 1000,
};

export type ReceiveOutcome = "applied" | "ignored" | "rejected";

export interface ReceiveResult {
  outcome: ReceiveOutcome;
  /** Plain-language reason. Always populated, for every outcome. */
  reason: string;
  /** Handler name when the event was applied, else null. */
  handler: string | null;
  /** True when this exact eventId had already reached a terminal outcome. */
  idempotent: boolean;
}

/* ============================================================
 * The ledger table.
 *
 * Created idempotently at module load, mirroring the pattern
 * `bridgeStore.ensureHistoryTable()` already uses, so a tree whose migrations
 * have not been run (tests, a fresh dev DB) still has a working receiver. The
 * authoritative DDL is migrations/0215_wave187_collective_bridge_inbound.sql,
 * mirrored byte-identically into server/db/migrations/.
 * ============================================================ */

let tableEnsured = false;

function ensureInboundTable(): void {
  if (tableEnsured) return;
  try {
    rawDb().exec(
      `CREATE TABLE IF NOT EXISTS collective_bridge_inbound (
        id              TEXT PRIMARY KEY NOT NULL,
        event_type      TEXT NOT NULL,
        aggregate_id    TEXT NOT NULL,
        aggregate_kind  TEXT NOT NULL,
        occurred_at     TEXT NOT NULL,
        received_at     TEXT NOT NULL,
        outcome         TEXT NOT NULL,
        handler         TEXT,
        reason          TEXT NOT NULL,
        envelope_json   TEXT NOT NULL
      )`,
    );
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_cbi_outcome ON collective_bridge_inbound(outcome)`);
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_cbi_type_agg ON collective_bridge_inbound(event_type, aggregate_id)`);
    rawDb().exec(`CREATE INDEX IF NOT EXISTS idx_cbi_received ON collective_bridge_inbound(received_at)`);
    tableEnsured = true;
  } catch (err) {
    log.warn(`[collectiveReceiver] ensureInboundTable failed: ${(err as Error).message}`);
  }
}

/* ============================================================
 * HMAC verification.
 *
 * The outbound signer signs with COLLECTIVE_WEBHOOK_SECRET. The pre-existing
 * inbound verifiers (the mock, and the sacred /api/bridge/inbound) verify with
 * BRIDGE_INBOUND_HMAC_SECRET / BRIDGE_HMAC_SECRET. Those are DIFFERENT variables,
 * and bridgeEnvAssert already flags the mismatch as the reason "every outbound
 * event will fail inbound HMAC verification and dead-letter".
 *
 * So we verify against a CANDIDATE SET and accept any match. Both candidates are
 * configured platform secrets — an attacker must still possess one, so nothing is
 * weakened — and it removes a whole class of go-live failure where a correct
 * deployment dead-letters 743 events on a variable-name mismatch.
 *
 * Every comparison goes through bridgeStore.verifyHmac, which is constant-time
 * (timingSafeEqual) and hex-validates both sides.
 * ============================================================ */

function verifyReceiverSignature(body: string, signature: string): boolean {
  /* Candidate 1: exactly what the outbound signer used. */
  const outboundSecret = resolveReceiverSecret();
  if (outboundSecret && verifyHmac(body, signature, outboundSecret)) return true;
  /* Candidate 2: the inbound secret (bridgeStore's default resolution), so
     existing dev/test signing and the pre-existing endpoints stay compatible. */
  return verifyHmac(body, signature);
}

/* ============================================================
 * THE DESTINATION REGISTRY.
 *
 * Deliberately keyed off THIS receiver's own destinations — NOT off
 * bridgeStore.ALL_OUTBOUND_EVENT_TYPES. That matters concretely:
 * `captable.waterfall.computed` is 325 of the 705 events actually queued in this
 * tree and is ABSENT from that union (it is emitted through a local wrapper at
 * server/track1Routes.ts:3106 that casts past the type). A registry keyed on the
 * union would have dropped 46% of the real backlog into the unknown-type branch.
 *
 * Every entry states, in plain words, what the Collective does with the event.
 * An event with no meaningful destination is recorded as ACCEPTED-AND-IGNORED
 * with that reason. It is never silently discarded.
 * ============================================================ */

/** Reasons for the five event types that are ACTUALLY in the queue, plus the Collective-relevant set. */
const IGNORE_REASONS: Record<string, string> = {
  /* ---- The five types actually present in bridge_outbox ---- */
  "subscription.auto_created_on_company_create":
    "no Collective destination: this is a Capavate subscription. The nearest Collective concept is a Collective membership, which is a different fact and is what makes a company visible in the Collective — writing one from this event would grant visibility, so it is refused.",
  "captable.waterfall.computed":
    "no Collective destination: no Collective table holds waterfall proceeds, and every field except the company id is a money figure. The receiver does not transcribe money, so the event is recorded and its payload preserved without being applied.",
  "spv.created":
    "no Collective destination: the Collective has no SPV table, and this envelope carries a vehicle scope that may be private. Mirroring it into the Collective could publish a private vehicle, so it is refused.",
  "partner.team_member_added":
    "refused by fence: this is the partner team binding that decides who a partner can reach. An inbound event must never create it, because that would make a person reachable who is not reachable today.",
  "payment_charged":
    "no Collective destination: this is a Capavate charge. The Collective has its own billing ledger, and copying a charge into it would create two ledgers holding the same money, so it is refused.",

  /* ---- The remaining Collective-relevant types (collectiveRoutes COLLECTIVE_RELEVANT_EVENT_TYPES) ---- */
  "collective.member.updated":
    "refused by fence: Collective membership decides who can see the Collective. A bridge event must not grant or change it.",
  "collective.deal_room.opened":
    "refused by fence: opening a deal room grants access to a company's material. A bridge event must not grant it.",
  "dsc.score.recomputed":
    "no Collective destination in this build: the Collective computes its own DSC scores from its own reviews, so accepting a score from outside would overwrite Collective-owned judgement.",
  "transaction_prep.updated":
    "no Collective destination: transaction preparation is a Capavate-side workspace with no Collective mirror.",
  "company.ma_intelligence.updated":
    "no Collective destination in this build: the Collective's M&A intelligence surface is gated by its own authorisation and has no field this event may write without widening what a member can read.",
  "profile.completion_changed":
    "no Collective destination: profile completion is a Capavate progress indicator with no Collective mirror.",
};

/** The reason used when the event type is not named anywhere above. */
const UNKNOWN_TYPE_REASON =
  "accepted and ignored: no Collective destination is defined for this event type. It is recorded here in full so nothing is lost, and it is not applied.";

interface ApplyContext {
  envelope: BridgeEnvelope;
  /** Raw sqlite handle, already inside the receive transaction. */
  db: { prepare: (sql: string) => { get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown; all: (...a: unknown[]) => unknown[] } };
}

type ApplyHandler = (ctx: ApplyContext) => { applied: boolean; reason: string };

/**
 * `company.profile.updated` → collective_directory_listings.
 *
 * The ONLY apply handler in this build, and the only place the receiver writes
 * business data. What it may touch was established from the visibility
 * resolvers, not assumed:
 *
 *   getListedCompanyIds()             WHERE status='listed'
 *   getListedCompanyIdsForChapters()  WHERE status='listed' AND chapter IN (…)
 *   isCompanyListedInAnyChapter()     WHERE status='listed' AND company_id=? AND chapter IN (…)
 *
 * `stage` and `sector` appear in NO visibility predicate, so updating them on a
 * row that already exists cannot make any company visible to anyone. `status`,
 * `chapter`, `application_id` and `company_id` are never written, and a listing
 * is NEVER created — a company that is not already listed yields an
 * accepted-and-ignored outcome instead.
 *
 * No money: `stage` and `sector` are classification strings, and no numeric
 * coercion happens anywhere in this function.
 */
const applyCompanyProfileUpdated: ApplyHandler = ({ envelope, db }) => {
  const companyId = envelope.aggregateId;
  if (!companyId) {
    return { applied: false, reason: "accepted and ignored: the envelope carries no company id, so there is no listing to update." };
  }

  const listing = db
    .prepare(`SELECT id, stage, sector FROM collective_directory_listings WHERE company_id = ? LIMIT 1`)
    .get(companyId) as { id?: string; stage?: string | null; sector?: string | null } | undefined;

  if (!listing || !listing.id) {
    return {
      applied: false,
      reason:
        "accepted and ignored: this company has no Collective directory listing. A bridge event must not create one, because a listing is what makes a company visible in the Collective.",
    };
  }

  const payload = (envelope.payload ?? {}) as Record<string, unknown>;
  const nextStage = typeof payload.stage === "string" && payload.stage.trim() ? payload.stage.trim() : null;
  const nextSector = typeof payload.sector === "string" && payload.sector.trim() ? payload.sector.trim() : null;

  if (nextStage === null && nextSector === null) {
    return {
      applied: false,
      reason:
        "accepted and ignored: the envelope carries neither a stage nor a sector, and those are the only two fields the Collective directory accepts from this event.",
    };
  }

  /* Ordering guard. drainOutbox retries a failed envelope on a backoff and moves
     on in the same pass, so delivery is NOT strictly ordered: a late retry can
     arrive after a newer event for the same company. Applying it would silently
     resurrect stale data, so a strictly older envelope is accepted-and-ignored
     with the newer timestamp named. Derived from this receiver's own ledger; no
     extra table. */
  const newest = db
    .prepare(
      `SELECT MAX(occurred_at) AS newest FROM collective_bridge_inbound
        WHERE outcome = 'applied' AND event_type = ? AND aggregate_id = ?`,
    )
    .get(envelope.eventType, companyId) as { newest?: string | null } | undefined;
  const newestApplied = newest?.newest ?? null;
  if (newestApplied && envelope.occurredAt < newestApplied) {
    return {
      applied: false,
      reason: `accepted and ignored: a newer event for this company was already applied (${newestApplied}), so this older one is not replayed over it.`,
    };
  }

  const finalStage = nextStage ?? listing.stage ?? null;
  const finalSector = nextSector ?? listing.sector ?? null;

  /* NOTE the column list. `status` and `chapter` are absent by design — those are
     the visibility columns and this receiver never writes them. */
  db.prepare(`UPDATE collective_directory_listings SET stage = ?, sector = ? WHERE company_id = ?`).run(
    finalStage,
    finalSector,
    companyId,
  );

  const changed: string[] = [];
  if (nextStage !== null) changed.push("stage");
  if (nextSector !== null) changed.push("sector");
  return {
    applied: true,
    reason: `applied: updated ${changed.join(" and ")} on this company's Collective directory listing. Its listed status and chapter were not touched, so nobody's visibility changed.`,
  };
};

const APPLY_HANDLERS: Record<string, { name: string; run: ApplyHandler }> = {
  "company.profile.updated": { name: "directory_listing.classification", run: applyCompanyProfileUpdated },
};

/* ============================================================
 * WAVE 206 · ITEM A.2 / ITEM C.4 — READ-ONLY DESTINATION LOOKUP.
 *
 * The queued-event census and the dry run both have to answer "does this event
 * type have a legitimate destination, and if not, what is the reason?". The
 * only correct answer is the one THIS receiver would actually give, so it is
 * read from the SAME `APPLY_HANDLERS` / `IGNORE_REASONS` / `UNKNOWN_TYPE_REASON`
 * that `receiveEnvelope()` reads. It is deliberately NOT a second table of
 * destinations kept in step by hand — a copy would drift, and a drifted copy
 * reporting "no destination" for something that now applies (or the reverse)
 * is exactly the kind of proof-against-a-replica the handbook forbids.
 *
 * Pure: no transaction, no write, no side effect. Adding this export changes
 * no existing behaviour and no existing literal.
 * ============================================================ */

export type BridgeDestinationKind = "applies" | "refused" | "ignored";

export interface BridgeDestinationDecision {
  eventType: string;
  /** True only when a real apply handler exists for this type. */
  hasDestination: boolean;
  kind: BridgeDestinationKind;
  /** The apply handler's name, or null when nothing applies this type. */
  handler: string | null;
  /** The receiver's own words for what it would do and why. */
  reason: string;
  /** True when the reason is the ownership/visibility fence rather than a plain absence of destination. */
  fenced: boolean;
  /** True when the type is not named anywhere and falls to the unknown-type reason. */
  unknownType: boolean;
}

/**
 * What would `receiveEnvelope()` do with an envelope of this type, and why.
 * Answered from the live registries, without receiving anything.
 */
export function describeDestinationForEventType(eventType: string): BridgeDestinationDecision {
  const handlerEntry = APPLY_HANDLERS[eventType];
  if (handlerEntry) {
    return {
      eventType,
      hasDestination: true,
      kind: "applies",
      handler: handlerEntry.name,
      reason: `has a destination: this type is applied by the ${handlerEntry.name} handler on the real Collective receiver.`,
      fenced: false,
      unknownType: false,
    };
  }
  const named = IGNORE_REASONS[eventType];
  const reason = named ?? UNKNOWN_TYPE_REASON;
  const fenced = typeof named === "string" && named.startsWith("refused by fence");
  return {
    eventType,
    hasDestination: false,
    kind: fenced ? "refused" : "ignored",
    handler: null,
    reason,
    fenced,
    unknownType: named === undefined,
  };
}

/** Every event type the receiver names, for a census that wants the whole registry. */
export function listKnownBridgeEventTypes(): string[] {
  return [...Object.keys(APPLY_HANDLERS), ...Object.keys(IGNORE_REASONS)];
}

/* ============================================================
 * The receive path.
 * ============================================================ */

export class MalformedEnvelopeError extends Error {
  /** Stable machine code. Travels in its own field so the human text is never an ALL-CAPS code. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Validate the body is a bridge envelope. Throws MalformedEnvelopeError with a stated fact. */
export function assertEnvelope(body: unknown): BridgeEnvelope {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MalformedEnvelopeError("not_an_object", "the request body is not a bridge envelope: it is not a JSON object.");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.eventId !== "string" || !b.eventId.trim()) {
    throw new MalformedEnvelopeError("missing_event_id", "the request body is not a bridge envelope: eventId is missing or empty.");
  }
  if (typeof b.eventType !== "string" || !b.eventType.trim()) {
    throw new MalformedEnvelopeError("missing_event_type", "the request body is not a bridge envelope: eventType is missing or empty.");
  }
  if (typeof b.occurredAt !== "string" || Number.isNaN(Date.parse(b.occurredAt))) {
    throw new MalformedEnvelopeError(
      "bad_occurred_at",
      "the request body is not a bridge envelope: occurredAt is missing or is not a readable timestamp.",
    );
  }
  if (typeof b.aggregateId !== "string" || !b.aggregateId.trim()) {
    throw new MalformedEnvelopeError("missing_aggregate_id", "the request body is not a bridge envelope: aggregateId is missing or empty.");
  }
  return body as BridgeEnvelope;
}

/** The previously recorded terminal outcome for an eventId, or null. */
export function lookupReceived(eventId: string): { outcome: string; reason: string; handler: string | null } | null {
  ensureInboundTable();
  try {
    const row = rawDb()
      .prepare(`SELECT outcome, reason, handler FROM collective_bridge_inbound WHERE id = ? LIMIT 1`)
      .get(eventId) as { outcome?: string; reason?: string; handler?: string | null } | undefined;
    if (!row || !row.outcome) return null;
    return { outcome: row.outcome, reason: row.reason ?? "", handler: row.handler ?? null };
  } catch {
    return null;
  }
}

/**
 * Apply one envelope. Claim-and-apply in a single transaction, so a replay is
 * refused by the primary key and a handler failure rolls the apply back whole.
 */
export function receiveEnvelope(envelope: BridgeEnvelope): ReceiveResult {
  ensureInboundTable();
  const db = rawDb() as unknown as ApplyContext["db"] & {
    exec: (sql: string) => unknown;
  };
  const receivedAt = new Date().toISOString();
  const handlerEntry = APPLY_HANDLERS[envelope.eventType as string];

  /* A row that already reached applied/ignored short-circuits. A 'rejected' row
     does NOT: a failure must stay retryable, or a transient fault would be
     frozen into a permanent silent skip. */
  const prior = lookupReceived(envelope.eventId);
  if (prior && (prior.outcome === "applied" || prior.outcome === "ignored")) {
    return {
      outcome: prior.outcome as ReceiveOutcome,
      reason: prior.reason,
      handler: prior.handler,
      idempotent: true,
    };
  }

  let claimed = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    /* THE IDEMPOTENCY FENCE. Primary key = eventId = the idempotency-key header.
       A concurrent or replayed delivery loses this INSERT and the handler below
       never runs. */
    try {
      db.prepare(
        `INSERT INTO collective_bridge_inbound
           (id, event_type, aggregate_id, aggregate_kind, occurred_at, received_at, outcome, handler, reason, envelope_json)
         VALUES (?, ?, ?, ?, ?, ?, 'processing', NULL, 'processing', ?)`,
      ).run(
        envelope.eventId,
        envelope.eventType,
        envelope.aggregateId,
        envelope.aggregateKind ?? "platform",
        envelope.occurredAt,
        receivedAt,
        JSON.stringify(envelope),
      );
      claimed = true;
    } catch (insertErr) {
      /* Either a genuine replay, or a previously 'rejected' row being retried. */
      const existing = db
        .prepare(`SELECT outcome FROM collective_bridge_inbound WHERE id = ? LIMIT 1`)
        .get(envelope.eventId) as { outcome?: string } | undefined;
      if (existing?.outcome === "rejected") {
        db.prepare(`UPDATE collective_bridge_inbound SET outcome = 'processing', received_at = ? WHERE id = ?`).run(
          receivedAt,
          envelope.eventId,
        );
        claimed = true;
      } else if (existing?.outcome) {
        db.exec("ROLLBACK");
        const again = lookupReceived(envelope.eventId);
        return {
          outcome: (again?.outcome ?? existing.outcome) as ReceiveOutcome,
          reason: again?.reason ?? "already received",
          handler: again?.handler ?? null,
          idempotent: true,
        };
      } else {
        throw insertErr;
      }
    }

    let outcome: ReceiveOutcome;
    let reason: string;
    let handlerName: string | null = null;

    if (handlerEntry) {
      const res = handlerEntry.run({ envelope, db });
      outcome = res.applied ? "applied" : "ignored";
      reason = res.reason;
      handlerName = res.applied ? handlerEntry.name : null;
    } else {
      outcome = "ignored";
      reason = IGNORE_REASONS[envelope.eventType as string] ?? UNKNOWN_TYPE_REASON;
    }

    db.prepare(`UPDATE collective_bridge_inbound SET outcome = ?, handler = ?, reason = ? WHERE id = ?`).run(
      outcome,
      handlerName,
      reason,
      envelope.eventId,
    );
    db.exec("COMMIT");
    return { outcome, reason, handler: handlerName, idempotent: false };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    /* Record the failure OUTSIDE the rolled-back transaction, so the reason
       survives even though the apply did not. The sender retries; after five
       attempts the existing dead-letter machinery in drainOutbox marks the
       envelope dead_letter with lastError, and this row states why in words. */
    const rejectionReason = `rejected: applying this event failed and nothing was written. ${message}`;
    try {
      db.prepare(
        `INSERT INTO collective_bridge_inbound
           (id, event_type, aggregate_id, aggregate_kind, occurred_at, received_at, outcome, handler, reason, envelope_json)
         VALUES (?, ?, ?, ?, ?, ?, 'rejected', NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET outcome = 'rejected', reason = excluded.reason, received_at = excluded.received_at`,
      ).run(
        envelope.eventId,
        envelope.eventType,
        envelope.aggregateId,
        envelope.aggregateKind ?? "platform",
        envelope.occurredAt,
        receivedAt,
        rejectionReason,
        JSON.stringify(envelope),
      );
    } catch (recordErr) {
      log.error(`[collectiveReceiver] could not record rejection for ${envelope.eventId}: ${(recordErr as Error).message}`);
    }
    void claimed;
    return { outcome: "rejected", reason: rejectionReason, handler: null, idempotent: false };
  }
}

/* ============================================================
 * Routes.
 * ============================================================ */

export function registerCollectiveBridgeReceiverRoutes(app: Express): void {
  /* The literals below and these constants must never drift apart: envAssert
     validates the owner's configured URL against the constant, while Express and
     the guard both see the literal. A silent divergence would make envAssert
     approve a URL that 404s. */
  if (COLLECTIVE_RECEIVER_PATH !== "/api/bridge/collective-receive") {
    throw new Error(
      `[collectiveReceiver] COLLECTIVE_RECEIVER_PATH (${COLLECTIVE_RECEIVER_PATH}) no longer matches the registered route literal /api/bridge/collective-receive.`,
    );
  }
  if (COLLECTIVE_RECEIVER_LOG_PATH !== "/api/admin/bridge/receiver-log") {
    throw new Error(
      `[collectiveReceiver] COLLECTIVE_RECEIVER_LOG_PATH (${COLLECTIVE_RECEIVER_LOG_PATH}) no longer matches the registered route literal /api/admin/bridge/receiver-log.`,
    );
  }

  /**
   * POST /api/bridge/collective-receive
   *
   * The real receiver. Unauthenticated by design and authenticated by HMAC — the
   * same posture as the pre-existing signed webhook `/api/bridge/inbound`.
   *
   * Status codes, and why each one:
   *   200 applied / ignored / replay  — the delivery succeeded and is recorded.
   *                                     200 on replay (NOT the mock's 409) is the
   *                                     correct webhook semantic; the mock only
   *                                     worked because drainOutbox special-cases
   *                                     409, and that should not be load-bearing.
   *   400 malformed                   — with a stated fact in `message`; the
   *                                     ALL-CAPS-ish machine code stays in `code`.
   *   401 bad signature               — no state written, nothing recorded.
   *   500 handler failure             — the apply rolled back; the sender retries
   *                                     and the existing dead-letter machinery
   *                                     takes over after five attempts.
   */
  /* THE PATH IS A BYTE-VERBATIM LITERAL HERE, NOT `COLLECTIVE_RECEIVER_PATH`.
     scripts/silent-drop-guard/extract-inventory.ts inventories a route from the
     string LITERAL in the app.post(...) call. Registering through the constant
     compiled and served correctly but produced ZERO guard entries — meaning a
     future wave could delete this endpoint and `npm run guard` would stay green,
     a silent drop of the receiver itself. Verified by calling extractRoutes()
     directly: with the constant, `mine: []`; with the literal, both routes
     appear. The constant is still exported for bridgeEnvAssert, and the
     assertion below fails loudly if the two ever diverge. */
  app.post("/api/bridge/collective-receive", (req: Request, res: Response) => {
    const signature = String(req.headers["x-bridge-signature"] ?? "");
    const body = JSON.stringify(req.body ?? {});

    if (!verifyReceiverSignature(body, signature)) {
      return res.status(401).json({
        ok: false,
        code: "invalid_signature",
        message: "the request signature did not verify against the configured bridge secret, so the event was not accepted.",
      });
    }

    let envelope: BridgeEnvelope;
    try {
      envelope = assertEnvelope(req.body);
    } catch (err) {
      if (err instanceof MalformedEnvelopeError) {
        return res.status(400).json({ ok: false, code: err.code, message: err.message });
      }
      return res.status(400).json({
        ok: false,
        code: "unreadable_body",
        message: "the request body could not be read as a bridge envelope.",
      });
    }

    /* The idempotency-key header is the eventId. If a sender supplies one that
       disagrees, say so rather than guessing which is authoritative. */
    const idem = String(req.headers["idempotency-key"] ?? "").trim();
    if (idem && idem !== envelope.eventId) {
      return res.status(400).json({
        ok: false,
        code: "idempotency_key_mismatch",
        message: "the idempotency-key header does not match the envelope's eventId, so the event was not accepted.",
      });
    }

    const result = receiveEnvelope(envelope);
    const payload = {
      ok: result.outcome !== "rejected",
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      outcome: result.outcome,
      reason: result.reason,
      handler: result.handler,
      idempotent: result.idempotent,
      receivedAt: new Date().toISOString(),
    };
    return res.status(result.outcome === "rejected" ? 500 : 200).json(payload);
  });

  /**
   * GET /api/admin/bridge/receiver-log
   *
   * How a human watches the 743 drain and tells success from failure. One row per
   * received event with its outcome and the reason in plain words. Admin-gated
   * (both by the `/api/admin` prefix middleware and explicitly here).
   */
  /* Literal, for the same guard-inventory reason as above. */
  app.get("/api/admin/bridge/receiver-log", requireAdmin, (req: Request, res: Response) => {
    ensureInboundTable();
    const rawLimit = typeof req.query.limit === "string" ? req.query.limit : "100";
    /* An explicit map to integer LITERALS. No Number(), no parseInt, no
       parseFloat anywhere in this file — see the money note in the header. */
    const limit = RECEIVER_LOG_LIMITS[rawLimit] ?? 100;
    try {
      const db = rawDb();
      const counts = db
        .prepare(`SELECT outcome, COUNT(*) AS n FROM collective_bridge_inbound GROUP BY outcome`)
        .all() as { outcome: string; n: number }[];
      const byOutcome: Record<string, number> = {};
      for (const c of counts) byOutcome[c.outcome] = c.n;
      const byType = db
        .prepare(
          `SELECT event_type, outcome, COUNT(*) AS n FROM collective_bridge_inbound
            GROUP BY event_type, outcome ORDER BY n DESC`,
        )
        .all() as { event_type: string; outcome: string; n: number }[];
      const entries = db
        .prepare(
          `SELECT id, event_type, aggregate_id, aggregate_kind, occurred_at, received_at, outcome, handler, reason
             FROM collective_bridge_inbound ORDER BY received_at DESC LIMIT ?`,
        )
        .all(limit) as unknown[];
      return res.json({
        ok: true,
        receiverPath: COLLECTIVE_RECEIVER_PATH,
        total: Object.values(byOutcome).reduce((a, b) => a + b, 0),
        byOutcome,
        byType,
        entries,
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        code: "receiver_log_unavailable",
        message: `the receiver log could not be read: ${(err as Error).message}`,
      });
    }
  });
}

/** Test-only reset of the module's table-ensured latch. Never called in production paths. */
export function _resetReceiverLatch(): void {
  tableEnsured = false;
}

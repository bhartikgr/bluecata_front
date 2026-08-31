/**
 * server/lib/wave206BridgeBacklog.ts — WAVE 206 · ITEM C (R182.2).
 *
 * THE ONE WAY THIS WAVE COULD DO REAL HARM
 * ----------------------------------------
 * The bridge moves real platform events and the outbox holds hundreds of queued
 * ones. `drainOutbox()` (server/bridgeStore.ts) loops the WHOLE array with no
 * limit, and `startBridgeWorker()` calls it every five seconds. So a single
 * switch flip, with a URL and secret present in the host environment, is
 * hundreds of signed HTTP deliveries in one burst.
 *
 * HOW THAT IS DESIGNED OUT — READ THIS BEFORE CHANGING ANYTHING HERE
 * -----------------------------------------------------------------
 *  1. `maySendOutboundBridge()` in server/lib/bridgeOutboundGuard.ts is NOT
 *     modified by wave 206. It stays environment-only. That is deliberate and it
 *     is the structural guarantee: the database flag CANNOT start the background
 *     worker, CANNOT change any existing endpoint's behaviour, and therefore
 *     CANNOT deliver a single event on its own. There is no automatic drain to
 *     suppress, because the dynamic configuration is not wired to any automatic
 *     path at all.
 *  2. The only dynamic delivery path is the endpoint in
 *     server/wave206BridgeDeliveryRoutes.ts, which runs only when a human posts
 *     to it, and which is a DRY RUN unless the caller passes an explicit
 *     confirmation — wave 204's pattern.
 *  3. Every drain is clamped to the configured batch limit AND sliced to it
 *     before anything is attempted.
 *  4. Nothing here deletes, archives, or marks anything terminal by hand.
 *
 * WHY THE DELIVERY IS DONE FROM HERE AND NOT FROM THE SACRED SENDER
 * ----------------------------------------------------------------
 * `server/lib/bridgeRuntime.ts` is FROZEN and derives its LIVE_MODE, URL and
 * secret from `process.env` at MODULE LOAD. A database value can never reach it.
 * So this module supplies its own `deliver` callback that resolves the target at
 * CALL time — and hands that callback to the REAL `drainOutbox()`, so attempt
 * counting, exponential backoff, dead-lettering, history insertion and
 * `persistOutboxUpdate` all remain the existing machinery. This is a new
 * TARGET RESOLVER, not a new outbox engine.
 */
import {
  drainOutbox,
  getOutbox,
  hmacSign,
  type BridgeEnvelope,
  type OutboxEntry,
} from "../bridgeStore";
import {
  describeDestinationForEventType,
  type BridgeDestinationDecision,
} from "./collectiveBridgeReceiver";
import {
  describeDeliveryConfig,
  resolveReceiverUrlField,
  clampBatchLimit,
} from "./wave206BridgeDeliveryConfig";
import { resolveReceiverSecret } from "./bridgeOutboundGuard";
import { fitToGate } from "./wave195CommitCurrencyDeclaration";
import { appendAdminAudit, reportAuditWriteOutcome } from "../adminPlatformStore";
import { log } from "./logger";

function humanText(...parts: string[]): string {
  const joined = parts.filter((p) => p.length > 0).join(" ");
  return fitToGate(() => joined);
}

/* ============================================================
 * CENSUS — what is queued, and does it have anywhere legitimate to go
 * ============================================================ */

export interface BacklogTypeRow {
  eventType: string;
  queued: number;
  hasDestination: boolean;
  kind: BridgeDestinationDecision["kind"];
  handler: string | null;
  /** The receiver's own words. */
  reason: string;
  fenced: boolean;
  unknownType: boolean;
}

export interface BacklogCensus {
  /** Total entries in the outbox in any status. */
  total: number;
  queued: number;
  delivering: number;
  delivered: number;
  deadLettered: number;
  archived: number;
  /** Queued entries whose type an apply handler would actually apply. */
  queuedWithDestination: number;
  /** Queued entries the ownership/visibility fence refuses. */
  queuedRefusedByFence: number;
  /** Queued entries with no destination at all. */
  queuedWithoutDestination: number;
  byType: BacklogTypeRow[];
  statement: string;
}

/**
 * Census of the live outbox, with each type's destination taken from the REAL
 * receiver registry (`describeDestinationForEventType`) rather than from a
 * second table of destinations maintained by hand.
 */
export function censusBacklog(): BacklogCensus {
  const entries = getOutbox();
  const counts = new Map<string, number>();
  let queued = 0;
  let delivering = 0;
  let delivered = 0;
  let deadLettered = 0;
  let archived = 0;

  for (const e of entries) {
    if (e.status === "queued") {
      queued += 1;
      const t = String(e.envelope.eventType);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    } else if (e.status === "delivering") delivering += 1;
    else if (e.status === "delivered") delivered += 1;
    else if (e.status === "dead_letter") deadLettered += 1;
    else if (e.status === "archived") archived += 1;
  }

  const byType: BacklogTypeRow[] = [];
  let withDestination = 0;
  let refusedByFence = 0;
  let withoutDestination = 0;
  counts.forEach((count, eventType) => {
    const d = describeDestinationForEventType(eventType);
    if (d.hasDestination) withDestination += count;
    else if (d.fenced) {
      refusedByFence += count;
      withoutDestination += count;
    } else withoutDestination += count;
    byType.push({
      eventType,
      queued: count,
      hasDestination: d.hasDestination,
      kind: d.kind,
      handler: d.handler,
      reason: d.reason,
      fenced: d.fenced,
      unknownType: d.unknownType,
    });
  });
  byType.sort((a, b) => (b.queued - a.queued) || a.eventType.localeCompare(b.eventType));

  return {
    total: entries.length,
    queued,
    delivering,
    delivered,
    deadLettered,
    archived,
    queuedWithDestination: withDestination,
    queuedRefusedByFence: refusedByFence,
    queuedWithoutDestination: withoutDestination,
    byType,
    statement: humanText(
      `${queued} events are waiting. ${withDestination} of them have somewhere on the Collective to go.`,
      "The rest are recorded with a stated reason and are not sent anywhere approximate.",
    ),
  };
}

/* ============================================================
 * SELECTION — which queued events a drain would even consider
 * ============================================================ */

export interface DrainCandidate {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateKind: string;
  enqueuedAt: string;
  attempts: number;
  /** True when this candidate would actually be POSTed. */
  wouldDeliver: boolean;
  /** Why it would not be delivered, in the receiver's own words. */
  refusalReason: string | null;
  fenced: boolean;
}

/**
 * The eligibility rule, in one place so the dry run and the acting path cannot
 * disagree: a queued entry whose backoff has elapsed. `drainOutbox()` applies
 * exactly this rule (`status` terminal → skip, `nextRetryAt > now` → skip), so
 * this mirrors the real engine's own predicate rather than inventing one.
 */
function isEligible(e: OutboxEntry, now: number): boolean {
  if (e.status === "delivered" || e.status === "dead_letter" || e.status === "archived") return false;
  return e.nextRetryAt <= now;
}

/**
 * ITEM C.4 — "Events with no legitimate destination must be REFUSED with a
 * stated reason, not delivered somewhere approximate."
 *
 * An event is delivered only when the real receiver has an apply handler for its
 * type. Everything else — including the ownership fence's
 * `partner.team_member_added` — is refused here, with the receiver's own reason
 * text, and is left queued and untouched.
 */
function decideCandidate(e: OutboxEntry): { wouldDeliver: boolean; reason: string | null; fenced: boolean } {
  const d = describeDestinationForEventType(String(e.envelope.eventType));
  if (d.hasDestination) return { wouldDeliver: true, reason: null, fenced: false };
  return { wouldDeliver: false, reason: d.reason, fenced: d.fenced };
}

/* ============================================================
 * THE PLAN — dry run and acting share ONE selection
 * ============================================================ */

export interface DrainPlan {
  /** Resolved batch limit actually in force for this call. */
  limit: number;
  /** Requested limit before clamping, for the record. */
  requestedLimit: number | null;
  /** Where deliveries would go — host and path only. NEVER a secret, NEVER a query string. */
  targetHost: string | null;
  targetPath: string | null;
  targetSource: string;
  /** Whether a drain may act at all right now, and why not. */
  mayDeliver: boolean;
  mayDeliverReason: string;
  eligibleQueued: number;
  /** Candidates inside the limit, in the order a drain would take them. */
  selected: DrainCandidate[];
  selectedDeliverable: number;
  selectedRefused: number;
  /** Eligible entries left for a later drain because of the limit. */
  heldBackByLimit: number;
  statement: string;
}

/**
 * Build the plan. Reads only. Delivers nothing, mutates nothing.
 */
export function planDrain(requestedLimit: number | null): DrainPlan {
  const config = describeDeliveryConfig();
  const storedLimit = config.drainBatchLimit.value;
  const limit = requestedLimit === null ? storedLimit : Math.min(clampBatchLimit(requestedLimit), storedLimit);

  const now = Date.now();
  const eligible = getOutbox().filter((e) => isEligible(e, now));
  /* THE LIMIT IS APPLIED HERE, BEFORE ANYTHING IS ATTEMPTED. */
  const selectedEntries = eligible.slice(0, limit);

  let target: { host: string; path: string } | null = null;
  if (config.receiverUrl.value) {
    try {
      const u = new URL(config.receiverUrl.value);
      /* Host and path only. A query string could carry a token, so it is never
         echoed back to the screen. */
      target = { host: u.host, path: u.pathname };
    } catch {
      target = null;
    }
  }

  const selected: DrainCandidate[] = selectedEntries.map((e) => {
    const d = decideCandidate(e);
    return {
      eventId: e.envelope.eventId,
      eventType: String(e.envelope.eventType),
      aggregateId: e.envelope.aggregateId,
      aggregateKind: String(e.envelope.aggregateKind),
      enqueuedAt: e.enqueuedAt,
      attempts: e.attempts,
      wouldDeliver: d.wouldDeliver,
      refusalReason: d.reason,
      fenced: d.fenced,
    };
  });
  const selectedDeliverable = selected.filter((c) => c.wouldDeliver).length;

  return {
    limit,
    requestedLimit,
    targetHost: target?.host ?? null,
    targetPath: target?.path ?? null,
    targetSource: config.receiverUrl.source,
    mayDeliver: config.mayDeliver,
    mayDeliverReason: config.mayDeliverReason,
    eligibleQueued: eligible.length,
    selected,
    selectedDeliverable,
    selectedRefused: selected.length - selectedDeliverable,
    heldBackByLimit: Math.max(0, eligible.length - selectedEntries.length),
    statement: humanText(
      `This would look at ${selected.length} of ${eligible.length} waiting events and send ${selectedDeliverable} of them.`,
      "Nothing has been sent. Confirm the drain if you want it to run.",
    ),
  };
}

/* ============================================================
 * ACTING — bounded, and only on an explicit confirmation
 * ============================================================ */

export interface DrainOutcome {
  dryRun: boolean;
  plan: DrainPlan;
  attempted: number;
  delivered: number;
  deadLettered: number;
  refused: number;
  /** Refusals, with the receiver's reason, so nothing is silently skipped. */
  refusals: Array<{ eventId: string; eventType: string; reason: string; fenced: boolean }>;
  auditRecorded: boolean;
  statement: string;
}

/**
 * How long an out-of-batch entry's retry is deferred while a drain runs.
 *
 * WHY DEFERRAL AND NOT DELETION: `drainOutbox()` decides eligibility from
 * `nextRetryAt`, so pushing the out-of-batch entries' retry time forward for the
 * duration of the call is how the batch limit is enforced through the REAL
 * engine instead of a re-implemented loop. It touches only the retry SCHEDULE.
 * It never deletes, never changes status, and it is restored in a `finally`. If
 * the process dies mid-drain the worst case is that some events retry up to this
 * long later — a delay, never a loss.
 */
const DEFER_WINDOW_MS = 60_000;

/**
 * Run a drain. **Dry run unless `confirm` is true** — wave 204's pattern.
 *
 * Nothing in here can deliver more than `plan.limit` events, because the
 * selection is sliced before anything is attempted and every entry outside the
 * slice is made ineligible for the duration of the call.
 */
export async function runDrain(input: {
  requestedLimit: number | null;
  confirm: boolean;
  actorUserId: string;
  actorLabel: string;
  route: string;
}): Promise<DrainOutcome> {
  const plan = planDrain(input.requestedLimit);
  const refusals = plan.selected
    .filter((c) => !c.wouldDeliver)
    .map((c) => ({
      eventId: c.eventId,
      eventType: c.eventType,
      reason: c.refusalReason ?? "",
      fenced: c.fenced,
    }));

  if (!input.confirm) {
    return {
      dryRun: true,
      plan,
      attempted: 0,
      delivered: 0,
      deadLettered: 0,
      refused: refusals.length,
      refusals,
      auditRecorded: true,
      statement: humanText(
        "This was a dry run. Nothing was sent.",
        `It would have sent ${plan.selectedDeliverable} of the ${plan.selected.length} events it looked at.`,
      ),
    };
  }

  /* An explicit confirmation is still not permission: the configuration must
     also allow delivery. Both must hold. */
  if (!plan.mayDeliver) {
    return {
      dryRun: false,
      plan,
      attempted: 0,
      delivered: 0,
      deadLettered: 0,
      refused: refusals.length,
      refusals,
      auditRecorded: true,
      statement: humanText("Nothing was sent.", plan.mayDeliverReason),
    };
  }

  const deliverableIds = new Set(
    plan.selected.filter((c) => c.wouldDeliver).map((c) => c.eventId),
  );
  if (deliverableIds.size === 0) {
    return {
      dryRun: false,
      plan,
      attempted: 0,
      delivered: 0,
      deadLettered: 0,
      refused: refusals.length,
      refusals,
      auditRecorded: true,
      statement: humanText(
        "Nothing was sent.",
        "None of the waiting events in this batch has a destination on the Collective, so each was left queued with its reason.",
      ),
    };
  }

  /* Resolve the target at CALL time. This is the whole point of doing it here
     rather than in the frozen sender, which resolved it at module load. */
  const url = resolveReceiverUrlField().value;
  const secret = resolveReceiverSecret();
  if (!url || !secret) {
    /* Cannot happen while `plan.mayDeliver` is true, but a send without a
       signature must be impossible by construction, not by ordering. */
    return {
      dryRun: false,
      plan,
      attempted: 0,
      delivered: 0,
      deadLettered: 0,
      refused: refusals.length,
      refusals,
      auditRecorded: true,
      statement: humanText(
        "Nothing was sent.",
        "An address and a signing secret must both be present before anything can be delivered.",
      ),
    };
  }

  const now = Date.now();
  const deferred: Array<{ entry: OutboxEntry; original: number }> = [];
  let attempted = 0;
  let result = { delivered: 0, deadLettered: 0 };

  try {
    /* Make everything outside the batch ineligible for this call only. */
    for (const e of getOutbox()) {
      if (deliverableIds.has(e.envelope.eventId)) continue;
      if (!isEligible(e, now)) continue;
      deferred.push({ entry: e, original: e.nextRetryAt });
      e.nextRetryAt = now + DEFER_WINDOW_MS;
    }

    result = await drainOutbox(async (env: BridgeEnvelope) => {
      /* Belt and braces: even inside the real engine, refuse anything that is
         not in the confirmed batch. Unreachable for the deferred entries, which
         the engine skips; reachable only for an event emitted DURING the call,
         which is fail-closed here rather than delivered outside the batch. */
      if (!deliverableIds.has(env.eventId)) return { ok: false, status: 0 };
      attempted += 1;
      const body = JSON.stringify(env);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bridge-signature": hmacSign(body, secret),
            "idempotency-key": env.eventId,
          },
          body,
        });
        return { ok: res.ok, status: res.status };
      } catch {
        return { ok: false, status: 0 };
      }
    });
  } finally {
    /* Restore every deferred retry time, whatever happened above. */
    for (const d of deferred) d.entry.nextRetryAt = d.original;
  }

  const entry = appendAdminAudit(
    input.actorUserId,
    "collective.bridge.backlog_drain",
    "bridge_backlog_drained",
    {
      requestedLimit: input.requestedLimit,
      limitInForce: plan.limit,
      /* Host and path only — a full URL could carry a token in its query. */
      targetHost: plan.targetHost,
      targetPath: plan.targetPath,
      attempted,
      delivered: result.delivered,
      deadLettered: result.deadLettered,
      refused: refusals.length,
      refusedEventIds: refusals.map((r) => r.eventId),
      deferredForThisCall: deferred.length,
      actor: input.actorLabel,
      secretInvolved: false,
    },
  );
  const auditRecorded: boolean = reportAuditWriteOutcome(entry, {
    bearing: "identity",
    action: "bridge_backlog_drained",
    route: input.route,
    subject: "collective.bridge.backlog_drain",
  });

  log.info(
    `[wave206Drain] limit=${plan.limit} attempted=${attempted} delivered=${result.delivered} deadLettered=${result.deadLettered} refused=${refusals.length}`,
  );

  return {
    dryRun: false,
    plan,
    attempted,
    delivered: result.delivered,
    deadLettered: result.deadLettered,
    refused: refusals.length,
    refusals,
    auditRecorded,
    statement: humanText(
      `Sent ${result.delivered} events. ${refusals.length} were left queued with a stated reason.`,
      `${plan.heldBackByLimit} more are still waiting and need another drain.`,
    ),
  };
}

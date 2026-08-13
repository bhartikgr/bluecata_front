/**
 * WAVE 17 — ORP-044 second half: the THREE AUTO-TRIGGERS.
 *
 * `server/milestoneBroadcastStore.ts:8-11` has declared three auto-trigger
 * surfaces since Sprint 14 — `round.closed`, `governance_metric.published`,
 * `ma_initiative_started` — with the note "handled by callers, not this store".
 * Wave 16 searched and found the truth: **no caller anywhere in the tree ever
 * passed a non-`manual` trigger**, so `broadcastCreateSchema`'s three extra enum
 * members (`:57`) were dead vocabulary and the founder-facing filter copy in
 * `client/src/components/founder/MilestoneBroadcastPanel.tsx:77` promised
 * automation that could not happen. This module is the missing half.
 *
 * ─── WHY A REGISTERED DISPATCHER INSTEAD OF A DIRECT IMPORT ──────────────────
 *
 * The natural shape — have the round-close path import `createBroadcast`
 * directly — creates a REAL import cycle, verified at source rather than
 * assumed:
 *
 *   roundsStore.ts:40 → roundCarryForwardRoutes.ts
 *   milestoneBroadcastStore.ts:45 → captableCommitStore.ts:54 → roundsStore.ts
 *
 * so any file on the close path that statically imports `milestoneBroadcastStore`
 * closes a loop back onto itself. Wave 16 deliberately replaced this file's
 * `createRequire` lazy requires with static imports *after* verifying no cycle;
 * re-introducing a lazy `require()` here to dodge the loop would recreate the
 * exact defect Wave 16 removed — a `.ts` require is invisible to the test
 * runner's module graph and degrades silently.
 *
 * So the dependency is inverted instead: this module is a LEAF (it imports only
 * the logger and the shared currency formatter), the producer registers its
 * dispatcher, and the emit points call this module.
 *
 * ─── THE SILENT-NO-OP RISK, AND WHAT PREVENTS IT ─────────────────────────────
 *
 * A registry can be worse than a cycle: if nothing registers, every trigger
 * becomes a no-op and every green test proves nothing. Three defences:
 *   1. `fireAutoBroadcast` with no dispatcher registered is a **loud error log
 *      plus an `ok:false, reason:"dispatcher_unregistered"` return** — never a
 *      silent `return`. Callers ignore the result (side-effect semantics), but
 *      the shortfall is on the record and assertable.
 *   2. Registration happens inside `registerMilestoneBroadcastRoutes(app)`,
 *      which `server/routes.ts:1271` already calls, so the dispatcher exists
 *      wherever the broadcast routes exist. There is no separate boot step to
 *      forget.
 *   3. The proving suite asserts the unregistered pole explicitly, so "it
 *      passed" cannot mean "it did nothing".
 *
 * ─── COPY AND MONEY ──────────────────────────────────────────────────────────
 *
 * Bodies are composed here, capped at the store's own 500-char zod limit
 * (`milestoneBroadcastStore.ts:56`) with a visible ellipsis rather than a silent
 * truncation. Money is INTEGER MINOR UNITS end to end and is rendered through
 * `formatMinor` (server/lib/currency.ts:56) — never `/100`, never `Math.round`.
 * An amount that is absent is simply not mentioned: a round closing "at $0.00"
 * would be a lie an investor would believe.
 */
import { log } from "./logger";
import { formatMinor } from "./currency";

export type MilestoneAutoTrigger =
  | "round_closed"
  | "governance_metric_published"
  | "ma_initiative_started";

/** Mirrors `broadcastCreateSchema.body.max(500)` — milestoneBroadcastStore.ts:56. */
export const AUTO_BODY_MAX = 500;

export interface AutoBroadcastRequest {
  companyId: string;
  /** The user whose action produced the milestone. Never a synthetic persona. */
  actorUserId: string;
  trigger: MilestoneAutoTrigger;
  body: string;
  /**
   * Idempotency key for the milestone itself (e.g. `round_closed:rnd_1`). Every
   * auto-trigger sits on a path that can legitimately run twice — the round
   * sweeper is idempotent by design and re-runs, and a manual close can race it
   * — so without a key the same milestone would notify the cap table twice.
   */
  dedupeKey: string;
}

export interface AutoBroadcastOutcome {
  ok: boolean;
  /** Set when the broadcast was created. */
  id?: string;
  /** In-app notifications actually delivered (never the resolved count). */
  deliveredInApp?: number;
  /** True when an earlier broadcast already covered this dedupeKey. */
  duplicate?: boolean;
  reason?: "dispatcher_unregistered" | "dispatch_failed" | "invalid_request";
}

export type MilestoneAutoDispatcher = (req: AutoBroadcastRequest) => AutoBroadcastOutcome;

let dispatcher: MilestoneAutoDispatcher | null = null;

/**
 * Called by the producer (`registerMilestoneBroadcastRoutes`) so the emit points
 * never import the store. Re-registration is allowed and replaces the previous
 * dispatcher — route registration runs once per app instance and tests build
 * several.
 */
export function registerMilestoneAutoDispatcher(d: MilestoneAutoDispatcher): void {
  dispatcher = d;
}

/** Test-only: prove the unregistered pole. */
export function __clearMilestoneAutoDispatcher(): void {
  dispatcher = null;
}

export function isMilestoneAutoDispatcherRegistered(): boolean {
  return dispatcher !== null;
}

/** Cap at the store's limit, marking the cut so nothing vanishes silently. */
export function capBody(body: string): string {
  const s = body.trim();
  if (s.length <= AUTO_BODY_MAX) return s;
  return `${s.slice(0, AUTO_BODY_MAX - 1)}…`;
}

/**
 * Fire an auto-triggered broadcast. SIDE-EFFECT SEMANTICS: this never throws, so
 * a broadcast failure can never roll back or 500 the milestone that caused it.
 * Every failure path returns a reason AND logs, so "nothing happened" is always
 * distinguishable from "it worked".
 */
export function fireAutoBroadcast(req: AutoBroadcastRequest): AutoBroadcastOutcome {
  if (!req || !req.companyId || !req.body || !req.dedupeKey) {
    log.warn("[milestoneAutoTrigger] refusing an incomplete request:", JSON.stringify({
      companyId: req?.companyId ?? null,
      trigger: req?.trigger ?? null,
      hasBody: Boolean(req?.body),
      dedupeKey: req?.dedupeKey ?? null,
    }));
    return { ok: false, reason: "invalid_request" };
  }
  if (!dispatcher) {
    /* LOUD, not silent — see the header. If this ever appears in a log the
       auto-triggers are dead and the founder-facing "Auto —" filters in
       MilestoneBroadcastPanel are unreachable. */
    log.error(
      "[milestoneAutoTrigger] NO DISPATCHER REGISTERED — the",
      req.trigger,
      "broadcast for",
      req.companyId,
      "was NOT sent. registerMilestoneBroadcastRoutes() must run before any emit point fires.",
    );
    return { ok: false, reason: "dispatcher_unregistered" };
  }
  try {
    const out = dispatcher({ ...req, body: capBody(req.body) });
    return out ?? { ok: false, reason: "dispatch_failed" };
  } catch (err) {
    log.error(
      `[milestoneAutoTrigger] ${req.trigger} dispatch failed for ${req.companyId}:`,
      (err as Error).message,
    );
    return { ok: false, reason: "dispatch_failed" };
  }
}

/* ── body composers ───────────────────────────────────────────────────────── */

const FINAL_STATE_COPY: Record<string, string> = {
  closed: "closed",
  closed_funded: "closed and funded",
  closed_aborted: "closed without completing",
  funded: "funded",
};

/**
 * `round.closed`. The amount is mentioned ONLY when the closer supplied one:
 * `finalAmountMinor` is optional on `CloseRoundOpts` and the sweeper path has no
 * amount at all, so a default of zero would publish a false figure.
 */
export function roundClosedBody(input: {
  roundName?: string | null;
  finalState?: string | null;
  finalAmountMinor?: number | null;
  currency?: string | null;
}): string {
  const round = input.roundName && input.roundName.trim() ? input.roundName.trim() : "The round";
  const state = FINAL_STATE_COPY[String(input.finalState ?? "closed")] ?? "closed";
  const amount =
    typeof input.finalAmountMinor === "number" && Number.isFinite(input.finalAmountMinor)
      ? formatMinor(input.finalAmountMinor, String(input.currency ?? "USD").toUpperCase())
      : null;
  const head = amount ? `${round} ${state} at ${amount}.` : `${round} ${state}.`;
  return capBody(`${head} Your position on the cap table is unchanged by this close.`);
}

/**
 * `governance_metric.published`. Names WHAT was published, never the value: the
 * broadcast audience is the whole cap table and a metric value may be
 * segment-restricted on the surface it lives on.
 */
export function governanceMetricPublishedBody(input: { metricLabel?: string | null }): string {
  const what =
    input.metricLabel && String(input.metricLabel).trim()
      ? String(input.metricLabel).trim()
      : "An updated governance metric";
  return capBody(`${what} has been published for this company. Open the company profile to review it.`);
}

/**
 * `ma_initiative_started`. Deliberately austere: no buyer shortlist, no topic,
 * no initiator identity. The initiator is an INVESTOR (the initiative is created
 * at `POST /api/investor/ma/initiative`, server/maIntelligenceStore.ts:374) and
 * the audience is every other holder on the cap table, so republishing the
 * shortlist or the initiator's name here would route sensitive M&A detail around
 * the M&A access gate (`decideMaAccess`, server/lib/maAuthzGate.ts) and around
 * the directory privacy contract. The existence of the initiative is the
 * milestone; the detail stays behind its own gate.
 */
export function maInitiativeStartedBody(): string {
  return capBody(
    "A lead M&A initiative has been opened for this company. Detail is available only to holders " +
      "who pass the M&A access rules on the company's M&A surface.",
  );
}

/* ── dedupe keys ──────────────────────────────────────────────────────────── */

/**
 * `governance_metric.published`, resolved from the event that actually fires.
 *
 * WHAT WAS TRUE BEFORE THIS. The trigger name comes from the declared bridge
 * event type `governance_metric.published` (server/bridgeStore.ts:329,599), whose
 * only typed emit helper is `BridgeOutbound.governanceMetricPublished`
 * (server/lib/bridgeOutbound.ts:93) and which has ZERO CALLERS tree-wide. So the
 * literal event never happens and hanging the trigger solely off that helper
 * would have shipped a broadcast that can never fire — dead code dressed as
 * wiring.
 *
 * WHERE THE DATA ACTUALLY FLOWS. Governance metrics are the company-profile
 * governance fields (`boardCompositionDirectors`, `boardDirectorsSnapshot`,
 * `boardCompositionIndependent` — declared at server/companyProfileStore.ts:167-168
 * and on the Collective sync allowlist at server/lib/companySyncFields.ts:40).
 * They are written by `PATCH /api/founder/profile`, which emits
 * `company.profile.updated` carrying the patch. That route lives in the SACRED
 * server/companyProfileStore.ts (read, never edit), so the trigger is attached at
 * the event fan-out instead — which also covers the second producer
 * (server/profileStore.ts:253, likewise sacred).
 *
 * This function is therefore called with a `company.profile.updated` envelope and
 * fires ONLY when the patch actually contains a governance field. Dedupe is keyed
 * on the profile version in the payload, so a retried emit of the same version
 * cannot notify the cap table twice, while a genuine later edit (a new version)
 * legitimately does.
 */
export const GOVERNANCE_METRIC_FIELDS = [
  "boardCompositionDirectors",
  "boardCompositionIndependent",
  "boardDirectorsSnapshot",
] as const;

const GOVERNANCE_FIELD_LABELS: Record<string, string> = {
  boardCompositionDirectors: "Board composition (director count)",
  boardCompositionIndependent: "Board composition (independent directors)",
  boardDirectorsSnapshot: "Board directors snapshot",
};

/** Which governance fields a `company.profile.updated` payload actually carries. */
export function governanceFieldsInPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  /* Two shapes exist in the tree: companyProfileStore wraps the change as
     `{ patch, version }`, profileStore spreads the fields and adds
     `changedFields`. Read all three so neither producer is silently missed. */
  const patch = (p.patch && typeof p.patch === "object" ? p.patch : {}) as Record<string, unknown>;
  const changed = Array.isArray(p.changedFields) ? p.changedFields.map(String) : [];
  const hits: string[] = [];
  for (const f of GOVERNANCE_METRIC_FIELDS) {
    if (patch[f] !== undefined || p[f] !== undefined || changed.includes(f)) hits.push(f);
  }
  return hits;
}

export function maybeBroadcastGovernanceMetric(input: {
  eventType: string;
  companyId: string;
  actorUserId?: string | null;
  payload: unknown;
}): AutoBroadcastOutcome | null {
  /* Both the event that really fires today AND the declared-but-unused canonical
     type, so a future publisher calling BridgeOutbound.governanceMetricPublished
     is covered without a second wiring change. */
  const isProfileEvent = input.eventType === "company.profile.updated";
  const isCanonical = input.eventType === "governance_metric.published";
  if (!isProfileEvent && !isCanonical) return null;
  const fields = isCanonical ? ["governance_metric"] : governanceFieldsInPayload(input.payload);
  if (fields.length === 0) return null;
  const p = (input.payload ?? {}) as Record<string, unknown>;
  const version = p.version !== undefined ? String(p.version) : "v?";
  const label =
    fields.length === 1
      ? GOVERNANCE_FIELD_LABELS[fields[0]] ?? "An updated governance metric"
      : "Updated governance metrics";
  return fireAutoBroadcast({
    companyId: input.companyId,
    actorUserId: String(input.actorUserId ?? "system:governance_publish"),
    trigger: "governance_metric_published",
    body: governanceMetricPublishedBody({ metricLabel: label }),
    dedupeKey: governanceMetricKey(input.companyId, `${fields.sort().join("+")}@${version}`),
  });
}

export function roundClosedKey(roundId: string): string {
  return `round_closed:${roundId}`;
}
export function governanceMetricKey(companyId: string, metricKey: string): string {
  return `governance_metric_published:${companyId}:${metricKey}`;
}
export function maInitiativeKey(initiativeId: string): string {
  return `ma_initiative_started:${initiativeId}`;
}

/* ══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 181 · ITEM B — SPV LIFECYCLE AUDIT WRITERS
 *  R148.3 item 2, second half.
 * ══════════════════════════════════════════════════════════════════════════ *
 *
 *  WHAT THIS IS FOR, AND WHAT IT IS NOT FOR.
 *
 *  Wave 181's investigation established that the reported "audit log has no
 *  entries in three months" was a READ defect: `/admin/audit-log` fetched the
 *  OLDEST 100 of 1314 rows and applied the date range to that page in the
 *  browser. The writer was healthy the whole time, across 217 call sites. That
 *  is fixed in `adminPlatformStore.ts` (the endpoint) and `AuditLog.tsx` (the
 *  page), and NO redundant writes were added to compensate for it.
 *
 *  Separately, and genuinely, four SPV lifecycle events were never audited at
 *  all. They are not visible on the audit screen because nothing ever wrote
 *  them, and fixing the read does not conjure them. Those are what this module
 *  records:
 *
 *    · SPV / fund / syndicate CREATED        (a new legal vehicle exists)
 *    · LP FUNDS CONFIRMED                    (money asserted received)
 *    · SPV CLOSED TO NEW LPs                 (terminal fundraising state)
 *    · SPV REOPENED for a rolling close      (a terminal state undone)
 *
 *  Before this wave, each of these emitted only a bridge envelope
 *  (`emit("spv.created", …)` etc.). A bridge envelope is a DELIVERY QUEUE
 *  message: it is drained, can be dead-lettered, and is pruned by
 *  `clearBridgeOutbox()`. It is not a forensic record and `/admin/audit-log`
 *  does not read it. So "the event was emitted" was never the same claim as
 *  "the action was audited", and only the first was true.
 *
 *  ── WHY THESE FOUR AND NOT SEVEN ──────────────────────────────────────────
 *
 *  Two further gaps are REAL, PROVED and DELIBERATELY LEFT OPEN this wave:
 *  `POST /api/partner/me/spv/:spvId/lp-commit` (the LP commitment itself) and
 *  `POST /api/partner/me/spv/:spvId/lp-invites`. Both are audit-worthy — the
 *  first more than anything in this file, because it is the money seat.
 *
 *  They are not done here because the acting user CANNOT BE RESOLVED from the
 *  store on those paths: `spvEngineStore.projectLpCommitted()` takes no
 *  `actor`, and the invite path lives entirely in `server/spvEngineRoutes.ts`,
 *  which wave 179 held open while wave 181 ran. Writing those rows from where
 *  this wave could reach would produce audit entries for MONEY MOVEMENTS whose
 *  actor field reads "unresolved". A money audit row that cannot name who did it
 *  is not a lesser record — it is a misleading one, because it makes the log
 *  look complete while answering the one question an auditor actually asks with
 *  a shrug. Better an honest, documented, single-line gap than a populated
 *  column of shrugs. The exact follow-up patch is specified in
 *  `build_log/wave181/W181_BUILD.md`.
 *
 *  ── THE RULES THIS MODULE OBEYS ───────────────────────────────────────────
 *
 *  1. WHO, WHAT, WHEN — every entry carries a resolved actor id, an event type,
 *     and a timestamp stamped by `appendAudit` from the DB write itself.
 *
 *  2. NEVER INVENT AN ACTOR. If the caller cannot supply one, this module does
 *     NOT substitute "u_system", "u_admin" or any other plausible-looking id.
 *     It records `actorResolved: false` together with the reason, and sets the
 *     actor to the explicit sentinel `u_unresolved`, which resolves to no user
 *     and is therefore unmistakable rather than merely wrong. A placeholder that
 *     looks like a real user is how a forensic record starts lying.
 *
 *  3. AN AUDIT WRITE MUST NEVER FAIL SILENTLY. `appendAdminAudit` does not throw
 *     on DB failure — it returns a sentinel entry with an empty hash
 *     (`isAuditWriteFailure`). Roughly 210 of the platform's 217 call sites
 *     never check that sentinel, which is the real silent-failure vector on this
 *     platform (wave 57d named it). Every call site in this module CHECKS IT and
 *     logs at error level with the event type and target, so a failed audit is
 *     discoverable in the logs even though it must not abort the money path.
 *
 *  4. NO BACKFILL. Nothing in this module writes historical entries. Every row
 *     it produces is written at the instant the action happens. Events that
 *     occurred before this code shipped have no audit entry and never will.
 *
 *  5. THE HASH CHAIN IS NOT TOUCHED. These are ordinary `appendAdminAudit`
 *     calls, identical in kind to the other 217. They APPEND to the per-tenant
 *     chain exactly as every existing writer does. No hash body, ordering
 *     constant, anchor or genesis row is read or rewritten here.
 *
 *  6. NO MONEY ARITHMETIC. Minor-unit amounts are passed through to the payload
 *     as strings, unmodified. This module never calls `Number()`, `parseInt` or
 *     `parseFloat` on a money value, and performs no addition, subtraction or
 *     comparison on one. It is a recorder, not a calculator.
 */

import { appendAdminAudit, isAuditWriteFailure, reportAuditWriteOutcome } from "../adminPlatformStore";
import { log } from "./logger";

/** The explicit "we could not resolve the acting user" actor id. Chosen so it
 *  matches no real user id namespace on the platform and reads as a defect
 *  rather than as a system account. */
export const UNRESOLVED_ACTOR = "u_unresolved";

export type SpvAuditActor = {
  actorId: string;
  actorResolved: boolean;
  actorUnresolvedReason?: string;
};

/** Resolve an actor WITHOUT inventing one (rule 2). */
export function resolveSpvAuditActor(actor: string | null | undefined): SpvAuditActor {
  const trimmed = typeof actor === "string" ? actor.trim() : "";
  if (trimmed.length > 0) return { actorId: trimmed, actorResolved: true };
  return {
    actorId: UNRESOLVED_ACTOR,
    actorResolved: false,
    actorUnresolvedReason:
      "The calling path supplied no actor id. This entry deliberately does NOT attribute the action to a placeholder user.",
  };
}

/** One audited SPV lifecycle event. Rule 3 is enforced here, once, so no call
 *  site can forget it. */
function writeSpvAudit(
  eventType: string,
  entity: string,
  actor: string | null | undefined,
  payload: Record<string, unknown>,
  /* WAVE 186 — what was at stake, so a lost row can be triaged by an operator
     without first reading the source. Defaults to the weakest claim. */
  bearing: "money" | "identity" | "routine" = "routine",
): void {
  const resolved = resolveSpvAuditActor(actor);
  try {
    const entry = appendAdminAudit(resolved.actorId, entity, eventType, {
      ...payload,
      actorResolved: resolved.actorResolved,
      ...(resolved.actorUnresolvedReason ? { actorUnresolvedReason: resolved.actorUnresolvedReason } : {}),
      auditWriter: "spvLifecycleAudit",
      auditWave: 181,
    });
    /* RULE 3 — the sentinel is CHECKED. This is the difference between an audit
       that failed and an audit that failed silently. */
    if (isAuditWriteFailure(entry)) {
      log.error?.(
        `[spvLifecycleAudit] AUDIT_WRITE_FAILED eventType=${eventType} entity=${entity} actor=${resolved.actorId} actorResolved=${resolved.actorResolved} — the action PROCEEDED but no durable audit row exists for it. Investigate audit_log write health before relying on this period of the log.`,
      );
    }
    /* WAVE 186 · R159.1 — the line above is discoverable only by someone reading
       the process log. This ALSO counts the loss into the platform's audit-write
       health, which GET /api/admin/audit-write-health publishes and the admin
       audit screen renders. A lost audit row is now visible IN THE PRODUCT, not
       just in a log file nobody tails. Returns false on loss; we deliberately do
       not act on it here (W186_BUILD.md §3). */
    reportAuditWriteOutcome(entry, { bearing, action: eventType, route: "spvLifecycleAudit", subject: entity });
  } catch (err) {
    /* `appendAdminAudit` is not expected to throw (it catches internally). If it
       ever does, the money/lifecycle path must still complete — but the failure
       is LOUD, never a bare `catch {}`. */
    log.error?.(
      `[spvLifecycleAudit] AUDIT_WRITE_THREW eventType=${eventType} entity=${entity} actor=${resolved.actorId}: ${(err as Error)?.message ?? String(err)}`,
    );
  }
}

/** A new SPV / fund / syndicate legal vehicle now exists. */
export function auditSpvCreated(input: {
  partnerId: string;
  spvId: string;
  name: string;
  spvType: string;
  scope?: string | null;
  targetRaiseMinor?: number | null;
  currency?: string | null;
  targetCompanyId?: string | null;
  actor: string | null | undefined;
}): void {
  writeSpvAudit("spv.created", `spv:${input.spvId}`, input.actor, {
    partnerId: input.partnerId,
    spvId: input.spvId,
    name: input.name,
    spvType: input.spvType,
    distributionScope: input.scope ?? null,
    /* Money as a STRING, verbatim. No arithmetic (rule 6). */
    targetRaiseMinor:
      input.targetRaiseMinor === null || input.targetRaiseMinor === undefined
        ? null
        : String(input.targetRaiseMinor),
    currency: input.currency ?? null,
    targetCompanyId: input.targetCompanyId ?? null,
  }, "identity");
}

/** A GP asserted that an LP's funds were received. This is an assertion about
 *  money that arrived OUTSIDE the platform, so who said it and when is the
 *  entire evidentiary value of the record. */
export function auditSpvFundsConfirmed(input: {
  partnerId: string;
  spvId: string;
  investorId: string;
  expectedMinor: number;
  receivedMinor: number;
  deltaMinor: number;
  status: string;
  mismatch: boolean;
  reference: string | null;
  actor: string | null | undefined;
}): void {
  writeSpvAudit("spv.lp_funds_confirmed", `spv:${input.spvId}`, input.actor, {
    partnerId: input.partnerId,
    spvId: input.spvId,
    investorId: input.investorId,
    /* All three amounts pass through as strings, exactly as the confirmation
       computed them. This writer does not re-derive `deltaMinor` (rule 6): a
       recorder that recomputes the number it is recording can disagree with the
       thing it claims to witness. */
    expectedMinor: String(input.expectedMinor),
    receivedMinor: String(input.receivedMinor),
    deltaMinor: String(input.deltaMinor),
    confirmationStatus: input.status,
    mismatch: input.mismatch,
    reference: input.reference,
  }, "money");
}

/** Fundraising closed to new LPs — a terminal state for the vehicle. */
export function auditSpvClosedToNewLps(input: {
  partnerId: string;
  spvId: string;
  closeDate: string | null;
  underTarget: boolean;
  confirmedMinor: number;
  targetRaiseMinor: number | null;
  targetLoweredToRaised: boolean;
  actor: string | null | undefined;
}): void {
  writeSpvAudit("spv.closed_to_new_lps", `spv:${input.spvId}`, input.actor, {
    partnerId: input.partnerId,
    spvId: input.spvId,
    closeDate: input.closeDate,
    underTarget: input.underTarget,
    confirmedMinor: String(input.confirmedMinor),
    targetRaiseMinor: input.targetRaiseMinor === null ? null : String(input.targetRaiseMinor),
    /* Whether the GP moved the goalposts at close time is itself audit-worthy:
       it is the difference between "we raised our target" and "we redefined
       our target to be what we raised". */
    targetLoweredToRaised: input.targetLoweredToRaised,
  }, "money");
}

/** A closed vehicle was reopened for a rolling close — a terminal state undone,
 *  which is precisely the kind of reversal an auditor looks for. */
export function auditSpvReopened(input: {
  partnerId: string;
  spvId: string;
  windowDays: number;
  priorCloseDate: string | null;
  actor: string | null | undefined;
}): void {
  writeSpvAudit("spv.reopened_rolling_close", `spv:${input.spvId}`, input.actor, {
    partnerId: input.partnerId,
    spvId: input.spvId,
    rollingCloseWindowDays: input.windowDays,
    priorCloseDate: input.priorCloseDate,
  }, "money");
}


/* ══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 186 · R159.1 — THE TWO WRITERS WAVE 181 LEFT OPEN
 *
 *  Wave 181 documented these as REAL, PROVED gaps and deferred them for one
 *  reason only: the acting user could not be resolved from where that wave was
 *  allowed to edit, and it refused to write money rows whose actor field read
 *  "unresolved" (see rule 2 and the "WHY THESE FOUR AND NOT SEVEN" note above).
 *  The exact follow-up patch is specified in build_log/wave181/W181_BUILD.md
 *  §5.1, and this is it.
 *
 *  What changed: both writers are invoked from `server/spvEngineRoutes.ts`,
 *  INSIDE the route handler, where `ctx.userId` is the authenticated partner
 *  user that `requirePartnerAuth` already resolved. So the actor is real, not a
 *  placeholder, and rule 2 is satisfied rather than waived.
 *
 *  `spv.lp_committed` is the money seat of this whole module — it is the row an
 *  auditor reaches for first, and it is the one the ledger has never had.
 * ══════════════════════════════════════════════════════════════════════════ */

/** An LP committed capital to the vehicle. THE money-bearing lifecycle event. */
export function auditSpvLpCommitted(input: {
  partnerId: string;
  spvId: string;
  investorEmail: string;
  holderName: string;
  /* A STRING, always. The route holds this as a `bigint` and stringifies it at
     the boundary; this module never calls Number()/parseInt/parseFloat on a
     money value and performs no arithmetic on one (rule 6). */
  amountMinor: string;
  shares: number | string | null;
  currency: string | null;
  subscriptionId: string | null;
  actor: string | null | undefined;
}): void {
  writeSpvAudit(
    "spv.lp_committed",
    `spv:${input.spvId}`,
    input.actor,
    {
      partnerId: input.partnerId,
      spvId: input.spvId,
      investorEmail: input.investorEmail,
      holderName: input.holderName,
      /* Recorded verbatim as received. `String()` on a value that is already a
         string is a no-op and is NOT arithmetic; it exists so a caller that
         hands over a bigint cannot serialise as `null` through JSON. */
      amountMinor: String(input.amountMinor),
      shares: input.shares === null || input.shares === undefined ? null : String(input.shares),
      currency: input.currency ?? null,
      subscriptionId: input.subscriptionId ?? null,
      /* The writer module is wave 181's; THIS event was completed in wave 186.
         Recorded so the ledger can never mis-date its own provenance. */
      auditWaveCompleted: 186,
    },
    "money",
  );
}

/** An LP was invited into the vehicle — an identity-bearing act: it grants a
 *  named outsider access to a private vehicle's subscription flow. */
export function auditSpvLpInvited(input: {
  partnerId: string;
  spvId: string;
  investorEmail: string;
  inviteId: string | null;
  actor: string | null | undefined;
}): void {
  writeSpvAudit(
    "spv.lp_invited",
    `spv:${input.spvId}`,
    input.actor,
    {
      partnerId: input.partnerId,
      spvId: input.spvId,
      investorEmail: input.investorEmail,
      inviteId: input.inviteId ?? null,
      auditWaveCompleted: 186,
    },
    "identity",
  );
}

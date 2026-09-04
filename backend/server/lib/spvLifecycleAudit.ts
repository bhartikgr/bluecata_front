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

/* ══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 278b · R224.1 — THE TWO TERMS A DISPUTE TURNS ON
 *
 *  BOTH SINKS ALREADY EMIT. NEITHER AUDITS. That distinction is the whole
 *  wave, so it is stated once, here, in the tree:
 *
 *    · `spvEngineStore.setMandate` emits `spv.mandate_set` (:1099)
 *    · `spvEngineStore.addFee`     emits `spv.fee_set`     (:1324)
 *
 *  An `emit` is a bridge-outbox envelope — drained, dead-letterable, pruned by
 *  `clearBridgeOutbox()`, and `emit` itself SWALLOWS its own failure in a bare
 *  `catch {}` (`spvEngineStore.ts:408`). `/admin/audit-log` reads `audit_log`,
 *  which `emit` never touches. So an emitted event is NOT evidence of an audit
 *  row, and "the event was emitted" has never been the same claim as "the
 *  action was audited" (module header, rule set above, lines 25-30).
 *
 *  A mandate is the vehicle's investment remit; a fee row is an economic term
 *  that binds the LPs. Both are changeable after launch through
 *  `PUT /api/partner/me/spv/:spvId/mandate` and `POST /api/partner/me/spv/:spvId/fees`,
 *  and both are what a dispute actually turns on. Until this wave a GP could
 *  change either and the forensic ledger recorded nothing.
 *
 *  NO NEW AUDIT SHAPE IS INVENTED. Both writers below reuse `writeSpvAudit`
 *  unchanged, use the SAME event-type strings the `emit` calls already use (one
 *  vocabulary, not two), and use the same `spv:${spvId}` entity key all seven
 *  existing writers use, so the new rows sort into the same subject.
 *
 *  ADD BESIDE, NEVER REWRITE. Both writers only ever `appendAdminAudit`. There
 *  is no UPDATE, no DELETE, no re-chaining and no anchor read anywhere in this
 *  module (rule 5), so no pre-existing audit row can be altered by them.
 * ══════════════════════════════════════════════════════════════════════════ */

/** The vehicle's investment remit was set or replaced. IDENTITY-bearing: it
 *  defines who and what the vehicle may invest in, which is the same bearing
 *  `auditSpvCreated` uses for the vehicle's own existence. */
export function auditSpvMandateSet(input: {
  partnerId: string;
  spvId: string;
  mandateId: string;
  mode: string;
  sector: string[];
  geography: string[];
  stage: string[];
  companyIds: string[];
  /* Money bounds. Recorded as strings, never arithmetic (rule 6). */
  checkMinMinor: number | null;
  checkMaxMinor: number | null;
  revisionHash: string;
  actor: string | null | undefined;
}): void {
  writeSpvAudit(
    "spv.mandate_set",
    `spv:${input.spvId}`,
    input.actor,
    {
      partnerId: input.partnerId,
      spvId: input.spvId,
      mandateId: input.mandateId,
      mode: input.mode,
      sector: input.sector,
      geography: input.geography,
      stage: input.stage,
      companyIds: input.companyIds,
      /* Money as a STRING, verbatim, exactly as `auditSpvCreated` records
         `targetRaiseMinor`. A null bound is recorded as null, NEVER as "0" — a
         fabricated zero is a different mandate from an unbounded one. */
      checkMinMinor:
        input.checkMinMinor === null || input.checkMinMinor === undefined
          ? null
          : String(input.checkMinMinor),
      checkMaxMinor:
        input.checkMaxMinor === null || input.checkMaxMinor === undefined
          ? null
          : String(input.checkMaxMinor),
      /* The exact chained revision this row witnessed, so the audit entry and
         the `spv_mandate` row can never be shown to describe different states. */
      revisionHash: input.revisionHash,
      auditWaveCompleted: 278,
    },
    "identity",
  );
}

/** A fee term was set on the vehicle. MONEY-bearing: it binds the LPs, so a
 *  lost row is triaged as a money loss by `reportAuditWriteOutcome` — the same
 *  bearing `auditSpvLpCommitted` uses. */
export function auditSpvFeeSet(input: {
  partnerId: string;
  spvId: string;
  feeId: string;
  layer: string;
  feeType: string;
  /* Money and percent. Recorded as strings, never arithmetic (rule 6). */
  fixedAmountMinor: number | null;
  carryPct: number | null;
  currency: string | null;
  effectiveDate: string;
  combinedCarryOverCap: boolean;
  revisionHash: string;
  actor: string | null | undefined;
}): void {
  writeSpvAudit(
    "spv.fee_set",
    `spv:${input.spvId}`,
    input.actor,
    {
      partnerId: input.partnerId,
      spvId: input.spvId,
      feeId: input.feeId,
      layer: input.layer,
      feeType: input.feeType,
      /* A pure-carry fee has NO fixed amount. Recorded as null, never as "0":
         "no fixed fee" and "a fixed fee of zero" are different fee terms. */
      fixedAmountMinor:
        input.fixedAmountMinor === null || input.fixedAmountMinor === undefined
          ? null
          : String(input.fixedAmountMinor),
      /* `carryPct` is a FRACTION, not money and not a percent-as-written. It is
         recorded verbatim with NO scaling and NO conversion, per the platform's
         P-0 percent ruling — a recorder that rescales the number it records can
         disagree with the thing it claims to witness. */
      carryPct:
        input.carryPct === null || input.carryPct === undefined ? null : String(input.carryPct),
      /* Currency is recorded, NEVER converted. */
      currency: input.currency ?? null,
      effectiveDate: input.effectiveDate,
      /* The cross-layer verdict the `emit` already carries, kept on the durable
         row too so a misconfigured stack is discoverable forensically and not
         only from a drained queue message. */
      combinedCarryOverCap: input.combinedCarryOverCap,
      revisionHash: input.revisionHash,
      auditWaveCompleted: 278,
    },
    "money",
  );
}

/* ══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 306 · PART 1 — THE UNAUDITED MONEY DECISION
 * ══════════════════════════════════════════════════════════════════════════ *
 *
 *  Settling a fee obligation and waiving one both moved money (or forgave it)
 *  and neither left a forensic record. Both called `emit(...)` and nothing
 *  else, and `spvEngineStore.ts` `function emit` (`:406`) wraps its body in a
 *  bare `catch {}` at `:410` — so a failed bridge publish produced no row, no
 *  throw and not even a log line. An emit is a DELIVERY QUEUE MESSAGE: it is
 *  drained, it can be dead-lettered, `clearBridgeOutbox()` prunes it, and
 *  `/admin/audit-log` does not read it. AN EMIT IS NOT AN AUDIT ROW (R253.1).
 *
 *  A waiver is the sharper of the two: an administrator decides that money the
 *  vehicle owes will never be collected, and that decision is what unblocks
 *  every LP commitment on the vehicle. Before this wave the only trace was the
 *  mutable `waived_by` / `waived_reason` columns on the obligation row itself —
 *  the row the decision CHANGED. There was nothing chained, nothing dated by
 *  the database, and nothing an auditor could read on the audit screen.
 *
 *  These two writers are the whole of the change. NO NEW AUDIT SHAPE: both go
 *  through the same private `writeSpvAudit` above, unchanged, which resolves the
 *  actor without inventing one, checks the failure sentinel and reports the
 *  outcome into audit-write health. The event types are the SAME STRINGS the
 *  existing `emit` calls already use — one vocabulary for the queue and the
 *  ledger, not two.
 *
 *  RULES OBEYED HERE, RESTATED BECAUSE THIS IS A MONEY WRITER:
 *
 *  · THE PERSISTED ROW, NEVER THE REQUEST (R253.1). Every field below is read
 *    off the obligation object AFTER `_persistFeeObligation` has written it and
 *    stamped `revisionHash`. The request records what was asked for; the stored
 *    row records what happened, and where they differ the stored row is the
 *    only one worth keeping.
 *  · MONEY AS `String(...)` OR `null`, NEVER `"0"` (R231). An obligation with no
 *    amount on record is not an obligation for nothing.
 *  · NO CURRENCY CONVERSION, and no arithmetic of any kind. `amountMinor` and
 *    `currency` pass through verbatim.
 *  · `revisionHash` is recorded so the audit row and the `spv_fee_obligation`
 *    chain can never be shown to describe different states.
 */

/** An administrator FORGAVE money the vehicle owed. The reason is the record. */
export function auditSpvFeeObligationWaived(input: {
  partnerId: string;
  spvId: string;
  obligationId: string;
  layer: string;
  portion: string;
  timing: string;
  /** The PERSISTED state, read back off the row. Expected `"waived"`. */
  state: string;
  amountMinor: number | null;
  currency: string | null;
  waivedBy: string | null;
  waivedReason: string | null;
  revisionHash: string;
  actor: string | null | undefined;
}): void {
  writeSpvAudit(
    "spv.fee_obligation_waived",
    `spv:${input.spvId}`,
    input.actor,
    {
      partnerId: input.partnerId,
      spvId: input.spvId,
      obligationId: input.obligationId,
      layer: input.layer,
      portion: input.portion,
      timing: input.timing,
      /* Recorded rather than assumed. If a future path ever waives a row into
         some other state, the audit says so instead of claiming "waived". */
      state: input.state,
      /* Money as a STRING, verbatim, or null. NEVER "0". */
      amountMinor:
        input.amountMinor === null || input.amountMinor === undefined
          ? null
          : String(input.amountMinor),
      /* Recorded, never converted. */
      currency: input.currency ?? null,
      /* Who the STORED ROW says forgave it, which is not necessarily the same
         field as the audit actor: `actor` is who made the call, `waivedBy` is
         what was durably written. Both are kept so a mismatch is visible. */
      waivedBy: input.waivedBy,
      /* The stated reason, verbatim and untruncated. A waiver without one is
         unauditable, which is why the server now refuses it (W306 Part 2). */
      waivedReason: input.waivedReason,
      revisionHash: input.revisionHash,
      auditWaveCompleted: 306,
    },
    "money",
  );
}

/** A fee obligation was SETTLED — money actually collected through the payment
 *  ledger, against an unforgeable settlement authorization. */
export function auditSpvFeeObligationSettled(input: {
  partnerId: string;
  spvId: string;
  obligationId: string;
  layer: string;
  portion: string;
  timing: string;
  /** The PERSISTED state, read back off the row. Expected `"paid"`. */
  state: string;
  amountMinor: number | null;
  currency: string | null;
  paymentRef: string | null;
  distributionId: string | null;
  /** Where the authorization came from — `gateway`, `platform_admin`, `test`. */
  authorizationSource: string | null;
  authorizationId: string | null;
  authorizationReason: string | null;
  revisionHash: string;
  actor: string | null | undefined;
}): void {
  writeSpvAudit(
    "spv.fee_obligation_paid",
    `spv:${input.spvId}`,
    input.actor,
    {
      partnerId: input.partnerId,
      spvId: input.spvId,
      obligationId: input.obligationId,
      layer: input.layer,
      portion: input.portion,
      timing: input.timing,
      state: input.state,
      amountMinor:
        input.amountMinor === null || input.amountMinor === undefined
          ? null
          : String(input.amountMinor),
      currency: input.currency ?? null,
      /* The payment-ledger entry this settlement resolved to. Null would mean a
         settled obligation with no ledger reference, which is worth seeing. */
      paymentRef: input.paymentRef,
      /* Non-null only on the CARRY collection path, which settles an obligation
         from inside `recordDistribution`. Recorded because that path has no
         route and no screen: the audit row is the only place it surfaces. */
      distributionId: input.distributionId,
      /* Provenance of the authority to settle, read from the DURABLE
         authorization row as `consumeSettlementAuthorization` returned it — not
         from the in-process object the caller handed in. */
      authorizationSource: input.authorizationSource,
      authorizationId: input.authorizationId,
      authorizationReason: input.authorizationReason,
      revisionHash: input.revisionHash,
      auditWaveCompleted: 306,
    },
    "money",
  );
}

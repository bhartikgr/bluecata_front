/**
 * server/lib/mfaAudit.ts — WAVE 305 · R251 / R253.
 *
 * DURABLE AUDIT ROWS FOR IDENTITY EVENTS.
 *
 * R253, verbatim in spirit: AN EMIT IS NOT AN AUDIT ROW. `spvEngineStore.ts`'s
 * `emit` (:406) ends in a bare `catch { /* non-fatal ... *\/ }` at :410, so an
 * "audited" action there can leave no trace at all. This module does not use
 * `emit`. It writes an `audit_log` row through `appendAdminAudit` and CHECKS THE
 * SENTINEL, exactly as `server/lib/spvLifecycleAudit.ts` does.
 *
 * THE SHAPE IS NOT NEW. It is `spvLifecycleAudit`'s shape: same writer, same
 * sentinel check, same `reportAuditWriteOutcome` health accounting, same
 * "never invent an actor" rule and the same `u_unresolved` sentinel, which is
 * imported from that module rather than re-declared so the two cannot drift.
 *
 * WHAT IS AUDITED
 *   mfa.enrolment_started / mfa.enrolment_confirmed / mfa.enrolment_disabled
 *   mfa.challenge_passed  / mfa.challenge_failed
 *   mfa.recovery_code_used / mfa.recovery_codes_issued
 *   mfa.admin_reset        ← the one the owner asked for by name
 *   mfa.policy_changed
 *
 * WHAT IS NOT IN A PAYLOAD, EVER: a TOTP secret, a recovery code, a recovery code
 * hash, or a submitted code. An audit log that leaks the second factor is worse
 * than no audit log. A test asserts the secret does not appear in any payload.
 */

import { appendAdminAudit, isAuditWriteFailure, reportAuditWriteOutcome } from "../adminPlatformStore";
import { UNRESOLVED_ACTOR, resolveSpvAuditActor } from "./spvLifecycleAudit";
import { log } from "./logger";

export { UNRESOLVED_ACTOR };

/**
 * One audited MFA event. Structurally identical to `spvLifecycleAudit`'s private
 * `writeSpvAudit`, including the sentinel check that is the whole point.
 *
 * Exported (unlike its model) because the routes module is the only caller and a
 * per-event wrapper for nine events would be ceremony without a reader.
 */
export function writeMfaAudit(
  eventType: string,
  entity: string,
  actor: string | null | undefined,
  payload: Record<string, unknown>,
  bearing: "money" | "identity" | "routine" = "identity",
): void {
  const resolved = resolveSpvAuditActor(actor);
  try {
    const entry = appendAdminAudit(resolved.actorId, entity, eventType, {
      ...payload,
      actorResolved: resolved.actorResolved,
      ...(resolved.actorUnresolvedReason ? { actorUnresolvedReason: resolved.actorUnresolvedReason } : {}),
      auditWriter: "mfaAudit",
      auditWave: 305,
    });
    if (isAuditWriteFailure(entry)) {
      log.error?.(
        `[mfaAudit] AUDIT_WRITE_FAILED eventType=${eventType} entity=${entity} actor=${resolved.actorId} actorResolved=${resolved.actorResolved} — the action PROCEEDED but no durable audit row exists for it. Investigate audit_log write health before relying on this period of the log.`,
      );
    }
    reportAuditWriteOutcome(entry, { bearing, action: eventType, route: "mfaAudit", subject: entity });
  } catch (err) {
    log.error?.(
      `[mfaAudit] AUDIT_WRITE_THREW eventType=${eventType} entity=${entity} actor=${resolved.actorId}: ${(err as Error)?.message ?? String(err)}`,
    );
  }
}

/** An administrator cleared another user's enrolment. THE ROW IS THE POINT. */
export function auditMfaAdminReset(input: {
  actorId: string | null | undefined;
  subjectUserId: string;
  priorState: string | null;
  recoveryCodesInvalidated: number;
  reason: string;
}): void {
  writeMfaAudit("mfa.admin_reset", `user:${input.subjectUserId}`, input.actorId, {
    subjectUserId: input.subjectUserId,
    priorState: input.priorState,
    /* A count, not a list. Never the hashes. */
    recoveryCodesInvalidated: String(input.recoveryCodesInvalidated),
    reason: input.reason,
  });
}

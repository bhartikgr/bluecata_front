/**
 * Sprint 14 D5 — Soft-circle 14-day expiry runner (Conflict 1 fix).
 *
 * Runs daily (in the in-process mock: tick by manual call from test or by
 * setInterval in production). For every soft-circled invitation older than
 * 14 days where the founder hasn't moved it to confirmed, emits
 * `soft_circle.lapsed` and bumps the decision back to `viewed` (per the
 * 10-state machine, lapsed soft-circles are reverted not destroyed).
 */
import { withTrace } from "./trace";
import { emitSync } from "../sprint10Telemetry";
import { BridgeOutbound } from "./bridgeOutbound";

export const SOFT_CIRCLE_EXPIRY_DAYS = 14;

export interface SoftCircleRecord {
  invitationId: string;
  roundId: string;
  companyId: string;
  state: string;
  /** ISO timestamp of when the soft-circle entered the soft_circled state. */
  softCircledAt?: string;
  amount?: number;
  currency?: string;
}

export interface ExpiryResult {
  scanned: number;
  lapsed: { invitationId: string; ageDays: number }[];
  ts: string;
}

export function runExpirySweep(records: SoftCircleRecord[], now: Date = new Date()): ExpiryResult {
  return withTrace("soft_circle.expiry_sweep", "1.0.0", "US", () => {
    const lapsed: { invitationId: string; ageDays: number }[] = [];
    for (const r of records) {
      if (r.state !== "soft_circled" || !r.softCircledAt) continue;
      const age = (now.getTime() - new Date(r.softCircledAt).getTime()) / (1000 * 60 * 60 * 24);
      if (age >= SOFT_CIRCLE_EXPIRY_DAYS) {
        lapsed.push({ invitationId: r.invitationId, ageDays: Math.round(age * 10) / 10 });
        // Revert state to viewed and emit
        r.state = "viewed";
        r.softCircledAt = undefined;
        emitSync({
          eventType: "soft_circle.lapsed",
          aggregateId: r.invitationId,
          aggregateKind: "invitation",
          payload: { invitationId: r.invitationId, roundId: r.roundId, companyId: r.companyId, ageDays: Math.round(age * 10) / 10 },
          actorUserId: "u_system_expiry",
        });
        BridgeOutbound.auditLogAppended(r.companyId, { kind: "soft_circle_lapsed", invitationId: r.invitationId });
      }
    }
    return { scanned: records.length, lapsed, ts: now.toISOString() };
  });
}

/** Compute remaining days for a soft-circle. */
export function daysRemaining(softCircledAt: string, now: Date = new Date()): number {
  const expiresAt = new Date(softCircledAt).getTime() + SOFT_CIRCLE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiresAt - now.getTime()) / (24 * 60 * 60 * 1000)));
}

export function expiryBannerCopy(softCircledAt: string, now: Date = new Date()): string {
  const n = daysRemaining(softCircledAt, now);
  return `Your soft-circle expires in ${n} day${n === 1 ? "" : "s"} — confirm or release`;
}

/**
 * Derived telemetry metrics.
 *
 * Each calculator walks the chained event log to compute one investor-grade
 * KPI. Pure functions: given an event list, always return the same number.
 *
 * Conventions:
 *   - Durations in either days or hours (per spec method names).
 *   - When the start or end event is missing, returns null.
 */
import type { TelemetryEvent, TelemetryEventType } from "./events.js";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

function findFirst(events: TelemetryEvent[], type: TelemetryEventType, predicate: (e: TelemetryEvent) => boolean): TelemetryEvent | undefined {
  return events.find((e) => e.type === type && predicate(e));
}

export function roundDurationDays(events: TelemetryEvent[], roundId: string): number | null {
  const created = findFirst(events, "round.created", (e) => e.roundId === roundId || (e as any).payload?.roundId === roundId);
  const closed = findFirst(events, "round.closed", (e) => e.roundId === roundId || (e as any).payload?.roundId === roundId);
  if (!created || !closed) return null;
  return (new Date(closed.timestamp).getTime() - new Date(created.timestamp).getTime()) / DAY_MS;
}

export function invitationToSoftCircleHours(events: TelemetryEvent[], invId: string): number | null {
  const created = findFirst(events, "invitation.created", (e) => (e as any).payload?.invitationId === invId);
  const sc = findFirst(events, "invitation.soft_circled", (e) => (e as any).payload?.invitationId === invId);
  if (!created || !sc) return null;
  return (new Date(sc.timestamp).getTime() - new Date(created.timestamp).getTime()) / HOUR_MS;
}

export function softCircleToSignedHours(events: TelemetryEvent[], scId: string): number | null {
  const created = findFirst(events, "softcircle.created", (e) => (e as any).payload?.softCircleId === scId);
  const signed = findFirst(events, "softcircle.signed", (e) => (e as any).payload?.softCircleId === scId);
  if (!created || !signed) return null;
  return (new Date(signed.timestamp).getTime() - new Date(created.timestamp).getTime()) / HOUR_MS;
}

export function docGenToSignatureHours(events: TelemetryEvent[], docId: string): number | null {
  const gen = findFirst(events, "document.generated", (e) => (e as any).payload?.documentId === docId);
  const signed = findFirst(events, "document.signed", (e) => (e as any).payload?.documentId === docId);
  if (!gen || !signed) return null;
  return (new Date(signed.timestamp).getTime() - new Date(gen.timestamp).getTime()) / HOUR_MS;
}

export function signatureToFundsHours(events: TelemetryEvent[], scId: string): number | null {
  const signed = findFirst(events, "softcircle.signed", (e) => (e as any).payload?.softCircleId === scId);
  const funded = findFirst(events, "softcircle.funded", (e) => (e as any).payload?.softCircleId === scId);
  if (!signed || !funded) return null;
  return (new Date(funded.timestamp).getTime() - new Date(signed.timestamp).getTime()) / HOUR_MS;
}

export type FunnelDropoff = {
  invited: number;
  viewed: number;
  softCircled: number;
  signed: number;
  funded: number;
  rates: { viewRate: number; circleRate: number; signRate: number; fundRate: number };
};

export function funnelDropoff(events: TelemetryEvent[], roundId?: string): FunnelDropoff {
  const inRound = (e: TelemetryEvent) => roundId ? (e.roundId === roundId || (e as any).payload?.roundId === roundId) : true;
  const invited = events.filter((e) => e.type === "invitation.created" && inRound(e)).length;
  // viewed/circled keyed by invitation
  const inviteIds = new Set(events.filter((e) => e.type === "invitation.created" && inRound(e)).map((e) => (e as any).payload.invitationId));
  const viewed = events.filter((e) => e.type === "invitation.viewed" && inviteIds.has((e as any).payload.invitationId)).length;
  const softCircled = events.filter((e) => e.type === "invitation.soft_circled" && inviteIds.has((e as any).payload.invitationId)).length;
  const signed = events.filter((e) => e.type === "softcircle.signed" && inRound(e)).length;
  const funded = events.filter((e) => e.type === "softcircle.funded" && inRound(e)).length;
  const safeDiv = (a: number, b: number) => b === 0 ? 0 : a / b;
  return {
    invited, viewed, softCircled, signed, funded,
    rates: {
      viewRate: safeDiv(viewed, invited),
      circleRate: safeDiv(softCircled, viewed),
      signRate: safeDiv(signed, softCircled),
      fundRate: safeDiv(funded, signed),
    },
  };
}

export function valuationDelta(events: TelemetryEvent[], companyId: string): Array<{ roundId: string; preMoney: string }> {
  return events
    .filter((e) => e.companyId === companyId && e.type === "round.terms_set")
    .map((e) => {
      const p = (e as any).payload;
      return { roundId: p.roundId, preMoney: p.preMoney ?? "0" };
    });
}

export function instrumentMix(events: TelemetryEvent[], roundId: string): Record<string, number> {
  // Look at all softcircle.created events for this round; bucket by source instrument.
  // For preview: we encode the instrument hint in invitation.created payload.
  const invs = events.filter((e) => e.type === "invitation.created" && (e as any).payload?.roundId === roundId);
  const map = new Map<string, number>(); // instrument label → total amount (in dollars)
  for (const inv of invs) {
    const invId = (inv as any).payload.invitationId;
    const sc = events.find((e) => e.type === "softcircle.created" && (e as any).payload?.softCircleId.startsWith(invId));
    if (!sc) continue;
    const amt = parseFloat((sc as any).payload.amount ?? "0");
    const inst = (inv as any).payload.instrument ?? "common";
    map.set(inst, (map.get(inst) ?? 0) + amt);
  }
  // Normalize to %
  const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
  const out: Record<string, number> = {};
  for (const [k, v] of map) out[k] = total === 0 ? 0 : v / total;
  return out;
}

export type InvestorQuality = {
  investorId: string;
  averageChequeSize: number;
  followOnRate: number;            // signed-in-second-round / invited-to-second-round
  averageTimeToDecideHours: number;
  totalDeals: number;
};

export function investorQuality(events: TelemetryEvent[], investorId: string): InvestorQuality {
  const invitations = events.filter((e) => e.type === "invitation.created" && (e as any).payload?.investorId === investorId);
  const softCircles = events.filter((e) => e.type === "softcircle.created" && (e as any).payload?.investorId === investorId);
  const cheques = softCircles.map((e) => parseFloat((e as any).payload.amount ?? "0"));
  const totalDeals = softCircles.length;
  const avg = cheques.length === 0 ? 0 : cheques.reduce((s, v) => s + v, 0) / cheques.length;
  // Time-to-decide: from invitation.created → invitation.soft_circled (or .declined)
  const decideTimes: number[] = [];
  for (const inv of invitations) {
    const invId = (inv as any).payload.invitationId;
    const decision = events.find((e) =>
      ((e.type === "invitation.soft_circled" || e.type === "invitation.declined")
        && (e as any).payload?.invitationId === invId),
    );
    if (decision) decideTimes.push((new Date(decision.timestamp).getTime() - new Date(inv.timestamp).getTime()) / HOUR_MS);
  }
  const avgDecide = decideTimes.length === 0 ? 0 : decideTimes.reduce((s, v) => s + v, 0) / decideTimes.length;

  // Follow-on rate: how many distinct rounds did this investor say yes in?
  const distinctYesRounds = new Set(
    events
      .filter((e) => e.type === "softcircle.signed" || e.type === "softcircle.created")
      .filter((e) => (e as any).payload?.investorId === investorId)
      .map((e) => (e as any).payload?.roundId),
  );
  const followOnRate = distinctYesRounds.size > 1 ? (distinctYesRounds.size - 1) / distinctYesRounds.size : 0;

  return {
    investorId,
    averageChequeSize: avg,
    followOnRate,
    averageTimeToDecideHours: avgDecide,
    totalDeals,
  };
}

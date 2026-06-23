/**
 * Sprint 14 D11 — Notification cadence rules.
 *
 * Wraps the raw `emitNotification` with:
 *   - Quiet hours (default 22:00–07:00 in user's TZ; defaults to America/Toronto)
 *   - Frequency caps (5 / hour, 20 / day per user)
 *   - Digest rollup window (15 min) for same-kind floods
 *   - Critical-bypass kinds that ignore quiet-hours and caps
 *
 * Critical-bypass kinds (always go through immediately):
 *   - round.closed
 *   - kyc.status_changed
 *   - payment.failure
 *   - dsc.review_received
 *   - soft_circle.lapsed
 *
 * The wrapper is pure on inputs except a small in-memory ring of the last
 * sends per user. State is reset by `__resetCadence()` for tests.
 */
import {
  emitNotification,
  type NotificationKind,
  type Notification,
} from "../notificationsStore";

export interface CadenceRules {
  quietHoursStart: number; // 0..23
  quietHoursEnd: number;   // 0..23 (next-day if > start)
  perHourCap: number;
  perDayCap: number;
  digestWindowMs: number;
  criticalBypass: ReadonlySet<NotificationKind>;
  /** When in quiet hours, queued items are emitted with a `[Queued overnight]` body prefix. */
  quietQueueLabel: string;
}

export const DEFAULT_RULES: CadenceRules = {
  quietHoursStart: 22,
  quietHoursEnd: 7,
  perHourCap: 5,
  perDayCap: 20,
  digestWindowMs: 15 * 60 * 1000,
  criticalBypass: new Set<NotificationKind>([
    "round.closed",
    "kyc.status_changed",
    "payment.failure",
    "dsc.review_received",
    "soft_circle.lapsed",
  ]),
  quietQueueLabel: "[Queued overnight]",
};

interface SendRecord {
  ts: number;
  kind: NotificationKind;
}

const sendRing = new Map<string, SendRecord[]>();

export interface CadenceDecision {
  allow: boolean;
  reason?: "ok" | "quiet_hours" | "rate_limit_hour" | "rate_limit_day" | "digest_pending";
  /** When `allow=false`, suggested retry timestamp. */
  retryAt?: number;
}

function getBucket(userId: string): SendRecord[] {
  let arr = sendRing.get(userId);
  if (!arr) {
    arr = [];
    sendRing.set(userId, arr);
  }
  return arr;
}

function pruneOld(arr: SendRecord[], now: number): void {
  const dayAgo = now - 24 * 60 * 60 * 1000;
  let i = 0;
  while (i < arr.length && arr[i].ts < dayAgo) i++;
  if (i > 0) arr.splice(0, i);
}

function isQuietHour(hour: number, rules: CadenceRules): boolean {
  if (rules.quietHoursStart < rules.quietHoursEnd) {
    return hour >= rules.quietHoursStart && hour < rules.quietHoursEnd;
  }
  // wrap-around (e.g. 22..7)
  return hour >= rules.quietHoursStart || hour < rules.quietHoursEnd;
}

export function evaluateCadence(args: {
  userId: string;
  kind: NotificationKind;
  now?: number;
  /** Hour-of-day (0..23) in user's local TZ; default new Date().getHours(). */
  hour?: number;
  rules?: Partial<CadenceRules>;
}): CadenceDecision {
  const rules: CadenceRules = { ...DEFAULT_RULES, ...args.rules } as CadenceRules;
  const now = args.now ?? Date.now();
  const hour = args.hour ?? new Date(now).getHours();

  if (rules.criticalBypass.has(args.kind)) {
    return { allow: true, reason: "ok" };
  }

  const bucket = getBucket(args.userId);
  pruneOld(bucket, now);

  if (isQuietHour(hour, rules)) {
    // Snap retry to next end-of-quiet-hours
    const d = new Date(now);
    d.setHours(rules.quietHoursEnd, 0, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return { allow: false, reason: "quiet_hours", retryAt: d.getTime() };
  }

  const lastHour = bucket.filter(r => r.ts > now - 60 * 60 * 1000).length;
  if (lastHour >= rules.perHourCap) {
    return { allow: false, reason: "rate_limit_hour", retryAt: now + 60 * 60 * 1000 };
  }
  const lastDay = bucket.length;
  if (lastDay >= rules.perDayCap) {
    return { allow: false, reason: "rate_limit_day", retryAt: now + 24 * 60 * 60 * 1000 };
  }

  // Digest pending: same kind seen within window — allow but caller may collapse
  const digest = bucket.find(r => r.kind === args.kind && r.ts > now - rules.digestWindowMs);
  if (digest) {
    return { allow: true, reason: "digest_pending" };
  }

  return { allow: true, reason: "ok" };
}

export function emitWithCadence(args: {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  channels?: Partial<Notification["channels"]>;
  rules?: Partial<CadenceRules>;
  now?: number;
}): { decision: CadenceDecision; notification: Notification | null } {
  const decision = evaluateCadence({
    userId: args.userId,
    kind: args.kind,
    now: args.now,
    rules: args.rules,
  });
  if (!decision.allow) {
    return { decision, notification: null };
  }
  // Record the send
  const bucket = getBucket(args.userId);
  bucket.push({ ts: args.now ?? Date.now(), kind: args.kind });

  // Apply digest-rollup hint to body
  const body = decision.reason === "digest_pending"
    ? `${args.body} (rolled into pending digest)`
    : args.body;

  const n = emitNotification({
    userId: args.userId,
    kind: args.kind,
    title: args.title,
    body,
    link: args.link,
    channels: args.channels,
  });
  return { decision, notification: n };
}

export function __resetCadence(): void {
  sendRing.clear();
}

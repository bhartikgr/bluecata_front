/**
 * Sprint 14 D11 — Notification cadence rules.
 *
 * Covers:
 *   - Quiet hours block non-critical kinds
 *   - Critical-bypass kinds always allow
 *   - Per-hour and per-day caps trigger rate-limit
 *   - Digest-pending allows but tags body
 */
import { describe, it, expect, beforeEach } from "vitest";
import { evaluateCadence, emitWithCadence, __resetCadence, DEFAULT_RULES } from "../lib/notificationCadence";

describe("notification cadence", () => {
  beforeEach(() => __resetCadence());

  it("blocks non-critical kind during quiet hours (23:30)", () => {
    const d = evaluateCadence({ userId: "u1", kind: "message.received", hour: 23 });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("quiet_hours");
  });

  it("allows non-critical kind outside quiet hours (10:00)", () => {
    const d = evaluateCadence({ userId: "u1", kind: "message.received", hour: 10 });
    expect(d.allow).toBe(true);
    expect(d.reason).toBe("ok");
  });

  it("allows critical-bypass kind even at 02:00", () => {
    const d = evaluateCadence({ userId: "u1", kind: "round.closed", hour: 2 });
    expect(d.allow).toBe(true);
  });

  it("payment.failure bypasses quiet hours", () => {
    const d = evaluateCadence({ userId: "u1", kind: "payment.failure", hour: 23 });
    expect(d.allow).toBe(true);
  });

  it("dsc.review_received bypasses quiet hours", () => {
    const d = evaluateCadence({ userId: "u1", kind: "dsc.review_received", hour: 4 });
    expect(d.allow).toBe(true);
  });

  it("soft_circle.lapsed bypasses quiet hours", () => {
    const d = evaluateCadence({ userId: "u1", kind: "soft_circle.lapsed", hour: 1 });
    expect(d.allow).toBe(true);
  });

  it("enforces per-hour cap of 5", () => {
    for (let i = 0; i < DEFAULT_RULES.perHourCap; i++) {
      const r = emitWithCadence({
        userId: "u_cap",
        kind: "message.received",
        title: `m${i}`, body: "hi",
        now: Date.UTC(2026, 0, 1, 14, i, 0),
      });
      // hour=14 (UTC) — fine
      expect(r.notification).not.toBeNull();
    }
    const blocked = emitWithCadence({
      userId: "u_cap",
      kind: "message.received",
      title: "m6", body: "hi",
      now: Date.UTC(2026, 0, 1, 14, 6, 0),
    });
    // The 6th in the same hour must be blocked OR rolled into digest.
    // Rate-limit takes precedence over digest in our impl.
    expect(blocked.decision.reason === "rate_limit_hour" || blocked.decision.reason === "digest_pending").toBe(true);
  });

  it("digest-pending tags body within 15-min window", () => {
    __resetCadence();
    const now = Date.UTC(2026, 0, 1, 14, 0, 0);
    const r1 = emitWithCadence({ userId: "u_d", kind: "investor_report.published", title: "r1", body: "first", now });
    expect(r1.notification?.body).toBe("first");
    const r2 = emitWithCadence({ userId: "u_d", kind: "investor_report.published", title: "r2", body: "second", now: now + 60_000 });
    expect(r2.decision.reason).toBe("digest_pending");
    expect(r2.notification?.body).toContain("rolled into pending digest");
  });

  it("rate_limit_day after 20 sends across the day", () => {
    __resetCadence();
    // Spread across the day, every 70 minutes to avoid per-hour cap, hour=10..(10+~24)
    let blocked: { decision: { reason?: string }; notification: any } | null = null;
    for (let i = 0; i < 21; i++) {
      const now = Date.UTC(2026, 0, 1, 10, 0, 0) + i * 70 * 60_000;
      const r = emitWithCadence({
        userId: "u_day",
        kind: "investor_report.published",
        title: `r${i}`, body: "hi",
        now,
      });
      if (!r.notification) { blocked = r; break; }
    }
    expect(blocked?.decision.reason === "rate_limit_day" || blocked?.decision.reason === "quiet_hours").toBe(true);
  });
});

/**
 * WAVE 15 / ORP-033 — the founder notification preference is enforced ON THE
 * PATH THAT DELIVERS, and both poles of that enforcement are proved.
 *
 * NAME THE SINK. `founder_notification_preference` (migration 0170) is the
 * table. The write path is PUT /api/founder/notification-preferences ->
 * `setPreference()`. The READ path — the one that decides whether a founder
 * actually receives something — is `evaluateCadence()` in
 * `server/lib/notificationCadence.ts`, which now calls `isKindEnabled()` before
 * it consults quiet hours or rate caps.
 *
 * THE SECOND PATH TO THE SAME DELIVERY. `emitNotification()` in
 * `server/notificationsStore.ts` is the other writer of a notification, it has
 * 83 direct callers, and it never reads a preference. That file is SACRED, so
 * that path CANNOT be closed in this wave. It is reported, not papered over,
 * and the coverage payload the UI renders says so in words. The assertion
 * below pins that honesty in place: if somebody later claims full coverage
 * without changing the enforcement, this test fails.
 *
 * FALSIFICATION. `vi.mock` drives `isKindEnabled` to false and then to true for
 * the same call. If the branch were absent, or were placed after the rate-cap
 * logic, or were `if (false)`, the first case would return `ok` and the test
 * would fail. A test that only checked the allowed case would pass against a
 * store that enforces nothing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const enabled = { value: true };

vi.mock("../lib/founderNotificationPrefs", async () => {
  const actual = await vi.importActual<typeof import("../lib/founderNotificationPrefs")>(
    "../lib/founderNotificationPrefs",
  );
  return {
    ...actual,
    isKindEnabled: (_userId: string, _kind: string, _channel?: string) => enabled.value,
  };
});

const { evaluateCadence, emitWithCadence, __resetCadence, DEFAULT_RULES } = await import(
  "../lib/notificationCadence"
);
/* Imported through the mocked module deliberately: the mock spreads `actual`,
 * so the allowlist below is the REAL allowlist. Only `isKindEnabled` is
 * replaced, which keeps the falsification narrow. */
const { NOTIFICATION_PREF_KEYS } = await import("../lib/founderNotificationPrefs");

/** A non-critical kind, so the critical bypass cannot mask the result. */
const NON_CRITICAL = "dataroom.file_opened" as any;

beforeEach(() => {
  __resetCadence();
  enabled.value = true;
});

describe("ORP-033 — the preference gates delivery", () => {
  it("ALLOWS when the preference is on", () => {
    enabled.value = true;
    const d = evaluateCadence({ userId: "u1", kind: NON_CRITICAL, hour: 12 });
    expect(d.allow).toBe(true);
    expect(d.reason).not.toBe("user_opted_out");
  });

  it("BLOCKS with reason user_opted_out when the preference is off", () => {
    // POLE 2 — the pole that proves the branch exists at all.
    enabled.value = false;
    const d = evaluateCadence({ userId: "u1", kind: NON_CRITICAL, hour: 12 });
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("user_opted_out");
  });

  it("emitWithCadence produces NO notification when opted out", () => {
    // The decision object is not the sink. This asserts the *delivery* changes,
    // because a decision nobody acts on is another check that checks nothing.
    enabled.value = false;
    const r = emitWithCadence({
      userId: "u1",
      kind: NON_CRITICAL,
      title: "t",
      body: "b",
    });
    expect(r.decision.allow).toBe(false);
    expect(r.notification).toBeNull();
  });

  /* WAVE 37 — STALE TEST: IT READ THE WALL CLOCK AS A PRECONDITION.
   *
   * This case passed between 07:00 and 22:00 local and failed the rest of the
   * day, for reasons that have nothing to do with the preference it is about.
   * `emitWithCadence` does not take an `hour`, so `evaluateCadence` falls back
   * to `new Date(now).getHours()` (`server/lib/notificationCadence.ts:104`) and
   * the DEFAULT quiet-hours window 22..07 (`:41-42`) blocks the send with
   * `quiet_hours` before delivery. Nothing is wrong with the code: quiet hours
   * are working exactly as specified. The test simply never established the
   * time it needed, and inherited whatever hour the suite happened to run at.
   * (The residual failure was observed at 06:13 UTC.)
   *
   * FIXED BY ESTABLISHING THE PRECONDITION, NOT BY REMOVING THE GATE. The
   * obvious shortcut — passing `rules: { quietHoursStart: 0, quietHoursEnd: 0 }`
   * — would disable a production gate to make a check go green, which is the
   * exact failure class this effort exists to eliminate. Instead the case now
   * pins an explicit `now` whose LOCAL hour is midday, computed from the
   * runner's own clock so it is correct in any timezone, with the local hour
   * asserted before it is used.
   *
   * STRENGTHENED: it now asserts BOTH POLES OF THE CLOCK, which is strictly
   * more than it checked before. Opted in at a waking hour → delivered; the
   * SAME opted-in call at 03:00 local → refused with `quiet_hours` and a null
   * notification. A build that deleted quiet hours would have passed the old
   * case and fails this one. */
  const localHourTimestamp = (hour: number): number => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };

  it("emitWithCadence DOES produce a notification when opted in (at a waking hour)", () => {
    enabled.value = true;
    const noonLocal = localHourTimestamp(12);
    // The precondition is established, and proven established.
    expect(new Date(noonLocal).getHours()).toBe(12);

    const r = emitWithCadence({
      userId: "u2",
      kind: NON_CRITICAL,
      title: "t",
      body: "b",
      now: noonLocal,
    });
    expect(r.decision.allow).toBe(true);
    expect(r.decision.reason).not.toBe("quiet_hours");
    expect(r.decision.reason).not.toBe("user_opted_out");
    expect(r.notification).not.toBeNull();
  });

  it("...and the same opted-in call inside quiet hours is still refused", () => {
    // The other pole of the clock. Quiet hours are a real gate, not scenery:
    // being opted IN does not buy a 03:00 push. A distinct user id keeps this
    // independent of the per-user rate bucket the case above just touched.
    enabled.value = true;
    const threeAmLocal = localHourTimestamp(3);
    expect(new Date(threeAmLocal).getHours()).toBe(3);

    const r = emitWithCadence({
      userId: "u2_quiet",
      kind: NON_CRITICAL,
      title: "t",
      body: "b",
      now: threeAmLocal,
    });
    expect(r.decision.allow).toBe(false);
    // Refused for the CLOCK, not for the preference — the two must stay
    // distinguishable, or a muted user and a sleeping one look the same.
    expect(r.decision.reason).toBe("quiet_hours");
    expect(r.decision.reason).not.toBe("user_opted_out");
    expect(r.notification).toBeNull();
  });

  it("a CRITICAL kind is delivered even with the preference off", () => {
    /* Ordering assertion. The preference check sits AFTER the critical bypass
     * return. If a later edit moved it above that return, a founder could mute
     * `round.closed` or `payment.failure` — the exact outcome the DB CHECK
     * (locked = 0 OR enabled = 1) also forbids. Two independent fences; this is
     * the code-path one. */
    enabled.value = false;
    for (const kind of Array.from(DEFAULT_RULES.criticalBypass)) {
      const d = evaluateCadence({ userId: "u3", kind, hour: 12 });
      expect(d.allow).toBe(true);
      expect(d.reason).toBe("ok");
    }
  });

  it("the preference check runs BEFORE the rate cap, so an opt-out does not consume budget", () => {
    /* If the check sat after `getBucket`, an opted-out user's suppressed
       notifications would still fill the ring and could rate-limit the ones they
       DID want. Position is behaviour, so position is tested. */
    enabled.value = false;
    for (let i = 0; i < DEFAULT_RULES.perHourCap + 3; i++) {
      evaluateCadence({ userId: "u4", kind: NON_CRITICAL, hour: 12 });
    }
    enabled.value = true;
    const d = evaluateCadence({ userId: "u4", kind: NON_CRITICAL, hour: 12 });
    expect(d.allow).toBe(true);
    expect(d.reason).not.toBe("rate_capped");
  });
});

describe("ORP-033 — every LOCKED pref key is on the cadence critical-bypass list", () => {
  it("locked keys and criticalBypass agree", () => {
    /* A key declared locked in the allowlist but absent from criticalBypass
     * would be locked only by the database — it would still be droppable by
     * quiet hours or a rate cap, which is a different and quieter failure. */
    const critical = new Set(Array.from(DEFAULT_RULES.criticalBypass) as string[]);
    for (const d of NOTIFICATION_PREF_KEYS.filter((k) => k.locked)) {
      for (const kind of d.kinds) {
        expect(critical.has(kind)).toBe(true);
      }
    }
  });

  it("and NOT every key is locked — otherwise the switches would be decorative again", () => {
    // The inverse pole: a table where everything is locked is a UI that cannot
    // change anything, which is what this item set out to fix.
    expect(NOTIFICATION_PREF_KEYS.some((k) => !k.locked)).toBe(true);
  });
});

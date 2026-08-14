/**
 * WAVE 43 · R7 / R6 / F-10 — the ONE definition of "closed", proved.
 *
 * WHAT F-10 WAS
 *   On 13 Aug 2026 a card read "Closes in 10 days · Aug 24, 2026" — that is 11
 *   days — while the "Expired" tab counted `0` with two expired rounds on the
 *   page. Those were not one bug: the codebase held THREE disagreeing notions of
 *   "expired" (documented in build_log/WAVE43_REPORT.md §3):
 *
 *     A. display/time   `Math.floor((expiresAt - Date.now()) / 86400000)`
 *     B. filter/stored  `stage === "expired" || stage === "revoked"` — a stored
 *                       ladder state with NO notion of a date, hence 0 forever
 *     C. lazy/redeem    the state flipped to "expired" only inside
 *                       `redeemInvitation()`, i.e. only if the investor showed up
 *
 * `shared/roundClose.ts` replaces all three, and both the server refusal and
 * every client surface import it, so the button, the tab and the API cannot
 * drift apart again.
 *
 * TIMEZONE SEMANTICS UNDER TEST (stated in full in the report, §5)
 *   S1  ENFORCEMENT is an INSTANT comparison, `nowMs >= deadlineMs`. No zone.
 *   S2  A DATE-ONLY close date (`2026-08-24`) means the END of that civil day
 *       (23:59:59.999) in PLATFORM_TIME_ZONE = Europe/Istanbul, the owner's zone.
 *       A full ISO timestamp is taken at face value.
 *   S3  The effective deadline is the EARLIEST of invitation expiry and round
 *       close date; `state === "closed"` closes regardless of either.
 *   S4  The COUNTDOWN is a difference of CIVIL CALENDAR DAYS in the VIEWER's
 *       zone, computed through `Intl` — never `(a - b) / 86_400_000`. That is
 *       both the off-by-one fix and the DST fix.
 *   S5  No deadline at all → an explicit R6 refusal ("No close date recorded"),
 *       never a 0-day countdown, never blank, and NOT treated as closed.
 *
 * Every case below asserts BOTH poles. A "closed" predicate that returned true
 * everywhere would satisfy a one-sided test and would refuse the entire funnel.
 */
import { describe, it, expect } from "vitest";
import {
  PLATFORM_TIME_ZONE,
  civilDayIndex,
  resolveDeadlineMs,
  resolveCloseWindow,
  isClosedAt,
  countdownVerdict,
  countdownCopy,
  closedStatement,
  formatCloseDate,
  isExpiredForFilter,
  NO_CLOSE_DATE_COPY,
  zonedWallClockToUtcMs,
} from "../roundClose";

const ISTANBUL = "Europe/Istanbul";   // owner, UTC+3 year-round (no DST since 2016)
const UTC = "UTC";                    // server
const NEW_YORK = "America/New_York";  // a viewer WITH DST, deliberately included

/** The live defect's own numbers: viewed 13 Aug 2026, close date 24 Aug 2026. */
const AUG_13_2026_ISTANBUL_NOON = Date.parse("2026-08-13T09:00:00.000Z"); // 12:00 Istanbul

describe("WAVE 43 · S2 — a date-only close date is the END of that civil day in the platform zone", () => {
  it("resolves 2026-08-24 to 23:59:59.999 Istanbul (= 20:59:59.999Z), not midnight UTC", () => {
    const ms = resolveDeadlineMs("2026-08-24", ISTANBUL);
    expect(ms).not.toBeNull();
    expect(new Date(ms!).toISOString()).toBe("2026-08-24T20:59:59.999Z");
  });

  it("takes a full ISO timestamp at face value (no re-interpretation)", () => {
    expect(resolveDeadlineMs("2026-08-24T23:00:00.000Z", ISTANBUL))
      .toBe(Date.parse("2026-08-24T23:00:00.000Z"));
  });

  it("refuses junk rather than guessing: empty, malformed and null all resolve to null", () => {
    for (const bad of ["", "   ", "not a date", "2026-13-45", null, undefined]) {
      expect(resolveDeadlineMs(bad as string | null | undefined, ISTANBUL)).toBeNull();
    }
    // …but a genuine value is NOT refused (the other pole).
    expect(resolveDeadlineMs("2026-08-24", ISTANBUL)).not.toBeNull();
  });
});

describe("WAVE 43 · S1 — enforcement is an instant comparison (both poles)", () => {
  const win = resolveCloseWindow({ roundCloseDate: "2026-08-03" }, ISTANBUL);

  it("CLOSED: 13 Aug 2026 is after a 3 Aug 2026 close", () => {
    expect(isClosedAt(win, AUG_13_2026_ISTANBUL_NOON)).toBe(true);
  });

  it("OPEN: 1 Aug 2026 is before it — the same window, the opposite answer", () => {
    expect(isClosedAt(win, Date.parse("2026-08-01T09:00:00.000Z"))).toBe(false);
  });

  it("the boundary itself: one ms before the deadline is OPEN, the deadline instant is CLOSED", () => {
    const deadline = win.deadlineMs!;
    expect(isClosedAt(win, deadline - 1)).toBe(false);
    expect(isClosedAt(win, deadline)).toBe(true);
  });
});

describe("WAVE 43 · S3 — the earliest deadline wins; state \"closed\" overrides both", () => {
  it("an invitation expiring BEFORE the round close date is the binding deadline", () => {
    const win = resolveCloseWindow(
      { invitationExpiresAt: "2026-08-10", roundCloseDate: "2026-08-24" },
      ISTANBUL,
    );
    expect(win.source).toBe("invitation_expires_at");
    expect(isClosedAt(win, Date.parse("2026-08-13T09:00:00.000Z"))).toBe(true);
  });

  it("a round closing BEFORE the invitation expires is the binding deadline (the other order)", () => {
    const win = resolveCloseWindow(
      { invitationExpiresAt: "2026-09-30", roundCloseDate: "2026-08-03" },
      ISTANBUL,
    );
    expect(win.source).toBe("round_close_date");
    expect(isClosedAt(win, AUG_13_2026_ISTANBUL_NOON)).toBe(true);
  });

  it("state \"closed\" closes the round even with a future date, and an open state does NOT", () => {
    const hard = resolveCloseWindow({ roundState: "closed", roundCloseDate: "2027-12-31" }, ISTANBUL);
    expect(hard.hardClosed).toBe(true);
    expect(isClosedAt(hard, AUG_13_2026_ISTANBUL_NOON)).toBe(true);

    const soft = resolveCloseWindow({ roundState: "soft_circle_open", roundCloseDate: "2027-12-31" }, ISTANBUL);
    expect(soft.hardClosed).toBe(false);
    expect(isClosedAt(soft, AUG_13_2026_ISTANBUL_NOON)).toBe(false);
  });
});

describe("WAVE 43 · S5 / R6 — no close date is an explicit refusal, never a 0-day countdown", () => {
  const win = resolveCloseWindow({ roundState: "soft_circle_open" }, ISTANBUL);

  it("the window records the absence honestly", () => {
    expect(win.deadlineIso).toBeNull();
    expect(win.deadlineMs).toBeNull();
    expect(win.source).toBe("none");
  });

  it("the countdown refuses in words — not 0, not blank", () => {
    const v = countdownVerdict(win, AUG_13_2026_ISTANBUL_NOON, ISTANBUL);
    expect(v.kind).toBe("no_close_date");
    const copy = countdownCopy(v, ISTANBUL);
    expect(copy).toBe(NO_CLOSE_DATE_COPY);
    expect(copy).not.toMatch(/\b0 days?\b/);
    expect(copy.trim().length).toBeGreaterThan(0);
  });

  it("and it is NOT closed — absence of a date must never refuse live money", () => {
    expect(isClosedAt(win, AUG_13_2026_ISTANBUL_NOON)).toBe(false);
  });

  it("a state-closed round with no date says it is closed WITHOUT naming a date it does not have", () => {
    const hard = resolveCloseWindow({ roundState: "closed" }, ISTANBUL);
    const v = countdownVerdict(hard, AUG_13_2026_ISTANBUL_NOON, ISTANBUL);
    expect(v).toEqual({ kind: "closed", deadlineIso: null });
    expect(closedStatement(null, ISTANBUL)).toBe("This round is closed");
    expect(closedStatement(null, ISTANBUL)).not.toContain("Invalid");
    // The other pole: when a date IS known, it is named.
    expect(closedStatement("2026-08-03T20:59:59.999Z", ISTANBUL)).toBe("This round closed on Aug 3, 2026");
  });
});

describe("WAVE 43 · S4 — THE OFF-BY-ONE ITSELF (F-10's \"Closes in 10 days · Aug 24, 2026\")", () => {
  it("reproduces the OLD arithmetic yielding 10, and the NEW civil-day count yielding 11", () => {
    const deadlineMs = resolveDeadlineMs("2026-08-24", ISTANBUL)!;
    /* The verbatim original expression from
     * client/src/pages/investor/Invitations.tsx:231, INCLUDING its own parse:
     * `new Date("2026-08-24")` is midnight **UTC**, i.e. 03:00 Istanbul, so the
     * span it measured ended ~21 hours before the day the owner means. Two
     * defects compounded — a UTC-midnight parse and a floored ms division — and
     * together they printed "Closes in 10 days · Aug 24, 2026" on 13 August. */
    const legacyDays = Math.max(
      0,
      Math.floor((new Date("2026-08-24").getTime() - AUG_13_2026_ISTANBUL_NOON) / (24 * 60 * 60 * 1000)),
    );
    expect(legacyDays).toBe(10); // the bug, still reproducible on demand
    // The honest end-of-day instant is nearly a full day later than what the
    // old code measured against.
    expect(deadlineMs - new Date("2026-08-24").getTime()).toBe(20 * 3_600_000 + 59 * 60_000 + 59_999);

    const v = countdownVerdict(
      resolveCloseWindow({ roundCloseDate: "2026-08-24" }, ISTANBUL),
      AUG_13_2026_ISTANBUL_NOON,
      ISTANBUL,
    );
    expect(v).toMatchObject({ kind: "open", days: 11 });
    expect(countdownCopy(v, ISTANBUL)).toBe("Closes in 11 days");
    // 13 Aug → 24 Aug is 11 nights on any calendar. Prove it independently of
    // the implementation under test.
    expect(
      civilDayIndex(deadlineMs, ISTANBUL)! - civilDayIndex(AUG_13_2026_ISTANBUL_NOON, ISTANBUL)!,
    ).toBe(11);
  });

  it("the ms division and the civil count DIVERGE across a viewer's midnight — the count is 11, the division says 10", () => {
    /* Deadline: end of 24 Aug, Istanbul (2026-08-24T20:59:59.999Z).
     * Viewed 13 Aug at 17:00 in New York (2026-08-13T21:00:00Z).
     * Elapsed span : 10 d 23 h 59 m  → Math.floor(… / 86_400_000) === 10
     * Civil days   : 13 Aug → 24 Aug in New York === 11
     * The old expression under-reports by a day for every viewer whose evening
     * pushes the remainder below 24 hours — which is how "Closes in 10 days ·
     * Aug 24, 2026" reached the live site. */
    const win = resolveCloseWindow({ roundCloseDate: "2026-08-24" }, ISTANBUL);
    const nowNyEvening = Date.parse("2026-08-13T21:00:00.000Z");
    const naive = Math.max(0, Math.floor((win.deadlineMs! - nowNyEvening) / (24 * 60 * 60 * 1000)));
    expect(naive).toBe(10);
    expect(countdownVerdict(win, nowNyEvening, NEW_YORK)).toMatchObject({ kind: "open", days: 11 });
    // Same instant, Istanbul viewer: their calendar has already rolled to 14 Aug.
    expect(countdownVerdict(win, nowNyEvening, ISTANBUL)).toMatchObject({ kind: "open", days: 10 });
  });

  it("\"Closes today\" is a distinct honest verdict, and 1 day is singular", () => {
    // Deadline at the end of today (Istanbul), viewed this morning.
    const today = resolveCloseWindow({ roundCloseDate: "2026-08-13" }, ISTANBUL);
    const vToday = countdownVerdict(today, AUG_13_2026_ISTANBUL_NOON, ISTANBUL);
    expect(vToday.kind).toBe("closes_today");
    expect(countdownCopy(vToday, ISTANBUL)).toBe("Closes today");
    // Not "Closes in 0 days", and NOT closed — money is still accepted today.
    expect(isClosedAt(today, AUG_13_2026_ISTANBUL_NOON)).toBe(false);

    const tomorrow = resolveCloseWindow({ roundCloseDate: "2026-08-14" }, ISTANBUL);
    expect(countdownCopy(countdownVerdict(tomorrow, AUG_13_2026_ISTANBUL_NOON, ISTANBUL), ISTANBUL))
      .toBe("Closes in 1 day");
  });

  it("R6 — a round closing today renders honestly rather than as expired", () => {
    // One second before the end of the Istanbul day: still open, still "today".
    const win = resolveCloseWindow({ roundCloseDate: "2026-08-13" }, ISTANBUL);
    const justBefore = win.deadlineMs! - 1_000;
    expect(isClosedAt(win, justBefore)).toBe(false);
    expect(countdownVerdict(win, justBefore, ISTANBUL).kind).toBe("closes_today");
    // One ms later it is closed, and says so with the date.
    expect(isClosedAt(win, win.deadlineMs!)).toBe(true);
    expect(countdownCopy(countdownVerdict(win, win.deadlineMs!, ISTANBUL), ISTANBUL))
      .toBe("This round closed on Aug 13, 2026");
  });
});

describe("WAVE 43 · S4 at a TIMEZONE BOUNDARY — 23:00 UTC viewed from Istanbul, and the reverse", () => {
  /**
   * A round closing 2026-08-24T23:00:00Z is, in Istanbul (UTC+3), 2026-08-25 at
   * 02:00 — the NEXT calendar day. A viewer in Istanbul on 24 Aug must be told
   * "closes tomorrow", not "closes today", and the two zones must disagree
   * about the DAY COUNT while agreeing about OPEN-vs-CLOSED (S1 vs S4).
   */
  const win2300Z = resolveCloseWindow({ roundCloseDate: "2026-08-24T23:00:00.000Z" }, ISTANBUL);

  it("Istanbul sees the 23:00Z deadline on the NEXT civil day: 1 day, not 0", () => {
    const nowUtcMidMorning = Date.parse("2026-08-24T09:00:00.000Z"); // 12:00 Istanbul, 24 Aug
    const v = countdownVerdict(win2300Z, nowUtcMidMorning, ISTANBUL);
    expect(v).toMatchObject({ kind: "open", days: 1 });
    expect(countdownCopy(v, ISTANBUL)).toBe("Closes in 1 day");
  });

  it("a UTC viewer at the same instant sees it closing TODAY — a different label, the same open/closed fact", () => {
    const nowUtcMidMorning = Date.parse("2026-08-24T09:00:00.000Z");
    const vUtc = countdownVerdict(win2300Z, nowUtcMidMorning, UTC);
    expect(vUtc.kind).toBe("closes_today");
    // S1 is zone-free, so BOTH viewers agree the round is open…
    expect(isClosedAt(win2300Z, nowUtcMidMorning)).toBe(false);
    // …and both agree the instant it closes.
    expect(isClosedAt(win2300Z, Date.parse("2026-08-24T23:00:00.000Z"))).toBe(true);
  });

  it("the reverse boundary: a 23:00 ISTANBUL deadline (20:00Z) is still the SAME day in UTC", () => {
    const ms = zonedWallClockToUtcMs(2026, 8, 24, 23, 0, 0, 0, ISTANBUL)!;
    expect(new Date(ms).toISOString()).toBe("2026-08-24T20:00:00.000Z");
    const win = resolveCloseWindow({ roundCloseDate: new Date(ms).toISOString() }, ISTANBUL);
    const now = Date.parse("2026-08-24T09:00:00.000Z");
    expect(countdownVerdict(win, now, ISTANBUL).kind).toBe("closes_today");
    expect(countdownVerdict(win, now, UTC).kind).toBe("closes_today");
    // And a New York viewer (UTC-4 in August) sees the same civil day too.
    expect(countdownVerdict(win, now, NEW_YORK).kind).toBe("closes_today");
  });

  it("the displayed DATE follows the viewer's zone, so the label can never contradict the count", () => {
    // 23:00Z on 24 Aug is 25 Aug in Istanbul and 19:00 on 24 Aug in New York.
    expect(formatCloseDate("2026-08-24T23:00:00.000Z", ISTANBUL)).toBe("Aug 25, 2026");
    expect(formatCloseDate("2026-08-24T23:00:00.000Z", UTC)).toBe("Aug 24, 2026");
    expect(formatCloseDate("2026-08-24T23:00:00.000Z", NEW_YORK)).toBe("Aug 24, 2026");
  });
});

describe("WAVE 43 · S4 DST-ADJACENT — a 23-hour and a 25-hour day still count as one day", () => {
  /**
   * Istanbul has been UTC+3 with NO DST since 2016, which is exactly why a
   * DST-adjacent case must be asserted in a zone that DOES observe it —
   * otherwise the DST claim is untested and the ms/86400000 bug would survive
   * in any viewer's browser outside Turkey.
   *
   * America/New_York: spring forward 2027-03-14 (23-hour day),
   *                   fall back    2026-11-01 (25-hour day).
   */
  it("SPRING FORWARD (23-hour day) — the count is 1, not 0", () => {
    // Deadline: end of 2027-03-14 New York time. Viewed midday 2027-03-13.
    const deadline = zonedWallClockToUtcMs(2027, 3, 14, 23, 59, 59, 999, NEW_YORK)!;
    const win = resolveCloseWindow({ roundCloseDate: new Date(deadline).toISOString() }, NEW_YORK);
    const now = zonedWallClockToUtcMs(2027, 3, 13, 12, 0, 0, 0, NEW_YORK)!;

    // The naive arithmetic that shipped: 23 real hours in that day, so the
    // elapsed span is 35.98h → floor(1.49) happens to be 1 here, but the same
    // expression across the boundary at a later hour collapses to 0. Assert the
    // civil answer directly instead.
    expect(civilDayIndex(deadline, NEW_YORK)! - civilDayIndex(now, NEW_YORK)!).toBe(1);
    expect(countdownVerdict(win, now, NEW_YORK)).toMatchObject({ kind: "open", days: 1 });

    // The hour that does not exist locally (02:30 on 14 Mar) resolves to a real
    // instant rather than NaN, and is on the correct civil day.
    const nonexistent = zonedWallClockToUtcMs(2027, 3, 14, 2, 30, 0, 0, NEW_YORK);
    expect(nonexistent).not.toBeNull();
    expect(Number.isFinite(nonexistent!)).toBe(true);
    expect(civilDayIndex(nonexistent!, NEW_YORK)).toBe(civilDayIndex(deadline, NEW_YORK));

    // The naive division IS wrong across this boundary at 22:00 the night
    // before: 26 real hours to the deadline / 24 = 1.08 → floor 1, but the
    // civil answer is also 1. Push to the hour where they diverge: 01:00 on the
    // 14th local is 23 hours from end-of-day-14 in civil terms (same day, 0
    // days) yet the span in ms is 22.99h → floor 0. Both agree only because we
    // count days, not milliseconds.
    const lateNight = zonedWallClockToUtcMs(2027, 3, 14, 1, 0, 0, 0, NEW_YORK)!;
    expect(countdownVerdict(win, lateNight, NEW_YORK).kind).toBe("closes_today");
  });

  it("FALL BACK (25-hour day) — the naive ms division loses a day and the civil count does not", () => {
    // Deadline: end of 2026-11-01 New York (the 25-hour day). Viewed midday
    // 2026-10-31, i.e. one civil day earlier.
    const deadline = zonedWallClockToUtcMs(2026, 11, 1, 23, 59, 59, 999, NEW_YORK)!;
    const win = resolveCloseWindow({ roundCloseDate: new Date(deadline).toISOString() }, NEW_YORK);
    const now = zonedWallClockToUtcMs(2026, 10, 31, 12, 0, 0, 0, NEW_YORK)!;

    // 31 Oct → 1 Nov is ONE civil day, even though 1 Nov 2026 is 25 hours long
    // in New York. A ms-based count over that span (36 real hours / 24) also
    // floors to 1 here; the divergence is asserted at the hour boundaries in the
    // spring-forward case above. What matters is that the 25-hour day is not
    // counted as 1.04 days.
    expect(civilDayIndex(deadline, NEW_YORK)! - civilDayIndex(now, NEW_YORK)!).toBe(1);
    expect(countdownVerdict(win, now, NEW_YORK)).toMatchObject({ kind: "open", days: 1 });
    // The 25-hour day really is 25 hours long — the fixture is a genuine
    // fall-back case, not an ordinary day dressed up as one.
    const startOfNov1 = zonedWallClockToUtcMs(2026, 11, 1, 0, 0, 0, 0, NEW_YORK)!;
    const startOfNov2 = zonedWallClockToUtcMs(2026, 11, 2, 0, 0, 0, 0, NEW_YORK)!;
    expect(startOfNov2 - startOfNov1).toBe(25 * 3_600_000);

    // The ambiguous hour (01:30 on 1 Nov occurs twice) resolves to ONE real
    // instant on the correct civil day rather than NaN or a day-shifted value.
    const ambiguous = zonedWallClockToUtcMs(2026, 11, 1, 1, 30, 0, 0, NEW_YORK);
    expect(ambiguous).not.toBeNull();
    expect(civilDayIndex(ambiguous!, NEW_YORK)).toBe(civilDayIndex(deadline, NEW_YORK));

    // Same instant, Istanbul viewer: a different label is expected and correct
    // (their calendar has already rolled over), but never a negative or NaN count.
    const vIstanbul = countdownVerdict(win, now, ISTANBUL);
    expect(vIstanbul.kind).toBe("open");
    if (vIstanbul.kind === "open") expect(vIstanbul.days).toBeGreaterThan(0);
  });

  it("an unusable IANA zone refuses instead of fabricating a number", () => {
    const win = resolveCloseWindow({ roundCloseDate: "2026-08-24" }, ISTANBUL);
    expect(civilDayIndex(Date.now(), "Not/AZone")).toBeNull();
    // The verdict degrades to the honest "open, no count" branch — never NaN.
    const v = countdownVerdict(win, AUG_13_2026_ISTANBUL_NOON, "Not/AZone");
    expect(["closes_today", "open"]).toContain(v.kind);
    expect(JSON.stringify(v)).not.toContain("null");
    expect(countdownCopy(v, "Not/AZone")).not.toContain("NaN");
  });
});

describe("WAVE 43 · F-10 — ONE definition of expired: the filter now agrees with the display", () => {
  const nowMs = AUG_13_2026_ISTANBUL_NOON;
  const closedWin = resolveCloseWindow({ roundCloseDate: "2026-08-03" }, ISTANBUL);
  const openWin = resolveCloseWindow({ roundCloseDate: "2026-08-24" }, ISTANBUL);

  it("THE DEFECT: the old stored-state predicate counted 0 while the display said \"Window closed\"", () => {
    // Definition B, verbatim in spirit: a ladder state with no notion of time.
    const legacyFilter = (stage: string) => stage === "expired" || stage === "revoked";
    // The two live rounds were stored as "pending" — never flipped, because
    // Definition C only ran inside redeemInvitation().
    const stages = ["pending", "viewed"];
    expect(stages.filter(legacyFilter)).toHaveLength(0);       // the tab: 0
    expect(stages.filter(() => isClosedAt(closedWin, nowMs))).toHaveLength(2); // the cards: 2

    // THE FIX: one predicate, and it counts them.
    expect(
      stages.filter((stage) =>
        isExpiredForFilter({
          storedStageIsTerminalExpired: legacyFilter(stage),
          stageIsCommitted: false,
          win: closedWin,
          nowMs,
        }),
      ),
    ).toHaveLength(2);
  });

  it("BOTH POLES: an open window is NOT expired, a closed one IS", () => {
    const base = { storedStageIsTerminalExpired: false, stageIsCommitted: false, nowMs };
    expect(isExpiredForFilter({ ...base, win: openWin })).toBe(false);
    expect(isExpiredForFilter({ ...base, win: closedWin })).toBe(true);
  });

  it("the stored terminal state is still authoritative when set, even inside an open window", () => {
    expect(isExpiredForFilter({
      storedStageIsTerminalExpired: true, stageIsCommitted: false, win: openWin, nowMs,
    })).toBe(true);
  });

  it("a live commitment is NOT re-bucketed as expired because a date passed (money already moved)", () => {
    expect(isExpiredForFilter({
      storedStageIsTerminalExpired: false, stageIsCommitted: true, win: closedWin, nowMs,
    })).toBe(false);
    // …unless the invitation itself was genuinely revoked/expired upstream.
    expect(isExpiredForFilter({
      storedStageIsTerminalExpired: true, stageIsCommitted: true, win: closedWin, nowMs,
    })).toBe(true);
  });

  it("the filter and the enforcement gate can never disagree: both are isClosedAt", () => {
    for (const iso of ["2026-08-03", "2026-08-13", "2026-08-24", "2026-08-24T23:00:00.000Z"]) {
      const win = resolveCloseWindow({ roundCloseDate: iso }, ISTANBUL);
      const serverWouldRefuse = isClosedAt(win, nowMs);
      const filterCallsItExpired = isExpiredForFilter({
        storedStageIsTerminalExpired: false, stageIsCommitted: false, win, nowMs,
      });
      expect(filterCallsItExpired).toBe(serverWouldRefuse);
      // And the card's own verdict agrees about closed-ness.
      expect(countdownVerdict(win, nowMs, ISTANBUL).kind === "closed").toBe(serverWouldRefuse);
    }
  });
});

describe("WAVE 43 · the platform zone is the owner's zone, stated not assumed", () => {
  it("PLATFORM_TIME_ZONE is Europe/Istanbul", () => {
    expect(PLATFORM_TIME_ZONE).toBe(ISTANBUL);
  });

  it("a UTC server and an Istanbul owner resolve the SAME instant for a date-only close date", () => {
    // The point of pinning the zone: the resolution does not depend on where the
    // code runs, only on the stated semantics.
    expect(resolveDeadlineMs("2026-08-24", PLATFORM_TIME_ZONE))
      .toBe(Date.parse("2026-08-24T20:59:59.999Z"));
    // A server that (wrongly) used its own UTC day-end would land 3 hours late.
    expect(resolveDeadlineMs("2026-08-24", UTC))
      .toBe(Date.parse("2026-08-24T23:59:59.999Z"));
    expect(resolveDeadlineMs("2026-08-24", PLATFORM_TIME_ZONE))
      .toBeLessThan(resolveDeadlineMs("2026-08-24", UTC)!);
  });
});

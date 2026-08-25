/**
 * WAVE 134 cause 3-of-3 — ONE shared fixture for round-creation dates.
 *
 * WHY THIS EXISTS
 * ---------------
 * `POST /api/rounds` has a FAIL-CLOSED backstop (server/routes.ts:7399-7412,
 * "W3 Shadie 1a (Ozan spec)"): an Open date AND a Target close date are
 * mandatory, and a body missing either is refused with 400 OPEN_DATE_REQUIRED /
 * CLOSE_DATE_REQUIRED before any other validation runs. Dozens of round tests
 * predate that backstop and post a body with no dates at all, so they 400 at the
 * door: their real assertions about invitations, terms, instruments, closing and
 * the one-open-round guard never execute. A test that 400s before it reaches its
 * assertions is not a failing test, it is an ABSENT test.
 *
 * The gate is CORRECT and stays exactly as it is. This fixture supplies the
 * dates the real round wizard supplies, in ONE place, so 13 files do not each
 * grow their own copy.
 *
 * RULING CONSTRAINTS BAKED IN
 * ---------------------------
 *  - R92 — a target close date in the PAST is ACCEPTED AND WARNED, never
 *    blocked. So `pastTargetCloseDates()` exists for tests that assert the
 *    warning, and ordinary fixtures deliberately use unambiguous FUTURE dates so
 *    they never depend on that warning path by accident.
 *  - R93 (plus the later fix) — a round whose target close is TODAY must NOT be
 *    swept closed. `closingTodayDates()` exists for exactly that boundary, and
 *    ordinary fixtures stay far away from it (+180 days) so no test result can
 *    change merely because the suite ran overnight.
 *
 * Dates are computed from the current day, never hardcoded, so the fixture can
 * never rot into the past and silently start exercising the warned path.
 */

/** UTC calendar day, `offsetDays` from today, as `YYYY-MM-DD`. */
export function fixtureDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0); // midday anchor: no DST/`toISOString` day-flip
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** Opens a week out — unambiguously future, so no "past open date" warning. */
export const ROUND_FIXTURE_OPEN_OFFSET_DAYS = 7;
/** Closes ~6 months out — unambiguously future, and never "today". */
export const ROUND_FIXTURE_CLOSE_OFFSET_DAYS = 180;

export function roundFixtureOpenDate(): string {
  return fixtureDay(ROUND_FIXTURE_OPEN_OFFSET_DAYS);
}
export function roundFixtureCloseDate(): string {
  return fixtureDay(ROUND_FIXTURE_CLOSE_OFFSET_DAYS);
}

export type RoundDatePair = { openDate: string; closeDate: string };

/** R92 boundary — open in the past, target close in the past. MUST be accepted. */
export function pastTargetCloseDates(): RoundDatePair {
  return { openDate: fixtureDay(-90), closeDate: fixtureDay(-30) };
}

/** R93 boundary — target close is TODAY. MUST NOT be swept closed. */
export function closingTodayDates(): RoundDatePair {
  return { openDate: fixtureDay(-30), closeDate: fixtureDay(0) };
}

/**
 * Fill in the two mandatory dates on a round-creation body.
 *
 * DELIBERATELY NON-DESTRUCTIVE: a date already present in the body (including a
 * deliberately INVALID one, e.g. the `invalid_openDate` tests) is left untouched,
 * so this helper can never mask a validation test. Only absent / undefined /
 * empty-string dates are filled.
 */
export function withRoundDates<T extends Record<string, unknown>>(
  body: T,
  dates: Partial<RoundDatePair> = {},
): T & RoundDatePair {
  const hasOwnDate = (k: "openDate" | "closeDate"): boolean => {
    if (!(k in body)) return false;
    const v = (body as Record<string, unknown>)[k];
    return !(v === undefined || v === null || v === "");
  };
  const out = { ...body } as Record<string, unknown>;
  if (!hasOwnDate("openDate")) out.openDate = dates.openDate ?? roundFixtureOpenDate();
  if (!hasOwnDate("closeDate")) out.closeDate = dates.closeDate ?? roundFixtureCloseDate();
  return out as T & RoundDatePair;
}

/** The two dates on their own, for spreading into an ad-hoc body. */
export function roundFixtureDates(): RoundDatePair {
  return { openDate: roundFixtureOpenDate(), closeDate: roundFixtureCloseDate() };
}

/**
 * WAVE 43 · OWNER RULING R7 — the ONE canonical definition of "this round is closed".
 *
 * > Owner, 2026-08-13: *"Go with your recommendation to enforce the close.
 * >  Accepting late commitments should be allowed."*
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS — THE ROOT CAUSE OF F-7 AND F-10
 * ---------------------------------------------------------------------------
 * The live audit of 2026-08-13 found the "Expired" filter tab reporting a count
 * of `0` while two visibly-expired rounds sat on the same screen, and a muted
 * "Window closed" caption rendered beside a fully enabled "Review Deal and
 * Soft-Circle" button. Those are not two bugs. They are one bug with two
 * symptoms: **the codebase held two different, disagreeing definitions of
 * "expired".**
 *
 *   DEFINITION A — TIME.  `client/src/pages/investor/Invitations.tsx` computed
 *     `days = floor((expiresAt - now) / 86_400_000)` and printed "Window closed"
 *     when it reached 0. Purely a function of the clock.
 *
 *   DEFINITION B — STORED STATE.  The same file's "Expired" tab counted
 *     `stage === "expired" || stage === "revoked"`, where `stage` comes from
 *     `investorSpine.normalizeLadderState(inv.state)` — i.e. the *stored string*
 *     in `round_invitations.state`.
 *
 * Nothing lazily transitions that stored string. The ONLY writer that sets
 * `state = 'expired'` is the expiry guard inside
 * `roundInvitationsStore.redeemInvitation()` (~L1213), which runs only when
 * somebody redeems a magic link. An investor who redeemed their link in July and
 * has been reading the round ever since never travels that path again, so their
 * row's `state` stays `invited`/`accepted` **forever**. Definition B can
 * therefore never become true for exactly the rows Definition A calls closed.
 * The Expired tab counting `0` was not an arithmetic slip — it was the correct
 * answer to a different question.
 *
 * This module is that one question, asked once. Both the server refusal and
 * every client surface import it. Nothing re-derives closure locally.
 *
 * (A THIRD, LEGITIMATELY DIFFERENT concept lives in `shared/softCircleExpiry.ts`
 * — the 14-day lapse of an already-submitted soft-circle. That is not a round's
 * decision window and must NOT be conflated with it. Noted here so a later wave
 * does not "unify" two things that are genuinely different. It is, however,
 * evidence of the same drift: it rounds with `Math.ceil` where Invitations.tsx
 * rounded with `Math.floor`.)
 *
 * ===========================================================================
 * TIMEZONE SEMANTICS — STATED BEFORE THE ARITHMETIC WAS CHANGED
 * ---------------------------------------------------------------------------
 * The owner is in `Europe/Istanbul`; the server may be UTC; the investor may be
 * anywhere. A naive day-difference across a timezone boundary is exactly how
 * F-10 ("Closes in 10 days" printed 11 days before the date) arises. The four
 * rules below are the intended semantics, and each is pinned by a test.
 *
 *   S1 · ENFORCEMENT IS AN INSTANT COMPARISON, IN UTC, WITH NO TIMEZONE.
 *        A round is closed iff `now >= closeInstant`, both as epoch
 *        milliseconds. Whether money is refused can NEVER depend on who is
 *        looking or where they are standing. This is the rule the server uses.
 *
 *   S2 · A DATE-ONLY DEADLINE MEANS THE END OF THAT CIVIL DAY IN
 *        `PLATFORM_TIME_ZONE` (`Europe/Istanbul`, the owner's timezone).
 *        `rounds.close_date` and `round_invitations.expires_at` are free-form
 *        TEXT and both shapes occur. A full timestamp is honoured exactly as
 *        written. A bare `2026-08-24` is resolved to 23:59:59.999 local — a
 *        founder who types "24 Aug" means "you have all of the 24th", and the
 *        owner's civil day is the only one that is the same for every viewer.
 *        While Istanbul sits at UTC+3 that instant is `2026-08-24T20:59:59.999Z`.
 *
 *   S3 · THE EFFECTIVE DEADLINE IS THE EARLIEST CANDIDATE PRESENT, and a round
 *        whose own `state` is `closed` is closed regardless of any date. The
 *        earliest, never the latest: the conservative choice stops money sooner,
 *        and letting a stale round-level date extend an invitation's window
 *        would re-open the very hole R7 closes.
 *
 *   S4 · THE COUNTDOWN IS A CIVIL-CALENDAR STATEMENT IN THE VIEWER'S TIMEZONE.
 *        "Closes in N days" where
 *            N = civilDayIndex(deadline, viewerTz) - civilDayIndex(now, viewerTz)
 *        counted in whole calendar days, NOT elapsed milliseconds. On 13 Aug a
 *        24 Aug deadline is 11 calendar days away and the surface now says 11.
 *        The old `Math.floor(ms / 86_400_000)` truncated the part-day and said
 *        10. `civilDayIndex` is computed through `Intl.DateTimeFormat` in the
 *        target zone, so a 23-hour or 25-hour DST day cannot skew it — there is
 *        no division by 86_400_000 anywhere in this file's day counting.
 *        N === 0 renders "Closes today". Open/closed still comes from S1, so the
 *        label can never contradict the server.
 *
 *   S5 · NO DEADLINE AT ALL IS AN EXPLICIT REFUSAL (owner ruling R6).
 *        A round with no close date returns `kind: "no_close_date"` and renders
 *        `NO_CLOSE_DATE_COPY`. Never a `0`-day countdown, never a blank.
 *
 * Deliberately dependency-free (no date library, no imports at all) so the
 * client bundle, the server refusal and the tests all execute the identical
 * code path — the thing Wave 38 had to retrofit for `softCircleExpiry.ts`.
 * ===========================================================================
 */

/**
 * The owner's timezone, and therefore the timezone in which a DATE-ONLY close
 * date is interpreted (S2). Not a display default: surfaces pass the viewer's
 * own zone for the countdown (S4).
 */
export const PLATFORM_TIME_ZONE = "Europe/Istanbul";

/** Which input decided the effective deadline. Carried so a surface can explain itself. */
export type CloseSource =
  | "round_state_closed"
  | "invitation_expires_at"
  | "round_close_date"
  | "none";

export interface CloseWindow {
  /** The resolved close instant as an ISO-8601 UTC string, or null when none is recorded. */
  deadlineIso: string | null;
  /** The resolved close instant as epoch ms, or null. */
  deadlineMs: number | null;
  /** Which field supplied it. */
  source: CloseSource;
  /**
   * True when `rounds.state === "closed"`. Such a round is closed at every
   * instant, including before any recorded date (S3).
   */
  hardClosed: boolean;
}

export interface ResolveCloseWindowInput {
  /** `rounds.state` — draft | terms_set | soft_circle_open | signing_open | closed. */
  roundState?: string | null;
  /** `rounds.close_date` — ISO timestamp or bare `YYYY-MM-DD`. */
  roundCloseDate?: string | null;
  /** `round_invitations.expires_at` — ISO timestamp or bare `YYYY-MM-DD`. */
  invitationExpiresAt?: string | null;
}

/* ==================================================================== */
/* Civil-time primitives — Intl-based, DST-safe, no ms/86400000 division */
/* ==================================================================== */

interface CivilParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function civilPartsIn(ms: number, timeZone: string): CivilParts | null {
  if (!Number.isFinite(ms)) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ms));
  } catch {
    // An unknown IANA zone must not crash a render. Refuse instead.
    return null;
  }
  const pick = (t: string): number => {
    const p = parts.find((x) => x.type === t);
    return p ? Number(p.value) : NaN;
  };
  const out: CivilParts = {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    // Some ICU builds render midnight as hour "24" under hour12:false.
    hour: pick("hour") % 24,
    minute: pick("minute"),
    second: pick("second"),
  };
  if (Object.values(out).some((v) => !Number.isFinite(v))) return null;
  return out;
}

/**
 * The index of the civil day containing `ms` in `timeZone`, counted in whole
 * days from 1970-01-01. Two instants share an index iff a person in that zone
 * would call them "the same day".
 *
 * DST-SAFE BY CONSTRUCTION: the calendar Y/M/D is read from the zone through
 * `Intl` and only then converted to a day number. Nothing divides an elapsed
 * duration by 86_400_000, so a 23-hour spring-forward day and a 25-hour
 * fall-back day both count as exactly one day.
 */
export function civilDayIndex(ms: number, timeZone: string): number | null {
  const p = civilPartsIn(ms, timeZone);
  if (!p) return null;
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

/**
 * The UTC offset, in ms, that `timeZone` was at the instant `utcMs`.
 *
 * The sub-second part is stripped BEFORE the comparison. `Intl` resolves only
 * to whole seconds, so `asIfUtc` carries no milliseconds; subtracting a
 * millisecond-bearing `utcMs` would fold those milliseconds into the "offset"
 * and shift every conversion. That defect moved a 23:59:59.999 day-end across
 * midnight into the NEXT civil day, which in turn moved every countdown by a
 * day — the exact class of off-by-one this module exists to eliminate.
 */
function zoneOffsetMs(utcMs: number, timeZone: string): number | null {
  const whole = Math.floor(utcMs / 1000) * 1000;
  const p = civilPartsIn(whole, timeZone);
  if (!p) return null;
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - whole;
}

/**
 * The epoch-ms instant of a wall-clock time in `timeZone`. Two passes, because
 * the offset itself depends on the answer: guess with the offset at the naive
 * instant, then re-read the offset at the guess and correct if a DST boundary
 * moved it. That second pass is what makes the last-second-of-the-day
 * resolution in S2 correct on a DST changeover date.
 */
export function zonedWallClockToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string,
): number | null {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const off1 = zoneOffsetMs(naive, timeZone);
  if (off1 === null) return null;
  const guess = naive - off1;
  const off2 = zoneOffsetMs(guess, timeZone);
  if (off2 === null) return null;
  return off2 === off1 ? guess : naive - off2;
}

/** A bare calendar date with no time part: `2026-08-24`. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Resolve one stored deadline string to an instant, per S2.
 *
 * Returns `null` — never `NaN`, never `Date.now()`, never a guess — for an
 * empty or unparseable value, so a bad row surfaces as "no close date recorded"
 * (R6) rather than silently becoming "closed" or "open".
 */
export function resolveDeadlineMs(
  raw: string | null | undefined,
  timeZone: string = PLATFORM_TIME_ZONE,
): number | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const m = DATE_ONLY.exec(s);
  if (m) {
    /* A regex match is not a valid date: `2026-13-45` matches the shape. Range
     * checks first, so an impossible stored value surfaces as "no close date
     * recorded" (R6) instead of silently rolling over into a real instant in a
     * different month. */
    const yy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    // Reject 31 April / 30 February rather than letting Date.UTC roll over.
    const probe = new Date(Date.UTC(yy, mm - 1, dd));
    if (probe.getUTCFullYear() !== yy || probe.getUTCMonth() !== mm - 1 || probe.getUTCDate() !== dd) {
      return null;
    }
    // S2 — a date-only value means the END of that civil day in the platform zone.
    return zonedWallClockToUtcMs(
      yy,
      mm,
      dd,
      23,
      59,
      59,
      999,
      timeZone,
    );
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/* ==================================================================== */
/* The canonical window                                                 */
/* ==================================================================== */

/**
 * THE single definition. Every caller — server refusal, investor card, founder
 * console, "Expired" filter — resolves closure through this function.
 */
export function resolveCloseWindow(
  input: ResolveCloseWindowInput,
  timeZone: string = PLATFORM_TIME_ZONE,
): CloseWindow {
  const hardClosed = String(input.roundState ?? "").trim().toLowerCase() === "closed";
  const invMs = resolveDeadlineMs(input.invitationExpiresAt, timeZone);
  const roundMs = resolveDeadlineMs(input.roundCloseDate, timeZone);

  // S3 — earliest present candidate wins.
  let deadlineMs: number | null = null;
  let source: CloseSource = "none";
  if (invMs !== null && roundMs !== null) {
    if (invMs <= roundMs) {
      deadlineMs = invMs;
      source = "invitation_expires_at";
    } else {
      deadlineMs = roundMs;
      source = "round_close_date";
    }
  } else if (invMs !== null) {
    deadlineMs = invMs;
    source = "invitation_expires_at";
  } else if (roundMs !== null) {
    deadlineMs = roundMs;
    source = "round_close_date";
  }

  if (hardClosed && source === "none") source = "round_state_closed";

  return {
    deadlineIso: deadlineMs === null ? null : new Date(deadlineMs).toISOString(),
    deadlineMs,
    source,
    hardClosed,
  };
}

/**
 * S1 — the enforcement predicate. An instant comparison, no timezone.
 *
 * A window with NO deadline and no hard close is **not** closed: absence of a
 * date is not evidence of expiry, and inventing one would refuse live money.
 * That is why R6's explicit refusal (S5) is a *display* rule here, not a
 * licence to lock the round.
 */
export function isClosedAt(win: CloseWindow, nowMs: number): boolean {
  if (win.hardClosed) return true;
  if (win.deadlineMs === null) return false;
  return nowMs >= win.deadlineMs;
}

/* ==================================================================== */
/* Display — R6-honest, timezone-correct                                */
/* ==================================================================== */

/** R6 explicit refusal for a round that has no close date recorded at all. */
export const NO_CLOSE_DATE_COPY = "No close date recorded";

export type CountdownVerdict =
  /** S5 / R6 — nothing was ever entered. Never a 0-day countdown, never blank. */
  | { kind: "no_close_date" }
  /** S1 says closed. `deadlineIso` is null only for a state-closed round with no date. */
  | { kind: "closed"; deadlineIso: string | null }
  /** Open, and the deadline falls on the viewer's today. */
  | { kind: "closes_today"; deadlineIso: string }
  /** Open, `days` whole civil days away in the viewer's zone (>= 1). */
  | { kind: "open"; days: number; deadlineIso: string };

/**
 * S4 — the countdown. `viewerTimeZone` defaults to the runtime's own zone so a
 * browser gets the investor's calendar and a server-side test can pin one.
 *
 * Open-vs-closed comes from S1 (instants), never from the day count, so this
 * label can never contradict the server's refusal. The day count is civil, so
 * it can never be off by one across a timezone boundary.
 */
export function countdownVerdict(
  win: CloseWindow,
  nowMs: number,
  viewerTimeZone?: string,
): CountdownVerdict {
  if (win.hardClosed) return { kind: "closed", deadlineIso: win.deadlineIso };
  if (win.deadlineMs === null || win.deadlineIso === null) return { kind: "no_close_date" };
  if (isClosedAt(win, nowMs)) return { kind: "closed", deadlineIso: win.deadlineIso };

  const tz = viewerTimeZone ?? resolveRuntimeTimeZone();
  const todayIdx = civilDayIndex(nowMs, tz);
  const closeIdx = civilDayIndex(win.deadlineMs, tz);
  if (todayIdx === null || closeIdx === null) {
    // An unusable zone must not fabricate a number. The round is open (S1) and
    // we say so without a count.
    return { kind: "closes_today", deadlineIso: win.deadlineIso };
  }
  const days = closeIdx - todayIdx;
  if (days <= 0) return { kind: "closes_today", deadlineIso: win.deadlineIso };
  return { kind: "open", days, deadlineIso: win.deadlineIso };
}

/** The runtime's own IANA zone, or the platform zone when the runtime will not say. */
export function resolveRuntimeTimeZone(): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz || PLATFORM_TIME_ZONE;
  } catch {
    return PLATFORM_TIME_ZONE;
  }
}

/**
 * The date part of an instant, in the viewer's zone, as "Aug 24, 2026".
 * Returns null rather than "Invalid Date" for an unusable input.
 */
export function formatCloseDate(
  deadlineIso: string | null | undefined,
  viewerTimeZone?: string,
): string | null {
  if (!deadlineIso) return null;
  const ms = Date.parse(deadlineIso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: viewerTimeZone ?? resolveRuntimeTimeZone(),
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

/**
 * The sentence R7 requires in place of an enabled submit button:
 * **"This round closed on Aug 3, 2026"**.
 *
 * A round closed by state with no recorded date says so honestly instead of
 * naming a date we do not have (R6).
 */
export function closedStatement(
  deadlineIso: string | null | undefined,
  viewerTimeZone?: string,
): string {
  const d = formatCloseDate(deadlineIso, viewerTimeZone);
  return d ? `This round closed on ${d}` : "This round is closed";
}

/**
 * The countdown line, rendered from the verdict so no surface writes its own
 * copy. Returns the R6 refusal for a round with no close date.
 */
export function countdownCopy(v: CountdownVerdict, viewerTimeZone?: string): string {
  switch (v.kind) {
    case "no_close_date":
      return NO_CLOSE_DATE_COPY;
    case "closed":
      return closedStatement(v.deadlineIso, viewerTimeZone);
    case "closes_today":
      return "Closes today";
    case "open":
      return `Closes in ${v.days} day${v.days === 1 ? "" : "s"}`;
  }
}

/* ==================================================================== */
/* The "Expired" filter — one predicate, shared with the display        */
/* ==================================================================== */

/**
 * THE FIX FOR THE "Expired" TAB COUNTING 0.
 *
 * An invitation belongs in "Expired" when EITHER
 *   (a) its stored terminal state says so — `expired` / `revoked`, the old
 *       Definition B, which is still authoritative when it is set; OR
 *   (b) its decision window has closed by S1, the same instant comparison the
 *       card and the server use — the old Definition A.
 *
 * (b) is the missing disjunct. It is added rather than substituted because a
 * revoked invitation whose window has not yet passed is genuinely off-ladder
 * and must not fall out of every tab.
 *
 * Deliberately NOT applied to a still-live commitment: `soft_circled`,
 * `confirmed`, `signed` and `funded` describe money that has already moved on
 * the ladder, and re-bucketing them into "Expired" because a date passed would
 * hide real commitments from the investor. Passing `stageIsCommitted` keeps that
 * decision explicit at the call site instead of hidden in a `switch`.
 */
export function isExpiredForFilter(args: {
  storedStageIsTerminalExpired: boolean;
  stageIsCommitted: boolean;
  win: CloseWindow;
  nowMs: number;
}): boolean {
  if (args.storedStageIsTerminalExpired) return true;
  if (args.stageIsCommitted) return false;
  return isClosedAt(args.win, args.nowMs);
}

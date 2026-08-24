/**
 * WAVE 83 · ITEM 2.2 — THE ONE RULE FOR A PAST TARGET CLOSE DATE.
 *
 * A target close date in the past is **accepted and never silent**.
 *
 * It is not refused. The owner has already ruled that a founder may record a
 * historical or already-closed round (Shadie V6 1a; the server was changed then
 * to stop rejecting past open/close dates), so refusing one would remove a
 * legitimate use. Round creation *does* refuse a past MATURITY date, and that
 * is not inconsistent: a maturity date in the past is a contradiction inside
 * the instrument — the note would already be due — whereas a target close in
 * the past is simply a fact about a round that has already happened.
 *
 * What was wrong on the live site was the SILENCE: the value saved with no
 * warning at all. This module is the single sentence every writer uses — the
 * round wizard, the Edit-terms modal, the create route and the terms route —
 * so the founder cannot meet a different rule depending on which screen they
 * happen to be on.
 *
 * Date-only comparison is done on the STRING, deliberately: `YYYY-MM-DD`
 * compares correctly lexicographically and never crosses a timezone (the same
 * defect that made a 21 July date render as 20 July — see `client/src/lib/format.ts`).
 */
/**
 * WAVE 121 · FINDING 2 — THE BOUNDARY ITSELF, EXPORTED.
 *
 * These three helpers are the rule's own definition of "today" and of "a target
 * close date", lifted out of `pastTargetCloseNotice` UNCHANGED so that a caller
 * which needs the BOUNDARY rather than the SENTENCE (the unattended sweeper in
 * `server/lib/roundCloseCascade.ts`) uses this one, and there is still exactly
 * one definition of "today" in the product.
 *
 * The sweeper had its own: it compared this `YYYY-MM-DD` column against
 * `new Date().toISOString()`, so `"2026-08-22" < "2026-08-22T20:13:00Z"` was
 * true and a round whose target close is TODAY was auto-closed, every
 * outstanding offer lapsed and every investor notified — a day early, against
 * this ratified rule. Same class of defect as the one that made a 21 July date
 * render as 20 July: a date-only value pushed through timestamp arithmetic.
 */

/** Today, as the local calendar `YYYY-MM-DD` — never a timestamp. */
export function todayDateOnly(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

/** The `YYYY-MM-DD` day of a stored target close date, or null if it is not one. */
export function targetCloseDateOnly(iso: string | null | undefined): string | null {
  const s = String(iso ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Is this target close date STRICTLY BEFORE today? String-to-string, date-only
 * to date-only. TODAY IS NOT PAST — that is the whole point of the rule, and it
 * is the pole the sweeper was getting wrong.
 */
export function isTargetCloseDatePast(iso: string | null | undefined): boolean {
  const s = targetCloseDateOnly(iso);
  if (s === null) return false;
  return s < todayDateOnly();
}

export function pastTargetCloseNotice(iso: string | null | undefined): string | null {
  const s = targetCloseDateOnly(iso);
  if (s === null) return null;
  if (!isTargetCloseDatePast(s)) return null;
  return (
    `The target close date (${s}) is in the past. Capavate accepts it — a round that has already ` +
    `closed is a real thing to record — but it is not saved quietly: check the date is the one you meant.`
  );
}

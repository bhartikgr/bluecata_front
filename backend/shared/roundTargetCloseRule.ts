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
export function pastTargetCloseNotice(iso: string | null | undefined): string | null {
  const s = String(iso ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  if (s >= todayIso) return null;
  return (
    `The target close date (${s}) is in the past. Capavate accepts it — a round that has already ` +
    `closed is a real thing to record — but it is not saved quietly: check the date is the one you meant.`
  );
}

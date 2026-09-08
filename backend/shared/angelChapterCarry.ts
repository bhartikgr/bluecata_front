/**
 * shared/angelChapterCarry.ts — WAVE 340 · ITEM 2.
 *
 * THE ONE SPELLING OF "IS A CARRY RATE ACTUALLY RECORDED FOR THIS CHAPTER?".
 *
 * WHY THIS PREDICATE EXISTS AT ALL.
 * `mf_angel_chapter.carry_bps` is `INTEGER NOT NULL DEFAULT 0` and both writers
 * used to coerce absent input to 0, so a chapter created with the Carry box left
 * blank stored 0 and read back as an AGREED zero carry. Migration 0233 adds the
 * nullable companion `carry_bps_recorded`, where NULL means "nobody recorded a
 * rate" and 0 means "somebody recorded exactly 0%". Two columns means a rule for
 * combining them, and a rule stated twice is a rule that drifts — so it is stated
 * ONCE, here, in `shared/`, because the server report and the browser table both
 * need it and a browser cannot import `server/`. Same arrangement, same reason as
 * shared/spvCommittedCapital.ts (W120).
 *
 * THE RULE, IN WORDS.
 *   1. If `carry_bps_recorded` is a number, that is the rate. INCLUDING 0, which
 *      is then a real, deliberate 0% and must be shown as 0.00% — hiding it would
 *      be the same defect pointing the other way.
 *   2. Otherwise, if the legacy `carry_bps` is non-zero, that is the rate. It was
 *      recorded before migration 0233 by somebody who typed it. NOTHING IS HIDDEN
 *      by this change.
 *   3. Otherwise there is NO KNOWN RATE and this returns `null`, which renders
 *      "Not set".
 *
 * THE HONEST LIMIT OF RULE 3, STATED AND NOT HIDDEN.
 * For a row written after migration 0233, rule 3 is exactly true: the rate really
 * is not set. For a row written BEFORE it, `carry_bps = 0` may have been a
 * deliberately agreed 0% — and the data does not say which. That ambiguity is
 * PRE-EXISTING; this file does not create it and cannot resolve it without
 * guessing, so it does not try. `ensureAngelChapterCarryRecorded`
 * (server/lib/angelChapterCarrySchema.ts) COUNTS those rows and reports them as
 * `ambiguousLegacyZeroRows`.
 *
 * NEVER RETURNS 0 FOR "UNKNOWN". This follows `canonicalCommittedMinorForSpv`
 * (server/spvEngineStore.ts) and the WAVE 140 ruling that a blank Cap persists as
 * NULL rather than 0: a fabricated zero in a money column is a claim nobody made.
 */

/** The exact words the screen shows when no carry rate is recorded. */
export const ANGEL_CHAPTER_CARRY_NOT_SET_LABEL = "Not set";

/** The shape both callers already hold: a raw `mf_angel_chapter` row, or a report
 *  row that carries the same two numbers under camelCase names. */
export interface AngelChapterCarryFields {
  carry_bps?: number | null;
  carryBps?: number | null;
  carry_bps_recorded?: number | null;
  carryBpsRecorded?: number | null;
}

function finiteOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The recorded carry rate in BASIS POINTS, or `null` when no rate is recorded.
 *
 * `null` is a real answer here, not a failure: it means "not set", and the caller
 * must render words rather than a number for it.
 */
export function recordedCarryBps(row: AngelChapterCarryFields | null | undefined): number | null {
  if (!row) return null;
  const recorded = finiteOrNull(
    row.carry_bps_recorded !== undefined ? row.carry_bps_recorded : row.carryBpsRecorded,
  );
  if (recorded !== null) return recorded;
  const legacy = finiteOrNull(row.carry_bps !== undefined ? row.carry_bps : row.carryBps);
  if (legacy !== null && legacy !== 0) return legacy;
  return null;
}

/**
 * True when a value IS present in one of the two columns but is not a readable
 * number (e.g. the string "not-a-number" arriving over the wire).
 *
 * WHY THIS IS A THIRD STATE AND NOT "Not set". "Not set" is a CLAIM that nobody
 * recorded a rate. An unreadable value is not that claim: something is stored and
 * the platform cannot read it. The page has always shown an em dash for this, and
 * it keeps doing so — collapsing it into "Not set" would replace one honest
 * "unknown" with a specific, and possibly wrong, statement about the commercial
 * terms.
 */
export function carryValueIsUnreadable(row: AngelChapterCarryFields | null | undefined): boolean {
  if (!row) return false;
  const rawRecorded = row.carry_bps_recorded !== undefined ? row.carry_bps_recorded : row.carryBpsRecorded;
  if (rawRecorded !== null && rawRecorded !== undefined) return finiteOrNull(rawRecorded) === null;
  const rawLegacy = row.carry_bps !== undefined ? row.carry_bps : row.carryBps;
  if (rawLegacy !== null && rawLegacy !== undefined) return finiteOrNull(rawLegacy) === null;
  return false;
}

/** True when the platform holds a carry rate for this chapter. The negation is
 *  "Not set", not "0%". */
export function hasRecordedCarry(row: AngelChapterCarryFields | null | undefined): boolean {
  return recordedCarryBps(row) !== null;
}

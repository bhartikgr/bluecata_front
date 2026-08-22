/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 100 · ITEM 3 (R72) — A TYPED MONEY FIGURE IS CHECKED BEFORE IT IS SENT,
 * AND REFUSED IF THE WIRE CANNOT CARRY IT UNCHANGED.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT, executed by an independent reviewer
 * (`build_log/final_review_2026_08_21/reviewerA/transcripts/20_spv_parseint_probe.txt`):
 *
 *     input     9007199254740993
 *     wire      {"targetSizeMinor":9007199254740992}
 *     exact     false
 *
 * `parseInt(...)` returns a JavaScript `Number`, which is an IEEE-754 double, and
 * above 2^53 consecutive integers stop being representable — so a target size a
 * partner typed reached the server one minor unit lighter, and above 10^21 it
 * reaches it as `1e+21`, which is not a figure at all. This is the same defect
 * class Wave 86B removed from the waterfall route, on the same platform rule:
 * MONEY MUST NEVER PASS THROUGH A JavaScript `Number` (R72). It was found on
 * `client/src/pages/partner/PartnerSpvs.tsx:75` and on the identical line in
 * `PartnerFunds.tsx`, which is the one of the two that actually persists.
 *
 * WHY THIS IS A REFUSAL AND NOT A CONVERSION. The live server routes validate this
 * field with `typeof v === "number" && Number.isFinite(v)`
 * (`server/partnerRoutes.ts:180`), so sending exact decimal TEXT instead would be
 * read as "absent" and the figure would be stored as `null` — a SILENT DROP, which
 * is worse than the narrowing. Changing that validator is a server interface change
 * on a money field, of exactly the kind R72 was issued for, and it is not a
 * screen's to make unilaterally; it is recorded as an owner question
 * (`build_log/wave100/OWNER_QUESTIONS.md`, Q-W100-1). What a screen CAN do, and now
 * does, is refuse to send a figure the wire would change: the typed digits are
 * compared against the round trip, exactly, and a value that does not survive it is
 * never sent and is reported to the partner in plain words.
 *
 * NO ARITHMETIC HAPPENS HERE. The comparison is between two STRINGS. `Number(...)`
 * is called once and only to ask whether the round trip is faithful; its result is
 * used solely in the case where it is provably identical to the digits typed. There
 * is no rounding, no scaling and no currency exponent in this file.
 *
 * WHY IT IS A SEPARATE FILE. `client/src/lib/exactMoney.ts` is the display layer and
 * `W92-M-01` asserts as source text that `Number`, `parseInt` and `parseFloat`
 * appear NOWHERE in it. Putting a deliberate, single, guarded `Number(...)` there
 * would turn that pin red for the wrong reason. One rule, one implementation (R21),
 * in its own file, imported by both screens.
 */

export type WireSafeMinorUnits =
  | { ok: true; value: number }
  | { ok: false; reason: string };

export function wireSafeMinorUnits(raw: string): WireSafeMinorUnits {
  const typed = String(raw ?? "").trim();
  if (typed === "") return { ok: false, reason: "no amount was entered" };
  if (!/^\d+$/.test(typed)) {
    return {
      ok: false,
      reason:
        "an amount in minor units must be whole digits only — no thousands separators, no sign and no decimal point",
    };
  }
  /* Leading zeros are the partner's formatting, not a different number. */
  const normalised = typed.replace(/^0+(?=\d)/, "");
  const roundTrip = String(Number(normalised));
  if (roundTrip !== normalised) {
    return {
      ok: false,
      reason:
        `this amount cannot be sent without being changed: ${normalised} minor units would arrive as ` +
        `${roundTrip}, because the field is carried as a JSON number and whole numbers beyond about ` +
        `nine quadrillion cannot be held in one exactly. Capavate will not send a money figure it ` +
        `would alter on the way. Enter a smaller amount, or ask for this field to be carried as ` +
        `exact text`,
    };
  }
  return { ok: true, value: Number(normalised) };
}

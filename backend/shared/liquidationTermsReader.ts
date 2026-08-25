/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 111 — THE ONE READER OF A ROUND'S LIQUIDATION PREFERENCE, PARTICIPATION
 * AND PARTICIPATION CAP. EVERY SURFACE CONSUMES THIS FILE.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS WRONG, MEASURED BEFORE THIS FILE EXISTED
 * (`server/__tests__/w111_before_disagreement_probe.test.ts`, output pasted into
 * `build_log/wave111/W111_TESTS.md`). FOUR pieces of code interpreted the SAME two
 * stored fields — `rounds.liquidationPreference` (free text) and
 * `rounds.capParticipation` (a number) — and they did not agree:
 *
 *   · the exit-waterfall reader (`server/lib/roundStoredTerms.ts` + the refusal
 *     gate in `server/track1Routes.ts`), which reads BOTH fields and refuses with
 *     HTTP 422 when a cap is on record and unreadable, when the two sources
 *     disagree, or when a cap sits below the preference it caps;
 *   · the round-detail Terms tab, which read `capParticipation` ONLY;
 *   · the term-sheet reader (`client/src/lib/termsheet/roundNegotiatedTerms.ts`),
 *     which read both but reported a conflict as \"no cap recorded\";
 *   · the Edit-terms warning in `PATCH /api/rounds/:id/terms`, which restated the
 *     multiple/participation regexes inline and looked at no cap at all.
 *
 * MEASURED: 8 of 16 ordinary term shapes disagreed, 13 of 32 surface-to-engine
 * pairings. The two shapes the reviewer reported both reproduced exactly:
 *   · `\"1x participating, capped at 2x\"` + `capParticipation: 3` — the Terms tab
 *     printed \"participation capped at 3×\" where the engine REFUSES
 *     (`participation_cap_conflict`);
 *   · `\"1x participating, capped at 2.5x\"` with no cap key — the Terms tab printed
 *     \"no participation cap recorded\" where the engine APPLIES 2.5×.
 *
 * THE RULE THIS FILE ENFORCES. There is exactly ONE interpretation of those two
 * fields, and it produces exactly one of two outcomes:
 *   · DETERMINED — a multiple, participating or not, and a cap or an explicit
 *     \"no cap\";
 *   · NOT DETERMINED — a named reason, and NOTHING a surface may print as a term.
 * A display that parses the terms itself is the defect. Displays print
 * `describeLiquidationTerms(...)`; they do not decide anything.
 *
 * THE ENGINE IS THE REFERENCE, NOT THE OTHER WAY ROUND. The parsing below is
 * `server/lib/roundStoredTerms.ts`'s own code, MOVED rather than rewritten, and the
 * order of the refusal reasons in `decideLiquidationTerms` is the order of the
 * refusal branches in `server/track1Routes.ts`. No arithmetic and no refusal
 * CONDITION changes in this wave; what changes is that the displays now read the
 * same decision the refusal is made from.
 *
 * WHY IT LIVES IN `shared/`. It must be reachable from the browser bundle AND from
 * the server. `server/lib/roundStoredTerms.ts` cannot be imported into the client —
 * it reads the database through `roundsStore` — which is exactly the reason Wave 92
 * gave for mirroring the rules in a second file, and the mirror is what drifted.
 * Nothing here touches the database, so there is no reason for a mirror to exist.
 *
 * THE FREE-TEXT FIELD IS THE ROOT CAUSE AND IS NOT FIXED HERE. A negotiated money
 * term lives in a text box; this wave makes ONE reader authoritative over that text
 * and adds no column, because there is live data in it and the owner's rule is \"I'd
 * rather add than delete\". Structuring it properly is recorded as an open item in
 * `build_log/wave111/W111_PREFLIGHT.md`.
 *
 * NOT MONEY (R72). A liquidation multiple and a participation cap are small
 * negotiated RATIOS which this platform stores and compares as JSON numbers; money
 * is exact decimal text and is never parsed here. `Number()` appears below only on
 * those ratios, which is what the server reader this code came from already did.
 */

/** The domain of a liquidation preference multiple: `(0, 10]`. A value outside it
 *  is a typing error and not a term. */
export const LP_MULTIPLE_MAX = 10 as const;

/** The domain of a participation cap multiple: `(0, 10]`, fractions allowed
 *  (`1.5x` and `2.5x` are ordinary terms). */
export const PARTICIPATION_CAP_MAX = 10 as const;

/** The two stored fields, as any caller holds them. */
export type LiquidationTermSource = {
  /** Free text: "1x non-participating", "2x participating, capped at 3x". */
  liquidationPreference?: unknown;
  /** The round's own numeric participation-cap key. */
  capParticipation?: unknown;
};

/** WHAT IS ON RECORD. Facts only: no policy, no refusal, no display. */
export type LiquidationTermFacts = {
  multiple: number | null;
  participating: boolean | null;
  /** The stored wording verbatim, so a refusal can quote it. */
  raw: string | null;
  capMultiple: number | null;
  capRaw: string | null;
  capSource: "capParticipation" | "liquidationPreference" | null;
  /** A cap IS on record and cannot be read as a multiple in domain. */
  capUnreadable: boolean;
  /** Both sources carry a cap and the two numbers differ. */
  capConflict: boolean;
};

/** The names are the exit waterfall's own refusal names, unchanged, so a screen
 *  and a 422 cannot describe the same round differently. */
export type LiquidationTermRefusal =
  | "liquidation_term_not_on_record"
  | "participation_cap_not_readable"
  | "participation_cap_conflict"
  | "participation_cap_below_preference";

export type LiquidationTermDecision =
  | {
      readonly determined: true;
      readonly multiple: number;
      readonly participating: boolean;
      /** `null` means UNCAPPED and says so; it never means "unknown". */
      readonly capMultiple: number | null;
      readonly capSource: LiquidationTermFacts["capSource"];
      readonly raw: string | null;
    }
  | {
      readonly determined: false;
      readonly refusal: LiquidationTermRefusal;
      /** `true` when nothing at all is recorded, as opposed to recorded-but-unreadable. */
      readonly nothingRecorded: boolean;
      readonly raw: string | null;
      readonly capRaw: string | null;
      /** Present only on `participation_cap_below_preference`, where both numbers
       *  read cleanly and it is their RELATIONSHIP that cannot be honoured. */
      readonly multiple: number | null;
      readonly capMultiple: number | null;
    };

/** Parse ONE raw value as a cap multiple. `null` = not a readable multiple.
 *  Moved from `server/lib/roundStoredTerms.ts`; the write fence there and this
 *  reader are the same function, so a writer and a reader cannot disagree. */
export function parseCapMultiple(raw: unknown): number | null {
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const text = String(raw).trim();
  if (text === "") return null;
  /* One optional trailing `x`, and nothing else. `"2 x"` and `"2X"` read; `"2xx"`
     and `"x2"` do not, because a value nobody can spell is not a term. */
  const m = /^([0-9]+(?:\.[0-9]+)?)\s*[xX]?$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > PARTICIPATION_CAP_MAX) return null;
  return n;
}

/** The cap phrases that count inside the free-text field. STRICT and explicit:
 *  the word "cap" must be present, so "1x participating" is never read as a cap
 *  and a bare second multiple never becomes one. */
export const CAP_TEXT_PATTERNS: readonly RegExp[] = [
  /capp?e?d?\s*(?:at|to)\s*([0-9]+(?:\.[0-9]+)?)\s*x/i,
  /cap(?:ped)?\s*(?:of|=|:)\s*([0-9]+(?:\.[0-9]+)?)\s*x/i,
  /([0-9]+(?:\.[0-9]+)?)\s*x\s*(?:participation\s+)?cap\b/i,
];

/**
 * READ THE TWO FIELDS. Absent stays absent: nothing here substitutes a value.
 *
 * This body is `roundStoredTerms`'s, moved. The variable names, the regular
 * expressions and the `capKeyPresent` / `capTextPresent` bookkeeping are its own,
 * because the engine's behaviour is the reference and a rewrite would be a second
 * opinion about it.
 */
export function readLiquidationTermFacts(source: LiquidationTermSource): LiquidationTermFacts {
  const rawValue = source.liquidationPreference;
  const lpRaw =
    rawValue === null || rawValue === undefined || String(rawValue).trim() === ""
      ? null
      : String(rawValue).trim();
  const lp = (lpRaw ?? "").toLowerCase();

  /* Only an explicit, unambiguous statement of participation counts, and
     "non-participating" is tested BEFORE "participating" because the second is a
     substring of the first. */
  let participating: boolean | null = null;
  if (lp !== "") {
    if (/non[-\s]?participating/.test(lp)) participating = false;
    else if (/participating/.test(lp)) participating = true;
  }

  /* The multiple. `1x`, `1.5x`, `2 x` all read; `(0, 10]` is the domain. The
     leading `(^|[^0-9.])` group is load-bearing: without it the `3x` inside
     "capped at 3x" could be taken as the preference multiple. */
  let lpMultiple: number | null = null;
  if (lp !== "") {
    const m = /(^|[^0-9.])([0-9]+(?:\.[0-9]+)?)\s*x\b/.exec(lp);
    if (m) {
      const n = Number(m[2]);
      if (Number.isFinite(n) && n > 0 && n <= LP_MULTIPLE_MAX) lpMultiple = n;
    }
  }

  /* THE CAP, FROM BOTH ITS HOMES. Neither source wins: if both carry a cap and the
     numbers differ, the CONFLICT is reported. An unreadable cap is reported as
     unreadable and NEVER falls through to "no cap", because a recorded cap quietly
     modelled as uncapped overpays that class and underpays the founders. */
  let capFromKey: number | null = null;
  let capKeyPresent = false;
  let capKeyRawText: string | null = null;
  const capKeyRaw = source.capParticipation;
  if (capKeyRaw !== null && capKeyRaw !== undefined && String(capKeyRaw).trim() !== "") {
    capKeyPresent = true;
    capKeyRawText = String(capKeyRaw).trim();
    capFromKey = parseCapMultiple(capKeyRaw);
  }

  let capFromText: number | null = null;
  let capTextPresent = false;
  let capTextRawText: string | null = null;
  if (lp !== "") {
    for (const re of CAP_TEXT_PATTERNS) {
      const m = re.exec(lpRaw ?? "");
      if (!m) continue;
      capTextPresent = true;
      capTextRawText = m[0];
      const n = Number(m[1]);
      capFromText = Number.isFinite(n) && n > 0 && n <= PARTICIPATION_CAP_MAX ? n : null;
      break;
    }
    /* The word "cap" appears but no multiple can be read off it — "capped",
       "cap TBD", "capped at market". A cap IS asserted and is not readable. */
    if (
      !capTextPresent &&
      /\bcapp?e?d?\b/i.test(lp) &&
      !/uncapped/i.test(lp) &&
      /* `"valuation cap"` is a SAFE's conversion cap and a different instrument
         entirely. It is not an assertion of a PARTICIPATION cap, so it must not
         make the waterfall refuse. */
      !/valuation\s*cap/i.test(lp)
    ) {
      capTextPresent = true;
      capTextRawText = lpRaw;
      capFromText = null;
    }
  }

  let capMultiple: number | null = null;
  let capSource: LiquidationTermFacts["capSource"] = null;
  let capRaw: string | null = null;
  let capUnreadable = false;
  let capConflict = false;

  if (capKeyPresent && capTextPresent) {
    capRaw = `${capKeyRawText} / ${capTextRawText}`;
    if (capFromKey === null || capFromText === null) capUnreadable = true;
    else if (capFromKey !== capFromText) capConflict = true;
    else {
      capMultiple = capFromKey;
      capSource = "capParticipation";
    }
  } else if (capKeyPresent) {
    capRaw = capKeyRawText;
    if (capFromKey === null) capUnreadable = true;
    else {
      capMultiple = capFromKey;
      capSource = "capParticipation";
    }
  } else if (capTextPresent) {
    capRaw = capTextRawText;
    if (capFromText === null) capUnreadable = true;
    else {
      capMultiple = capFromText;
      capSource = "liquidationPreference";
    }
  }

  return {
    multiple: lpMultiple,
    participating,
    raw: lpRaw,
    capMultiple,
    capRaw,
    capSource,
    capUnreadable,
    capConflict,
  };
}

/**
 * DECIDE. The ORDER of these tests is the order of the refusal branches in
 * `server/track1Routes.ts`'s waterfall gate and must stay that way: a round whose
 * preference wording is incomplete refuses as `liquidation_term_not_on_record`
 * even if its cap is also unreadable, because that is the answer the engine gives
 * and the engine is the reference.
 */
export function decideLiquidationTerms(facts: LiquidationTermFacts): LiquidationTermDecision {
  const notDetermined = (refusal: LiquidationTermRefusal): LiquidationTermDecision => ({
    determined: false,
    refusal,
    nothingRecorded: facts.raw === null && facts.capRaw === null,
    raw: facts.raw,
    capRaw: facts.capRaw,
    multiple: facts.multiple,
    capMultiple: facts.capMultiple,
  });

  if (facts.multiple === null || facts.participating === null) {
    return notDetermined("liquidation_term_not_on_record");
  }
  if (facts.capUnreadable) return notDetermined("participation_cap_not_readable");
  if (facts.capConflict) return notDetermined("participation_cap_conflict");
  if (
    facts.capMultiple !== null &&
    facts.participating === true &&
    facts.capMultiple < facts.multiple
  ) {
    return notDetermined("participation_cap_below_preference");
  }
  return {
    determined: true,
    multiple: facts.multiple,
    participating: facts.participating,
    /* A cap recorded against a class that does NOT participate can never bind —
       the engine publishes it as inert — so the decision carries it only where it
       can move money. */
    capMultiple: facts.participating === true ? facts.capMultiple : null,
    capSource: facts.participating === true ? facts.capSource : null,
    raw: facts.raw,
  };
}

/** Read and decide in one call. This is what every surface uses. */
export function readLiquidationTerms(source: LiquidationTermSource): LiquidationTermDecision {
  return decideLiquidationTerms(readLiquidationTermFacts(source));
}

/**
 * ONE SENTENCE, IN PLAIN ENGLISH, FOR EVERY SURFACE.
 *
 * Where the terms cannot be read this NEVER contains a multiple, a participation
 * word or a cap number presented as a term: it says what is on record, in quotes,
 * and says the exit calculation refuses. That is the rule the whole wave exists
 * for — a founder must not read "capped at 3×" on one screen while the calculation
 * refuses on another.
 */
export function describeLiquidationTerms(d: LiquidationTermDecision): string {
  if (d.determined) {
    /* THE STORED WORDING IS PRINTED VERBATIM — Wave 107's rule, kept. It is what the
       founder typed and what the Edit-terms control holds, and re-phrasing it here
       is how two screens came to describe one round differently. What Wave 111
       changes is the SECOND half: the cap sentence is the ONE reader's decision,
       not this surface's own look at `capParticipation`, so it cannot claim a cap
       the exit waterfall would refuse or omit one the waterfall applies. */
    const head = d.raw ?? `${d.multiple}x ${d.participating ? "participating" : "non-participating"}`;
    if (!d.participating) return head;
    return d.capMultiple === null
      ? `${head} · no participation cap recorded`
      : `${head} · participation capped at ${d.capMultiple}× the invested amount`;
  }
  const quoted = d.raw === null ? null : `“${d.raw}”`;
  const capQuoted = d.capRaw === null ? null : `“${d.capRaw}”`;
  switch (d.refusal) {
    case "liquidation_term_not_on_record":
      return d.nothingRecorded
        ? "Not recorded on this round — record it on Edit terms so an exit can be modelled"
        : `Cannot be read${quoted ? `: this round records ${quoted}` : ""}, which does not state BOTH a ` +
          `multiple (for example “1x”) and whether the class is participating. Capavate will not guess ` +
          `either one, so the exit waterfall refuses too. Correct it on Edit terms.`;
    case "participation_cap_not_readable":
      return `Cannot be read: a participation cap is on record${capQuoted ? ` as ${capQuoted}` : ""} and it is ` +
        `not a multiple Capavate can use. It is NOT treated as “no cap”, because that would pay this class ` +
        `more than it agreed to take and the founders less. The exit waterfall refuses until it is ` +
        `corrected on Edit terms.`;
    case "participation_cap_conflict":
      return `Cannot be read: this round has TWO participation caps on record and they disagree` +
        `${capQuoted ? ` (${capQuoted})` : ""} — one in the round's cap field and one inside the ` +
        `preference wording. Capavate will not choose between two numbers the parties may have ` +
        `negotiated, because the choice moves money. The exit waterfall refuses until they agree.`;
    case "participation_cap_below_preference":
      return `Cannot be read: the participation cap on record (${d.capMultiple}×) is LOWER than the ` +
        `liquidation preference (${d.multiple}×), so honouring the cap would pay this class less than ` +
        `the money-back it negotiated. Both readings move money, so Capavate publishes neither and the ` +
        `exit waterfall refuses.`;
    /* istanbul ignore next -- exhaustive */
    default:
      return "Cannot be read — the exit waterfall refuses rather than guessing.";
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 136 · ITEM 3 (R100) — THE ONE READER OF A ROUND'S MFN, IN THE SAME FILE
 *   AS THE ONE READER OF ITS LIQUIDATION TERMS.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT, stated as `SACRED_DOC` §5.3 states it. `server/roundCarryForwardEngine.ts`
 * computed MFN as:
 *
 *     sec.sideLetter?.toLowerCase().includes("mfn") ?? sec.mfn ?? false
 *
 * `??` falls through on `null`/`undefined` ONLY. A side letter that EXISTS and does
 * not mention MFN yields boolean `false`, and `false` IS a value — so the fallback
 * to the STORED `mfn` flag was unreachable whenever a side letter existed at all,
 * and a recorded MFN read as absent. Four sites in that file carried the same
 * expression.
 *
 * WHY IT LIVES HERE AND NOT IN A NEW FILE. The rules below are
 * `server/lib/roundStoredTerms.ts:392-403`'s own truthy-flag code, MOVED, not
 * rewritten — that file now calls this function, so there is ONE interpretation and
 * not a sixteenth. A new module would have been a second home for term-reading and
 * would have repeated Wave 92's mistake (a mirror that drifts). This file is already
 * the shared home for reading a round's negotiated terms and is reachable from both
 * the browser bundle and the server.
 *
 * ABSENT IS NOT `false`. `onRecord: null` means the round records NOTHING about MFN.
 * Collapsing that to `false` is precisely the value that made the bug above
 * possible, so it is a distinct outcome the caller must handle.
 *
 * ORDER: THE FLAG FIRST. The stored `mfn` flag is a deliberate answer to a
 * question; a side letter is prose. An EXPLICIT `mfn: false` is therefore NOT
 * overridden by the word "MFN" appearing somewhere in a side letter.
 */

/** The two places a round can record MFN, as any caller holds them. */
export type MfnSource = {
  /** The round's own flag: boolean, or the strings/numbers a form control produces. */
  mfn?: unknown;
  /** Free text. Read ONLY where the flag records nothing. */
  sideLetter?: unknown;
};

export type MfnOnRecord = {
  /** `true` / `false` = recorded. `null` = NOT RECORDED — never read as "no". */
  onRecord: boolean | null;
  source: "mfn_field" | "side_letter" | null;
  /** What was read, verbatim, so a refusal or a rationale can quote it. */
  raw: string | null;
};

/** The side-letter wordings that record an MFN. `\b` on both sides so "amfnote"
 *  is not an MFN, and both spellings of "favoured" because both are typed. */
const MFN_TEXT_PATTERNS: readonly RegExp[] = [
  /\bmfn\b/i,
  /\bmost[-\s]?favou?red[-\s]?nation\b/i,
];

/**
 * READ WHETHER MFN IS ON RECORD. Nothing here substitutes a value, and nothing
 * here is a display: `onRecord === null` is an answer, and the caller says so.
 */
export function readMfnOnRecord(source: MfnSource): MfnOnRecord {
  /* THE FLAG, FIRST. This block is `roundStoredTerms`'s, moved verbatim in
     substance: only an explicit yes turns it on, only an explicit no turns it off,
     and anything else records nothing. */
  const flagRaw = source.mfn;
  if (flagRaw === true) return { onRecord: true, source: "mfn_field", raw: "true" };
  if (flagRaw === false) return { onRecord: false, source: "mfn_field", raw: "false" };
  if (typeof flagRaw === "string" && flagRaw.trim() !== "") {
    const v = flagRaw.trim().toLowerCase();
    if (v === "true" || v === "yes" || v === "1" || v === "on") {
      return { onRecord: true, source: "mfn_field", raw: flagRaw.trim() };
    }
    if (v === "false" || v === "no" || v === "0" || v === "off") {
      return { onRecord: false, source: "mfn_field", raw: flagRaw.trim() };
    }
    /* A string nobody can read as a flag records NOTHING — it does not fall
       through to the side letter, because the round DID answer the question and
       the answer is unusable. Falling through would let prose overrule a stored
       answer, which is the shape of the defect this function removes. */
    return { onRecord: null, source: null, raw: flagRaw.trim() };
  }
  if (flagRaw === 1) return { onRecord: true, source: "mfn_field", raw: "1" };
  if (flagRaw === 0) return { onRecord: false, source: "mfn_field", raw: "0" };

  /* THE SIDE LETTER, ONLY WHERE THE FLAG SAID NOTHING. A side letter that is
     silent about MFN records nothing about MFN — it is NOT a recorded "no". */
  const letterRaw = source.sideLetter;
  if (typeof letterRaw === "string" && letterRaw.trim() !== "") {
    const text = letterRaw.trim();
    for (const re of MFN_TEXT_PATTERNS) {
      if (re.test(text)) return { onRecord: true, source: "side_letter", raw: text };
    }
    return { onRecord: null, source: null, raw: text };
  }

  return { onRecord: null, source: null, raw: null };
}

/** The same decision in the few words a table cell or a class label has room for.
 *  It obeys the same rule: no multiple and no cap when nothing was decided. */
export function describeLiquidationTermsShort(d: LiquidationTermDecision): string {
  if (!d.determined) return "cannot be read — the exit calculation refuses";
  const head = `${d.multiple}x ${d.participating ? "participating" : "non-participating"}`;
  if (!d.participating) return head;
  return d.capMultiple === null ? `${head}, no cap recorded` : `${head}, capped at ${d.capMultiple}x`;
}

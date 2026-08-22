/**
 * THE ONE DB READ OF A ROUND'S NEGOTIATED TERMS.
 *
 * ── WHY THIS FILE EXISTS (WAVE 71 · D11) ─────────────────────────────────────
 * Wave 70 created `roundStoredTerms` as an inner function of
 * `server/routes.ts::registerRoutes`, and its handoff to Wave 71 was explicit:
 *
 *   "`roundStoredTerms(roundId)` … is the single DB read of the stored terms out
 *    of `rounds.extras_json` … ADD FIELDS TO IT rather than reading `extras_json`
 *    again elsewhere."
 *   "Call those; DO NOT WRITE A THIRD READER … a rule that exists in two places
 *    is a rule that will diverge (R21), and that is the whole shape of findings
 *    D4, D6 and D12."
 *
 * Wave 71's D11 fix is in `server/track1Routes.ts`, a DIFFERENT module, which
 * could not reach a function trapped inside another module's closure. The body
 * below is Wave 70's, MOVED, not rewritten — `server/routes.ts` now imports it, so
 * there is still exactly ONE reader and the two routes cannot disagree about what a
 * round's terms are. Two fields are ADDED (`mfn`, `liquidationPreferenceMultiple`),
 * which is what that handoff said to do.
 *
 * NO MIGRATION. Every key read here already round-trips through
 * `rounds.extras_json` via `roundsStore.ts`'s `UPDATE_EXTRAS_WHITELIST`:
 * `antiDilutionType`, `interestRate`, `maturityMonths`, `maturityDate`,
 * `liquidationPreference`, `safeType` and — verified in the tree, not assumed —
 * `mfn`. Migrations stay at 173, highest `0192`.
 *
 * ABSENT IS LEFT ABSENT. This helper NEVER substitutes a value. A term that is not
 * stored arrives at its caller as `null`, and the CALLER decides between a named
 * refusal and a stated assumption. A default invented here would be the original
 * defect with a longer call stack (R6).
 */
import { getRoundById } from "../roundsStore";

export type RoundStoredTerms = {
  safeCapType: string | null;
  antiDilutionType: string | null;
  participatingPreferred: boolean | null;
  interestRate: number | null;
  maturityDate: string | null;
  maturityMonths: number | null;
  /* ── WAVE 71 · D13 — the SAFE's most-favored-nation provision ──────────────
     `applyMfn` in the engine returned immediately on `!s.safe.mfn` for every SAFE
     that ever reached it, because nothing ever set the flag. `"mfn"` was already on
     the extras whitelist, so this is a READ of a field the platform could already
     store and never looked at. Only an explicit truthy value turns it on; anything
     else is `null`, which omits the key and leaves every existing cap table alone. */
  mfn: boolean | null;
  /* ── WAVE 71 · D11 — the liquidation preference MULTIPLE, as a number ───────
     `GET /api/founder/captable/waterfall` used `1 + preferredReturnPct` as a
     liquidation preference multiple, where `preferredReturnPct` is a QUERY-STRING
     parameter in [0,1] modelling an SPV-style preferred RETURN. Those are two
     different instruments: a liquidation preference multiple is a negotiated term
     of a preferred share class ("1x", "2x") recorded in the round's own documents,
     and it is not a function of anything a caller puts in a URL.
     Parsed STRICTLY out of the free-text `liquidationPreference` field ("1x
     non-participating", "2x participating"): a leading `<number>x`, and nothing
     else counts. Anything unparseable stays `null` so the caller REFUSES rather
     than asserting a multiple nobody negotiated. */
  liquidationPreferenceMultiple: number | null;
  /* The raw stored string, so a refusal can quote what it actually found. */
  liquidationPreferenceRaw: string | null;
  /* ── WAVE 79 · ITEM 2 — THE SENIORITY RANKING, READ RATHER THAN INVENTED ─────
     `GET /api/founder/captable/waterfall` assigned `seniority: classIdx++` — the
     order the rounds happened to appear in the committed ledger — with no stored
     read, no comment and no test. That makes the EARLIEST round the MOST senior;
     market practice is the opposite or pari passu, and seniority decides who is
     paid first and therefore who is paid at all on a small exit. Measured: an $8m
     exit against $10m + $4m of 1× preferences pays
       route's order (earliest = most senior): early $8,000,000 / late $0
       market order  (latest  = most senior): late  $4,000,000 / early $4,000,000
     — a $4,000,000 swing on an $8m exit, from an order nobody negotiated. Same
     defect class as the fabricated common-share count Wave 71 fixed.

     READ STRICTLY, and ABSENT STAYS ABSENT. `0` is the MOST senior (the engine's
     own convention, `liquidationWaterfall.ts:29`). Only a finite, non-negative
     integer inside `[0, 99]` counts; anything else — absent, blank, negative,
     fractional, out of domain — arrives as `null` and the CALLER refuses. A
     default invented here would be the original defect with a longer call stack
     (R6), which is exactly what this file's header forbids.

     NO MIGRATION. `POST /api/rounds` routes every non-column key into `extras_json`
     (`server/routes.ts`, `KNOWN_COLS`) and `rowToRound` spreads `extras_json` back
     onto the round on hydrate (`server/roundsStore.ts`), so `seniority` is already
     storable and already hydrated — this is a READ of a field the platform can
     already hold, the same argument Wave 71 · D13 made for `mfn`. Migrations stay
     at 173 `.sql`, highest `0192`.

     ══ CORRECTED BY WAVE 91 · ITEM 4 — THIS COMMENT WAS STALE AND MISLEADING. ══
     WHAT IT USED TO SAY, kept rather than erased so the record shows what was
     believed and what corrected it. Wave 79 wrote here that `seniority` is
     *"deliberately NOT added to `UPDATE_EXTRAS_WHITELIST`"* because that would make
     `PATCH /api/rounds/:id/terms` an unfenced writer, and that the consequence was
     that *"seniority can be recorded at round CREATION and not edited afterwards."*

     WAVE 81 · ITEM 2 (D4) MADE BOTH SENTENCES FALSE and this file was not updated:
     `seniority` IS on `roundsStore.UPDATE_EXTRAS_WHITELIST`, and BOTH
     post-creation writers — `PATCH /api/rounds/:id/terms` and
     `PATCH /api/founder/rounds/:id` — persist it through the one imported
     `validateSeniorityRankStored` fence below. So it is editable after creation, and
     the writer that was NOT fenced was the CREATION one, which is the opposite of
     what this comment said. Wave 91 closed that writer with the same imported
     validator, so all THREE writers now validate.

     WHY THE CORRECTION IS WORTH A PARAGRAPH RATHER THAN A DELETION. A stale comment
     on a money path is how four separate agents came to propose editing
     `computeConversionProjections`, which is dead code. A comment that confidently
     states the opposite of the code is more dangerous than no comment. */
  seniorityRank: number | null;
  /* ── WAVE 94 · ITEM 1 — THE PARTICIPATION CAP, READ AT LAST ─────────────────
     `GET /api/founder/captable/waterfall` never set `participationCapMultiple` on
     the classes it handed the engine, so "1x participating, capped at 2x" — an
     ordinary market term — was silently modelled as **UNCAPPED**, which OVERPAYS
     that class and UNDERPAYS THE FOUNDERS. Measured by Wave 91, ruled by R83.2.

     THE CENSUS THAT MADE THIS THE RIGHT PLACE TO READ IT (`W94_PARTICIPATION_CAPS.md`
     §3). Before this wave the concept existed in FOUR places and not one of them
     was a server-side read of stored data:
       · `packages/cap-table-engine` IMPLEMENTS it (`participationCapMultiple`) —
         SACRED, and not edited by this wave;
       · `shared/schema.ts` lists `capParticipation` among a preferred round's
         fields;
       · `client/src/pages/founder/RoundNew.tsx` RENDERS a labelled control,
         "Participation cap (x — optional)", and does NOT put it in the create
         payload, so every value a founder types there is discarded on submit —
         a fifth control of exactly the class Wave 80 - Item 2 fixed;
       · `server/track1Routes.ts` mentioned the engine field twice, both times to
         `delete` it.
     WRITERS: exactly ONE reachable one, `POST /api/rounds`, and only through the
     unvalidated `KNOWN_COLS` extras sweep. READERS OF THE STORED VALUE: **ZERO.**

     TWO SOURCES ARE READ, AND A CONFLICT IS NOT RESOLVED — IT IS REPORTED.
       · `capParticipation`, the numeric key the wizard, `shared/schema.ts` and the
         term-sheet type all already use;
       · the free-text `liquidationPreference`, which ALREADY carries the other two
         halves of the same sentence (the multiple and the participating flag), so
         a founder typing "1x participating, capped at 2x" records the whole term in
         one place.
     Where both are present and DISAGREE, `participationCapConflict` is set and the
     caller REFUSES. Picking a winner would be inventing which of two negotiated
     numbers the parties agreed to (R21 / R6).

     AN UNREADABLE CAP IS NOT AN ABSENT CAP, AND THAT DISTINCTION IS THE WHOLE
     POINT. If a cap IS recorded but cannot be read as a multiple inside the domain
     — `"FULL_RATCHET"`, `50`, `0`, `-1` — `participationCapUnreadable` is set and
     the caller refuses BY NAME. Letting it fall through to `null` would reproduce
     the exact defect this wave exists to remove: a recorded cap silently modelled
     as uncapped. This project has persisted `"FULL_RATCHET"` and `7` unvalidated
     and then broken the cap table.

     NO MIGRATION. `capParticipation` already round-trips through
     `rounds.extras_json`: `POST /api/rounds` sweeps every non-column key into it
     and `roundsStore.rowToRound` re-spreads it on hydrate, which is the same path
     `optionPoolPostPercent`, `parentRoundId`, `seniority` and Wave 80's four keys
     all travel. This wave adds it to `roundsStore.UPDATE_EXTRAS_WHITELIST` so the
     two post-creation writers can persist it too. Migrations stay at **173 `.sql`,
     177 entries, highest `0192`.** */
  participationCapMultiple: number | null;
  /** What was actually found, so a refusal can quote it rather than paraphrase. */
  participationCapRaw: string | null;
  /** Which of the two sources the cap was read from. */
  participationCapSource: "capParticipation" | "liquidationPreference" | null;
  /** A cap IS on record and cannot be read as a multiple in domain. REFUSE. */
  participationCapUnreadable: boolean;
  /** Both sources carry a cap and they are different numbers. REFUSE. */
  participationCapConflict: boolean;
};

/** The domain of a seniority rank. `0` is the most senior. */
export const SENIORITY_RANK_MAX = 99 as const;

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 94 · ITEM 1 — THE PARTICIPATION CAP WRITE FENCE, DECLARED ONCE.
   ═══════════════════════════════════════════════════════════════════════════
   THE DOMAIN IS THE LIQUIDATION MULTIPLE'S OWN, not a second opinion: `(0, 10]`,
   exactly what `roundStoredTerms` below already accepts for
   `liquidationPreferenceMultiple` (Wave 71 - D11). A cap outside it is a typing
   error and not a negotiated term. Fractions are ALLOWED and deliberately so —
   `1.5x` and `2.5x` caps are real terms and the wizard's own control steps in
   halves — which is why this fence does NOT reuse the seniority validator's
   integer rule.

   `0` IS REFUSED, NOT TREATED AS "NO CAP". A zero cap would clamp a participating
   class's total to nothing at all, below even its own liquidation preference. A
   founder who means "no cap" leaves the field blank, and blank is `{ ok: true,
   value: "" }` — the `TermValueVerdict` contract every other term validator in the
   tree uses, so the writers cannot drift apart.

   A TRAILING `x` IS ACCEPTED because "2x" is how the term is written everywhere
   else in the product, including the tooltip on the control that captures it and
   the free-text field the sibling terms are read from. Accepting it here costs
   nothing and refusing it would fail a founder for typing the term correctly.
   ═══════════════════════════════════════════════════════════════════════════ */
export const PARTICIPATION_CAP_MAX = 10 as const;

export const PARTICIPATION_CAP_NOT_WRITABLE_MESSAGE =
  `capParticipation is the CEILING on what a participating preference class can take in total at an ` +
  `exit, expressed as a multiple of the money it invested — "1x participating, capped at 2x" means the ` +
  `class takes its preference and then shares in what is left until its total reaches 2x its ` +
  `investment, and nothing after that. It must be a number greater than 0 and no more than ` +
  `${PARTICIPATION_CAP_MAX} (a trailing "x" is accepted, so both 2 and "2x" are fine). Fractions are ` +
  `allowed: 1.5x and 2.5x are ordinary terms. Send null or an empty value to remove it, which means the ` +
  `class is UNCAPPED and participates without limit. A cap of 0 is refused rather than read as "no ` +
  `cap": it would pay the class less than the preference it negotiated.`;

export type ParticipationCapVerdict =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string; readonly message: string };

/** Parse a cap multiple out of one raw value. `null` = not a readable multiple. */
function parseCapMultiple(raw: unknown): number | null {
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

export function validateParticipationCapStored(raw: unknown): ParticipationCapVerdict {
  /* ABSENT — untouched. Tested on the LITERAL value, never on `String(raw).trim()`:
     `String([])` is `""`, so an empty ARRAY would otherwise be read as "there is no
     cap" and quietly accepted. That is the trap `W81-D4-B` caught on the seniority
     fence on its first run. */
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: "" };
  }
  /* SHAPE, BEFORE ANY PARSE. A boolean, an object or an array is a client bug and
     not a cap. `String([2])` is `"2"`, so a container reaching the numeric parse
     would be read as a 2x cap nobody sent. Refused by name. */
  if (typeof raw !== "number" && typeof raw !== "string") {
    return { ok: false, error: "invalid_capParticipation", message: PARTICIPATION_CAP_NOT_WRITABLE_MESSAGE };
  }
  if (String(raw).trim() === "") return { ok: true, value: "" };
  const n = parseCapMultiple(raw);
  if (n === null) {
    return { ok: false, error: "invalid_capParticipation", message: PARTICIPATION_CAP_NOT_WRITABLE_MESSAGE };
  }
  /* Stored AS WRITTEN in the sense that matters: the number, not the `x`. The
     reader parses with the same function, so writer and reader cannot disagree. */
  return { ok: true, value: String(n) };
}

/** The cap phrases that count in the free-text `liquidationPreference` field.
 *  STRICT and explicit: the word "cap" must be present, so "1x participating" is
 *  never read as a cap and a bare second multiple never becomes one. */
const CAP_TEXT_PATTERNS: readonly RegExp[] = [
  /capp?e?d?\s*(?:at|to)\s*([0-9]+(?:\.[0-9]+)?)\s*x/i,
  /cap(?:ped)?\s*(?:of|=|:)\s*([0-9]+(?:\.[0-9]+)?)\s*x/i,
  /([0-9]+(?:\.[0-9]+)?)\s*x\s*(?:participation\s+)?cap\b/i,
];

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 81 · ITEM 2 (D4) — THE SENIORITY WRITE FENCE, DECLARED ONCE.
   ═══════════════════════════════════════════════════════════════════════════
   WHAT WAS WRONG. `GET /api/founder/captable/waterfall` refuses a multi-class
   company with `SENIORITY_NOT_ON_RECORD` and instructs the founder, by name, to
   *"Record each preference class's seniority on the round (0 is the most senior,
   then 1, 2, … up to 99)"*. `PATCH /api/rounds/:id/terms` then answered
   HTTP 200 `{"ok":true}` to `{"seniority": 0}` and stored NOTHING, because the
   key was on neither the route's inline allow-list nor
   `roundsStore.UPDATE_EXTRAS_WHITELIST`. A founder followed the instruction, was
   told it worked, and the refusal came back unchanged. That is the third time
   this exact pattern has been found on this route (Wave 75
   `liquidationPreference`, Wave 77 `maturityDate`, Wave 80 six more).

   WHY PERSIST RATHER THAN REFUSE BY NAME. The other option the ruling allows is
   to refuse the key. But a refusal here would leave the platform saying "record
   the seniority" and, in the same breath, "seniority is not writable" — a dead
   promise with no writable surface after creation at all. Seniority is a real
   negotiated term, the reader for it already exists in this file, and the domain
   is already declared. So it is persisted, and the ONE thing this validator must
   never do is invent a rank: absent stays absent so the waterfall keeps refusing
   rather than paying someone first on an order nobody negotiated (R6).

   THE DOMAIN IS THE READER'S OWN, not a second opinion. `roundStoredTerms`
   above accepts a finite INTEGER in `[0, SENIORITY_RANK_MAX]` and nothing else,
   so this fence accepts exactly that and refuses everything else BY NAME. A
   fractional or out-of-domain value is a typing error, not a ranking, and
   rounding it would be recording an order the founder did not type.

   `{ ok: true, value: "" }` means ABSENT — write nothing — which is the
   `TermValueVerdict` contract every other term validator in the tree uses, so
   the three writers below cannot drift apart.

   NO USER INTERFACE, STATED PLAINLY. There is no seniority control anywhere in
   `client/src` (verified: the only match in the whole client tree is an
   unrelated sentence in `legalDocs.ts`). Persisting it here makes it settable
   over the API and by nothing else. The UI is deliberately NOT built by this
   wave: seniority decides the order in which classes are paid at an exit, so a
   control for it is a money feature that needs its own measured step.
   ═══════════════════════════════════════════════════════════════════════════ */
export const SENIORITY_NOT_WRITABLE_MESSAGE =
  `seniority is a preference class's RANK in the exit payment order, recorded as a whole number: ` +
  `0 is the most senior, then 1, 2, … up to ${SENIORITY_RANK_MAX}. It must be an integer in ` +
  `[0, ${SENIORITY_RANK_MAX}] — it is never rounded, and a fraction is a typing error rather than a ` +
  `ranking. Send null to remove it, which returns the class to having no recorded seniority; the exit ` +
  `waterfall then refuses with seniority_not_on_record rather than assuming an order.`;

export type SeniorityRankVerdict =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string; readonly message: string };

export function validateSeniorityRankStored(raw: unknown): SeniorityRankVerdict {
  /* ABSENT — untouched. Tested on the LITERAL value only. The tree's usual idiom
     is `String(raw).trim() === ""`, and it is wrong for this field: `String([])`
     is `""`, so an empty ARRAY would be read as "there is no ranking" and quietly
     accepted. Found by `W81-D4-B` on its first run. */
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: "" };
  }
  /* SHAPE, BEFORE ANY PARSE. A boolean, an object or an array is a client bug and
     not a rank. `String([5])` is `"5"`, so a container reaching the numeric parse
     below would be read as the rank 5 — which nobody sent. Refused by name. */
  if (typeof raw !== "number" && typeof raw !== "string") {
    return { ok: false, error: "invalid_seniority", message: SENIORITY_NOT_WRITABLE_MESSAGE };
  }
  const text = String(raw).trim();
  /* A whitespace-only string is a blank field, i.e. the same as absent. */
  if (text === "") return { ok: true, value: "" };
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > SENIORITY_RANK_MAX) {
    return { ok: false, error: "invalid_seniority", message: SENIORITY_NOT_WRITABLE_MESSAGE };
  }
  return { ok: true, value: String(n) };
}

const EMPTY: RoundStoredTerms = {
  safeCapType: null, antiDilutionType: null, participatingPreferred: null,
  interestRate: null, maturityDate: null, maturityMonths: null,
  mfn: null, liquidationPreferenceMultiple: null, liquidationPreferenceRaw: null,
  seniorityRank: null,
  participationCapMultiple: null, participationCapRaw: null,
  participationCapSource: null, participationCapUnreadable: false,
  participationCapConflict: false,
};

export function roundStoredTerms(roundId: unknown): RoundStoredTerms {
  const rid = String(roundId ?? "").trim();
  if (!rid) return EMPTY;
  let rnd: Record<string, unknown> | null = null;
  try {
    rnd = (getRoundById(rid) ?? null) as unknown as Record<string, unknown> | null;
  } catch { rnd = null; }
  if (!rnd) return EMPTY;
  const str = (k: string): string | null => {
    const v = rnd?.[k];
    return v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim();
  };
  const num = (k: string): number | null => {
    const v = rnd?.[k];
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  /* `liquidationPreference` is free text on the round ("1x non-participating",
     "1x participating"). It is read STRICTLY: only an explicit, unambiguous
     statement of participation counts, and anything else stays `null` so the
     caller omits the key rather than asserting a liquidation term. */
  let participating: boolean | null = null;
  const lpRaw = str("liquidationPreference");
  const lp = (lpRaw ?? "").toLowerCase();
  if (lp !== "") {
    if (/non[-\s]?participating/.test(lp)) participating = false;
    else if (/participating/.test(lp)) participating = true;
  }
  /* WAVE 71 · D11 — the multiple. `1x`, `1.5x`, `2 x` all read; `[0, 10]` is the
     domain, because a multiple outside it is a typing error and not a term. */
  let lpMultiple: number | null = null;
  if (lp !== "") {
    const m = /(^|[^0-9.])([0-9]+(?:\.[0-9]+)?)\s*x\b/.exec(lp);
    if (m) {
      const n = Number(m[2]);
      if (Number.isFinite(n) && n > 0 && n <= 10) lpMultiple = n;
    }
  }
  /* WAVE 71 · D13 — `mfn`. Stored by the Edit-terms dialog as a boolean or as the
     strings a form control produces. Only an explicit yes turns it on. */
  let mfn: boolean | null = null;
  const mfnRaw = rnd?.["mfn"];
  if (mfnRaw === true) mfn = true;
  else if (mfnRaw === false) mfn = false;
  else if (typeof mfnRaw === "string" && mfnRaw.trim() !== "") {
    const v = mfnRaw.trim().toLowerCase();
    if (v === "true" || v === "yes" || v === "1" || v === "on") mfn = true;
    else if (v === "false" || v === "no" || v === "0" || v === "off") mfn = false;
  } else if (mfnRaw === 1) mfn = true;
  else if (mfnRaw === 0) mfn = false;

  /* WAVE 79 · ITEM 2 — the seniority rank. Integer, `[0, 99]`, `0` most senior.
     A fractional or out-of-domain value is a typing error, not a ranking, so it
     becomes `null` and the caller refuses rather than rounding it into an order. */
  let seniorityRank: number | null = null;
  const senRaw = rnd?.["seniority"];
  if (senRaw !== null && senRaw !== undefined && String(senRaw).trim() !== "") {
    const n = Number(senRaw);
    if (Number.isInteger(n) && n >= 0 && n <= SENIORITY_RANK_MAX) seniorityRank = n;
  }

  /* ── WAVE 94 · ITEM 1 — THE PARTICIPATION CAP, READ FROM BOTH ITS HOMES ─────
     Neither source is preferred over the other: if both carry a cap and the two
     numbers differ, the CONFLICT is reported and the caller refuses. An
     unreadable cap is reported as unreadable and NEVER falls through to "no cap",
     because "silently modelled as uncapped" is the defect. */
  let capFromKey: number | null = null;
  let capKeyPresent = false;
  let capKeyRawText: string | null = null;
  const capKeyRaw = rnd?.["capParticipation"];
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
    /* The word "cap" appears but no multiple can be read off it — "capped", "cap
       TBD", "capped at market". A cap IS asserted and is not readable. */
    if (
      !capTextPresent &&
      /\bcapp?e?d?\b/i.test(lp) &&
      !/uncapped/i.test(lp) &&
      /* `"valuation cap"` is a SAFE's conversion cap and a different instrument
         entirely. If it appears in the liquidation-preference field it is a data
         error, but it is not an assertion of a PARTICIPATION cap, so it must not
         make the waterfall refuse. */
      !/valuation\s*cap/i.test(lp)
    ) {
      capTextPresent = true;
      capTextRawText = lpRaw;
      capFromText = null;
    }
  }

  let participationCapMultiple: number | null = null;
  let participationCapSource: RoundStoredTerms["participationCapSource"] = null;
  let participationCapRaw: string | null = null;
  let participationCapUnreadable = false;
  let participationCapConflict = false;

  if (capKeyPresent && capTextPresent) {
    participationCapRaw = `${capKeyRawText} / ${capTextRawText}`;
    if (capFromKey === null || capFromText === null) {
      participationCapUnreadable = true;
    } else if (capFromKey !== capFromText) {
      participationCapConflict = true;
    } else {
      participationCapMultiple = capFromKey;
      participationCapSource = "capParticipation";
    }
  } else if (capKeyPresent) {
    participationCapRaw = capKeyRawText;
    if (capFromKey === null) participationCapUnreadable = true;
    else { participationCapMultiple = capFromKey; participationCapSource = "capParticipation"; }
  } else if (capTextPresent) {
    participationCapRaw = capTextRawText;
    if (capFromText === null) participationCapUnreadable = true;
    else { participationCapMultiple = capFromText; participationCapSource = "liquidationPreference"; }
  }

  return {
    safeCapType: str("safeType"),
    antiDilutionType: str("antiDilutionType"),
    participatingPreferred: participating,
    interestRate: num("interestRate"),
    maturityDate: str("maturityDate"),
    maturityMonths: num("maturityMonths"),
    mfn,
    liquidationPreferenceMultiple: lpMultiple,
    liquidationPreferenceRaw: lpRaw,
    seniorityRank,
    participationCapMultiple,
    participationCapRaw,
    participationCapSource,
    participationCapUnreadable,
    participationCapConflict,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 71 · D15 — THE OPTION-POOL CEILING, DECLARED ONCE FOR BOTH WRITERS.
   ═══════════════════════════════════════════════════════════════════════════
   THE DEFECT, measured. Both write fences validated `optionPoolPostPercent` in
   `[0, 100)` and migration 0192 deliberately does not fence it at all, so `99` was
   inside the domain and was ACCEPTED by both writers. Executed through
   `projectPostClose` on an 8,000,000-share company with a 1,000,000-share pool,
   a $30,000,000 pre-money and a $10,000,000 raise:

       optionPoolPostPercent = 15  ->  totalShares = 13,333,333          (8 digits)
       optionPoolPostPercent = 49  ->  totalShares = 30,769,230          (8 digits)
       optionPoolPostPercent = 99  ->  totalShares = 3,152,769,486,…     (46 digits)

   The QA document recorded the same defect on its own fixture at a 49-digit total
   (`2794361482852375573373050641368361826969509000000`; the document's prose said
   48 — the printed figure is 49). The exact digit count is fixture-dependent; the
   point is that it is not a cap table. `T = (Pp·(E + u + N) − 100·u)/(100 − Pp)`
   divides by `100 − Pp`, so the gross-up factor is 1 at 50%, 9 at 90% and 99 at
   99%, and the fixed-point pricing solve converges happily on the result.

   THE CEILING IS A BUSINESS POLICY, AND IT IS STATED AS ONE. There is no
   arithmetic reason to stop at any particular percentage below 100 — the maths is
   legal all the way up. `50` is chosen because an employee option plan reserving
   half the company is not an option plan, and because at 50% the gross-up factor
   is exactly 1× (each share of reserve costs existing holders one share of
   dilution) — beyond it every extra point of pool costs more than a point. Market
   pools are 10–20% at Series A (Carta, "Option pool size"; Cooley GO, "Negotiating
   the option pool"), so 50% is more than double the largest figure either source
   reports. **THE EXACT NUMBER IS AN OWNER QUESTION** and is recorded as one in
   `build_log/wave71/`; what is not in question is that there must be one.

   WHERE THE FENCE IS, AND WHERE IT IS DELIBERATELY NOT. It is at the two
   APPLICATION writers, which is what D15 asks for ("close BOTH writers", because
   Wave 58e's and 61b's lesson is that a single-writer fix reopens). It is NOT added
   to the engine leaf `computeEsopTopUp`, which is a general-purpose mathematical
   function whose own domain is `[0, 100)` and whose test `B4-4` asserts, by name,
   that `99.9` must NOT throw there. A platform policy belongs at the platform
   boundary, not inside the arithmetic.

   R16 / R27 — IT IS PERCENT-AS-WRITTEN AND IS NOT RESCALED. `"15"` means 15% and
   `"0.25"` means a quarter of one percent. Nothing here divides or multiplies by
   100, and `n > 1 ? n / 100 : n` does not and must not appear. */
export const OPTION_POOL_POST_PERCENT_MAX = 50 as const;

/** The one refusal message, so the two writers cannot word it differently. */
export const OPTION_POOL_POST_PERCENT_CEILING_MESSAGE =
  `An option pool of ${OPTION_POOL_POST_PERCENT_MAX}% of fully-diluted shares or more is not an ` +
  `employee option plan, and Capavate will not model one. It is percent-as-written ` +
  `: 15 means 15%, and it is never rescaled by how big it looks. The pool top-up is ` +
  `solved as T = (P x (E + u + N) - 100 x u) / (100 - P), so the cost of each extra point of pool ` +
  `rises as P approaches 100: at 15% a pool is worth roughly its own size in dilution, and at 99% ` +
  `the arithmetic is legal but produces a 46-digit share count that is not a cap table. Typical ` +
  `Series A pools are 10-20% (Carta; Cooley GO). If you genuinely need a reserve at or above ` +
  `${OPTION_POOL_POST_PERCENT_MAX}%, that is a capital-structure decision to record deliberately, ` +
  `not a percentage to type into this field.`;

/** `true` when the value is inside the platform's policy ceiling. */
export function optionPoolPostPercentWithinCeiling(n: number): boolean {
  return Number.isFinite(n) && n < OPTION_POOL_POST_PERCENT_MAX;
}

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

     NO MIGRATION, and NO CHANGE TO ANY WRITE FENCE. `POST /api/rounds` routes every
     non-column key into `extras_json` (`server/routes.ts:7094-7097`, `KNOWN_COLS`)
     and `rowToRound` spreads `extras_json` back onto the round on hydrate
     (`server/roundsStore.ts:100-127`), so `seniority` is already storable and
     already hydrated — this is a READ of a field the platform can already hold,
     the same argument Wave 71 · D13 made for `mfn`. It is deliberately NOT added to
     `UPDATE_EXTRAS_WHITELIST`: that would make `PATCH /api/rounds/:id/terms` a
     writer with no domain fence and no closed vocabulary, and `W75-*` pins the set
     of whitelisted-but-unhandled keys at SEVEN in the only direction it may move
     (down). THE CONSEQUENCE, STATED RATHER THAN HIDDEN: seniority can be recorded
     at round CREATION and not edited afterwards. That is an OWNER QUESTION
     (`W79_UNVERIFIED_AND_OWNER_QUESTIONS.md`), not a solved problem. */
  seniorityRank: number | null;
};

/** The domain of a seniority rank. `0` is the most senior. */
export const SENIORITY_RANK_MAX = 99 as const;

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
  `employee option plan, and Capavate will not model one. It is PERCENT-AS-WRITTEN (owner ruling ` +
  `R16 / OR-1): 15 means 15%, and it is never rescaled by how big it looks. The pool top-up is ` +
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

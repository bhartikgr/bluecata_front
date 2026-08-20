/**
 * WAVE 58g — WAIVER-7: ONE UNIT-CONVERSION AUTHORITY.
 * ═══════════════════════════════════════════════════════════════════════════
 * `server/roundCarryForwardEngine.ts` is SACRED (sacred_baseline/SACRED_SHA256.txt
 * line 2). Owner ruling R34 (2026-08-15) granted WAIVER-7 for ONE change to it:
 * delete the local `(rawDiscount / 100).toFixed(6)` inside `discountAsDecimalStr`
 * and route the conversion through the platform's single declared bridge,
 * `toWireDiscount` in `shared/roundMathEngineAdapter.ts`.
 *
 * WHAT THESE TESTS ARE FOR, IN ORDER:
 *   A — the change, and the HARD BOUNDARIES around it (what must NOT have moved).
 *   B — the INPUT UNIT, verified against the seed data rather than assumed.
 *   C — the fix PROVEN THROUGH THE LIVE HTTP ROUTE, both poles: a legal discount
 *       converts once and correctly; a corrupt one is REFUSED by name instead of
 *       being passed on as a "fraction" of 202607.07.
 *   D — `InvalidDiscountWireValueError` is still the SOLE [0,1] arbiter, and the
 *       forbidden magnitude heuristic (R16) is still absent.
 *
 * Mutation transcripts for every assertion here: build_log/wave58g/W58G_TESTS.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { securities } from "../mockData";
import { computeCarryForward } from "../roundCarryForwardEngine";
import { toWireDiscount, InvalidDiscountWireValueError } from "@shared/roundMathEngineAdapter";

/* Source reads anchored to THIS FILE, never `process.cwd()` — W58B_REVIEW_1_MATH
   §5 recorded ten checks failing in a rerun purely because they resolved from the
   launch directory. */
const ROOT = path.resolve(__dirname, "..", "..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const sha = (rel: string): string =>
  createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");

const ENGINE = "server/roundCarryForwardEngine.ts";
const ADAPTER = "shared/roundMathEngineAdapter.ts";
const CO = "co_novapay";
const ADMIN = "u_admin";
const CF_URL = `/api/founder/companies/${CO}/carry-forward?roundType=priced_equity`;

/** The one legal state of the sacred file under WAIVER-7. */
const POST_WAIVER_SHA = "42d04653278caefe85093fff778bdc1c8f0aabc0916a9deec29b1862729212a8";
const PRE_WAIVER_SHA = "d7fa53f0fb8c41d0acba5ee7184ec11e169aa23530b90d49860533f27c786119";

/** The slice of the engine that WAIVER-7 authorised, lifted from source. */
function conversionFn(): string {
  const s = src(ENGINE);
  const i = s.indexOf("function discountAsDecimalStr");
  expect(i, "discountAsDecimalStr has been renamed or removed").toBeGreaterThan(-1);
  return s.slice(i, s.indexOf("\n}", i) + 2);
}

let app: Express;
beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 90_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * A — THE CHANGE, AND THE BOUNDARIES AROUND IT.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58G-A — the second conversion authority is gone, and nothing else moved", () => {
  it("W58G-A1 — `discountAsDecimalStr` no longer divides by 100 itself", () => {
    /* The whole job. Wave 58f measured this function against the shared bridge
       and could only quarantine it; R34 authorised its removal. */
    const fn = conversionFn();
    expect(fn).not.toMatch(/rawDiscount\s*\/\s*100/);
    expect(fn).not.toMatch(/\/\s*100/);
    expect(fn).not.toContain("toFixed(6)");
  });

  it("W58G-A2 — it delegates to the SHARED bridge, imported once", () => {
    const fn = conversionFn();
    expect(fn).toContain("toWireDiscount(");
    expect(fn).toContain("wireFraction");
    const s = src(ENGINE);
    const imports = [...s.matchAll(/import\s*\{[^}]*toWireDiscount[^}]*\}\s*from\s*"([^"]+)"/g)];
    expect(imports).toHaveLength(1);
    expect(imports[0][1]).toBe("@shared/roundMathEngineAdapter");
  });

  it("W58G-A3 — NO percent→fraction division survives anywhere in the engine file", () => {
    /* R21: one rule, one place. Comments may still DESCRIBE the removed division
       (the waiver rationale names it), so code is checked with comments stripped. */
    const stripped = src(ENGINE)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/\/\s*100/);
  });

  it("W58G-A4 — HARD BOUNDARY: `computeConversionProjections` is UNTOUCHED and still divides nothing", () => {
    /* The brief for 58f said this function also divided by 100. It does not — it
       consumes an already-fractional value. "Fixing" it would turn a 20%
       discount into 0.2%. This assertion exists so a future wave that believes
       the old brief fails here first. */
    const s = src(ENGINE);
    const proj = s.slice(
      s.indexOf("export function computeConversionProjections"),
      s.indexOf("Main engine entry point"),
    );
    expect(proj.length).toBeGreaterThan(200);
    expect(proj).toContain("discount: inst.discount ?? undefined");
    expect(proj).not.toContain("/ 100");
    expect(proj).not.toContain("toWireDiscount");
  });

  it("W58G-A5 — the sacred file is at its ONE waived state, and the pre-waiver bytes are gone", () => {
    expect(sha(ENGINE)).toBe(POST_WAIVER_SHA);
    expect(sha(ENGINE)).not.toBe(PRE_WAIVER_SHA);
  });

  it("W58G-A6 — WAIVER-7 touched ONE file: the other two cap-table sacred files are byte-identical", () => {
    /* R34's verification bar names these two explicitly. */
    expect(sha("server/captableCommitStore.ts")).toBe(
      "e5045ecbe77b06ea9879fae53e58e21ee2002b5b820a5ef066ecdf086c41cb06",
    );
    expect(sha("server/lib/capTableMembership.ts")).toBe(
      "688b555426544527534afa12ce54e34069480db989c74c85d7d9020b9a45d750",
    );
    /* And the shared bridge itself was NOT edited by this wave — the fix moved a
       caller to the rule, it did not change the rule.

       ═══════════════════════════════════════════════════════════════════════════
       WAVE 61b · R50 — RE-PINNED, AND HERE IS EXACTLY WHY.
       ═══════════════════════════════════════════════════════════════════════════
       This tripwire FIRED, which is what it is for. Wave 61b APPENDED five new
       bounded-term validators to this module under owner ruling R50
       (`maturityMonths`, `expiryYears`, `strikePrice`, `valuationCap`,
       `fdPreMoneyShares`), plus their constants and a new `TermValueVerdict` type.

       WHAT WAS NOT TOUCHED, and why re-pinning is honest rather than a rubber
       stamp: `shared/roundMathEngineAdapter.ts` is NOT a sacred file (it is not in
       `sacred_baseline/SACRED_SHA256.txt`, and `npm run sacred` reports 48/48
       byte-identical with `drifted:0` across Wave 61b). The addition is PURELY
       ADDITIVE: no existing export was renamed, removed or changed, `TermRangeVerdict`
       was NOT widened, and `W58G-A1..A5` plus `W58E-D2i` still execute the
       conversion rule itself across its boundary values and still pass. The two
       genuinely SACRED cap-table hashes asserted above are UNCHANGED.
       PRE-WAVE-61b HASH, kept on the record rather than erased:
         1eaa14c0deba590db85cf77ff1e177dcae8666283fe1fd39a4b8033bf363e548

       ═══════════════════════════════════════════════════════════════════════════
       WAVE 68 · R56 — RE-PINNED AGAIN, AND HERE IS EXACTLY WHY.
       ═══════════════════════════════════════════════════════════════════════════
       This tripwire FIRED a second time, which is what it is for. Wave 68
       APPENDED the R56 date-shape helpers to this module under owner ruling R56
       (`DATE_SHAPE_YEAR_MIN`, `DATE_SHAPE_YEAR_MAX`, `DATE_SHAPE_WARNED_FIELDS`,
       `DateShapedField`, `dateShapeOf`, `dateShapedValueWarning`). They compute a
       NON-BLOCKING WARNING for an 8-digit money value that parses as a plausible
       calendar date; they perform NO conversion, so WAIVER-7's subject — the one
       unit-conversion authority — is untouched.

       WHAT WAS NOT TOUCHED, so re-pinning is honest rather than a rubber stamp:
       the addition is PURELY ADDITIVE at the END of the R50 block; no existing
       export was renamed, removed, re-typed or re-ordered; `toWireDiscount`,
       `readDiscountFraction` and `InvalidDiscountWireValueError` are byte-for-byte
       as Wave 58g left them, and `W58G-A1..A5` plus `W58E-D2i` still execute the
       conversion rule across its boundary values and still pass. The two
       genuinely SACRED cap-table hashes asserted above are UNCHANGED and
       `npm run sacred` reports 48/48 with `drifted:0`.
       PRE-WAVE-68 HASH, kept on the record rather than erased:
         d859f70e5148ff9b0ebfc566b77aff816a8cb44a3e0f9138d5264fb050eacedf
       Evidence: build_log/wave61b/WAVE61B_REPORT.md, build_log/wave68/WAVE68_REPORT.md.

       ═══════════════════════════════════════════════════════════════════════════
       WAVE 70 · R60 — RE-PINNED A THIRD TIME. THIS IS THE LARGEST EDIT THIS FILE
       HAS RECEIVED, SO HERE IS EXACTLY WHAT MOVED AND WHAT DID NOT.
       ═══════════════════════════════════════════════════════════════════════════
       This tripwire fired a third time, which is what it is for. Wave 70 removed
       FOUR hardcoded deal terms from this adapter under owner ruling R60 and
       findings D1, D4, D5, D6, D7 and D9:

         · `interestRate: "0.05"`      -> the STORED, TYPED rate, crossing to the
                                          fractional wire through the new
                                          `toWireInterestRate`; ABSENT REFUSES.
         · `maturityDate: "2027-12-31"` -> the STORED maturity, or nothing.
         · `type: "post_money_cap"`     -> `resolveSafeCapType(s).capType`, so a
                                          pre-money SAFE is finally expressible.
         · `participating: false` and
           `antiDilution: "broad_based"` on the NEW round in `projectPostClose`
                                        -> DELETED. Both are read from the round's
                                          stored terms, and the EXISTING preferred
                                          class now carries its own negotiated
                                          anti-dilution method (R60 §2).

       WHAT WAS NOT TOUCHED, so re-pinning is honest rather than a rubber stamp:
       WAIVER-7's SUBJECT — the one unit-conversion authority — is untouched.
       `toWireDiscount`, `readDiscountFraction` and `InvalidDiscountWireValueError`
       are BYTE-FOR-BYTE as Wave 58g left them; W58F-F4a's guard-block digest
       `7db0313e…` is unchanged and still green; the new `toEngineDiscount` LAYERS
       a state-domain check ON TOP of `toWireDiscount` and calls it FIRST, so it
       neither weakens, bypasses nor DUPLICATES the arbiter (R34, W58G-D1) — and
       W58E-D1f still proves `20260707` raises `InvalidDiscountWireValueError` by
       name. `toWireInterestRate` is a NEW bridge for a DIFFERENT field, dividing
       by 100 exactly once, in exactly one place, per R16.
       `computeConversionProjections` was not touched.
       `npm run sacred` reports 48/48 with `unratified_waivers:0` — this file has
       never been in the 48-entry manifest (verified again against
       `sacred_baseline/SACRED_SHA256.txt`: 40 base entries, zero matches).
       PRE-WAVE-70 HASH, kept on the record rather than erased:
         be78298328d4d0929b753b03a2e198be92919987ad8447c91fd84125546234e7
       Evidence: build_log/wave70/WAVE70_REPORT.md, build_log/wave70/W70_MATH_PROOFS.md.

       ═══════════════════════════════════════════════════════════════════════════
       WAVE 71b — RE-PINNED A FOURTH TIME, AFTER A PROVING RUN. WAVE 71 MEASURED
       THE NEW HASH AND DELIBERATELY REFUSED TO MOVE THE PIN WITHOUT ONE.
       ═══════════════════════════════════════════════════════════════════════════
       A pinned hash exists to catch UNINTENDED change. Re-pinning after verified
       intentional change is correct; re-pinning without verifying is how a hash
       assertion stops meaning anything. The verification, in full:

         1. NOT SACRED. `npm run sacred` -> 48/48 byte-identical, all 8 waivers
            OWNER-RATIFIED, `unratified_waivers:0`. This file has never been in the
            48-entry manifest (checked again against
            `sacred_baseline/SACRED_SHA256.txt`).
         2. THE DIFF IS EXACTLY WAVE 71's DOCUMENTED WORK: 11 hunks, +327/-19
            lines. All nineteen REMOVED lines are accounted for — 13 are the
            duplicated 365.25-day IEEE-754 elapsed-time expression and the comment
            block that handed it to Wave 71 (finding D8, now the one exact
            `primitives/timeElapsed.ts` both paths import); 2 are the
            `preMoneyValuation` silent coercion to 0 and the false "cannot crash"
            comment above it (D16); 3 are the `computeCapTable({ view })` call
            shape (D18's `ownershipPercent: string | null` contract); 1 is the
            `adaptSecuritiesToEngine` signature (D20's three new event types).
            Full patch: `build_log/wave71b/W71B_C3_ADAPTER_DIFF.patch`.
         3. WAIVER-7's SUBJECT IS BYTE-IDENTICAL, proved per declaration rather
            than asserted. sha256 of each block, computed on the Wave 70 file AND
            on this one, all five SAME:
              toWireDiscount                c98dbcb03723ff10e970310a1bae1a9a835451196df62c2c8b934a1c16cf7a3e
              readDiscountFraction          61a232cd6a50a94fe7a7549799cce3e4c5776ab0735584a914fb1f2df3ebfd47
              InvalidDiscountWireValueError 86347904fa505846e09c92fd83e3e425644fd813806f9b4bd94dd6e8a85ece05
              toWireInterestRate            f40603bb7ff12eae380512be08b2e0b72e0206b8209ad1c26693b166ab040e1b
              toEngineDiscount              5200e910c76bf095a833b439a7e377260ada9588ec072c6adfca59fb579714a4
         4. THE TESTS THAT POLICE THAT BOUNDARY ARE GREEN: `w58e_discount_boundary`,
            `w58f_discount_domain_and_third_writer` and `waveB_retirement_guard` —
            90 assertions, 0 failed. W58E-D1f still raises
            `InvalidDiscountWireValueError` by name on `20260707`.
         5. WAVE 71b DID NOT TOUCH THIS FILE. Its edits are
            `server/roundMathRoutes.ts`, `server/track1Routes.ts`, migration `0192`
            (both copies) and four test files.

       WHAT IS NOT WEAKENED: this is still an exact equality on the WHOLE file, so
       the next unintended byte still fires it. Only the expected value moved.
       PRE-WAVE-71 HASH, kept on the record rather than erased:
         0ed4f43509d09ff0dfbd58f6f05b18fd9839380e16aae61b40155b72d6760d07
       Evidence: build_log/wave71/WAVE71_REPORT.md §5 cluster 3,
       build_log/wave71b/WAVE71B_REPORT.md, W71B_C3_PROVING_RUN.txt.

       ═══════════════════════════════════════════════════════════════════════════
       WAVE 72 — RE-PINNED A FIFTH TIME, AND SAID SO LOUDLY. THIS TRIPWIRE FIRED
       BECAUSE WAVE 72 EDITED THIS FILE ON PURPOSE.
       ═══════════════════════════════════════════════════════════════════════════
       WHAT WAVE 72 ADDED, and nothing else: the two named refusals the post-close
       projection did not have, and the audit that raises them.
         · `ZeroPricingDenominatorRefusal` (`zero_pricing_denominator`) — a
           positive valuation and a positive raise over a ZERO-SHARE company used
           to return SUCCESS with `pricePerShare = "Infinity"`, zero investor
           shares and `converged = "false"`. Reproduced verbatim by
           `build_log/final_review/REVIEW_1_MATH.md` and re-executed in
           `build_log/wave72/scratch/p1_repro.mts`.
         · `PricingSolveNotConvergedRefusal` (`pricing_solve_not_converged`) — an
           unconverged fixed-point solve is no longer reported as a settled price.
         · `projectPostClose` now (a) translates the engine's new
           `ZeroPricingDenominatorError` into the first of those, and (b) audits
           the engine's own `round.pricing.order` trace step before returning.
       ONE LINE WAS REMOVED: `const result = computeCapTable(computeOpts);`, which
       is now the same call inside a `try` (`W72_ADAPTER_DIFF.patch`: 2 hunks,
       +159 / -1). No other line was deleted, and no arithmetic moved — the two
       control poles `W72-A4` and `W72-A5` pin a legitimate financing's price,
       denominator, investor share count and total, value for value, against the
       pre-fix tree.

       THE PROVING RUN, in full, before this pin moved:
         1. NOT SACRED. `npm run sacred` -> 48/48 byte-identical, all 8 waivers
            OWNER-RATIFIED, `unratified_waivers:0`. This file has never been in the
            48-entry manifest.
         2. WAIVER-7's SUBJECT IS BYTE-IDENTICAL, recomputed per declaration on the
            pre-Wave-72 file AND on this one — all five SAME, and the same five
            digests Wave 71b recorded:
              toWireDiscount                c98dbcb03723ff10e970310a1bae1a9a835451196df62c2c8b934a1c16cf7a3e
              readDiscountFraction          61a232cd6a50a94fe7a7549799cce3e4c5776ab0735584a914fb1f2df3ebfd47
              InvalidDiscountWireValueError 86347904fa505846e09c92fd83e3e425644fd813806f9b4bd94dd6e8a85ece05
              toWireInterestRate            f40603bb7ff12eae380512be08b2e0b72e0206b8209ad1c26693b166ab040e1b
              toEngineDiscount              5200e910c76bf095a833b439a7e377260ada9588ec072c6adfca59fb579714a4
            Method and output: `build_log/wave72/scratch/block_hashes.py`,
            `build_log/wave72/W72_BRIDGE_INVARIANT.md`.
         3. THE BRIDGE INVARIANT WAS RE-VERIFIED AS CORRECTLY STATED. The final
            review reported "toWireDiscount has two runtime callers, violating the
            single-caller invariant". THAT INVARIANT IS NOT A RULE — the rule is ONE
            BRIDGE PER QUANTITY (one place that divides), and MANY CALLERS OF ONE
            BRIDGE IS THE GOAL. The second caller is
            `server/roundCarryForwardEngine.ts:279`, which is WAIVER-7 working
            exactly as designed: that file was waived precisely so it would
            DELEGATE here instead of dividing by 100 itself. Nothing was changed for
            it. Measured: exactly one `.div(100)` for discount (`:300`, inside
            `toWireDiscount`) and exactly one for interest rate (`:1155`, inside
            `toWireInterestRate`); no third bridge; neither quantity divided twice.
         4. THE TESTS THAT POLICE THAT BOUNDARY ARE GREEN: `w58e_discount_boundary`,
            `w58f_discount_domain_and_third_writer`, `waveB_retirement_guard` and
            this file.
       WHAT IS NOT WEAKENED: still an exact equality on the WHOLE file, so the next
       unintended byte still fires it. Only the expected value moved.
       ONE MORE MOVE WITHIN WAVE 72, DECLARED RATHER THAN QUIETLY FOLDED IN: the
       first Wave-72 value was `999a44b4e414132bc6ad777e53dfcb1a7ddfdf9970dae71f8bb09ca42d6113cf`.
       It moved to the value below when the refusal MESSAGES were corrected under R58
       — they had told a founder to add a security on the cap table, and v25.48.3
       Q-F1 made that surface VIEW-ONLY (its "Add security in Rounds" button routes
       to /founder/rounds). Naming a control that is not there is the error R58 row 2
       exists to stop, so the sentence now names /founder/rounds. Message text only;
       no code, no arithmetic and no refusal condition changed.
       PRE-WAVE-72 HASH, kept on the record rather than erased:
         6a8dd78fa91a45384b8f49d18befadb226c35beccab949e7329be08703393cfb
       Evidence: build_log/wave72/WAVE72_REPORT.md, W72_TESTS.md,
       W72_ADAPTER_DIFF.patch. */
    /* ── RE-PINNED 2026-08-18 · WAVE 76 ────────────────────────────────────────
       Previous pin: 9c0c11405da0a175f6cc620055a04fc61fa6c2043bdd2d378f0af2c35adfd1b3
       New pin:      90ef4cf9389d5df37f846bcce5d31fdb7955faa3e110bfe6e434c73b9469af49

       WHY THIS MOVED, and why that is legitimate. `shared/roundMathEngineAdapter.ts`
       is an EDITABLE file (see release/SACRED_DOC §4) — this pin exists to catch an
       UNINTENDED change, not to freeze the file. Wave 76 added, purely additively:
         · validateAntiDilutionTypeStored   · validateSafeCapTypeStored
         · closedVocabularyTerm (shared helper)
         · ANTI_DILUTION_TYPES_FOR_INPUT / SAFE_CAP_TYPES_FOR_INPUT, exported off the
           EXISTING private constants.
       No existing symbol was changed.

       VERIFIED BEFORE RE-PINNING (do the same next time — do not just paste a hash):
         · the recorded pre-wave hash equalled the OLD pin exactly, so the only delta
           is this wave's;
         · `toWireDiscount` and `toWireInterestRate` are still ONE definition each —
           the single-bridge-per-quantity rule (R16/R30) is intact;
         · `.div(100)` count is unchanged at 3 = the two bridges + `describeDiscount`'s
           prose division, which Wave 73 · Item 11 documented as not-a-wire-authority.
           A FOURTH would be a units defect;
         · `resolvePreferredTerms` still refuses an unknown token BY NAME.

       The two cap-table hashes pinned above did NOT move and must not be re-pinned
       casually — they are sacred files and R34 names them explicitly.
       ──────────────────────────────────────────────────────────────────────────

       ── RE-PINNED 2026-08-19 · WAVE 77 · R71 ──────────────────────────────────
       Previous pin: 90ef4cf9389d5df37f846bcce5d31fdb7955faa3e110bfe6e434c73b9469af49
       New pin:      d75d5aa345f1844414fba788b711a51af9708099897a94716f760d17656a02a3

       WHY THIS MOVED. Owner ruling R71 converges maturity on ONE canonical field:
       `maturityMonths` is canonical and `maturityDate` becomes DERIVED. The
       derivation and the refusal that keeps the derived field out of every writer
       have to live in ONE place or the three writers will drift (they have, four
       times: 58e, 58f, 61b, 76), and this module is that place. Wave 77 changed:
         · `resolveNoteMaturityDate` — PRECEDENCE INVERTED. It preferred a stored
           absolute date; it now prefers `maturityMonths` and falls back to a stored
           date so no existing row is orphaned (R71 condition 3). This is the one
           behavioural change in the file, and it is the ruling's whole subject.
         · NEW, purely additive: `deriveMaturityDateFromMonths` (the one derivation),
           `censusMaturityNames` (reports a disagreement, never resolves it) and
           `MATURITY_DATE_NOT_WRITABLE` (the one refusal, imported by all writers).
       No existing export was renamed, removed or re-typed.

       VERIFIED BEFORE RE-PINNING (measured, not pasted — transcript in
       build_log/wave77/W77_TESTS.md):
         · the pre-wave hash of this file equalled the OLD pin exactly, so the only
           delta is this wave's;
         · WAIVER-7's SUBJECT IS BYTE-IDENTICAL — all five declaration digests
           recomputed and equal to the values Waves 71b and 72 recorded:
             toWireDiscount                c98dbcb03723ff10e970310a1bae1a9a835451196df62c2c8b934a1c16cf7a3e
             readDiscountFraction          61a232cd6a50a94fe7a7549799cce3e4c5776ab0735584a914fb1f2df3ebfd47
             InvalidDiscountWireValueError 86347904fa505846e09c92fd83e3e425644fd813806f9b4bd94dd6e8a85ece05
             toWireInterestRate            f40603bb7ff12eae380512be08b2e0b72e0206b8209ad1c26693b166ab040e1b
             toEngineDiscount              5200e910c76bf095a833b439a7e377260ada9588ec072c6adfca59fb579714a4
         · `toWireDiscount` and `toWireInterestRate` are still ONE definition each
           (single bridge per quantity, R16/R30), and `.div(100)` is unchanged at 3
           = the two bridges + `describeDiscount`'s prose division (Wave 73 · Item
           11). A FOURTH would be a units defect;
         · `resolvePreferredTerms` still refuses an unknown token BY NAME;
         · `server/roundCarryForwardEngine.ts` (WAIVER-7's file, R69's standing
           prohibition) is BYTE-IDENTICAL at
           42d04653278caefe85093fff778bdc1c8f0aabc0916a9deec29b1862729212a8, and
           `computeConversionProjections` was neither read as a fix target nor edited;
         · `npm run sacred` -> 48/48 byte-identical, `unratified_waivers:0`. This file
           has never been in the 48-entry manifest.

       ── RE-PINNED 2026-08-19 · WAVE 79 · ITEMS 3 AND 4 ────────────────────────
       Previous pin: d75d5aa345f1844414fba788b711a51af9708099897a94716f760d17656a02a3
       New pin:      6171edd84e06ddb6cf1345ea6c232076c083199657011acb8eeeda583d470c12

       WHY THIS MOVED. Two findings from Final Review A, both in this module.
         · ITEM 3 (§D-A3) — THE CLOCK BECAME AN INPUT. `runEngine` and
           `projectPostClose` each read `new Date()` twice, so two assertions pinned
           values that MOVED WITH THE CALENDAR: `W71-D8a` pinned
           `yearsElapsed = "1.2128679"` (the 2026-08-18 value) and measured
           `"1.21560575"` the next day, and `W58CD-B3a` pinned `9991276` as-converted
           shares and measured `9991305` — one day of accrued note interest. Both now
           take an OPTIONAL trailing `asOf`; omitted, it is still today, so EVERY
           EXISTING CALLER IS UNCHANGED. `buildPostCloseComputeOptions` passes it
           through rather than dropping it, because a wrapper that silently discards
           a parameter of the function it wraps is a second authority in disguise
           (R21).
         · ITEM 4 (§D-A4) — A MONTH-END CLAMP IN `deriveMaturityDateFromMonths`.
           `d.setUTCMonth(d.getUTCMonth() + m)` alone rolls over, so twelve months
           from 2024-02-29 derived 2025-03-01 — a twelve-month note maturing in the
           THIRTEENTH month. It now clamps to the last day of the target month (ISDA
           2006 Definitions §4.16 "End of Month"). Still ONE derivation, still
           calendar arithmetic, still `null` rather than a substituted date, and the
           clamp can only move a date EARLIER inside the target month, never into a
           different month.
       No existing export was renamed, removed or re-typed; both new parameters are
       optional and additive.

       VERIFIED BEFORE RE-PINNING (measured, not pasted — transcript in
       build_log/wave79/W79_TESTS.md, digests in
       W79_BLOCK_DIGESTS_BEFORE.txt / W79_BLOCK_DIGESTS_AFTER.txt):
         · the pre-wave hash of this file equalled the OLD pin exactly, so the only
           delta is this wave's;
         · WAIVER-7's SUBJECT IS BYTE-IDENTICAL — all five declaration digests
           recomputed on the pre-Wave-79 file AND on this one, all five equal, and
           equal to the values Waves 71b, 72 and 77 recorded:
             toWireDiscount                c98dbcb03723ff10e970310a1bae1a9a835451196df62c2c8b934a1c16cf7a3e
             readDiscountFraction          61a232cd6a50a94fe7a7549799cce3e4c5776ab0735584a914fb1f2df3ebfd47
             InvalidDiscountWireValueError 86347904fa505846e09c92fd83e3e425644fd813806f9b4bd94dd6e8a85ece05
             toWireInterestRate            f40603bb7ff12eae380512be08b2e0b72e0206b8209ad1c26693b166ab040e1b
             toEngineDiscount              5200e910c76bf095a833b439a7e377260ada9588ec072c6adfca59fb579714a4
         · `toWireDiscount` and `toWireInterestRate` are still ONE DEFINITION each
           (single bridge per quantity, R16/R30 — and MANY CALLERS OF ONE BRIDGE IS
           THE GOAL, not a violation; a previous review filed that as one and was a
           FALSE POSITIVE), and `.div(100)` is unchanged at 3 = the two bridges +
           `describeDiscount`'s prose division (`:300`, `:845`, `:1365`). A FOURTH
           would be a units defect. Neither the clock nor the clamp divides anything
           by 100 and neither goes near a percent;
         · `server/roundCarryForwardEngine.ts` (WAIVER-7's file, R69's standing
           prohibition) is BYTE-IDENTICAL at
           42d04653278caefe85093fff778bdc1c8f0aabc0916a9deec29b1862729212a8, and
           `computeConversionProjections` was neither read as a fix target nor
           edited. Review A explicitly proposed no change to it and Wave 79 proposes
           none either — FOUR agents have now been tempted by that function and the
           first three were all wrong (R69);
         · `npm run sacred` -> 48/48 byte-identical, `unratified_waivers:0`. This file
           has never been in the 48-entry manifest.

       ── RE-PINNED 2026-08-19 · WAVE 80 · ITEM 3 ───────────────────────────────
       Previous pin: 6171edd84e06ddb6cf1345ea6c232076c083199657011acb8eeeda583d470c12
       New pin:      b8ef97f45eef9852f357c34671349770b8d1b64259fb0982f96b95279545c7cd

       WHY THIS MOVED. `PATCH /api/rounds/:id/terms` accepted SIX whitelisted term
       fields with HTTP 200 `{"ok":true}` and discarded them — `cap`, `expiryDate`,
       `poolSize`, `proRata`, `sharesAuthorized`, `useOfProceeds` — and a regression
       test PINNED that drop as correct. Wave 80 removed the drop. This module gained,
       APPENDED AT THE END and nothing else:
         · `SHARES_AUTHORIZED_MAX`, `POOL_SIZE_MAX` — both ALIASES of the existing
           `FD_PRE_MONEY_SHARES_MAX`, so three counts of shares cannot acquire three
           different ceilings;
         · `validateSharesAuthorized`, `validatePoolSize` — thin calls to the EXISTING
           `boundedNumericTerm` helper, with the same parse, the same integrality rule
           and the same refusal shape the five R50 validators already use;
         · `ROUND_CAP_ALIAS_NOT_WRITABLE`, `EXPIRY_DATE_NOT_WRITABLE` — two refusal
           CONSTANTS, structurally identical to Wave 77's `MATURITY_DATE_NOT_WRITABLE`
           and existing for the identical reason: each names a SECOND SPELLING of a
           term the round already stores canonically, and two spellings of one fact
           can disagree with nothing able to say which is true;
         · `validateUseOfProceeds` plus its types and message — a SHAPE validator that
           accepts free text OR structured rows and refuses anything else BY NAME.

       NOT A UNITS CHANGE, AND NOT NEAR ONE. Nothing added divides or multiplies by
       100, nothing added touches a percent, nothing added converts anything, and
       `validateUseOfProceeds` deliberately does NOT derive percentages from text —
       deriving them would mean this platform inventing per-bucket figures a founder
       never entered and printing them on an investor document.

       VERIFIED BEFORE RE-PINNING (measured, not pasted — transcript in
       build_log/wave80/W80_TESTS.md, digests in W80_BLOCK_DIGESTS_AFTER.txt):
         · the pre-wave hash of this file equalled the OLD pin exactly
           (build_log/wave80/W80_BEFORE_HASHES.txt), so the only delta is this wave's;
         · WAIVER-7's SUBJECT IS BYTE-IDENTICAL — all five declaration digests
           recomputed and equal to the values Waves 71b, 72, 77 and 79 recorded:
             toWireDiscount                c98dbcb03723ff10e970310a1bae1a9a835451196df62c2c8b934a1c16cf7a3e
             readDiscountFraction          61a232cd6a50a94fe7a7549799cce3e4c5776ab0735584a914fb1f2df3ebfd47
             InvalidDiscountWireValueError 86347904fa505846e09c92fd83e3e425644fd813806f9b4bd94dd6e8a85ece05
             toWireInterestRate            f40603bb7ff12eae380512be08b2e0b72e0206b8209ad1c26693b166ab040e1b
             toEngineDiscount              5200e910c76bf095a833b439a7e377260ada9588ec072c6adfca59fb579714a4
         · `.div(100)` is UNCHANGED at 3, at the SAME three lines (`:300`, `:845`,
           `:1365`) = the two bridges + `describeDiscount`'s prose division. A FOURTH
           would be a units defect and there is no fourth;
         · no existing export was renamed, removed, re-typed or re-ordered; every
           addition is appended after the final pre-existing declaration;
         · `server/roundCarryForwardEngine.ts` (WAIVER-7's file, R69's standing
           prohibition) is BYTE-IDENTICAL at
           42d04653278caefe85093fff778bdc1c8f0aabc0916a9deec29b1862729212a8, and
           `computeConversionProjections` was neither read as a fix target nor edited.
           FIVE agents have now been tempted by that function; the first three were
           all wrong, and Wave 80 proposes no change to it either (R69);
         · `npm run sacred` -> 48/48 byte-identical, all nine waiver instances
           OWNER-RATIFIED. This file has never been in the 48-entry manifest.

       The two cap-table hashes pinned above did NOT move and must not be re-pinned
       casually — they are sacred files and R34 names them explicitly.
       ────────────────────────────────────────────────────────────────────────── */
    expect(sha(ADAPTER)).toBe("b8ef97f45eef9852f357c34671349770b8d1b64259fb0982f96b95279545c7cd");
  });

  it("W58G-A7 — the waiver is registered at BOTH enforcement points", () => {
    /* The "second-path miss" has happened four times in this project. A waiver in
       one place is a silent hole, so its presence in both is itself asserted. */
    const shell = src("scripts/sacred_check.sh");
    expect(shell).toContain(
      `"${ENGINE}|${PRE_WAIVER_SHA}|${POST_WAIVER_SHA}|WAIVER-7|RATIFIED"`,
    );
    const guard = src("server/__tests__/waveB_retirement_guard.test.ts");
    expect(guard).toContain(POST_WAIVER_SHA);
    expect(guard).toMatch(/"server\/roundCarryForwardEngine\.ts":\s*"WAIVER-7"/);
    expect(guard).toContain('waiver: "WAIVER-7"');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * B — THE INPUT UNIT, VERIFIED RATHER THAN ASSUMED.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58G-B — the input this path receives really is percent-as-written", () => {
  /** Stored discounts the seed actually carries, read live, not retyped. */
  const stored = () =>
    securities
      .filter((s) => s.discount !== null && s.discount !== undefined)
      .map((s) => ({ id: s.id, pct: s.discount as number }));

  it("W58G-B1 — the seed securities hold 20 and 15, i.e. PERCENTS, not fractions", () => {
    /* If this path's input were already fractional, converting it again would
       divide a 20% discount to 0.2% — so the unit is checked before the
       conversion is trusted, exactly as the brief required. */
    const s = stored();
    expect(s.length).toBeGreaterThan(0);
    expect(s.map((x) => `${x.id}=${x.pct}`).sort()).toEqual([
      "sec_4=20",
      "sec_6=20",
      "sec_7=20",
      "sec_8=15",
    ]);
    /* Every stored value is > 1, which no fraction-domain field could be. */
    for (const { id, pct } of s) expect(pct, `${id} is not percent-shaped`).toBeGreaterThan(1);
  });

  it("W58G-B2 — the engine's output equals the shared bridge's output, value for value", () => {
    const result = computeCarryForward({ companyId: CO, proposedRoundType: "priced_equity" });
    expect(result.unrealizedInstruments.length).toBeGreaterThan(0);
    let compared = 0;
    for (const u of result.unrealizedInstruments) {
      const rec = securities.find((s) => s.id === u.instrumentId);
      expect(rec, `no seed security for ${u.instrumentId}`).toBeDefined();
      const raw = rec!.discount;
      if (raw === null || raw === undefined) {
        /* Absent stays absent — the conversion must not invent a zero. */
        expect(u.discount ?? null).toBeNull();
        continue;
      }
      expect(u.discount).toBe(toWireDiscount(raw, u.instrumentId)!.wireFraction);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("W58G-B3 — exact decimal arithmetic: 20 → \"0.2\" and 15 → \"0.15\", not 0.002 and not 20", () => {
    /* Recomputed by hand: 20/100 = 0.2 exactly, 15/100 = 0.15 exactly. Both of
       the ways this can go wrong are asserted against, in both directions. */
    expect(toWireDiscount(20, "w58g-b3")!.wireFraction).toBe("0.2");
    expect(toWireDiscount(15, "w58g-b3")!.wireFraction).toBe("0.15");
    for (const pct of [20, 15]) {
      const w = toWireDiscount(pct, "w58g-b3")!;
      expect(w.asNumber).toBeCloseTo(pct / 100, 12);
      expect(w.asNumber).not.toBeCloseTo(pct / 10000, 12); // double-divided
      expect(w.asNumber).not.toBe(pct); // not converted at all
      expect(w.storedPercent).toBe(String(pct)); // the stored value is preserved
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * C — PROVEN THROUGH THE LIVE HTTP ROUTE. BOTH POLES.
 *     GET /api/founder/companies/:companyId/carry-forward
 *     (roundCarryForwardRoutes.ts:485 → computeCarryForwardLive → … →
 *      discountAsDecimalStr)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58G-C — the live route serves the SHARED conversion", () => {
  it("W58G-C1 — 200, and every instrument's discount is the shared bridge's value", async () => {
    const res = await request(app).get(CF_URL).set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const inst = res.body.result.unrealizedInstruments as Array<{
      instrumentId: string;
      discount: string | null;
    }>;
    expect(inst.length).toBeGreaterThan(0);
    for (const u of inst) {
      const raw = securities.find((s) => s.id === u.instrumentId)?.discount ?? null;
      const expected = raw === null ? null : toWireDiscount(raw, u.instrumentId)!.wireFraction;
      expect(u.discount ?? null, `${u.instrumentId} discount over the wire`).toBe(expected);
    }
    /* Named concretely so the assertion cannot be satisfied by an empty-ish shape. */
    expect(inst.find((u) => u.instrumentId === "sec_4")?.discount).toBe("0.2");
    expect(inst.find((u) => u.instrumentId === "sec_8")?.discount).toBe("0.15");
  });

  it("W58G-C2 — what the FOUNDER READS is unchanged: the rationale still says 20%", async () => {
    /* The wire unit changed representation ("0.200000" → "0.2"); the displayed
       percentage must not have. This is the regression a reader would notice. */
    const res = await request(app).get(CF_URL).set("x-user-id", ADMIN);
    const sec4 = (res.body.result.unrealizedInstruments as Array<{ instrumentId: string; rationale: string }>)
      .find((u) => u.instrumentId === "sec_4");
    expect(sec4?.rationale).toContain("(1 − 20% discount)");
    expect(sec4?.rationale).not.toContain("0.2% discount");
    expect(sec4?.rationale).not.toContain("2000% discount");
  });

  it("W58G-C3 — REFUSAL POLE: an out-of-domain stored discount is rejected by name, not converted", async () => {
    /* This is the harm Wave 58f could only measure. With the local division, a
       corrupt `20260707` became a wire "fraction" of 202607.07 and flowed into
       `× (1 − d)` — a catastrophic negative price served with HTTP 200. With the
       shared bridge, `InvalidDiscountWireValueError` refuses it and names the
       STORED value. The corrupt row is injected into the seed array the engine
       actually reads, then removed, with removal asserted. */
    const base = securities.find((s) => s.id === "sec_4");
    expect(base, "seed anchor sec_4 is missing — re-derive this test").toBeDefined();
    const corrupt = { ...base!, id: "sec_w58g_corrupt", discount: 20260707 };
    (securities as unknown as unknown[]).push(corrupt);
    let status = -1;
    let text = "";
    try {
      const res = await request(app).get(CF_URL).set("x-user-id", ADMIN);
      status = res.status;
      text = String(res.text ?? "");
    } finally {
      const i = securities.findIndex((s) => s.id === "sec_w58g_corrupt");
      if (i >= 0) (securities as unknown as unknown[]).splice(i, 1);
    }
    /* The seed is left exactly as it was found. */
    expect(securities.some((s) => s.id === "sec_w58g_corrupt")).toBe(false);

    /* THE POLE: the route did NOT answer 200 with a nonsense fraction. */
    expect(status).not.toBe(200);
    expect(text).not.toContain("202607.07");
    expect(text).toContain("InvalidDiscountWireValueError");
    expect(text).toContain("20260707"); // the STORED value, which is what the founder can see
  });

  it("W58G-C4 — and the legal path still answers 200 AFTER the corrupt row is gone", async () => {
    /* Both poles in one wave: a refusal that also broke the good path would be a
       regression dressed as a safeguard. */
    const res = await request(app).get(CF_URL).set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(
      (res.body.result.unrealizedInstruments as Array<{ discount: string | null }>).some(
        (u) => u.discount === "0.2",
      ),
    ).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D — THE SOLE ARBITER, AND THE HEURISTIC THAT STAYS FORBIDDEN.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58G-D — one [0,1] arbiter, and no magnitude heuristic", () => {
  it("W58G-D1 — the engine contains NO [0,1] domain check of its own", () => {
    /* R34: `InvalidDiscountWireValueError` must not be weakened, bypassed OR
       DUPLICATED. Delegating the conversion must not have copied the guard. */
    const stripped = src(ENGINE)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toContain("InvalidDiscountWireValueError");
    expect(stripped).not.toMatch(/readDiscountFraction/);
    expect(stripped).not.toMatch(/>\s*1\s*\)/); // no bare "greater than 1" fence
  });

  it("W58G-D2 — the arbiter still throws, and still names the security", () => {
    expect(() => toWireDiscount(20260707, "w58g-d2")).toThrow(InvalidDiscountWireValueError);
    try {
      toWireDiscount(20260707, "w58g-d2");
      expect.unreachable("out-of-domain discount was accepted");
    } catch (e) {
      expect((e as Error).name).toBe("InvalidDiscountWireValueError");
      expect((e as Error).message).toContain("w58g-d2");
      expect((e as Error).message).toContain("20260707");
    }
  });

  it("W58G-D3 — the magnitude heuristic is still absent from live code (R16)", () => {
    const stripped = src(ADAPTER)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/[><]\s*1\s*\?\s*[a-zA-Z]+\s*\/\s*100/);
    /* And the conversion is UNCONDITIONAL: no comparison guards the division. */
    expect(stripped).toContain("pct.div(100)");
  });

  it("W58G-D4 — absent stays absent: a null stored discount yields null, never 0", () => {
    /* The engine's null-branch is the one piece of `discountAsDecimalStr`'s old
       behaviour that had to survive the waiver unchanged. */
    expect(toWireDiscount(null, "w58g-d4")).toBeUndefined();
    expect(toWireDiscount(undefined, "w58g-d4")).toBeUndefined();
    const fn = conversionFn();
    expect(fn).toContain("if (rawDiscount == null) return null;");
    expect(fn).toContain("?? null");
  });
});

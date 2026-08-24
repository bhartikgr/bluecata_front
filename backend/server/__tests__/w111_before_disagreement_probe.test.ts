/**
 * WAVE 111 — THE DISAGREEMENT, MEASURED BEFORE ANYTHING IS CHANGED.
 *
 * This file does NOT assert a fix. It measures, shape by shape, what each of the
 * four surfaces that interpret a round's liquidation preference concludes from the
 * SAME two stored fields, and prints the table into the test output so the number
 * in `W111_PREFLIGHT.md` is a measurement rather than a claim.
 *
 * THE REFERENCE IS THE ENGINE. `server/lib/roundStoredTerms.ts` + the refusal gate
 * in `server/track1Routes.ts` decide whether the exit waterfall computes or refuses
 * with 422. They were independently verified and are NOT changed by this wave.
 *
 * WHY TWO SURFACES ARE TRANSCRIBED RATHER THAN IMPORTED. The Terms-tab row is an
 * inline IIFE inside JSX (`client/src/pages/founder/RoundDetail.tsx`) and the
 * waterfall gate is inline inside a route handler; neither is an exported function
 * — which is itself the finding. Both transcriptions are SOURCE-LOCKED below: the
 * test reads the real file and fails if the code it transcribes is not there, so
 * the table cannot silently describe code that no longer exists.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const STORE: Record<string, Record<string, unknown>> = {};
vi.mock("../roundsStore", () => ({
  getRoundById: (id: string) => STORE[id] ?? null,
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
import { roundStoredTerms } from "../lib/roundStoredTerms";
/* The shapes and the definition of agreement are shared with
   `w111_one_term_reader_agreement.test.ts` so the BEFORE table and the AFTER fence
   can never measure different things. */
import { SHAPES, committedAgree, legacyClientRead, legacyTermsTabCommitted, type Shape, type Committed } from "./_w111TermShapes";

const ROOT = path.resolve(__dirname, "../..");
const ROUND_DETAIL = path.join(ROOT, "client/src/pages/founder/RoundDetail.tsx");
const TRACK1 = path.join(ROOT, "server/track1Routes.ts");
const TEMPLATES = path.join(ROOT, "client/src/lib/termsheet/templates.ts");

/** WHAT THE ENGINE CONCLUDES: `decided <m>x <part> cap <c>` or `REFUSES:<name>`. */
function engineConclusion(s: Shape): string {
  const id = `r_${s.id}`;
  STORE[id] = { id, liquidationPreference: s.liquidationPreference, capParticipation: s.capParticipation };
  const t = roundStoredTerms(id);
  /* Transcribed from `server/track1Routes.ts`, in its order. Source-locked below. */
  if (t.liquidationPreferenceMultiple === null || t.participatingPreferred === null) return "REFUSES:liquidation_term_not_on_record";
  if (t.participationCapUnreadable) return "REFUSES:participation_cap_not_readable";
  if (t.participationCapConflict) return "REFUSES:participation_cap_conflict";
  if (
    t.participationCapMultiple !== null &&
    t.participatingPreferred === true &&
    t.participationCapMultiple < t.liquidationPreferenceMultiple
  ) return "REFUSES:participation_cap_below_preference";
  const cap =
    t.participatingPreferred === true
      ? t.participationCapMultiple === null ? "uncapped" : `cap ${t.participationCapMultiple}x`
      : "cap n/a";
  return `decided ${t.liquidationPreferenceMultiple}x ${t.participatingPreferred ? "participating" : "non-participating"} ${cap}`;
}

/** WHAT THE TERMS TAB PRINTS — transcription of the inline IIFE, source-locked. */
function termsTabPrints(s: Shape): string {
  const raw = s.liquidationPreference;
  const stored = raw === null || raw === undefined ? "" : String(raw).trim();
  if (stored === "") return "Not recorded on this round — record it on Edit terms so an exit can be modelled";
  const participating = !/non[-\s]?participating/i.test(stored) && /participating/i.test(stored);
  const capRaw = s.capParticipation;
  const cap = capRaw === null || capRaw === undefined ? "" : String(capRaw).trim();
  if (!participating) return stored;
  if (cap === "") return `${stored} · no participation cap recorded`;
  return `${stored} · participation capped at ${cap}× the invested amount`;
}

/** WHAT THE TERM SHEET PRINTED — the pre-wave client reader, plus the template's
 *  own conditional. */
function termSheetPrints(s: Shape): string {
  const x = legacyClientRead(s);
  if (x.liqPrefMultiple === null || x.participating === null) return "REFUSES:not_on_record";
  if (!x.participating) return `${x.liqPrefMultiple}x non-participating (cap n/a)`;
  return `${x.liqPrefMultiple}x participating ${x.capParticipation ? `cap ${x.capParticipation}x` : "no cap on participation recorded"}`;
}

/** WHAT EDIT TERMS WARNS — `PATCH /api/rounds/:id/terms`, transcribed. It only ever
 *  looks at the multiple and the word "participating"; it never looks at a cap. */
function editTermsWarns(s: Shape): string {
  const lpText = s.liquidationPreference === null || s.liquidationPreference === undefined ? "" : String(s.liquidationPreference).trim();
  if (lpText === "") return "no warning (field removed)";
  const lpLower = lpText.toLowerCase();
  const mult = /(^|[^0-9.])([0-9]+(?:\.[0-9]+)?)\s*x\b/.exec(lpLower);
  const multOk = Boolean(mult) && Number(mult![2]) > 0 && Number(mult![2]) <= 10;
  const partOk = /participating/.test(lpLower);
  return multOk && partOk ? "saved, no warning — the waterfall can use it" : "saved with a warning — the waterfall cannot use it";
}

/* ── THE COMMITTED CONCLUSION OF EACH SURFACE, read off the same fields ───────── */

function engineCommitted(s: Shape): Committed {
  const c = engineConclusion(s);
  if (c.startsWith("REFUSES")) return { refuses: true };
  const m = /^decided ([0-9.]+)x (participating|non-participating) (uncapped|cap ([0-9.]+)x|cap n\/a)$/.exec(c)!;
  const part = m[2] === "participating";
  return {
    refuses: false,
    multiple: Number(m[1]),
    participating: part,
    /* A cap on a class that does not participate can never bind, so no surface is
       asked to agree about one. */
    cap: part ? (m[3] === "uncapped" ? null : m[4]) : undefined,
  };
}

const termsTabCommitted = legacyTermsTabCommitted;

function termSheetCommitted(s: Shape): Committed {
  const x = legacyClientRead(s);
  if (x.liqPrefMultiple === null || x.participating === null) return { refuses: true };
  return {
    refuses: false,
    multiple: x.liqPrefMultiple,
    participating: x.participating,
    cap: x.participating ? (x.capParticipation === "" ? null : x.capParticipation) : undefined,
  };
}

describe("WAVE 111 · BEFORE — the four interpreters of one round's terms", () => {
  it("the surfaces this table measured no longer read the terms themselves", () => {
    /* BEFORE the wave this test asserted the transcribed code WAS there. It now
       asserts it is GONE, which is the same fence pointing the other way: if a
       display surface ever grows its own preference or cap regex again, the two
       screens can disagree again, and this fails. */
    const rd = fs.readFileSync(ROUND_DETAIL, "utf8");
    expect(rd).not.toContain("const participating = !/non[-\\s]?participating/i.test(stored) && /participating/i.test(stored);");
    expect(rd).toContain("describeLiquidationTerms(readLiquidationTerms({");
    /* THE ENGINE'S REFUSAL GATE IS UNTOUCHED — this wave changed no condition in it,
       and these three lines are the proof that it still reads exactly as it did. */
    const t1 = fs.readFileSync(TRACK1, "utf8");
    expect(t1).toContain("if (terms.liquidationPreferenceMultiple === null || terms.participatingPreferred === null) {");
    expect(t1).toContain("if (terms.participationCapUnreadable) {");
    expect(t1).toContain("if (terms.participationCapConflict) {");
  });

  it("prints the shape-by-shape table and counts the shapes that disagree", () => {
    const rows: string[] = [];
    let disagree = 0;
    let surfaceMismatches = 0;
    for (const s of SHAPES) {
      const e = engineCommitted(s);
      const tabBad = !committedAgree(e, termsTabCommitted(s));
      const sheetBad = !committedAgree(e, termSheetCommitted(s));
      if (tabBad) surfaceMismatches += 1;
      if (sheetBad) surfaceMismatches += 1;
      const bad = tabBad || sheetBad;
      if (bad) disagree += 1;
      rows.push(
        [
          s.id,
          bad ? `DISAGREE(${tabBad ? "tab" : ""}${tabBad && sheetBad ? "+" : ""}${sheetBad ? "sheet" : ""})` : "agree",
          JSON.stringify(s.liquidationPreference),
          JSON.stringify(s.capParticipation ?? null),
          engineConclusion(s),
          termsTabPrints(s),
          termSheetPrints(s),
          editTermsWarns(s),
        ].join(" | "),
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      "\nW111 BEFORE TABLE\nid | verdict | liquidationPreference | capParticipation | ENGINE | TERMS TAB | TERM SHEET | EDIT TERMS\n" +
        rows.join("\n") +
        `\n\nDISAGREEING SHAPES: ${disagree} of ${SHAPES.length}   SURFACE-LEVEL MISMATCHES: ${surfaceMismatches} of ${SHAPES.length * 2}\n`,
    );
    /* THE MEASUREMENT, RECORDED. 8 of 16 shapes disagreed with the engine and 13 of
       the 32 surface-to-engine pairings mismatched, and this is now a fixed
       historical fact about the pre-Wave-111 code rather than a live reading. */
    expect(disagree).toBe(8);
    expect(surfaceMismatches).toBe(13);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 111 — ONE READER: EVERY SURFACE REACHES THE SAME CONCLUSION.
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FENCES. A round created as 1x participating with a 3x
 * participation cap was described differently by every screen that described it.
 * Wave 107 removed a hardcoded "1x non-participating preferred" from the round's
 * Terms tab and surfaced the cap — and the disagreement MOVED ONE FIELD OVER: the
 * new cap row read `capParticipation` and nothing else, while the exit waterfall
 * reads that key AND the free-text `liquidationPreference` and refuses with HTTP
 * 422 when the two disagree, when a recorded cap cannot be read as a multiple, or
 * when a cap sits below the preference it caps. MEASURED over 16 ordinary term
 * shapes (`w111_before_disagreement_probe.test.ts`): 8 shapes disagreed with the
 * calculation, 13 of 32 surface-to-engine pairings mismatched. The Terms tab
 * printed "participation capped at 3×" where the engine REFUSES, and "no
 * participation cap recorded" where the engine APPLIES 2.5×.
 *
 * HOW THIS TEST IS BUILT, AND WHY IT IS BUILT THAT WAY. It does NOT assert each
 * surface against a hardcoded expected string. That is precisely how two screens
 * came to disagree: each had its own test, each test passed, and the two answers
 * were never compared to one another. This test computes what EVERY surface
 * concludes from the same two stored fields and asserts THE SURFACES AGREE WITH
 * EACH OTHER, with the engine as the reference — the engine's arithmetic and its
 * refusal conditions were independently verified and this wave changes neither.
 *
 * A surface's conclusion is read out of the words it actually prints, so a screen
 * cannot pass by holding a correct value it does not display.
 *
 * THE ENGINE IS NOT MODIFIED BY THIS WAVE. `server/track1Routes.ts`'s four refusal
 * branches are transcribed here in their own order and source-locked against the
 * file, so this test fails if that gate is edited rather than silently re-basing.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const STORE: Record<string, Record<string, unknown>> = {};
vi.mock("../roundsStore", () => ({
  getRoundById: (id: string) => STORE[id] ?? null,
}));

import { roundStoredTerms } from "../lib/roundStoredTerms";
import {
  readLiquidationTerms,
  decideLiquidationTerms,
  readLiquidationTermFacts,
  describeLiquidationTerms,
} from "../../shared/liquidationTermsReader";
import { readNegotiatedTerms } from "../../client/src/lib/termsheet/roundNegotiatedTerms";
import { getTemplate } from "../../client/src/lib/termsheet/templates";
import type { TermSheetData } from "../../client/src/lib/termsheet/types";
import {
  SHAPES,
  committedAgree,
  legacyTermsTabCommitted,
  legacyTermSheetCommitted,
  type Shape,
  type Committed,
} from "./_w111TermShapes";

const ROOT = path.resolve(__dirname, "../..");
const F = {
  roundDetail: path.join(ROOT, "client/src/pages/founder/RoundDetail.tsx"),
  rounds: path.join(ROOT, "client/src/pages/founder/Rounds.tsx"),
  waterfall: path.join(ROOT, "client/src/pages/founder/ExitWaterfall.tsx"),
  termSheetPage: path.join(ROOT, "client/src/pages/founder/TermSheet.tsx"),
  clientReader: path.join(ROOT, "client/src/lib/termsheet/roundNegotiatedTerms.ts"),
  routes: path.join(ROOT, "server/routes.ts"),
  track1: path.join(ROOT, "server/track1Routes.ts"),
  storedTerms: path.join(ROOT, "server/lib/roundStoredTerms.ts"),
  shared: path.join(ROOT, "shared/liquidationTermsReader.ts"),
};
const read = (p: string) => fs.readFileSync(p, "utf8");

/* ── WHAT A SURFACE COMMITS TO ────────────────────────────────────────────────
   `refuses` means the surface says the terms cannot be read. Otherwise it states
   whichever of the three terms it states; `undefined` is "says nothing about it"
   and is not compared, because a cap on a class that does not participate can
   never bind and no surface is asked to agree about one. */
/* `Committed` and the 16 shapes live in `./_w111TermShapes`, shared with the BEFORE
   measurement so the two cannot drift. */

/** Read a surface's conclusion out of the WORDS IT PRINTS. Both the screen wording
 *  ("participation capped at 2× the invested amount") and the legal wording of the
 *  term sheet ("a participation cap of 2× the Original Issue Price") are accepted;
 *  a refusal is recognised by any of the plain-English forms the platform uses. */
function claimsFromText(text: string): Committed {
  const t = text.trim();
  if (
    /cannot be read/i.test(t) ||
    /NOT ON RECORD/i.test(t) ||
    /Not recorded on this round/i.test(t) ||
    /not available/i.test(t)
  ) {
    return { refuses: true };
  }
  const mm = /([0-9]+(?:\.[0-9]+)?)\s*[x\u00d7]/.exec(t);
  const multiple = mm ? Number(mm[1]) : null;
  const participating = /non[-\s]?participating/i.test(t)
    ? false
    : /participating/i.test(t)
      ? true
      : null;
  let cap: string | null | undefined;
  const capM =
    /participation capped at ([0-9]+(?:\.[0-9]+)?)\s*\u00d7/i.exec(t) ??
    /participation cap of ([0-9]+(?:\.[0-9]+)?)\s*\u00d7/i.exec(t);
  if (capM) cap = capM[1];
  else if (/no (?:participation )?cap on participation recorded|no participation cap recorded/i.test(t)) cap = null;
  else cap = undefined;
  return { refuses: false, multiple, participating, cap: participating === true ? cap : undefined };
}

function put(s: Shape): string {
  const id = `w111_${s.id}`;
  STORE[id] = { id, liquidationPreference: s.liquidationPreference, capParticipation: s.capParticipation };
  return id;
}

/* ══ SURFACE 1 — THE ENGINE (the reference). ═══════════════════════════════════
   `server/lib/roundStoredTerms.ts` reads the round; the four branches below are
   `server/track1Routes.ts`'s refusal gate in its own order, transcribed because it
   is inline in the route handler and not an exported function. Source-locked. */
function engineCommitted(s: Shape): Committed {
  const t = roundStoredTerms(put(s));
  if (t.liquidationPreferenceMultiple === null || t.participatingPreferred === null) return { refuses: true };
  if (t.participationCapUnreadable) return { refuses: true };
  if (t.participationCapConflict) return { refuses: true };
  if (
    t.participationCapMultiple !== null &&
    t.participatingPreferred === true &&
    t.participationCapMultiple < t.liquidationPreferenceMultiple
  ) return { refuses: true };
  return {
    refuses: false,
    multiple: t.liquidationPreferenceMultiple,
    participating: t.participatingPreferred,
    cap:
      t.participatingPreferred === true
        ? t.participationCapMultiple === null
          ? null
          : String(t.participationCapMultiple)
        : undefined,
  };
}

/* ══ SURFACE 2 — THE SHARED DECISION ITSELF. ══════════════════════════════════ */
function decisionCommitted(s: Shape): Committed {
  const d = readLiquidationTerms({
    liquidationPreference: s.liquidationPreference,
    capParticipation: s.capParticipation,
  });
  if (!d.determined) return { refuses: true };
  return {
    refuses: false,
    multiple: d.multiple,
    participating: d.participating,
    cap: d.participating ? (d.capMultiple === null ? null : String(d.capMultiple)) : undefined,
  };
}

/* ══ SURFACE 3 — THE ROUND'S TERMS TAB. ══════════════════════════════════════
   `client/src/pages/founder/RoundDetail.tsx`'s "Liquidation preference" row is one
   expression, transcribed here and source-locked. */
function termsTabCommitted(s: Shape): Committed {
  return claimsFromText(
    describeLiquidationTerms(
      readLiquidationTerms({
        liquidationPreference: s.liquidationPreference,
        capParticipation: s.capParticipation,
      }),
    ),
  );
}

/* ══ SURFACE 4 — THE EDIT-TERMS READBACK. ════════════════════════════════════
   `client/src/pages/founder/Rounds.tsx`'s dialog now shows what the one reader will
   make of what is being typed, against the round's stored cap. Same expression as
   the Terms tab, which is the point: source-locked, not re-derived. */
const editTermsReadbackCommitted = termsTabCommitted;

/* ══ SURFACE 5 — THE TERM SHEET CLAUSE, RENDERED. ════════════════════════════ */
function termSheetCommitted(s: Shape): Committed {
  const t = readNegotiatedTerms({
    liquidationPreference: s.liquidationPreference,
    capParticipation: s.capParticipation,
  });
  const d: Partial<TermSheetData> = {
    liqPrefMultiple: t.liqPrefMultiple,
    participating: t.participating,
    capParticipation: t.capParticipation,
    liquidationPreferenceRaw: t.liquidationPreferenceRaw,
    ...(t.decision.determined ? {} : { liquidationTermsNotice: describeLiquidationTerms(t.decision) }),
  };
  const tpl = getTemplate("US", "preferred", d as TermSheetData);
  const section = tpl.sections.filter((x) => x.id === "liq")[0];
  expect(section, "the liquidation clause is missing from the US preferred template").toBeDefined();
  return claimsFromText(section.body(d as TermSheetData));
}

/* ══ SURFACE 6 — THE EXIT-WATERFALL SCREEN'S OWN TERM CELL. ══════════════════
   `client/src/pages/founder/ExitWaterfall.tsx` renders the preferred rows from the
   SERVER's published fields. The cell is transcribed and source-locked. It only
   ever states the multiple and participation, never a cap, so `cap` is left
   uncompared for this surface. */
const EXACT_MONEY_UNAVAILABLE = "Not available — the exact figure could not be computed";
function waterfallCellCommitted(s: Shape): Committed {
  const t = roundStoredTerms(put(s));
  const multiple = t.liquidationPreferenceMultiple;
  const participating = t.participatingPreferred;
  const text =
    multiple === null || participating === null
      ? EXACT_MONEY_UNAVAILABLE
      : `${multiple}x ${participating ? "participating" : "non-participating"}`;
  const c = claimsFromText(text);
  return { ...c, cap: undefined };
}

/** The engine's own gate is what makes a row appear at all: where it refuses, the
 *  screen shows the 422, not a row. So this surface is compared only on the shapes
 *  the engine accepts, and on those it must say the same multiple and the same
 *  participation word. */
const SURFACES: Array<{
  name: string;
  of: (s: Shape) => Committed;
  onlyWhenEngineAccepts?: boolean;
}> = [
  { name: "shared decision", of: decisionCommitted },
  { name: "round Terms tab", of: termsTabCommitted },
  { name: "Edit-terms readback", of: editTermsReadbackCommitted },
  { name: "term sheet clause", of: termSheetCommitted },
  { name: "exit waterfall row", of: waterfallCellCommitted, onlyWhenEngineAccepts: true },
];

describe("WAVE 111 — one reader: every surface agrees with the exit waterfall", () => {
  it("W111-T-01 · all 16 term shapes: every surface reaches the SAME conclusion", () => {
    const rows: string[] = [];
    const failures: string[] = [];
    for (const s of SHAPES) {
      const e = engineCommitted(s);
      const cells: string[] = [];
      for (const surface of SURFACES) {
        if (surface.onlyWhenEngineAccepts && e.refuses) { cells.push("n/a (row not shown)"); continue; }
        const c = surface.of(s);
        cells.push(`${c.refuses ? "refuses" : `${c.multiple ?? "-"}x ${c.participating === null ? "?" : c.participating ? "part" : "non-part"} ${c.cap === undefined ? "" : c.cap === null ? "uncapped" : `cap ${c.cap}x`}`.trim()}`);
        /* THE AGREEMENT ASSERTION — surface against surface, via the reference.
           Not "this surface printed the string we expected". */
        if (!committedAgree(e, c)) {
          failures.push(
            `${s.id} (${s.note}): ${surface.name} says ${JSON.stringify(c)} but the exit waterfall ` +
            `says ${JSON.stringify(e)} — ${JSON.stringify(s.liquidationPreference)} / cap key ` +
            `${JSON.stringify(s.capParticipation ?? null)}`,
          );
        }
      }
      rows.push([s.id, e.refuses ? "engine REFUSES" : "engine decides", ...cells].join(" | "));
    }
    // eslint-disable-next-line no-console
    console.log(
      "\nW111 AFTER TABLE\nid | engine | " + SURFACES.map((x) => x.name).join(" | ") + "\n" + rows.join("\n") + "\n",
    );
    expect(failures.join("\n") || "all surfaces agree").toBe("all surfaces agree");
  });

  it("W111-T-02 · the two REPORTED cases: the tab and the sheet now say what the engine says", () => {
    /* REPORTED A — the wording caps at 2x, the round's cap key says 3. The engine
       refuses (`participation_cap_conflict`); the Terms tab used to print
       "participation capped at 3× the invested amount" and the term sheet "with no
       cap on participation recorded" — three answers to one question. */
    const a = SHAPES.filter((s) => s.id === "S03")[0];
    expect(engineCommitted(a).refuses).toBe(true);
    for (const surface of SURFACES) {
      if (surface.onlyWhenEngineAccepts) continue;
      expect(surface.of(a).refuses, `${surface.name} must refuse on the conflicting-cap round`).toBe(true);
    }
    const tabA = describeLiquidationTerms(readLiquidationTerms({
      liquidationPreference: a.liquidationPreference, capParticipation: a.capParticipation,
    }));
    expect(tabA).not.toContain("capped at 3");
    expect(tabA).toMatch(/TWO participation caps on record and they disagree/);

    /* REPORTED B — 2.5x cap in the wording only. The engine APPLIES it; the Terms
       tab used to print "no participation cap recorded". */
    const b = SHAPES.filter((s) => s.id === "S04")[0];
    const eb = engineCommitted(b);
    expect(eb.refuses).toBe(false);
    expect(eb.cap).toBe("2.5");
    for (const surface of SURFACES) {
      const c = surface.of(b);
      expect(c.refuses, `${surface.name} must not refuse where the engine computes`).toBe(false);
      if (c.cap !== undefined) expect(String(c.cap), `${surface.name} must state the 2.5x cap`).toBe("2.5");
    }
    const tabB = describeLiquidationTerms(readLiquidationTerms({
      liquidationPreference: b.liquidationPreference, capParticipation: b.capParticipation,
    }));
    expect(tabB).not.toContain("no participation cap recorded");
    expect(tabB).toContain("participation capped at 2.5× the invested amount");
  });

  it("W111-T-03 · terms that CANNOT be determined: every surface says so, and none prints a term", () => {
    /* Three ways to be undeterminable, one from each family: an incomplete wording,
       a cap asserted without a number, and two caps that disagree. */
    for (const id of ["S05", "S08", "S03", "S10", "S11", "S14"]) {
      const s = SHAPES.filter((x) => x.id === id)[0];
      expect(engineCommitted(s).refuses, `${id} must be a refusing shape`).toBe(true);
      for (const surface of SURFACES) {
        if (surface.onlyWhenEngineAccepts) continue;
        const c = surface.of(s);
        expect(c.refuses, `${surface.name} must refuse on ${id}`).toBe(true);
      }
      /* AND THE WORDS THEMSELVES: no multiple, no cap, in plain English. The stored
         wording may be QUOTED so a founder can see what is on record — the quote is
         removed before the assertion, because quoting the input is not asserting a
         term. */
      const tab = describeLiquidationTerms(readLiquidationTerms({
        liquidationPreference: s.liquidationPreference, capParticipation: s.capParticipation,
      }));
      const withoutQuotes = tab.replace(/\u201c[^\u201d]*\u201d/g, "\u201c\u2026\u201d");
      expect(withoutQuotes, `${id}: the tab must not print a cap multiple`).not.toMatch(/capped at [0-9]/);
      expect(withoutQuotes, `${id}: the tab must say plainly that it cannot be read`).toMatch(
        /Cannot be read|Not recorded on this round/,
      );
    }
  });

  it("W111-T-04 · source-lock: exactly ONE interpreter — no display surface parses terms itself", () => {
    /* The regexes that read a preference, a participation word or a cap out of text
       may appear in ONE file. If they reappear anywhere else, two screens can
       disagree again — which is the entire defect, twice over. */
    const shared = read(F.shared);
    expect(shared).toContain("const m = /(^|[^0-9.])([0-9]+(?:\\.[0-9]+)?)\\s*x\\b/.exec(lp);");
    expect(shared).toContain("if (/non[-\\s]?participating/.test(lp)) participating = false;");

    const consumers: Array<[string, string]> = [
      ["RoundDetail.tsx", F.roundDetail],
      ["Rounds.tsx", F.rounds],
      ["ExitWaterfall.tsx", F.waterfall],
      ["roundNegotiatedTerms.ts", F.clientReader],
      ["routes.ts", F.routes],
      ["roundStoredTerms.ts", F.storedTerms],
    ];
    for (const [name, file] of consumers) {
      const src = read(file);
      /* Comments are stripped first: these files DESCRIBE the old regexes at length,
         and a description is documentation, not a second interpreter. */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${name} must not parse a participation word itself`).not.toMatch(/non\[-\\s\]\?participating/);
      expect(code, `${name} must not parse a cap out of text itself`).not.toMatch(/capped\\s\+at/);
    }

    /* And each consumer really does call the one reader. */
    expect(read(F.roundDetail)).toContain("describeLiquidationTerms(readLiquidationTerms({");
    expect(read(F.rounds)).toContain("describeLiquidationTerms(readLiquidationTerms({");
    expect(read(F.clientReader)).toContain('from "@shared/liquidationTermsReader"');
    expect(read(F.termSheetPage)).toContain('from "@shared/liquidationTermsReader"');
    expect(read(F.routes)).toContain('from "../shared/liquidationTermsReader"');
    expect(read(F.storedTerms)).toContain("readLiquidationTermFacts");

    /* THE ENGINE IS UNTOUCHED: its four refusal branches read exactly as before. */
    const t1 = read(F.track1);
    expect(t1).toContain("if (terms.liquidationPreferenceMultiple === null || terms.participatingPreferred === null) {");
    expect(t1).toContain("if (terms.participationCapUnreadable) {");
    expect(t1).toContain("if (terms.participationCapConflict) {");
    expect(t1).toContain("terms.participationCapMultiple < terms.liquidationPreferenceMultiple");
  });

  it("W111-T-06 · THIS FENCE FAILS ON THE PRE-WAVE CODE — run against it, here is what it catches", () => {
    /* A green test proves nothing unless it could have been red. The two surfaces
       this wave converged are transcribed as they stood this morning in
       `./_w111TermShapes` and pushed through the SAME agreement predicate the live
       surfaces are held to above. It reports failures on 8 of the 16 shapes,
       including both of the cases the reviewer reported. */
    const caught: string[] = [];
    for (const s of SHAPES) {
      const e = engineCommitted(s);
      if (!committedAgree(e, legacyTermsTabCommitted(s))) caught.push(`${s.id}:terms-tab`);
      if (!committedAgree(e, legacyTermSheetCommitted(s))) caught.push(`${s.id}:term-sheet`);
    }
    // eslint-disable-next-line no-console
    console.log(`\nW111 THE FENCE, RUN ON THE PRE-WAVE CODE, CATCHES: ${caught.join(", ")}\n`);
    /* The reported pair, by name: the conflicting cap the tab called "3×" and the
       sheet called "no cap", and the 2.5× cap the tab called "no cap". */
    expect(caught).toContain("S03:terms-tab");
    expect(caught).toContain("S03:term-sheet");
    expect(caught).toContain("S04:terms-tab");
    expect(new Set(caught.map((c) => c.split(":")[0])).size).toBe(8);
    expect(caught.length).toBe(13);
  });

  it("W111-T-05 · the Edit-terms warning cannot contradict the refusal it exists to prevent", () => {
    /* `PATCH /api/rounds/:id/terms` warns when the saved wording is not usable. It
       now asks the ONE reader instead of restating its regexes, so a warning appears
       exactly where the waterfall would refuse for want of a multiple or a
       participation word — never on a wording the waterfall accepts. */
    for (const s of SHAPES) {
      const lpText = s.liquidationPreference === null || s.liquidationPreference === undefined
        ? "" : String(s.liquidationPreference).trim();
      if (lpText === "") continue;
      const facts = readLiquidationTermFacts({ liquidationPreference: lpText });
      const warns = facts.multiple === null || facts.participating === null;
      const engineNeedsMore = !decideLiquidationTerms(
        readLiquidationTermFacts({ liquidationPreference: s.liquidationPreference, capParticipation: s.capParticipation }),
      ).determined;
      if (warns) {
        expect(engineNeedsMore, `${s.id}: a warning was shown for terms the waterfall accepts`).toBe(true);
      }
    }
  });
});

/**
 * WAVE 92 · ITEM 3 — THE TERM SHEET READS THE ROUND, AND SAYS SO WHEN IT CANNOT.
 * ════════════════════════════════════════════════════════════════════════════
 * Open item `N-3`, raised as `OQ-W94-2`. `client/src/pages/founder/TermSheet.tsx`
 * seeded three negotiated terms with LITERALS — `1`, `false` and the WORD
 * "non-participating" — in the object that generates a document a founder SENDS TO
 * AN INVESTOR. A company with "2× participating, capped at 3×" on record generated
 * a term sheet asserting "1× non-participating", and the third literal sat in a
 * slot the template renders as a MULTIPLE, so it would have printed *"a
 * participation cap of non-participating× the Original Issue Price"* — invisible
 * only because the clause was gated on the hardcoded `false`.
 *
 * The liquidation preference is also the one term the exit waterfall computes from,
 * so the platform could print one liquidation term while modelling another.
 *
 * TWO THINGS ARE PINNED HERE:
 *   `W92-T-01` — the client reader AGREES WITH THE SERVER READER on every input,
 *     including every shape the server documents as refused. This is what keeps
 *     R21 true across a duplication that cannot be avoided (the server reader
 *     touches the database and cannot be imported into the browser). If a later
 *     wave changes the server's domain, this test goes red and names the file.
 *   `W92-T-02..` — ABSENT MEANS ABSENT: the clause states that the term is not on
 *     record, quotes whatever wording IS stored, and never prints a default.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  readLiqPrefMultiple,
  readNegotiatedTerms,
  readParticipating,
} from "../roundNegotiatedTerms";
import { getTemplate } from "../templates";
import type { TermSheetData } from "../types";

/* ── THE SERVER READER'S OWN RULES, TRANSCRIBED FROM ITS SOURCE ──────────────
   Not paraphrased and not remembered: the two regular expressions below are read
   OUT OF `server/lib/roundStoredTerms.ts` at test time, so this comparison cannot
   silently drift from the file it is comparing against. If the server's expression
   changes shape and the extraction stops matching, the extraction assertion fails
   first and says so. */
const SERVER_READER = path.resolve(
  __dirname, "../../../../../server/lib/roundStoredTerms.ts",
);

function serverRules(): { multiple: RegExp; nonPart: RegExp; part: RegExp } {
  const src = fs.readFileSync(SERVER_READER, "utf8");
  const mm = /const m = (\/.+?\/)\.exec\(lp\);/.exec(src);
  const np = /if \((\/non\[-\\s\]\?participating\/)\.test\(lp\)\)/.exec(src);
  if (!mm || !np) {
    throw new Error(
      "the server reader's liquidation-preference parsing could not be extracted; " +
      "roundStoredTerms.ts changed shape and client/src/lib/termsheet/roundNegotiatedTerms.ts " +
      "must be re-checked against it by hand",
    );
  }
  /* eslint-disable-next-line no-eval -- the pattern is read from a file in this
     repository at test time, not from any input. */
  const multiple = eval(mm[1]) as RegExp;
  const nonPart = eval(np[1]) as RegExp;
  return { multiple, nonPart, part: /participating/ };
}

/** The server reader's behaviour, reproduced from its own expressions. */
function serverReads(lp: string | null | undefined): { multiple: number | null; participating: boolean | null } {
  const r = serverRules();
  const raw = (lp ?? "").trim();
  const low = raw.toLowerCase();
  let multiple: number | null = null;
  if (low !== "") {
    const m = r.multiple.exec(low);
    if (m) {
      const n = Number(m[2]);
      if (Number.isFinite(n) && n > 0 && n <= 10) multiple = n;
    }
  }
  let participating: boolean | null = null;
  if (low !== "") {
    if (r.nonPart.test(low)) participating = false;
    else if (r.part.test(low)) participating = true;
  }
  return { multiple, participating };
}

/** Every wording worth disagreeing about, including the ones that must be refused. */
const CASES: Array<string | null | undefined> = [
  "1x non-participating",
  "1x participating",
  "2x participating",
  "1.5x non-participating",
  "2x participating, capped at 3x",
  "1x participating, capped at 2x",
  "1X NON-PARTICIPATING",
  "1x  non participating",
  "1x non participating",
  "1 x participating",
  "participating",
  "non-participating",
  "1x",
  "",
  "   ",
  null,
  undefined,
  /* OUT OF DOMAIN — must be absent, not clamped. The server reader's own words:
     "a multiple outside it is a typing error and not a term". */
  "11x participating",
  "0x participating",
  "100x non-participating",
  /* Nonsense and near-misses. */
  "one times non-participating",
  "1.5 participating",
  "FULL_RATCHET",
  "1xx participating",
];

describe("W92 · ITEM 3 — the client reader agrees with the server reader", () => {
  it("W92-T-01 · the same answer on every input, including every refused one", () => {
    /* The extraction itself is asserted first, so a green result cannot come from
       an extraction that quietly failed. */
    expect(() => serverRules()).not.toThrow();
    for (const lp of CASES) {
      const server = serverReads(lp);
      expect(readLiqPrefMultiple(lp), `multiple disagrees on ${JSON.stringify(lp)}`)
        .toBe(server.multiple);
      expect(readParticipating(lp), `participation disagrees on ${JSON.stringify(lp)}`)
        .toBe(server.participating);
    }
  });

  it("W92-T-02 · the cap is read from BOTH homes, and a CONFLICT is reported as absent", () => {
    /* The cap key. */
    expect(readNegotiatedTerms({ liquidationPreference: "1x participating", capParticipation: 2 }))
      .toMatchObject({ liqPrefMultiple: 1, participating: true, capParticipation: "2", capSource: "capParticipation" });
    /* A trailing "x" is accepted, matching the server's validator. */
    expect(readNegotiatedTerms({ liquidationPreference: "1x participating", capParticipation: "2x" }).capParticipation)
      .toBe("2");
    /* The free-text wording, which is Wave 94's second home. */
    expect(readNegotiatedTerms({ liquidationPreference: "1x participating, capped at 2x" }))
      .toMatchObject({ capParticipation: "2", capSource: "liquidationPreference" });
    /* AGREEING HOMES ARE FINE. */
    expect(readNegotiatedTerms({ liquidationPreference: "1x participating, capped at 2x", capParticipation: 2 }).capParticipation)
      .toBe("2");
    /* TWO CAPS THAT DISAGREE ARE ABSENT, NOT RESOLVED. Choosing between them would
       be inventing which one the parties negotiated, and the waterfall refuses that
       case by name rather than picking a winner. A legal document must not do what
       the calculation refuses to do. */
    const conflict = readNegotiatedTerms({
      liquidationPreference: "1x participating, capped at 2x", capParticipation: 3,
    });
    expect(conflict.capParticipation).toBe("");
    expect(conflict.capSource).toBeNull();
    /* Out of domain is absent. */
    expect(readNegotiatedTerms({ liquidationPreference: "1x participating", capParticipation: 50 }).capParticipation).toBe("");
    expect(readNegotiatedTerms({ liquidationPreference: "1x participating", capParticipation: "FULL_RATCHET" }).capParticipation).toBe("");
    expect(readNegotiatedTerms({ liquidationPreference: "1x participating", capParticipation: 0 }).capParticipation).toBe("");
    expect(readNegotiatedTerms({ liquidationPreference: "1x participating", capParticipation: -1 }).capParticipation).toBe("");
    /* And the in-domain pole Wave 94 pinned: 7 is readable. */
    expect(readNegotiatedTerms({ liquidationPreference: "1x participating", capParticipation: 7 }).capParticipation).toBe("7");
  });
});

/** The liquidation clause of the US preferred template, rendered against `d`. */
function liqClause(d: Partial<TermSheetData>): string {
  /* `buildSections` closes over the data it is given for the section HEADINGS and
     labels, so the template is built with the same object the clause is then
     rendered against — there is no second copy of the data to drift from. */
  const tpl = getTemplate("US", "preferred", d as TermSheetData);
  expect(tpl, "the US preferred template is missing").toBeDefined();
  const section = tpl.sections.filter((s) => s.id === "liq")[0];
  expect(section, "the liquidation-preference clause is missing").toBeDefined();
  return section.body(d as TermSheetData);
}

describe("W92 · ITEM 3 — the clause states what is on record, and says so when nothing is", () => {
  it("W92-T-03 · a recorded term is stated, and the cap is a MULTIPLE not a word", () => {
    const t = readNegotiatedTerms({ liquidationPreference: "2x participating", capParticipation: 3 });
    const out = liqClause({ ...t, liquidationPreferenceRaw: t.liquidationPreferenceRaw });
    expect(out).toContain("2\u00d7 participating liquidation preference");
    expect(out).toContain("participation cap of 3\u00d7 the Original Issue Price");
    /* THE OLD DEFECT, PINNED SHUT: the cap slot can never carry a word again. */
    expect(out).not.toContain("non-participating\u00d7");
    expect(out).not.toMatch(/cap of [a-z-]+\u00d7/);
  });

  it("W92-T-04 · a NON-participating recorded term does not print a cap clause at all", () => {
    const t = readNegotiatedTerms({ liquidationPreference: "1x non-participating" });
    const out = liqClause({ ...t });
    expect(out).toContain("1\u00d7 non-participating liquidation preference");
    expect(out).toContain("greater of");
    expect(out).not.toContain("participation cap");
  });

  it("W92-T-05 · ABSENT MEANS ABSENT — no default is printed, and the wording on record is quoted", () => {
    /* Nothing at all on the round. */
    const none = readNegotiatedTerms({});
    const out = liqClause({ ...none });
    expect(out).toContain("NOT ON RECORD");
    expect(out).toContain("No liquidation preference is stored against this round at all");
    /* AND EMPHATICALLY NOT THE OLD DEFAULT. */
    expect(out).not.toContain("1\u00d7 non-participating liquidation preference");

    /* Something on the round, but not enough — the case a founder will actually
       meet. The stored wording is quoted so they can see WHY it was not enough. */
    const partial = readNegotiatedTerms({ liquidationPreference: "standard NVCA terms" });
    const out2 = liqClause({ ...partial });
    expect(out2).toContain("NOT ON RECORD");
    expect(out2).toContain('"standard NVCA terms"');
    expect(out2).toContain("does not state");
    /* It names what to do, which is the "no dead promises" rule. */
    expect(out2).toContain("Record it on the round's terms");
    /* A multiple with no participation stated is still not enough, because the two
       payouts are different: money back, versus money back AND a pro-rata share. */
    const half = readNegotiatedTerms({ liquidationPreference: "2x" });
    expect(liqClause({ ...half })).toContain("NOT ON RECORD");
  });

  it("W92-T-06 · a participating class with NO cap says so, rather than saying nothing", () => {
    const t = readNegotiatedTerms({ liquidationPreference: "1x participating" });
    const out = liqClause({ ...t });
    expect(out).toContain("no cap on participation recorded");
  });
});

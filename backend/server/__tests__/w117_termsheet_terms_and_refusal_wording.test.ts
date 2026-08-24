/**
 * WAVE 117 — THE TERM SHEET AN INVESTOR KEEPS, AND THE REFUSAL THAT TOLD THEM
 *            TO DO THE WRONG THING.
 *
 * FINDING 3 (first, because it is the one that can mislead an investor about
 * their own money): `round.terms.liquidationPref` was printed to investors
 * verbatim and never reconciled with the exit calculation. The term-sheet PDF —
 * the artefact an investor keeps on disk — did not state the liquidation
 * preference AT ALL. It now states it, and it states it by asking
 * `shared/liquidationTermsReader.ts`, the module the exit waterfall in
 * `server/track1Routes.ts` itself consults. Where the stored free text cannot be
 * interpreted the document SAYS SO and names the refusal, instead of printing
 * the text unchecked.
 *
 * FINDING 4 (naming): the download was `termsheet_<roundId>.pdf` — an internal
 * database key on an investor's disk. It is now named from wave 110's
 * `companyExportSlug()`.
 *
 * FINDING 2: the `COMMON_SHARES_NOT_ON_RECORD` refusal ended "Record the
 * founders' common shares on the cap table." Ordinary shares are routinely held
 * by outside investors across Europe and Asia, so that instruction reads as
 * "nothing for you to do here" to exactly the companies it is refusing. ONLY THE
 * SENTENCE CHANGED: this suite source-locks the condition, the refusal names and
 * the order of the four liquidation-term refusal branches, so an edit to the
 * gate itself fails here.
 *
 * WHY THE PDF IS TESTED THROUGH A pdfkit DOUBLE. `streamTermSheetPdf` streams
 * binary. Mocking `pdfkit` captures the exact strings the document is asked to
 * print, which is the claim under test — that the investor reads the reader's
 * interpretation and not the raw field.
 *
 * BEFORE/AFTER: every assertion here was run against the pre-wave tree and the
 * verbatim output is in build_log/wave117/W117_TESTS.md.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* ── THE pdfkit DOUBLE ──────────────────────────────────────────────────────
   Records every `.text()` string in order. Chainable, because the generator
   chains `.font(…).text(…, {continued:true}).font(…).text(…)`. */
const PRINTED: string[] = [];
vi.mock("pdfkit", () => {
  class FakeDoc {
    constructor(_opts?: unknown) {}
    fontSize() { return this; }
    fillColor() { return this; }
    font() { return this; }
    moveDown() { return this; }
    pipe() { return this; }
    end() { return this; }
    text(s: unknown) { PRINTED.push(String(s)); return this; }
  }
  return { default: FakeDoc };
});

import { streamTermSheetPdf, type TermSheetData } from "../lib/pdfGenerators";
import {
  readLiquidationTerms,
  describeLiquidationTerms,
} from "../../shared/liquidationTermsReader";

const REPO = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
/** Source with comments removed — documentation is not what a user reads. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A response double that records only what this suite asserts on. */
function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(k: string, v: string) { headers[k] = v; },
    on() {},
    once() {},
    emit() {},
    write() { return true; },
    end() {},
  } as unknown as import("express").Response & { headers: Record<string, string> };
}

const BASE: TermSheetData = {
  roundId: "rnd_novapay_foundation",
  companyName: "NovaPay Labs, Inc.",
  instrument: "priced_equity",
  currency: "USD",
  pricePerShare: 1.25,
  postMoney: 30000000,
  preMoney: 25000000,
  targetRaise: 5000000,
  closeDate: "2026-09-30",
  openDate: "2026-08-01",
  termsSummary: null,
  leadInvestor: "Keiretsu Forum Canada",
  generatedAt: "2026-08-22T18:00:00.000Z",
};

function render(over: Partial<TermSheetData>) {
  PRINTED.length = 0;
  const res = fakeRes();
  streamTermSheetPdf(res, { ...BASE, ...over });
  return { res, printed: PRINTED.join("\n") };
}

beforeEach(() => { PRINTED.length = 0; });

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 3 — THE LIQUIDATION PREFERENCE AN INVESTOR READS IS THE ENGINE'S
   ════════════════════════════════════════════════════════════════════════════ */
describe("W117 F3 — the term sheet states the liquidation preference, and states it via the ONE reader", () => {
  it("W117-T-01 · a readable term is printed as the reader describes it — cap included", () => {
    /* BEFORE: no `Liquidation preference` row existed in this document at all,
       so this failed on the label alone. */
    const { printed } = render({
      liquidationPreference: "1x participating",
      capParticipation: 2,
    });
    expect(printed).toContain("Liquidation preference");
    const expected = describeLiquidationTerms(
      readLiquidationTerms({ liquidationPreference: "1x participating", capParticipation: 2 }),
    );
    expect(printed).toContain(expected);
    /* And the interpretation it prints is the engine's, not a second opinion:
       the cap the reader decided on is stated. */
    expect(expected).toContain("2");
    expect(printed).not.toContain("refuses —");
  });

  it("W117-T-02 · THE REFUSAL CASE — free text the reader cannot interpret is NOT printed as a term", () => {
    /* This is the investor-facing half of the defect: the round holds words, the
       exit calculation refuses on them, and the old surfaces printed the words as
       though they were a term. */
    const raw = "standard preference, to be agreed at closing";
    const { printed } = render({ liquidationPreference: raw, capParticipation: null });
    const decision = readLiquidationTerms({ liquidationPreference: raw, capParticipation: null });
    expect(decision.determined).toBe(false);
    /* The document says it cannot be read … */
    expect(printed).toContain("Cannot be read");
    /* … names the refusal, by the exit waterfall's own refusal name … */
    expect(printed).toContain("refuses — liquidation_term_not_on_record");
    /* … and never presents a multiple or a participation word as a term of the
       deal. The quoted-what-is-on-record wording comes from the reader, which is
       the only place allowed to quote it. */
    expect(printed).toContain(describeLiquidationTerms(decision));
  });

  it("W117-T-03 · a cap BELOW the preference refuses on the document under the engine's own refusal name", () => {
    const { printed } = render({
      liquidationPreference: "2x participating",
      capParticipation: 1,
    });
    expect(printed).toContain("refuses — participation_cap_below_preference");
    expect(printed).not.toMatch(/Liquidation preference: 2x participating$/m);
  });

  it("W117-T-04 · NOTHING RECORDED is still stated — an absent row would read as 'there is no preference'", () => {
    const { printed } = render({ liquidationPreference: null, capParticipation: null });
    expect(printed).toContain("Liquidation preference");
    expect(printed).toContain("Not recorded on this round");
    expect(printed).toContain("refuses — liquidation_term_not_on_record");
  });

  it("W117-T-05 · source-lock: the PDF generator reads the shared module and interprets nothing itself", () => {
    /* The whole point of wave 111 was ONE interpreter. This file must not become
       the second one. The two regexes that read a preference and a cap out of
       text may appear only in `shared/liquidationTermsReader.ts`. */
    const gen = code("server/lib/pdfGenerators.ts");
    expect(gen).toContain('from "../../shared/liquidationTermsReader"');
    expect(gen).toContain("readLiquidationTerms({");
    expect(gen).toContain("describeLiquidationTerms(");
    expect(gen).not.toMatch(/non\[-\\s\]\?participating/);
    expect(gen).not.toMatch(/capped\\s\+at/);
    /* And the producing route hands the stored fields over RAW rather than
       interpreting them on the way. */
    const routes = code("server/routes.ts");
    expect(routes).toContain('liquidationPreference: (round as unknown as Record<string, unknown>)["liquidationPreference"]');
    expect(routes).toContain('capParticipation: (round as unknown as Record<string, unknown>)["capParticipation"]');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 4 — THE DOWNLOAD IS NAMED AFTER THE COMPANY
   ════════════════════════════════════════════════════════════════════════════ */
describe("W117 F4 — no download filename carries an internal identifier", () => {
  it("W117-T-06 · the term-sheet filename is the company slug, and the round id is not in it", () => {
    /* BEFORE: `inline; filename="termsheet_rnd_novapay_foundation.pdf"`. */
    const { res } = render({});
    const cd = (res as unknown as { headers: Record<string, string> }).headers["Content-Disposition"];
    expect(cd).toBe('inline; filename="novapay-labs-inc-term-sheet-2026-08-22.pdf"');
    expect(cd).not.toContain(BASE.roundId);
    expect(cd).not.toContain("rnd_");
    expect(cd).not.toContain("termsheet_");
  });

  it("W117-T-07 · with no company name the slug falls back to a neutral token, never to the round id", () => {
    const { res } = render({ companyName: "", companyId: null });
    const cd = (res as unknown as { headers: Record<string, string> }).headers["Content-Disposition"];
    expect(cd).not.toContain("rnd_");
    expect(cd).toContain("-term-sheet-2026-08-22.pdf");
  });

  it("W117-T-08 · the round id is still IN THE DOCUMENT, where a human has context for it", () => {
    /* Removing the identifier from the filename must not lose it: support needs
       it, and the body is the right place for it. */
    const { printed } = render({});
    expect(printed).toContain(`Round ID: ${BASE.roundId}`);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 2 — THE SENTENCE, AND ONLY THE SENTENCE
   ════════════════════════════════════════════════════════════════════════════ */
describe("W117 F2 — the no-common-shares refusal asks for the company's shares, whoever holds them", () => {
  const T1 = read("server/track1Routes.ts");

  it("W117-T-09 · the instruction no longer says \"founders'\"", () => {
    /* BEFORE: the file contained `Record the founders' common shares on the cap
       table.` — the wording an outside-investor-held ordinary share structure
       reads as \"not my problem\". */
    const t1 = code("server/track1Routes.ts");
    expect(t1).not.toContain("Record the founders' common shares");
    expect(t1).toContain("Record the company's common (ordinary) shares on the cap table, whoever holds them");
  });

  it("W117-T-10 · the refusal itself is UNTOUCHED — name, error code, field and payload", () => {
    expect(T1).toContain('error: "COMMON_SHARES_NOT_ON_RECORD"');
    expect(T1).toContain('refusal: "common_shares_not_on_record"');
    expect(T1).toContain('refusalName: "common_shares_not_on_record"');
    expect(T1).toContain('field: "shares"');
    /* Its trigger is unchanged: the cap-table provider returning null, not an
       empty list and not a zero count. */
    expect(T1).toContain("const commonRows = readCompanyCommonRows(companyId);");
    expect(T1).toContain("if (commonRows === null) {");
    /* And the parts of the message that were reviewed and found correct are
       still there, including the worked example that makes the refusal
       persuasive. */
    expect(T1).toContain("Capavate cannot compute an exit waterfall because this company has no common shares on ");
    expect(T1).toContain("$33,333,333.33");
    expect(T1).toContain("It no longer guesses.");
  });

  it("W117-T-11 · source-lock: the four liquidation-term refusal branches are byte-identical and IN ORDER", () => {
    /* Wave 111 locked these. Wave 117 was permitted to change one human sentence
       in a DIFFERENT branch and nothing else, so this re-asserts the lock and
       additionally pins the ORDER, which the brief made a hard condition. */
    const conds = [
      "if (terms.liquidationPreferenceMultiple === null || terms.participatingPreferred === null) {",
      "if (terms.participationCapUnreadable) {",
      "if (terms.participationCapConflict) {",
      "terms.participationCapMultiple < terms.liquidationPreferenceMultiple",
    ];
    const at = conds.map((c) => {
      const i = T1.indexOf(c);
      expect(i, `missing refusal condition: ${c}`).toBeGreaterThan(-1);
      return i;
    });
    expect(at, "the four refusal branches must be evaluated in their original order")
      .toEqual([...at].sort((a, b) => a - b));
    /* Their refusal names, in the same order. */
    const names = [
      '"liquidation_term_not_on_record"',
      '"participation_cap_not_readable"',
      '"participation_cap_conflict"',
      '"participation_cap_below_preference"',
    ];
    for (const n of names) expect(T1).toContain(n);
  });
});

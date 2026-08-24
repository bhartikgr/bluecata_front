/**
 * WAVE 117 — THE BEFORE-PROOF. A GREEN SUITE PROVES NOTHING UNLESS IT COULD
 *            HAVE BEEN RED.
 *
 * `w117_scratch/before/pdfGenerators.before.ts` is this tree's term-sheet
 * generator AS IT STOOD BEFORE THIS WAVE, byte-for-byte apart from the two
 * import specifiers rewritten to the `@/` alias so it can be loaded from outside
 * `server/`. It is pushed through the SAME assertions as
 * `w117_termsheet_terms_and_refusal_wording.test.ts`, inverted: this file records
 * that the pre-wave document (a) carried the round id in its filename and (b) did
 * not state a liquidation preference at all.
 *
 * The same before/after evidence for the source-level findings (the refusal
 * sentence, the admin copy) is the saved pre-wave copies in
 * `w117_scratch/admin_before/` and the verbatim command output in
 * build_log/wave117/W117_TESTS.md.
 *
 * WHY A COPY RATHER THAN A TEMPORARY REVERT: waves 116 and 117 were live in this
 * tree at the same time and both were granted `server/lib/pdfGenerators.ts` for
 * disjoint concerns. Reverting a shared file for a few seconds to take a
 * measurement could have destroyed another agent's write. The measurement is
 * taken on a copy instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { streamTermSheetPdf as beforeStream } from "../../w117_scratch/before/pdfGenerators.before";

function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(k: string, v: string) { headers[k] = v; },
    on() {}, once() {}, emit() {}, write() { return true; }, end() {},
  } as any;
}

const BASE = {
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

beforeEach(() => { PRINTED.length = 0; });

describe("W117 BEFORE — the pre-wave term sheet, measured", () => {
  it("W117-B-01 · the pre-wave filename carried the internal round id", () => {
    const res = fakeRes();
    beforeStream(res, { ...BASE } as any);
    expect(res.headers["Content-Disposition"]).toBe(
      'inline; filename="termsheet_rnd_novapay_foundation.pdf"',
    );
    /* Which is exactly what W117-T-06 now forbids. */
    expect(res.headers["Content-Disposition"]).toContain("rnd_");
  });

  it("W117-B-02 · the pre-wave document did not state a liquidation preference AT ALL", () => {
    const res = fakeRes();
    beforeStream(res, {
      ...BASE,
      liquidationPreference: "1x participating",
      capParticipation: 2,
    } as any);
    const printed = PRINTED.join("\n");
    /* No label, so W117-T-01 could not have passed … */
    expect(printed).not.toContain("Liquidation preference");
    /* … and no refusal could reach the reader, so W117-T-02/03/04 could not
       have passed either. The term that decides who is paid first on an exit was
       simply missing from the document an investor keeps. */
    expect(printed).not.toContain("refuses —");
    expect(printed).not.toContain("Cannot be read");
  });

  it("W117-B-03 · the pre-wave generator did not consult the shared reader", () => {
    const src = require("node:fs").readFileSync(
      require("node:path").resolve(__dirname, "..", "..", "w117_scratch/before/pdfGenerators.before.ts"),
      "utf8",
    ) as string;
    expect(src).not.toContain("liquidationTermsReader");
  });
});

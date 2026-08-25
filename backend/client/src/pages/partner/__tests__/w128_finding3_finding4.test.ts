/**
 * WAVE 128 — FINDING 3 (raw identifiers at call sites) and FINDING 4 (residue).
 *
 * WHY SOURCE-LEVEL ASSERTIONS, AND WHY THEY RUN THROUGH `liveCode`.
 *   Every claim below is about what the SHIPPED code does, and a grep hit is not
 *   a defect until it is proved to be in live code — several of the strings
 *   asserted absent here still exist, correctly, inside the comments that record
 *   why they were removed. So each file is stripped of comments first
 *   (`w126_live_code.ts`) and the assertion runs against what remains.
 *
 * THE FINDING 3 RULING THESE TESTS PIN.
 *   The helper set in `client/src/lib/partnerDisplay.ts` is RIGHT; the call sites
 *   were the defect. `partnerDisplay.ts` is therefore NOT edited by this wave
 *   (its uppercase output is pinned by w124/w125), and every fix below routes an
 *   existing raw value through an existing shared helper. No second vocabulary is
 *   introduced.
 *
 * WHAT IS NOT CLAIMED. This wave fixed the highest-visibility subset of the 93
 * classified sites, not all of them. The remaining files are named in
 * build_log/wave128/W128_TESTS.md. These tests assert only the sites listed here.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { liveCode } from "./w126_live_code";
import { currencyOriginStatement, spvCurrencyForJurisdictionCountry } from "../PartnerSpvEngine";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (rel: string) => liveCode(fs.readFileSync(path.join(ROOT, rel), "utf8"));

const PAGES = "client/src/pages/partner";
const COMPONENTS = "client/src/components/partner";

describe("WAVE 128 · FINDING 3 — raw machine values no longer reach columns humans read", () => {
  const cases: Array<[string, string, string]> = [
    // [file, the raw render that must be gone, the helper call that must be there]
    [`${PAGES}/PartnerSpvDetail.tsx`, "{sub.status}", 'humanizeMachineKey(sub.status, "Status not recorded")'],
    [`${PAGES}/PartnerSpvDetail.tsx`, "Created: {s.createdAt}", "formatTimestamp(s.createdAt)"],
    [`${PAGES}/PartnerSpvEngine.tsx`, "· {s.status} ·", "spvStatusLabel(s.status)"],
    [`${PAGES}/SpvPerformance.tsx`, "{f.sourceKind}", 'humanizeMachineKey(f.sourceKind, "Source not recorded")'],
    [`${PAGES}/SpvPerformance.tsx`, "{a.basis}", 'humanizeMachineKey(a.basis, "Basis not recorded")'],
    [`${PAGES}/PartnerTasks.tsx`, "{t.status}", "humanizeMachineKey(t.status)"],
    [`${PAGES}/PartnerTeam.tsx`, "{m.status}", 'humanizeMachineKey(m.status, "Status not recorded")'],
  ];

  for (const [file, raw, helper] of cases) {
    it(`${file} renders ${raw.replace(/[{}]/g, "")} through a shared label helper`, () => {
      const src = read(file);
      expect(src).toContain(helper);
      expect(src).not.toContain(raw);
    });
  }

  it("the carry accrual summary line humanises basis AND convention", () => {
    const src = read(`${PAGES}/SpvPerformance.tsx`);
    expect(src).toContain('humanizeMachineKey(carryQ.data.accrual.basis, "not recorded")');
    expect(src).toContain('humanizeMachineKey(carryQ.data.accrual.convention, "not recorded")');
    expect(src).not.toContain("${carryQ.data.accrual.basis}");
  });

  it("the mark-override approval state is humanised but its em-dash refusal survives", () => {
    const src = read(`${PAGES}/SpvPerformance.tsx`);
    expect(src).toContain('{o.approvalState ? humanizeMachineKey(o.approvalState) : "—"}');
  });

  it("SpvOperationsPanels no longer prints an internal state word for withheld fees", () => {
    const src = read(`${COMPONENTS}/SpvOperationsPanels.tsx`);
    expect(src).not.toMatch(/feesUnknown\s*\?\s*"unknown"/);
    expect(src).toContain("withheld, not zero");
  });

  it("partnerDisplay.ts was NOT edited to reach any of the above", () => {
    // The helper is right; the call sites were the work. w124/w125 pin the
    // helper's output, so a "fix" inside it would have moved the failure.
    const src = fs.readFileSync(path.join(ROOT, "client/src/lib/partnerDisplay.ts"), "utf8");
    expect(src).toContain("export function humanizeMachineKey");
    expect(src).not.toContain("WAVE 128");
  });

  it("o.reason is deliberately left as typed text (wave 126 classified it as a machine key; it is not)", () => {
    // Spot-check contradicting the classification: the Reason column of the mark
    // override table holds the GP's own free-text justification captured by the
    // override form, not an enum. Humanising it would lowercase a sentence a
    // human wrote. Left alone on purpose, and stated here so the omission is not
    // read as an oversight.
    const src = read(`${PAGES}/SpvPerformance.tsx`);
    expect(src).toContain("{o.reason}");
  });
});

describe("WAVE 128 · FINDING 4 — the residue items", () => {
  it("the Performance page has a way home, in addition to (not instead of) Back to vehicle", () => {
    const src = read(`${PAGES}/SpvPerformanceRoute.tsx`);
    expect(src).toContain('data-testid="spv-performance-breadcrumb"');
    expect(src).toContain('href="/collective/partner/dashboard"');
    expect(src).toContain('href="/collective/partner/spv-engine"');
    // the pre-existing exit is untouched
    expect(src).toContain('data-testid="spv-performance-back-link"');
    expect(src).toContain("Back to vehicle");
  });

  it("both breadcrumb targets are declared routes in App.tsx", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('path="/collective/partner/dashboard"');
    expect(app).toContain('path="/collective/partner/spv-engine"');
  });

  it("'Add to Capavate first' is styled as the working link it is", () => {
    const src = read(`${PAGES}/PartnerPipeline.tsx`);
    const m = src.match(/<a\s[^>]*add-to-capavate-hint[^>]*>/s);
    expect(m).not.toBeNull();
    const tag = m![0];
    expect(tag).toContain("underline");
    expect(tag).toContain("var(--cv-color-primary)");
    // the disabled-looking muted text colour is gone
    expect(tag).not.toContain("text-[var(--cv-color-text-muted)]");
    // href, text and test id are unchanged
    expect(src).toContain('href="/collective/partner/add-portfolio-company"');
    expect(src).toContain("Add to Capavate first");
  });

  it("the K-1 statement says what the tax year IS rather than naming it bare", () => {
    const src = read(`${COMPONENTS}/SpvK1Panel.tsx`);
    expect(src).toContain("Covers tax year {s.taxYear}");
  });

  it("the two same-URL SPV links each state what they do", () => {
    const src = read(`${PAGES}/PartnerSpvEngine.tsx`);
    const detail = src.slice(src.indexOf("spv-open-detail-") - 1400, src.indexOf("spv-open-detail-"));
    const standalone = src.slice(src.indexOf("spv-open-standalone-") - 900, src.indexOf("spv-open-standalone-"));
    expect(detail).toContain("title=");
    expect(standalone).toContain("title=");
    expect(detail).toContain("as a tab on this page");
    expect(standalone).toContain("standalone SPV admin page");
    // neither link was deleted — the standalone page is the sole plain-click
    // door to six endpoints
    expect(src).toContain('data-testid={`spv-open-detail-${s.id}`}');
    expect(src).toContain('data-testid={`spv-open-standalone-${s.id}`}');
  });

  it("the target-raise figure on the SPV row is captioned", () => {
    const src = read(`${PAGES}/PartnerSpvEngine.tsx`);
    expect(src).toContain("spv-target-raise-caption-");
    expect(src).toContain("Target raise — not the amount committed");
  });
});

describe("WAVE 128 · ADDITION 4 — the review step states WHERE the denomination came from", () => {
  it("derived currency is named as derived, with the jurisdiction that produced it", () => {
    const s = currencyOriginStatement("Canada", "CAD");
    expect(spvCurrencyForJurisdictionCountry("Canada")).toBe("CAD");
    expect(s).toContain("derived from the jurisdiction you chose (Canada)");
  });

  it("a jurisdiction the platform holds no currency for says so, and does not invent one", () => {
    expect(spvCurrencyForJurisdictionCountry("Cayman Islands")).toBeNull();
    const s = currencyOriginStatement("Cayman Islands", "USD");
    expect(s).toContain("your own selection");
    expect(s).toContain("will not invent one");
    expect(s).toContain("Cayman Islands");
  });

  it("a selection that disagrees with the derivation is allowed but flagged", () => {
    const s = currencyOriginStatement("Canada", "USD");
    expect(s).toContain("not the currency this platform associates with Canada");
    expect(s).toContain("(CAD)");
    expect(s).toContain("That is allowed");
  });

  it("an empty jurisdiction does not produce a dangling sentence", () => {
    expect(currencyOriginStatement("", "USD")).toContain("that jurisdiction");
  });

  it("the statement is rendered inside the existing confirmation block, not in place of it", () => {
    const src = read(`${PAGES}/PartnerSpvEngine.tsx`);
    expect(src).toContain('data-testid="spv-w-currency-origin"');
    expect(src).toContain('data-testid="spv-w-currency-confirm-statement"');
    expect(src).toContain('data-testid="spv-w-currency-confirm"');
    expect(src).toContain("currencyOriginStatement(");
  });
});

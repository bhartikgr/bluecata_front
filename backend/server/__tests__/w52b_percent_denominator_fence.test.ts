/**
 * WAVE 52b · AC-7 POLE B — the percent-denominator fence, pinned.
 *
 * The lesson this repo has learned repeatedly is "a check that passed while
 * checking nothing". A fence that only ever runs against a green tree proves
 * nothing: it would pass identically if `runPercentDenominatorFence()` returned
 * `{ ok: true }` unconditionally. Wave 52 shipped no fence at all and said so;
 * this file is the reason the fence it replaces that gap with is not decoration.
 *
 * BOTH POLES, on a synthetic tree the test builds itself:
 *
 *   NEGATIVE POLE — an unlabelled ownership percentage must be REPORTED, for
 *     each of the three rendering shapes (`{x}%`, `` `${x}%` ``, `toFixed(n)}%`).
 *   POSITIVE POLE — the same figure with its denominator named, or routed through
 *     `formatPct()`, must come back clean; and a CSS bar width, a discount rate
 *     and an interest rate must stay clean, because they have no denominator to
 *     name.
 *
 * Plus the two things that make the exclusions auditable rather than convenient:
 *
 *   THE EXCLUSION REGRESSION — the first draft of `NON_OWNERSHIP_TOKENS`
 *     contained `className`, and that alone excused SEVEN genuine unlabelled
 *     ownership percentages. A test asserts that a `className` on the line does
 *     NOT excuse a figure, so the weakening cannot come back.
 *   THE LIVE PIN — the real repository must be green AND its baseline must still
 *     be exactly 9 entries, each matching line-for-line. A moved baseline line is
 *     a re-justification event, not an inheritance; a baseline that GREW is the
 *     fence being widened rather than the tree being fixed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  runPercentDenominatorFence,
  isNonOwnershipPercent,
  neighbourhoodNamesDenominator,
  maskClassAndTestIds,
  maskComments,
  BASELINE,
  WINDOW,
} from "../../scripts/lint/percentDenominatorFence";

let TMP = "";

function put(rel: string, body: string): void {
  const abs = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function clear(): void {
  for (const e of fs.readdirSync(TMP)) {
    fs.rmSync(path.join(TMP, e), { recursive: true, force: true });
  }
}

beforeAll(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "w52b-pct-fence-"));
});

afterAll(() => {
  if (TMP) fs.rmSync(TMP, { recursive: true, force: true });
});

function scan() {
  return runPercentDenominatorFence(TMP);
}

describe("W52b AC-7 POLE B — the fence REPORTS an unlabelled percentage", () => {
  it("W52b fence NEGATIVE POLE jsxExprPct — a bare {x}% is a violation naming file and line", () => {
    clear();
    put(
      "Surface.tsx",
      [
        "export function Row(r: any) {",
        "  return <td>{r.ownershipPercent}%</td>;",
        "}",
      ].join("\n"),
    );
    const r = scan();
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].patternId).toBe("jsxExprPct");
    expect(r.violations[0].file).toBe("Surface.tsx");
    expect(r.violations[0].line).toBe(2);
    expect(r.violations[0].detail).toContain("no denominator named");
  });

  it("W52b fence NEGATIVE POLE template literal — a bare `${x}%` is a violation, reported as jsxExprPct", () => {
    clear();
    put("Surface.tsx", ["const t = `Founder ${pct}% after the round`;"].join("\n"));
    const r = scan();
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    /*
     * MEASURED, AND THE ROW WAS WRONG AS I FIRST WROTE IT. I asserted
     * `patternId === "templatePct"`. It is `jsxExprPct`, and that is correct
     * behaviour rather than a defect: `${pct}%` CONTAINS `{pct}%`, so the
     * jsxExprPct pattern matches first and the scanner breaks on the first match
     * so one line is never counted twice. `templatePct` is therefore a more
     * permissive ALIAS of jsxExprPct for this shape and is unreachable on it.
     * The site is caught either way, which is the thing that matters, and the
     * measurement is recorded rather than the pattern order being shuffled to
     * make my original sentence true.
     */
    expect(r.violations[0].patternId).toBe("jsxExprPct");
    expect(r.violations[0].line).toBe(1);
  });

  it("W52b fence NEGATIVE POLE toFixedPct — a formatted number with '%' appended is a violation", () => {
    clear();
    put("Surface.tsx", ['const t = pct.toFixed(1) + "%";'].join("\n"));
    const r = scan();
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.patternId)).toContain("toFixedPct");
  });

  it("W52b fence reports EVERY unlabelled site, not just the first", () => {
    clear();
    put(
      "A.tsx",
      ["<td>{a}%</td>", "<td>{b}%</td>", "<td>{c}%</td>"].join("\n\n\n\n\n\n\n\n\n\n\n\n\n\n"),
    );
    const r = scan();
    expect(r.violations).toHaveLength(3);
    expect(r.violations.map((v) => v.line)).toEqual([1, 15, 29]);
  });
});

describe("W52b AC-7 POLE A — the fence PASSES a labelled percentage", () => {
  it("W52b fence POSITIVE POLE — naming the denominator in the neighbourhood clears the site", () => {
    clear();
    put(
      "Surface.tsx",
      [
        "<div>",
        "  <span>of fully-diluted post-money shares</span>",
        "  <td>{r.ownershipPercent}%</td>",
        "</div>",
      ].join("\n"),
    );
    const r = scan();
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(r.compliantSites).toBe(1);
  });

  it("W52b fence POSITIVE POLE — a DENOM_LABEL token clears the site", () => {
    clear();
    put("Surface.tsx", ["// FD_POST_EX_POOL", "const label = FD_POST_EX_POOL;", "<td>{p}%</td>"].join("\n"));
    const r = scan();
    expect(r.ok).toBe(true);
  });

  it("W52b fence POSITIVE POLE — routing through formatPct() clears the site", () => {
    clear();
    put("Surface.tsx", ["const s = formatPct(p);", "<td>{s}%</td>"].join("\n"));
    const r = scan();
    expect(r.ok).toBe(true);
  });

  it("W52b fence a CSS bar width, a discount and an interest rate are NOT ownership percentages", () => {
    clear();
    put(
      "Surface.tsx",
      [
        '<div style={{ width: `${Math.min(100, pct)}%` }} />',
        "<span>{form.discount}% discount</span>",
        "<span>{form.interestRate}% APR</span>",
      ].join("\n"),
    );
    const r = scan();
    expect(r.ok).toBe(true);
    expect(r.sitesConsidered).toBe(3);
    expect(r.compliantSites).toBe(3);
  });

  it("W52b fence a percentage inside a comment is not a site", () => {
    clear();
    put("Surface.tsx", ["// the founder is {x}% on this denominator", "const a = 1;"].join("\n"));
    const r = scan();
    expect(r.ok).toBe(true);
    expect(r.sitesConsidered).toBe(0);
  });
});

describe("W52b — the exclusion list cannot be quietly widened again", () => {
  /*
   * This is the regression that actually happened during this wave. The first
   * draft excused any line containing `className`, and the fence reported ONE
   * violation on the real tree. The inventory script showed SEVEN genuine
   * unlabelled ownership percentages hiding behind that single token.
   */
  it("W52b a className on the line does NOT excuse an unlabelled ownership percentage", () => {
    clear();
    put(
      "Surface.tsx",
      ['<td className="px-3 py-2 text-right font-mono tabular-nums">{groupPct.toFixed(2)}%</td>'].join("\n"),
    );
    const r = scan();
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(isNonOwnershipPercent(
      '<td className="px-3 py-2 text-right font-mono tabular-nums">{groupPct.toFixed(2)}%</td>',
    )).toBe(false);
  });

  it("W52b a Tailwind width class cannot supply a percentage OR excuse one", () => {
    const line = '<div className="w-14 text-right">{parseFloat(r.ownershipPercent).toFixed(2)}%</div>';
    expect(maskClassAndTestIds(line)).not.toContain("w-14");
    expect(isNonOwnershipPercent(line)).toBe(false);
  });

  it("W52b a data-testid cannot supply a denominator label it does not display", () => {
    const lines = [
      '<td data-testid="founder-pct-fd-post">{p}%</td>',
    ];
    const masked = maskComments(lines.join("\n")).split("\n");
    expect(neighbourhoodNamesDenominator(masked, 0)).toBe(false);
  });

  it("W52b a CSS bar's width is excused by the PROPERTY, not by the style attribute", () => {
    expect(isNonOwnershipPercent('style={{ width: `${pct}%` }}')).toBe(true);
    /* Same attribute, no CSS property in play, a real figure being printed. */
    expect(isNonOwnershipPercent('<span style={{}}>{pct}%</span>')).toBe(false);
  });

  it("W52b the neighbourhood window is bounded — a label 100 lines away does not clear a site", () => {
    clear();
    const body = ["<span>of fully-diluted post-money shares</span>"]
      .concat(new Array(100).fill("const filler = 1;"))
      .concat(["<td>{p}%</td>"]);
    put("Surface.tsx", body.join("\n"));
    const r = scan();
    expect(r.ok).toBe(false);
    expect(WINDOW).toBeLessThan(50);
  });
});

describe("W52b — the LIVE pin, and the baseline is a debt register with a count", () => {
  it("W52b the real repository is GREEN under the fence", () => {
    const r = runPercentDenominatorFence();
    expect(r.violations).toEqual([]);
    expect(r.staleBaseline).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("W52b the baseline is EXACTLY the 9 measured sites, every one still matching", () => {
    /* WAVE 52c · B6 — 9 BECAME 2, AND THIS ASSERTION IS A CEILING, NOT A PIN.
       Wave 52b pinned the count at exactly 9. Wave 52c labelled seven of the nine
       sites on screen and DELETED their entries, so an equality assertion would
       now fail for the right reason — which is the wrong way for a debt register
       to behave. It is re-expressed as the invariant that actually matters and
       that the blocker list states: the count must go DOWN, never UP.

       If this number RISES, the fence was widened rather than the tree fixed. If
       an entry stops matching, `staleBaseline` above has already gone red. */
    expect(BASELINE.length).toBeLessThanOrEqual(9);
    expect(BASELINE).toHaveLength(2);
    const r = runPercentDenominatorFence();
    expect(r.baselineHits).toBe(2);
  });

  it("W52b every baseline entry carries an owning wave and a reason — none is 'unknown'", () => {
    for (const b of BASELINE) {
      expect(b.owner.length).toBeGreaterThan(3);
      expect(b.owner.toLowerCase()).not.toContain("unknown");
      expect(b.why.length).toBeGreaterThan(40);
    }
  });

  it("W52b the baseline names the two files it is honest about, and no W52-authored file", () => {
    const files = new Set(BASELINE.map((b) => b.file));
    /* WAVE 52c · B6 — CapTable.tsx has left the register entirely: all three of
       its sites are labelled on screen. Only RoundDetail.tsx remains, and its two
       survivors are an ARITHMETIC defect (I-4, a sum of a rounded column) and a
       FENCE-CLASSIFICATION item (a closing-checklist progress figure that is not
       an ownership share at all), neither of which is a labelling job. */
    expect(files).toEqual(new Set(["client/src/pages/founder/RoundDetail.tsx"]));
    expect(files.has("client/src/pages/founder/CapTable.tsx")).toBe(false);
    /* RoundNew.tsx is the file Wave 52 rewrote. It has ZERO baselined sites:
       every percentage the new Review preview emits goes through `formatPct`. */
    expect([...files]).not.toContain("client/src/pages/founder/RoundNew.tsx");
  });

  it("W52b the fence's scope is the five W52-owned surfaces of §11.6.4, not the whole tree", () => {
    const r = runPercentDenominatorFence();
    /* Four founder pages plus every source file in packages/cap-table-engine/src.
       A tree-wide fence provably cannot hold — §11.6.4 measured why. */
    expect(r.filesScanned).toBeGreaterThan(4);
    expect(r.filesScanned).toBeLessThan(200);
  });
});

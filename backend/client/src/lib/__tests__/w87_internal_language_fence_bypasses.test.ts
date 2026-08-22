/**
 * WAVE 87 · ITEM 2 — THE COPY FENCE, RE-ATTACKED AND HARDENED.
 * ════════════════════════════════════════════════════════════════════════════
 * Independent reviewer 1 leaked the banned identifier `captable_commits` into
 * rendered copy while `npm run drop:restyle` and the internal-language fence
 * both stayed GREEN. It left the attack behind as `client/src/components/
 * FenceDefeat.tsx` — a stray file in the shippable tree that also added a 588th
 * tsc error. WAVE 87 turned that fixture into this test and deleted the file.
 *
 * THE FOUR REPORTED BYPASSES, and what happened when each was re-measured:
 *
 *   1. `dangerouslySetInnerHTML={{ __html: "captable_commits" }}`
 *      CONFIRMED GREEN before this wave. `dangerouslySetInnerHTML` was not in
 *      COPY_ATTRS, so the literal was "not rendered" and the ≥3-word prose
 *      fallback discarded a one-word identifier. It is now a COPY attribute:
 *      innerHTML is, by definition, rendered.
 *
 *   2. `aria-labelledby="captable_commits"`
 *      CONFIRMED GREEN before this wave — and RULED CORRECT TO STAY GREEN.
 *      See the justification block on the aria tests below. This is the one item
 *      where reviewer 1 over-reported, and the fence now says so on purpose
 *      instead of by accident.
 *
 *   3. text returned from a `return` statement and rendered as `{getLeak()}`
 *      CONFIRMED GREEN before this wave. Now RED, via a one-hop, same-file taint
 *      pass: a literal returned by a helper that is CALLED in a rendering
 *      position is rendered text.
 *
 *   4. dynamic concatenation `["captable","commits"].join("_")`
 *      CONFIRMED GREEN before this wave. Now RED, via bounded constant folding
 *      of `join`, `concat`, `String.raw` and all-literal `+` chains.
 *
 * AND THE TWO REVIEWER 1 GOT RIGHT BY ACCIDENT: `alt` and `title` were ALREADY
 * RED (the pre-wave fence flagged exactly those two lines of its fixture, which
 * is why `npm run preflight` was failing when WAVE 87 started). Both are pinned
 * here so they cannot regress.
 *
 * EVERY NEW RULE HAS BOTH POLES. R77 is the line: the identifier may stay as a
 * machine-readable value (payload, `error.code`, props, query key,
 * `data-testid`, docstring, comment) and may not stay in text a user reads. The
 * green poles below are as load-bearing as the red ones — this project has twice
 * produced phantom cascades (6,818 and 519 false "leaks") by drifting into
 * presence-based matching, and a third would be worse than the leak.
 *
 * TRANSCRIPT: build_log/wave87/W87_FENCE_HARDENING.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCatalogue, scanFile, type Catalogue, type Violation } from "../../../../scripts/lint/internalLanguageFence";

let cat: Catalogue;
let tmp: string;

beforeAll(() => {
  cat = buildCatalogue();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w87-fence-"));
});

/** Scan a fixture as if it lived at `rel` inside the tree. */
function scan(code: string, rel = "client/src/pages/founder/W87Fixture.tsx"): Violation[] {
  const abs = path.join(tmp, `f${Math.random().toString(36).slice(2)}.tsx`);
  fs.writeFileSync(abs, code, "utf8");
  return scanFile(abs, rel, cat).violations;
}
const leaks = (code: string, rel?: string): Violation[] =>
  scan(code, rel).filter((v) => v.match === "captable_commits");

/* ══════════════════════════════════════════════════════════════════════════ *
 * REVIEWER 1'S FIXTURE, VECTOR BY VECTOR — the RED pole.                     *
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W87 · reviewer 1's four bypasses are closed (RED pole)", () => {
  it("B1 · dangerouslySetInnerHTML __html is rendered text", () => {
    const v = leaks(`export const A = () => <div dangerouslySetInnerHTML={{ __html: "captable_commits" }} />;`);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B3 · a literal returned by a helper that is rendered is rendered text", () => {
    const v = leaks(`
      const getLeak = () => "captable_commits";
      export const A = () => <div>{getLeak()}</div>;
    `);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B3b · the same through a function declaration and a return statement", () => {
    const v = leaks(`
      function leakName() { return "captable_commits"; }
      export const A = () => <span>{leakName()}</span>;
    `);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B4 · array join with an underscore separator", () => {
    const v = leaks(`export const A = () => <div>{["captable", "commits"].join("_")}</div>;`);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B4b · join with the empty string, reviewer 1's exact split", () => {
    const v = leaks(`export const A = () => <div>{["captable_", "commits"].join("")}</div>;`);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B4c · .concat()", () => {
    const v = leaks(`export const A = () => <div>{"captable_".concat("commits")}</div>;`);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B4d · an all-literal + chain", () => {
    const v = leaks(`export const A = () => <div>{"captable" + "_" + "commits"}</div>;`);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B4e · String.raw", () => {
    const v = leaks("export const A = () => <div>{String.raw`captable_commits`}</div>;");
    expect(v.length).toBeGreaterThan(0);
  });

  it("B5 · an object lookup table whose values are rendered", () => {
    const v = leaks(`
      const LABEL: Record<string, string> = { a: "captable_commits" };
      export const A = ({ k }: { k: string }) => <div>{LABEL[k]}</div>;
    `);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B6 · alt and title were ALREADY red — pinned so they stay red", () => {
    expect(leaks(`export const A = () => <img alt="captable_commits" src="/x.png" />;`).length).toBeGreaterThan(0);
    expect(leaks(`export const A = () => <div title="captable_commits" />;`).length).toBeGreaterThan(0);
  });

  it("B7 · a <title> element's own text", () => {
    const v = leaks(`export const A = () => <svg><title>captable_commits</title></svg>;`);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B8 · placeholder — the documented carve-out covers FORMAT examples only, not a real table name", () => {
    const v = leaks(`export const A = () => <input placeholder="captable_commits" />;`);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B9 · a tooltip/content prop", () => {
    expect(leaks(`export const A = () => <Info tooltip="captable_commits" />;`).length).toBeGreaterThan(0);
    expect(leaks(`export const A = () => <Tip content="captable_commits" />;`).length).toBeGreaterThan(0);
  });

  it("B10 · a chart series name and an axis unit are legend/tooltip copy", () => {
    expect(leaks(`export const A = () => <Bar dataKey="v" name="captable_commits" />;`).length).toBeGreaterThan(0);
    expect(leaks(`export const A = () => <YAxis unit="captable_commits" />;`).length).toBeGreaterThan(0);
  });

  it("B11 · a dotted toast variant", () => {
    const v = leaks(`export const A = () => { toast.error("captable_commits"); return null; };`);
    expect(v.length).toBeGreaterThan(0);
  });

  it("B12 · a template literal whose static head is the identifier", () => {
    const v = leaks("export const A = ({ n }: { n: number }) => <div>{`captable_commits ${n}`}</div>;");
    expect(v.length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * R77 — THE GREEN POLE. Machine-readable values must stay green.             *
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W87 · R77 green pole — machine-readable values stay green", () => {
  it("data-testid, query key, fetch argument, props, error.code", () => {
    expect(leaks(`export const A = () => <div data-testid="captable_commits" />;`)).toHaveLength(0);
    expect(leaks(`const q = useQuery({ queryKey: ["captable_commits"] });`)).toHaveLength(0);
    expect(leaks(`const r = await apiRequest("GET", "/api/captable_commits");`)).toHaveLength(0);
    expect(leaks(`export const A = () => <Row code="captable_commits" value={1} />;`)).toHaveLength(0);
    expect(leaks(`if (err.code === "captable_commits") { /* map to a sentence */ }`)).toHaveLength(0);
  });

  it("a comment is structurally invisible", () => {
    expect(leaks(`/* captable_commits is the table this screen reads. */ export const A = () => <div>Holdings</div>;`)).toHaveLength(0);
  });

  it("a helper NOT rendered anywhere stays green — the taint pass is one-hop and directed", () => {
    expect(leaks(`
      const tableOf = () => "captable_commits";
      const q = useQuery({ queryKey: [tableOf()] });
    `)).toHaveLength(0);
  });

  it("a folded value used as a query key stays green — folding does not imply rendering", () => {
    expect(leaks(`const q = useQuery({ queryKey: [["captable", "commits"].join("_")] });`)).toHaveLength(0);
  });

  it("a lookup table that is never rendered stays green", () => {
    expect(leaks(`const TABLE_OF = { rounds: "captable_commits" }; const t = TABLE_OF.rounds; void fetch("/x?t=" + t);`)).toHaveLength(0);
  });

  it("a state setter carrying a machine code stays green (a mapper turns it into a sentence)", () => {
    expect(leaks(`export const A = () => { setMessageRefusal("captable_commits"); return null; };`)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * aria-labelledby — JUDGED, NOT OBEYED.                                     *
 * ══════════════════════════════════════════════════════════════════════════ *
 * Reviewer 1 asked for `aria-labelledby` to be added to COPY_ATTRS. WAVE 87
 * declines, and this is the reasoning, pinned as a test so the decision cannot
 * be quietly reversed:
 *
 *   `aria-labelledby` does not carry TEXT. It carries an ID REFERENCE LIST. The
 *   accessible name is computed from the TEXT CONTENT of the element(s) whose
 *   `id` matches; the attribute's own value is never spoken, displayed or
 *   exposed by any assistive technology. If the IDREF resolves, the user hears
 *   the referenced element's words. If it does not resolve, the element simply
 *   has no accessible name — browsers do not fall back to reading the id.
 *
 *   So an internal identifier in `aria-labelledby` is EXACTLY the class R77
 *   protects: a machine-readable value no user can read. Banning it would also
 *   be internally inconsistent — the value must equal some element's `id`, and
 *   `id` and `htmlFor` are already (correctly) non-copy. A fence that failed on
 *   `aria-labelledby="captable_commits"` while passing `id="captable_commits"`
 *   would be demanding that the two disagree, which is impossible.
 *
 *   The RIGHT protection is that the REFERENCED ELEMENT'S TEXT is policed — and
 *   it already is, as JsxText. The test below proves both halves.
 *
 * The same reasoning covers every IDREF aria attribute; the aria attributes that
 * really are spoken text (`aria-label`, `aria-description`, `aria-roledescription`,
 * `aria-valuetext`, `aria-placeholder`) are COPY and are red.
 */
describe("W87 · aria — IDREFs are machine values, spoken text is copy", () => {
  it("GREEN · aria-labelledby is an ID reference, not text", () => {
    expect(leaks(`export const A = () => <div aria-labelledby="captable_commits" />;`)).toHaveLength(0);
  });

  it("GREEN · the other IDREF aria attributes, for the same reason", () => {
    for (const a of ["aria-describedby", "aria-controls", "aria-owns", "aria-details", "aria-errormessage", "aria-activedescendant", "aria-flowto"]) {
      expect(leaks(`export const A = () => <div ${a}="captable_commits" />;`), a).toHaveLength(0);
    }
  });

  it("RED · but the TEXT the IDREF points at is policed, which is the real protection", () => {
    const v = leaks(`
      export const A = () => (
        <>
          <span id="lbl">captable_commits</span>
          <div aria-labelledby="lbl" />
        </>
      );
    `);
    expect(v.length).toBeGreaterThan(0);
  });

  it("RED · aria attributes that ARE spoken text", () => {
    for (const a of ["aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "aria-placeholder"]) {
      expect(leaks(`export const A = () => <div ${a}="captable_commits" />;`).length, a).toBeGreaterThan(0);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * The whole stray fixture, end to end.                                      *
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W87 · reviewer 1's FenceDefeat.tsx, as a permanent regression fixture", () => {
  /** Byte-for-byte reviewer 1's file, minus the `alt` on a `<div>` (which is not
   *  valid TSX and is what made it the tree's 588th type error). `alt` keeps its
   *  own red-pole test above on an `<img>`, where it is legal. */
  const FENCE_DEFEAT = `
import React from 'react';
export const FenceDefeat = () => {
  const getLeak = () => "captable_commits";
  return (
    <div>
      <div aria-labelledby="captable_commits" />
      <img alt="captable_commits" src="/x.png" />
      <div title="captable_commits" />
      {getLeak()}
    </div>
  );
};
`;

  it("leaks on three of its four vectors and is green on the one that is genuinely not text", () => {
    const v = leaks(FENCE_DEFEAT);
    const lines = [...new Set(v.map((x) => x.line))].sort((a, b) => a - b);
    /* alt (line 8), title (line 9) and the rendered return (line 10) are RED;
       aria-labelledby (line 7) is deliberately not. */
    expect(v.length).toBeGreaterThanOrEqual(3);
    expect(lines).not.toContain(7);
  });
});

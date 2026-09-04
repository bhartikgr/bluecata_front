/**
 * WAVE 283 — COUNT THE CONSUMERS OF `usdRow`, AND PROVE THE COUNT WITH A GREP
 * THAT HAS BEEN PROVED IN BOTH DIRECTIONS ON A KNOWN CASE.
 *
 * ── WHY THIS FILE EXISTS SEPARATELY FROM THE DOM FILE ───────────────────────
 * The DOM file proves what a partner SEES. This file proves that the fix
 * reached EVERY consumer of the value, including one that renders nothing.
 * The engineering document said "both tiles" — two. That is the count of
 * RENDERING sites. It is not the count of CONSUMERS:
 *
 *   1. `usdRow ? usdRow.spvCommittedMinor : 0`   — renders, fabricated a zero
 *   2. `usdRow ? usdRow.fundCommittedMinor : 0`  — renders, fabricated a zero
 *   3. `usdRow === null`                          — a PREDICATE. Renders nothing
 *      itself; it decides whether `kpi-no-usd-vehicles` appears. It reads the
 *      value, so it is a consumer (R257.2), and it is the reason the fix must
 *      NOT fold `usdRow == null` into the two guards: consumer 3 is already the
 *      honest explanation for a TRUE zero.
 *
 * ── THE GREP HAZARD, MADE INTO A PROOF ──────────────────────────────────────
 * The header comment this wave added to `PartnerDashboard.tsx` deliberately
 * quotes its own code — it names `usdRow` and `capital.unavailable === true` in
 * prose. So a naive grep of the RAW file over-counts. That is not an accident
 * to be worked around; it is a KNOWN CASE, and it is used here to prove the
 * comment stripper in BOTH DIRECTIONS with exact match counts:
 *
 *   `usdRow`                      RAW 10  →  STRIPPED 6
 *   `capital.unavailable === true` RAW  3  →  STRIPPED 2
 *
 * If the stripper ever stops stripping, the raw/stripped assertions diverge and
 * this file fails LOUDLY rather than reporting a comment as a call site.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "..", "..");
const DASH_REL = "client/src/pages/partner/PartnerDashboard.tsx";

/* A comment stripper that PRESERVES LINE NUMBERS and does not mistake a quote,
   a template literal or a regex-looking string for a comment. Proved below. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && d === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "sq"; out += c; i++; continue; }
      if (c === '"') { mode = "dq"; out += c; i++; continue; }
      if (c === "`") { mode = "tpl"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i++; continue;
    }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i += 2; continue; }
      if (c === "\n") out += c;
      i++; continue;
    }
    if (mode === "sq") { out += c; if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; } if (c === "'") mode = "code"; i++; continue; }
    if (mode === "dq") { out += c; if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; } if (c === '"') mode = "code"; i++; continue; }
    /* tpl */
    out += c;
    if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
    if (c === "`") mode = "code";
    i++;
  }
  return out;
}

const raw = fs.readFileSync(path.join(ROOT, DASH_REL), "utf8");
const code = stripComments(raw);
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

/** The two guards, verbatim, as they must appear in the shipped source. */
const SPV_GUARD = "data.portfolio.totalSpvCommittedMinor == null || capital == null || capital.unavailable === true";
const FUND_GUARD = "data.portfolio.totalFundCommittedMinor == null || capital == null || capital.unavailable === true";

describe("WAVE 283 §1 — the comment stripper is proved before any count is trusted", () => {
  it("PRECONDITION: the file was actually read and is the file we think it is", () => {
    expect(raw.length).toBeGreaterThan(10_000);
    expect(raw).toContain("export default function PartnerDashboard()");
    expect(code).toContain("export default function PartnerDashboard()");
  });

  /* NOTE ON THE DESIGN OF THIS SECTION — earned in this wave's own adversarial
     pass. The first draft used the SPV GUARD ITSELF as its "code-only" fixture
     and asserted ABSOLUTE match counts here. Disarming the fix then turned §1
     red, and it turned red for the WRONG REASON: the guard string had been
     removed, not the stripper broken. A stripper proof that fails when the
     thing it is measuring changes is not a stripper proof.
     So §1 now asserts only fixtures NO disarm of the fix can touch, and it
     asserts the raw-minus-stripped DIFFERENCE — which is a property of the
     COMMENTS alone and is therefore invariant under every mutation of the code.
     Absolute counts live in §2, where they are SUPPOSED to move. */

  it("BOTH DIRECTIONS on a known case: a comment-only string is present RAW and absent STRIPPED, and a code-only string is present in both", () => {
    /* Direction 1 — the stripper removes comment text. */
    const commentOnly = "THE GUARD AND THE PRINTED NUMBER WERE TWO";
    expect(raw.includes(commentOnly)).toBe(true);
    expect(code.includes(commentOnly)).toBe(false);
    /* Direction 2 — the stripper does NOT remove code. A stripper that removed
       everything would satisfy direction 1 alone and would be an inert
       instrument. These two fixtures are structural anchors of the tile that no
       disarm in this wave alters. */
    const codeOnly = 'data-testid="kpi-spv-unavailable"';
    expect(raw.includes(codeOnly)).toBe(true);
    expect(code.includes(codeOnly)).toBe(true);
    expect(code).toContain("const usdRow = capitalRows.find(");
  });

  it("MATCH COUNTS: the raw-minus-stripped DIFFERENCE is exactly the number of times the comments quote the code", () => {
    /* The header comment this wave wrote names `usdRow` FOUR times and
       `capital.unavailable === true` ONCE, in prose. Those differences are a
       property of the comment block and cannot be changed by mutating the
       guards. If the stripper ever stops stripping, both differences collapse
       to 0 and this fails loudly instead of reporting prose as a call site. */
    expect(count(/\busdRow\b/g, raw) - count(/\busdRow\b/g, code)).toBe(4);
    expect(
      count(/capital\.unavailable === true/g, raw) - count(/capital\.unavailable === true/g, code),
    ).toBe(1);
    /* And the stripped file is genuinely shorter — a stripper returning its
       input would pass a difference test only if the differences were 0, but
       this makes the direction explicit. */
    expect(code.length).toBeLessThan(raw.length);
  });
});

describe("WAVE 283 §2 — THE CONSUMER COUNT, asserted as === n and never as 'a match exists'", () => {
  it("there are EXACTLY THREE consumers of usdRow: two render sites and one predicate", () => {
    const renderSites = count(/usdRow \? usdRow\.\w+CommittedMinor : 0/g, code);
    const predicates = count(/usdRow === null/g, code);
    const declarations = count(/const usdRow = /g, code);
    expect(declarations).toBe(1);
    expect(renderSites).toBe(2);
    expect(predicates).toBe(1);
    expect(renderSites + predicates).toBe(3);
    /* 1 declaration + 2 render sites (two identifier uses each) + 1 predicate
       = 6 identifier occurrences. If a fourth consumer is ever added, this
       number moves and the wave that added it must decide, deliberately,
       whether it fabricates a zero. */
    expect(count(/\busdRow\b/g, code)).toBe(6);
  });

  it("BOTH render sites are guarded — the guard the test names and the value the screen shows are now the same thing", () => {
    expect(count(new RegExp(SPV_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), code)).toBe(1);
    expect(count(new RegExp(FUND_GUARD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), code)).toBe(1);
    expect(count(/capital == null \|\| capital\.unavailable === true/g, code)).toBe(2);
    /* And the widening APPENDED to the original condition rather than replacing
       it — w115_partner_committed_source asserts those substrings verbatim. */
    expect(code).toContain("data.portfolio.totalSpvCommittedMinor == null");
    expect(code).toContain("data.portfolio.totalFundCommittedMinor == null");
  });

  it("the fix does NOT over-reach: `usdRow == null` is in neither guard, so a TRUE zero is still printed", () => {
    expect(count(/usdRow == null/g, code)).toBe(0);
    /* Consumer 3 still owns the truthful-zero explanation, and it is still
       gated on the rollup being READABLE — an unreadable rollup must not claim
       the firm holds no US-dollar vehicles. */
    expect(code).toContain("capital != null && !capital.unavailable && usdRow === null");
  });

  it("R257.4 — availability is read with an EXPLICIT sentinel comparison, never falsiness", () => {
    /* `=== true`, not `capital.unavailable`. A bare truthiness read of a field
       that an older or newer server may not send is how a rollout makes every
       screen announce a failure that has not happened. */
    expect(count(/\|\| capital\.unavailable \?/g, code)).toBe(0);
    expect(count(/\|\| capital\.unavailable \|\|/g, code)).toBe(0);
    expect(count(/capital\.unavailable === true/g, code)).toBe(2);
  });

  it("NO MONEY ARITHMETIC WAS INTRODUCED on this path", () => {
    /* R231/money rules: each figure remains one server-computed integer handed
       straight to formatMinor with its own currency. */
    const region = code.slice(code.indexOf("const capital = "), code.indexOf('data-testid="kpi-no-currency"'));
    expect(region.length).toBeGreaterThan(400);
    expect(/parseInt\(/.test(region)).toBe(false);
    expect(/parseFloat\(/.test(region)).toBe(false);
    expect(count(/Number\(/g, region)).toBe(0);
  });
});

describe("WAVE 283 §3 — this dashboard is the ONLY production consumer of the rollup", () => {
  it("exactly one non-test file reads portfolio.capitalByCurrency", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        if (p.includes("__tests__") || /\.test\.tsx?$/.test(e.name)) continue;
        if (stripComments(fs.readFileSync(p, "utf8")).includes("capitalByCurrency")) hits.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, "client", "src"));
    /* PRECONDITION: the walk actually visited files. An empty search that finds
       nothing "proves" any absence you like. */
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.sort()).toEqual([DASH_REL]);
  });
});

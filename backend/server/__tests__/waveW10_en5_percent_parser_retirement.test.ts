/**
 * WAVE 10 / EN-5 — proof that the rival percent parsers are gone and that what
 * replaced them REJECTS where the old code CLAMPED.
 *
 * These tests are written to fail if the clamp comes back. The old
 * `frac()` ended in `Math.min(1, n)`, so it never threw: every assertion below
 * that expects a throw would have passed silently as a number under the old
 * implementation. That is the point — a test that only checks the happy path
 * cannot tell the two implementations apart, because on in-domain input they
 * agree exactly.
 */
import { describe, it, expect } from "vitest";
import { computeDistributionSplit } from "../lib/spvOfflineOps";
import {
  listPercentFields,
  assertStoredFraction,
  PERCENT_FIELD_DOMAIN,
} from "../lib/percentPolicy";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("EN-5 — anti-vacuity: the code under test is the code we think it is", () => {
  it("the waterfall module no longer contains the Math.min(1, n) clamp helper", () => {
    const src = SRC("server/lib/spvOfflineOps.ts");
    // The retired helper was declared exactly as `const frac = (v: unknown)`.
    expect(src).not.toMatch(/const\s+frac\s*=\s*\(v:\s*unknown\)/);
    expect(src).toContain("assertStoredFraction");
  });

  it("the SPV detail tabs no longer carry a second percent parser", () => {
    const src = SRC("client/src/components/partner/SpvDetailTabs.tsx");
    // The duplicate's signature body: a bare /100 return inside parsePercent.
    expect(src).not.toMatch(/function parsePercent\(v: string\): number \{[\s\S]*?return n \/ 100;/);
    expect(src).toContain("parsePercentInputToFraction");
  });

  /* WAVE 37 — THE PROBE WAS THE BROKEN PARTY, not the code and not the rule.
   *
   * This case swept the RAW file text, so it fired on
   * `SpvDetailTabs.tsx:199` — `/** Integer billionths -> a human percent.
   * Never `n > 1 ? n / 100 : n`. *\/` — a PROHIBITION that names the banned
   * expression in order to forbid it. Verified pre-existing: the same line is
   * present in the pre-Wave-36 backup, so no wave introduced it. Deleting the
   * comment to appease a grep would remove the warning that stops the next
   * builder reinstating the guesser; the sweep must read CODE.
   *
   * The ban itself is unchanged and comes from `spec/PERCENT_POLICY_v2.md`
   * (§0 — percentages are stored as written / fractional, with NO conversion
   * anywhere; §`spvOfflineOps.ts:851-852` — throw, never guess).
   *
   * STRENGTHENED, not loosened. The sweep now:
   *   1. strips comments and string/template literals before matching, so the
   *      ban applies to executable text only;
   *   2. SELF-TESTS the stripper against a synthetic module in which the
   *      heuristic appears once in a comment and once in live code — the
   *      comment copy must survive stripping and the code copy must be caught.
   *      Without this, a stripper that deleted everything would make the sweep
   *      vacuous, which is exactly the failure class this file exists to
   *      prevent;
   *   3. asserts the stripped text is non-trivial and still contains a known
   *      live token from each module, so "stripped to nothing" cannot pass. */
  const BANNED = /(?:>|>=)\s*1\s*\?\s*[a-zA-Z_$][\w$.]*\s*\/\s*100/;

  /** Remove block comments, line comments and string/template literals. */
  function codeOnly(src: string): string {
    let out = "";
    let i = 0;
    while (i < src.length) {
      const two = src.slice(i, i + 2);
      if (two === "/*") {
        const end = src.indexOf("*/", i + 2);
        i = end === -1 ? src.length : end + 2;
        out += " ";
        continue;
      }
      if (two === "//") {
        const end = src.indexOf("\n", i + 2);
        i = end === -1 ? src.length : end;
        out += " ";
        continue;
      }
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") {
        const quote = c;
        i += 1;
        while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
        i += 1;
        out += " ";
        continue;
      }
      out += c;
      i += 1;
    }
    return out;
  }

  it("the comment-stripping sweep is not vacuous — it catches the heuristic in CODE and ignores it in prose", () => {
    const synthetic = [
      "/** Never `n > 1 ? n / 100 : n`. */",
      "// also banned: x > 1 ? x / 100 : x",
      'const label = "n > 1 ? n / 100 : n";',
      "const live = n > 1 ? n / 100 : n;",
    ].join("\n");

    // The raw text contains four copies; the stripped text must retain exactly
    // the one live statement.
    expect(BANNED.test(synthetic)).toBe(true);
    const stripped = codeOnly(synthetic);
    expect(BANNED.test(stripped)).toBe(true);
    expect(stripped).toContain("const live =");
    expect(stripped).not.toContain("Never");
    expect(stripped).not.toContain("also banned");

    // And with the one live statement removed, the stripper must report clean —
    // proving it is the CODE copy the sweep sees, not the prose ones.
    const proseOnly = synthetic.split("\n").slice(0, 3).join("\n");
    expect(BANNED.test(proseOnly)).toBe(true); // raw text still matches
    expect(BANNED.test(codeOnly(proseOnly))).toBe(false); // stripped does not
  });

  it("the banned n>1?n/100:n heuristic appears in the CODE of neither module", () => {
    const liveToken: Record<string, string> = {
      "server/lib/spvOfflineOps.ts": "computeDistributionSplit",
      "client/src/components/partner/SpvDetailTabs.tsx": "parsePercentInputToFraction",
    };
    for (const f of Object.keys(liveToken)) {
      const code = codeOnly(SRC(f));
      // Anti-vacuity: the stripper did not eat the module.
      expect(code.length).toBeGreaterThan(1000);
      expect(code).toContain(liveToken[f]);
      expect(code).not.toMatch(BANNED);
    }
  });
});

describe("EN-5 — the stored-hurdle domain exists and is a FRACTION domain", () => {
  it("spv.hurdleRateFraction is declared, distinct from spv.hurdleRatePct", () => {
    expect(listPercentFields()).toContain("spv.hurdleRateFraction");
    expect(PERCENT_FIELD_DOMAIN["spv.hurdleRateFraction"].inputForm).toBe("fraction");
    expect(PERCENT_FIELD_DOMAIN["spv.hurdleRatePct"].inputForm).toBe("percent_as_written");
  });

  it("the two hurdle domains are NOT interchangeable — that is why both exist", () => {
    // 8 is a legal percent-as-written hurdle and an ILLEGAL stored fraction.
    expect(() => assertStoredFraction("spv.hurdleRateFraction", 8)).toThrow(
      /PERCENT_FIELD_OUT_OF_DOMAIN/,
    );
    expect(PERCENT_FIELD_DOMAIN["spv.hurdleRatePct"].max).toBe(100);
    expect(PERCENT_FIELD_DOMAIN["spv.hurdleRateFraction"].max).toBe(1);
  });
});

describe("EN-5 — the waterfall REJECTS an unnormalised percent instead of clamping it", () => {
  const base = { grossProceedsMinor: 1_000_000, contributedMinor: 500_000, carryPct: 0.2 };

  it("THE P-4 DEFECT: hurdle 8 must throw, not become a 100% preferred return", () => {
    // Under the retired frac(): Math.min(1, 8) = 1 → the preferred-return tier
    // claims 100% of contributed capital and the LPs get nothing beyond it.
    // No exception, no warning, a plausible-looking split, wrong money.
    expect(() => computeDistributionSplit({ ...base, hurdleRatePct: 8 })).toThrow(
      /PERCENT_FIELD_OUT_OF_DOMAIN:spv\.hurdleRateFraction/,
    );
  });

  it("a hurdle of exactly 1 (100%) is in-domain and still permitted", () => {
    expect(() => computeDistributionSplit({ ...base, hurdleRatePct: 1 })).not.toThrow();
  });

  it("a negative hurdle throws rather than silently becoming zero", () => {
    expect(() => computeDistributionSplit({ ...base, hurdleRatePct: -0.05 })).toThrow(
      /PERCENT_FIELD_OUT_OF_DOMAIN/,
    );
  });

  it("carry above 1 throws rather than clamping to 100% carry", () => {
    expect(() =>
      computeDistributionSplit({ ...base, carryPct: 20, hurdleRatePct: null }),
    ).toThrow(/PERCENT_FIELD_OUT_OF_DOMAIN:spv\.carryPct/);
  });

  it("gpCatchUpPct above 1 throws rather than clamping", () => {
    expect(() =>
      computeDistributionSplit({ ...base, hurdleRatePct: 0.08, gpCatchUpPct: 80 }),
    ).toThrow(/PERCENT_FIELD_OUT_OF_DOMAIN:spv\.gpCatchUpPct/);
  });

  it("a non-numeric hurdle throws rather than being coerced to 0", () => {
    expect(() =>
      computeDistributionSplit({ ...base, hurdleRatePct: "eight" as unknown as number }),
    ).toThrow(/PERCENT_FIELD_OUT_OF_DOMAIN/);
  });
});

describe("EN-5 — in-domain behaviour is UNCHANGED (no functionality dropped)", () => {
  const base = { grossProceedsMinor: 1_000_000, contributedMinor: 500_000, carryPct: 0.2 };

  it("blank / null / undefined hurdle still means 'no hurdle', simple model", () => {
    for (const v of [null, undefined, ""] as unknown as (number | null | undefined)[]) {
      const r = computeDistributionSplit({ ...base, hurdleRatePct: v as number | null });
      expect(r.tiered).toBe(false);
      expect(r.tiers.map((t) => t.tier)).toEqual([
        "return_of_capital",
        "gp_carry",
        "lp_profit",
      ]);
    }
  });

  it("the simple split is arithmetically the same as before the change", () => {
    const r = computeDistributionSplit({ ...base, hurdleRatePct: null });
    // 1,000,000 gross − 500,000 return of capital = 500,000 profit.
    // 20% carry = 100,000 GP; 400,000 LP profit.
    expect(r.lpTotalMinor).toBe(900_000);
    expect(r.gpTotalMinor).toBe(100_000);
    expect(r.lpTotalMinor + r.gpTotalMinor).toBe(1_000_000);
  });

  it("an 8% hurdle expressed CORRECTLY as 0.08 produces the tiered model", () => {
    const r = computeDistributionSplit({ ...base, hurdleRatePct: 0.08 });
    expect(r.tiered).toBe(true);
    // Preferred return = 8% of 500,000 contributed = 40,000 — NOT 500,000,
    // which is what the clamped hurdle of 1 would have produced.
    const pref = r.tiers.find((t) => t.tier === "preferred_return");
    expect(pref?.amountMinor).toBe(40_000);
    expect(r.lpTotalMinor + r.gpTotalMinor).toBe(1_000_000);
  });

  it("no distribution ever creates or destroys money", () => {
    for (const h of [null, 0.05, 0.08, 0.5, 1]) {
      for (const g of [0, 1, 999, 1_000_000, 7_777_777]) {
        const r = computeDistributionSplit({
          grossProceedsMinor: g,
          contributedMinor: 500_000,
          carryPct: 0.2,
          hurdleRatePct: h,
        });
        expect(r.lpTotalMinor + r.gpTotalMinor).toBe(g);
        expect(Number.isSafeInteger(r.lpTotalMinor)).toBe(true);
        expect(Number.isSafeInteger(r.gpTotalMinor)).toBe(true);
      }
    }
  });
});

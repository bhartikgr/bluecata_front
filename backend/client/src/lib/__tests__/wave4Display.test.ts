/**
 * Wave 4 (v26.1.x) — pure display-helper tests for the COS-1..COS-5 cosmetic
 * fixes. These pin the exact Ozan-locked behaviour:
 *  - COS-4: PPS 0 / null / unset → exactly "Not set" (never "$0.0000").
 *  - COS-5: illustrative position binds to the ENTERED amount; when none is
 *           entered it is an Example computed from the min ticket (never a
 *           hard-coded $250,000 presented as real).
 *  - COS-3: displayId normalizes an *id* token's casing for display only.
 *  - COS-1: NOT_PROVIDED is the single canonical placeholder string.
 *
 * Plain `.test.ts` (no JSX / React) → excluded from the tsc budget.
 */
import { describe, it, expect } from "vitest";
import {
  NOT_PROVIDED,
  PPS_NOT_SET,
  ppsDisplay,
  displayId,
  parseAmount,
  computeIllustrativePosition,
  orNotProvidedText,
} from "@/lib/wave4Display";

describe("COS-4 — ppsDisplay renders 'Not set' for unset/zero PPS", () => {
  it("returns exactly 'Not set' for null", () => {
    expect(ppsDisplay(null, 4)).toBe("Not set");
    expect(PPS_NOT_SET).toBe("Not set");
  });
  it("returns exactly 'Not set' for undefined", () => {
    expect(ppsDisplay(undefined, 2)).toBe("Not set");
  });
  it("returns exactly 'Not set' for 0 (never $0.0000)", () => {
    expect(ppsDisplay(0, 4)).toBe("Not set");
    expect(ppsDisplay(0, 4)).not.toContain("$0.0000");
  });
  it("returns exactly 'Not set' for NaN", () => {
    expect(ppsDisplay(Number.NaN, 4)).toBe("Not set");
  });
  it("formats a real PPS at the requested precision", () => {
    expect(ppsDisplay(1.42, 2)).toBe("$1.42");
    expect(ppsDisplay(1.4285, 4)).toBe("$1.4285");
  });
});

describe("COS-1 — NOT_PROVIDED canonical placeholder", () => {
  it("is exactly 'Not provided'", () => {
    expect(NOT_PROVIDED).toBe("Not provided");
  });
  it("orNotProvidedText trims and blanks empty values", () => {
    expect(orNotProvidedText("   ")).toBe("");
    expect(orNotProvidedText(null)).toBe("");
    expect(orNotProvidedText("  hello ")).toBe("hello");
  });
});

describe("COS-3 — displayId normalizes id casing for display only", () => {
  it("upper-cases a lower-case id token", () => {
    expect(displayId("zz-gate0-test-safe")).toBe("ZZ-GATE0-TEST-SAFE");
  });
  it("leaves an already-upper id unchanged", () => {
    expect(displayId("ZZ-GATE0-TEST-SAFE")).toBe("ZZ-GATE0-TEST-SAFE");
  });
  it("returns blank for empty input (no fabrication)", () => {
    expect(displayId("")).toBe("");
    expect(displayId(null)).toBe("");
  });
});

describe("parseAmount", () => {
  it("parses a plain numeric string", () => {
    expect(parseAmount("250000")).toBe(250000);
  });
  it("strips $ and commas", () => {
    expect(parseAmount("$1,000,000")).toBe(1000000);
  });
  it("returns null for blank/invalid/zero/negative", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
  });
});

describe("COS-5 — computeIllustrativePosition binds to entered amount", () => {
  it("binds to the ENTERED amount and computes shares/ownership from it", () => {
    // $500,000 entered, PPS $2, post-money $10,000,000.
    const pos = computeIllustrativePosition("500000", 100000, 2, 10_000_000);
    expect(pos.isExample).toBe(false);
    expect(pos.amount).toBe(500000);
    expect(pos.shares).toBe(250000); // 500000 / 2
    expect(pos.ownershipPct).toBeCloseTo(5, 6); // 500000/10000000 * 100
    expect(pos.proRata).toBe(true); // >= 250k
  });

  it("recomputes when the entered amount changes (not a hard-coded 250000)", () => {
    const small = computeIllustrativePosition("100000", 50000, 1, 10_000_000);
    const big = computeIllustrativePosition("2000000", 50000, 1, 10_000_000);
    expect(small.amount).toBe(100000);
    expect(big.amount).toBe(2000000);
    expect(big.shares).toBeGreaterThan(small.shares);
    expect(big.ownershipPct!).toBeGreaterThan(small.ownershipPct!);
    expect(small.proRata).toBe(false); // 100k < 250k
    expect(big.proRata).toBe(true);
  });

  it("flags isExample and uses the min ticket when NO amount is entered", () => {
    const pos = computeIllustrativePosition("", 75000, 1.5, 10_000_000);
    expect(pos.isExample).toBe(true);
    expect(pos.amount).toBe(75000); // falls back to min ticket, NOT 250000
    expect(pos.amount).not.toBe(250000);
    expect(pos.shares).toBe(50000); // 75000 / 1.5
  });

  it("treats a null/0 PPS as a 1:1 divisor for the shares estimate", () => {
    const pos = computeIllustrativePosition("100000", 50000, 0, 10_000_000);
    expect(pos.shares).toBe(100000);
  });

  it("returns null ownership when post-money is unknown", () => {
    const pos = computeIllustrativePosition("100000", 50000, 1, 0);
    expect(pos.ownershipPct).toBeNull();
  });
});

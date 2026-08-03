/**
 * Wave 0 acceptance gate 0-B — ledger primitives.
 *
 * V7 §4.1 pins three test vectors for `allocateResidualCents` — the
 * deterministic largest-remainder allocator. Every subsequent wave that touches
 * the ledger MUST re-verify these vectors are still exact.
 *
 * Tie-break rule (Opus v2 concern 8): (remainder DESC, index ASC).
 *
 * This file also asserts:
 *   - basisPoints uses banker's rounding (half-to-even), not naive round-half-up.
 *   - The allocator invariant `sum(result) === totalMinor` holds across a
 *     small sweep of representative combinations.
 *   - JPY (exponent 0) is treated as minor-unit-native — no /100.
 *   - Boundary conditions (zero total, zero weights, negative inputs) throw
 *     rather than silently mis-allocating.
 */

import { describe, it, expect } from "vitest";
import {
  basisPoints,
  allocateResidualCents,
  currencyExponent,
} from "../lib/money";

const b = BigInt;

describe("Wave 0 acceptance 0-B: allocator test vectors (V7 §4.1)", () => {
  it("vector 1: 10001 minor units, three payees at 1/3 each → [3334, 3334, 3333]", () => {
    const r = allocateResidualCents(b(10001), [b(1), b(1), b(1)]);
    expect(r).toEqual([b(3334), b(3334), b(3333)]);
    expect(r.reduce((a, v) => a + v, b(0))).toBe(b(10001));
  });

  it("vector 2: 1 minor unit at 80/20 → [1, 0] (remainder wins, not tie-break)", () => {
    const r = allocateResidualCents(b(1), [b(4), b(1)]);
    expect(r).toEqual([b(1), b(0)]);
  });

  it("vector 3: JPY ¥100 to three payees at 1/3 each → [34, 33, 33] (exponent 0, no /100)", () => {
    expect(currencyExponent("JPY")).toBe(0);
    const r = allocateResidualCents(b(100), [b(1), b(1), b(1)]);
    expect(r).toEqual([b(34), b(33), b(33)]);
  });
});

describe("Wave 0 acceptance 0-B: allocator invariants", () => {
  it("sum(result) === totalMinor across a sweep of combinations", () => {
    const cases: Array<[bigint, bigint[]]> = [
      [b(1), [b(1), b(1), b(1)]],
      [b(7), [b(1), b(2), b(3)]],
      [b(100), [b(7), b(11), b(13), b(17)]],
      [b(10001), [b(1), b(2), b(3), b(4), b(5)]],
      [b(1234567), [b(1), b(1)]],
      [b(999), [b(0), b(1), b(0), b(1)]],
    ];
    for (const [total, weights] of cases) {
      const r = allocateResidualCents(total, weights);
      const sum = r.reduce((acc, v) => acc + v, b(0));
      expect(sum).toBe(total);
      // Zero-weight positions get exactly zero.
      for (let i = 0; i < weights.length; i++) {
        if (weights[i] === b(0)) expect(r[i]).toBe(b(0));
      }
    }
  });

  it("residual distributes by (remainder DESC, index ASC) tie-break", () => {
    // 5 minor units, four payees weight 1 each → floors=1 each, remainders=1
    // each, residual=1 → first index wins the tie.
    const r = allocateResidualCents(b(5), [b(1), b(1), b(1), b(1)]);
    expect(r).toEqual([b(2), b(1), b(1), b(1)]);
  });

  it("rejects negative totalMinor", () => {
    expect(() => allocateResidualCents(b(-1), [b(1), b(1)])).toThrow(/non-negative/);
  });

  it("rejects negative weights", () => {
    expect(() => allocateResidualCents(b(10), [b(1), b(-1)])).toThrow(/non-negative/);
  });

  it("rejects empty weights", () => {
    expect(() => allocateResidualCents(b(10), [])).toThrow(/non-empty/);
  });

  it("rejects positive total with zero total weight (would drop money)", () => {
    expect(() => allocateResidualCents(b(10), [b(0), b(0)])).toThrow(/drop money/);
  });

  it("accepts zero total with zero total weight → all zeros", () => {
    expect(allocateResidualCents(b(0), [b(0), b(0)])).toEqual([b(0), b(0)]);
  });
});

describe("Wave 0 acceptance 0-B: basisPoints banker's rounding", () => {
  it("1/2 → 5000 bps (exact)", () => {
    expect(basisPoints(b(1), b(2))).toBe(5000);
  });

  it("1/3 → 3333 bps (down)", () => {
    expect(basisPoints(b(1), b(3))).toBe(3333);
  });

  it("2/3 → 6667 bps (up)", () => {
    expect(basisPoints(b(2), b(3))).toBe(6667);
  });

  it("1/1 → 10000 bps (100%)", () => {
    expect(basisPoints(b(1), b(1))).toBe(10000);
  });

  it("0/1 → 0 bps", () => {
    expect(basisPoints(b(0), b(1))).toBe(0);
  });

  it("banker's tie-break rounds exact halves to nearest even", () => {
    // (1 * 10000) / 20000 = 0.5 exact → banker rounds to nearest even (0)
    expect(basisPoints(b(1), b(20000))).toBe(0);
    // (3 * 10000) / 20000 = 1.5 exact → banker rounds to nearest even (2)
    expect(basisPoints(b(3), b(20000))).toBe(2);
  });

  it("rejects zero denominator", () => {
    expect(() => basisPoints(b(1), b(0))).toThrow(/positive/);
  });

  it("rejects negative numerator", () => {
    expect(() => basisPoints(b(-1), b(2))).toThrow(/non-negative/);
  });

  it("rejects > 100% result", () => {
    expect(() => basisPoints(b(2), b(1))).toThrow(/exceeds 10000/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   WAVE 125 · FINDING 1 + FINDING 2 — THE TWO RULES, PINNED AT THE UNIT.
   ════════════════════════════════════════════════════════════════════════════
   FINDING 1. `/founder/captable` told the founder of `BluePrint Catalyst Limited`
   — 150 shares on record, one investor holding all 150, NO founder row — that his
   FOUNDER OWNERSHIP was `0.00%` over `0 shares`, while `/founder/dashboard` showed
   `—` for the same quantity from the same data. The cap table was the one that was
   wrong: nothing about the founders is on record, so `0` is not an answer, it is a
   fabrication — on the single figure a founder cares about most.

   Both renderers reached that `0` by summing an EMPTY SET:
     · `CapTable.tsx` — `rows.filter(holderType === "founder").reduce(+, 0n)` → `0n`
     · `CapitalizationJourney.tsx` — `sumOwnershipPercent([])` → `0`
   Group (C) below RE-RUNS both of those expressions on the refusal fixture and
   shows they still return zero. That is the fail-before proof: the defect was the
   PUBLICATION of that zero, and `founderHoldingVerdict` is what now stops it.

   THE DISTINCTION EVERYTHING TURNS ON, asserted in all three states:
     A. no founder ROW, register populated  → REFUSE (no % and no share count)
     B. a founder row RECORDING zero        → PUBLISH `0` (a recorded fact)
     C. an empty register                   → UNCHANGED (w61a's pinned behaviour)
   A sum cannot tell A from B — both are zero. Row presence can, and that is the
   only signal this module uses.

   FINDING 2. `countCapTableHolders` is the definition
   `CapitalizationJourney.tsx:553-555` already used, lifted verbatim so the server
   producer that now feeds the dashboard, the switcher and the report snapshot
   counts holders the SAME way the journey KPI does (R46).
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import {
  founderHoldingVerdict,
  FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT,
  NO_FOUNDER_HOLDING_ON_RECORD,
} from "../founderHoldingOnRecord";
import { countCapTableHolders } from "../capTableHolderCount";
import { sumOwnershipPercent } from "../ownershipPercent";

/* ── FIXTURES ──────────────────────────────────────────────────────────────
   Shaped like the ENGINE's rows (`holderType`, `holderName`, `shares`,
   `ownershipPercent`), because that is what both renderers pass in. */

/** STATE A — BluePrint Catalyst Limited, as it is on production today. */
const NO_FOUNDER_ROW = [
  { holderType: "investor", holderName: "Aster Capital", shares: 150n, ownershipPercent: "100" },
];
const NO_FOUNDER_ROW_TOTAL = 150n;

/** STATE B — a founder row that RECORDS zero shares. Same total, same investor. */
const FOUNDER_ROW_RECORDING_ZERO = [
  { holderType: "founder", holderName: "Ada Okafor", shares: 0n, ownershipPercent: "0" },
  { holderType: "investor", holderName: "Aster Capital", shares: 150n, ownershipPercent: "100" },
];

/** STATE C — nothing on record at all. */
const EMPTY_REGISTER: typeof NO_FOUNDER_ROW = [];

describe("W125 · FINDING 1 (A) — a populated register with NO founder row refuses", () => {
  it("refuses, names the engine's own reason, and says why in plain English", () => {
    const v = founderHoldingVerdict(NO_FOUNDER_ROW, NO_FOUNDER_ROW_TOTAL);
    expect(v.refuse).toBe(true);
    expect(v.founderRowCount).toBe(0);
    expect(v.reason).toBe(NO_FOUNDER_HOLDING_ON_RECORD);
    expect(v.statement).toBe(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT);
  });

  it("the statement states that the figure is NOT zero, and quotes no figure", () => {
    expect(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT).toContain("no founder holding is on record");
    expect(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT).toContain("It is not zero");
    /* No percentage and no share count may appear inside a refusal. */
    expect(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT).not.toMatch(/\d/);
  });

  it("accepts the journey's `number` total as well as the cap table's `bigint`", () => {
    expect(founderHoldingVerdict(NO_FOUNDER_ROW, 150).refuse).toBe(true);
  });
});

describe("W125 · FINDING 1 (B) — a founder row RECORDING zero still publishes zero", () => {
  it("does not refuse: the row exists, so `0` is a recorded fact", () => {
    const v = founderHoldingVerdict(FOUNDER_ROW_RECORDING_ZERO, NO_FOUNDER_ROW_TOTAL);
    expect(v.refuse).toBe(false);
    expect(v.statement).toBeNull();
    expect(v.reason).toBeNull();
    expect(v.founderRowCount).toBe(1);
  });

  it("A and B are indistinguishable by the SUM and distinguishable by the ROW", () => {
    /* This is the assertion that proves the fix could not have been built on the
       sum. Both states sum to the same zero. */
    const sumA = NO_FOUNDER_ROW.filter((r) => r.holderType === "founder").reduce((s, r) => s + r.shares, 0n);
    const sumB = FOUNDER_ROW_RECORDING_ZERO.filter((r) => r.holderType === "founder").reduce((s, r) => s + r.shares, 0n);
    expect(sumA).toBe(0n);
    expect(sumB).toBe(0n);
    expect(sumA).toBe(sumB);
    /* And the verdicts differ. */
    expect(founderHoldingVerdict(NO_FOUNDER_ROW, NO_FOUNDER_ROW_TOTAL).refuse).toBe(true);
    expect(founderHoldingVerdict(FOUNDER_ROW_RECORDING_ZERO, NO_FOUNDER_ROW_TOTAL).refuse).toBe(false);
  });
});

describe("W125 · FINDING 1 (C) — an empty register is left exactly as Wave 61a pinned it", () => {
  it("does not refuse, so the `0 shares` hint and the em-dashed percentage survive", () => {
    const v = founderHoldingVerdict(EMPTY_REGISTER, 0n);
    expect(v.refuse).toBe(false);
    expect(v.statement).toBeNull();
  });

  it("a zero denominator with rows present is also left to the existing refusal", () => {
    const zeroTotal = [{ holderType: "investor", holderName: "Aster Capital", shares: 0n, ownershipPercent: null }];
    expect(founderHoldingVerdict(zeroTotal, 0n).refuse).toBe(false);
  });

  it("tolerates a null/undefined row set without inventing a refusal", () => {
    expect(founderHoldingVerdict(null, 0n).refuse).toBe(false);
    expect(founderHoldingVerdict(undefined, 0n).refuse).toBe(false);
  });
});

describe("W125 · FINDING 1 (D) — FAIL-BEFORE: the two deleted expressions still return zero", () => {
  it("`reduce(..., 0n)` over the empty founder set returns 0n on the refusal fixture", () => {
    const founderRows = NO_FOUNDER_ROW.filter((r) => r.holderType === "founder");
    expect(founderRows).toHaveLength(0);
    /* THE CAP TABLE'S OLD ARITHMETIC, re-run verbatim. */
    const founderShares = founderRows.reduce((s, r) => s + r.shares, 0n);
    const totalShares = NO_FOUNDER_ROW_TOTAL;
    expect(founderShares).toBe(0n);
    /* …and the tile's old expression turns that into the published lie. */
    expect(((Number(founderShares) / Number(totalShares)) * 100).toFixed(2)).toBe("0.00");
  });

  it("`sumOwnershipPercent([])` returns 0, not null — the journey's half of the defect", () => {
    expect(sumOwnershipPercent([])).toBe(0);
    const founderRows = NO_FOUNDER_ROW.filter((r) => r.holderType === "founder");
    expect(sumOwnershipPercent(founderRows as never)).toBe(0);
  });
});

describe("W125 · FINDING 2 — one definition of a cap-table holder", () => {
  it("counts DISTINCT holder names across founders, investors and the pool", () => {
    expect(
      countCapTableHolders([
        { holderType: "founder", holderName: "Ada Okafor" },
        { holderType: "founder", holderName: "Ada Okafor" },
        { holderType: "investor", holderName: "Aster Capital" },
        { holderType: "pool", holderName: "Option pool" },
      ]),
    ).toBe(3);
  });

  it("returns the journey's figure for BluePrint Catalyst: one holder, not zero", () => {
    expect(countCapTableHolders(NO_FOUNDER_ROW)).toBe(1);
  });

  it("ignores holder types outside the three published bands", () => {
    expect(countCapTableHolders([{ holderType: "creditor", holderName: "A Bank" }])).toBe(0);
  });

  it("a DERIVED zero is a real answer — an empty row set counts to zero", () => {
    /* The producer, not this function, is responsible for returning `null` when it
       had no rows to read; see `computeCapTableHolderCount`. */
    expect(countCapTableHolders([])).toBe(0);
  });
});

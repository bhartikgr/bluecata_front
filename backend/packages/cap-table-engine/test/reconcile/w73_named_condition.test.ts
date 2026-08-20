/**
 * WAVE 73 · ITEM 10 — `null` vs `"0"` IS A NAMED, REPORTED CONDITION, AND THE
 * REFERENCE ENGINE IS STILL INDEPENDENT.
 * ═══════════════════════════════════════════════════════════════════════════
 * Wave 72 (FINDING R-1) measured that the independent reference engine writes
 * `"0"` for a 0 ÷ 0 ownership ratio where the primary writes `null` (ruling D18),
 * so a populated zero-share table would reconcile as an ANONYMOUS divergence —
 * and the obvious "fix" for an anonymous divergence is to make the two engines
 * agree, which is exactly how a dual-engine gate stops being a check.
 *
 * Wave 72's own recommendation, adopted here: do NOT edit the reference engine.
 * NAME the condition in `reconcile` instead, so a future agent finds it explained.
 *
 * POLES
 *   A · a zero-share table with a real holder row: the primary reports the ratio
 *       as UNDEFINED, the reference reports `"0"`, and the diff row now carries
 *       `condition: "ownership_undefined_vs_zero"` plus an explanation that says
 *       not to make the engines identical. The run still reports `divergence`.
 *   B · an ORDINARY ownership divergence is reported exactly as before, with NO
 *       condition attached — the naming cannot swallow a real mismatch.
 *   C · the two REAL engines on a populated table still report `match`, so this
 *       change did not touch the agreeing path.
 */
import { describe, it, expect } from "vitest";
import { reconcile } from "../../src/reconcile/reconcile.js";
import { referenceComputeCapTable } from "../../../cap-table-engine-ref/src/refCapTable.js";
import type { Holder, Security } from "../../src/types.js";

const HOLDERS: Holder[] = [{ id: "founder1", name: "Ada", type: "founder" }];

/** A REAL holder row with ZERO shares — the D18 case: 0 ÷ 0. */
const ZERO_SHARE: Security = { id: "s0", holderId: "founder1", kind: "common", series: "Common", shares: 0n };
/** A populated row, for the agreeing pole. */
const REAL: Security = { id: "s1", holderId: "founder1", kind: "common", series: "Common", shares: 8_000_000n };

const OPTS_ZERO = {
  companyId: "cmp-w73-zero",
  asOf: "2026-08-18",
  view: "fully_diluted" as const,
  formulaRegion: "US" as const,
  holders: HOLDERS,
  transactions: [{ type: "issue" as const, security: ZERO_SHARE, date: "2026-01-01" }],
};

const OPTS_REAL = { ...OPTS_ZERO, companyId: "cmp-w73-real", transactions: [{ type: "issue" as const, security: REAL, date: "2026-01-01" }] };

describe("WAVE 73 · ITEM 10 — the undefined-vs-zero difference reports itself by name", () => {
  it("POLE A — a D18-unaware reference names the condition, explains it, and is still a divergence", () => {
    /* WHY A STAND-IN REFERENCE, STATED RATHER THAN GLOSSED. Wave 72's FINDING R-1
       reported that `packages/cap-table-engine-ref/src/refCapTable.ts:356` writes
       `"0"` where the primary writes `null`. That writer is real, and this pole
       drives exactly that shape. But the REAL reference engine, measured on the
       same zero-share table (POLE D below), does not reach that line for a
       zero-share security at all — it omits the row, so today's actual divergence
       on that table is a MISSING ROW. Both facts are recorded: this pole pins the
       recogniser against the `"0"` shape R-1 named, and POLE D pins what the real
       pair does now. */
    const d18Unaware = (o: Parameters<typeof referenceComputeCapTable>[0]) => {
      const r = referenceComputeCapTable(o);
      return {
        ...r,
        /* The row the primary produces for this table, with the reference
           engine's own `total === 0n` convention: the literal string "0". */
        rows: [
          {
            holderId: "founder1",
            holderName: "Ada",
            holderType: "founder",
            kind: "common",
            series: "Common",
            shares: 0n,
            ownershipPercent: "0",
            invested: null,
            currency: "USD",
          },
        ],
      } as ReturnType<typeof referenceComputeCapTable>;
    };

    const result = reconcile(OPTS_ZERO, d18Unaware as never, "w73-item10-a");
    expect(result.diffs.length).toBeGreaterThan(0);
    expect(result.status).toBe("divergence");

    const named = result.diffs.filter((d) => d.condition === "ownership_undefined_vs_zero");
    expect(named.length).toBeGreaterThan(0);
    for (const d of named) {
      /* One side has no ratio, the other has exactly zero, and the shares agree. */
      expect([d.primaryOwnership, d.referenceOwnership]).toContain("undefined");
      expect(d.shareDelta).toBe("0");
      /* The delta is not fabricated: the gap between a number and no number is
         not a number. */
      expect(d.ownershipDelta).toBe("undefined");
      /* THE EXPLANATION THAT REACHES THE READER OF THE RECONCILIATION. */
      expect(d.conditionNote ?? "").toContain("KNOWN CONDITION");
      expect(d.conditionNote ?? "").toContain("D18");
      expect(d.conditionNote ?? "").toContain("do NOT make the engines identical");
    }
  });

  it("POLE D — MEASURED, and it corrects the handover: the real reference engine OMITS a zero-share row", () => {
    /* Wave 72's R-1 said the reachable divergence would be `null` vs `"0"`. On the
       real pair it is not: the reference engine drops the zero-share security
       before it reaches its `total === 0n` branch, so the diff reports
       `(missing)`. That is a DIFFERENT, still-anonymous condition, and it is
       reported in build_log/wave73/WAVE73_REPORT.md rather than renamed here —
       naming it would be a second judgement this wave was not asked to make. */
    const result = reconcile(OPTS_ZERO, referenceComputeCapTable, "w73-item10-d");
    expect(result.status).toBe("divergence");
    expect(result.diffs.length).toBe(1);
    expect(result.diffs[0].referenceShares).toBe("(missing)");
    /* And the named condition is NOT claimed for it, because it is not that. */
    expect(result.diffs[0].condition).toBeUndefined();
  });

  it("POLE B — an ordinary ownership divergence carries NO condition", () => {
    /* A deliberately WRONG reference: it reports a real, different percentage.
       That is a genuine mismatch and must stay anonymous and loud. */
    const wrong = (o: Parameters<typeof referenceComputeCapTable>[0]) => {
      const r = referenceComputeCapTable(o);
      return { ...r, rows: r.rows.map((row) => ({ ...row, ownershipPercent: "42.5" })) };
    };
    const result = reconcile(OPTS_REAL, wrong, "w73-item10-b");
    expect(result.diffs.length).toBeGreaterThan(0);
    for (const d of result.diffs) {
      expect(d.condition).toBeUndefined();
      expect(d.conditionNote).toBeUndefined();
    }
  });

  it("POLE C — the two real engines on a populated table still report a match", () => {
    const result = reconcile(OPTS_REAL, referenceComputeCapTable, "w73-item10-c");
    expect(result.diffs.length).toBe(0);
    expect(result.status).toBe("match");
  });
});

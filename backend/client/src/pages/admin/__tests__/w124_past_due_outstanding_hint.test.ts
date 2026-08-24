/* ════════════════════════════════════════════════════════════════════════════
   WAVE 124 · FINDING 2 — THE ADMIN ROW THAT CONTRADICTED ITSELF ABOUT MONEY.
   ════════════════════════════════════════════════════════════════════════════
   `client/src/pages/admin/Companies.tsx` printed a past-due TENANT COUNT and, on
   the same row, "0 outstanding". The two numbers disagreed by construction:
   `subscriptions.past_due_minor` is the SEVENTH unfed money register in this
   tree — its only writer anywhere is the `co_quanta` seed constant
   (`server/subscriptionsStore.ts:258`). `updateSubscription` (:414) types the key
   as mutable but no caller in the tree ever passes it: not the payment-gateway
   adapter, not `partnerPortfolioCompanyRoutes.ts:147`, not
   `subscriptionsStore.ts:857`. So the tile's `(s.pastDueMinor ?? 0)` sum
   collapsed to zero for every real past-due tenant and published a confident $0
   that actually meant "unknown". Owner's rule: "A confident `$0` that means
   'unknown' is a false statement about money."

   The register is NOT back-filled here — feeding it is a server change outside
   this wave's ownership, and it is reported rather than faked. What is fixed is
   the statement: the sum is taken only over past-due subscriptions that carry a
   recorded figure, and when none do, the row says the figure is not on record
   instead of printing a number that is not a measurement.

   `pastDueOutstandingHint` is exported from the page for exactly this reason: the
   defect was arithmetic between two numbers on one row, so the rule is EXECUTED
   here rather than inferred from JSX.

   FAIL-BEFORE PROOF: before this wave the export did not exist and the tile's
   expression was `aggregates.pastDueMinor > 0 ? … : "0 outstanding"`; the
   collection error and the source assertion below are both in
   `build_log/wave124/W124_TESTS.md` §3.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pastDueOutstandingHint } from "../Companies";

const SRC = readFileSync(resolve(__dirname, "../Companies.tsx"), "utf8");

describe("(A) the past-due row never prints a figure it does not have", () => {
  it("does not say $0 outstanding beside a non-zero past-due count", () => {
    /* The exact production shape: three past-due tenants, register unfed. */
    const hint = pastDueOutstandingHint(3, 0, 0);
    expect(hint).toBe("Outstanding amount not on record");
    expect(hint).not.toContain("$0");
    expect(hint).not.toBe("0 outstanding");
  });

  it("says nothing is outstanding only when nothing is past due", () => {
    expect(pastDueOutstandingHint(0, 0, 0)).toBe("0 outstanding");
  });

  it("prints the figure when every past-due tenant has one on record", () => {
    expect(pastDueOutstandingHint(1, 1, 24_900)).toBe("$249.00 outstanding");
  });

  it("qualifies the figure when only some tenants have one on record", () => {
    /* The partial case is the one that could quietly under-report: the money
       shown is real, but it does not cover the whole count, and the row says so
       rather than letting the reader assume it does. */
    expect(pastDueOutstandingHint(4, 1, 24_900)).toBe("$249.00 outstanding on 1 of 4");
  });

  it("never disagrees with the count it sits beside", () => {
    /* Exhaustive over the small space the tile can actually be in. */
    for (let count = 0; count <= 5; count++) {
      for (let onRecord = 0; onRecord <= count; onRecord++) {
        const minor = onRecord * 10_000;
        const hint = pastDueOutstandingHint(count, onRecord, minor);
        if (count > 0 && onRecord === 0) {
          /* A non-zero count with no figures may not print any amount at all. */
          expect(hint).not.toMatch(/\$/);
          expect(hint).toBe("Outstanding amount not on record");
        }
        if (count > 0 && onRecord > 0) {
          expect(hint).toMatch(/^\$/);
          expect(hint).not.toBe("0 outstanding");
        }
      }
    }
  });
});

describe("(B) the tile reads the resolved sentence, and the shape is preserved", () => {
  it("no longer builds the hint inline from the collapsed sum", () => {
    expect(SRC).not.toContain(
      'aggregates.pastDueMinor > 0 ? `${fmtMoney(aggregates.pastDueMinor)} outstanding` : "0 outstanding"',
    );
    expect(SRC).toContain("hint: aggregates.pastDueHint");
  });

  it("sums only past-due subscriptions that carry a recorded figure", () => {
    /* The defect was the SOURCE of the sum: every past-due subscription,
       absent register included. The sum now runs over the filtered list only. */
    expect(SRC).not.toContain(
      'subs.filter(s => s.status === "past_due").reduce((sum, s) => sum + (s.pastDueMinor ?? 0), 0)',
    );
    expect(SRC).toContain("pastDueWithFigure.reduce((sum, s) => sum + (s.pastDueMinor ?? 0), 0)");
    expect(SRC).toContain(
      'pastDueSubs.filter(s => typeof s.pastDueMinor === "number" && s.pastDueMinor > 0)',
    );
  });

  it("keeps the five static stat entries so the drop guard's shape holds", () => {
    /* Wave 116 §3.1: the silent-drop guard identifies children positionally, so
       the conditional was hoisted into the memo and the array kept its shape. */
    const stats = SRC.slice(SRC.indexOf("stats={["), SRC.indexOf("]}\n        />"));
    expect((stats.match(/\{ label: /g) ?? []).length).toBe(5);
  });

  it("does not leak a bare 0 into the expanded subscription strip", () => {
    /* `{sub.pastDueMinor && <Stat …/>}` renders the NUMBER 0 as text when the
       register holds zero — an unlabelled "0" in a money grid. */
    expect(SRC).not.toContain("{sub.pastDueMinor && (");
    expect(SRC).toContain('{typeof sub.pastDueMinor === "number" && sub.pastDueMinor > 0 && (');
  });
});

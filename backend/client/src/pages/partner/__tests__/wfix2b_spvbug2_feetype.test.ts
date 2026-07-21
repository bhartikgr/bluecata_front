/**
 * W-FIX2b SPV-BUG-2 — Fee-type dropdown left stale fields + disabled Next.
 *
 * Root cause: the fee-type <select> did a raw `setW({ ...w, mgmtFeeType })`, so
 * switching types kept the OTHER branch's value (e.g. a blank carry% after
 * choosing "fixed", or a stale fixed amount after choosing "carry only"). The
 * launch mutation then submitted an invalid/irrelevant field and — before that —
 * the step could not reliably advance because dependent state was inconsistent.
 *
 * Fix contract (locked here, mirroring this tree's static-source test style):
 *   1. the select delegates to a dedicated `onFeeTypeChange` handler (no inline
 *      raw setW that only sets mgmtFeeType);
 *   2. that handler RESETS the now-irrelevant dependent field to a valid default
 *      (carry → fixed cleared to "0"; fixed → carry cleared to "0") so form
 *      state stays valid and Next re-enables;
 *   3. the step-2 gate still keys off a non-empty fee type.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(__dirname, "..", "PartnerSpvEngine.tsx"),
  "utf8",
);

describe("W-FIX2b SPV-BUG-2 — fee-type change keeps form state valid", () => {
  it("routes the fee-type select through a dedicated handler", () => {
    expect(src).toContain("onChange={(e) => onFeeTypeChange(e.target.value)}");
    expect(src).toContain("const onFeeTypeChange");
    // the old raw inline mutation must be gone
    expect(src).not.toContain("onChange={(e) => setW({ ...w, mgmtFeeType: e.target.value })}");
  });

  it("resets the irrelevant dependent field to a valid default on change", () => {
    const handler = src.slice(
      src.indexOf("const onFeeTypeChange"),
      src.indexOf("const onFeeTypeChange") + 400,
    );
    expect(handler).toContain('mgmtFeeType: feeType');
    // carry-only clears the fixed amount; fixed-only clears the carry %
    expect(handler).toContain('feeType === "carry" ? "0"');
    expect(handler).toContain('feeType === "fixed" ? "0"');
  });

  it("keeps the step-2 advance gate on a chosen fee type", () => {
    // W-FIX2d S1 co-located the required carry basis onto the Fees step, so the
    // step-2 gate now also keys off carryBasis. The fee-type condition remains.
    expect(src).toMatch(/if \(step === 2\) return !!w\.mgmtFeeType(\s*&&\s*!!w\.carryBasis)?;/);
  });
});

/**
 * W-SHADIE 2a — Apply-to-Collective required checkboxes must be visible BEFORE
 * they are checked.
 *
 * The shared shadcn primitive renders `border border-primary` (a 1px hairline in
 * Capavate brand red) on pale amber/blue panels, which reads as "no control
 * there." The fix is a per-instance className override on the two reported
 * instances — the shared primitive is NOT edited (20 consumers).
 *
 * ANTI-VACUITY: every class assertion is scoped to the extracted substring of
 * the specific data-testid'd element. A file-wide `toContain("border-2")` would
 * pass on any unrelated match in a 900-line file.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const APPLY_SRC = readFileSync(
  resolve(__dirname, "../ApplyToCollective.tsx"),
  "utf8",
);

const CHECKBOX_PRIMITIVE_SRC = readFileSync(
  resolve(__dirname, "../../../components/ui/checkbox.tsx"),
  "utf8",
);

/** Extract the single self-closing element carrying `data-testid="<id>"`. */
function elementByTestId(src: string, testId: string): string {
  const idx = src.indexOf(`data-testid="${testId}"`);
  expect(idx, `data-testid="${testId}" not found`).toBeGreaterThan(-1);
  const start = src.lastIndexOf("<", idx);
  const end = src.indexOf("/>", idx);
  expect(end, `no self-closing tag end for ${testId}`).toBeGreaterThan(idx);
  return src.slice(start, end + 2);
}

const TARGETS = ["checkbox-fee-ack", "checkbox-open-to-refinement"] as const;

describe("W-SHADIE 2a — per-instance checkbox visibility override", () => {
  for (const testId of TARGETS) {
    describe(testId, () => {
      it("is a Checkbox element and keeps its data-testid", () => {
        const el = elementByTestId(APPLY_SRC, testId);
        expect(el.startsWith("<Checkbox")).toBe(true);
        expect(el).toContain(`data-testid="${testId}"`);
      });

      it("carries a 2px neutral border INSIDE this element (not file-wide)", () => {
        const el = elementByTestId(APPLY_SRC, testId);
        expect(el).toContain("border-2");
        expect(el).toContain("border-slate-500");
      });

      it("carries an opaque white fill so it reads against the pale panel", () => {
        const el = elementByTestId(APPLY_SRC, testId);
        expect(el).toContain("bg-white");
      });

      it("is enlarged to h-5 w-5", () => {
        const el = elementByTestId(APPLY_SRC, testId);
        expect(el).toContain("h-5");
        expect(el).toContain("w-5");
      });

      it("does NOT override the checked fill, so checked state stays brand red", () => {
        const el = elementByTestId(APPLY_SRC, testId);
        // The primitive supplies data-[state=checked]:bg-primary. The override
        // may re-colour the checked BORDER but must never set a checked bg.
        expect(el).not.toContain("data-[state=checked]:bg-");
      });

      it("preserves its bound state handler (no behaviour change)", () => {
        const el = elementByTestId(APPLY_SRC, testId);
        expect(el).toContain("onCheckedChange");
        expect(el).toContain("checked={");
      });
    });
  }

  it("does NOT edit the shared Checkbox primitive (20 consumers)", () => {
    // Guard: the fix must stay per-instance. If someone 'improves' it by
    // editing the primitive, every other consumer changes silently.
    expect(CHECKBOX_PRIMITIVE_SRC).toContain("h-4 w-4");
    expect(CHECKBOX_PRIMITIVE_SRC).toContain("border-primary");
    expect(CHECKBOX_PRIMITIVE_SRC).toContain("data-[state=checked]:bg-primary");
    expect(CHECKBOX_PRIMITIVE_SRC).not.toContain("border-slate-500");
  });

  it("fixes exactly the two reported instances, by design", () => {
    // Scope statement made executable: no third instance was opportunistically
    // restyled in this file.
    const overrides = APPLY_SRC.split("border-2 border-slate-500 bg-white").length - 1;
    expect(overrides).toBe(2);
  });
});

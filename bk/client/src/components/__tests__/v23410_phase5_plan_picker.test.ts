/**
 * v23.4.10 Phase 5 (J-001) — plan-picker ToggleGroup fix.
 *
 * The "+ New company" dialog used to render the plan picker as three large
 * <RadioGroup> cards. Each card wrapped the radio item, a title, AND a line of
 * descriptive sub-text in a single <label htmlFor=...> with cursor-pointer and
 * a wide grid-cols-3 layout, so a stray click anywhere in the modal flipped the
 * selection (the BLOCKER J-001 bug — Free->Pro — that stopped 3 QA sessions).
 *
 * The fix replaces that block with a shadcn <ToggleGroup type="single">
 * segmented control (the same pattern v23.4.9 Phase 2 used for the round
 * category). The tight per-item click area kills the accidental-flip bug, and
 * the onValueChange handler guards against the empty string Radix emits on
 * deselect so the plan can never become "".
 *
 * These are source-grep assertions against NewCompanyDialog.tsx — deliberately
 * implementation-near so a regression that reintroduces RadioGroup, drops a
 * plan value, or removes the empty-string guard fails loudly in CI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../NewCompanyDialog.tsx"),
  "utf8",
);

describe("v23.4.10 Phase 5 (J-001) plan picker", () => {
  it("uses a single-select ToggleGroup", () => {
    expect(SRC).toMatch(/<ToggleGroup\b[\s\S]*?type="single"/);
  });

  it("imports ToggleGroup primitives from the ui module", () => {
    expect(SRC).toMatch(
      /import\s*\{\s*ToggleGroup\s*,\s*ToggleGroupItem\s*\}\s*from\s*"@\/components\/ui\/toggle-group"/,
    );
  });

  it("no longer renders or imports the old RadioGroup plan picker", () => {
    // The <RadioGroup> JSX element and <RadioGroupItem> must be gone, and the
    // radio-group import must be removed. (A mention of the word "RadioGroup"
    // inside the explanatory comment is intentional history, not a regression.)
    expect(SRC).not.toMatch(/<RadioGroup[\s>]/);
    expect(SRC).not.toMatch(/<RadioGroupItem[\s>]/);
    expect(SRC).not.toMatch(/from\s*"@\/components\/ui\/radio-group"/);
    expect(SRC).not.toMatch(/radio-group-new-company-plan/);
    expect(SRC).not.toMatch(/radio-plan-(free|pro|scale)/);
  });

  it("renders all three plan values", () => {
    expect(SRC).toContain('value="founder_free"');
    expect(SRC).toContain('value="founder_pro"');
    expect(SRC).toContain('value="founder_scale"');
  });

  it("exposes the new toggle data-testids", () => {
    expect(SRC).toContain('data-testid="toggle-group-new-company-plan"');
    expect(SRC).toContain('data-testid="toggle-plan-free"');
    expect(SRC).toContain('data-testid="toggle-plan-pro"');
    expect(SRC).toContain('data-testid="toggle-plan-scale"');
  });

  it("guards onValueChange against the empty-string deselect", () => {
    // The handler must short-circuit on a falsy value so plan never becomes "".
    expect(SRC).toMatch(/onValueChange=\{\(v\)\s*=>\s*\{\s*if\s*\(v\)\s*setPlan\(v as PlanPick\);?\s*\}\}/);
  });
});

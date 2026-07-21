/**
 * W-FIX2c SPV-BUG-3 (F4 family) — SPV detail tab-click + card-open reliability.
 *
 * LIVE PROOF: on the SPV detail page a plain click did NOT switch tabs and the
 * SPV card only opened via a raw pointer sequence (not a real link/button) —
 * the same first-click no-op family as F4/F6.
 *
 * Root cause (shared): controlled Radix `onValueChange` can miss the first
 * pointer interaction, and a bare <div> onClick is not a real interactive
 * element so the first click is dropped.
 *
 * Fix contract (static-source, matching this tree's convention):
 *   1. the SPV list card exposes REAL button semantics (role/tabIndex/keyboard)
 *      so a single normal click — and Enter/Space — opens the detail;
 *   2. the SPV detail tabs use an UNCONTROLLED Radix Tabs (`defaultValue`), which
 *      is first-click safe by construction (no controlled-value race).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const engine = readFileSync(resolve(__dirname, "..", "PartnerSpvEngine.tsx"), "utf8");
const tabs = readFileSync(
  resolve(__dirname, "..", "..", "..", "components", "partner", "SpvDetailTabs.tsx"),
  "utf8",
);

describe("W-FIX2c SPV-BUG-3 — SPV card opens on a single normal click", () => {
  it("gives the SPV card real button semantics (role + tabIndex + keyboard)", () => {
    const card = engine.slice(
      engine.indexOf("data-testid={`spv-row-${s.id}`}"),
      engine.indexOf("data-testid={`spv-row-${s.id}`}") + 700,
    );
    expect(card).toContain('role="button"');
    expect(card).toContain("tabIndex={0}");
    expect(card).toContain("aria-expanded={selectedId === s.id}");
    expect(card).toContain("onKeyDown=");
    expect(card).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
  });
});

describe("W-FIX2c SPV-BUG-3 — SPV detail tabs are first-click safe (uncontrolled)", () => {
  it("uses uncontrolled Radix Tabs (defaultValue), not a controlled value race", () => {
    expect(tabs).toContain('<Tabs defaultValue="overview"');
    // must NOT be a controlled value+onValueChange pair (the first-click risk).
    expect(tabs).not.toMatch(/<Tabs[^>]*\bvalue=\{/);
    expect(tabs).not.toContain("onValueChange");
  });
});

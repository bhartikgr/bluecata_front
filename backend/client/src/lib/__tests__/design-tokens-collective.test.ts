/**
 * Sprint 16 B1 — Collective design token port snapshot.
 *
 * Locks the brand-color contract, the Navy-tinted shadows, the pill radius
 * for primary CTAs, and the 23/55/22 dashboard grid template.
 */
import { describe, it, expect } from "vitest";
import { tokens, colors, shadows, radii, dashboardGrid } from "../design-tokens";

describe("Sprint 16 B1 — Collective design tokens", () => {
  it("brand color contract: Navy + Hydra + Plum + Reject", () => {
    expect(colors.navy).toBe("219 45% 20%");
    expect(colors.hydra).toBe("184 98% 22%");
    expect(colors.plum).toBe("333 75% 35%");
    expect(colors.reject).toBe("7 61% 43%");
  });

  it("warning amber + success green tokens present", () => {
    expect(colors.warning).toMatch(/\d+ \d+% \d+%/);
    expect(colors.success).toMatch(/\d+ \d+% \d+%/);
  });

  it("shadows tinted with Navy 219 45% 14%, not pure black", () => {
    expect(shadows.card).toContain("219 45% 14%");
    expect(shadows.pop).toContain("219 45% 14%");
    expect(shadows.modal).toContain("219 45% 14%");
    // Ensure the previous "0 0% 0%" / pure-black tint is gone
    expect(shadows.card).not.toContain("0 0% 0%");
  });

  it("pill radius defined", () => {
    expect(radii.pill).toBe("9999px");
  });

  it("dashboard 3-column grid: 23/55/22", () => {
    expect(dashboardGrid.template).toBe("23% 55% 22%");
  });

  it("typography scale within in-app max (≤1.5rem display)", () => {
    expect(tokens.typography.display.fontSize).toBe("1.5rem");
    expect(tokens.typography.h1.fontSize).toBe("1.25rem");
  });
});

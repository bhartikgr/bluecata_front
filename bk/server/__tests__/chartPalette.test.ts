/**
 * Wave G Track 2 — G7: Chart palette tests.
 *
 * Verifies the canonical exports + the brand-aligned colors. Pure
 * read-only file inspection keeps the test fast.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");
const FILE = path.join(ROOT, "client", "src", "lib", "chartPalette.ts");
const src = fs.readFileSync(FILE, "utf8");

describe("Wave G Track 2 G7 — chart palette", () => {
  it("exports CHART_PALETTE with all six scales", () => {
    expect(src).toMatch(/export\s+const\s+CHART_PALETTE/);
    for (const scale of ["primary", "success", "warning", "danger", "neutral", "diverging"]) {
      expect(src).toMatch(new RegExp(`${scale}:\\s*\\[`));
    }
  });

  it("primary scale starts at cap-primary brand-dark #0E7C9F", () => {
    expect(src).toMatch(/primary:\s*\["#0E7C9F"/);
  });

  it("exports CAPTABLE_COLORS as a 3-color array (founders / investors / option-pool)", () => {
    expect(src).toMatch(/export\s+const\s+CAPTABLE_COLORS\s*=\s*\[\s*"#0E7C9F"\s*,\s*"#0F766E"\s*,\s*"#A7F3D0"\s*\]/);
  });

  it("exports STATUS_COLORS with funded/committed/pending/declined", () => {
    expect(src).toMatch(/export\s+const\s+STATUS_COLORS/);
    expect(src).toMatch(/funded:\s*"#10B981"/);
    expect(src).toMatch(/committed:\s*"#0E7C9F"/);
    expect(src).toMatch(/pending:\s*"#F59E0B"/);
    expect(src).toMatch(/declined:\s*"#EF4444"/);
  });

  it("exports CHART_GRADIENTS for premium fills", () => {
    expect(src).toMatch(/export\s+const\s+CHART_GRADIENTS/);
    for (const k of ["primary", "success", "warning", "danger"]) {
      expect(src).toMatch(new RegExp(`${k}:\\s*\\[`));
    }
  });

  it("exports TOOLTIP_STYLE + TOOLTIP_LABEL_STYLE for refined hover tooltips", () => {
    expect(src).toMatch(/export\s+const\s+TOOLTIP_STYLE/);
    expect(src).toMatch(/export\s+const\s+TOOLTIP_LABEL_STYLE/);
    expect(src).toMatch(/borderRadius:\s*8/);
  });

  it("exports CHART_ANIMATION_DURATION_MS for fade-in animations", () => {
    expect(src).toMatch(/export\s+const\s+CHART_ANIMATION_DURATION_MS\s*=\s*\d+/);
  });

  it("exports helper functions categoricalColor + statusColor", () => {
    expect(src).toMatch(/export\s+function\s+categoricalColor\s*\(/);
    expect(src).toMatch(/export\s+function\s+statusColor\s*\(/);
  });

  it("imports compile via runtime require — palette has expected shape", async () => {
    // Use dynamic import to actually load the TS file via vitest's transformer.
    const mod = await import(
      path.join(ROOT, "client", "src", "lib", "chartPalette.ts")
    );
    expect(mod.CHART_PALETTE.primary).toHaveLength(5);
    expect(mod.CHART_PALETTE.success).toHaveLength(5);
    expect(mod.CAPTABLE_COLORS).toHaveLength(3);
    expect(mod.STATUS_COLORS.funded).toBe("#10B981");
    expect(mod.STATUS_COLORS.committed).toBe("#0E7C9F");
    expect(mod.categoricalColor(0)).toBe("#0E7C9F");
    expect(mod.categoricalColor(8)).toBe("#0E7C9F"); // wraps
    expect(mod.statusColor("Funded")).toBe("#10B981");
    expect(mod.statusColor("unknown")).toBeDefined();
  });
});

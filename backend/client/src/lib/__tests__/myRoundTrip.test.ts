import { describe, it, expect } from "vitest";
import { formatFractionAsPercent, parsePercentInputToFraction, fractionToPercentInput } from "../percentDisplay";

describe("Custom Round-trip Tests for Percent Display", () => {
  it("round-trips 0%", () => {
    const input = "0";
    const parseRes = parsePercentInputToFraction(input);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;
    expect(parseRes.fraction).toBe(0);
    expect(formatFractionAsPercent(parseRes.fraction)).toBe("0%");
    expect(fractionToPercentInput(parseRes.fraction)).toBe("0");
  });

  it("round-trips 100%", () => {
    const input = "100";
    const parseRes = parsePercentInputToFraction(input);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;
    expect(parseRes.fraction).toBe(1);
    expect(formatFractionAsPercent(parseRes.fraction)).toBe("100%");
    expect(fractionToPercentInput(parseRes.fraction)).toBe("100");
  });

  it("round-trips 12.5%", () => {
    const input = "12.5";
    const parseRes = parsePercentInputToFraction(input);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;
    expect(parseRes.fraction).toBe(0.125);
    expect(formatFractionAsPercent(parseRes.fraction)).toBe("12.5%");
    expect(fractionToPercentInput(parseRes.fraction)).toBe("12.5");
  });

  it("round-trips 0.07 (float-representation risk)", () => {
    // 0.07 * 100 = 7.000000000000001
    const input = "7";
    const parseRes = parsePercentInputToFraction(input);
    expect(parseRes.ok).toBe(true);
    if (!parseRes.ok) return;
    expect(parseRes.fraction).toBe(0.07);
    expect(formatFractionAsPercent(parseRes.fraction)).toBe("7%");
    expect(fractionToPercentInput(parseRes.fraction)).toBe("7");
    
    // Test the input parsing of 0.07 as well
    const parseRes2 = parsePercentInputToFraction("0.07");
    expect(parseRes2.ok).toBe(true);
    if (parseRes2.ok) {
        expect(parseRes2.fraction).toBe(0.0007);
        expect(formatFractionAsPercent(parseRes2.fraction)).toBe("0.07%");
    }
  });
});

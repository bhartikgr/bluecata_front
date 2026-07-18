/**
 * W-CAP LW-1 — phantom "Other" holder suppression predicate.
 */
import { describe, it, expect } from "vitest";
import { isPhantomHolderRow } from "../phantomHolder";

describe("isPhantomHolderRow (W-CAP LW-1)", () => {
  it("flags a nameless zero-shares zero-invested row as phantom", () => {
    expect(isPhantomHolderRow({ holderName: "", shares: 0, invested: 0 })).toBe(true);
  });

  it('flags the generic "Other" placeholder with no position as phantom', () => {
    expect(isPhantomHolderRow({ holderName: "Other", shares: 0, invested: 0 })).toBe(true);
    expect(isPhantomHolderRow({ holderName: "  other  ", shares: 0 })).toBe(true);
  });

  it("does NOT flag a real named holder", () => {
    expect(isPhantomHolderRow({ holderName: "Grace Hopper", shares: 0, invested: 0 })).toBe(false);
  });

  it('does NOT flag an "Other" row that actually holds shares', () => {
    expect(isPhantomHolderRow({ holderName: "Other", shares: 1000, invested: 0 })).toBe(false);
  });

  it('does NOT flag an "Other" row that actually invested', () => {
    expect(isPhantomHolderRow({ holderName: "Other", shares: 0, invested: 50000 })).toBe(false);
  });

  it("reads invested from orig.investmentAmount as a fallback", () => {
    expect(isPhantomHolderRow({ holderName: "Other", shares: 0, orig: { investmentAmount: 25000 } })).toBe(false);
  });

  it("handles bigint share counts", () => {
    expect(isPhantomHolderRow({ holderName: "", shares: 0n as unknown as number })).toBe(true);
    expect(isPhantomHolderRow({ holderName: "", shares: 5000n as unknown as number })).toBe(false);
  });
});

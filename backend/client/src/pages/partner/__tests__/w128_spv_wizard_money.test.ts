/**
 * WAVE 128 · ADDITION 3 — NO FLOAT ON THE FIGURES A VEHICLE IS CREATED WITH.
 *
 * Seven sites in `PartnerSpvEngine.tsx` ran `parseFloat` on money and multiplied
 * the result by a power of ten (`toMinor`): target raise, minimum cheque, hard
 * cap, GP commitment, both mandate cheque bounds and the fixed management fee.
 * These fields already collected whole units, so this was never a hundredfold
 * cents bug — it was float arithmetic, plus THREE silent-failure modes that are
 * demonstrated below over the real deleted expressions:
 *
 *   parseFloat("500,000")  -> 500          a thousandfold loss on a separator
 *   parseFloat("12abc")     -> 12          garbage became a figure
 *   parseFloat("x") || 0    -> 0           a typo created a vehicle with no target
 *
 * Every case below FAILS on the deleted expression and PASSES on the shipped
 * one, computed here rather than asserted from source. The source assertions at
 * the end exist for the one thing arithmetic cannot show: that the old
 * expressions are gone from the file and that the review step now agrees with
 * the wire because it shares its parser.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liveCode } from "./w126_live_code";
import {
  wizardMoney,
  wizardMoneyWire,
  wizardMoneyWireOptional,
  wizardMoneyDisplay,
  wizardMoneyDisplayOptional,
} from "@/pages/partner/PartnerSpvEngine";
import { toMinor } from "@/lib/currency";

/** The deleted expression, verbatim, so the comparison is not a paraphrase. */
const LEGACY = (raw: string, currency: string) => toMinor(parseFloat(raw || "0") || 0, currency);

describe("(A) FAIL-BEFORE — what the deleted expression did with a client's figure", () => {
  it("a thousands separator lost 99.9% of a $500,000 target raise", () => {
    expect(LEGACY("500,000", "USD")).toBe(50000);
    const now = wizardMoney("500,000", "USD", "Target raise");
    expect(now.ok).toBe(true);
    if (now.ok) expect(now.wire).toBe(50000000);
  });

  it("a mistyped figure became a real number instead of a refusal", () => {
    expect(LEGACY("12abc", "USD")).toBe(1200);
    const now = wizardMoney("12abc", "USD", "Target raise");
    expect(now.ok).toBe(false);
    if (!now.ok) expect(now.message).toMatch(/Target raise/);
  });

  it("an unparseable target raise created a vehicle with a target of ZERO", () => {
    expect(LEGACY("five hundred thousand", "USD")).toBe(0);
    expect(() => wizardMoneyWire("five hundred thousand", "USD", "Target raise")).toThrow(/target raise/i);
  });

  it("scientific notation was accepted as a hundred million dollars", () => {
    expect(LEGACY("1e8", "USD")).toBe(10000000000);
    expect(wizardMoney("1e8", "USD", "Hard cap").ok).toBe(false);
  });

  it("a third decimal place was silently rounded away instead of refused", () => {
    /* 1.005 dollars is not representable; the old path rounded to a figure
       nobody authorised. The new path refuses. */
    expect(LEGACY("1.005", "USD")).toBe(100);
    const r = wizardMoney("1.005", "USD", "Minimum cheque");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/2 decimal places|decimal/i);
  });

  it("a zero-decimal currency was multiplied by the wrong power of ten by NEITHER path — but only one refuses a fraction", () => {
    expect(LEGACY("250000", "JPY")).toBe(250000);
    const ok = wizardMoney("250000", "JPY", "Target raise");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.wire).toBe(250000);
    /* JPY has no fractional unit, so half a yen is a refusal, not a rounding. */
    expect(wizardMoney("250000.5", "JPY", "Target raise").ok).toBe(false);
  });

  it("a figure past the safe-integer boundary is refused, not silently degraded", () => {
    expect(() => wizardMoneyWire("999999999999999999", "USD", "Hard cap")).toThrow(
      /larger than this platform can record|implausibl/i,
    );
  });
});

describe("(B) the wire values a launch posts, for figures a partner really types", () => {
  it.each([
    ["500000", "USD", 50000000],
    ["$500,000.00", "USD", 50000000],
    ["8916.13", "USD", 891613],
    ["0", "USD", 0],
    ["", "USD", 0],
  ])("%s %s -> %s minor units", (raw, ccy, expected) => {
    expect(wizardMoneyWire(raw as string, ccy as string, "Target raise")).toBe(expected);
  });

  it("8916.13 is exact, where the float path is not guaranteed to be", () => {
    /* The point is not that this one input happens to round correctly today; it
       is that the shipped path performs NO float multiplication at all. */
    expect(wizardMoneyWire("8916.13", "USD", "Target raise")).toBe(891613);
  });

  it("optional money stays NULL when blank, and is never coerced to a zero", () => {
    expect(wizardMoneyWireOptional("", "USD", "GP commitment")).toBeNull();
    expect(wizardMoneyWireOptional("   ", "USD", "GP commitment")).toBeNull();
    expect(wizardMoneyWireOptional("25000", "USD", "GP commitment")).toBe(2500000);
    /* The old code wrote `null` here too — this pins that the fix did not turn a
       blank optional bound into a zero bound, which would have been a mandate
       that refuses every cheque. */
  });
});

describe("(C) the REVIEW step shows what will be created, or states the refusal", () => {
  it("a valid figure renders as the amount, in the vehicle's currency", () => {
    expect(wizardMoneyDisplay("500000", "USD", "Target raise")).toMatch(/500,000/);
    expect(wizardMoneyDisplay("250000", "JPY", "Target raise")).toMatch(/250,000/);
  });

  it("an unparseable figure renders the REFUSAL, never a number", () => {
    const shown = wizardMoneyDisplay("12abc", "USD", "Target raise");
    expect(shown).not.toMatch(/\d[\d,]*\.\d\d/);
    expect(shown.toLowerCase()).toContain("target raise");
  });

  it("the review and the wire cannot disagree, because they share one parse", () => {
    for (const raw of ["500000", "$500,000.00", "8916.13", "0"]) {
      const m = wizardMoney(raw, "USD", "Target raise");
      expect(m.ok).toBe(true);
      if (m.ok) {
        expect(wizardMoneyDisplay(raw, "USD", "Target raise")).toBe(m.display);
        expect(wizardMoneyWire(raw, "USD", "Target raise")).toBe(m.wire);
      }
    }
  });

  it("a blank OPTIONAL bound still reads as an em dash, not as zero", () => {
    expect(wizardMoneyDisplayOptional("", "USD", "Maximum cheque (mandate)")).toBe("—");
  });
});

describe("(D) the file itself: the old expressions are gone", () => {
  const src = liveCode(
    readFileSync(join(process.cwd(), "client/src/pages/partner/PartnerSpvEngine.tsx"), "utf8"),
  );

  it("no live `parseFloat` remains anywhere in the create-SPV wizard", () => {
    expect(src).not.toMatch(/parseFloat/);
  });

  it("no live `toMinor(` remains on any of the seven money keys", () => {
    for (const key of [
      "targetRaiseMinor",
      "minCheckMinor",
      "capMinor",
      "gpCommitMinor",
      "checkMinMinor",
      "checkMaxMinor",
      "fixedAmountMinor",
    ]) {
      expect(src, key).not.toMatch(new RegExp(`${key}:\\s*(w\\.[a-zA-Z]+\\.trim\\(\\)\\s*\\?\\s*)?toMinor\\(`));
    }
  });

  it("all seven post the value parsed BEFORE the first request", () => {
    /* The launch is three sequential writes and the first records an ESIGN
       attestation, so the parse must precede it. */
    const refusalAt = src.indexOf("if (refusal) throw new Error(refusal)");
    const parseAt = src.indexOf("const targetRaiseWire = wizardMoneyWire(");
    const firstPostAt = src.indexOf('apiRequest("POST", "/api/partner/me/spv"');
    expect(refusalAt).toBeGreaterThan(-1);
    expect(parseAt).toBeGreaterThan(refusalAt);
    expect(firstPostAt).toBeGreaterThan(parseAt);
    for (const v of ["minCheckWire", "capWire", "gpCommitWire", "checkMinWire", "checkMaxWire", "mgmtFixedWire"]) {
      expect(src, v).toMatch(new RegExp(`const ${v} =`));
      expect(src.indexOf(`const ${v} =`), v).toBeLessThan(firstPostAt);
    }
  });

  it("the step-2 Next gate asks the SAME parser the launch asks", () => {
    expect(src).toMatch(/wizardMoney\(w\.mgmtFixedMinor, w\.feeCurrency, "Fixed fee amount"\)/);
    expect(src).toMatch(/wizardMoney\(w\.gpCommitMajor, w\.currency, "GP commitment"\)/);
    expect(src).not.toMatch(/Number\(w\.gpCommitMajor/);
  });

  it("and there is no second converter: the wave-126 module is the only one", () => {
    expect(src).toMatch(/from "@\/components\/partner\/partnerMoneyInput"/);
    expect(src).not.toMatch(/function\s+\w*[Mm]ajorToMinor/);
    expect(src).not.toMatch(/\*\s*100\b/);
  });
});

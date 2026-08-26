/* ════════════════════════════════════════════════════════════════════════════
   WAVE 147 · OWNER RULING R111 Q13 — UNKNOWN MONEY IS NOT ZERO, AND IT IS NOT
   A DASH EITHER.
   ════════════════════════════════════════════════════════════════════════════
   `client/src/lib/currency.ts:112` was:

       const major = (Number(minor) || 0) / Math.pow(10, exp);

   `Number(null) === 0`, `Number(undefined) === NaN → || 0`, and `Number("") === 0`,
   so every absent monetary value that reached the ONE formatter the whole client
   uses was published as a confident `$0.00`. R111 Q13 fixes the wording for a
   monetary value the platform does not hold as exactly "Not on record".

   The other half of the ruling is the half that is easy to break: a value that
   IS zero must still read as zero. Both poles are asserted here.

   FAIL-BEFORE EVIDENCE (captured by restoring `(Number(minor) || 0)` and the two
   `"—"` constants — see build_log/wave147/W147_TESTS.md):
     POLE 1 → expected '$0.00' to be 'Not on record'
     POLE 3 → expected '—' to be 'Not on record'
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import { formatMinor, MONEY_NOT_ON_RECORD } from "@/lib/currency";
import {
  MONEY_UNAVAILABLE,
  formatMinorOrUnavailable,
  moneyOrNotProvided,
  moneyMajorOrNotProvided,
  NOT_PROVIDED,
} from "@/lib/moneyDisplay";
import { EXACT_MONEY_UNAVAILABLE } from "@/lib/exactMoney";

describe("WAVE 147 · R111 Q13 — POLE 1: an absent amount is refused, not zeroed", () => {
  it("refuses null / undefined / empty / NaN / Infinity through formatMinor itself", () => {
    /* Cast: the declared parameter stays `minor: number` ON PURPOSE (widening it
       would let the `?? 0` call sites compile silently). These are the values
       that reach the formatter at runtime from JSON payloads anyway. */
    expect(formatMinor(null as unknown as number, "USD")).toBe("Not on record");
    expect(formatMinor(undefined as unknown as number, "USD")).toBe("Not on record");
    expect(formatMinor("" as unknown as number, "USD")).toBe("Not on record");
    expect(formatMinor("   " as unknown as number, "USD")).toBe("Not on record");
    expect(formatMinor(Number.NaN, "USD")).toBe("Not on record");
    expect(formatMinor(Number.POSITIVE_INFINITY, "USD")).toBe("Not on record");
  });

  it("uses the owner's exact wording — never a bare dash, a 0, or a code", () => {
    expect(MONEY_NOT_ON_RECORD).toBe("Not on record");
    /* The refusal must be a statement a reader can understand. */
    expect(MONEY_NOT_ON_RECORD).not.toMatch(/[0-9]/);
    expect(MONEY_NOT_ON_RECORD).not.toBe("—");
    expect(MONEY_NOT_ON_RECORD).not.toMatch(/_|[A-Z]{3,}/);
  });
});

describe("WAVE 147 · R111 Q13 — POLE 2: a real zero is STILL a zero", () => {
  it("formats a genuine 0 as money, per currency exponent", () => {
    expect(formatMinor(0, "USD", { locale: "en-US" })).toBe("$0.00");
    expect(formatMinorOrUnavailable(0, "USD", { locale: "en-US" })).toBe("$0.00");
    expect(moneyOrNotProvided(0, "USD", { locale: "en-US" })).toBe("$0.00");
    /* JPY has exponent 0: a zero must not grow fraction digits. */
    expect(formatMinor(0, "JPY", { locale: "en-US" })).toBe("¥0");
  });

  it("still formats ordinary and string-shaped amounts unchanged", () => {
    expect(formatMinor(1234, "USD", { locale: "en-US" })).toBe("$12.34");
    /* Typed `number`, but several payloads carry `"1234"`. The old code coerced
       these through `Number(minor)`; refusing them would be a NEW defect. */
    expect(formatMinor("1234" as unknown as number, "USD", { locale: "en-US" })).toBe("$12.34");
    expect(formatMinor(0, "USD", { locale: "en-US" })).not.toBe(MONEY_NOT_ON_RECORD);
  });
});

describe("WAVE 147 · R111 Q13 — POLE 3: ONE wording, not four", () => {
  it("collapses the two em-dash money constants onto the ruling's words", () => {
    expect(MONEY_UNAVAILABLE).toBe("Not on record");
    expect(EXACT_MONEY_UNAVAILABLE).toBe("Not on record");
    expect(EXACT_MONEY_UNAVAILABLE).toBe(MONEY_UNAVAILABLE);
    expect(MONEY_UNAVAILABLE).toBe(MONEY_NOT_ON_RECORD);
  });

  it("retires the SECOND money wording the spec did not mention (NOT_PROVIDED)", () => {
    /* `moneyDisplay.ts:20` imports `NOT_PROVIDED` ("Not provided") and both MONEY
       helpers defaulted to it, so one state had two sentences. Money now speaks
       with one voice; `NOT_PROVIDED` itself is untouched because the non-money
       R6 helpers (percent, ratio, count) still use it legitimately. */
    expect(NOT_PROVIDED).toBe("Not provided");
    expect(moneyOrNotProvided(null, "USD")).toBe("Not on record");
    expect(moneyMajorOrNotProvided(null, "USD")).toBe("Not on record");
    expect(moneyOrNotProvided(null, "USD")).not.toBe(NOT_PROVIDED);
    /* An explicit caller override still wins — no caller is locked out. */
    expect(moneyOrNotProvided(null, "USD", { placeholder: NOT_PROVIDED })).toBe("Not provided");
  });

  it("refuses an unknown CURRENCY with the same words as an unknown amount", () => {
    expect(formatMinorOrUnavailable(12345, null)).toBe("Not on record");
    expect(formatMinorOrUnavailable(12345, "")).toBe("Not on record");
  });
});

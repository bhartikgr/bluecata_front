/**
 * WAVE 342 · ITEM 2 · W296 — THE SENTENCE THE SCREEN SHOWS.
 *
 * The server half of this item is proved in
 * `server/__tests__/w342_w296_distinct_amount_refusals.test.ts` (twelve distinct
 * sentences over real HTTP). This file proves the OTHER half, which is where the
 * defect actually bit: `spvErrorMessage()` in `SpvDetailTabs.tsx` translated the
 * CODE and threw the server's sentence away, so all twelve refusals — including
 * the six that already had their own words — reached the general partner as
 * "Amount must be greater than zero."
 *
 * `spvErrorMessage` is the function every `onError` toast in that file calls for
 * its `description`, so what it returns IS the rendered text.
 *
 * ASSERTED AGAINST `ApiError`'s REAL SHAPE, not a convenient one:
 * `client/src/lib/queryClient.ts` puts the parsed body on `.payload` and copies
 * no other body field onto the error object, so the test builds the error the way
 * `apiRequest` does.
 */
import { describe, it, expect } from "vitest";
import { spvErrorMessage } from "../SpvDetailTabs";
import { ApiError } from "@/lib/queryClient";

/** Exactly what `throwIfResNotOk` constructs for a 400 from the SPV routes. */
function apiErrorFor(body: Record<string, unknown>) {
  const message = typeof body.message === "string" ? body.message : "Some of the information was invalid. Please review and try again.";
  return new ApiError(400, message, typeof body.error === "string" ? body.error : null, body);
}

const OLD_SENTENCE = "Amount must be greater than zero.";

describe("W342 · W296 — the amount refusal a GP reads", () => {
  it("CONTROL — the defect is real: a bare INVALID_AMOUNT still shows the old floor", () => {
    /* This is the PRE behaviour, kept as a control. A body with no `amountError`
       (an older server, or any code with no amount copy) must still fall to the
       page's static translation — nothing was taken away. */
    const shown = spvErrorMessage(apiErrorFor({ error: "INVALID_AMOUNT" }));
    expect(shown).toBe(OLD_SENTENCE);
  });

  it("a named refusal shows the SERVER'S sentence, not the one static sentence", () => {
    const shown = spvErrorMessage(
      apiErrorFor({
        error: "INVALID_AMOUNT",
        amountError: { reason: "fractional", field: "cap" },
        message: "The cap must be a whole amount, with no fraction. Round it and try again.",
      }),
    );
    expect(shown).toBe("The cap must be a whole amount, with no fraction. Round it and try again.");
    expect(shown).not.toBe(OLD_SENTENCE);
  });

  it("twelve refusals render TWELVE DIFFERENT sentences", () => {
    const reasons = ["not_a_number", "fractional", "negative", "too_large"];
    const fields = ["target_raise", "minimum_check", "cap"];
    const shown = new Set<string>();
    for (const reason of reasons) {
      for (const field of fields) {
        // No `message` on the body: this forces the CLIENT'S OWN copy path, so a
        // server that has not been updated yet still shows the right words.
        shown.add(spvErrorMessage(apiErrorFor({ error: "INVALID_AMOUNT", amountError: { reason, field } })));
      }
    }
    expect(shown.size).toBe(12);
    for (const s of shown) {
      expect(s).not.toBe(OLD_SENTENCE);
      expect(s.length).toBeGreaterThan(30);
      expect(s).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/); // never a code on screen
    }
  });

  it("each sentence names ITS OWN field in words", () => {
    const t = spvErrorMessage(
      apiErrorFor({ error: "INVALID_AMOUNT", amountError: { reason: "negative", field: "minimum_check" } }),
    );
    expect(t).toContain("minimum check size");
    expect(t).not.toContain("minimum_check");
  });

  it("a reason this build does not know invents nothing AND repeats no false claim", () => {
    /* MEASURED, THEN DECIDED. My first expectation here was the page's static
       floor ("Amount must be greater than zero."). That is the wrong answer and
       writing it down showed why: for a refusal whose reason this build cannot
       name, the floor would be a CLAIM ABOUT THE AMOUNT that may well be false —
       precisely the defect W296 exists to remove. So an unnamed reason keeps the
       honest, non-specific sentence instead. It states nothing untrue and it
       never puts a code on screen. */
    const t = spvErrorMessage(
      apiErrorFor({ error: "INVALID_AMOUNT", amountError: { reason: "reason_from_a_future_build", field: "cap" } }),
    );
    expect(t).not.toBe(OLD_SENTENCE);
    expect(t).toBe("Some of the information was invalid. Please review and try again.");
    expect(t).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/);
  });

  it("a NEWER server's own sentence is used when this build has no copy for the reason", () => {
    const t = spvErrorMessage(
      apiErrorFor({
        error: "INVALID_AMOUNT",
        amountError: { reason: "reason_from_a_future_build", field: "cap" },
        message: "The cap is not valid for this vehicle's currency. Enter a whole amount.",
      }),
    );
    expect(t).toBe("The cap is not valid for this vehicle's currency. Enter a whole amount.");
  });

  it("NO OTHER CODE CHANGED — the static translations still win where they should", () => {
    expect(spvErrorMessage(apiErrorFor({ error: "SPV_NOT_FOUND" }))).toBe(
      "This SPV no longer exists. Refresh the page.",
    );
    expect(spvErrorMessage(apiErrorFor({ error: "TRANSFER_SELF" }))).toContain("two different investors");
  });
});

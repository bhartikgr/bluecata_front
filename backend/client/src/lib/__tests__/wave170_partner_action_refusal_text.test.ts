/**
 * WAVE 170 · BATCH 4 ITEM B · R77 / R111 Q13
 * ============================================================================
 * `partnerActionRefusalText` decides what a GP reads when one of the five
 * actions on `PartnerSpvDetail.tsx` is refused. These are the UNIT pins; the
 * rendered-DOM evidence (R137.1) is
 * `client/src/pages/partner/__tests__/wave170_raw_error_dom.test.tsx`.
 *
 * Every shape below is taken from LIVE code, not invented:
 *   · `{ error, message, guidance, capSplit }`  — spvEngineRoutes.ts err(), cap branch (wave 164)
 *   · `{ error, message, guidance }`            — err() copy-map branch (wave 162/166)
 *   · `{ error: "CAPITAL_CALL_FAILED" }`        — spvLegacyAdapters.ts capital-call 500
 *   · `{ error: "INVALID_BODY", details }`      — spvLegacyAdapters.ts / from-source 400
 *   · `{ error: "<CODE>", incidentCode }`       — err() unmapped tail (this wave)
 *   · `new Error("LP_IDENTITY_PERSIST_FAILED")` — a bare code thrown inside mutationFn
 *   · `new Error("Commitment amount cannot be negative. …")` — parseWholeUnits, commitMut
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/queryClient";
import {
  partnerActionRefusalText,
  isPlainRefusalSentence,
  PARTNER_ACTION_REFUSAL_FALLBACK,
  PARTNER_ACTION_REFERENCE_NOT_ON_RECORD,
  SPV_SUBSCRIPTION_REFUSAL_HEADLINE,
} from "@/lib/serverRefusalMessage";

/** No internal identifier may appear in anything this function returns (R77). */
const INTERNAL_CODE_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

describe("WAVE 170 · A — the server's own sentence wins, unmodified", () => {
  it("A1 — wave 164's cap-split headline reaches the GP byte-for-byte, as ONE sentence", () => {
    const headline = SPV_SUBSCRIPTION_REFUSAL_HEADLINE.EXCEEDS_CAP;
    expect(typeof headline).toBe("string");
    const err = new ApiError(400, headline as string, "EXCEEDS_CAP", {
      error: "EXCEEDS_CAP",
      message: headline,
      guidance: "the unabridged form",
      capSplit: { capMinor: 1_000_000, confirmedMinor: 900_000 },
    });
    const out = partnerActionRefusalText(err);
    expect(out).toBe(headline);
    // Not our sentence AND theirs — one coherent message, never two.
    expect(out).not.toContain(PARTNER_ACTION_REFUSAL_FALLBACK);
    expect(out).not.toContain("the unabridged form");
  });

  it("A2 — wave 166's offline-confirmation refusal is unchanged", () => {
    const headline = SPV_SUBSCRIPTION_REFUSAL_HEADLINE.GP_OFFLINE_CONFIRMATION_REQUIRED;
    const err = new ApiError(409, headline as string, "GP_OFFLINE_CONFIRMATION_REQUIRED", {
      error: "GP_OFFLINE_CONFIRMATION_REQUIRED",
      message: headline,
    });
    expect(partnerActionRefusalText(err)).toBe(headline);
  });

  it("A3 — `guidance` is used when there is no headline", () => {
    const err = new ApiError(400, "Some of the information was invalid. Please review and try again.", "X_Y", {
      error: "X_Y",
      guidance: "Nothing was recorded. Lower the amount and submit it again.",
    });
    expect(partnerActionRefusalText(err)).toBe("Nothing was recorded. Lower the amount and submit it again.");
  });
});

describe("WAVE 170 · B — a code with copy cannot arrive naked", () => {
  it("B1 — an exact mapped code with no attached message resolves through the shared map", () => {
    const err = new ApiError(400, "Some of the information was invalid. Please review and try again.", "EXCEEDS_CAP", {
      error: "EXCEEDS_CAP",
    });
    const out = partnerActionRefusalText(err);
    expect(out).toBe(SPV_SUBSCRIPTION_REFUSAL_HEADLINE.EXCEEDS_CAP);
    expect(INTERNAL_CODE_TOKEN.test(out)).toBe(false);
  });

  it("B2 — a prefix form resolves by the head before ':' (live shape from err())", () => {
    const err = new ApiError(400, "Some of the information was invalid. Please review and try again.", null, {
      error: "INVALID_SUBSCRIPTION_STATUS:string:committedd",
    });
    const out = partnerActionRefusalText(err);
    expect(out).toBe(SPV_SUBSCRIPTION_REFUSAL_HEADLINE.INVALID_SUBSCRIPTION_STATUS);
    expect(out).not.toContain("committedd");
    expect(INTERNAL_CODE_TOKEN.test(out)).toBe(false);
  });
});

describe("WAVE 170 · C — the unmapped refusal: a plain sentence and a traceable reference", () => {
  it("C1 — the wave-170 tail body yields the fallback sentence plus the opaque reference", () => {
    const err = new ApiError(500, "Something went wrong on our side. Please try again.", "LP_IDENTITY_PERSIST_FAILED", {
      error: "LP_IDENTITY_PERSIST_FAILED",
      incidentCode: "SPV-1A2B3C4D",
    });
    const out = partnerActionRefusalText(err);
    expect(out).toBe(`${PARTNER_ACTION_REFUSAL_FALLBACK} SPV-1A2B3C4D`);
    expect(out).not.toContain("LP_IDENTITY_PERSIST_FAILED");
    expect(INTERNAL_CODE_TOKEN.test(out)).toBe(false);
    // R77 — a next step, not just an apology.
    expect(out).toContain("nothing was changed");
    expect(out).toContain("Try it once more");
  });

  it("C2 — the legacy capital-call 500 (no message, no reference) says 'Not on record', never $0.00 or a dash", () => {
    const err = new ApiError(500, "Something went wrong on our side. Please try again.", "CAPITAL_CALL_FAILED", {
      error: "CAPITAL_CALL_FAILED",
    });
    const out = partnerActionRefusalText(err);
    expect(out).toBe(`${PARTNER_ACTION_REFUSAL_FALLBACK} ${PARTNER_ACTION_REFERENCE_NOT_ON_RECORD}`);
    expect(out).not.toContain("CAPITAL_CALL_FAILED");
    expect(out).not.toContain("$0.00");
    expect(out.trim().endsWith("-")).toBe(false);
    expect(out).toContain("Not on record");
  });

  it("C3 — INVALID_BODY with a zod `details` blob never renders the blob or the code", () => {
    const err = new ApiError(400, "Some of the information was invalid. Please review and try again.", "INVALID_BODY", {
      error: "INVALID_BODY",
      details: { fieldErrors: { amount_minor: ["Expected number, received string"] } },
      incidentCode: "SPV-DEADBEEF",
    });
    const out = partnerActionRefusalText(err);
    expect(out).toBe(`${PARTNER_ACTION_REFUSAL_FALLBACK} SPV-DEADBEEF`);
    expect(out).not.toContain("INVALID_BODY");
    expect(out).not.toContain("amount_minor");
  });
});

describe("WAVE 170 · D — non-ApiError throws: keep the human sentence, never the code", () => {
  it("D1 — a bare internal code thrown inside mutationFn never reaches the text", () => {
    const out = partnerActionRefusalText(new Error("LP_IDENTITY_PERSIST_FAILED"));
    expect(out).toBe(`${PARTNER_ACTION_REFUSAL_FALLBACK} ${PARTNER_ACTION_REFERENCE_NOT_ON_RECORD}`);
    expect(out).not.toContain("LP_IDENTITY_PERSIST_FAILED");
  });

  it("D2 — a JSON-parse failure inside mutationFn is not shown to a client", () => {
    const out = partnerActionRefusalText(new SyntaxError("Unexpected end of JSON input"));
    expect(out).not.toContain("JSON");
    expect(out).toContain(PARTNER_ACTION_REFUSAL_FALLBACK);
  });

  it("D3 — a network failure is not shown to a client", () => {
    const out = partnerActionRefusalText(new TypeError("Failed to fetch"));
    expect(out).not.toContain("Failed to fetch");
    expect(out).toContain(PARTNER_ACTION_REFUSAL_FALLBACK);
  });

  it("D4 — commitMut's OWN money refusal (parseWholeUnits) still reaches the GP verbatim", () => {
    const sentence = "Commitment amount cannot be negative. Enter the amount as a positive figure in USD.";
    expect(partnerActionRefusalText(new Error(sentence))).toBe(sentence);
  });

  it("D5 — nothing at all still produces a sentence, never an empty toast", () => {
    for (const v of [undefined, null, "", 0, {}, []]) {
      const out = partnerActionRefusalText(v);
      expect(out.length).toBeGreaterThan(20);
      expect(out).toContain(PARTNER_ACTION_REFUSAL_FALLBACK);
    }
  });
});

describe("WAVE 170 · E — the sentence test itself", () => {
  it("E1 — accepts prose, rejects codes, stacks, and code-bearing prose (R77)", () => {
    expect(isPlainRefusalSentence("Nothing was recorded. Lower the amount and try again.")).toBe(true);
    expect(isPlainRefusalSentence("EXCEEDS_CAP")).toBe(false);
    expect(isPlainRefusalSentence("INVALID_SUBSCRIPTION_STATUS:string:committedd")).toBe(false);
    expect(isPlainRefusalSentence("The refusal was EXCEEDS_CAP, please retry.")).toBe(false);
    expect(isPlainRefusalSentence("SyntaxError: Unexpected token < in JSON.")).toBe(false);
    expect(isPlainRefusalSentence("Failed to fetch")).toBe(false);
    expect(isPlainRefusalSentence("boom at spvEngineStore.ts:1600 failed.")).toBe(false);
    expect(isPlainRefusalSentence("HTTP 500: capital_call_failed")).toBe(false);
  });
});

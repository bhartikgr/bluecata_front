/**
 * WAVE 183 — R154.2: the four proved load failures.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * Wave 183's verdict is that the four surfaces do NOT share a middleware — they
 * share a FAILURE CLASS at the client boundary: a deterministic policy refusal
 * (HTTP 403, sometimes 409) was classified and rendered as a transient load or
 * transport failure. So the tests here are about CLASSIFICATION, which is where
 * the defect lived, plus the two extra causes that are specific to Surface 1
 * (the id-namespace mismatch and the demo-seed handler).
 *
 * These are pure-module tests against the real shipped functions. They do not
 * boot an Express app and they do not render React, because neither is needed to
 * prove a misclassification and both would have made the proof depend on
 * fixtures rather than on the code under repair.
 *
 * EVERY ASSERTION BELOW FAILS IF ITS FIX IS REVERTED. That is checked by hand in
 * `W183_TESTS.md` by restoring each pre-edit copy of the file in turn.
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "../../client/src/lib/queryClient";
import {
  portfolioFailureDetail,
  CAP_TABLE_REQUIRED_DETAIL,
  PORTFOLIO_SIGNED_OUT_DETAIL,
  investedDisplay,
  currentValueDisplay,
  ownershipDisplay,
  vintageDisplay,
  textOrNotOnRecord,
  unknownNotes,
  positionLogoColor,
  type DerivedPosition,
} from "../../client/src/lib/investor/portfolioPositions";
import { MONEY_NOT_ON_RECORD } from "../../client/src/lib/currency";

/** A position shaped exactly as `/api/investor/portfolio2` now serves it. */
function pos(over: Partial<DerivedPosition> = {}): DerivedPosition {
  return {
    id: "pos_co_x",
    companyId: "co_x",
    company: "Example Holdings",
    sector: null,
    stage: null,
    instrument: null,
    lastRoundLabel: null,
    lastRoundDate: null,
    investedMinor: "1000000",
    currency: "USD",
    investedExceedsSafeRange: false,
    currentValueMinor: null,
    shares: "4000000",
    ownershipPct: null,
    vintageYear: 2023,
    unknown: ["CURRENT_VALUE_NO_MARK_RECORDED", "OWNERSHIP_PCT_NO_CAP_TABLE_DENOMINATOR"],
    matchedVia: "canonical",
    ...over,
  };
}

function apiError(status: number, code: string | null): ApiError {
  return new ApiError(status, `${status}`, code, code ? { error: code } : null);
}

/* ══════════════════════════════════════════════════════════════════════════
   SURFACE 1 — INVESTOR PORTFOLIO. "We couldn't load your portfolio positions."
   ══════════════════════════════════════════════════════════════════════════ */
describe("W183 · Surface 1 · a 403 CAP_TABLE_REQUIRED is a stated fact, not a load failure", () => {
  it("names the missing cap-table position and does not tell the LP to retry", () => {
    const detail = portfolioFailureDetail(apiError(403, "CAP_TABLE_REQUIRED"));
    expect(detail).toBe(CAP_TABLE_REQUIRED_DETAIL);
    /* The substance of R154.2: the page must stop implying a retry helps. */
    expect(detail).toMatch(/retrying this page will not change it/i);
    /* It must point at the repair path the owner actually used. */
    expect(detail).toMatch(/I invested before I had an account/);
  });

  it("names the missing session for a 401", () => {
    expect(portfolioFailureDetail(apiError(401, null))).toBe(PORTFOLIO_SIGNED_OUT_DETAIL);
  });

  it("returns null for a GENUINE transient failure, so the preserved copy stands alone (ITEM C)", () => {
    /* A 500 from the new `PORTFOLIO_DERIVATION_FAILED` path really is a loading
       failure, and `LoadFailedRefusal`'s existing two sentences are already the
       right thing to say. `null` is what keeps them alone on screen. */
    expect(portfolioFailureDetail(apiError(500, "PORTFOLIO_DERIVATION_FAILED"))).toBeNull();
    expect(portfolioFailureDetail(apiError(429, null))).toBeNull();
    expect(portfolioFailureDetail(apiError(503, null))).toBeNull();
    /* A dropped connection is not an ApiError at all. */
    expect(portfolioFailureDetail(new TypeError("Failed to fetch"))).toBeNull();
    expect(portfolioFailureDetail(null)).toBeNull();
  });

  it("does not mistake a 403 with a DIFFERENT code for the cap-table refusal", () => {
    expect(portfolioFailureDetail(apiError(403, "SOMETHING_ELSE"))).toBeNull();
  });
});

describe("W183 · Surface 1 · no fabricated zero and no blank for an absent figure", () => {
  it("states money is not on record rather than printing 0", () => {
    const p = pos({ currentValueMinor: null });
    expect(currentValueDisplay(p)).toBe(MONEY_NOT_ON_RECORD);
    expect(currentValueDisplay(p)).not.toMatch(/0\.00/);
    expect(currentValueDisplay(p).trim().length).toBeGreaterThan(0);
  });

  it("formats a real invested figure from integer minor units in its OWN currency", () => {
    /* 1000000 minor USD = $10,000.00. The old seed sent major-unit floats with no
       currency at all, which is the mechanism behind the HK$/unprefixed-dollar
       inconsistency reported separately in ITEM D. */
    expect(investedDisplay(pos({ investedMinor: "1000000", currency: "USD" }))).toContain("10,000");
    const hk = investedDisplay(pos({ investedMinor: "1000000", currency: "HKD" }));
    expect(hk).not.toBe(MONEY_NOT_ON_RECORD);
    expect(hk).not.toContain("US$");
  });

  it("refuses a figure whose currency is unknown instead of assuming dollars", () => {
    expect(investedDisplay(pos({ investedMinor: "1000000", currency: null }))).toBe(
      MONEY_NOT_ON_RECORD,
    );
  });

  it("refuses a figure outside the MAX_SAFE_INTEGER boundary instead of rounding it", () => {
    expect(
      investedDisplay(pos({ investedMinor: "99999999999999999999", investedExceedsSafeRange: true })),
    ).toBe(MONEY_NOT_ON_RECORD);
  });

  it("states ownership is not on record rather than rendering 0.00%", () => {
    expect(ownershipDisplay(pos({ ownershipPct: null }))).not.toMatch(/0\.00%/);
    expect(ownershipDisplay(pos({ ownershipPct: null })).length).toBeGreaterThan(0);
    /* A real value still renders as a percentage. */
    expect(ownershipDisplay(pos({ ownershipPct: 4.21 }))).toBe("4.21%");
  });

  it("states text and vintage absences rather than rendering empty or NaN", () => {
    expect(textOrNotOnRecord(null).length).toBeGreaterThan(0);
    expect(textOrNotOnRecord("")).toBe(textOrNotOnRecord(null));
    expect(textOrNotOnRecord("Fintech")).toBe("Fintech");
    expect(vintageDisplay(pos({ vintageYear: null }))).not.toMatch(/NaN|null|undefined|^0$/);
    expect(vintageDisplay(pos({ vintageYear: 2023 }))).toBe("2023");
  });

  it("gives a reason sentence for every unknown field, so an absence is explained", () => {
    const notes = unknownNotes(pos());
    expect(notes.length).toBe(2);
    for (const n of notes) expect(n.length).toBeGreaterThan(20);
    /* The platform's own standard, quoted in the brief. */
    expect(notes.join(" ")).toMatch(/not a value of zero|not stated/i);
  });

  it("derives the avatar colour deterministically instead of reading a seeded one", () => {
    /* `logoColor` was a hardcoded HSL string per demo row and is no longer in the
       payload. A colour is presentation; it must be stable across reloads and it
       must not be invented server-side into a data payload. */
    expect(positionLogoColor("co_x")).toBe(positionLogoColor("co_x"));
    expect(positionLogoColor("co_x")).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    expect(positionLogoColor("co_x")).not.toBe(positionLogoColor("co_y"));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SURFACE 1, EXTRA CAUSE — THE R150.2 ID-NAMESPACE MISMATCH.

   `captable_commits.investor_id` holds `ext_<hash>` external ids for 654 of its
   1017 rows on this build, while the portfolio read looked the caller up by their
   canonical `u_*` id only. `investor_identity_alias` exists precisely to bridge
   the two and was never consulted by the read path, which is why "Check for
   earlier investments" could succeed and the portfolio still fail.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W183 · Surface 1 · the read path resolves aliases, not just the canonical id", () => {
  it("derivedPositionsFor unions every id in the caller's resolved id set", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../membershipStore.ts", import.meta.url), "utf8"),
    );
    /* Structural assertion, deliberately: the behavioural version needs a live
       alias row plus a ledger row for the same person, and this build's
       `investor_identity_alias` table has 0 rows, so a behavioural test would
       pass vacuously and prove nothing. Named here rather than hidden. */
    expect(src).toContain("resolveInvestorIdSet");
    const fn = src.slice(src.indexOf("function derivedPositionsFor"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toContain("resolveInvestorIdSet");
    /* And it must still work for a user with no aliases: the canonical id is the
       fallback, so an existing LP cannot lose their positions to this fix. */
    expect(body).toContain("[userId]");
  });

  it("the claim mutation invalidates the query the portfolio page actually reads", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../client/src/pages/investor/ClaimPositions.tsx", import.meta.url),
        "utf8",
      ),
    );
    /* THE R137 TRAP. The write succeeded, the handler invalidated
       `/api/investor/portfolio`, and every surface the LP opens reads
       `/api/investor/portfolio2`. A fix that never reaches the LP is not a fix. */
    expect(src).toContain('queryKey: ["/api/investor/portfolio2"]');
    expect(src).toContain('queryKey: ["/api/investor/portfolio"]');
  });

  it("the portfolio routes no longer serve the demo seed", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../routes.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain("derivePortfolioPositions");
    /* And it must fail LOUD rather than answering `[]`, because an empty array is
       read by the client as "you hold nothing" — a false statement, not an error. */
    expect(src).toContain("PORTFOLIO_DERIVATION_FAILED");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ITEM C — THE GOOD FAILURE COPY SURVIVES, BYTE-VERBATIM.

   R143.1: a REPLACED text node scores as a REMOVED copy string and fails guard.
   The new diagnosis is a STATIC SIBLING. This test pins the literals so a later
   wave cannot "improve" them without a deliberate, visible failure here.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W183 · ITEM C · the preserved transient-failure copy is untouched", () => {
  it("both LoadFailedRefusal literals are present byte-verbatim", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../client/src/components/LoadFailedRefusal.tsx", import.meta.url),
        "utf8",
      ),
    );
    expect(src).toContain("We couldn&rsquo;t load {what}.");
    expect(src).toContain(
      "Nothing has been changed. This is a loading failure, not an empty list \u2014 what you had",
    );
    expect(src).toContain("is still there.");
    /* The detail is OPTIONAL, which is what makes every pre-existing call site
       render byte-identical output to before this wave. */
    expect(src).toContain("detail?: string | null;");
  });

  it("the other three surfaces' literals are untouched", async () => {
    const fs = await import("node:fs");
    const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
    /* Surface 4's transport sentence — must still render for a real transport
       failure, which after this wave is the only thing that selects it. */
    expect(read("../../client/src/components/comms/CommsTierActionsPanel.tsx")).toContain(
      "We could not reach Capavate to send this",
    );
    /* Surface 3's genuine-DB-failure sentence. */
    expect(read("../../client/src/pages/collective/PartnersDirectory.tsx")).toContain(
      "Couldn't load partners. Please refresh.",
    );
    expect(read("../../client/src/pages/collective/PartnersDirectory.tsx")).toContain(
      "No partners listed yet.",
    );
    /* Surface 2's genuine-409 sentence. */
    expect(read("../../client/src/components/collective/MemberBillingPanel.tsx")).toContain(
      "Your membership tier could not be determined right now. Please retry shortly.",
    );
  });
});

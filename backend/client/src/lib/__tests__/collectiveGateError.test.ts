/**
 * client/src/lib/__tests__/collectiveGateError.test.ts
 *
 * W-COLLECTIVE Wave 1 review fix B11 — widget honesty must cover EVERY denial
 * code the Collective gate can return, not just the two it started with.
 *
 * CONTEXT. `collectiveWidgetErrorText` exists so that a widget refused by the
 * gate says why instead of "Couldn't load …" — the platform must not blame
 * itself for a refusal it made on purpose. But its code set was
 * `{not_collective_member, COLLECTIVE_INACTIVE}`, while
 * `server/lib/requireCollectiveMember.ts` also returns `not_on_cap_table`
 * (:169), `ACCREDITATION_STATUS_UNAVAILABLE` (:194) and
 * `ACCREDITATION_DECLARATION_REQUIRED` (:204). Those three fell through to the
 * fallback, so half the real denial paths still lied to the user.
 *
 * ANTI-VACUITY.
 *   • On the PRISTINE tree (build/_presnapshot) `collectiveWidgetErrorText`,
 *     `isCollectiveGateDenial` and `COLLECTIVE_DENIAL_CODES` do not exist at all
 *     — pristine `collectiveGateError.ts` exports only
 *     `isCollectiveMembershipError` and `CollectiveMembershipNotice` — so every
 *     test here fails at import/callsite.
 *   • On the PRE-B11 Wave 1 tree the three uncovered-code tests fail with
 *     `expected "Couldn't load X." to be "<honest copy>"`, and the
 *     "covers every code" test fails because the set had two entries.
 *   • The two REGRESSION tests (existing copy unchanged; a non-gate error still
 *     gets the fallback) pass on the pre-B11 tree by design — they exist to
 *     prove B11 removed nothing, and are labelled as such.
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/queryClient";
import {
  collectiveWidgetErrorText,
  isCollectiveGateDenial,
  isCollectiveMembershipError,
  COLLECTIVE_DENIAL_CODES,
} from "@/lib/collectiveGateError";

const FALLBACK = "Couldn't load platform pulse.";

/** An ApiError shaped exactly as `throwIfResNotOk` builds one for a 403. */
function denial(code: string, message = "server copy"): ApiError {
  return new ApiError(403, message, code, { ok: false, error: code, message });
}

/**
 * Every code the server can put in the `error` field of a Collective 403.
 * Kept literal (not imported from the server) so a server-side rename shows up
 * here as a failure rather than being silently followed.
 */
const GATE_CODES_FROM_SERVER = [
  // server/lib/requireCollectiveMember.ts
  "not_collective_member",
  "not_on_cap_table",
  "ACCREDITATION_STATUS_UNAVAILABLE",
  "ACCREDITATION_DECLARATION_REQUIRED",
  // server/lib/requireEntitlement.ts
  "COLLECTIVE_INACTIVE",
  // server/lib/collectiveAccessDecision.ts — the shared decision's reasons
  "not_authed",
  "partner_only",
  "application_pending",
  "billing_deactivation_pending",
  "accreditation_required",
  "accreditation_unavailable",
] as const;

describe("B11 — every denial code the gate can return produces honest copy", () => {
  for (const code of GATE_CODES_FROM_SERVER) {
    it(`${code} does not fall through to "Couldn't load…"`, () => {
      const text = collectiveWidgetErrorText(denial(code), FALLBACK);
      expect(text).not.toBe(FALLBACK);
      expect(text.trim().length).toBeGreaterThan(0);
      // Honest copy must not read as a platform fault.
      expect(text.toLowerCase()).not.toContain("couldn't load");
      expect(text.toLowerCase()).not.toContain("failed to load");
    });
  }

  it("the three codes the pre-fix mapping missed now have specific, distinct copy", () => {
    const capTable = collectiveWidgetErrorText(denial("not_on_cap_table"), FALLBACK);
    const declRequired = collectiveWidgetErrorText(
      denial("ACCREDITATION_DECLARATION_REQUIRED"),
      FALLBACK,
    );
    const declUnavailable = collectiveWidgetErrorText(
      denial("ACCREDITATION_STATUS_UNAVAILABLE"),
      FALLBACK,
    );

    expect(capTable).toContain("cap-table");
    expect(declRequired).toContain("declaration");
    expect(declUnavailable).toContain("accreditation");
    // A cap-table block is NOT a membership block; the copy must differ.
    expect(new Set([capTable, declRequired, declUnavailable]).size).toBe(3);
    expect(capTable).not.toBe("Collective membership required.");
  });

  it("COLLECTIVE_DENIAL_CODES lists every server code, so a new one cannot ship mute", () => {
    for (const code of GATE_CODES_FROM_SERVER) {
      expect(COLLECTIVE_DENIAL_CODES, code).toContain(code);
    }
    expect(COLLECTIVE_DENIAL_CODES.length).toBeGreaterThanOrEqual(
      GATE_CODES_FROM_SERVER.length,
    );
  });

  it("isCollectiveGateDenial recognises all of them, and only on a 403", () => {
    for (const code of GATE_CODES_FROM_SERVER) {
      expect(isCollectiveGateDenial(denial(code)), code).toBe(true);
    }
    // A 500 carrying the same code is a real failure, not a refusal.
    expect(
      isCollectiveGateDenial(
        new ApiError(500, "boom", "not_on_cap_table", { error: "not_on_cap_table" }),
      ),
    ).toBe(false);
  });
});

describe("B11 — nothing existing was removed (REGRESSION; passes pre-fix by design)", () => {
  it("the two original codes keep their original text byte-for-byte", () => {
    expect(collectiveWidgetErrorText(denial("not_collective_member"), FALLBACK)).toBe(
      "Collective membership required.",
    );
    expect(collectiveWidgetErrorText(denial("COLLECTIVE_INACTIVE"), FALLBACK)).toBe(
      "Collective membership required.",
    );
  });

  it("a genuine transport failure still gets the widget's own fallback", () => {
    expect(collectiveWidgetErrorText(new Error("network down"), FALLBACK)).toBe(FALLBACK);
    expect(collectiveWidgetErrorText(new ApiError(500, "boom", null, null), FALLBACK)).toBe(
      FALLBACK,
    );
    expect(collectiveWidgetErrorText(undefined, FALLBACK)).toBe(FALLBACK);
    // A 403 the Collective gate did NOT raise must not be re-labelled.
    expect(collectiveWidgetErrorText(denial("NOT_ADMIN"), FALLBACK)).toBe(FALLBACK);
  });

  it("isCollectiveMembershipError stays NARROW — it drives membership-specific copy", () => {
    // CollectiveMembershipNotice links to /collective/membership, which cannot
    // resolve an accreditation or cap-table block. Widening this predicate would
    // send those users somewhere useless, so B11 deliberately did not.
    expect(isCollectiveMembershipError(denial("not_collective_member"))).toBe(true);
    expect(isCollectiveMembershipError(denial("COLLECTIVE_INACTIVE"))).toBe(true);
    expect(isCollectiveMembershipError(denial("not_on_cap_table"))).toBe(false);
    expect(
      isCollectiveMembershipError(denial("ACCREDITATION_DECLARATION_REQUIRED")),
    ).toBe(false);
  });
});

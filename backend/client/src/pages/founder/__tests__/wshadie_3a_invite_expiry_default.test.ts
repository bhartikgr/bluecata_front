/**
 * W-SHADIE 3a — one consistent 7-day invite-expiry default across every client
 * dialog surface.
 *
 * Before: RoundNew's manual dialog defaulted to 14, RoundDetail's invite dialog
 * defaulted to 30, RoundDetail offered no 7-day option at all, and both dialogs
 * RESET to their old hard-coded literal after a successful submit — so a fix
 * applied only to the initial state would appear to work once and then revert.
 *
 * ANTI-VACUITY: this asserts the ABSENCE of the old literals at the changed
 * sites, not merely that a constant equal to 7 exists somewhere. A shared
 * module that nobody imports would satisfy the naive form of this test, so the
 * import and its use are asserted too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUND_NEW_SRC = readFileSync(resolve(__dirname, "../RoundNew.tsx"), "utf8");
const ROUND_DETAIL_SRC = readFileSync(resolve(__dirname, "../RoundDetail.tsx"), "utf8");
const INVITE_EXPIRY_SRC = readFileSync(
  resolve(__dirname, "../../../lib/inviteExpiry.ts"),
  "utf8",
);

describe("W-SHADIE 3a — shared constants module", () => {
  it("declares the option set including 7 and 90", () => {
    expect(INVITE_EXPIRY_SRC).toContain("export const INVITE_EXPIRY_OPTIONS = [7, 14, 30, 60, 90] as const;");
  });

  it("declares the 7-day default", () => {
    expect(INVITE_EXPIRY_SRC).toContain("export const DEFAULT_INVITE_EXPIRY_DAYS = 7;");
  });

  it("is NOT an orphan module — RoundNew imports it", () => {
    expect(ROUND_NEW_SRC).toMatch(
      /import \{[^}]*INVITE_EXPIRY_OPTIONS[^}]*DEFAULT_INVITE_EXPIRY_DAYS[^}]*\} from "@\/lib\/inviteExpiry";/,
    );
  });
});

describe("W-SHADIE 3a — RoundNew manual-invite dialog", () => {
  it("initial draft state uses the shared default, not the 14 literal", () => {
    expect(ROUND_NEW_SRC).toContain('expiryDays: String(DEFAULT_INVITE_EXPIRY_DAYS)');
  });

  it("NO expiryDays literal of 14 survives anywhere in the file", () => {
    // Covers BOTH the initial state and the post-add reset in one assertion:
    // each was `expiryDays: "14"` and both must be gone.
    expect(ROUND_NEW_SRC).not.toContain('expiryDays: "14"');
  });

  it("post-add reset restores the shared default (else it reverts after the first add)", () => {
    const resetIdx = ROUND_NEW_SRC.indexOf("setManualDraft({ firstName: \"\"");
    expect(resetIdx, "post-add reset not found").toBeGreaterThan(-1);
    const reset = ROUND_NEW_SRC.slice(resetIdx, ROUND_NEW_SRC.indexOf("}", resetIdx + 40) + 1);
    expect(reset).toContain("expiryDays: String(DEFAULT_INVITE_EXPIRY_DAYS)");
    expect(reset).not.toContain('"14"');
  });

  it("the submitted payload falls back to the shared default, not 14", () => {
    expect(ROUND_NEW_SRC).toContain("expiryDays: Number(manualDraft.expiryDays) || DEFAULT_INVITE_EXPIRY_DAYS");
  });

  it("the expiry hint falls back to the shared default, not 14", () => {
    expect(ROUND_NEW_SRC).toContain("const d = Number(manualDraft.expiryDays) || DEFAULT_INVITE_EXPIRY_DAYS;");
  });

  it("no stray `|| 14` expiry fallback remains", () => {
    expect(ROUND_NEW_SRC).not.toContain("expiryDays) || 14");
  });

  it("the option list is driven by the shared constant", () => {
    expect(ROUND_NEW_SRC).toContain("INVITE_EXPIRY_OPTIONS.map((d) => (");
    expect(ROUND_NEW_SRC).not.toContain("{[7, 14, 30, 60, 90].map((d) => (");
  });

  it("the stale 'default 14' comment is corrected", () => {
    expect(ROUND_NEW_SRC).not.toContain("default 14");
    expect(ROUND_NEW_SRC).toContain("default 7");
  });
});

describe("W-SHADIE 3a — RoundDetail invite dialog", () => {
  it("state default is 7, and the old 30 literal is GONE", () => {
    expect(ROUND_DETAIL_SRC).toContain('const [inviteExpiry, setInviteExpiry] = useState("7")');
    expect(ROUND_DETAIL_SRC).not.toContain('useState("30")');
  });

  it("post-send reset is 7, and the old 30 reset is GONE", () => {
    expect(ROUND_DETAIL_SRC).toContain('setInviteExpiry("7")');
    expect(ROUND_DETAIL_SRC).not.toContain('setInviteExpiry("30")');
  });

  it("offers 7 as the FIRST option and still offers 90 and Never", () => {
    const i7 = ROUND_DETAIL_SRC.indexOf('value="7"');
    const i14 = ROUND_DETAIL_SRC.indexOf('value="14"');
    const i30 = ROUND_DETAIL_SRC.indexOf('value="30"');
    const i60 = ROUND_DETAIL_SRC.indexOf('value="60"');
    const i90 = ROUND_DETAIL_SRC.indexOf('value="90"');
    const iNever = ROUND_DETAIL_SRC.indexOf('value="never"');
    for (const [name, idx] of Object.entries({ i7, i14, i30, i60, i90, iNever })) {
      expect(idx, `${name} option missing`).toBeGreaterThan(-1);
    }
    expect(i7).toBeLessThan(i14);
    expect(i14).toBeLessThan(i30);
    expect(i30).toBeLessThan(i60);
    expect(i60).toBeLessThan(i90);
    expect(i90).toBeLessThan(iNever);
  });

  it("bulk CSV dialog copy matches the real bulk expiry", () => {
    expect(ROUND_DETAIL_SRC).toContain("default 7-day expiry");
    expect(ROUND_DETAIL_SRC).not.toContain("default 30-day expiry");
  });

  it("does NOT change the Extend increment (different feature)", () => {
    // Extend anchors additively on max(now, current expiry). It is an
    // increment, not an initial-invite default, and is deliberately out of
    // W-SHADIE scope.
    expect(ROUND_DETAIL_SRC).toContain("{ expiryDays: 30 }");
    expect(ROUND_DETAIL_SRC).toContain("Expiry extended +30 days");
  });
});

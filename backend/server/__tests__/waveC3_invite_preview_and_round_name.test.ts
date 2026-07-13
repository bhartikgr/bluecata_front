/**
 * Wave C3 (Shadie 2a + 7a).
 *
 * 2a — the invitation-email PREVIEW must be byte-identical to what is actually
 * sent, because both render through the single shared renderer. The founder's
 * personal note is included; escaping is applied.
 *
 * 7a — round names must be UNIQUE per company (case-insensitive); the store
 * rejects a duplicate and can suggest a unique, editable alternative.
 */
import { describe, it, expect } from "vitest";
import { renderInvitationEmail } from "../roundInvitationsStore";
import { createRound, suggestUniqueRoundName, roundNameExistsForCompany } from "../roundsStore";

const CO = "co_wc3_test";

describe("Wave C3 (2a) — invitation email preview == send", () => {
  it("renders the personal note into the email body and escapes it", () => {
    const out = renderInvitationEmail({
      investorName: "Dana",
      companyName: "NovaPay",
      roundName: "Seed",
      link: "https://capavate.com/auth/redeem?token=abc",
      note: "Great meeting you <at> the event",
      expiryDays: 30,
    });
    expect(out.subject).toBe("[Capavate] You're invited to NovaPay — Seed");
    expect(out.html).toContain("Note from the founder:");
    // The note is HTML-escaped (no raw angle brackets injected).
    expect(out.html).toContain("Great meeting you &lt;at&gt; the event");
    expect(out.html).not.toContain("<at>");
    expect(out.html).toContain("expires in 30 days");
  });

  it("renders the SELECTED expiry (preview == send on the expiry line)", () => {
    // Wave C3 REVISE — the founder-selected expiry must render identically in
    // preview and send. Passing expiryDays:30 must show "30 days", not the
    // 14-day default; when omitted, BOTH default to 14.
    const at30 = renderInvitationEmail({ companyName: "NovaPay", roundName: "Seed", link: "x", expiryDays: 30 });
    expect(at30.html).toContain("expires in 30 days");
    expect(at30.text).toContain("expires in 30 days");
    const at60 = renderInvitationEmail({ companyName: "NovaPay", roundName: "Seed", link: "x", expiryDays: 60 });
    expect(at60.html).toContain("expires in 60 days");
    const dflt = renderInvitationEmail({ companyName: "NovaPay", roundName: "Seed", link: "x" });
    expect(dflt.html).toContain("expires in 14 days");
  });

  it("omits the note block when no note is given", () => {
    const out = renderInvitationEmail({
      companyName: "NovaPay",
      roundName: "Seed",
      link: "https://capavate.com/x",
    });
    expect(out.html).not.toContain("Note from the founder");
  });
});

describe("Wave C3 (7a) — round-name uniqueness per company", () => {
  it("rejects a duplicate name (case-insensitive) for the same company", () => {
    const base = `MVP ${Date.now()}`;
    createRound({ companyId: CO, name: base, type: "pre_seed" });
    expect(roundNameExistsForCompany(CO, base)).toBe(true);
    expect(roundNameExistsForCompany(CO, base.toUpperCase())).toBe(true); // case-insensitive
    // A second round with the same name is refused.
    expect(() => createRound({ companyId: CO, name: base, type: "pre_seed" })).toThrow(/ROUND_NAME_DUPLICATE/);
    // ...and with different casing too.
    expect(() => createRound({ companyId: CO, name: base.toLowerCase(), type: "seed" })).toThrow(/ROUND_NAME_DUPLICATE/);
  });

  it("suggests a unique, editable alternative on collision", () => {
    const base = `Seed ${Date.now()}`;
    createRound({ companyId: CO, name: base, type: "seed" });
    const suggestion = suggestUniqueRoundName(CO, base);
    expect(suggestion).toBe(`${base} (2)`);
    expect(roundNameExistsForCompany(CO, suggestion)).toBe(false);
    // The suggested name can actually be created.
    const created = createRound({ companyId: CO, name: suggestion, type: "seed" });
    expect(created.name).toBe(suggestion);
    // Next suggestion advances to (3).
    expect(suggestUniqueRoundName(CO, base)).toBe(`${base} (3)`);
  });

  it("requires a non-empty round name", () => {
    expect(() => createRound({ companyId: CO, name: "   ", type: "seed" })).toThrow(/ROUND_NAME_REQUIRED/);
  });

  it("a unique name is returned unchanged by the suggester", () => {
    const unique = `Series A ${Date.now()}`;
    expect(suggestUniqueRoundName(CO, unique)).toBe(unique);
  });

  it("uniqueness is PER COMPANY, not platform-wide (two companies may reuse a name)", () => {
    const CO_A = `co_wc3_a_${Date.now()}`;
    const CO_B = `co_wc3_b_${Date.now()}`;
    const shared = `Seed ${Date.now()}`;
    // Company A names a round "Seed".
    createRound({ companyId: CO_A, name: shared, type: "seed" });
    // Company B can use the SAME name — different company, no conflict.
    expect(roundNameExistsForCompany(CO_B, shared)).toBe(false);
    const bRound = createRound({ companyId: CO_B, name: shared, type: "seed" });
    expect(bRound.name).toBe(shared);
    // But Company A cannot reuse it within itself.
    expect(() => createRound({ companyId: CO_A, name: shared, type: "seed" })).toThrow(/ROUND_NAME_DUPLICATE/);
  });
});

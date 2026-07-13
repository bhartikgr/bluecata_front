/**
 * Wave C1 (Shadie 3a/4a/5a) — a REVOKED invitation is terminal.
 *
 * Fail-closed store guards: once revoked, an invitation cannot be revoked again
 * (no re-notification), cannot have its expiry extended, and cannot be resent
 * (no re-mint, no reminder email to the revoked investor). Accepted invitations
 * also cannot be extended (Ozan: revoked AND accepted).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  createInvitation,
  revokeInvitation,
  extendInvitation,
  resendInvitation,
  getInvitation,
  _testAccessInvitations,
} from "../roundInvitationsStore";

const ROUND = "rnd_c1_guard";
const COMPANY = "co_novapay";

async function freshInvite(email: string): Promise<string> {
  const r = await createInvitation({
    roundId: ROUND,
    companyId: COMPANY,
    investorEmail: email,
    investorName: "Test Investor",
    investorLastName: "Investor",
  });
  return r.invitation.id;
}

beforeEach(() => {
  _testAccessInvitations.reset();
});

describe("Wave C1 — revoked invitation is terminal (fail-closed)", () => {
  it("revoking an already-revoked invitation throws ALREADY_REVOKED (no re-notify)", async () => {
    const id = await freshInvite("c1a@example.com");
    revokeInvitation(id, "u_founder");
    expect(getInvitation(id)!.state).toBe("revoked");
    // Second revoke must be refused (the route uses this to skip re-notifying).
    expect(() => revokeInvitation(id, "u_founder")).toThrow(/ALREADY_REVOKED/);
  });

  it("extending a revoked invitation throws (expiry cannot change)", async () => {
    const id = await freshInvite("c1b@example.com");
    const before = getInvitation(id)!.expiresAt;
    revokeInvitation(id, "u_founder");
    expect(() => extendInvitation(id, 30, "u_founder")).toThrow(/INVITATION_REVOKED/);
    // Expiry is unchanged.
    expect(getInvitation(id)!.expiresAt).toBe(before);
  });

  it("resending a revoked invitation throws (no re-mint, no email)", async () => {
    const id = await freshInvite("c1c@example.com");
    const beforeHash = _testAccessInvitations.rows.find((r) => r.id === id)?.tokenHash;
    revokeInvitation(id, "u_founder");
    await expect(resendInvitation(id, "u_founder")).rejects.toThrow(/INVITATION_REVOKED/);
    // Token hash unchanged (no re-mint).
    const afterHash = _testAccessInvitations.rows.find((r) => r.id === id)?.tokenHash;
    expect(afterHash).toBe(beforeHash);
  });

  it("extending an ACCEPTED invitation throws (Ozan: no extend on accepted)", async () => {
    const id = await freshInvite("c1d@example.com");
    // Force accepted state on the durable+cache row.
    const row = _testAccessInvitations.rows.find((r) => r.id === id)!;
    row.state = "accepted";
    expect(() => extendInvitation(id, 30, "u_founder")).toThrow(/INVITATION_ACCEPTED/);
  });
});

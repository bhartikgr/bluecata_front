/**
 * Wave C2 (Shadie 1a/1b) — a CRM/manual investor picked in round-creation
 * Step 4 must LAND on the round (appear in the Invitations table) and be
 * NOTIFIED (invitation email issued).
 *
 * Root cause (reproduced on live): the Step-4 pick was only recorded as an
 * initial-shareholder row and was never issued a round invitation, so it never
 * appeared in the round's Invitations list and no email was sent.
 *
 * The fix issues a canonical roundInvitationsStore invitation for each picked
 * investor with an email. This test proves that issuing such an invitation
 * makes the investor visible via roundInvitationsListForRound (the exact source
 * the round's Investor-invitations tab reads), and that a re-issue is refused
 * (idempotent, no double-send). Uses dryRun so no real email is sent.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createInvitation,
  listForRound as roundInvitationsListForRound,
  _testAccessInvitations,
} from "../roundInvitationsStore";

const ROUND = "rnd_c2_lands";
const COMPANY = "co_novapay";

beforeEach(() => {
  _testAccessInvitations.reset();
});

describe("Wave C2 — CRM investor lands on the round + is invited", () => {
  it("issuing an invitation for the Step-4 pick makes it appear in the round's invitations list", async () => {
    // Before: the round has no invitations (the bug's post-create state).
    expect(roundInvitationsListForRound(ROUND).length).toBe(0);

    await createInvitation({
      roundId: ROUND,
      companyId: COMPANY,
      investorEmail: "crmpick@example.com",
      investorName: "New Contact",
      investorLastName: "Contact",
      investorCompany: "Bay Angels",
      invitedByUserId: "u_founder",
      dryRun: true, // do not actually send in the test
    });

    // After: the investor now LANDS in the invitations list (1a fixed) with a
    // sent state (1b — an invitation email would be sent for a real, non-dryRun
    // call via the same path).
    const list = roundInvitationsListForRound(ROUND);
    expect(list.length).toBe(1);
    expect(list[0].investorEmail).toBe("crmpick@example.com");
    expect(list[0].state).toBe("sent");
  });

  it("re-issuing the same investor is refused (idempotent, no double-send)", async () => {
    await createInvitation({
      roundId: ROUND,
      companyId: COMPANY,
      investorEmail: "dupe@example.com",
      investorName: "Dupe Investor",
      investorLastName: "Investor",
      invitedByUserId: "u_founder",
      dryRun: true,
    });
    await expect(
      createInvitation({
        roundId: ROUND,
        companyId: COMPANY,
        investorEmail: "dupe@example.com",
        investorName: "Dupe Investor",
        investorLastName: "Investor",
        invitedByUserId: "u_founder",
        dryRun: true,
      }),
    ).rejects.toThrow(/duplicate_invitation/);
    // Still exactly one invitation for that investor.
    expect(roundInvitationsListForRound(ROUND).filter((i) => i.investorEmail === "dupe@example.com").length).toBe(1);
  });

  it("an invitation cannot be issued without an email (no email => no invite)", async () => {
    await expect(
      createInvitation({
        roundId: ROUND,
        companyId: COMPANY,
        investorEmail: "",
        investorName: "No Email",
        investorLastName: "Email",
        invitedByUserId: "u_founder",
        dryRun: true,
      }),
    ).rejects.toThrow(/invalid_email/);
  });
});

/**
 * W-FIX2 F1 — invitation companyId is never null.
 *
 * Root cause: a redeemed invitation persisted with `companyId: null` broke the
 * investor cap-table (/securities) and dataroom (/dataroom) because the client
 * built the URL with an empty id and never issued the request.
 *
 * This test locks the WRITE-PATH fix: when the caller omits companyId,
 * createInvitation derives it from the round so the persisted row is never null.
 */
import { describe, it, expect } from "vitest";
import { createInvitation } from "../roundInvitationsStore";
import { createRound, getRoundById } from "../roundsStore";

const COMPANY_ID = `co_wfix2f1_${Date.now()}`;

describe("W-FIX2 F1 — createInvitation companyId backfill from round", () => {
  it("derives a non-null companyId from the round when the caller omits it", async () => {
    const round = createRound({
      companyId: COMPANY_ID,
      name: `F1 Round ${Date.now()}`,
      type: "seed",
      instrument: "priced_equity",
      pricePerShare: 1,
      targetAmount: 1_000_000,
    } as any);
    expect(getRoundById(round.id)?.companyId).toBe(COMPANY_ID);

    const created = await createInvitation({
      roundId: round.id,
      // companyId intentionally omitted to exercise the backfill
      companyId: undefined as any,
      investorEmail: `f1+${Date.now()}@example.com`,
      investorName: "F1 Investor",
      invitedByUserId: "u_founder",
      dryRun: true,
    });

    expect(created.invitation.companyId).toBe(COMPANY_ID);
    expect(created.invitation.companyId).not.toBeNull();
  });

  it("still honours an explicitly-supplied companyId", async () => {
    const round = createRound({
      companyId: COMPANY_ID,
      name: `F1 Round B ${Date.now()}`,
      type: "seed",
      instrument: "priced_equity",
      pricePerShare: 1,
      targetAmount: 1_000_000,
    } as any);
    const created = await createInvitation({
      roundId: round.id,
      companyId: COMPANY_ID,
      investorEmail: `f1b+${Date.now()}@example.com`,
      investorName: "F1 Investor B",
      invitedByUserId: "u_founder",
      dryRun: true,
    });
    expect(created.invitation.companyId).toBe(COMPANY_ID);
  });
});

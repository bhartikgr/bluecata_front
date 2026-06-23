/**
 * v15 P0-7/P0-8 — invitation redeem (single-use, expiry).
 *
 *   - createInvitation() → redeemInvitation() with the raw token transitions
 *     state from "sent" to "accepted".
 *   - Second redeem with the same token → throws "already_redeemed".
 *   - Expired invitation → throws "expired" and updates state.
 *   - Tampered/unknown token → throws "invalid_token".
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "crypto";
import {
  createInvitation,
  redeemInvitation,
  _testAccessInvitations,
} from "../roundInvitationsStore";

beforeAll(() => {
  // Tests against an in-memory invitation store; reset before each describe.
  _testAccessInvitations.reset();
});

describe("v15 P0-7/P0-8: invitation redeem (single-use, expiry)", () => {
  // The createInvitation function does not return the raw token in its public
  // result. To redeem we need the raw token. We use the dryRun flag (which
  // skips email send) but the helper does not expose the raw token there.
  //
  // For unit testing the redeem path, we instead construct a synthetic
  // invitation by calling createInvitation in a way that lets us recover the
  // raw token: we mock the email transport. The simpler test path is to call
  // the store's internal redeem flow directly by reading the stored hash and
  // synthesizing a token whose hash matches. We can't do that for SHA256.
  //
  // Approach: monkey-patch crypto's randomBytes for this test? Not reliable.
  // Cleaner: expose a test-only helper that hashes a known input, write the
  // row to the store, then redeem with the known input.

  it("single-use redeem flow", async () => {
    _testAccessInvitations.reset();
    // Use a known raw token for this test.
    const KNOWN_TOKEN = randomBytes(32).toString("hex");
    const tokenHash = _testAccessInvitations.hashToken(KNOWN_TOKEN);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    // Inject a row with our known token hash.
    _testAccessInvitations.rows.push({
      id: "inv_test_001",
      tenantId: "tenant_co_test",
      roundId: "rnd_test_a",
      companyId: "co_test_a",
      investorEmail: "redeem-target@example.com",
      investorName: "Test Investor",
      state: "sent",
      classification: "new_registration",
      tokenHash,
      invitedByUserId: "u_founder_test",
      note: null,
      sentAt: now,
      viewedAt: null,
      redeemedAt: null,
      redeemedByUserId: null,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    // First redeem succeeds.
    const r1 = redeemInvitation({ token: KNOWN_TOKEN, redeemedByUserId: "u_investor_test" });
    expect(r1.invitation.id).toBe("inv_test_001");
    expect(r1.invitation.state).toBe("accepted");
    expect(r1.invitation.redeemedByUserId).toBe("u_investor_test");

    // Second redeem with the same token must fail.
    expect(() => redeemInvitation({ token: KNOWN_TOKEN, redeemedByUserId: "u_investor_test" })).toThrow(
      /already_redeemed/,
    );
  });

  it("expired invitation throws 'expired'", () => {
    _testAccessInvitations.reset();
    const KNOWN_TOKEN = randomBytes(32).toString("hex");
    const tokenHash = _testAccessInvitations.hashToken(KNOWN_TOKEN);
    const now = new Date().toISOString();
    // expiresAt set in the past.
    const expiresAt = new Date(Date.now() - 86_400_000).toISOString();
    _testAccessInvitations.rows.push({
      id: "inv_test_expired",
      tenantId: "tenant_co_test",
      roundId: "rnd_test_a",
      companyId: "co_test_a",
      investorEmail: "expired@example.com",
      investorName: null,
      state: "sent",
      classification: "new_registration",
      tokenHash,
      invitedByUserId: "u_founder_test",
      note: null,
      sentAt: now,
      viewedAt: null,
      redeemedAt: null,
      redeemedByUserId: null,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    expect(() => redeemInvitation({ token: KNOWN_TOKEN, redeemedByUserId: "u_x" })).toThrow(/expired/);
    // State was transitioned to "expired".
    const row = _testAccessInvitations.rows.find((r) => r.id === "inv_test_expired");
    expect(row?.state).toBe("expired");
  });

  it("unknown token → invalid_token", () => {
    _testAccessInvitations.reset();
    expect(() =>
      redeemInvitation({ token: "deadbeef".repeat(8), redeemedByUserId: "u_x" }),
    ).toThrow(/invalid_token/);
  });

  it("missing token / user → throws", () => {
    expect(() => redeemInvitation({ token: "", redeemedByUserId: "u_x" })).toThrow();
    expect(() => redeemInvitation({ token: "x", redeemedByUserId: "" })).toThrow();
  });

  it("dry-run createInvitation persists a row without crashing email", async () => {
    _testAccessInvitations.reset();
    const result = await createInvitation({
      roundId: "rnd_dry_a",
      companyId: "co_dry_a",
      investorEmail: "dry@example.com",
      investorName: "Dry Run",
      invitedByUserId: "u_dry_founder",
      dryRun: true,
    });
    expect(result.emailSent).toBe(true); // dry-run treats as success
    expect(result.invitation.id).toMatch(/^inv_rnd_dry_a/);
    // Response has no tokenHash leak.
    expect((result.invitation as any).tokenHash).toBeUndefined();
    // Row was persisted to the in-memory store.
    expect(_testAccessInvitations.rows.length).toBe(1);
    expect((_testAccessInvitations.rows[0].tokenHash ?? "").length).toBeGreaterThanOrEqual(64);
  });
});

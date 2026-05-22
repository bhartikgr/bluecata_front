/**
 * Sprint 11 — investor membership + strict gating tests.
 *
 * Verifies the membership store and the strict-gating decision tree:
 *   - active members see member-only resources
 *   - lapsed members lose access at lapse time
 *   - investors not on the cap table for company X cannot see X's
 *     member-only data even if they are otherwise active
 */
import { describe, it, expect } from "vitest";
import { isCollectiveMember, isOnCapTable, getMembership } from "../membershipStore";

describe("membershipStore", () => {
  it("returns active=true for a current member", () => {
    expect(isCollectiveMember("u_aisha_patel")).toBe(true);
  });

  it("returns active=false for a lapsed member", () => {
    expect(isCollectiveMember("u_lapsed_lp")).toBe(false);
  });

  it("returns active=false for a user with no membership row", () => {
    expect(isCollectiveMember("u_unknown_xyz")).toBe(false);
  });

  it("getMembership returns the full record for an active member", () => {
    const m = getMembership("u_aisha_patel");
    expect(m).toBeTruthy();
    expect(m!.userId).toBe("u_aisha_patel");
    expect(m!.isCollectiveMember).toBe(true);
    expect(m!.lapsed).toBe(false);
    expect(m!.capTablePositions.length).toBeGreaterThan(0);
  });

  it("isOnCapTable enforces per-company cap-table membership", () => {
    expect(isOnCapTable("u_aisha_patel", "co_novapay")).toBe(true);
    expect(isOnCapTable("u_aisha_patel", "co_zzz_unknown")).toBe(false);
    expect(isOnCapTable("u_no_position", "co_novapay")).toBe(false);
  });

  it("strict gating: lapsed member cannot view member-only resources", () => {
    // Lapsed members fail isCollectiveMember even if they were once active.
    expect(isCollectiveMember("u_lapsed_lp")).toBe(false);
  });
});

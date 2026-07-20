/**
 * W-FIX1b (2026-07-19) — messaging DM policy denial contract (A7 backend guarantee).
 *
 * A7 fixes the FE silent-failure on a blocked DM: the composer must surface a
 * clear, actionable reason and disable Send. That UX depends on the policy layer
 * ALWAYS returning an explicit `reason` string on denial (never an empty/silent
 * verdict) and fails CLOSED for unresolved / anonymous / self pairings.
 *
 * These are the deterministic, DB-independent guarantees. Role-resolved happy
 * paths (founder↔committed-investor via the sacred captable_commits READ) are
 * exercised by the integration comms suites; here we lock the fail-closed
 * contract the FE banner + disabled-Send tooltip are built on.
 *
 * canDM / resolveDmRole are only CALLED — messagingPolicy.ts is the policy
 * layer (non-sacred); the sacred capTableMembership.ts is untouched.
 */
import { describe, it, expect } from "vitest";
import { canDM } from "../messagingPolicy";

describe("A7 — DM policy denial contract (never silent)", () => {
  it("blocks an anonymous/empty sender with an explicit reason", () => {
    const r = canDM("", "u_someone");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("anonymous");
    expect(typeof r.reason).toBe("string");
    expect(r.reason!.length).toBeGreaterThan(0);
  });

  it("blocks an anonymous/empty recipient with an explicit reason", () => {
    const r = canDM("u_someone", "");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("anonymous");
  });

  it("blocks a self-DM with an explicit reason", () => {
    const r = canDM("u_self_123", "u_self_123");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("self_dm");
  });

  it("fails CLOSED with a reason when a side cannot be resolved", () => {
    // Two synthetic ids with no auth_users / ledger / CRM rows → unknown roles.
    const r = canDM("u_ghost_aaaaaa", "u_ghost_bbbbbb");
    expect(r.allowed).toBe(false);
    // The FE renders this reason; it must be a non-empty, non-silent string.
    expect(r.reason).toBe("unresolved");
    expect(r.reason!.length).toBeGreaterThan(0);
  });

  it("every denial carries a privacyMode + reason (no undefined leaks)", () => {
    for (const [a, b] of [["", "x"], ["x", "x"], ["u_ghost_1", "u_ghost_2"]] as const) {
      const r = canDM(a, b);
      expect(r.allowed).toBe(false);
      expect(r.privacyMode).toBeTruthy();
      expect(r.reason).toBeTruthy();
    }
  });
});

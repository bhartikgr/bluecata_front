/**
 * Wave 2 (#5) — server eligibility: funded cap-table position OR admin-granted.
 *
 * Locks the new admin-granted path added to isEligibleForCollective():
 *   - a user with an ACTIVE collective membership (operator activate()) is
 *     eligible via `adminGranted`, even with no cap-table/founder signal.
 *   - the EligibilityResult carries `adminGranted` (both on the result and in
 *     `passes`) so the client spine can read ONE signal for hero == gate.
 *   - a user with no signal at all is NOT eligible (no_portfolio_data).
 *
 * NOT accepted/soft-circled alone — those never touch this server signal.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { isEligibleForCollective } from "../collectiveAppStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

beforeEach(() => {
  collectiveMembershipStore._resetForTests();
});

describe("isEligibleForCollective — admin-granted path (#5)", () => {
  it("a user with no signal is NOT eligible", () => {
    const r = isEligibleForCollective("u_no_signal_wave2");
    expect(r.eligible).toBe(false);
    expect(r.adminGranted).toBe(false);
    expect(r.passes.adminGranted).toBe(false);
    expect(r.reasons).toContain("no_portfolio_data");
  });

  it("an active collective membership grants eligibility via adminGranted", () => {
    const userId = "u_admin_granted_wave2";
    // Operator activates the member (writes a durable active row).
    collectiveMembershipStore.activate(userId, "u_admin_operator");
    expect(collectiveMembershipStore.isActive(userId)).toBe(true);

    const r = isEligibleForCollective(userId);
    expect(r.eligible).toBe(true);
    expect(r.adminGranted).toBe(true);
    expect(r.passes.adminGranted).toBe(true);
    expect(r.reasons.some((x) => /operator/i.test(x))).toBe(true);
  });

  it("undefined userId (anonymous) is not eligible and does not throw", () => {
    const r = isEligibleForCollective(undefined);
    expect(r.eligible).toBe(false);
    expect(r.adminGranted).toBe(false);
  });

  it("EligibilityResult shape includes adminGranted for spine consumption", () => {
    const r = isEligibleForCollective("u_shape_wave2");
    expect(r).toHaveProperty("adminGranted");
    expect(r.passes).toHaveProperty("adminGranted");
  });
});

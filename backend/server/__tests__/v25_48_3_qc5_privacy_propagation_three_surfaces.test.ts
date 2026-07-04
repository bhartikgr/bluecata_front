/**
 * v25.48.3 Q-C5 — privacy propagation across the THREE surfaces in ONE flow.
 *
 * Ozan asked to explicitly prove that a single privacy selection propagates to
 * messaging, cap table, and Collective visibility. The per-context assertions
 * already live in v25_45_f13_privacy_propagation_e2e.mjs; this test writes ONE
 * privacy state and then reads it back through all three surfaces via the
 * single DB-backed resolver (resolveDisplayName), demonstrating that a change
 * made once shows up everywhere (no per-surface duplication / no in-memory
 * divergence).
 *
 * The resolver (server/lib/userPrivacyResolver.ts) is SACRED and is NOT edited;
 * this test only CALLS it.
 */
import { describe, it, expect } from "vitest";
import { writeUserPrivacy, resolveDisplayName } from "../lib/userPrivacyResolver";

describe("v25.48.3 Q-C5 — one privacy change propagates to messaging, cap table, Collective", () => {
  const uid = "u_qc5_propagation_probe";
  const legalName = "Jane Founder";

  it("opt-OUT everywhere → screenName in message/externalCapTable, Private in Collective, legal on own cap table", () => {
    // Single write — the ONLY place we set the pref.
    writeUserPrivacy(uid, {
      screenName: "AnonJF",
      visibleToCoMembers: false,
      visibleInCollectiveDirectory: false,
    });

    // Surface 1 — MESSAGING (counterparty co-member): explicit opt-out wins → screenName.
    const msgName = resolveDisplayName(uid, "viewer_msg", "message", { legalName, isCoMember: true });
    expect(msgName).toBe("AnonJF");

    // Surface 2 — CAP TABLE (external view, co-member): opt-out wins → screenName.
    const extCap = resolveDisplayName(uid, "viewer_cap", "externalCapTable", { legalName, isCoMember: true });
    expect(extCap).toBe("AnonJF");

    // Surface 2b — OWN cap table always shows legal name (regulatory), regardless of toggles.
    const ownCap = resolveDisplayName(uid, uid, "ownCapTable", { legalName, isOwnCompany: true });
    expect(ownCap).toBe(legalName);

    // Surface 3 — COLLECTIVE directory: opt-out → Private Investor.
    const collective = resolveDisplayName(uid, "viewer_col", "collectiveDirectory", { legalName });
    expect(collective).toBe("Private Investor");
  });

  it("opt-IN to Collective → the SAME single change flips only the Collective surface", () => {
    // Change the pref ONCE; assert it propagates to the Collective read path.
    writeUserPrivacy(uid, {
      screenName: "AnonJF",
      visibleToCoMembers: true,
      visibleInCollectiveDirectory: true,
    });

    const collective = resolveDisplayName(uid, "viewer_col", "collectiveDirectory", { legalName });
    expect(collective).toBe("AnonJF");

    // Messaging co-member now also reflects the co-member-visible default.
    const msgName = resolveDisplayName(uid, "viewer_msg", "message", { legalName, isCoMember: true });
    expect(msgName).toBe("AnonJF");

    // Own cap table still legal name (never affected by toggles).
    const ownCap = resolveDisplayName(uid, uid, "ownCapTable", { legalName, isOwnCompany: true });
    expect(ownCap).toBe(legalName);
  });
});

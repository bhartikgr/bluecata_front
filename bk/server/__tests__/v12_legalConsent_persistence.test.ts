/**
 * Patch v12 Day 2 Wave 2 — legalConsentStore persistence test.
 *
 * Verifies the audit §3.13 contract: every consent persists to the
 * legal_consents table; the hash chain extends correctly; idempotency
 * holds across simulated restarts; the hydrator reports schema reachable.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordConsent,
  getConsentsForUser,
  getAllConsents,
  verifyChain,
  hydrateLegalConsentStore,
  _testLegalConsent,
} from "../legalConsentStore";
import { LEGAL_VERSION } from "../../client/src/lib/legalDocs";

describe("v12 legalConsentStore — DB persistence + chain integrity", () => {
  beforeEach(() => {
    _testLegalConsent.reset();
  });

  it("records consent to DB and extends the chain across restart", async () => {
    // Record 3 consents
    const r1 = recordConsent({ userId: "u_a", documentId: "privacy",        context: "signup", ipAddress: null, userAgent: null });
    const r2 = recordConsent({ userId: "u_a", documentId: "terms",          context: "signup", ipAddress: null, userAgent: null });
    const r3 = recordConsent({ userId: "u_b", documentId: "acceptable-use", context: "new_company", ipAddress: null, userAgent: null });

    expect(r1.isNew).toBe(true);
    expect(r2.isNew).toBe(true);
    expect(r3.isNew).toBe(true);

    // Read back via the DB-backed API
    const all = getAllConsents();
    expect(all.length).toBe(3);
    expect(all[0].prevHash).toBe("0".repeat(64));
    expect(all[1].prevHash).toBe(all[0].hash);
    expect(all[2].prevHash).toBe(all[1].hash);

    // Chain verifies
    expect(verifyChain()).toEqual({ ok: true, brokenAt: -1 });

    // Simulated restart — no in-memory state to clear; the hydrator just
    // verifies schema is reachable. Subsequent reads still see all rows.
    await hydrateLegalConsentStore();

    const allAfterHydrate = getAllConsents();
    expect(allAfterHydrate.length).toBe(3);
    expect(allAfterHydrate.map((c) => c.id)).toEqual(all.map((c) => c.id));

    // The 4th record links to the persisted tip
    const r4 = recordConsent({ userId: "u_a", documentId: "cookies", context: "settings_update", ipAddress: null, userAgent: null });
    expect(r4.isNew).toBe(true);
    expect(r4.consent.prevHash).toBe(r3.consent.hash);
    expect(verifyChain()).toEqual({ ok: true, brokenAt: -1 });
  });

  it("idempotent on (userId, documentId, version)", () => {
    const r1 = recordConsent({ userId: "u_a", documentId: "privacy", context: "signup", ipAddress: null, userAgent: null });
    expect(r1.isNew).toBe(true);

    const r2 = recordConsent({ userId: "u_a", documentId: "privacy", context: "signup", ipAddress: null, userAgent: null });
    expect(r2.isNew).toBe(false);
    expect(r2.consent.id).toBe(r1.consent.id);

    // Chain length stays at 1
    expect(getAllConsents().length).toBe(1);
    expect(getConsentsForUser("u_a").length).toBe(1);
    expect(getConsentsForUser("u_a")[0].documentVersion).toBe(LEGAL_VERSION);
  });
});

/**
 * Patch v12 Day 2 Wave 1 — companyProfileStore persistence test.
 *
 * Verifies that updateCompanyProfile() writes through to the
 * companyProfileExtended JSON-blob table, and that after a simulated restart
 * (profileMap.clear() + hydrateCompanyProfileStore()) the profile and hash
 * chain are intact.
 */
import { describe, it, expect } from "vitest";
import {
  getCompanyProfile,
  updateCompanyProfile,
  hydrateCompanyProfileStore,
  _testCompanyProfile,
} from "../companyProfileStore";

describe("v12 — companyProfileStore DB persistence", () => {
  it("patch + restart restores profile and preserves hash chain", async () => {
    const companyId = `co_v12_prof_${Date.now()}`;
    const actor = "u_test_profile";

    // 1. Initial patch — creates the profile (version goes 0 → 1).
    const first = updateCompanyProfile(
      companyId,
      { coLegalName: "Acme Holdings Ltd.", coCountry: "CA", coBusinessType: "private_corp" },
      actor,
    );
    expect(first.coLegalName).toBe("Acme Holdings Ltd.");
    expect(first.version).toBe(1);
    const firstHash = first.hash;
    expect(typeof firstHash).toBe("string");
    expect(firstHash.length).toBe(64);

    // 2. Second patch — extends chain (version 1 → 2).
    const second = updateCompanyProfile(
      companyId,
      { coDescription: "Investor-grade cap table SaaS." },
      actor,
    );
    expect(second.coDescription).toBe("Investor-grade cap table SaaS.");
    expect(second.version).toBe(2);
    expect(second.prevHash).toBe(firstHash);
    const secondHash = second.hash;

    // 3. Simulate restart — clear the in-memory map, then re-hydrate from DB.
    _testCompanyProfile.profileMap.clear();
    _testCompanyProfile.prevCompletionPct.clear();

    // Sanity: after clearing, the profile reads as a default (empty) record.
    const beforeHydrate = getCompanyProfile(companyId);
    expect(beforeHydrate.coLegalName).toBeFalsy();

    await hydrateCompanyProfileStore();

    // 4. Profile is restored from DB.
    const restored = getCompanyProfile(companyId);
    expect(restored.coLegalName).toBe("Acme Holdings Ltd.");
    expect(restored.coCountry).toBe("CA");
    expect(restored.coDescription).toBe("Investor-grade cap table SaaS.");
    expect(restored.version).toBe(2);
    expect(restored.hash).toBe(secondHash);
    expect(restored.prevHash).toBe(firstHash);

    // 5. Chain extends correctly across the restart boundary.
    const third = updateCompanyProfile(
      companyId,
      { coWebsite: "https://acme.example" },
      actor,
    );
    expect(third.version).toBe(3);
    expect(third.prevHash).toBe(secondHash);
    // Patch carries forward unchanged fields from the rehydrated profile.
    expect(third.coLegalName).toBe("Acme Holdings Ltd.");
    expect(third.coDescription).toBe("Investor-grade cap table SaaS.");
  });
});

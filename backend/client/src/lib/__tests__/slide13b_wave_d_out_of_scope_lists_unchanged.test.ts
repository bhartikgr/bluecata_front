/**
 * slide13b WAVE D — scope fence. Only company_sector moved to the DB taxonomy.
 * The profile Industry list (48) and the Collective stage list stay static and
 * byte-for-byte as before; the hook's freshness settings are the DB-direct ones
 * the spec requires (focus refetch + bounded poll), not the app's off defaults.
 */
import { describe, it, expect } from "vitest";
import { INDUSTRY_OPTIONS } from "@/lib/profile/data/enums";
import { COLLECTIVE_STAGES } from "@shared/schema";
import { COMPANY_TAXONOMY_POLL_MS, COMPANY_TAXONOMY_STALE_MS, companyTaxonomyKey, adminCompanyTaxonomyKey } from "@/lib/companyTaxonomy";
import { TAXONOMY_NAMESPACES } from "@shared/companyTaxonomy";

describe("slide13b WAVE D · out of scope stays static", () => {
  it("INDUSTRY_OPTIONS still has exactly 48 entries (not migrated)", () => {
    expect(INDUSTRY_OPTIONS).toHaveLength(48);
  });
  it("COLLECTIVE_STAGES is unchanged (7 stages, R91 order)", () => {
    expect(COLLECTIVE_STAGES).toEqual(["Pre-Seed", "Seed", "Series A", "Series B", "Series C+", "Growth", "Late Stage"]);
  });
  it("only the company_sector namespace exists in the DB taxonomy", () => {
    expect([...TAXONOMY_NAMESPACES]).toEqual(["company_sector"]);
  });
  it("hook freshness: bounded 60s poll, 30s stale, distinct public/admin keys", () => {
    expect(COMPANY_TAXONOMY_POLL_MS).toBe(60_000);
    expect(COMPANY_TAXONOMY_STALE_MS).toBe(30_000);
    expect(companyTaxonomyKey()).toEqual(["/api/company-taxonomy", "company_sector"]);
    expect(adminCompanyTaxonomyKey()).toEqual(["/api/admin/company-taxonomy", "company_sector", "all"]);
  });
});

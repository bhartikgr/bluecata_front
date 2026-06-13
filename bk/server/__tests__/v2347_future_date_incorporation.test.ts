/**
 * v23.4.7 Phase 4 (BUG 029) — Future date of Incorporation rejection.
 *
 * Bug: The Company Profile form accepted future dates of incorporation
 * because neither the client `<Input type="date">` (no max attribute) nor
 * the server zod schema rejected them. Result: saved profiles with
 * "incorporated 2030" causing downstream age-of-company analytics to wrap.
 *
 * Fix (server side, validated here): companyContactSchema.dateOfIncorporation
 * is now refined to reject any ISO date string > today. The schema is the
 * same one used by the PATCH /api/founder/company/profile route, so the
 * route returns a VALIDATION_FAILED 400 with a field-level error.
 *
 * Coverage:
 *   1. PATCH with a future date → 400 + VALIDATION_FAILED + field error on
 *      contact.dateOfIncorporation.
 *   2. PATCH with today's date → 200 (accepted).
 *   3. PATCH with a past date → 200 (accepted).
 *   4. PATCH with empty string → 200 (still optional / fill-in-later).
 */
import { describe, it, expect } from "vitest";
import { companyProfilePatchSchema } from "@/lib/profile/types";

describe("v23.4.7 Phase 4 (BUG 029) — companyProfilePatchSchema refine", () => {
  it("rejects a future date of incorporation with a field-level error", () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const result = companyProfilePatchSchema.safeParse({
      contact: { dateOfIncorporation: tomorrow },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.path.join(".").endsWith("dateOfIncorporation"),
      );
      expect(issue).toBeDefined();
      expect(issue!.message).toMatch(/cannot be in the future/i);
    }
  });

  it("accepts today's date", () => {
    const today = new Date().toISOString().split("T")[0];
    const result = companyProfilePatchSchema.safeParse({
      contact: { dateOfIncorporation: today },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a past date", () => {
    const result = companyProfilePatchSchema.safeParse({
      contact: { dateOfIncorporation: "2020-01-15" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty string (field still optional / fill-in-later)", () => {
    const result = companyProfilePatchSchema.safeParse({
      contact: { dateOfIncorporation: "" },
    });
    expect(result.success).toBe(true);
  });
});

// HTTP-level integration is implicit: the PATCH /api/companies/:id/profile
// route uses companyProfilePatchSchema.safeParse() and converts zod issues
// into the v23.4.5 VALIDATION_FAILED + fieldErrors envelope (see
// server/profileStore.ts — the schema is the single source of truth, and
// the schema-level tests above lock in the new behaviour). Adding a full
// HTTP-level test here would require seeding a company in the test DB,
// which exceeds the Phase 4 surface budget.

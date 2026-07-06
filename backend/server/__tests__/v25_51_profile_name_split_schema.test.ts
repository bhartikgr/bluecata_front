/**
 * v25.51 Phase 4 (#7 investor profile, #8 company directors) — name-split
 * persistence contract at the exact zod boundary the server validates against.
 *
 * profileStore.ts (SACRED) persists CompanyProfile / InvestorProfile as JSON
 * blobs. The ONLY thing that decides whether discrete first/last survive the
 * PATCH is the zod schema in client/src/lib/profile/types.ts — the SAME module
 * profileStore imports (see profileStore.ts:36) and runs on every PATCH body
 * (investorProfilePatchSchema at :680, companyProfilePatchSchema at :512).
 *
 * These tests prove:
 *   #7 — investorContactSchema keeps firstName + lastName discrete (it has NO
 *        composed name; identity is discrete-first by design).
 *   #8 — company legal.boardComposition.directorsSnapshot[] carries additive
 *        first/last WHILE keeping the composed `name` byte-stable for readers.
 * No sacred code change was required for either surface — the additive schema
 * fields are the entire mechanism, so this locks that contract.
 */
import { describe, it, expect } from "vitest";
import {
  investorProfilePatchSchema,
  companyProfilePatchSchema,
} from "../../client/src/lib/profile/types";

describe("v25.51 Phase 4 #7 — investor contact first/last round-trip (schema)", () => {
  it("passes discrete firstName + lastName through the PATCH schema unchanged", () => {
    const parsed = investorProfilePatchSchema.safeParse({
      contact: { firstName: "Maya", lastName: "Chen" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.contact?.firstName).toBe("Maya");
    expect(parsed.data.contact?.lastName).toBe("Chen");
  });

  it("rejects an empty firstName (identity is discrete-required, not composed)", () => {
    const parsed = investorProfilePatchSchema.safeParse({
      contact: { firstName: "", lastName: "Chen" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("v25.51 Phase 4 #8 — directors snapshot first/last round-trip (schema)", () => {
  it("keeps composed name AND carries additive first/last per director", () => {
    const parsed = companyProfilePatchSchema.safeParse({
      legal: {
        boardComposition: {
          directorsCount: 2,
          directorsSnapshot: [
            { name: "Maya Chen", firstName: "Maya", lastName: "Chen", role: "Chair" },
            { name: "Sam Okoro", firstName: "Sam", lastName: "Okoro", role: "Director" },
          ],
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const snap = parsed.data.legal?.boardComposition?.directorsSnapshot ?? [];
    expect(snap.length).toBe(2);
    // Composed name stays authoritative + byte-stable for legacy readers.
    expect(snap[0].name).toBe("Maya Chen");
    expect(snap[1].name).toBe("Sam Okoro");
    // Additive discrete identity survives the PATCH boundary.
    expect(snap[0].firstName).toBe("Maya");
    expect(snap[0].lastName).toBe("Chen");
    expect(snap[1].firstName).toBe("Sam");
    expect(snap[1].lastName).toBe("Okoro");
  });

  it("stays backward-compatible: composed name only, first/last default empty", () => {
    const parsed = companyProfilePatchSchema.safeParse({
      legal: {
        boardComposition: {
          directorsCount: 1,
          directorsSnapshot: [{ name: "Legacy Director", role: "Director" }],
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const d = parsed.data.legal?.boardComposition?.directorsSnapshot?.[0];
    expect(d?.name).toBe("Legacy Director");
    // Additive fields default to "" — never undefined, never perturbing name.
    expect(d?.firstName).toBe("");
    expect(d?.lastName).toBe("");
  });
});

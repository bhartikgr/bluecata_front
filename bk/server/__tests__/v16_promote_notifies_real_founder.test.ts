/**
 * v16 F-coll-7 / Fix 5 — real founder lookup on /promote notification.
 *
 * Pre-v16, `founderUserIdForCompany()` returned `"u_founder_demo"` for any
 * input — a hard-coded synthetic that does not exist as a real persona.
 * Notifications dispatched to that id had no effect.
 *
 * v16 fix:
 *   1. Query the `companyMembers` DB table for `role = "founder"` and use
 *      the first row's userId.
 *   2. Fall back to the demo map (Maya owns 5 companies) when no DB row
 *      exists. This keeps the demo-seed test path green.
 *   3. The helper is now exported so unit tests can assert directly.
 *
 * Acceptance gate #7:
 *   await founderUserIdForCompany("co_arboreal") === "u_maya_chen"
 */
import { describe, it, expect } from "vitest";
import { founderUserIdForCompany } from "../sprint21PortfolioRoutes";

describe("v16 F-coll-7 — founderUserIdForCompany returns a real persona", () => {
  it("resolves co_arboreal → u_maya_chen via the demo-map fallback", async () => {
    const uid = await founderUserIdForCompany("co_arboreal");
    expect(uid).toBe("u_maya_chen");
  });

  it("resolves co_novapay → u_maya_chen", async () => {
    const uid = await founderUserIdForCompany("co_novapay");
    expect(uid).toBe("u_maya_chen");
  });

  it("returns null for a completely unknown company (no DB row, no demo map)", async () => {
    const uid = await founderUserIdForCompany("co_does_not_exist_anywhere_12345");
    expect(uid).toBeNull();
  });

  it("returns null for an empty companyId", async () => {
    const uid = await founderUserIdForCompany("");
    expect(uid).toBeNull();
  });

  it("function is async and returns Promise<string | null>", async () => {
    const result = founderUserIdForCompany("co_arboreal");
    expect(result).toBeInstanceOf(Promise);
    const awaited = await result;
    expect(typeof awaited === "string" || awaited === null).toBe(true);
  });
});

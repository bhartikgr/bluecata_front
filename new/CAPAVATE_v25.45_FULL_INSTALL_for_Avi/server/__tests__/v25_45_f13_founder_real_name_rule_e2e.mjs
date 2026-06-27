/* v25.45 F13c — founder ALWAYS appears with legal name on their OWN cap table,
 * even when every privacy toggle is OFF. Non-configurable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f13own"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.45 F13c founder-real-name rule — E2E", () => {
  it("all toggles OFF → still legal name on own cap table", async () => {
    const { writeUserPrivacy, resolveDisplayName, legalNameOnOwnCapTable } = await import("../lib/userPrivacyResolver.ts");
    writeUserPrivacy(h.ids.FOUNDER, { screenName: "Hidden", visibleToCoMembers: false, visibleInCollectiveDirectory: false });
    const name = resolveDisplayName(h.ids.FOUNDER, "anyone", "ownCapTable", { legalName: "Maya Chen", isOwnCompany: true });
    const ok = name === "Maya Chen" && legalNameOnOwnCapTable === true;
    record("own cap table → legal name with all toggles off", ok, `got ${name}`);
    expect(ok).toBe(true);
  });
  it("contrast: same user is hidden on an EXTERNAL cap table (explicit opt-out → screen name, v25.45 r7)", async () => {
    const { resolveDisplayName } = await import("../lib/userPrivacyResolver.ts");
    // The first test wrote { screenName: "Hidden", visibleToCoMembers: false }.
    // Explicit opt-out wins even for a co-member → renders the screen name.
    const name = resolveDisplayName(h.ids.FOUNDER, "anyone", "externalCapTable", { legalName: "Maya Chen", isCoMember: true });
    record("external cap table opt-out → screen name", name === "Hidden", `got ${name}`);
    expect(name).toBe("Hidden");
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F13c E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});

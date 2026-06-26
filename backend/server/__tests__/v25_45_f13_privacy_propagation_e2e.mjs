/* v25.45 F13b — resolveDisplayName is the single source of truth.
 * Asserts the helper returns the right name in every context based on the
 * user's DB-backed privacy state.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupFounder, recorder } from "./v25_45_helpers.mjs";
let h; const { results, record } = recorder();
beforeAll(async () => { h = await setupFounder("f13prop"); }, 60_000);
afterAll(async () => { await h.teardown(); });

async function setPrivacy(userId, prefs) {
  // Write via the durable privacy store (same path PUT /api/founder/privacy uses).
  const { writeUserPrivacy } = await import("../lib/userPrivacyResolver.ts");
  writeUserPrivacy(userId, prefs);
}

describe("v25.45 F13 privacy propagation — E2E", () => {
  it("ownCapTable ALWAYS legal name (even when all toggles off) — F13c", async () => {
    const { resolveDisplayName, legalNameOnOwnCapTable } = await import("../lib/userPrivacyResolver.ts");
    const uid = h.ids.FOUNDER;
    await setPrivacy(uid, { screenName: "Anon123", visibleToCoMembers: false, visibleInCollectiveDirectory: false });
    const name = resolveDisplayName(uid, "viewer_x", "ownCapTable", { legalName: "Maya Chen", isOwnCompany: true });
    const ok = name === "Maya Chen" && legalNameOnOwnCapTable === true;
    record("ownCapTable → legal name regardless of toggles", ok, `got ${name}`);
    expect(ok).toBe(true);
  });
  it("externalCapTable explicit opt-out → screen name (opt-out wins, v25.45 r7)", async () => {
    const { resolveDisplayName } = await import("../lib/userPrivacyResolver.ts");
    const uid = h.ids.FOUNDER;
    // Explicit visibleToCoMembers:false ALWAYS wins, even for a co-member.
    // With a screen name set, the opt-out renders the screen name.
    await setPrivacy(uid, { screenName: "Anon123", visibleToCoMembers: false, visibleInCollectiveDirectory: false });
    const name = resolveDisplayName(uid, "viewer_x", "externalCapTable", { legalName: "Maya Chen", isCoMember: true });
    record("externalCapTable opt-out → screen name", name === "Anon123", `got ${name}`);
    expect(name).toBe("Anon123");
  });
  it("externalCapTable non-counterparty → Private Investor (v25.45 r7)", async () => {
    const { resolveDisplayName } = await import("../lib/userPrivacyResolver.ts");
    const uid = h.ids.FOUNDER;
    await setPrivacy(uid, { screenName: "", visibleToCoMembers: true, visibleInCollectiveDirectory: false });
    // No isCoMember flag (defaults false) → non-counterparty → Private Investor.
    const name = resolveDisplayName(uid, "viewer_x", "externalCapTable", { legalName: "Maya Chen" });
    record("externalCapTable non-counterparty → Private Investor", name === "Private Investor", `got ${name}`);
    expect(name).toBe("Private Investor");
  });
  it("message co-member → screenName (counterparty default, v25.45 r7)", async () => {
    const { resolveDisplayName } = await import("../lib/userPrivacyResolver.ts");
    const uid = h.ids.FOUNDER;
    await setPrivacy(uid, { screenName: "MayaC", visibleToCoMembers: true, visibleInCollectiveDirectory: false });
    const name = resolveDisplayName(uid, "viewer_x", "message", { legalName: "Maya Chen", isCoMember: true });
    record("message co-member → screenName", name === "MayaC", `got ${name}`);
    expect(name).toBe("MayaC");
  });
  it("collectiveDirectory off → Private Investor", async () => {
    const { resolveDisplayName } = await import("../lib/userPrivacyResolver.ts");
    const uid = h.ids.FOUNDER;
    await setPrivacy(uid, { screenName: "MayaC", visibleToCoMembers: true, visibleInCollectiveDirectory: false });
    const name = resolveDisplayName(uid, "viewer_x", "collectiveDirectory", { legalName: "Maya Chen" });
    record("collectiveDirectory off → Private Investor", name === "Private Investor", `got ${name}`);
    expect(name).toBe("Private Investor");
  });
  it("collectiveDirectory on → screenName", async () => {
    const { resolveDisplayName } = await import("../lib/userPrivacyResolver.ts");
    const uid = h.ids.FOUNDER;
    await setPrivacy(uid, { screenName: "MayaC", visibleToCoMembers: true, visibleInCollectiveDirectory: true });
    const name = resolveDisplayName(uid, "viewer_x", "chapterRoster", { legalName: "Maya Chen" });
    record("chapterRoster on → screenName", name === "MayaC", `got ${name}`);
    expect(name).toBe("MayaC");
  });
  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    console.log(`\n  v25.45 F13 propagation E2E: ${passed}/${results.length} passed`);
    expect(passed).toBe(results.length);
  });
});

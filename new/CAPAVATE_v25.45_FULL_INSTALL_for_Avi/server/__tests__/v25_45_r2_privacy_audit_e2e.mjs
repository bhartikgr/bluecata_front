/* v25.45 ROUND 2 (BLOCKER 3) — privacy resolver wiring audit.
 *
 * The round-1 blocker was that resolveDisplayName() had ZERO call sites: the
 * privacy toggles persisted to the DB but never affected any rendered name.
 * This test asserts that every server surface that returns a user name now
 * routes through the resolver (or a DB-backed privacy override), by source-grep
 * across the key files. It is a guard against regression to the round-1 state.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf-8");

describe("v25.45 R2 — privacy resolver wiring audit", () => {
  it("collectiveRoutes imports + calls resolveDisplayName for the member directory", () => {
    const src = read("collectiveRoutes.ts");
    expect(src.includes('from "./lib/userPrivacyResolver"')).toBe(true);
    expect(src.includes("resolveDisplayName(")).toBe(true);
    // The /members endpoint maps through the dirName() resolver helper.
    expect(src.includes('"collectiveDirectory"')).toBe(true);
  });

  it("reportsStore routes recipient names through resolveDisplayName (externalCapTable)", () => {
    const src = read("reportsStore.ts");
    expect(src.includes('from "./lib/userPrivacyResolver"')).toBe(true);
    expect(src.includes('resolveDisplayName(') && src.includes('"externalCapTable"')).toBe(true);
  });

  it("routes.ts resolves the cap-table PDF shareholder label through the resolver", () => {
    const src = read("routes.ts");
    expect(src.includes('from "./lib/userPrivacyResolver"')).toBe(true);
    expect(src.includes("resolveDisplayName(")).toBe(true);
  });

  it("commsStore routes messaging sender names through the privacy resolver (v25.45 r7 counterparty)", () => {
    const src = read("commsStore.ts");
    expect(src.includes('from "./lib/userPrivacyResolver"')).toBe(true);
    // v25.45 r7 — messaging now routes through resolveDisplayName in the
    // "message" context with isCoMember computed from the cap-table ledger.
    expect(src.includes("resolveDisplayName(")).toBe(true);
    expect(src.includes("areCoMembersOnAnyCapTable(")).toBe(true);
    expect(src.includes('"message"')).toBe(true);
    expect(src.includes("Private Investor")).toBe(true);
  });

  it("resolver doc comment no longer references the non-existent founderPrivacyStore kv table (BLOCKER 8)", () => {
    const src = read("lib/userPrivacyResolver.ts");
    // The stale phrase must be gone; the corrected table name must be present.
    expect(/founderPrivacyStore kv table/.test(src)).toBe(false);
    expect(src.includes("profilestore_user_privacy")).toBe(true);
  });

  it("resolveDisplayName has REAL (non-test, non-comment) call sites across the server", () => {
    // Round-1 blocker: zero call sites. Assert at least 3 distinct files call it.
    const files = ["collectiveRoutes.ts", "reportsStore.ts", "routes.ts"];
    const callers = files.filter((f) => /resolveDisplayName\(/.test(read(f)));
    expect(callers.length).toBeGreaterThanOrEqual(3);
  });
});

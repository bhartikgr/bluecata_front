/**
 * v25.48.2 MF-C — the /collective/profile/:userId route must be treated as
 * MEMBER-ONLY (behind CollectiveMemberGate), NOT exempt from the gate.
 *
 * Bug: CollectiveShell.isMemberGateExempt() used to exempt
 * "/collective/profile/", so a NON-member could mount PublicProfile.tsx. That
 * page immediately fetches GET /api/collective/members — a member-only endpoint
 * (requireCollectiveMember) — so a non-member fired a member-only API call (the
 * exact Q9 behavior the gate exists to prevent). No public/non-member-safe
 * profile endpoint exists, so the fix removes the exemption: a non-member now
 * sees the marketing/apply gate instead of the member-only page.
 *
 * Per the repo convention (vitest config matches `*.test.ts`, no jsdom / RTL),
 * this is a source-level structural guard rather than a DOM render test. It
 * pins the two load-bearing facts:
 *   1. isMemberGateExempt() no longer exempts the profile path — so the gate
 *      wraps the page for non-members.
 *   2. PublicProfile.tsx still resolves via the member-only /api/collective/
 *      members endpoint (i.e. it IS a member-only call that must stay gated).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SHELL = readFileSync(resolve(__dirname, "../CollectiveShell.tsx"), "utf8");
const PROFILE = readFileSync(resolve(__dirname, "../../pages/collective/PublicProfile.tsx"), "utf8");

// Extract only the body of isMemberGateExempt so unrelated matches elsewhere in
// the file (comments, JSX) can't mask a real regression.
function memberGateExemptBody(src: string): string {
  const start = src.indexOf("function isMemberGateExempt");
  expect(start).toBeGreaterThan(-1);
  const braceOpen = src.indexOf("{", start);
  const braceClose = src.indexOf("}", braceOpen);
  expect(braceClose).toBeGreaterThan(braceOpen);
  return src.slice(braceOpen, braceClose + 1);
}

describe("v25.48.2 MF-C — collective profile is member-only (not gate-exempt)", () => {
  it("isMemberGateExempt() does NOT exempt the /collective/profile/ path", () => {
    const body = memberGateExemptBody(SHELL);
    expect(body).not.toContain("/collective/profile/");
    expect(body).not.toMatch(/profile/i);
  });

  it("the gate-exempt list still covers the intended public surfaces only", () => {
    const body = memberGateExemptBody(SHELL);
    // These remain exempt (partner workspace, membership, syndicate apply).
    expect(body).toContain("/collective/partner");
    expect(body).toContain("/collective/membership");
    expect(body).toContain("/syndicate/apply");
  });

  it("PublicProfile.tsx resolves via the member-only /api/collective/members endpoint (must stay gated)", () => {
    expect(PROFILE).toContain("/api/collective/members");
  });
});

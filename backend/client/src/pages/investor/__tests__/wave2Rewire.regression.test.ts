/**
 * Wave 2 rewire regression — SPINE-0 is the single source of truth.
 *
 * The repo's vitest config runs in the default node environment WITHOUT
 * jsdom / RTL (see dataroomCategory.regression.test.ts for the documented
 * constraint), so importing the Dashboard/Invitations/ApplyToCollective TSX
 * would crash on radix's top-level `document` access. This test therefore
 * pairs, per the established repo pattern:
 *
 *   1) a BEHAVIORAL check of the shared tab-filter contract the Invitations
 *      page now delegates to the spine (accepted visible in the "Active" tab,
 *      #4); and
 *   2) SOURCE-TEXT PINS on the actual rewired lines, proving every surface
 *      imports the spine's derived values and no surface re-derives
 *      `state === x` locally afterward (Option-A single source of truth).
 *
 * Any revert to local re-bucketing (e.g. `i.state === activeTab`) fails these
 * source pins.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  toSpineInvitations,
  isPendingStage,
  isActiveStage,
  isSoftCircledStage,
  selectPendingInvitations,
  type NormalizedStage,
} from "../../../lib/investor/investorSpine";

const CLIENT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.resolve(CLIENT, rel), "utf8");

/* ---------------------------------------------------------------- */
/* 1) Behavioral: the exact tab-filter contract Invitations uses.   */
/* ---------------------------------------------------------------- */

// Mirrors matchesTab() in Invitations.tsx — the SINGLE bucket predicate.
// FIX #3 (count parity, Option A): the "Active" (pending) tab uses
// isPendingStage (invited+viewed+accepted), identical to spine.pendingInvitations
// that the Dashboard badge reads. soft_circled/confirmed/signed live in the
// Soft-circle tab (isSoftCircledStage) — no invitation short of funded is dropped.
function matchesTab(tab: "pending" | "soft_circled" | "declined" | "expired", stage: NormalizedStage): boolean {
  switch (tab) {
    case "pending":
      return isPendingStage(stage);
    case "soft_circled":
      return isSoftCircledStage(stage);
    case "declined":
      return stage === "declined";
    case "expired":
      return stage === "expired" || stage === "revoked";
  }
}

describe("Invitations tab filter delegates to spine buckets (#4 + FIX #3 parity)", () => {
  const spine = toSpineInvitations([
    { id: "a", state: "accepted" },
    { id: "b", state: "soft_circled" },
    { id: "c", state: "declined" },
    { id: "d", state: "expired" },
    { id: "e", state: "funded" },
    { id: "f", state: "invited" },
    { id: "g", state: "viewed" },
    { id: "h", state: "confirmed" },
    { id: "i", state: "signed" },
    { id: "j", state: "revoked" },
  ]);
  const stageById = new Map(spine.map((s) => [s.id, s.stage]));

  it("accepted is visible in the 'Active' (pending) tab, not dropped", () => {
    const active = spine.filter((s) => matchesTab("pending", s.stage)).map((s) => s.id);
    expect(active).toContain("a"); // the bug: accepted used to vanish
    expect(active).not.toContain("e"); // funded is a holding, not an invitation
  });

  it("FIX #3 PARITY: Active tab count === Dashboard pending badge count (identical set)", () => {
    // The Invitations "Active" (pending) tab membership...
    const activeTab = spine.filter((s) => matchesTab("pending", s.stage)).map((s) => s.id).sort();
    // ...must equal the Dashboard pending badge = spine.pendingInvitations.
    const dashboardPending = selectPendingInvitations(spine).map((s) => s.id).sort();
    expect(activeTab).toEqual(dashboardPending);
    expect(activeTab.length).toBe(dashboardPending.length);
    // Sample set: invited(f) + viewed(g) + accepted(a) = 3, identical on both.
    expect(activeTab).toEqual(["a", "f", "g"]);
  });

  it("NO SILENT DROP: soft_circled/confirmed/signed appear in the Soft-circle tab", () => {
    const softTab = spine.filter((s) => matchesTab("soft_circled", s.stage)).map((s) => s.id).sort();
    // b=soft_circled, h=confirmed, i=signed all land in the Soft-circle tab.
    expect(softTab).toEqual(["b", "h", "i"]);
  });

  it("every ladder invitation short of funded lands in exactly one tab (exhaustive)", () => {
    const tabs = ["pending", "soft_circled", "declined", "expired"] as const;
    for (const s of spine) {
      if (s.stage === "funded") continue; // funded surfaced in Portfolio, not a tab
      const hitCount = tabs.filter((t) => matchesTab(t, s.stage)).length;
      expect(hitCount).toBe(1); // exactly one tab, never dropped, never double-counted
    }
    // funded is intentionally out of every invitation tab (holding).
    expect(matchesTab("pending", stageById.get("e")!)).toBe(false);
    expect(isActiveStage(stageById.get("e")!)).toBe(false);
  });
});

/* ---------------------------------------------------------------- */
/* 2) Source pins: surfaces consume the spine, no local re-derive.  */
/* ---------------------------------------------------------------- */

describe("SPINE-0 single-source-of-truth source pins", () => {
  it("Dashboard reads pendingInvitations from the spine (#3)", () => {
    const src = read("pages/investor/Dashboard.tsx");
    expect(src).toMatch(/useInvestorSpine/);
    expect(src).toMatch(/spine\.pendingInvitations/);
  });

  it("Invitations groups by spine buckets, not exact state equality (#4)", () => {
    const src = read("pages/investor/Invitations.tsx");
    expect(src).toMatch(/useInvestorSpine/);
    expect(src).toMatch(/matchesTab\(/);
    // The old bug: exact-equality re-bucketing must be gone.
    expect(src).not.toMatch(/i\.state === activeTab/);
  });

  it("ApplyToCollective hero + gate read ONE spine eligibility verdict (#5)", () => {
    const src = read("pages/investor/ApplyToCollective.tsx");
    expect(src).toMatch(/useInvestorSpine/);
    expect(src).toMatch(/isCollectiveEligible/);
    // Gate no longer reads the raw server flag directly.
    expect(src).not.toMatch(/return Boolean\(elig\.data\?\.eligible\)/);
  });

  it("Messages soft-circle tab has the HIGHLIGHTED first-class callout (#7)", () => {
    const src = read("components/comms/CommsTiersTabs.tsx");
    expect(src).toMatch(/callout-soft-circle-unlock/);
    expect(src).toMatch(/other soft-circle investors in that same round/i);
  });

  it("Portfolio empty-state uses educational ladder copy (#8)", () => {
    const src = read("components/investor/PortfolioCompanySwitcher.tsx");
    expect(src).toMatch(/You don't hold any positions yet/);
    expect(src).toMatch(/marks your investment funded/);
    // The old, incorrect "accept ... holding is recorded" copy must be gone.
    expect(src).not.toMatch(/Once you accept an investment invitation and your holding is recorded/);
  });

  it("Dashboard portfolio-empty copy matches the Portfolio educational copy (#8)", () => {
    const dash = read("pages/investor/Dashboard.tsx");
    // Dashboard escapes the apostrophe as the &apos; HTML entity in JSX.
    expect(dash).toMatch(/You don(?:'|&apos;|&#39;)t hold any positions yet/);
    expect(dash).toMatch(/marks your investment funded/);
  });

  it("channels.ts stays the unchanged engine, cross-referencing the spine (#7)", () => {
    const src = read("lib/comms/channels.ts");
    expect(src).toMatch(/channelUnlockState/);
    expect(src).toMatch(/MUST NOT be forked/);
  });
});

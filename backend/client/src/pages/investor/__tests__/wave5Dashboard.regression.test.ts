/**
 * Wave 5 (ENH-2) regression — the full investor Dashboard is a PURE SPINE-0
 * consumer.
 *
 * The repo's vitest config runs in the default node environment WITHOUT jsdom /
 * RTL (see wave2Rewire.regression.test.ts for the documented constraint), so we
 * cannot mount the Dashboard/panel TSX. This test therefore follows the
 * established repo pattern:
 *
 *   1) BEHAVIORAL checks that each panel's derived values equal the shared
 *      SPINE-0 selectors (count parity with the Invitations page; holdings ==
 *      funded positions; channel-unlock rules; M&A company set; recent-activity
 *      events; M&A empty-state vs data classification).
 *   2) SOURCE-TEXT PINS proving every panel reads from `useInvestorSpine()` /
 *      spine selectors and never re-derives `state === x` locally, that the M&A
 *      panel reuses the existing privacy-gated endpoint (no server change), and
 *      that all prior Dashboard data-testids are preserved with the new panels
 *      added additively in the Ozan-locked order.
 *
 * Any revert to local re-derivation, a dropped prior data-testid, or a
 * reordered/removed panel fails these pins.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  toSpineInvitations,
  selectPendingInvitations,
  selectSoftCircledInvitations,
  selectHoldings,
  selectHasFundedPosition,
  selectChannelUnlockState,
  selectRecentActivity,
  selectMaCompanyIds,
  LADDER_EVENT_LABEL,
  INVESTOR_LADDER,
  type RawInvitationLike,
  type RawPositionLike,
} from "../../../lib/investor/investorSpine";

const CLIENT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.resolve(CLIENT, rel), "utf8");

/* ---------------------------------------------------------------- */
/* Fixtures — a mixed ladder + funded positions.                    */
/* ---------------------------------------------------------------- */

const RAW_INVS: RawInvitationLike[] = [
  { id: "i1", state: "invited", company: { id: "co_a", name: "Alpha Robotics Inc" }, round: { id: "r1", name: "Seed" } },
  { id: "i2", state: "viewed", company: { id: "co_b", name: "Beta Health Systems" }, round: { id: "r2", name: "Pre-Seed" } },
  { id: "i3", state: "accepted", company: { id: "co_c", name: "Gamma Energy Corp" }, round: { id: "r3", name: "Series A" } },
  { id: "i4", state: "soft_circled", company: { id: "co_d", name: "Delta AI Labs" }, round: { id: "r4", name: "Seed Ext" } },
  { id: "i5", state: "signed", company: { id: "co_e", name: "Epsilon Bio" }, round: { id: "r5", name: "Series B" } },
  { id: "i6", state: "funded", company: { id: "co_f", name: "Zeta Fintech" }, round: { id: "r6", name: "Seed" } },
  { id: "i7", state: "declined", company: { id: "co_g", name: "Eta Grid Co" }, round: { id: "r7", name: "Bridge" } },
];

// Funded cap-table positions (authoritative for holdings).
const POSITIONS: RawPositionLike[] = [
  { companyId: "co_f", company: "Zeta Fintech", sector: "Fintech", invested: 1_000_000, currentValue: 1_500_000 },
];

const spineInvs = toSpineInvitations(RAW_INVS);

/* ================================================================ */
/* 1) BEHAVIORAL — panel values equal the shared spine selectors.    */
/* ================================================================ */

describe("Wave 5 — panels equal SPINE-0 selectors", () => {
  it("Panel 1: holdings == funded positions only; hasFunded parity", () => {
    const holdings = selectHoldings(POSITIONS);
    expect(holdings).toHaveLength(1);
    expect(holdings[0].companyId).toBe("co_f");
    expect(selectHasFundedPosition(POSITIONS)).toBe(true);
    // Empty positions -> empty holdings + educational empty-state.
    expect(selectHoldings([])).toHaveLength(0);
    expect(selectHasFundedPosition([])).toBe(false);
  });

  it("Panel 2: recent activity mirrors canonical ladder stages (no re-derivation)", () => {
    const events = selectRecentActivity(spineInvs);
    // Terminal (declined) excluded; the 6 on-ladder invitations included.
    expect(events.map((e) => e.id).sort()).toEqual(["i1", "i2", "i3", "i4", "i5", "i6"]);
    // Each event's stage == the spine's normalized stage for that invitation.
    for (const e of events) {
      const src = spineInvs.find((s) => s.id === e.id)!;
      expect(e.stage).toBe(src.stage);
      // Full company name rendered verbatim (rule #13).
      expect(e.companyName).toBe(src.raw.company!.name);
      // A human label exists for every ladder rung.
      expect(LADDER_EVENT_LABEL[e.stage]).toBeTruthy();
    }
    // Every ladder rung has a label.
    for (const rung of INVESTOR_LADDER) expect(LADDER_EVENT_LABEL[rung]).toBeTruthy();
  });

  it("Panel 3: pending count == Invitations 'Active' set (invited+viewed+accepted)", () => {
    const pending = selectPendingInvitations(spineInvs);
    expect(pending.map((p) => p.id).sort()).toEqual(["i1", "i2", "i3"]);
    expect(pending).toHaveLength(3);
    // Soft-circled bucket = soft_circled + confirmed + signed (not funded).
    const soft = selectSoftCircledInvitations(spineInvs);
    expect(soft.map((s) => s.id).sort()).toEqual(["i4", "i5"]);
  });

  it("Panel 4: channel-unlock rules (soft-circle->channel, funded->cap-table)", () => {
    const ch = selectChannelUnlockState(spineInvs, POSITIONS);
    // Soft-circle channels come from soft_circled/confirmed/signed round ids.
    expect(ch.softCircleRoundIds.sort()).toEqual(["r4", "r5"]);
    expect(ch.hasSoftCircleChannel).toBe(true);
    // Cap-table channels come from funded positions (companyIds).
    expect(ch.capTableCompanyIds).toEqual(["co_f"]);
    expect(ch.hasCapTableChannel).toBe(true);
    // No positions -> no cap-table channel.
    expect(selectChannelUnlockState(spineInvs, []).hasCapTableChannel).toBe(false);
  });

  it("Panel 5: M&A company set = holdings + invited companies (deduped)", () => {
    const ids = selectMaCompanyIds(selectHoldings(POSITIONS), spineInvs);
    // co_f is both a holding AND an invitation -> appears once, holdings-first.
    expect(ids[0]).toBe("co_f");
    // Invited companies (on-ladder) included; declined (co_g) excluded.
    expect(ids).toContain("co_a");
    expect(ids).toContain("co_e");
    expect(ids).not.toContain("co_g");
    // Deduped.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Panel 5: M&A empty-state vs data classification (fail-closed, no fabrication)", () => {
    // The panel's hasData predicate: real data only when a score/intent/buyer
    // is present; zeros -> empty-state. Mirror it here.
    const hasData = (i: {
      maScore: number; acquirerFitScore: number;
      intentSignal: string; topStrategicBuyers?: { name: string }[];
    } | null) =>
      !!i &&
      (i.maScore > 0 ||
        i.acquirerFitScore > 0 ||
        (i.intentSignal && i.intentSignal !== "none") ||
        (i.topStrategicBuyers?.length ?? 0) > 0);

    // No data (403/404/empty -> null) => empty-state.
    expect(hasData(null)).toBe(false);
    // All-zero derived record (no stored profile) => empty-state.
    expect(hasData({ maScore: 0, acquirerFitScore: 0, intentSignal: "none", topStrategicBuyers: [] })).toBe(false);
    // Real data => rendered.
    expect(hasData({ maScore: 72, acquirerFitScore: 66, intentSignal: "inbound", topStrategicBuyers: [{ name: "Stripe" }] })).toBe(true);
  });

  it("Panel 5: comps/range render when present, empty-state when absent (never fabricated)", () => {
    // Mirror the panel's comps predicate: a list only when at least one comp.
    const showCompsList = (i: { comparableExits?: unknown[] } | null) =>
      (i?.comparableExits?.length ?? 0) > 0;
    // Mirror the panel's range predicate: shown only when low>0 OR high>0.
    const showRange = (i: { revenueMultipleRange?: { low: number; high: number } } | null) =>
      !!i?.revenueMultipleRange && (i.revenueMultipleRange.low > 0 || i.revenueMultipleRange.high > 0);

    // Absent / empty (derived profile with no comps) -> empty-state, no fabrication.
    expect(showCompsList(null)).toBe(false);
    expect(showCompsList({})).toBe(false);
    expect(showCompsList({ comparableExits: [] })).toBe(false);
    expect(showRange(null)).toBe(false);
    expect(showRange({})).toBe(false);
    expect(showRange({ revenueMultipleRange: { low: 0, high: 0 } })).toBe(false);

    // Present -> rendered.
    expect(showCompsList({ comparableExits: [{ target: "T1" }] })).toBe(true);
    expect(showRange({ revenueMultipleRange: { low: 2.1, high: 4.8 } })).toBe(true);
  });
});

/* ================================================================ */
/* 2) SOURCE-TEXT PINS — the panels are pure SPINE-0 consumers.      */
/* ================================================================ */

describe("Wave 5 — source pins (SPINE-0 only, additive, gate respected)", () => {
  const panels = read("components/investor/DashboardSpinePanels.tsx");
  const dash = read("pages/investor/Dashboard.tsx");

  it("every panel reads from useInvestorSpine (no re-derivation)", () => {
    // The spine hook is the ONLY state source in the panels file.
    expect(panels).toMatch(/useInvestorSpine\(\)/);
    // Uses the spine's derived buckets/selectors directly.
    expect(panels).toMatch(/spine\.holdings/);
    expect(panels).toMatch(/spine\.hasFundedPosition/);
    expect(panels).toMatch(/spine\.recentActivity/);
    expect(panels).toMatch(/spine\.pendingInvitations\.length/);
    expect(panels).toMatch(/spine\.softCircledInvitations\.length/);
    expect(panels).toMatch(/spine\.channelUnlockState/);
    expect(panels).toMatch(/spine\.maCompanyIds/);
    // NO local invitation re-bucketing (the #3/#7/#8 drift source).
    expect(panels).not.toMatch(/\.state\s*===/);
    expect(panels).not.toMatch(/normalizeLadderState/);
  });

  it("M&A panel reuses the existing privacy-gated endpoint (no server change)", () => {
    // Reuses the SAME queryKey the existing dashboard M&A table uses.
    expect(panels).toMatch(/"\/api\/investor\/ma\/intelligence"/);
    // No fabricated fallbacks / mock feature maps in the panel.
    expect(panels).not.toMatch(/COMPANY_FEATURES/);
    expect(panels).not.toMatch(/COMPS_LIBRARY/);
    // Per-company empty-state exists (fail-closed).
    expect(panels).toMatch(/spine-ma-empty-\$\{companyId\}/);
    expect(panels).toMatch(/No M&amp;A intelligence available/);
  });

  it("M&A panel renders comparableExits + revenueMultipleRange with empty-states (never fabricated)", () => {
    // The two fields are read from the intel response and rendered.
    expect(panels).toMatch(/comparableExits/);
    expect(panels).toMatch(/revenueMultipleRange/);
    // Comps list + its own empty-state (honest, no fabricated rows).
    expect(panels).toMatch(/spine-ma-comps-list-\$\{companyId\}/);
    expect(panels).toMatch(/spine-ma-comps-empty-\$\{companyId\}/);
    expect(panels).toMatch(/No qualifying comparable exits in window\./);
    // Range value + its own empty-state (honest, no fabricated numbers).
    expect(panels).toMatch(/spine-ma-range-\$\{companyId\}/);
    expect(panels).toMatch(/spine-ma-range-empty-\$\{companyId\}/);
    expect(panels).toMatch(/Revenue multiple range not available/);
    // Still no static mock sources anywhere in the panel.
    expect(panels).not.toMatch(/COMPS_LIBRARY/);
  });

  it("panels render in Ozan-locked order: Portfolio -> Activity -> Invitations -> Messages -> M&A", () => {
    const order = [
      panels.indexOf("<PortfolioStandingPanel />"),
      panels.indexOf("<RecentActivityPanel />"),
      panels.indexOf("<InvitationsSummaryPanel />"),
      panels.indexOf("<ChannelsSummaryPanel />"),
      panels.indexOf("<MaIntelligencePanel />"),
    ];
    expect(order.every((n) => n >= 0)).toBe(true);
    const sorted = [...order].sort((a, b) => a - b);
    expect(order).toEqual(sorted);
    // The section is wired into the Dashboard additively.
    expect(dash).toMatch(/<DashboardSpinePanels \/>/);
    expect(dash).toMatch(/from "@\/components\/investor\/DashboardSpinePanels"/);
  });

  it("all prior Dashboard data-testids are preserved (no silent drop, rule #8)", () => {
    const PRIOR_TESTIDS = [
      "button-go-crm", "button-invitations", "badge-pending-invitations",
      "badge-pending-invitations-bento", "banner-collective-lapsed", "button-renew-collective",
      "bento-grid-investor-dashboard", "bento-tile-investor-hero",
      "bento-action-portfolio", "bento-tile-investor-kpi-committed",
      "bento-tile-investor-kpi-companies", "bento-tile-investor-kpi-softcircles",
      "bento-tile-investor-kpi-funded", "bento-tile-investor-activity",
      "bento-tile-investor-quick", "bento-action-invitations", "bento-action-crm",
      "bento-action-profile", "card-cohort", "card-ma-panel", "table-ma",
      "card-round-activity", "list-round-activity", "marker-you",
    ];
    for (const id of PRIOR_TESTIDS) {
      expect(dash.includes(`data-testid="${id}"`)).toBe(true);
    }
    // Prior dynamic testids preserved too.
    expect(dash).toMatch(/data-testid=\{`row-ma-\$\{pos\.companyId\}/);
    expect(dash).toMatch(/data-testid=\{`row-ra-\$\{act\.id\}/);
    expect(dash).toMatch(/data-testid=\{`text-fit-\$\{pos\.companyId\}/);
  });

  it("new spine panels expose their own additive data-testids", () => {
    // Panel-level ids render via literal data-testid.
    for (const id of [
      "spine-panel-portfolio", "spine-panel-activity", "spine-panel-invitations",
      "spine-panel-channels", "spine-panel-ma", "spine-panels-section",
      "spine-portfolio-empty", "spine-channels-pointer",
    ]) {
      expect(panels.includes(`data-testid="${id}"`)).toBe(true);
    }
    // Stat/metric ids reach the DOM via a `testid` prop -> data-testid.
    for (const id of ["spine-invitations-pending", "spine-invitations-softcircled", "spine-portfolio-count"]) {
      expect(panels.includes(`"${id}"`)).toBe(true);
    }
  });
});

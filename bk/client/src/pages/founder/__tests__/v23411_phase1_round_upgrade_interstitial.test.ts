/**
 * v23.4.11 Phase 1 (B-201) — Round-wizard "Upgrade to Pro" interstitial.
 *
 * Bug B-201: a Free-plan founder navigating to /founder/rounds/new was SILENTLY
 * redirected to /founder/subscribe with no explanation (and the header active
 * company snapped back to the auto-created Workspace). The fix replaces the
 * silent redirect with an explicit <UpgradeToProInterstitial> rendered in-place
 * by RoundNew when the active company is on a Free tier.
 *
 * The plan-tier decision lives in the pure `isPaidFounderPlan` helper, which is
 * unit-tested here against BOTH the server "code" form (founder_pro) and the
 * human label form ("Founder Pro") since the active-company billing layer emits
 * labels. The remaining assertions are source-grep checks (the repo convention,
 * mirroring v23.4.10 Phase 5) so a regression that reintroduces the silent
 * redirect, drops the testid, or stops wiring the interstitial fails loudly.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isPaidFounderPlan } from "../UpgradeToProInterstitial";

const INTERSTITIAL_SRC = readFileSync(
  resolve(__dirname, "../UpgradeToProInterstitial.tsx"),
  "utf8",
);
const ROUNDNEW_SRC = readFileSync(
  resolve(__dirname, "../RoundNew.tsx"),
  "utf8",
);

describe("v23.4.11 Phase 1 (B-201) isPaidFounderPlan helper", () => {
  it("treats Free tiers (code + label) as NOT paid", () => {
    expect(isPaidFounderPlan("founder_free")).toBe(false);
    expect(isPaidFounderPlan("Founder Free")).toBe(false);
    expect(isPaidFounderPlan("free")).toBe(false);
    expect(isPaidFounderPlan("Free")).toBe(false);
  });

  it("treats null / undefined / empty as NOT paid (fail-closed)", () => {
    expect(isPaidFounderPlan(null)).toBe(false);
    expect(isPaidFounderPlan(undefined)).toBe(false);
    expect(isPaidFounderPlan("")).toBe(false);
    expect(isPaidFounderPlan("   ")).toBe(false);
  });

  it("treats Pro / Scale / Enterprise (code + label) as paid", () => {
    expect(isPaidFounderPlan("founder_pro")).toBe(true);
    expect(isPaidFounderPlan("Founder Pro")).toBe(true);
    expect(isPaidFounderPlan("founder_scale")).toBe(true);
    expect(isPaidFounderPlan("Founder Scale")).toBe(true);
    expect(isPaidFounderPlan("founder_enterprise")).toBe(true);
    expect(isPaidFounderPlan("Founder Enterprise")).toBe(true);
  });
});

describe("v23.4.11 Phase 1 (B-201) UpgradeToProInterstitial component", () => {
  it("exposes the required upgrade CTA testid", () => {
    expect(INTERSTITIAL_SRC).toContain(
      'data-testid="button-upgrade-active-company"',
    );
  });

  it("offers a back-to-dashboard secondary CTA", () => {
    expect(INTERSTITIAL_SRC).toContain('data-testid="button-back-to-dashboard"');
    expect(INTERSTITIAL_SRC).toContain('navigate("/founder/dashboard")');
  });

  it("primary CTA routes to /founder/subscribe (no auto-redirect)", () => {
    expect(INTERSTITIAL_SRC).toContain('navigate("/founder/subscribe")');
    // It must NOT auto-redirect on mount via <Redirect> — the whole point of
    // B-201 is that the founder stays put and is given a choice.
    expect(INTERSTITIAL_SRC).not.toMatch(/<Redirect\b/);
  });

  it("explains the gate with company name + plan label", () => {
    expect(INTERSTITIAL_SRC).toContain("Rounds require the Pro plan");
    expect(INTERSTITIAL_SRC).toContain("{safeCompanyName}");
    expect(INTERSTITIAL_SRC).toContain("{safePlanLabel}");
  });

  it("uses shadcn Card + Button primitives", () => {
    expect(INTERSTITIAL_SRC).toMatch(
      /from\s*"@\/components\/ui\/card"/,
    );
    expect(INTERSTITIAL_SRC).toMatch(
      /from\s*"@\/components\/ui\/button"/,
    );
  });
});

describe("v23.4.11 Phase 1 (B-201) RoundNew wiring", () => {
  it("imports the interstitial + plan helper", () => {
    expect(ROUNDNEW_SRC).toMatch(
      /import\s+UpgradeToProInterstitial\s*,\s*\{\s*isPaidFounderPlan\s*\}\s*from\s*"@\/pages\/founder\/UpgradeToProInterstitial"/,
    );
  });

  it("reads the active company plan via the shared active-company hook", () => {
    expect(ROUNDNEW_SRC).toContain("useActiveCompany(");
    expect(ROUNDNEW_SRC).toContain("activeCompany?.billing?.plan");
  });

  it("plan-gates the wizard render-time (renders interstitial when not paid)", () => {
    expect(ROUNDNEW_SRC).toMatch(/!isPaidFounderPlan\(activePlan\)/);
    expect(ROUNDNEW_SRC).toContain("<UpgradeToProInterstitial");
  });

  it("does NOT silently redirect free founders to /subscribe from the wizard", () => {
    // The wizard body must not contain a navigate(...)/Redirect to /subscribe;
    // the gate is now the explicit interstitial component instead.
    expect(ROUNDNEW_SRC).not.toMatch(/navigate\(\s*["'`]\/founder\/subscribe/);
    expect(ROUNDNEW_SRC).not.toMatch(/Redirect\s+to=["'`]\/founder\/subscribe/);
  });
});

/**
 * Wave G Track 2 — G3: bento-grid dashboards tests.
 *
 * Static analysis of the founder Welcome + founder Dashboard + investor
 * Dashboard sources: each one must contain a Tailwind grid wrapper with
 * 4-column layout AND at least 6 bento-tile cards (data-testid markers).
 *
 * We don't render JSX here — that would require JSDOM + the full React
 * tree. Instead, we assert structural invariants that a future regression
 * (someone collapsing the grid or removing tiles) would visibly break.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..");

const FILES = {
  welcome:        path.join(ROOT, "client", "src", "pages", "founder",  "Welcome.tsx"),
  founderDash:    path.join(ROOT, "client", "src", "pages", "founder",  "Dashboard.tsx"),
  investorDash:   path.join(ROOT, "client", "src", "pages", "investor", "Dashboard.tsx"),
};

function read(p: string) {
  return fs.readFileSync(p, "utf8");
}

function countMatches(src: string, re: RegExp): number {
  return (src.match(re) ?? []).length;
}

describe("Wave G Track 2 G3 — bento-grid dashboards", () => {
  // -----------------------------------------------------------------------
  // Founder Welcome
  // -----------------------------------------------------------------------
  describe("founder Welcome.tsx", () => {
    const src = read(FILES.welcome);

    it("declares the bento grid wrapper with 4-col responsive layout", () => {
      expect(src).toMatch(/data-testid=["']bento-grid-welcome["']/);
      expect(src).toMatch(/lg:grid-cols-4/);
      expect(src).toMatch(/md:grid-cols-2/);
    });

    it("renders the hero tile + 4 KPI tiles + checklist + activity + quick + tips (>=6 tiles)", () => {
      // count both static (`data-testid="bento-tile-…"`) and templated
      // (`data-testid={`bento-tile-…`}`) occurrences so the .map-rendered
      // KPI loop counts as a tile too.
      const tiles = countMatches(src, /data-testid=[{"']`?bento-tile-/g);
      expect(tiles).toBeGreaterThanOrEqual(6);
      // Spot-check the canonical tile IDs.
      expect(src).toMatch(/data-testid=["']bento-tile-hero["']/);
      expect(src).toMatch(/bento-tile-kpi-\$\{k\.key\}/); // templated KPI loop
      expect(src).toMatch(/data-testid=["']bento-tile-checklist["']/);
      expect(src).toMatch(/data-testid=["']bento-tile-activity["']/);
      expect(src).toMatch(/data-testid=["']bento-tile-quick-actions["']/);
      expect(src).toMatch(/data-testid=["']bento-tile-tips["']/);
      // The kpis array defines: companies, rounds, committed, invited.
      for (const k of ["companies", "rounds", "committed", "invited"]) {
        expect(src).toMatch(new RegExp(`key:\\s*["']${k}["']`));
      }
    });

    it("preserves the existing welcome page contract (loading + error testids)", () => {
      expect(src).toMatch(/data-testid=["']page-welcome-loading["']/);
      expect(src).toMatch(/data-testid=["']page-welcome-error["']/);
      expect(src).toMatch(/data-testid=["']page-welcome["']/);
      expect(src).toMatch(/data-testid=["']button-ack-welcome["']/);
      expect(src).toMatch(/data-testid=["']button-skip-welcome["']/);
      expect(src).toMatch(/data-testid=["']text-welcome-title["']/);
    });

    it("wires HOVER_LIFT micro-interaction onto bento tiles", () => {
      expect(src).toMatch(/from\s+["']@\/lib\/microInteractions["']/);
      expect(src).toMatch(/HOVER_LIFT/);
    });

    it("uses the canonical greeting 'Welcome back, {firstName}. Here's where you are.'", () => {
      expect(src).toMatch(/Welcome back, \{firstName\}\. Here's where you are/);
    });
  });

  // -----------------------------------------------------------------------
  // Founder Dashboard
  // -----------------------------------------------------------------------
  describe("founder Dashboard.tsx", () => {
    const src = read(FILES.founderDash);

    it("declares the founder-dashboard bento grid", () => {
      expect(src).toMatch(/data-testid=["']bento-grid-founder-dashboard["']/);
      expect(src).toMatch(/lg:grid-cols-4/);
    });

    it("renders at least 6 bento tiles", () => {
      const tiles = countMatches(src, /data-testid=["']bento-tile-[a-z0-9-]+["']/g);
      expect(tiles).toBeGreaterThanOrEqual(6);
    });

    it("renders hero + 4 KPI + activity + quick tiles by canonical id", () => {
      expect(src).toMatch(/bento-tile-founder-hero/);
      expect(src).toMatch(/bento-tile-kpi-ownership/);
      expect(src).toMatch(/bento-tile-kpi-holders/);
      expect(src).toMatch(/bento-tile-kpi-raised/);
      expect(src).toMatch(/bento-tile-kpi-dataroom/);
      expect(src).toMatch(/bento-tile-founder-activity/);
      expect(src).toMatch(/bento-tile-founder-quick/);
    });

    it("wires HOVER_LIFT micro-interaction", () => {
      expect(src).toMatch(/from\s+["']@\/lib\/microInteractions["']/);
      expect(src).toMatch(/HOVER_LIFT/);
    });

    it("preserves existing dashboard sections (no regression of legacy testids)", () => {
      // A handful of the most critical IDs that other tests depend on.
      expect(src).toMatch(/data-testid=["']card-profile-completion["']/);
      expect(src).toMatch(/data-testid=["']card-funnel["']/);
      expect(src).toMatch(/data-testid=["']card-activity-preview["']/);
      expect(src).toMatch(/data-testid=["']card-comms-center["']/);
      expect(src).toMatch(/data-testid=["']card-ma-inbound["']/);
    });
  });

  // -----------------------------------------------------------------------
  // Investor Dashboard
  // -----------------------------------------------------------------------
  describe("investor Dashboard.tsx", () => {
    const src = read(FILES.investorDash);

    it("declares the investor-dashboard bento grid", () => {
      expect(src).toMatch(/data-testid=["']bento-grid-investor-dashboard["']/);
      expect(src).toMatch(/lg:grid-cols-4/);
    });

    it("renders at least 6 bento tiles", () => {
      const tiles = countMatches(src, /data-testid=["']bento-tile-[a-z0-9-]+["']/g);
      expect(tiles).toBeGreaterThanOrEqual(6);
    });

    it("renders hero + 4 KPI + activity + quick tiles by canonical id", () => {
      expect(src).toMatch(/bento-tile-investor-hero/);
      expect(src).toMatch(/bento-tile-investor-kpi-committed/);
      expect(src).toMatch(/bento-tile-investor-kpi-companies/);
      expect(src).toMatch(/bento-tile-investor-kpi-softcircles/);
      expect(src).toMatch(/bento-tile-investor-kpi-funded/);
      expect(src).toMatch(/bento-tile-investor-activity/);
      expect(src).toMatch(/bento-tile-investor-quick/);
    });

    it("wires HOVER_LIFT micro-interaction", () => {
      expect(src).toMatch(/from\s+["']@\/lib\/microInteractions["']/);
      expect(src).toMatch(/HOVER_LIFT/);
    });

    it("preserves existing investor-dashboard sections (no regression)", () => {
      // critical testids from the existing dashboard
      expect(src).toMatch(/data-testid=["']button-go-crm["']/);
      expect(src).toMatch(/data-testid=["']button-invitations["']/);
      // investor dashboard uses prop-style `testid="kpi-moic"` on its <KpiSpark> wrapper
      expect(src).toMatch(/testid=["']kpi-moic["']/);
      expect(src).toMatch(/data-testid=["']card-ma-panel["']/);
      expect(src).toMatch(/data-testid=["']card-round-activity["']/);
    });
  });
});

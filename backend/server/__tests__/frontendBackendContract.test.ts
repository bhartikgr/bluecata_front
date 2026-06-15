/**
 * Wave D — Front-end ↔ Back-end Contract Reconciliation
 *
 * These tests pin the marketing/homepage copy and link targets to the
 * actual backend behavior. They read the .jsx component sources as strings
 * and assert the strings (and absences of strings) that Wave D mandated.
 *
 * Why this exists: the marketing pages previously advertised pricing
 * ("$70/month", "Free to start") and link destinations (#cta-final,
 * https://capavate.com/onboarding) that did not match the backend
 * contract (admin/founder $840 USD/year/company, 14-day trial, real
 * apply form at /#/apply/consortium, hash-routed onboarding).
 *
 * If you change marketing copy in PricingSection.jsx, AudiencesSection.jsx,
 * Footer3.jsx, or Header3.jsx, you may need to update this test — but
 * doing so requires you to also update the backend so the promise is true.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readJsx(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

describe("Wave D — front-end ↔ back-end contract reconciliation", () => {
  describe("ISSUE 1 — PricingSection shows $840/year, not $70/month", () => {
    const src = readJsx("client/src/components/home3compo/PricingSection.jsx");

    it("headline displays $840/year per company", () => {
      expect(src).toContain("$840/year per company");
    });

    it("does NOT show legacy '$70/month' headline", () => {
      // The "$70/month" headline was the legacy copy. It must be gone.
      expect(src).not.toMatch(/\$70\/month to activate/);
    });

    it("price block shows '$840' and '/year · per company'", () => {
      expect(src).toContain(">$840<");
      expect(src).toContain("/year · per company");
    });

    it("annotation describes per-company billing", () => {
      expect(src).toContain("Each additional company: $840/year (per-company billing)");
    });

    it("removed the secondary '$840/year — less than one warm introduction' line", () => {
      expect(src).not.toMatch(/less than one warm introduction is worth/);
    });
  });

  describe("ISSUE 2 — AudiencesSection advertises 14-day free trial", () => {
    const src = readJsx("client/src/components/home3compo/AudiencesSection.jsx");

    it("CTA note says '14-day free trial · No credit card required'", () => {
      expect(src).toContain("14-day free trial · No credit card required");
    });

    it("does NOT say 'Free to start · No credit card required'", () => {
      expect(src).not.toContain("Free to start · No credit card required");
    });
  });

  describe("ISSUE 3 — Investor 'Free. Always.' includes invitation-only context", () => {
    const src = readJsx("client/src/components/home3compo/PricingSection.jsx");

    it("retains 'Free. Always.' headline", () => {
      expect(src).toContain("Free. Always.");
    });

    it("subtext clarifies investors are invited by their companies", () => {
      expect(src).toContain("Investors are invited by their");
      expect(src).toContain("companies");
    });
  });

  describe("ISSUE 4 — Investor card href uses path-routed onboarding (Avi-preserved, v23.4.7.1)", () => {
    const src = readJsx("client/src/components/home3compo/PricingSection.jsx");

    it("links to https://capavate.com/onboarding?portal=investor (path-routed, no hash — Avi's permanent fix)", () => {
      expect(src).toContain('href="https://capavate.com/onboarding?portal=investor"');
    });

    it("does NOT use the legacy hash-routed https://capavate.com/#/onboarding form", () => {
      expect(src).not.toMatch(/href="https:\/\/capavate\.com\/#\/onboarding/);
    });
  });

  describe("ISSUE 5 — Ecosystem Partner CTA points to apply form", () => {
    const src = readJsx("client/src/components/home3compo/PricingSection.jsx");

    it("Become an Ecosystem Partner href is /apply/consortium (Avi-preserved path-routed)", () => {
      expect(src).toContain('href="https://capavate.com/apply/consortium"');
    });

    it("Become an Ecosystem Partner CTA no longer dead-ends to #cta-final", () => {
      // Look for the exact anchor pattern from the legacy copy.
      expect(src).not.toMatch(/href="#cta-final"[^>]*>\s*Become an Ecosystem Partner/);
    });
  });

  describe("ISSUE 6 — Investor secondary card has 3-bullet feature parity", () => {
    const src = readJsx("client/src/components/home3compo/PricingSection.jsx");

    it("lists 'Verified portfolio holdings'", () => {
      expect(src).toContain("Verified portfolio holdings");
    });

    it("lists 'Co-investor visibility'", () => {
      expect(src).toContain("Co-investor visibility");
    });

    it("lists 'Real-time round updates'", () => {
      expect(src).toContain("Real-time round updates");
    });
  });

  describe("ISSUE 7 — Footer3 has all required sign-in affordances", () => {
    const src = readJsx("client/src/components/home3compo/Footer3.jsx");

    it("has founder sign-in link (/auth/login?portal=founder — Avi-preserved path-routed)", () => {
      expect(src).toContain("/auth/login?portal=founder");
    });

    it("has investor sign-in link (/auth/login?portal=investor — Avi-preserved path-routed)", () => {
      expect(src).toContain("/auth/login?portal=investor");
    });

    it("has partner sign-in link (/partner/login — Avi-preserved path-routed)", () => {
      expect(src).toContain("/partner/login");
    });

    it("has admin sign-in link (/admin/login — Avi-preserved path-routed)", () => {
      expect(src).toContain("/admin/login");
    });

    it("has apply-consortium link (/apply/consortium — Avi-preserved path-routed)", () => {
      expect(src).toContain("/apply/consortium");
    });
  });

  describe("ISSUE 8 — Header3 dropdown surfaces all 3 personas", () => {
    const src = readJsx("client/src/components/home3compo/Header3.jsx");

    it("dropdown has 'For Investors' linked to login?portal=investor (Avi-preserved path-routed)", () => {
      expect(src).toContain("/auth/login?portal=investor");
      expect(src).toContain("For Investors");
    });

    it("dropdown has 'For Founders' linked to signup?portal=founder (Avi-preserved path-routed)", () => {
      expect(src).toContain("/auth/signup?portal=founder");
      expect(src).toContain("For Founders");
    });

    it("dropdown surfaces Consortium Partners route (Avi-preserved path-routed)", () => {
      // Either /partner/login or /apply/consortium must be present —
      // per the spec, partner-login is sufficient on the header dropdown,
      // and the mobile menu also lists the apply route.
      expect(src).toMatch(/\/partner\/login/);
    });

    it("mobile menu also includes all three personas", () => {
      expect(src).toMatch(/link-mobile-investor-login/);
      expect(src).toMatch(/link-mobile-founder-signup/);
      expect(src).toMatch(/link-mobile-partner-login/);
    });
  });
});

/**
 * WAVE 341 (productgaps2) · W335 — THE LEGAL PAGES MUST NOT SWITCH THE SIDEBAR
 * TO THE FOUNDER WORKSPACE.
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT IS PROVED HERE, and how this file refuses to go vacuously green:
 *
 *   §1 THE MECHANISM IS REAL, read out of App.tsx itself rather than asserted:
 *      the five legal routes are registered where `isAuthRoute` does NOT make
 *      them bare, so AppRouter wraps them in AppShell. BOTH POLES: a
 *      `/collective/…` path IS matched by the bare rule, a legal path is NOT.
 *
 *   §2 RENDERED HREFs. `LegalFooterLinks` is mounted at a partner location, at
 *      a collective-member location and at a founder location, and the href
 *      actually present in the DOM is asserted in each case. The founder case
 *      is the CONTROL: its href must be byte-for-byte the old public path, so a
 *      change that simply prefixed everything would fail.
 *
 *   §3 EVERY HREF THE FOOTER RENDERS IS A REGISTERED ROUTE. The route strings
 *      are read out of App.tsx source; a link to a path nobody registered would
 *      be a 404 dressed as a fix, which is the failure mode this band keeps
 *      finding.
 *
 *   §4 NOTHING WAS TAKEN AWAY: the five bare public registrations are still in
 *      App.tsx, and the precedent route at :1313 is still there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import {
  legalScopeForLocation,
  legalHref,
  LEGAL_PUBLIC_PATHS,
  LEGAL_SCOPE_PARTNER,
  LEGAL_SCOPE_COLLECTIVE,
} from "@/lib/legalShellScope";

vi.mock("@/components/LegalUpdateNotice", () => ({ LegalUpdateNotice: () => null }));

const APP_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../App.tsx"),
  "utf8",
);

function mountAt(location: string) {
  const { hook } = memoryLocation({ path: location, static: true });
  return render(
    <Router hook={hook}>
      <LegalFooterLinks />
    </Router>,
  );
}

const hrefOf = (testid: string) =>
  screen.getByTestId(testid).getAttribute("href");

afterEach(() => cleanup());

describe("W341 W335 §1 — the mechanism, read out of App.tsx", () => {
  it("§1a the legal routes are registered, and NOT under /collective/", () => {
    for (const p of ['path="/terms-of-service"', 'path="/privacy-policy"', 'path="/legal/:docId"']) {
      expect(APP_SRC.includes(p), `${p} must still be registered`).toBe(true);
    }
    /* BOTH POLES of the bare rule. */
    expect(APP_SRC.includes('path.startsWith("/collective/")')).toBe(true);
    expect(APP_SRC.includes('path === "/terms-of-service"')).toBe(false);
    expect(APP_SRC.includes('path === "/privacy-policy"')).toBe(false);
  });

  it("§1b AppRouter really wraps non-bare routes in AppShell", () => {
    expect(APP_SRC).toContain("return bare ? routes : <AppShell>{routes}</AppShell>;");
  });

  it("§1c AppShell really falls back to the role, defaulting to founder", () => {
    const shell = fs.readFileSync(
      path.resolve(__dirname, "../AppShell.tsx"),
      "utf8",
    );
    expect(shell).toContain('location.startsWith("/admin")');
    expect(shell).toContain('location.startsWith("/investor")');
    expect(shell).toContain('location.startsWith("/founder")');
    /* the fall-through that produced the defect */
    expect(shell).toContain(': "founder";');
  });
});

describe("W341 W335 §2 — the rendered href follows the shell the visitor is in", () => {
  it("§2a a Consortium Partner stays in the partner shell", () => {
    mountAt("/collective/partner/pipeline");
    expect(hrefOf("link-terms-of-service")).toBe("/collective/partner/terms-of-service");
    expect(hrefOf("link-privacy-policy")).toBe("/collective/partner/privacy-policy");
  });

  it("§2b a Collective member stays in the collective shell, NOT the partner one", () => {
    mountAt("/collective/dashboard");
    expect(hrefOf("link-terms-of-service")).toBe("/collective/terms-of-service");
    expect(hrefOf("link-privacy-policy")).toBe("/collective/privacy-policy");
    /* the partner alias would silently re-theme their page — assert it is NOT used */
    expect(hrefOf("link-terms-of-service")).not.toContain("/partner");
  });

  it("§2c CONTROL — a founder's links are UNCHANGED, byte for byte", () => {
    mountAt("/founder/dashboard");
    expect(hrefOf("link-terms-of-service")).toBe("/terms-of-service");
    expect(hrefOf("link-privacy-policy")).toBe("/privacy-policy");
  });

  it("§2d CONTROL — an anonymous/public location is unchanged too", () => {
    mountAt("/");
    expect(hrefOf("link-terms-of-service")).toBe("/terms-of-service");
    expect(hrefOf("link-privacy-policy")).toBe("/privacy-policy");
  });
});

describe("W341 W335 §3 — every href the footer can render is a registered route", () => {
  it("§3a the partner and collective aliases are registered in App.tsx", () => {
    const scopes = [LEGAL_SCOPE_PARTNER, LEGAL_SCOPE_COLLECTIVE, ""];
    const rendered: string[] = [];
    for (const scope of scopes) {
      rendered.push(legalHref(scope, LEGAL_PUBLIC_PATHS.terms));
      rendered.push(legalHref(scope, LEGAL_PUBLIC_PATHS.privacy));
    }
    expect(rendered.length).toBe(6);
    const unregistered = rendered.filter((h) => !APP_SRC.includes(`path="${h}"`));
    expect(unregistered).toEqual([]);
    /* both sides non-empty: the set we checked is not empty either */
    expect(rendered).toContain("/collective/partner/terms-of-service");
  });

  it("§3b the doc alias is registered for both scopes", () => {
    expect(APP_SRC).toContain('path="/collective/partner/legal/:docId"');
    expect(APP_SRC).toContain('path="/collective/legal/:docId"');
  });

  it("§3c every alias renders the SAME component as the public route", () => {
    for (const marker of [
      '<Route path="/collective/partner/terms-of-service">',
      '<Route path="/collective/terms-of-service">',
    ]) {
      const at = APP_SRC.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      expect(APP_SRC.slice(at, at + 260)).toContain("<LegalTermsPage />");
      expect(APP_SRC.slice(at, at + 260)).toContain("<CollectiveShell>");
    }
    for (const marker of [
      '<Route path="/collective/partner/privacy-policy">',
      '<Route path="/collective/privacy-policy">',
    ]) {
      const at = APP_SRC.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      expect(APP_SRC.slice(at, at + 260)).toContain("<LegalPrivacyPage />");
    }
  });
});

describe("W341 W335 §4 — nothing was removed", () => {
  it("§4a the five bare public legal registrations are still there", () => {
    for (const p of ["/terms", "/terms-of-service", "/privacy", "/privacy-policy"]) {
      expect(APP_SRC).toContain(`<Route path="${p}" component=`);
    }
    expect(APP_SRC).toContain('<Route path="/legal/:docId">');
  });

  it("§4b the confirmed precedent at :1313 is untouched", () => {
    expect(APP_SRC).toContain('<Route path="/collective/partner/privacy">');
  });

  it("§4c the scope helper leaves every non-Collective path alone", () => {
    for (const loc of ["/", "/founder/x", "/investor/x", "/admin/x", "/terms-of-service", "/collective"]) {
      expect(legalScopeForLocation(loc), loc).toBe("");
    }
    expect(legalScopeForLocation("/collective/partner/anything")).toBe(LEGAL_SCOPE_PARTNER);
    expect(legalScopeForLocation("/collective/dashboard")).toBe(LEGAL_SCOPE_COLLECTIVE);
  });
});

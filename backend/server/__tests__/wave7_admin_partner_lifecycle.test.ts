/**
 * WAVE 7 AD-1 / AD-2 / AD-4 proving tests.
 *
 * AD-1 is "twelve engines with no route into the UI". The interesting
 * assertions are therefore about REACHABILITY, not about the endpoints'
 * internals (which already had coverage before this wave). Each test below
 * either proves a path exists on the router, or proves the CLIENT actually
 * calls it — because the failure mode this wave guards against is a fix placed
 * where data does not flow.
 */
import { describe, it, expect } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { registerAdminPartnerLifecycleRoutes } from "../adminPartnerLifecycleRoutes";

const CLIENT = join(process.cwd(), "client", "src");
const PANEL = join(CLIENT, "components", "admin", "PartnerLifecyclePanel.tsx");
const DETAIL = join(CLIENT, "pages", "admin", "PartnerDetail.tsx");

function routePaths(app: express.Express): string[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyApp = app as any;
  const stack = anyApp.router?.stack ?? anyApp._router?.stack ?? [];
  if (stack.length === 0) throw new Error("could not read the Express route stack");
  return stack
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((l: any) => l.route)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .flatMap((l: any) =>
      Object.keys(l.route.methods).map((m) => `${m.toUpperCase()} ${l.route.path}`),
    );
}

const panelSrc = readFileSync(PANEL, "utf8");

describe("AD-1 — the twelve lifecycle engines now have a client call site", () => {
  const required: Array<[string, string]> = [
    ["promote-tier", "partnerRoutes.ts:410"],
    ["/suspend", "partnerRoutes.ts:434"],
    ["/reactivate", "partnerRoutes.ts:459"],
    ["/archive", "partnerRoutes.ts:478"],
    ["/attributions", "partnerRoutes.ts:592"],
    ["seat-report", "partnerRoutes.ts:207"],
  ];
  for (const [needle, cite] of required) {
    it(`the panel calls ${needle} (engine at ${cite})`, () => {
      expect(panelSrc).toContain(needle);
    });
  }

  it("the panel is actually MOUNTED — an unmounted component is the same as no route", () => {
    const detail = readFileSync(DETAIL, "utf8");
    expect(detail).toContain('from "@/components/admin/PartnerLifecyclePanel"');
    /* Imported AND rendered. Importing without rendering is one of the six
       "placed where data does not flow" shapes this project has already hit. */
    expect(detail).toMatch(/<PartnerLifecyclePanel\b/);
  });

  it("the promote-tier control offers exactly the five tiers the server accepts", () => {
    /* partnerRoutes.ts:412 validTiers. A sixth option in the UI would 400; a
       missing one would make a real tier unreachable. */
    for (const t of ["catalyst", "builder", "amplifier", "nexus", "founding_member"]) {
      expect(panelSrc).toContain(`"${t}"`);
    }
    /* X-C3 cross-check: the retired `partner_enterprise` alias must not appear
       in any admin-facing tier picker. */
    expect(panelSrc).not.toContain("partner_enterprise");
  });

  it("the attribution source picker matches ATTRIBUTION_SOURCES (the 0114 CHECK set)", () => {
    for (const s of ["admin_manual", "referral_code", "partner_claim", "partner_portfolio"]) {
      expect(panelSrc).toContain(`"${s}"`);
    }
  });
});

describe("AD-2 — the attribution DELETE call site supplies :companyId", () => {
  it("builds a two-segment DELETE URL, not the collection path", () => {
    /* This is the whole of AD-2. A DELETE to
       /api/admin/partners/:id/attributions (no companyId) matches no route and
       fails silently from the admin's point of view. */
    /* Capture the whole backtick template that follows the "DELETE" argument.
       A lazy match up to the first ")" stops inside encodeURIComponent(...),
       which would make this assertion pass or fail for the wrong reason. */
    const m = panelSrc.match(/apiRequest\(\s*\n?\s*"DELETE",\s*\n?\s*`([^`]+)`/);
    expect(m, "no DELETE call site found in the panel").not.toBeNull();
    const url = m![1];
    expect(url).toContain("attributions/");
    expect(url).toContain("companyId");
    /* Both segments encoded — a company id with a slash would otherwise forge
       a different route. */
    expect(url).toContain("encodeURIComponent(companyId)");
  });

  it("revoked rows stay rendered rather than vanishing", () => {
    /* Standing rule: never silently drop anything from the UI. */
    expect(panelSrc).toContain("revokedAt");
    expect(panelSrc).toContain("line-through");
  });
});

describe("AD-1 / AD-4 — the new read + metrics routes are registered", () => {
  const app = express();
  app.use(express.json());
  registerAdminPartnerLifecycleRoutes(app);
  const paths = routePaths(app);

  it("exposes the attribution read the DELETE button renders from", () => {
    expect(paths).toContain("GET /api/admin/partners/:id/attributions");
  });

  it("exposes the per-partner seat report", () => {
    expect(paths).toContain("GET /api/admin/partners/:id/seat-report");
  });

  it("exposes the AD-4 funnel metrics", () => {
    expect(paths).toContain("GET /api/admin/partners/metrics/funnel");
  });

  it("registers NO roster route — GET /api/admin/partners already exists elsewhere", () => {
    /* Second-path check, mechanised. partnerFeeAdminRoutes.ts:200 owns that
       path and is registered LATER in routes.ts (~:1280 vs ~:965), so a roster
       route here would have shadowed the real, filtered one. */
    expect(paths).not.toContain("GET /api/admin/partners");
  });

  it("registers NO write route — partner lifecycle keeps exactly one writer", () => {
    const writes = paths.filter((p) => !p.startsWith("GET "));
    expect(writes, `unexpected writer added by AD-1: ${writes.join(", ")}`).toEqual([]);
  });
});

describe("AD-1 — the copy that promised this surface is now true", () => {
  it("AdminFeesConsolidated still points at the partner detail page for promotion", () => {
    const fees = readFileSync(join(CLIENT, "pages", "admin", "AdminFeesConsolidated.tsx"), "utf8");
    /* Before this wave this sentence was the ONLY match for "promote-tier" in
       the whole client: a claim with no surface behind it. It is left in place
       precisely because it is now accurate; if a later wave removes the panel
       this test fails and the stale promise is caught. */
    /* WAVE 85 — STALE COPY PIN, RE-POINTED AT THE SURFACE INSTEAD OF AT THE PROSE.
       Wave 83 removed the endpoint path from this admin caption. Both strings, verbatim
       (`build_log/wave83/w83_copy_edits_partner_admin.py`, AF:1211):
         OLD: "A partner is 'promoted' onto one of these tiers via POST /api/admin/partners/:id/promote-tier from the partner detail page"
         NEW: "A partner is 'promoted' onto one of these tiers from the partner detail page"
       THIS TEST'S OWN STATED TRIGGER DID NOT OCCUR. It exists to catch a later wave
       REMOVING THE PANEL and leaving a stale promise behind. The panel is fully intact:
       `client/src/components/admin/PartnerLifecyclePanel.tsx:157` still POSTs
       `/api/admin/partners/${partnerId}/promote-tier`, and `server/partnerRoutes.ts:434`
       still serves it. So the promise is still TRUE — only the copy stopped quoting an
       HTTP route at an admin on a screenshared page.
       The assertion is therefore re-pointed at the thing that must not disappear (the
       working surface) rather than at the sentence that describes it. The caption is
       still checked for the words a human navigates by. */
    expect(fees).toContain("partner detail page");
    const panel = readFileSync(
      join(CLIENT, "components", "admin", "PartnerLifecyclePanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("/promote-tier");
    expect(panel).toContain('data-testid="button-promote-tier"');
  });
});

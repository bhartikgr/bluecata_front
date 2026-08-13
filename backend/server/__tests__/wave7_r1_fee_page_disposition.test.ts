/**
 * WAVE 7 R-1 + RS-3 proving tests.
 *
 * R-1 wants each of the thirteen retired admin fee pages dispositioned
 * individually. The disposition is COMPUTED (scripts/wave7_r1_fee_page_-
 * disposition.mjs), and this file re-derives the same evidence inside the test
 * run so the ruling in App.tsx cannot drift away from the tree.
 *
 * RS-3 is the narrow claim that App.tsx's comment said thirteen page components
 * were deleted while all thirteen were on disk. The fix is a corrected comment;
 * the test is that the comment can never re-acquire the false claim while the
 * files are still there.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const CLIENT = join(ROOT, "client", "src");
const ADMIN = join(CLIENT, "pages", "admin");
const APP = readFileSync(join(CLIENT, "App.tsx"), "utf8");

const RETIRED = [
  "FeeHub",
  "Payments",
  "PartnerFeeSchedules",
  "AdminApplicationFee",
  "AdminPlatformFees",
  "CollectiveSubscriptions",
  "AdminCommissionRates",
  "PartnerPL",
  "CollectivePaymentSchedules",
  "CollectivePaymentPL",
  "Pricing",
  "PricingModels",
  "PricingModelDetail",
];

/** Re-routed by R-1 — the five that are the sole caller of a write endpoint. */
const REROUTED = [
  "CollectiveSubscriptions",
  "AdminCommissionRates",
  "Pricing",
  "PricingModels",
  "PricingModelDetail",
];

/** Descoped by R-1 — six redundant, plus two held back by a settled ruling. */
const DESCOPED = RETIRED.filter((n) => !REROUTED.includes(n));

function endpoints(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/["'`](\/api\/[^"'`\s]*)["'`]/g)) {
    out.add(
      m[1]
        .replace(/\$\{[^}]*\}/g, "*")
        .replace(/\/:[A-Za-z0-9_]+/g, "/*")
        .replace(/\?.*$/, ""),
    );
  }
  return out;
}

describe("RS-3 (DEF-054) — the 'deleted' comment was false and is corrected", () => {
  it("all thirteen page components really are still on disk", () => {
    const missing = RETIRED.filter((n) => !existsSync(join(ADMIN, `${n}.tsx`)));
    expect(missing, `these are gone, so the comment would now be true: ${missing}`).toEqual([]);
  });

  it("App.tsx no longer claims the page components were deleted", () => {
    /* The exact false phrasing that stood at App.tsx:131-142. */
    expect(APP).not.toContain("are deleted along with the page\n   components");
    expect(APP).not.toMatch(/deleted along with the page/);
  });

  it("App.tsx records the correction rather than silently rewriting history", () => {
    expect(APP).toContain("RS-3");
    expect(APP).toContain("DEF-054");
  });
});

describe("R-1 — every one of the thirteen is dispositioned, individually", () => {
  /* Reachability over the whole client tree EXCLUDING the thirteen: an endpoint
     only counts as lost if nothing else can reach it. */
  const retiredPaths = new Set(RETIRED.map((n) => join(ADMIN, `${n}.tsx`)));
  const reachable = new Set<string>();
  (function walk(dir: string) {
    for (const e of readdirSync(dir)) {
      const q = join(dir, e);
      if (statSync(q).isDirectory()) walk(q);
      else if ((q.endsWith(".tsx") || q.endsWith(".ts")) && !retiredPaths.has(q)) {
        for (const ep of endpoints(readFileSync(q, "utf8"))) reachable.add(ep);
      }
    }
  })(CLIENT);

  it("the six redundant pages really are redundant — zero unreachable endpoints", () => {
    const redundant = [
      "FeeHub",
      "Payments",
      "PartnerFeeSchedules",
      "PartnerPL",
      "CollectivePaymentSchedules",
      "CollectivePaymentPL",
    ];
    for (const name of redundant) {
      const eps = [...endpoints(readFileSync(join(ADMIN, `${name}.tsx`), "utf8"))];
      const orphaned = eps.filter((e) => !reachable.has(e));
      expect(
        orphaned,
        `${name} was descoped as redundant but is the sole caller of: ${orphaned.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("each re-routed page has a Route AND is rendered", () => {
    for (const name of REROUTED) {
      /* Pricing.tsx is imported as AdminPricing to avoid colliding with the
         PricingModels import; accept either component name. */
      const rendered = new RegExp(`<(Admin)?${name}\\s*/>`).test(APP);
      expect(rendered, `${name} is re-routed in the ruling but never rendered`).toBe(true);
    }
  });

  it("the two settled-ruling descopes are NOT re-routed", () => {
    /* AdminApplicationFee / AdminPlatformFees write display dollars into
       collective_application_fee_config; D2.5 deleted that editor on purpose so
       platform_fees['collective_application_fee'] has exactly one writer, in
       true minor units. Re-routing them would restore a second writer in the
       wrong unit. */
    for (const name of ["AdminApplicationFee", "AdminPlatformFees"]) {
      expect(new RegExp(`<${name}\\s*/>`).test(APP), `${name} must stay unrouted`).toBe(false);
      expect(APP).not.toContain(`@/pages/admin/${name}"`);
    }
    /* …and the reason is written down, not folklore. */
    expect(APP).toContain("collective_application_fee_config");
  });

  it("descoped pages are NOT routed and re-routed pages are — the sets are disjoint", () => {
    for (const name of DESCOPED) {
      if (name === "Pricing") continue; // not in DESCOPED, guard against edits
      const rendered = new RegExp(`<(Admin)?${name}\\s*/>`).test(APP);
      expect(rendered, `${name} is descoped but rendered`).toBe(false);
    }
    expect(new Set([...REROUTED, ...DESCOPED]).size).toBe(13);
  });

  it("AdminCommissionRates is genuinely the only editor of partner commission rates", () => {
    /* /admin/fees READS the rates and says so; it does not write them
       (AdminFeesConsolidated.tsx:1140 — "editor lands with the partner-override
       component"). This is the concrete capability R-1 recovers. */
    const consolidated = readFileSync(join(ADMIN, "AdminFeesConsolidated.tsx"), "utf8");
    expect(consolidated).toContain("/api/admin/partner/commission-rates");
    expect(consolidated).not.toMatch(
      /apiRequest\(\s*"(PUT|POST|PATCH)",\s*`?\/api\/admin\/partner\/commission-rates/,
    );
    const editor = readFileSync(join(ADMIN, "AdminCommissionRates.tsx"), "utf8");
    expect(editor).toMatch(/apiRequest\(\s*"PUT",\s*`\/api\/admin\/partner\/commission-rates/);
  });

  it("the /admin/:rest* catch-all still comes after the restored routes", () => {
    /* wouter matches in order; a restored route below the catch-all is a route
       that does not exist. */
    const catchAll = APP.indexOf('path="/admin/:rest*"');
    expect(catchAll, "catch-all not found").toBeGreaterThan(-1);
    for (const p of [
      "/admin/collective-subscriptions",
      "/admin/commission-rates",
      "/admin/pricing-models/:id",
      "/admin/pricing-models",
      "/admin/pricing",
    ]) {
      const at = APP.indexOf(`path="${p}"`);
      expect(at, `route ${p} missing`).toBeGreaterThan(-1);
      expect(at, `route ${p} is below the /admin catch-all and is unreachable`).toBeLessThan(catchAll);
    }
  });

  it("the pricing-models detail route precedes the list route", () => {
    expect(APP.indexOf('path="/admin/pricing-models/:id"')).toBeLessThan(
      APP.indexOf('path="/admin/pricing-models"'),
    );
  });

  it("every restored route has a nav entry — a route with no link is not shipped", () => {
    const shell = readFileSync(join(CLIENT, "components", "AppShell.tsx"), "utf8");
    for (const href of [
      "/admin/collective-subscriptions",
      "/admin/commission-rates",
      "/admin/pricing",
      "/admin/pricing-models",
    ]) {
      expect(shell, `no nav entry for ${href}`).toContain(`href: "${href}"`);
    }
  });
});

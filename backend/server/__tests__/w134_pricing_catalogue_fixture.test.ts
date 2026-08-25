/**
 * WAVE 134 · CAUSE 2 — proof that the admin-set pricing chain is REAL, and that
 * the fixture that feeds it can never become a compiled-in price.
 *
 * Cause 2 of build_log/wave133/FAILURE_TRIAGE_v26_23_0.md: v25.27 removed the
 * source-baked pricing seed on purpose (R95/R96 — pricing is admin-set and
 * database-driven). ~24 tests still asserted the seed's numbers. Per R98 those
 * tests are re-based onto `_fixtures/pricingCatalogueFixture.ts`, which authors
 * tiers through the production write path instead.
 *
 * A re-based test is only as strong as the claim it makes, so this file pins the
 * three claims that make the re-basing legitimate:
 *
 *   §1 FRESH INSTALL REFUSES. With nothing published, the surfaces are EMPTY and
 *      the billing resolver THROWS — they do not fall back to a compiled amount.
 *      (This is strictly stronger than the deleted "there is one $840 tier"
 *      assertion, which could not distinguish "admin published $840" from
 *      "$840 is baked into the source".)
 *   §2 ROUND TRIP. What the admin publishes is what every surface reports, and
 *      when the admin re-publishes a DIFFERENT amount the surfaces follow.
 *   §3 THE FIXTURE STAYS IN THE TEST TREE. No file outside server/__tests__ may
 *      import the fixture, so its amounts cannot leak into product code — and it
 *      contains no fallback amount of its own.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  authorPricingTier,
  authorFounderCatalogue,
  authoredTier,
  clearAuthoredPricingTiers,
  FIXTURE_ANNUAL_MINOR,
  FIXTURE_PRICING_ADMIN,
} from "./_fixtures/pricingCatalogueFixture";
import { PRICING_TIERS } from "../adminPricingStore";
import { listModels, updateModel } from "../pricingModelStore";
import { PLAN_PRICES, getPlanPriceStrict, TierNotConfiguredError } from "../subscriptionsStore";

const ROOT = path.resolve(__dirname, "..", "..");

beforeEach(() => {
  clearAuthoredPricingTiers();
});

/* ── §1 a fresh install refuses; it does not invent a price ───────────────── */
describe("WAVE 134 §1 — nothing published means nothing quoted", () => {
  it("PRICING_TIERS is empty when no admin has published a founder tier", () => {
    expect(listModels().length).toBe(0);
    expect(PRICING_TIERS.length).toBe(0);
    expect(PRICING_TIERS[0]).toBeUndefined();
  });

  it("PLAN_PRICES reports undefined — never a fallback amount", () => {
    expect(PLAN_PRICES.founder_pro).toBeUndefined();
    expect(PLAN_PRICES.founder_free).toBeUndefined();
    expect(PLAN_PRICES.founder_scale).toBeUndefined();
    expect(PLAN_PRICES.founder_enterprise).toBeUndefined();
  });

  it("the billing resolver THROWS TierNotConfiguredError rather than charging", () => {
    expect(() => getPlanPriceStrict("founder_pro")).toThrow(TierNotConfiguredError);
  });

  it("a DRAFT tier is still not quotable — publishing is what makes a price real", () => {
    authorPricingTier({ slug: "founder-pro", annualMinor: FIXTURE_ANNUAL_MINOR["founder-pro"], status: "draft" });
    expect(listModels().length).toBe(1);
    expect(PRICING_TIERS.length).toBe(0);
    expect(PLAN_PRICES.founder_pro).toBeUndefined();
    expect(() => getPlanPriceStrict("founder_pro")).toThrow(TierNotConfiguredError);
  });
});

/* ── §2 the round trip: the surface echoes the admin, and follows an edit ─── */
describe("WAVE 134 §2 — every surface reports what the admin published", () => {
  it("a published tier reaches PRICING_TIERS and PLAN_PRICES with the authored amount", () => {
    const published = authorFounderCatalogue();
    const pro = published["founder-pro"]!;

    expect(pro.status).toBe("live");
    expect(pro.createdBy).toBe(FIXTURE_PRICING_ADMIN);
    expect(pro.basePriceMinor).toBe(FIXTURE_ANNUAL_MINOR["founder-pro"]);

    const planPrice = PLAN_PRICES.founder_pro;
    expect(planPrice).toBeDefined();
    expect(planPrice!.annualMinor).toBe(pro.basePriceMinor);
    expect(planPrice!.currency).toBe("USD");

    const tier = PRICING_TIERS.find((t) => t.id === pro.id);
    expect(tier, "the display adapter must expose the published model").toBeDefined();
    expect(tier!.annualMinor).toBe(pro.basePriceMinor);
    expect(tier!.annualPriceCents).toBe(pro.basePriceMinor);
    expect(tier!.billingCycle).toBe("annual");
  });

  it("a CONFIGURED free tier is distinguishable from an unconfigured one", () => {
    authorFounderCatalogue();
    /* 0 is a real published price; `undefined` is "no tier". Both must be
       reachable, because subscriptionsStore.ts:630-635 branches on exactly
       this distinction. */
    expect(PLAN_PRICES.founder_free).toBeDefined();
    expect(PLAN_PRICES.founder_free!.annualMinor).toBe(0);
    expect(getPlanPriceStrict("founder_free").annualMinor).toBe(0);
  });

  it("re-publishing a DIFFERENT amount moves every surface — no compiled-in number survives", () => {
    const first = authorPricingTier({ slug: "founder-pro", name: "Founder Pro", annualMinor: 31_500 });
    expect(PLAN_PRICES.founder_pro!.annualMinor).toBe(31_500);
    expect(PRICING_TIERS.find((t) => t.id === first.id)!.annualMinor).toBe(31_500);

    /* The admin edits the price in /admin/fees. */
    const edited = updateModel(
      first.id,
      { basePriceMinor: 47_250, cadenceOptions: [{ cadence: "annual", priceMinor: 47_250 }] },
      FIXTURE_PRICING_ADMIN,
    );
    expect(edited.ok).toBe(true);

    expect(PLAN_PRICES.founder_pro!.annualMinor).toBe(47_250);
    expect(PRICING_TIERS.find((t) => t.id === first.id)!.annualMinor).toBe(47_250);
    expect(getPlanPriceStrict("founder_pro").annualMinor).toBe(47_250);
    expect(authoredTier("founder-pro").version).toBeGreaterThan(first.version);
  });

  it("the fixture REFUSES to seat a tier it cannot seat (no silent $0 tier)", () => {
    authorPricingTier({ slug: "founder-pro", annualMinor: 12_345 });
    /* Same slug twice — the production store refuses, so the fixture must throw
       rather than hand a test a stale row and let it assert on nothing. */
    expect(() => authorPricingTier({ slug: "founder-pro", annualMinor: 999 })).toThrow(/already in use/i);
    /* And a non-integer / negative amount is rejected before it reaches money code. */
    expect(() => authorPricingTier({ slug: "founder-x", annualMinor: -1 })).toThrow(/minor units/i);
    expect(() => authorPricingTier({ slug: "founder-y", annualMinor: 12.5 })).toThrow(/minor units/i);
    expect(authoredTier("founder-pro").basePriceMinor).toBe(12_345);
  });
});

/* ── §3 the fixture can never become a product price (R95) ────────────────── */
describe("WAVE 134 §3 — the pricing fixture stays inside the test tree", () => {
  const FIXTURE_REL = "server/__tests__/_fixtures/pricingCatalogueFixture";

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist" || e.name === "build") continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it("no file outside server/__tests__ imports the pricing fixture", () => {
    const offenders: string[] = [];
    for (const dir of ["server", "client", "shared", "scripts", "packages"]) {
      const abs = path.join(ROOT, dir);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        const rel = path.relative(ROOT, file);
        if (rel.startsWith(path.join("server", "__tests__"))) continue;
        const src = fs.readFileSync(file, "utf8");
        if (src.includes("pricingCatalogueFixture")) offenders.push(rel);
      }
    }
    expect(
      offenders,
      `a fixture price must never be reachable from product code:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the fixture itself contains no fallback price (no `?? <number>` on an amount)", () => {
    const src = fs.readFileSync(path.join(ROOT, `${FIXTURE_REL}.ts`), "utf8");
    /* Strip comments first — WAVE 129's lesson: a fence that reads comments is a
       fence that lies. The prose in this fixture names amounts on purpose. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
    const fallbacks = code.match(/\?\?\s*[\d_]+/g) ?? [];
    expect(fallbacks, `fallback amount(s) found: ${fallbacks.join(", ")}`).toEqual([]);
    /* And no float/parse coercion on money anywhere in the fixture. */
    expect(/\b(parseInt|parseFloat|Number)\s*\(/.test(code)).toBe(false);
  });
});

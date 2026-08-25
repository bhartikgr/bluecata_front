/**
 * v19 Wave A / Change 2 — Founder Single-Plan integration test.
 *
 * Spec (V19_BUILD_BRIEF, Change 2):
 *   • GET /api/admin/pricing-tiers returns exactly the published founder tier
 *   • the tier is displayed at the price the admin set, billed annually
 *   • all features included EXCEPT collective + consortium
 *   • admin can still POST/PATCH /api/admin/pricing-models (regression)
 *
 * Math-sacred zones are NOT touched. This test only exercises the display +
 * pricing-models admin surfaces.
 *
 * WAVE 134 cause 1-of-3 (R98) — WHY THIS FILE CHANGED
 * --------------------------------------------------
 * The old assertions were `res.body.length === 1`, `res.body[0].id ===
 * "founder_capavate_annual"` and `tier.annualUsd === 840` with NOTHING in the
 * test creating a tier: they depended on the pricing seed that v25.27 deleted on
 * purpose (`pricingModelStore.ts:160-181` — "NO SEED. Admin is the source of
 * truth."), because R95/R96 make pricing admin-set and database-driven. A test
 * that 200s with an empty body before it reaches its assertions is not testing
 * the founder pricing surface at all, so per R98 the fixture is what changes.
 *
 * Equal-or-stronger: the tier is now PUBLISHED BY THE FIXTURE (through the
 * production createModel → promoteModel path) and the endpoint is asserted to
 * echo that exact amount; the source-baked id `founder_capavate_annual` is
 * replaced by the store-minted id of the row the admin authored; the empty-state
 * case is pinned as its own test; and the PATCH regression now additionally
 * asserts the edit PERSISTED into the store — which is the very defect v25.27
 * fixed (the old PATCH mutated a RAM object and reverted on restart), and which
 * the old test's `finally { PRICING_TIERS[0]!.annualUsd = saved }` could not see
 * because PRICING_TIERS is a read-through proxy and that write went nowhere.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";

import { registerAdminPricingRoutes, PRICING_TIERS } from "../adminPricingStore";
import { registerPricingModelRoutes, getModel } from "../pricingModelStore";
import {
  authorPricingTier,
  clearAuthoredPricingTiers,
  CAPAVATE_CORE_FEATURE_KEYS,
  CAPAVATE_EXCLUDED_FEATURE_KEYS,
} from "./_fixtures/pricingCatalogueFixture";

let app: Express;

/* What the admin types, integer minor units, with its USD major-unit twin. */
const ADMIN_SET_ANNUAL_MINOR = 84_000;
const ADMIN_SET_ANNUAL_USD = 840;
const ADMIN_SET_MONTHLY_USD = 70; // 840 / 12 — display-only derivation

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerAdminPricingRoutes(app);
  registerPricingModelRoutes(app);
});

beforeEach(() => {
  clearAuthoredPricingTiers();
});

/** Publish the single Capavate tier the way an admin does, and return the row. */
function publishSingleTier() {
  return authorPricingTier({
    slug: "capavate-annual",
    name: "Capavate Annual",
    annualMinor: ADMIN_SET_ANNUAL_MINOR,
  });
}

describe("Founder Single-Plan (v19 Wave A / Change 2)", () => {
  it("GET /api/admin/pricing-tiers returns an EMPTY list before anything is published", async () => {
    const res = await request(app).get("/api/admin/pricing-tiers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it("GET /api/admin/pricing-tiers returns exactly 1 tier once the admin publishes one", async () => {
    const published = publishSingleTier();
    const res = await request(app).get("/api/admin/pricing-tiers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(published.id);
  });

  it("the single tier is displayed at the price the admin set, per year", async () => {
    publishSingleTier();
    const res = await request(app).get("/api/admin/pricing-tiers");
    const tier = res.body[0];
    expect(tier.annualUsd).toBe(ADMIN_SET_ANNUAL_USD);
    expect(tier.annualPriceCents).toBe(ADMIN_SET_ANNUAL_MINOR);
    expect(tier.annualMinor).toBe(ADMIN_SET_ANNUAL_MINOR);
    expect(tier.currency).toBe("USD");
    expect(tier.billingCycle).toBe("annual");
    expect(String(tier.displayPrice)).toMatch(new RegExp(String(ADMIN_SET_ANNUAL_USD)));
    expect(String(tier.displayPrice)).toMatch(/year/i);
    expect(tier.monthlyUsd).toBe(ADMIN_SET_MONTHLY_USD);
  });

  it("all standard Capavate features are INCLUDED on the tier", async () => {
    publishSingleTier();
    const res = await request(app).get("/api/admin/pricing-tiers");
    const tier = res.body[0];
    for (const key of CAPAVATE_CORE_FEATURE_KEYS) {
      const f = tier.features.find((x: { key: string }) => x.key === key);
      expect(f, `expected feature ${key}`).toBeDefined();
      expect(f.included, `feature ${key} must be included`).toBe(true);
    }
  });

  it("Collective and Consortium are EXPLICITLY excluded", async () => {
    publishSingleTier();
    const res = await request(app).get("/api/admin/pricing-tiers");
    const tier = res.body[0];
    for (const key of CAPAVATE_EXCLUDED_FEATURE_KEYS) {
      const f = tier.features.find((x: { key: string }) => x.key === key);
      expect(f, `expected feature ${key} to be declared`).toBeDefined();
      expect(f.included, `${key} must be excluded`).toBe(false);
    }
  });

  it("PRICING_TIERS source export matches API surface", async () => {
    const published = publishSingleTier();
    expect(PRICING_TIERS.length).toBe(1);
    expect(PRICING_TIERS[0]!.id).toBe(published.id);
    const res = await request(app).get("/api/admin/pricing-tiers");
    expect(res.body[0].id).toBe(PRICING_TIERS[0]!.id);
    expect(res.body[0].annualPriceCents).toBe(PRICING_TIERS[0]!.annualPriceCents);
  });

  it("admin pricing-models POST endpoint still works (regression)", async () => {
    const res = await request(app)
      .post("/api/admin/pricing-models")
      .send({
        id: "pm_v19_change2_smoke",
        name: "v19 Change 2 Smoke",
        version: 1,
        status: "draft",
        currency: "USD",
        components: [],
      });
    // Endpoint must respond (200/201 = success, 400/409 = validation/dup,
    // but never 404/500 — we are only checking the surface is wired).
    expect([200, 201, 400, 409]).toContain(res.status);
  });

  it("admin pricing-models GET list endpoint still works (regression)", async () => {
    const res = await request(app).get("/api/admin/pricing-models");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body) || typeof res.body === "object").toBe(true);
  });

  it("PATCH /api/admin/pricing-tiers/:id updates the tier price AND persists it", async () => {
    const published = publishSingleTier();
    const res = await request(app)
      .patch(`/api/admin/pricing-tiers/${published.id}`)
      .send({ annualUsd: 999 });
    expect(res.status).toBe(200);
    expect(res.body.annualUsd).toBe(999);
    expect(res.body.annualPriceCents).toBe(99_900);

    /* WAVE 134 (R98) — the addition that matters: the edit must land in the
       durable store, not in a RAM copy. This is precisely the v25.27 defect
       ("every admin edit reverted to $840 on restart"), and the old test could
       not detect it. */
    const stored = getModel(published.id);
    expect(stored!.basePriceMinor).toBe(99_900);
    expect(stored!.version).toBeGreaterThan(published.version);
    expect(PRICING_TIERS[0]!.annualPriceCents).toBe(99_900);
  });
});

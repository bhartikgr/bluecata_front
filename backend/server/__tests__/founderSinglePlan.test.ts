/**
 * v19 Wave A / Change 2 — Founder Single-Plan integration test.
 *
 * Spec (V19_BUILD_BRIEF, Change 2):
 *   • GET /api/admin/pricing-tiers returns exactly 1 active tier
 *   • Tier has price \$840/year displayed
 *   • All features included EXCEPT collective + consortium
 *   • Admin can still POST/PATCH /api/admin/pricing-models (regression)
 *
 * Math-sacred zones are NOT touched. This test only exercises the display +
 * pricing-models admin surfaces.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";

import { registerAdminPricingRoutes, PRICING_TIERS } from "../adminPricingStore";
import { registerPricingModelRoutes } from "../pricingModelStore";

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerAdminPricingRoutes(app);
  registerPricingModelRoutes(app);
});

describe("Founder Single-Plan (v19 Wave A / Change 2)", () => {
  it("GET /api/admin/pricing-tiers returns exactly 1 tier", async () => {
    const res = await request(app).get("/api/admin/pricing-tiers");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe("founder_capavate_annual");
  });

  it("the single tier is priced at \\$840/year for display", async () => {
    const res = await request(app).get("/api/admin/pricing-tiers");
    const tier = res.body[0];
    expect(tier.annualUsd).toBe(840);
    expect(tier.annualPriceCents).toBe(84_000);
    expect(tier.billingCycle).toBe("annual");
    expect(String(tier.displayPrice)).toMatch(/840/);
    expect(String(tier.displayPrice)).toMatch(/year/i);
    // Display monthly equivalent: 840 / 12 = 70
    expect(tier.monthlyUsd).toBe(70);
  });

  it("all standard Capavate features are INCLUDED on the tier", async () => {
    const res = await request(app).get("/api/admin/pricing-tiers");
    const tier = res.body[0];
    const required = [
      "cap_table",
      "rounds",
      "data_room",
      "investors_crm",
      "documents",
      "esop",
      "communications",
      "audit_chain",
      "compliance",
      "support",
    ];
    for (const key of required) {
      const f = tier.features.find((x: { key: string }) => x.key === key);
      expect(f, `expected feature ${key}`).toBeDefined();
      expect(f.included, `feature ${key} must be included`).toBe(true);
    }
  });

  it("Collective and Consortium are EXPLICITLY excluded", async () => {
    const res = await request(app).get("/api/admin/pricing-tiers");
    const tier = res.body[0];
    const collective = tier.features.find((f: { key: string }) => f.key === "collective");
    const consortium = tier.features.find((f: { key: string }) => f.key === "consortium");
    expect(collective).toBeDefined();
    expect(consortium).toBeDefined();
    expect(collective.included).toBe(false);
    expect(consortium.included).toBe(false);
  });

  it("PRICING_TIERS source export matches API surface", () => {
    expect(PRICING_TIERS.length).toBe(1);
    expect(PRICING_TIERS[0]!.id).toBe("founder_capavate_annual");
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

  it("PATCH /api/admin/pricing-tiers/:id can update the single tier price (regression)", async () => {
    // Save current values so we restore after the test.
    const before = PRICING_TIERS[0]!;
    const savedAnnualUsd = before.annualUsd;
    const savedAnnualCents = before.annualPriceCents;
    try {
      const res = await request(app)
        .patch(`/api/admin/pricing-tiers/${before.id}`)
        .send({ annualUsd: 999 });
      expect(res.status).toBe(200);
      expect(res.body.annualUsd).toBe(999);
      expect(res.body.annualPriceCents).toBe(99_900);
    } finally {
      // Restore.
      PRICING_TIERS[0]!.annualUsd = savedAnnualUsd;
      PRICING_TIERS[0]!.annualPriceCents = savedAnnualCents;
    }
  });
});

/**
 * WAVE 35 · F1 / F2 — the pricing NUMBERS, executed against the real endpoints.
 *
 * WHAT WAVE 34 GOT WRONG
 * ----------------------
 * Wave 34 fixed the currency-aware `displayPrice` STRING in two object
 * literals and, in the SAME literals, classified the sibling NUMBERS
 *
 *   server/adminPlatformStore.ts:2266   usdMonthly: Math.round(monthlyMinor / 100)
 *   server/adminPricingStore.ts:59-60   monthlyUsd / annualUsd: Math.round(minor / 100)
 *
 * as "USD by contract" (category 3) and left them alone. Review A falsified
 * that by execution: the very same `m.currency` that the fixed string reads is
 * sitting two lines above, and a ¥1,200,000/year tier was served to founders as
 * `annualUsd: 12000` and rendered `$12,000` — 100× understated AND relabelled
 * into the wrong currency.
 *
 * WHY THE PRE-EXISTING TESTS DID NOT CATCH IT
 * -------------------------------------------
 * `wave34_money_exponent_pricing_surfaces.test.ts` asserted only on
 * `displayPrice`, and its S1 case re-implemented the builder in the test body
 * instead of calling the endpoint (F10a). This file asserts on the EMITTED
 * JSON of the real HTTP routes, never on a re-implementation.
 *
 * BOTH POLES EVERYWHERE
 * ---------------------
 *   JPY pole (exponent 0) — pins the fix.
 *   USD pole (exponent 2) — pins that a real conversion still happens, so a
 *                           "delete the division" over-fix cannot pass.
 * Plus a KRW pole to prove the exponent is table-driven, not a JPY special case.
 *
 * RULES: preconditions are established here (this file creates its own pricing
 * models); `process.env` is never consulted; imports are static.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

vi.mock("../lib/authMiddleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import * as pricingModel from "../pricingModelStore";
import { registerAdminPricingRoutes } from "../adminPricingStore";
import { registerAdminPlatformRoutes } from "../adminPlatformStore";
import { currencyExponent, fromMinor } from "../lib/currency";

/** The SAME integer minor price in every currency under test.
 *  exponent 0 → 1,200,000 major.  exponent 2 → 12,000 major. */
const ANNUAL_MINOR = 1_200_000;
const MONTHLY_MINOR = 100_000;

function makeTier(slug: string, currency: string): pricingModel.PricingModel {
  const res = pricingModel.createModel(
    {
      productLine: "founder",
      slug,
      name: `w35 ${slug}`,
      description: "wave35 F1/F2 fixture",
      status: "live",
      currency,
      basePriceMinor: ANNUAL_MINOR,
      cadence: "annual",
      cadenceOptions: [
        { cadence: "annual", priceMinor: ANNUAL_MINOR },
        { cadence: "monthly", priceMinor: MONTHLY_MINOR },
      ],
      currencyOverrides: [],
      regionalMultipliers: [],
      features: [],
      metering: [],
      volumeBrackets: [],
      discountCodes: [],
      trial: null,
      effectiveFrom: null,
      effectiveTo: null,
      grandfatherOnChange: false,
      taxInclusive: false,
    } as unknown as pricingModel.CreateModelInput,
    "w35-test",
  );
  if (!res.ok) throw new Error(`fixture model creation failed: ${res.error}`);
  return res.model;
}

type EmittedTier = {
  id: string;
  currency?: string;
  usdMonthly?: number | null;
  monthlyUsd?: number | null;
  annualUsd?: number | null;
  monthlyMinor?: number;
  annualMinor?: number;
  displayPrice?: string;
};

let app: Express;
let jpy: pricingModel.PricingModel;
let usd: pricingModel.PricingModel;
let krw: pricingModel.PricingModel;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerAdminPricingRoutes(app);
  registerAdminPlatformRoutes(app);

  jpy = makeTier("w35-f2-jpy", "JPY");
  usd = makeTier("w35-f2-usd", "USD");
  krw = makeTier("w35-f2-krw", "KRW");
});

const find = (rows: EmittedTier[], id: string) => rows.find((t) => t.id === id);

/* ── (P) PRECONDITIONS ───────────────────────────────────────────────────── */

describe("W35-P — preconditions this file depends on", () => {
  it("P1 the ISO-4217 exponents", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KRW")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
    expect(fromMinor(ANNUAL_MINOR, "JPY")).toBe(1_200_000);
    expect(fromMinor(ANNUAL_MINOR, "USD")).toBe(12_000);
  });

  it("P2 the fixtures really are live founder models carrying their own currency", () => {
    const live = pricingModel.listModels({ productLine: "founder", status: "live" });
    expect(live.find((m) => m.id === jpy.id)?.currency).toBe("JPY");
    expect(live.find((m) => m.id === usd.id)?.currency).toBe("USD");
    expect(live.find((m) => m.id === krw.id)?.currency).toBe("KRW");
  });
});

/* ── (A) F2 — GET /api/admin/pricing-tiers (adminPricingStore.modelToTier) ── */

describe("W35-A — F2: monthlyUsd / annualUsd on the real pricing-tiers endpoint", () => {
  it("A1 JPY POLE: a ¥1,200,000 tier NEVER emits the number 12000 in a USD field", async () => {
    const res = await request(app).get("/api/admin/pricing-tiers");
    expect(res.status).toBe(200);
    const t = find(res.body as EmittedTier[], jpy.id)!;
    expect(t).toBeTruthy();
    // THE DEFECT'S ANSWER — the exact value Review A observed.
    expect(t.annualUsd).not.toBe(12_000);
    expect(t.monthlyUsd).not.toBe(1_000);
    // A USD-named field cannot describe a JPY price: it is null, not a zero
    // and not a plausible-looking wrong number.
    expect(t.annualUsd).toBeNull();
    expect(t.monthlyUsd).toBeNull();
    // The truth is emitted alongside, so nothing is silently dropped.
    expect(t.currency).toBe("JPY");
    expect(t.annualMinor).toBe(ANNUAL_MINOR);
    expect(t.monthlyMinor).toBe(MONTHLY_MINOR);
    expect(t.displayPrice).toContain("1,200,000");
  });

  it("A2 USD POLE: the SAME minor price still converts to 12,000 — the division was not deleted", async () => {
    const res = await request(app).get("/api/admin/pricing-tiers");
    const t = find(res.body as EmittedTier[], usd.id)!;
    expect(t.currency).toBe("USD");
    expect(t.annualUsd).toBe(12_000);
    expect(t.monthlyUsd).toBe(1_000);
    expect(t.annualMinor).toBe(ANNUAL_MINOR);
    // An over-fix that emitted minor units in the USD field would fail here.
    expect(t.annualUsd).not.toBe(ANNUAL_MINOR);
  });

  it("A3 KRW pole: table-driven, not a JPY special case", async () => {
    const res = await request(app).get("/api/admin/pricing-tiers");
    const t = find(res.body as EmittedTier[], krw.id)!;
    expect(t.currency).toBe("KRW");
    expect(t.annualUsd).toBeNull();
    expect(t.annualMinor).toBe(ANNUAL_MINOR);
  });

  it("A4 the FOUNDER-facing mirror emits the same truth (this is the surface Review A probed)", async () => {
    const res = await request(app).get("/api/founder/pricing-tiers");
    expect(res.status).toBe(200);
    const t = find(res.body as EmittedTier[], jpy.id)!;
    expect(t.annualUsd).toBeNull();
    expect(t.currency).toBe("JPY");
    expect(t.annualMinor).toBe(ANNUAL_MINOR);
    const u = find(res.body as EmittedTier[], usd.id)!;
    expect(u.annualUsd).toBe(12_000);
  });
});

/* ── (B) F1 — GET /api/admin/pricing/founder-tiers (adminPlatformStore) ───── */

describe("W35-B — F1: usdMonthly on the real founder-tiers endpoint", () => {
  it("B1 JPY POLE: usdMonthly is not 1000; currency + minor units are emitted instead", async () => {
    const res = await request(app).get("/api/admin/pricing/founder-tiers");
    expect(res.status).toBe(200);
    const tiers = res.body.tiers as EmittedTier[];
    // NOTE: this endpoint keys on the model SLUG, not the id.
    const t = tiers.find((x) => x.id === "w35-f2-jpy")!;
    expect(t).toBeTruthy();
    expect(t.usdMonthly).not.toBe(1_000);
    expect(t.usdMonthly).toBeNull();
    expect(t.currency).toBe("JPY");
    expect(t.monthlyMinor).toBe(MONTHLY_MINOR);
    expect(t.annualMinor).toBe(ANNUAL_MINOR);
    expect(t.displayPrice).toContain("1,200,000");
    expect(t.displayPrice).not.toContain("$");
  });

  it("B2 USD POLE: usdMonthly is still 1000 — existing USD behaviour is byte-identical", async () => {
    const res = await request(app).get("/api/admin/pricing/founder-tiers");
    const tiers = res.body.tiers as EmittedTier[];
    const t = tiers.find((x) => x.id === "w35-f2-usd")!;
    expect(t.usdMonthly).toBe(1_000);
    expect(t.currency).toBe("USD");
    expect(t.displayPrice).toContain("$12,000");
  });
});

/* ── (W) THE WRITE POLE ──────────────────────────────────────────────────── */

describe("W35-W — F2 write pole: PATCH must not persist a mis-scaled price", () => {
  it("W1 a USD-named field against a JPY model is REFUSED, and nothing is written", async () => {
    const before = pricingModel.getModel(jpy.id)!;
    const beforeAnnual = before.cadenceOptions?.find((c) => c.cadence === "annual")?.priceMinor;

    const res = await request(app)
      .patch(`/api/admin/pricing-tiers/${jpy.id}`)
      .send({ annualUsd: 9_999 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("currency_mismatch");
    expect(res.body.currency).toBe("JPY");

    const after = pricingModel.getModel(jpy.id)!;
    const afterAnnual = after.cadenceOptions?.find((c) => c.cadence === "annual")?.priceMinor;
    expect(afterAnnual).toBe(beforeAnnual);
    // The defect would have persisted 9999 * 100 = 999,900 into a ¥ field.
    expect(afterAnnual).not.toBe(999_900);
  });

  it("W2 the exponent-free minor-unit field DOES write, for a JPY model", async () => {
    const res = await request(app)
      .patch(`/api/admin/pricing-tiers/${jpy.id}`)
      .send({ annualMinor: 1_500_000 });

    expect(res.status).toBe(200);
    const after = pricingModel.getModel(jpy.id)!;
    expect(after.cadenceOptions?.find((c) => c.cadence === "annual")?.priceMinor).toBe(1_500_000);
    expect(res.body.annualMinor).toBe(1_500_000);
    expect(res.body.annualUsd).toBeNull();
    expect(res.body.displayPrice).toContain("1,500,000");
  });

  it("W3 USD POLE: annualUsd still writes for a USD model — functionality was not dropped", async () => {
    const res = await request(app)
      .patch(`/api/admin/pricing-tiers/${usd.id}`)
      .send({ annualUsd: 840 });

    expect(res.status).toBe(200);
    const after = pricingModel.getModel(usd.id)!;
    expect(after.cadenceOptions?.find((c) => c.cadence === "annual")?.priceMinor).toBe(84_000);
    expect(res.body.annualUsd).toBe(840);
  });
});

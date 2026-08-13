/**
 * WAVE 34 · TASK 2 — the PRICING display surfaces, EXECUTED.
 *
 * The exhaustive sweep found three more sinks of the same class, all of them
 * on the price a customer is quoted:
 *
 *   1. server/publicPricingRoutes.ts:129 / :135 — `formatAnnual` /
 *      `formatOneTime`. Both take `currency` as a PARAMETER, use it to pick the
 *      symbol, and then divide by a hardcoded 100. This is `GET
 *      /api/pricing-public`, the unauthenticated marketing pricing endpoint —
 *      the single most publicly visible money surface in the product.
 *   2. server/adminPricingStore.ts:64 — `displayPrice`, which interpolates
 *      `${m.currency || "USD"}` into the very same string it built with a
 *      hardcoded `/ 100`.
 *   3. server/adminPlatformStore.ts:2242 — the identical string, on
 *      `GET /api/admin/pricing/founder-tiers`. Wave 33's instruction to hunt a
 *      SECOND path is what turned this one up; it is a copy of (2).
 *
 * This is NOT hypothetical multi-currency. `pricingModelStore` models carry a
 * first-class `currency` field and a `currencyOverrides[]` array, and
 * `previewPrice()` resolves per-currency — non-USD pricing is a supported,
 * shipped feature. A ¥1,200,000/year tier was quoted publicly as "JPY 12,000".
 *
 * BOTH POLES on every case: a JPY model (exponent 0) and a USD model
 * (exponent 2) carrying the SAME integer minor price. The JPY pole pins the
 * fix; the USD pole pins that a conversion still happens. A USD-only fixture
 * — which is all the pre-existing pricing tests had — passes against the
 * defect AND the fix.
 *
 * Assertions are on the EMITTED payload/string, never on what the code
 * consults. Preconditions are created here (models are inserted by this file);
 * `process.env` is never read; imports are static.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";

vi.mock("../lib/authMiddleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

import * as pricingModel from "../pricingModelStore";
import registerPublicPricingRoutes, {
  resolvePublicPricingPayload,
  _resetCacheForTests,
} from "../publicPricingRoutes";
import { currencyExponent, fromMinor } from "../lib/currency";

/** The SAME integer minor price in both currencies.
 *  exponent 0 → 1,200,000 major.  exponent 2 → 12,000 major. */
const ANNUAL_MINOR = 1_200_000;
const ONE_TIME_MINOR = 250_000;

function makeModel(
  over: Partial<pricingModel.CreateModelInput> & { slug: string; currency: string },
): pricingModel.PricingModel {
  const res = pricingModel.createModel(
    {
      productLine: "founder",
      slug: over.slug,
      name: over.name ?? `w34 ${over.slug}`,
      description: "wave34 fixture",
      status: "live",
      currency: over.currency,
      basePriceMinor: over.basePriceMinor ?? ANNUAL_MINOR,
      cadence: over.cadence ?? "annual",
      cadenceOptions: over.cadenceOptions ?? [{ cadence: "annual", priceMinor: ANNUAL_MINOR }],
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
      ...over,
    } as pricingModel.CreateModelInput,
    "w34-test",
  );
  if (!res.ok) throw new Error(`fixture model creation failed: ${res.error}`);
  return res.model;
}

/** Retire every pre-existing live model of a product line so OUR fixture is the
 *  one the resolver picks. Establishing the precondition, not consulting it. */
function retireLive(productLine: "founder" | "add_on", keepId: string) {
  for (const m of pricingModel.listModels({ productLine, status: "live" })) {
    if (m.id === keepId) continue;
    pricingModel.updateModel(m.id, { status: "retired" }, "w34-test");
  }
}

let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPublicPricingRoutes(app);
});

/* ── (F) PRECONDITIONS ───────────────────────────────────────────────────── */

describe("F — preconditions", () => {
  it("F1 the exponents this test depends on", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
    expect(fromMinor(ANNUAL_MINOR, "JPY")).toBe(1_200_000);
    expect(fromMinor(ANNUAL_MINOR, "USD")).toBe(12_000);
  });

  it("F2 non-USD pricing is a first-class shipped feature, not a hypothetical", () => {
    // The model type carries currency + per-currency overrides, and the
    // resolver honours a requested currency. If this ever stopped being true
    // the classification of these sinks would have to be revisited.
    const m = makeModel({ slug: "w34-precondition-currency", currency: "JPY" });
    expect(m.currency).toBe("JPY");
    expect(Array.isArray(m.currencyOverrides)).toBe(true);
    const preview = pricingModel.previewPrice(m.id, { currency: "JPY" });
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.preview.currency).toBe("JPY");
  });
});

/* ── (P) THE PUBLIC PRICING ENDPOINT ─────────────────────────────────────── */

describe("P — GET /api/pricing-public honours the model's own currency exponent", () => {
  it("P1 JPY pole: a ¥1,200,000/year tier is quoted as 1,200,000, not 12,000", async () => {
    const m = makeModel({ slug: "w34-public-annual-jpy", currency: "JPY" });
    retireLive("founder", m.id);
    _resetCacheForTests();

    const res = await request(app).get("/api/pricing-public");
    expect(res.status).toBe(200);
    const entry = res.body.capavate_annual;
    expect(entry.currency).toBe("JPY");
    expect(entry.price_minor).toBe(ANNUAL_MINOR);
    expect(entry.display).toContain("1,200,000");
    // The defect's answer must be ABSENT.
    expect(entry.display).not.toContain("12,000/year");
  });

  it("P2 USD pole: the SAME minor price is quoted as 12,000 — a division still happens", async () => {
    const m = makeModel({ slug: "w34-public-annual-usd", currency: "USD" });
    retireLive("founder", m.id);
    _resetCacheForTests();

    const entry = resolvePublicPricingPayload().capavate_annual;
    expect(entry.currency).toBe("USD");
    expect(entry.display).toContain("$12,000");
    expect(entry.display).not.toContain("1,200,000");
  });

  it("P3 the one-time (Academy) formatter is the SECOND PATH in the same file", () => {
    const m = makeModel({
      slug: "w34-public-onetime-jpy",
      currency: "JPY",
      productLine: "add_on",
      cadence: "one_time",
      basePriceMinor: ONE_TIME_MINOR,
      cadenceOptions: [{ cadence: "one_time", priceMinor: ONE_TIME_MINOR }],
    });
    retireLive("add_on", m.id);
    _resetCacheForTests();

    const entry = resolvePublicPricingPayload().academy_one_time;
    expect(entry.currency).toBe("JPY");
    expect(entry.display).toContain("250,000");
    expect(entry.display).not.toContain("2,500 one-time");
  });

  it("P4 KRW proves the exponent is table-driven, not a JPY special case", () => {
    const m = makeModel({ slug: "w34-public-annual-krw", currency: "KRW" });
    retireLive("founder", m.id);
    _resetCacheForTests();
    expect(resolvePublicPricingPayload().capavate_annual.display).toContain("1,200,000");
  });
});

/* ── (A) THE ADMIN PRICING DISPLAY STRINGS ───────────────────────────────── */

describe("A — the admin tier displayPrice strings", () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("A0 the comment stripper actually strips, and still sees code", () => {
    expect(strip("/* annualMinor / 100 */\nconst a = 1;")).not.toMatch(/annualMinor \/ 100/);
    expect(strip("// annualMinor / 100\nconst a = 1;")).not.toMatch(/annualMinor \/ 100/);
    expect(strip("/* c */ const a = annualMinor / 100;")).toMatch(/annualMinor \/ 100/);
  });

  it("A1 adminPricingStore.modelToTier renders the JPY tier at 1,200,000", async () => {
    const m = makeModel({ slug: "w34-admin-tier-jpy", currency: "JPY" });
    const { PRICING_TIERS } = await import("../adminPricingStore");
    const tier = Array.from(PRICING_TIERS as unknown as Iterable<{ id: string; displayPrice?: string }>)
      .find((t) => t.id === m.id);
    expect(tier).toBeTruthy();
    expect(tier!.displayPrice).toContain("1,200,000");
    expect(tier!.displayPrice).toContain("JPY");
    expect(tier!.displayPrice).not.toContain("12,000 JPY");
  });

  it("A2 USD pole: the SAME minor price renders 12,000 — a division still happens", async () => {
    const m = makeModel({ slug: "w34-admin-tier-usd", currency: "USD" });
    const { PRICING_TIERS } = await import("../adminPricingStore");
    const tier = Array.from(PRICING_TIERS as unknown as Iterable<{ id: string; displayPrice?: string }>)
      .find((t) => t.id === m.id);
    expect(tier!.displayPrice).toContain("12,000");
    expect(tier!.displayPrice).not.toContain("1,200,000");
  });

  it("A3 the shipped sources no longer hardcode an exponent on a currency-bearing string", () => {
    const pub = strip(fs.readFileSync("server/publicPricingRoutes.ts", "utf8"));
    expect(pub.length).toBeGreaterThan(1000);
    expect(pub).not.toMatch(/priceMinor \/ 100/);
    expect(pub).toMatch(/fromMinor\(priceMinor, currency\)/);

    const adminPricing = strip(fs.readFileSync("server/adminPricingStore.ts", "utf8"));
    expect(adminPricing).not.toMatch(/Math\.round\(annualMinor \/ 100\)\.toLocaleString\(\)\} \$\{m\.currency/);
    expect(adminPricing).toMatch(/fromMinor\(/);

    const adminPlatform = strip(fs.readFileSync("server/adminPlatformStore.ts", "utf8"));
    expect(adminPlatform).not.toMatch(/Math\.round\(annualMinor \/ 100\)\.toLocaleString\(\)\} \$\{m\.currency/);
    expect(adminPlatform).toMatch(/fromMinor\(annualMinor, tierCurrency\)/);
  });
});

/* ── (S) THE /api/admin/pricing/founder-tiers SECOND PATH ────────────────── */

describe("S — the founder-tiers endpoint copy of the same string", () => {
  /* WAVE 35 · F10(a) — REWRITTEN.
   *
   * The original S1 built its OWN `displayPrice` string inside the test body
   * (`const build = (m) => ...`) and asserted on that. It never issued a
   * request, never imported the route module, and would have passed with the
   * endpoint deleted. It was therefore asserting that the TEST's arithmetic is
   * correct — a tautology — and it is precisely why F1 (`usdMonthly` hardcoding
   * `/100` in the same object literal, two lines above the string this test
   * claimed to cover) survived Wave 34.
   *
   * It now mounts `registerAdminPlatformRoutes` and asserts on the EMITTED
   * payload of the real `GET /api/admin/pricing/founder-tiers`. */
  it("S1 JPY pole and USD pole on the REAL endpoint's emitted payload", async () => {
    const jpy = makeModel({ slug: "w34-founder-tiers-jpy", currency: "JPY" });
    const usd = makeModel({ slug: "w34-founder-tiers-usd", currency: "USD" });

    const { registerAdminPlatformRoutes } = await import("../adminPlatformStore");
    const routeApp = express();
    routeApp.use(express.json());
    registerAdminPlatformRoutes(routeApp);

    const res = await request(routeApp).get("/api/admin/pricing/founder-tiers");
    expect(res.status).toBe(200);
    const tiers = res.body.tiers as Array<{ id: string; displayPrice?: string; currency?: string }>;

    // This endpoint keys on the model SLUG.
    const jpyTier = tiers.find((t) => t.id === jpy.slug);
    const usdTier = tiers.find((t) => t.id === usd.slug);
    expect(jpyTier).toBeTruthy();
    expect(usdTier).toBeTruthy();

    expect(jpyTier!.displayPrice).toContain("1,200,000 JPY");
    expect(jpyTier!.displayPrice).not.toContain("12,000 JPY");
    expect(usdTier!.displayPrice).toContain("12,000 USD");
    expect(usdTier!.displayPrice).not.toContain("1,200,000");
  });
});

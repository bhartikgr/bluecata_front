/* v25.43 F12 — E2E: GET /api/billing/tiers includes `description` sourced from
 * the DB-backed pricing_models row.
 *
 * Decision #4 / DB-driven mandate: the founder Subscribe picker reads plan
 * descriptions from pricing_models.description AT REQUEST TIME (via the
 * admin-editable pricingModelStore, which is hydrated from the DB), NOT from a
 * hardcoded constant. We seed a LIVE founder pricing model with a known
 * description (the same admin-equivalent createModel path the v24.2 Airwallex
 * test uses) and assert the endpoint echoes that description for the tier.
 *
 * We also assert the graceful empty state: a live tier created WITHOUT a
 * description omits the field entirely (no placeholder).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { getDb } from "../db/connection.ts";
import * as pricingModel from "../pricingModelStore.ts";
import { registerFounderUser } from "../lib/userContext.ts";
import { addCompanyForFounder } from "../multiCompanyStore.ts";

let app, server, port;
const STAMP = Date.now();
const SLUG_WITH = `v2543-desc-${STAMP}`;
const SLUG_WITHOUT = `v2543-nodesc-${STAMP}`;
const DESCRIPTION = `v25.43 F12 plan description ${STAMP}`;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

let FOUNDER = "";
const COMPANY = `co_v2543_${STAMP}`;

function call(method, path, body, userId) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers = {};
    if (data) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(data)); }
    if (userId) headers["x-user-id"] = userId;
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} }); } catch { resolve({ status: res.statusCode ?? 0, body: raw }); } });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function seedModel(slug, name, description) {
  if (pricingModel.listModels({ productLine: "founder", status: "live" }).some((m) => m.slug === slug)) return;
  const created = pricingModel.createModel(
    {
      productLine: "founder",
      slug,
      name,
      description,
      status: "live",
      currency: "USD",
      basePriceMinor: 84000,
      cadence: "annual",
      cadenceOptions: [
        { cadence: "annual", priceMinor: 84000 },
        { cadence: "monthly", priceMinor: 7000 },
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
    },
    "v2543-test-harness",
  );
  if (!created.ok) throw new Error(`failed to seed pricing model ${slug}: ${created.error}`);
}

describe("v25.43 F12 — GET /api/billing/tiers includes DB-backed description", () => {
  beforeAll(async () => {
    getDb();
    seedModel(SLUG_WITH, "V2543 With Description", DESCRIPTION);
    seedModel(SLUG_WITHOUT, "V2543 No Description", "");

    const reg = registerFounderUser({ email: `v2543_${STAMP}@test.example`, name: "F12 Founder", password: "pw-not-used" });
    FOUNDER = reg.userId;
    addCompanyForFounder(FOUNDER, {
      companyId: COMPANY,
      companyName: "F12 Co",
      legalName: "F12 Co, Inc.",
      logoUrl: null,
      role: "founder",
      lastActiveAt: new Date().toISOString(),
      kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 0 },
      collective: { status: "none" },
      billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
      sector: "Fintech",
      stage: "Seed",
      hq: "Toronto, ON",
    });

    app = express();
    app.use(express.json());
    server = http.createServer(app);
    await registerRoutes(server, app);
    await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
  }, 30_000);

  afterAll(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
  });

  it("the endpoint responds 200 with a tiers array", async () => {
    const r = await call("GET", "/api/billing/tiers", undefined, FOUNDER);
    record("200 + tiers array", r.status === 200 && Array.isArray(r.body?.tiers), `status ${r.status}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.tiers)).toBe(true);
  });

  it("the tier with a DB description returns that exact description", async () => {
    const r = await call("GET", "/api/billing/tiers", undefined, FOUNDER);
    const tier = r.body.tiers.find((t) => t.slug === SLUG_WITH);
    const ok = !!tier && tier.description === DESCRIPTION;
    record("description echoed from DB", ok, tier ? JSON.stringify(tier.description) : "tier missing");
    expect(ok).toBe(true);
  });

  it("a tier with an empty description omits the field (graceful empty state)", async () => {
    const r = await call("GET", "/api/billing/tiers", undefined, FOUNDER);
    const tier = r.body.tiers.find((t) => t.slug === SLUG_WITHOUT);
    const ok = !!tier && (tier.description === undefined || tier.description === null);
    record("empty description omitted", ok, tier ? JSON.stringify(tier.description) : "tier missing");
    expect(ok).toBe(true);
  });

  it("summary", () => {
    console.log(`\n  v25.43 F12 E2E: ${results.filter((r) => r.pass).length}/${results.length} assertions passed\n`);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});

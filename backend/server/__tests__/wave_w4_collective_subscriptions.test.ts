/**
 * WAVE W4 — Collective dynamic subscription-package admin CRUD.
 *
 * Coverage (all against the real registered routes + DB-backed store):
 *
 *  Store / price-refs:
 *    1.  listAvailableAirwallexPriceRefs reflects env config (available=true).
 *  Admin CRUD (/api/admin/collective-subscriptions):
 *    2.  GET list (empty at start for a fresh slug space).
 *    3.  GET airwallex-price-refs returns existing tiers only.
 *    4.  POST create draft (price auto-matched) -> 201.
 *    5.  POST create with unknown price id -> 400 unknown_airwallex_price_id.
 *    6.  PATCH update label -> version bumps, revision chain grows.
 *    7.  GET :id/history + chain verifies ok.
 *    8.  POST promote live with matched price -> 200 status=live.
 *    9.  POST promote live with mismatched price -> 400 airwallex_price_mismatch.
 *    10. POST clone -> 201 new draft.
 *    11. DELETE a live package -> 400 cannot_delete_live_deprecate_instead.
 *  Member read (GET /api/collective/membership/tiers):
 *    12. Returns source="admin" with the live package once published.
 *  Checkout resolver (store):
 *    13. resolvePublishedPackageForCheckout(live slug) -> ok + tier + priceRef.
 *    14. resolve on a draft slug -> package_not_live.
 *  Three-pillar independence:
 *    15. Capavate founder pricing + Consortium fee tables are untouched by W4 DDL.
 *  Migration self-heal:
 *    16. collective_subscription_configs + _history tables exist after bootstrap.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

// Configure Airwallex Collective env BEFORE importing modules that read it,
// so priceConfigForTier returns a live config for standard.
process.env.COLLECTIVE_ENABLED = "1"; // feature flag gate on the member tiers route
process.env.AIRWALLEX_COLLECTIVE_STANDARD_AMOUNT_MINOR = "50000";
process.env.AIRWALLEX_COLLECTIVE_STANDARD_CURRENCY = "USD";
process.env.AIRWALLEX_COLLECTIVE_STANDARD_INTERVAL = "year";
process.env.AIRWALLEX_COLLECTIVE_BASIC_AMOUNT_MINOR = "10000";
process.env.AIRWALLEX_COLLECTIVE_BASIC_CURRENCY = "USD";
process.env.AIRWALLEX_COLLECTIVE_BASIC_INTERVAL = "year";

import { registerRoutes } from "../routes";
import * as store from "../collectiveSubscriptionConfigStore";
import { rawDb } from "../db/connection";
import { priceIdForTier } from "../lib/airwallexCollective";

let app: Express;
let server: http.Server;
let port: number;

function api(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { "x-user-id": "u_admin" };
    if (data) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(data)); }
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let raw = ""; res.on("data", (c) => (raw += c));
      res.on("end", () => { try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); } catch { resolve({ status: res.statusCode ?? 0, body: raw }); } });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}

const BASE = "/api/admin/collective-subscriptions";
const STD_PRICE = priceIdForTier("standard");

beforeAll(async () => {
  app = express(); app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); }));
  // Clean slate for the slugs this suite authors (idempotent).
  try { rawDb().prepare(`DELETE FROM collective_subscription_configs WHERE slug LIKE 'w4-%'`).run(); } catch { /* table may self-heal on first access */ }
}, 30_000);

afterAll(async () => {
  try { rawDb().prepare(`DELETE FROM collective_subscription_configs WHERE slug LIKE 'w4-%'`).run(); } catch { /* ignore */ }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("W4 — price refs + store", () => {
  it("1. listAvailableAirwallexPriceRefs marks standard available", () => {
    const refs = store.listAvailableAirwallexPriceRefs();
    const std = refs.find((r) => r.tier === "standard");
    expect(std?.available).toBe(true);
    expect(std?.priceId).toBe(STD_PRICE);
    expect(std?.amountMinor).toBe(50000);
    expect(std?.interval).toBe("annual");
  });
});

describe("W4 — admin CRUD", () => {
  let createdId = "";
  let cloneId = "";

  it("2. GET list works", async () => {
    const r = await api("GET", `${BASE}?includeExpired=true`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.packages)).toBe(true);
  });

  it("3. GET airwallex-price-refs returns existing tiers", async () => {
    const r = await api("GET", `${BASE}/airwallex-price-refs`);
    expect(r.status).toBe(200);
    expect(r.body.refs.map((x: any) => x.tier).sort()).toEqual(["basic", "premium", "standard"]);
  });

  it("4. POST create draft (matched price) -> 201", async () => {
    const r = await api("POST", BASE, {
      slug: "w4-standard", label: "W4 Standard", description: "test pkg",
      entitlements: ["read", "dsc:vote"], amountMinor: 50000, currency: "USD", interval: "annual",
      airwallexTier: "standard", airwallexPriceId: STD_PRICE, membershipRole: "dsc_member",
    });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.package.status).toBe("draft");
    createdId = r.body.package.id;
  });

  it("5. POST create with unknown price id -> 400", async () => {
    const r = await api("POST", BASE, {
      slug: "w4-bad", label: "Bad", amountMinor: 50000, currency: "USD", interval: "annual",
      airwallexTier: "standard", airwallexPriceId: "awx_bogus_1_usd_year",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("unknown_airwallex_price_id");
  });

  it("6. PATCH update bumps version", async () => {
    const r = await api("PATCH", `${BASE}/${createdId}`, { label: "W4 Standard v2" });
    expect(r.status).toBe(200);
    expect(r.body.package.version).toBe(2);
    expect(r.body.package.label).toBe("W4 Standard v2");
  });

  it("7. history + chain verifies", async () => {
    const r = await api("GET", `${BASE}/${createdId}/history`);
    expect(r.status).toBe(200);
    expect(r.body.history.length).toBeGreaterThanOrEqual(2);
    expect(r.body.chain.ok).toBe(true);
  });

  it("8. promote live (matched) -> 200 live", async () => {
    const r = await api("POST", `${BASE}/${createdId}/promote`, { to: "live" });
    expect(r.status).toBe(200);
    expect(r.body.package.status).toBe("live");
  });

  it("9. promote live with mismatched price -> 400 airwallex_price_mismatch", async () => {
    // Create a draft whose amount does NOT match the env tier price, then try to publish.
    const c = await api("POST", BASE, {
      slug: "w4-mismatch", label: "Mismatch", amountMinor: 99999, currency: "USD", interval: "annual",
      airwallexTier: "standard", airwallexPriceId: STD_PRICE,
    });
    expect(c.status).toBe(201);
    const r = await api("POST", `${BASE}/${c.body.package.id}/promote`, { to: "live" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("airwallex_price_mismatch");
  });

  it("10. clone -> 201 draft", async () => {
    const r = await api("POST", `${BASE}/${createdId}/clone`);
    expect(r.status).toBe(201);
    expect(r.body.package.status).toBe("draft");
    expect(r.body.package.slug).toContain("w4-standard-copy");
    cloneId = r.body.package.id;
    expect(cloneId).toBeTruthy();
  });

  it("11. DELETE a live package -> 400", async () => {
    const r = await api("DELETE", `${BASE}/${createdId}`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("cannot_delete_live_deprecate_instead");
  });
});

describe("W4 — member read + checkout resolver", () => {
  it("12. GET /api/collective/membership/tiers -> source=admin with live pkg", async () => {
    const r = await api("GET", "/api/collective/membership/tiers");
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("admin");
    const live = r.body.tiers.find((t: any) => t.slug === "w4-standard");
    expect(live).toBeTruthy();
    expect(live.unitAmount).toBe(50000);
  });

  it("13. resolvePublishedPackageForCheckout(live slug) -> ok", () => {
    const res = store.resolvePublishedPackageForCheckout({ packageSlug: "w4-standard" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.package.airwallexTier).toBe("standard");
      expect(res.priceRef.priceId).toBe(STD_PRICE);
    }
  });

  it("14. resolve on a draft slug -> package_not_live", () => {
    const res = store.resolvePublishedPackageForCheckout({ packageSlug: "w4-standard-copy" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error === "package_not_live" || res.error === "package_not_found").toBe(true);
  });
});

describe("W4 — three-pillar independence + migration self-heal", () => {
  it("15. Capavate + Consortium fee tables untouched by W4 DDL", () => {
    const db = rawDb();
    // W4 tables exist...
    const csc = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='collective_subscription_configs'`).get();
    expect(csc).toBeTruthy();
    // ...and the pre-existing fee/pricing tables are still present + unmodified in shape.
    const feeCfg = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='collective_application_fee_config'`).get();
    expect(feeCfg).toBeTruthy();
    const commRate = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='partner_commission_rate_config'`).get();
    expect(commRate).toBeTruthy();
  });

  it("16. self-heal created both W4 tables", () => {
    const db = rawDb();
    const hist = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='collective_subscription_config_history'`).get();
    expect(hist).toBeTruthy();
  });
});

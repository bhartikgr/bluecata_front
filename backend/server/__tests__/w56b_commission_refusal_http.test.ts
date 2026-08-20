/**
 * WAVE 56b — THE COMMISSION REFUSAL MUST NOT BE A 500 ON A PARTNER'S OWN
 * P&L / BILLING PAGE.
 *
 * ── WHAT WAS WRONG (measured, not assumed) ──────────────────────────────────
 * Wave 56 correctly stopped `getCommissionRate()` from silently answering 2%
 * for a tier with no configured rate: it now throws
 * `UnknownCommissionTierError` (`PARTNER_COMMISSION_RATE_UNRESOLVED`). That fix
 * is right and is NOT touched here.
 *
 * But at `server/partnerConsortiumRoutes.ts:134` (GET /api/partner/me/pnl) and
 * `:356` (GET /api/partner/me/billing) the refusal was raised OUTSIDE the
 * route's own error handling:
 *
 *     const tier = ctx.tier as PartnerTier;
 *     const pct  = commissionPct(tier);   // <-- throws here
 *     try { const db = rawDb(); ... } catch { res.status(500) ... }
 *
 * so the throw escaped to Express and the partner's P&L / billing page answered
 * a bare 500 with no name, no tier and no instruction. This suite reproduces
 * that 500 THROUGH THE REAL HTTP ROUTE and pins the fixed behaviour: a named
 * 409 that states the tier and where an admin fixes it.
 *
 * ── BOTH POLES, DELIBERATELY ────────────────────────────────────────────────
 * A test that only asserted "unknown tier ⇒ 409" would also pass if every
 * partner got a 409, which would take every partner's P&L page down. So each
 * refusal is paired with a positive control on a REAL configured tier
 * (`builder`, 3%), asserted through the same routes in the same process.
 *
 *   LOWER POLE  — unranked tier: 409, `error: PARTNER_COMMISSION_RATE_UNRESOLVED`,
 *                 the tier is NAMED, the admin location is named, the body
 *                 contains NO 2% / 0.02 anywhere, and NO billing ledger row is
 *                 written for that partner.
 *   UPPER POLE  — builder: 200 on both routes, commissionPct === 3.
 *
 * MUTATION TRANSCRIPT: build_log/wave56b/W56B_TESTS.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import type { PartnerTier } from "../adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { storeCredential } from "../userCredentialsStore";
import { wave45Db } from "../lib/applyWave45PricingSchema";

/* ── principals ──────────────────────────────────────────────────────────── */

/** A tier slug that exists in NO commission-rate table and NO literal mirror.
 *  Cast at the ONE boundary that types it, exactly as production does
 *  (`requirePartnerAuth`: `tier: (partner.tier as PartnerTier)`), so this file
 *  adds no `tsc` error of its own. */
const UNRATED_TIER = "w56b_unrated_tier" as PartnerTier;

const PARTNER_UNRATED = "ac_consortium_partner_w56b_unrated";
const MANAGING_UNRATED = "u_w56b_unrated_managing";

const PARTNER_OK = "ac_consortium_partner_w56b_control";
const MANAGING_OK = "u_w56b_control_managing";

let app: Express;
let server: http.Server;
let port = 0;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  wave45Db(); // tier-domain / pricing schema, as a test process gets it
  seedTestPartnerSandbox({ force: true });

  // The partner on a tier that has NO configured commission rate.
  _registerSeedPartner({
    id: PARTNER_UNRATED,
    legalName: "W56B UNRATED TIER PARTNER, INC",
    displayName: "W56b Unrated",
    email: "ops@w56b-unrated.example",
    region: "US",
    regionCode: "US",
    tier: UNRATED_TIER,
    partnerType: "angel_network",
  });
  partnerTeamStore.add(PARTNER_UNRATED, MANAGING_UNRATED, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: MANAGING_UNRATED,
    email: "managing@w56b-unrated.example",
    name: "W56b Unrated Managing",
    password: "test-password-w56b-unrated",
  });

  // POSITIVE CONTROL — a real, configured tier (builder = 3%).
  _registerSeedPartner({
    id: PARTNER_OK,
    legalName: "W56B CONTROL PARTNER, INC",
    displayName: "W56b Control",
    email: "ops@w56b-control.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "angel_network",
  });
  partnerTeamStore.add(PARTNER_OK, MANAGING_OK, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: MANAGING_OK,
    email: "managing@w56b-control.example",
    name: "W56b Control Managing",
    password: "test-password-w56b-control",
  });

  await hydratePartnerWorkspaceV19Store();

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) =>
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    }),
  );
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request({ hostname: "127.0.0.1", port, path: apiPath, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let b: any = null;
        try { b = JSON.parse(buf); } catch { /* HTML error page — keep raw */ }
        resolve({ status: res.statusCode ?? 0, body: b, raw: buf });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/* ========================================================================= */
describe("W56b · LOWER POLE — a tier with no configured commission rate REFUSES BY NAME, never 500", () => {
  it("GET /api/partner/me/pnl answers a named 409, not a 500", async () => {
    const r = await call("GET", "/api/partner/me/pnl", { userId: MANAGING_UNRATED });
    expect(r.status).not.toBe(500);
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe("PARTNER_COMMISSION_RATE_UNRESOLVED");
  });

  it("the /pnl refusal NAMES the tier and NAMES where to fix it", async () => {
    const r = await call("GET", "/api/partner/me/pnl", { userId: MANAGING_UNRATED });
    expect(r.body?.tier).toBe(String(UNRATED_TIER));
    const msg = String(r.body?.message ?? "");
    expect(msg).toContain(String(UNRATED_TIER));
    expect(msg).toMatch(/Fees & Billing/i);
    expect(msg).toMatch(/Partner commission rates/i);
  });

  it("the /pnl refusal does NOT leak a default 2% anywhere in the body", async () => {
    const r = await call("GET", "/api/partner/me/pnl", { userId: MANAGING_UNRATED });
    const raw = JSON.stringify(r.body ?? {});
    expect(raw).not.toContain("0.02");
    expect(raw).not.toMatch(/\b2(\.0+)?%/);
    // and it is NOT an empty-but-successful page
    expect(r.body?.byTier).toBeUndefined();
    expect(r.body?.commissionPct).toBeUndefined();
  });

  it("GET /api/partner/me/billing answers a named 409, not a 500", async () => {
    const r = await call("GET", "/api/partner/me/billing", { userId: MANAGING_UNRATED });
    expect(r.status).not.toBe(500);
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe("PARTNER_COMMISSION_RATE_UNRESOLVED");
    expect(r.body?.tier).toBe(String(UNRATED_TIER));
    expect(String(r.body?.message ?? "")).toMatch(/Partner commission rates/i);
  });

  it("the refused billing read writes NO ledger row for that partner (no phantom 2% commission)", async () => {
    await call("GET", "/api/partner/me/billing", { userId: MANAGING_UNRATED });
    const row = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM partner_billing_entries WHERE partner_id = ?`)
      .get(PARTNER_UNRATED) as { n: number };
    expect(row.n).toBe(0);
  });
});

/* ========================================================================= */
describe("W56b · UPPER POLE — a configured tier is COMPLETELY UNAFFECTED", () => {
  it("GET /api/partner/me/pnl still answers 200 with builder's 3% commission", async () => {
    const r = await call("GET", "/api/partner/me/pnl", { userId: MANAGING_OK });
    expect(r.status).toBe(200);
    expect(r.body?.tier).toBe("builder");
    expect(r.body?.commissionPct).toBeCloseTo(3, 10);
    expect(Array.isArray(r.body?.byTier)).toBe(true);
    expect(r.body.byTier[0].commissionPct).toBeCloseTo(3, 10);
  });

  it("GET /api/partner/me/billing still answers 200 for a configured tier", async () => {
    const r = await call("GET", "/api/partner/me/billing", { userId: MANAGING_OK });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body?.entries)).toBe(true);
  });
});

/**
 * WAVE 56b — THE SWEEP. The two sites the brief named were not the only ones.
 *
 * `UnknownCommissionTierError` (`PARTNER_COMMISSION_RATE_UNRESOLVED`) has ONE
 * origin (`getCommissionRate`) and four production reachers; the enumeration is
 * in build_log/wave56b/W56B_THROW_SITE_ENUMERATION.md. Two of them are covered
 * by w56b_commission_refusal_http.test.ts. This file covers the two the brief
 * did NOT mention, both found by walking the caller closure:
 *
 *   SITE 3  GET  /api/partner/me      (server/partnerRoutes.ts:750)
 *           Its catch tested `err instanceof EffectivePlanError` and RETHREW
 *           anything else. The commission refusal is not an EffectivePlanError,
 *           so it escaped the handler: a bare 500 on the partner's whole
 *           workspace bootstrap — worse than the P&L page, because nothing
 *           loads at all. Fixed ADDITIVELY: 200, `effectivePlan: null` (no rate
 *           invented) plus a new `effectivePlanError {code,tier,message}`.
 *
 *   SITE 4  POST /api/partner/me/subscribe (via
 *           partnerSubscriptionStore.quotePartnerCheckout:222)
 *           Handled, but reported as `500 PARTNER_SUBSCRIBE_FAILED` — a missing
 *           admin field reported to the partner as a platform crash. Fixed:
 *           `PartnerCheckoutError("PARTNER_COMMISSION_RATE_UNRESOLVED", …, 409)`,
 *           which the route already translates via `err.httpStatus`.
 *
 * ── REACHING THESE SITES HONESTLY ───────────────────────────────────────────
 * `resolvePartnerEffectivePlan` resolves the PRICE first and throws
 * `EffectivePlanError` when no price resolves, which would short-circuit before
 * the commission line ever ran. So an unranked tier alone does NOT reach the
 * commission code. The reachable state is precise: a partner whose PRICE
 * resolves (an admin-set per-partner override in `contacts.fee_override_json`)
 * but whose TIER has no commission rate. That is exactly the real-world
 * sequence Wave 56's admin surface makes possible — an admin onboards a partner
 * on a new tier, sets their price, and has not yet set the tier's commission
 * rate. This file constructs that state through the DB the way an admin would,
 * then drives real HTTP.
 *
 * Both poles again: the same two routes are asserted on a configured tier
 * (`builder`) in the same process, so "everything 409s" cannot pass.
 *
 * MUTATION TRANSCRIPT: build_log/wave56b/W56B_TESTS.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { seedTestPartnerSandbox, partnerTeamStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import type { PartnerTier } from "../adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { storeCredential } from "../userCredentialsStore";
import { wave45Db } from "../lib/applyWave45PricingSchema";

const UNRATED_TIER = "w56b_sweep_unrated_tier" as PartnerTier;

const P_UNRATED = "ac_consortium_partner_w56b_sweep_unrated";
const U_UNRATED = "u_w56b_sweep_unrated_managing";

const P_OK = "ac_consortium_partner_w56b_sweep_control";
const U_OK = "u_w56b_sweep_control_managing";

/** An admin-set per-partner price. Its presence is what makes the commission
 *  line reachable at all — see the header. Amount is irrelevant to this test;
 *  what matters is that a price EXISTS while a commission rate does not. */
const FEE_OVERRIDE_JSON = JSON.stringify({
  subscription_monthly: { amountMinor: 24_000, currency: "USD" },
  subscription_annual: { amountMinor: 288_000, currency: "USD" },
});

let app: Express;
let server: http.Server;
let port = 0;

function seedDurablePartnerContact(id: string, legalName: string, feeOverrideJson: string | null): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO contacts
         (id, kind, legal_name, status, verification, created_at, updated_at,
          created_by, updated_by, version, prev_revision_hash, revision_hash,
          partner_agreement_version, partner_agreement_signed_at, fee_override_json)
       VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?, 'u_system_seed', 'u_system_seed',
               1, ?, ?, 'CPA-v0.1-DRAFT', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         partner_agreement_version = excluded.partner_agreement_version,
         partner_agreement_signed_at = excluded.partner_agreement_signed_at,
         fee_override_json = excluded.fee_override_json`,
    )
    .run(id, legalName, now, now, "0".repeat(64), "0".repeat(64), now, feeOverrideJson);
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  wave45Db();
  seedTestPartnerSandbox({ force: true });

  _registerSeedPartner({
    id: P_UNRATED,
    legalName: "W56B SWEEP UNRATED PARTNER, INC",
    displayName: "W56b Sweep Unrated",
    email: "ops@w56b-sweep-unrated.example",
    region: "US",
    regionCode: "US",
    tier: UNRATED_TIER,
    partnerType: "angel_network",
  });
  partnerTeamStore.add(P_UNRATED, U_UNRATED, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: U_UNRATED,
    email: "managing@w56b-sweep-unrated.example",
    name: "W56b Sweep Unrated Managing",
    password: "test-password-w56b-sweep-unrated",
  });
  seedDurablePartnerContact(P_UNRATED, "W56B SWEEP UNRATED PARTNER, INC", FEE_OVERRIDE_JSON);

  _registerSeedPartner({
    id: P_OK,
    legalName: "W56B SWEEP CONTROL PARTNER, INC",
    displayName: "W56b Sweep Control",
    email: "ops@w56b-sweep-control.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "angel_network",
  });
  partnerTeamStore.add(P_OK, U_OK, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: U_OK,
    email: "managing@w56b-sweep-control.example",
    name: "W56b Sweep Control Managing",
    password: "test-password-w56b-sweep-control",
  });
  seedDurablePartnerContact(P_OK, "W56B SWEEP CONTROL PARTNER, INC", FEE_OVERRIDE_JSON);

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

describe("W56b SITE 3 · GET /api/partner/me — the session bootstrap must not 500", () => {
  it("loads (200) for a priced partner whose tier has no commission rate", async () => {
    const r = await call("GET", "/api/partner/me", { userId: U_UNRATED });
    expect(r.status).not.toBe(500);
    expect(r.status).toBe(200);
    // The workspace still boots: identity is present.
    expect(r.body?.partnerId ?? r.body?.partner?.id).toBeTruthy();
  });

  it("says WHY the effective plan is missing, and invents no rate", async () => {
    const r = await call("GET", "/api/partner/me", { userId: U_UNRATED });
    expect(r.body?.effectivePlan).toBeNull();
    expect(r.body?.effectivePlanError?.code).toBe("PARTNER_COMMISSION_RATE_UNRESOLVED");
    expect(r.body?.effectivePlanError?.tier).toBe(String(UNRATED_TIER));
    expect(String(r.body?.effectivePlanError?.message ?? "")).toContain(String(UNRATED_TIER));
    // NO default rate anywhere in the payload for this partner.
    expect(r.body?.commissionPct ?? null).toBeNull();
    expect(JSON.stringify(r.body ?? {})).not.toContain("0.02");
  });

  it("UPPER POLE — a configured tier still gets a full effective plan", async () => {
    const r = await call("GET", "/api/partner/me", { userId: U_OK });
    expect(r.status).toBe(200);
    expect(r.body?.effectivePlanError ?? null).toBeNull();
    expect(r.body?.effectivePlan).toBeTruthy();
    expect(r.body?.effectivePlan?.commission?.rate).toBeCloseTo(0.03, 10);
  });
});

describe("W56b SITE 4 · POST /api/partner/me/subscribe — configuration fault, not a crash", () => {
  it("answers 409 PARTNER_COMMISSION_RATE_UNRESOLVED, not 500 PARTNER_SUBSCRIBE_FAILED", async () => {
    const r = await call("POST", "/api/partner/me/subscribe", { userId: U_UNRATED, body: {} });
    expect(r.status).not.toBe(500);
    expect(r.body?.error).not.toBe("PARTNER_SUBSCRIBE_FAILED");
    expect(r.status).toBe(409);
    expect(r.body?.error).toBe("PARTNER_COMMISSION_RATE_UNRESOLVED");
    expect(String(r.body?.message ?? "")).toContain(String(UNRATED_TIER));
  });

  it("UPPER POLE — a configured tier can still be quoted", async () => {
    const r = await call("POST", "/api/partner/me/subscribe", { userId: U_OK, body: {} });
    expect(r.status).toBe(200);
    expect(r.body?.ok).toBe(true);
    expect(typeof r.body?.amountMinor).toBe("number");
  });
});

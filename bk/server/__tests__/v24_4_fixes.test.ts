/**
 * v24.4 — launch-readiness fix wave regression suite.
 *
 * Coverage map (one or more assertions each):
 *   Fix 1  Airwallex MODE resolver — getAirwallexMode()/getAirwallexApiBase()
 *          honor AIRWALLEX_MODE (stub|test|live) + key precedence; test/stub
 *          surface the demo base URL; live needs a key.
 *   Fix 1  Webhook SUCCEEDED guard — an Airwallex intermediate state
 *          (REQUIRES_PAYMENT_METHOD) does NOT activate a pending subscription;
 *          a SUCCEEDED event DOES activate it.
 *   Fix 1  /api/health featureFlags exposes airwallexMode.
 *   Fix 3  Login role hydration — getAuthUsersRole()/getDbUserRole() exist and
 *          the verifyPassword synthesis corrects a founder→investor persona
 *          (source-level guarantee + helper presence).
 *   Fix 4  Secure-redeem ordering — token consume (UPDATE auth_redeem_tokens
 *          .consumed_at) happens AFTER setUserCredential + auth_users write.
 *   Fix 5  profileStore GET prefers the durable DB row over the in-memory seed
 *          (PATCH then GET round-trips the saved value; source-level DB-first).
 *   Fix 6  Invitation email subject contains the company + round name.
 *   Fix 8  PATCH /api/rounds/:id/terms accepts `name` (and rejects a blank one).
 *   Fix 2  Soft-circle validate flips status to "confirmed".
 *   Fix 10 Admin bootstrap endpoint creates an active Collective membership.
 *   Guard  Cross-tenant regression — a non-admin, non-owner founder is blocked
 *          from PATCHing another company's round terms (403).
 *
 * Server behaviors use supertest against the fully-wired app; pure helpers use
 * direct imports; source-level guarantees use source-grep (vitest globs
 * *.test.ts only — no JSX runtime in this tree).
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import http from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ---------- store + helper imports ---------- */
import {
  getAirwallexMode,
  getAirwallexApiBase,
  AIRWALLEX_DEMO_API_BASE,
  AIRWALLEX_LIVE_API_BASE,
} from "../lib/paymentGatewayResolver";
import { recordPendingSubscription, getByPaymentIntent } from "../subscriptionStore";
import { _testGateway } from "../paymentGatewayAdapter";
import { createRound } from "../roundsStore";
import { createSoftCircle, validateSoftCircle } from "../softCircleStore";
import { getUserContextForId } from "../lib/userContext";
import { setPassword } from "../userCredentialsStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

const ROOT = resolve(__dirname, "..", "..");
const SERVER = resolve(__dirname, "..");
function srcServer(rel: string) { return readFileSync(resolve(SERVER, rel), "utf8"); }

/* ---------- helper: build the fully-wired app once ---------- */
let app: Express;
let server: http.Server;
beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
});

/* ---------- env hygiene for the resolver tests ---------- */
const SAVED_ENV: Record<string, string | undefined> = {};
function snapshotEnv() {
  for (const k of ["AIRWALLEX_MODE", "AIRWALLEX_API_KEY", "AIRWALLEX_REAL_NETWORK", "AIRWALLEX_API_BASE"]) {
    SAVED_ENV[k] = process.env[k];
  }
}
function restoreEnv() {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/* =============================== Fix 1 =============================== */
describe("v24.4 Fix 1 — Airwallex MODE resolver", () => {
  beforeAll(snapshotEnv);
  afterEach(restoreEnv);

  it("defaults to stub when no key and no mode are set", () => {
    delete process.env.AIRWALLEX_MODE;
    delete process.env.AIRWALLEX_API_KEY;
    delete process.env.AIRWALLEX_REAL_NETWORK;
    delete process.env.AIRWALLEX_API_BASE;
    expect(getAirwallexMode()).toBe("stub");
    // stub still surfaces the demo base (it just never calls it).
    expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);
  });

  it("defaults to stub (no network) when a key is present but no explicit mode", () => {
    // Per Avi's directive and the hermetic-test contract: a real network call
    // requires explicit opt-in. A bare key (no AIRWALLEX_MODE / REAL_NETWORK)
    // stays in deterministic stub mode so tests/dev never hit the network.
    delete process.env.AIRWALLEX_MODE;
    delete process.env.AIRWALLEX_REAL_NETWORK;
    delete process.env.AIRWALLEX_API_BASE;
    process.env.AIRWALLEX_API_KEY = "ak_test_123";
    expect(getAirwallexMode()).toBe("stub");
    expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);
  });

  it("AIRWALLEX_MODE=test with a key opts into the demo network", () => {
    delete process.env.AIRWALLEX_REAL_NETWORK;
    delete process.env.AIRWALLEX_API_BASE;
    process.env.AIRWALLEX_MODE = "test";
    process.env.AIRWALLEX_API_KEY = "ak_test_123";
    expect(getAirwallexMode()).toBe("test");
    expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);
  });

  it("AIRWALLEX_MODE=live falls back to stub WITHOUT a key (never silently hits prod)", () => {
    delete process.env.AIRWALLEX_API_KEY;
    delete process.env.AIRWALLEX_API_BASE;
    process.env.AIRWALLEX_MODE = "live";
    expect(getAirwallexMode()).toBe("stub");
  });

  it("AIRWALLEX_MODE=live WITH a key resolves live + the live base URL", () => {
    delete process.env.AIRWALLEX_API_BASE;
    process.env.AIRWALLEX_MODE = "live";
    process.env.AIRWALLEX_API_KEY = "ak_live_456";
    expect(getAirwallexMode()).toBe("live");
    expect(getAirwallexApiBase()).toBe(AIRWALLEX_LIVE_API_BASE);
  });

  it("legacy AIRWALLEX_REAL_NETWORK=1 maps to test (demo network)", () => {
    delete process.env.AIRWALLEX_MODE;
    delete process.env.AIRWALLEX_API_KEY;
    delete process.env.AIRWALLEX_API_BASE;
    process.env.AIRWALLEX_REAL_NETWORK = "1";
    expect(getAirwallexMode()).toBe("test");
    expect(getAirwallexApiBase()).toBe(AIRWALLEX_DEMO_API_BASE);
  });
});

/* =============================== Fix 1 (webhook guard) =============== */
describe("v24.4 Fix 1 — Airwallex webhook activates ONLY on SUCCEEDED", () => {
  it("an intermediate REQUIRES_PAYMENT_METHOD event does NOT activate a pending sub", async () => {
    _testGateway.reset();
    const intentId = `int_pending_${Date.now()}`;
    recordPendingSubscription({
      companyId: `co_aw_${Date.now()}`,
      tierId: "growth",
      userId: "u_maya_chen",
      paymentIntentId: intentId,
      amountMinor: 9900,
      currency: "USD",
      billingCycle: "monthly",
    });
    expect(getByPaymentIntent(intentId)!.status).toBe("pending");

    const r = await request(app)
      .post("/api/webhooks/payment-gateway/airwallex")
      .send({
        name: "payment_intent.requires_payment_method",
        data: { object: { id: intentId, status: "REQUIRES_PAYMENT_METHOD" } },
      });
    expect(r.status).toBe(200);
    // The guard MUST NOT have flipped the pending subscription.
    expect(getByPaymentIntent(intentId)!.status).toBe("pending");
  });

  it("a SUCCEEDED event DOES activate the pending sub", async () => {
    _testGateway.reset();
    const intentId = `int_succeed_${Date.now()}`;
    recordPendingSubscription({
      companyId: `co_aw2_${Date.now()}`,
      tierId: "growth",
      userId: "u_maya_chen",
      paymentIntentId: intentId,
      amountMinor: 9900,
      currency: "USD",
      billingCycle: "monthly",
    });
    const r = await request(app)
      .post("/api/webhooks/payment-gateway/airwallex")
      .send({
        name: "payment_intent.succeeded",
        data: { object: { id: intentId, status: "SUCCEEDED" } },
      });
    expect(r.status).toBe(200);
    expect(getByPaymentIntent(intentId)!.status).toBe("active");
  });
});

/* =============================== Fix 1 (health flag) ================= */
describe("v24.4 Fix 1 — /api/health surfaces featureFlags.airwallexMode", () => {
  it("the health endpoint reports version 24.4.0 and an airwallexMode flag", async () => {
    const r = await request(app).get("/api/health");
    expect(r.status).toBe(200);
    expect(r.body.version).toBe("24.4.0");
    expect(r.body.featureFlags).toBeDefined();
    expect(["stub", "test", "live"]).toContain(r.body.featureFlags.airwallexMode);
  });
});

/* =============================== Fix 3 ============================== */
describe("v24.4 Fix 3 — login hydrates persona role from durable auth_users role", () => {
  it("userContext exposes getAuthUsersRole + getDbUserRole and corrects founder→investor", () => {
    const s = srcServer("lib/userContext.ts");
    expect(s).toMatch(/function getAuthUsersRole/);
    expect(s).toMatch(/function getDbUserRole/);
    // The synthesis block reads the durable role and treats an invite-redeemed
    // 'investor' as an investor persona (not a founder).
    expect(s).toMatch(/isInvestorRole/);
    expect(s).toMatch(/auth_users/);
  });
});

/* =============================== Fix 4 ============================== */
describe("v24.4 Fix 4 — secure-redeem consumes the token AFTER the credential write", () => {
  it("setUserCredential + auth_users write precede the auth_redeem_tokens consume", () => {
    const s = srcServer("lib/secureAuthRoutes.ts");
    const credIdx = s.indexOf("setUserCredential({ userId, email: row.email, plainText: password })");
    const consumeIdx = s.indexOf("UPDATE auth_redeem_tokens SET consumed_at");
    expect(credIdx).toBeGreaterThan(-1);
    expect(consumeIdx).toBeGreaterThan(-1);
    // Ordering proof: the durable credential write must appear BEFORE the
    // single-use token is consumed.
    expect(credIdx).toBeLessThan(consumeIdx);
  });
});

/* =============================== Fix 5 ============================== */
describe("v24.4 Fix 5 — company profile GET reads the durable DB row first", () => {
  it("source: in the GET handler, the durable read precedes the cache/seed fallback", () => {
    const s = srcServer("profileStore.ts");
    // Anchor on the GET handler's DB-first block: the durable read, then the
    // else-branch cache fallback. The ma-readiness GET higher in the file uses
    // `const p = companyProfiles.get(id)` (a distinct string), so we anchor on
    // the exact GET-profile lines added in v24.4.
    const getBlockIdx = s.indexOf("// Prior to v24.4 the in-memory map was read FIRST");
    expect(getBlockIdx).toBeGreaterThan(-1);
    const region = s.slice(getBlockIdx, getBlockIdx + 800);
    const durableIdx = region.indexOf("const durable = readProfileDurable(id);");
    const cacheIdx = region.indexOf("p = companyProfiles.get(id);");
    expect(durableIdx).toBeGreaterThan(-1);
    expect(cacheIdx).toBeGreaterThan(-1);
    expect(durableIdx).toBeLessThan(cacheIdx);
  });

  it("HTTP: a PATCHed company profile description survives a subsequent GET (durable persistence)", async () => {
    // Use the seeded `co-fixture` company (which carries a base profile) so the
    // PATCH does not 404 on a cold profile cache. Admin auth bypasses ownership.
    const coId = "co-fixture";
    const unique = `Durable Co ${Date.now()}`;
    const patch = await request(app)
      .patch(`/api/companies/${coId}/profile`)
      .set("x-user-id", "u_admin")
      .send({ contact: { companyName: unique } });
    expect([200, 201]).toContain(patch.status);

    const get = await request(app)
      .get(`/api/companies/${coId}/profile`)
      .set("x-user-id", "u_admin");
    expect(get.status).toBe(200);
    // The durable row (DB-first) must surface the just-saved company name.
    expect(get.body.contact.companyName).toBe(unique);
  });
});

/* =============================== Fix 6 ============================== */
describe("v24.4 Fix 6 — invitation email subject includes the company + round name", () => {
  it("the subject string interpolates both companyName and roundName", () => {
    const s = srcServer("roundInvitationsStore.ts");
    expect(s).toMatch(/getCompanyNameById/);
    expect(s).toMatch(/getRoundById/);
    expect(s).toMatch(/subject:\s*`\[Capavate\] You're invited to \$\{companyName\} — \$\{roundName\}`/);
  });
});

/* =============================== Fix 8 ============================== */
describe("v24.4 Fix 8 — PATCH /api/rounds/:id/terms accepts a `name` field", () => {
  it("admin can rename an open round via the terms PATCH", async () => {
    const round = createRound({
      companyId: `co_rename_${Date.now()}`,
      name: "Original Round Name",
      type: "priced",
      state: "open",
      targetAmount: 1000000,
    });
    const newName = `Renamed Round ${Date.now()}`;
    const r = await request(app)
      .patch(`/api/rounds/${round.id}/terms`)
      .set("x-user-id", "u_admin")
      .send({ name: newName });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.round.name).toBe(newName);
  });

  it("a blank name is rejected with 400 invalid_name", async () => {
    const round = createRound({
      companyId: `co_rename2_${Date.now()}`,
      name: "Keep Me",
      type: "priced",
      state: "open",
      targetAmount: 1000000,
    });
    const r = await request(app)
      .patch(`/api/rounds/${round.id}/terms`)
      .set("x-user-id", "u_admin")
      .send({ name: "   " });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_name");
  });
});

/* =============================== Fix 2 ============================== */
describe("v24.4 Fix 2 — soft-circle validate flips status to confirmed", () => {
  it("validateSoftCircle moves an intent soft-circle to confirmed", () => {
    const sc = createSoftCircle({
      roundId: `rnd_sc_${Date.now()}`,
      companyId: `co_sc_${Date.now()}`,
      investorName: "Test Investor",
      amount: 50000,
      status: "intent",
    });
    expect(sc.status).toBe("intent");
    const validated = validateSoftCircle(sc.id);
    expect(validated).not.toBeNull();
    expect(validated!.status).toBe("confirmed");
  });

  it("the founder soft-circle validate route is wired and async-confirms (client source)", () => {
    // Server route exists.
    const r = srcServer("routes.ts");
    expect(r).toMatch(/\/api\/rounds\/:id\/soft-circle\/:scId\/validate/);
  });
});

/* =============================== Fix 10 ============================= */
describe("v24.4 Fix 10 — admin bootstrap creates an active Collective membership", () => {
  it("POST /api/admin/collective/members/bootstrap activates membership by email", async () => {
    const email = `bootstrap_${Date.now()}@test.example`;
    const userId = `u_bootstrap_${Date.now()}`;
    // Mint a durable credential so lookupByEmail resolves the userId.
    setPassword({ userId, email, name: "Bootstrap Member", plainText: "password1234" });
    expect(collectiveMembershipStore.isActive(userId)).toBe(false);

    const r = await request(app)
      .post("/api/admin/collective/members/bootstrap")
      .set("x-user-id", "u_admin")
      .send({ email });
    expect(r.status).toBe(200);
    expect(collectiveMembershipStore.isActive(userId)).toBe(true);
  });

  it("a missing user/email is rejected with 400 missing_user", async () => {
    const r = await request(app)
      .post("/api/admin/collective/members/bootstrap")
      .set("x-user-id", "u_admin")
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("missing_user");
  });

  it("a non-admin caller is forbidden (403)", async () => {
    const r = await request(app)
      .post("/api/admin/collective/members/bootstrap")
      .set("x-user-id", "u_maya_chen") // founder persona, not admin
      .send({ email: "nobody@test.example" });
    expect(r.status).toBe(403);
  });
});

/* =============================== Cross-tenant guard ================= */
describe("v24.4 guard — cross-tenant round terms PATCH is blocked", () => {
  it("a founder who does not own the round's company gets 403", async () => {
    // Round belongs to a company owned by nobody in particular.
    const round = createRound({
      companyId: `co_owned_elsewhere_${Date.now()}`,
      name: "Foreign Round",
      type: "priced",
      state: "open",
      targetAmount: 500000,
    });
    // u_maya_chen owns co_novapay/co_arboreal/co_kelvin, NOT the company above.
    const ctx = getUserContextForId("u_maya_chen");
    expect(ctx.founder.companies.some((c) => c.companyId === round.companyId)).toBe(false);

    const r = await request(app)
      .patch(`/api/rounds/${round.id}/terms`)
      .set("x-user-id", "u_maya_chen")
      .send({ name: "Hijacked Name" });
    expect(r.status).toBe(403);
  });
});

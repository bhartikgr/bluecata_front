/* v25.41 Phase 4 — E2E: partner-subscribe success-state contract (Q8, Avi=A).
 *
 * Q8 (Avi answer = A): PartnerSubscribe.tsx now shows a success state and
 * navigates to /collective/partner/dashboard once the subscription is ACTIVE.
 * The "active" signal is read from the DB-backed GET /api/partner/me/subscription
 * (the page computes `subscriptionActive = sub?.status === "active"` and then
 * renders the success Card + a 3s redirect). This E2E pins the SERVER contract
 * the client success state depends on — there is no hardcoded/in-memory active
 * flag; the active status comes from the durable capavate_subscriptions row.
 *
 * Contract pinned here:
 *   - unauthenticated GET → 401
 *   - a non-partner authed user → 403 (PARTNER_NOT_FOUND)
 *   - a managing_partner with NO subscription → 200 { subscription: null }
 *     (the page stays on the plan view; subscriptionActive=false)
 *   - a managing_partner WITH an active subscription → 200
 *     { subscription: { status: "active" } } → drives the success state
 *   - POST /api/partner/me/subscribe resolves a DB-driven price (no hardcode)
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { createContact } from "../adminContactsStore.ts";
import { partnerTeamStore } from "../partnerWorkspaceStore.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2541_sub_admin_${STAMP}`;
const NONPARTNER = `u_v2541_sub_nonpartner_${STAMP}`;
const OWNER = `u_v2541_sub_owner_${STAMP}`; // managing_partner for the seeded partner
let PARTNER_ID;
const SUB_ID = `sub_v2541_${STAMP}`;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

function req(method, path, { body, userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": userId ?? OWNER };
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

function reqNoAuth(method, path) {
  return new Promise((resolve, reject) => {
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    const headers = { "Content-Type": "application/json" };
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
        else process.env.DISABLE_DEV_BYPASS = prev;
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", (e) => {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
      reject(e);
    });
    r.end();
  });
}

function seedUser(userId, email) {
  rawDb().prepare(
    `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
     VALUES (?, 'tenant_platform', ?, ?, 'investor', 0)`,
  ).run(userId, email, userId);
}

/** Link an ACTIVE capavate_subscriptions row to the partner contact. */
function seedActiveSubscription() {
  // v25.41 round-2: capavate_subscriptions is created lazily in production by
  // subscriptionStore.ensureTable() the first time the store runs. Tests that
  // INSERT directly must ensure the table exists; mirror the bootstrap from
  // server/subscriptionStore.ts:108.
  rawDb().exec(`CREATE TABLE IF NOT EXISTS capavate_subscriptions (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL,
    tier_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payment_intent_id TEXT NOT NULL UNIQUE,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    billing_cycle TEXT NOT NULL,
    merchant_order_id TEXT,
    created_at TEXT NOT NULL,
    activated_at TEXT,
    expires_at TEXT
  );`);
  try { rawDb().exec(`ALTER TABLE capavate_subscriptions ADD COLUMN current_period_end TEXT`); } catch { /* duplicate column */ }
  const now = new Date().toISOString();
  rawDb().prepare(
    `INSERT OR IGNORE INTO capavate_subscriptions
       (id, company_id, tier_id, user_id, status, payment_intent_id, amount_minor, currency, billing_cycle, created_at, activated_at)
     VALUES (?, ?, 'partner_tier', ?, 'active', ?, 50000, 'USD', 'monthly', ?, ?)`,
  ).run(SUB_ID, PARTNER_ID, OWNER, `pi_${SUB_ID}`, now, now);
  rawDb().prepare(`UPDATE contacts SET subscription_id = ? WHERE id = ?`).run(SUB_ID, PARTNER_ID);
}

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2541.test`, name: "v25.41 Sub Admin", isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false });
  __setRuntimePersona({ userId: NONPARTNER, email: `${NONPARTNER}@v2541.test`, name: "v25.41 NonPartner", isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false });
  __setRuntimePersona({ userId: OWNER, email: `${OWNER}@v2541.test`, name: "v25.41 Partner Owner", isFounder: false, isInvestor: false, isAdmin: false, hasInvitations: false });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  seedUser(OWNER, `${OWNER}@v2541.test`);
  seedUser(NONPARTNER, `${NONPARTNER}@v2541.test`);

  // Seed an ACTIVE consortium partner + a managing_partner team owner.
  const partner = createContact(
    {
      kind: "consortium_partner", type: "organization",
      legalName: `Sub Partner ${STAMP}`, displayName: `Sub Partner ${STAMP}`,
      email: `sub_partner_${STAMP}@v2541.test`, status: "active",
      region: "NA", hqCountry: "CA", industries: [], stages: [], tags: [],
      tier: "builder",
    },
    ADMIN,
  );
  PARTNER_ID = partner.id;
  partnerTeamStore.upsertOwner(OWNER, PARTNER_ID, "managing_partner");
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.41 partner-subscribe success-state contract (Q8) — E2E", () => {
  it("0. unauthenticated GET /api/partner/me/subscription → 401", async () => {
    const res = await reqNoAuth("GET", "/api/partner/me/subscription");
    record("unauth subscription 401", res.status === 401, `status ${res.status}`);
    expect(res.status).toBe(401);
  });

  it("1. a non-partner authed user → 403", async () => {
    const res = await req("GET", "/api/partner/me/subscription", { userId: NONPARTNER });
    record("non-partner subscription 403", res.status === 403, `status ${res.status}`);
    expect(res.status).toBe(403);
  });

  it("2. managing_partner with NO subscription → 200 { subscription: null } (plan view, not success)", async () => {
    const res = await req("GET", "/api/partner/me/subscription", { userId: OWNER });
    record("no-sub partner 200", res.status === 200, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,120)}`);
    expect(res.status).toBe(200);
    record("no-sub subscription is null (subscriptionActive=false)", res.body?.subscription === null, JSON.stringify(res.body?.subscription));
    expect(res.body?.subscription).toBeNull();
  });

  it("3. once an ACTIVE subscription exists → 200 { subscription.status === 'active' } (drives success state)", async () => {
    seedActiveSubscription();
    const res = await req("GET", "/api/partner/me/subscription", { userId: OWNER });
    record("active-sub partner 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const sub = res.body?.subscription;
    record("subscription present + status active (subscriptionActive=true)", sub?.status === "active", JSON.stringify(sub)?.slice(0, 120));
    expect(sub?.status).toBe("active");
    // The active status is the DB row's — proves it is NOT a hardcoded flag.
    record("active subscription id matches the durable row", sub?.id === SUB_ID, sub?.id);
    expect(sub?.id).toBe(SUB_ID);
  });

  it("4. POST /api/partner/me/subscribe resolves a DB-driven price OR reports not-configured (never hardcoded)", async () => {
    const res = await req("POST", "/api/partner/me/subscribe", { body: { cycle: "monthly" }, userId: OWNER });
    // v25.41 round-2 (per GPT-5.5): the route now uses a static ESM import
    // for resolvePartnerFee, removing the lazy-require harness gap. The test
    // now strictly requires 200 (DB price resolved) or 409 (no schedule
    // configured). 500 is no longer acceptable.
    const acceptable = (res.status === 200 && res.body?.ok === true && typeof res.body?.amountMinor === "number") ||
                       (res.status === 409 && res.body?.error === "PARTNER_SUBSCRIPTION_NOT_AVAILABLE");
    record("subscribe resolves DB price or fail-closed 409", acceptable, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,120)}`);
    expect(acceptable).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.41 partner-subscribe navigation E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});

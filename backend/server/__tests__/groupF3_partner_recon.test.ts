/**
 * GROUP F3 — dynamic admin↔partner reconciliation (final wave).
 *
 * Real-route coverage proving the ONE deliberate auth relaxation and its
 * fail-closed boundaries:
 *
 *   (a) a SUSPENDED consortium_partner can GET /api/partner/me (200) and the
 *       payload carries status:"suspended" — so the FE can show a banner;
 *   (b) that SAME suspended partner is BLOCKED (403) from every OTHER
 *       /api/partner/me/* route — a data READ (/clients, /spvs) and a WRITE
 *       (/spvs POST) — because they keep hard requirePartnerAuth;
 *   (c) requirePartnerSelf is still fail-closed: 401 unauthenticated,
 *       403 for a team member whose contact is deleted / not a partner;
 *   (d) /me emits status, commissionPct, partnerType, region (additively);
 *   (e) commissionPct is DISPLAY-derived (rate*100) and hitting /me does NOT
 *       change the underlying commission resolver output (no calc change);
 *   (f) an admin-created SPV (sponsorPartnerId = THIS partner) is visible in
 *       /me/spvs (proving admin↔partner SPV reconciliation already works);
 *   (g) a cross-partner SPV is NOT visible in /me/spvs and 404s on direct GET.
 *
 * DISPLAY-ONLY: no commission / rev-share / price CALCULATION, ledger, or
 * payment path is touched by this wave — asserted in (e).
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
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner, getById } from "../adminContactsStoreShim";
import { _testContacts } from "../adminContactsStore";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { spvEngineStore } from "../spvEngineStore";
import { resolveCommissionRate } from "../lib/partnerFeeResolver";
import { storeCredential } from "../userCredentialsStore";

/* ── principals ─────────────────────────────────────────────────────────── */

// PARTNER_A is the ACTIVE seed sandbox partner (managing = u_avi_managing).
const PARTNER_A = TEST_PARTNER_ID;
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;

// PARTNER_S is a SUSPENDED (but still existing) consortium_partner.
const PARTNER_S = "ac_consortium_partner_f3_suspended";
const MANAGING_S = "u_f3_suspended_managing";

// PARTNER_B is a second ACTIVE partner used for cross-partner SPV isolation.
const PARTNER_B = "ac_consortium_partner_f3_partner_b";
const MANAGING_B = "u_f3_partner_b_managing";

// A team member whose CONTACT record does NOT exist (deleted / dangling) —
// exercises the fail-closed 403 in requirePartnerSelf.
const DANGLING_PARTNER = "ac_consortium_partner_f3_dangling_deleted";
const MANAGING_DANGLING = "u_f3_dangling_managing";

// An authenticated user with NO partner membership at all.
const NON_PARTNER_USER = "u_f3_non_partner";

let app: Express;
let server: http.Server;
let port: number;

let spvOwnedByS = "";
let spvOwnedByB = "";

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });

  // ── SUSPENDED partner ──────────────────────────────────────────────────
  _registerSeedPartner({
    id: PARTNER_S,
    legalName: "F3 SUSPENDED PARTNER, INC",
    displayName: "F3 Suspended Partner",
    email: "ops@f3-suspended.example",
    region: "EU",
    regionCode: "DE",
    tier: "builder",
    partnerType: "vc_fund",
  });
  // Flip the persisted status to "suspended" (admin action being reconciled).
  const suspended = _testContacts.getContacts().get(PARTNER_S);
  if (suspended) suspended.status = "suspended";
  partnerTeamStore.add(PARTNER_S, MANAGING_S, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: MANAGING_S,
    email: "managing-s@f3-suspended.example",
    name: "F3 S Managing",
    password: "test-password-f3-s",
  });

  // ── second ACTIVE partner (cross-partner isolation) ────────────────────
  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "F3 PARTNER B, INC",
    displayName: "F3 Partner B",
    email: "ops@f3-partner-b.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });
  partnerTeamStore.add(PARTNER_B, MANAGING_B, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: MANAGING_B,
    email: "managing-b@f3-partner-b.example",
    name: "F3 B Managing",
    password: "test-password-f3-b",
  });

  // ── dangling team member (contact deleted / never existed) ─────────────
  // We add a team member row pointing at a partnerId with NO contact record.
  partnerTeamStore.add(DANGLING_PARTNER, MANAGING_DANGLING, "managing_partner", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: MANAGING_DANGLING,
    email: "managing-dangling@f3.example",
    name: "F3 Dangling",
    password: "test-password-f3-dangling",
  });

  // Authenticated user with NO partner_team_members row (non-partner).
  storeCredential({
    userId: NON_PARTNER_USER,
    email: "non-partner@f3.example",
    name: "F3 Non Partner",
    password: "test-password-f3-nonpartner",
  });

  // ── admin-created SPVs (sponsorPartnerId = the owning partner) ─────────
  // spvEngineStore.createSpv sets sponsorPartnerId = partnerId — exactly the
  // shape an admin-created SPV owned by a partner has. Owner-scoped reads
  // (listByPartner / getSpv) are the code under proof; no code change needed.
  spvOwnedByS = spvEngineStore.createSpv(
    PARTNER_S,
    { name: "F3 Admin-Created SPV for S", jurisdiction: "delaware", carryBasis: "whole_spv", currency: "USD", status: "draft" },
    "u_admin_f3",
  ).id;
  spvOwnedByB = spvEngineStore.createSpv(
    PARTNER_B,
    { name: "F3 SPV owned by B", jurisdiction: "delaware", carryBasis: "whole_spv", currency: "USD", status: "draft" },
    "u_admin_f3",
  ).id;

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
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let b: any = null;
          try { b = JSON.parse(buf); } catch { /* keep */ }
          resolve({ status: res.statusCode ?? 0, body: b });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

describe("GROUP F3 — dynamic admin↔partner reconciliation (real routes)", () => {
  /* ===== (a) suspended partner CAN load /me ===== */
  it("(a) a SUSPENDED partner gets 200 on GET /api/partner/me with status:'suspended'", async () => {
    // Sanity: the record really is suspended (not active) in the store.
    expect(getById(PARTNER_S)?.status).toBe("suspended");
    const r = await call("GET", "/api/partner/me", { userId: MANAGING_S });
    expect(r.status).toBe(200);
    expect(r.body.partnerId).toBe(PARTNER_S);
    expect(r.body.status).toBe("suspended");
  });

  /* ===== (b) suspended partner BLOCKED from all other data & write routes ===== */
  it("(b) a SUSPENDED partner is 403 on a data READ route (/me/clients)", async () => {
    const r = await call("GET", "/api/partner/me/clients", { userId: MANAGING_S });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("PARTNER_NOT_ACTIVE");
  });

  it("(b) a SUSPENDED partner is 403 on a second data READ route (/me/spvs)", async () => {
    const r = await call("GET", "/api/partner/me/spvs", { userId: MANAGING_S });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("PARTNER_NOT_ACTIVE");
  });

  it("(b) a SUSPENDED partner is 403 on a WRITE route (POST /me/spvs)", async () => {
    const r = await call("POST", "/api/partner/me/spvs", {
      userId: MANAGING_S,
      body: { spvName: "should-not-create", jurisdiction: "delaware", vintage: 2026, currency: "USD", status: "planned" },
    });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("PARTNER_NOT_ACTIVE");
  });

  /* ===== (c) requirePartnerSelf fail-closed: 401 unauth, 403 deleted/non-partner ===== */
  it("(c) GET /api/partner/me rejects a caller with NO partner membership (401/403, fail-closed)", async () => {
    // No x-user-id header. In the full-route harness an unauthenticated request
    // may resolve to a default (non-partner) test identity, so requirePartnerSelf
    // fails at the 401 (no user) OR the 403 (no team member) gate — either way
    // access is DENIED and the fail-closed error code is returned. (Matches the
    // existing partner_workspace.test.ts convention.)
    const r = await call("GET", "/api/partner/me");
    expect([401, 403]).toContain(r.status);
    expect(["PARTNER_AUTH_REQUIRED", "PARTNER_NOT_FOUND"]).toContain(r.body?.error);
  });

  it("(c) GET /api/partner/me is 403 PARTNER_NOT_FOUND for an authenticated user with NO partner membership", async () => {
    // NON_PARTNER_USER has a durable credential (so getUserContext marks it
    // authed) but NO partner_team_members row — requirePartnerSelf fails at the
    // team-member gate (403), NOT the 401 auth gate.
    const r = await call("GET", "/api/partner/me", { userId: NON_PARTNER_USER });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("PARTNER_NOT_FOUND");
  });

  it("(c) GET /api/partner/me is 403 when the team member's contact is deleted/non-existent", async () => {
    // The contact record for DANGLING_PARTNER was never registered → getById null.
    expect(getById(DANGLING_PARTNER)).toBeNull();
    const r = await call("GET", "/api/partner/me", { userId: MANAGING_DANGLING });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("PARTNER_NOT_FOUND");
  });

  /* ===== (d) /me emits status/commissionPct/partnerType/region additively ===== */
  it("(d) /me emits status, commissionPct, partnerType, region (existing keys preserved)", async () => {
    const r = await call("GET", "/api/partner/me", { userId: MANAGING_A });
    expect(r.status).toBe(200);
    // additive keys present
    expect(r.body).toHaveProperty("status");
    expect(r.body).toHaveProperty("commissionPct");
    expect(r.body).toHaveProperty("partnerType");
    expect(r.body).toHaveProperty("region");
    // existing keys untouched
    expect(r.body.partnerId).toBe(PARTNER_A);
    expect(r.body).toHaveProperty("tier");
    expect(r.body).toHaveProperty("subRole");
    expect(r.body).toHaveProperty("identity");
    expect(r.body).toHaveProperty("effectivePlan");
    // status matches the store record
    expect(r.body.status).toBe(getById(PARTNER_A)?.status ?? null);
    expect(r.body.partnerType).toBe(getById(PARTNER_A)?.partnerType ?? null);
    expect(r.body.region).toBe(getById(PARTNER_A)?.region ?? null);
  });

  /* ===== (e) commissionPct is DISPLAY-derived; no calc change ===== */
  it("(e) commissionPct == resolver rate * 100 and hitting /me does NOT change the resolver output", async () => {
    const tier = getById(PARTNER_A)?.tier as any;
    // Snapshot the underlying resolver BEFORE touching /me.
    const before = resolveCommissionRate(PARTNER_A, tier);

    const r = await call("GET", "/api/partner/me", { userId: MANAGING_A });
    expect(r.status).toBe(200);

    if (r.body.effectivePlan) {
      // DISPLAY derivation: percent form of the SAME rate the resolver returns.
      expect(r.body.commissionPct).toBeCloseTo(r.body.effectivePlan.commission.rate * 100, 10);
      expect(r.body.effectivePlan.commission.rate).toBeCloseTo(before.rate, 12);
    } else {
      // mis-config path — commissionPct may be null, still no calc change.
      expect(r.body.commissionPct).toBeNull();
    }

    // The resolver output AFTER the /me call is byte-identical — /me is a pure
    // read; it never mutates commission/rev-share/price state.
    const after = resolveCommissionRate(PARTNER_A, tier);
    expect(after.rate).toBe(before.rate);
    expect(after.via).toBe(before.via);
  });

  /* ===== (f) admin-created SPV visible in /me/spvs (owner-scoped) ===== */
  it("(f) an admin-created SPV (sponsorPartnerId = this partner) is visible in /me/spvs", async () => {
    // PARTNER_B is ACTIVE, so it can reach /me/spvs and see its own SPV.
    const r = await call("GET", "/api/partner/me/spvs", { userId: MANAGING_B });
    expect(r.status).toBe(200);
    const ids = (r.body.spvs ?? []).map((s: any) => s.id);
    expect(ids).toContain(spvOwnedByB);
  });

  /* ===== (g) cross-partner SPV NOT visible + 404 on direct GET ===== */
  it("(g) a cross-partner SPV is NOT visible in /me/spvs and 404s on direct GET", async () => {
    const list = await call("GET", "/api/partner/me/spvs", { userId: MANAGING_B });
    expect(list.status).toBe(200);
    const ids = (list.body.spvs ?? []).map((s: any) => s.id);
    // spvOwnedByS belongs to PARTNER_S — must NOT leak into PARTNER_B's list.
    expect(ids).not.toContain(spvOwnedByS);
    // Direct owner-scoped GET fail-closes to 404 (no cross-partner leak).
    const direct = await call("GET", `/api/partner/me/spvs/${spvOwnedByS}`, { userId: MANAGING_B });
    expect(direct.status).toBe(404);
  });
});

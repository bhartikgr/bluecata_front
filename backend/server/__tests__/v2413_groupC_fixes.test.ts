/**
 * v23.4.13 Group C — Server-side fixes tests
 *
 * C.1 B-301: GET carry-forward for new (unknown) company → 200 + empty-but-valid CarryForwardResult (L-012 follow-up: never null)
 * C.2 L-003: POST /api/founder/companies/new with selectedPlan='founder_free'
 *            → subscription tier='founder_free' AND status='active' (not 'pending_payment')
 * C.3 L-006: createInvitation returns redeemUrl matching /\/invite\/[a-f0-9]+$/
 * C.4 L-010: createInvitation upserts CRM contact — listContactsForCompany returns matching entry
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { registerFounderUser } from "../lib/userContext";
import { getSubscription } from "../subscriptionsStore";
import {
  createInvitation,
  _testAccessInvitations,
} from "../roundInvitationsStore";
import { listContactsForCompany } from "../founderCrmStore";

/* -------- App builder (same pattern as v2347_company_default_plan) -------- */

async function buildApp() {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  const server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
  return { app, server };
}

async function rawRequest(
  app: express.Express,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const data = body === undefined ? "" : JSON.stringify(body);
  const result = await new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request(
      {
        method,
        host: "127.0.0.1",
        port,
        path: url,
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(data)),
          ...headers,
        },
      },
      (resp) => {
        let chunks = "";
        resp.on("data", (c: Buffer) => (chunks += c.toString()));
        resp.on("end", () => {
          let parsed: any = null;
          try { parsed = chunks ? JSON.parse(chunks) : null; } catch { parsed = chunks; }
          resolve({ status: resp.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
  server.close();
  return result;
}

/* ====================================================================
 * C.1  B-301 — carry-forward returns 200 + null for new/unknown company
 * ==================================================================== */
describe("C.1 B-301 — carry-forward graceful empty for new company", () => {
  it("GET /api/founder/companies/{new-id}/carry-forward?roundType=priced_equity → 200 + empty-but-valid CarryForwardResult (L-012 follow-up)", async () => {
    const { app } = await buildApp();
    const { userId } = registerFounderUser({
      email: `gc1_${Date.now()}@test.example`,
      name: "GC1 Founder",
      password: "password12345",
    });

    // Create a brand-new company that won't be in the static seed
    const createResp = await rawRequest(
      app,
      "POST",
      "/api/founder/companies/new",
      { name: "New Company B301", sector: "SaaS" },
      { "x-user-id": userId },
    );
    expect(createResp.status).toBe(201);
    const newCompanyId = createResp.body.companyId as string;
    expect(newCompanyId).toBeTruthy();

    // Now request carry-forward for this new company — should return 200 + null
    const r = await rawRequest(
      app,
      "GET",
      `/api/founder/companies/${newCompanyId}/carry-forward?roundType=priced_equity`,
      undefined,
      { "x-user-id": userId },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.result).toBeDefined();
    // L-012 follow-up to B-301: server returns a full empty-shape CarryForwardResult
    // (companyId, proposedRoundType, computedAt, fields: {}, unrealizedInstruments: [],
    //  warnings: [...], auditDigest: "") instead of `carryForward: null`.
    // This shape keeps `Object.keys(result.fields)` working on the wizard.
    expect(r.body.result.companyId).toBe(newCompanyId);
    expect(r.body.result.proposedRoundType).toBe("priced_equity");
    expect(r.body.result.fields).toEqual({});
    expect(r.body.result.unrealizedInstruments).toEqual([]);
    expect(Array.isArray(r.body.result.warnings)).toBe(true);
    expect(r.body.result.warnings.length).toBeGreaterThan(0);
  });
});

/* ====================================================================
 * C.2  L-003 — founder_free auto-activates on company create
 * ==================================================================== */
describe("C.2 L-003 — founder_free auto-activates on company create", () => {
  it("POST /api/founder/companies/new with selectedPlan='founder_free' → tier='founder_free' + status='active'", async () => {
    const { app } = await buildApp();
    const { userId } = registerFounderUser({
      email: `gc2_${Date.now()}@test.example`,
      name: "GC2 Founder",
      password: "password12345",
    });

    const r = await rawRequest(
      app,
      "POST",
      "/api/founder/companies/new",
      { name: "Auto-activate Free Co", sector: "FinTech", selectedPlan: "founder_free" },
      { "x-user-id": userId },
    );
    expect(r.status).toBe(201);
    const companyId = r.body.companyId as string;
    expect(companyId).toBeTruthy();

    const sub = getSubscription(companyId);
    expect(sub).not.toBeNull();
    expect(sub!.plan).toBe("founder_free");
    // L-003 fix: must be 'active', NOT 'pending_payment'
    expect(sub!.status).toBe("active");
    expect(sub!.status).not.toBe("pending_payment");
  });

  it("POST /api/founder/companies/new with plan='founder_free' → tier='founder_free' + status='active'", async () => {
    const { app } = await buildApp();
    const { userId } = registerFounderUser({
      email: `gc2b_${Date.now()}@test.example`,
      name: "GC2b Founder",
      password: "password12345",
    });

    const r = await rawRequest(
      app,
      "POST",
      "/api/founder/companies/new",
      { name: "Auto-activate Free Co B", sector: "FinTech", plan: "founder_free" },
      { "x-user-id": userId },
    );
    expect(r.status).toBe(201);
    const companyId = r.body.companyId as string;
    const sub = getSubscription(companyId);
    expect(sub).not.toBeNull();
    expect(sub!.plan).toBe("founder_free");
    expect(sub!.status).toBe("active");
  });
});

/* ====================================================================
 * C.3  L-006 — createInvitation returns redeemUrl
 * ==================================================================== */
describe("C.3 L-006 — createInvitation returns redeemUrl", () => {
  it("result.redeemUrl is a string matching /\\/invite\\/[a-f0-9]+$/", async () => {
    _testAccessInvitations.reset();
    const result = await createInvitation({
      roundId: "rnd_test_c3",
      companyId: "co_test_c3",
      investorEmail: `investor_c3_${Date.now()}@test.example`,
      investorName: "C3 Test Investor",
      invitedByUserId: "u_test_c3",
      dryRun: true,
    });
    expect(typeof result.redeemUrl).toBe("string");
    expect(result.redeemUrl).toMatch(/\/invite\/[a-f0-9]+$/);
  });

  it("redeemUrl contains the raw 64-char hex token", async () => {
    _testAccessInvitations.reset();
    const result = await createInvitation({
      roundId: "rnd_test_c3b",
      companyId: "co_test_c3b",
      investorEmail: `investor_c3b_${Date.now()}@test.example`,
      investorName: "C3b Test Investor",
      invitedByUserId: "u_test_c3b",
      dryRun: true,
    });
    // Extract token from URL — last path segment after /invite/
    const urlParts = result.redeemUrl.split("/invite/");
    expect(urlParts.length).toBe(2);
    const rawTokenFromUrl = decodeURIComponent(urlParts[1]);
    // Raw token should be 64 hex chars (32 bytes)
    expect(rawTokenFromUrl).toMatch(/^[a-f0-9]{64}$/);
    // Hash of rawToken should equal tokenHash in the stored row
    const storedHash = _testAccessInvitations.hashToken(rawTokenFromUrl);
    const storedRow = _testAccessInvitations.rows.find(
      (r) => r.investorEmail === result.invitation.investorEmail,
    );
    expect(storedRow).toBeDefined();
    expect(storedRow!.tokenHash).toBe(storedHash);
  });
});

/* ====================================================================
 * C.4  L-010 — createInvitation upserts CRM contact
 * ==================================================================== */
describe("C.4 L-010 — createInvitation upserts CRM contact", () => {
  it("after createInvitation, listContactsForCompany includes the invited email", async () => {
    _testAccessInvitations.reset();
    const companyId = `co_l010_${Date.now()}`;
    const investorEmail = `investor_l010_${Date.now()}@test.example`;
    const investorName = "L010 Test Investor";

    await createInvitation({
      roundId: "rnd_l010_test",
      companyId,
      investorEmail,
      investorName,
      invitedByUserId: "u_l010_test",
      dryRun: true,
    });

    const contacts = listContactsForCompany(companyId);
    const found = contacts.find(
      (c) => c.email.toLowerCase() === investorEmail.toLowerCase(),
    );
    expect(found).toBeDefined();
    expect(found!.companyId).toBe(companyId);
  });

  it("second invitation for same email does not duplicate the CRM contact", async () => {
    _testAccessInvitations.reset();
    const companyId = `co_l010b_${Date.now()}`;
    const investorEmail = `investor_l010b_${Date.now()}@test.example`;

    await createInvitation({
      roundId: "rnd_l010b_test",
      companyId,
      investorEmail,
      investorName: "L010b Test Investor",
      invitedByUserId: "u_l010b_test",
      dryRun: true,
    });
    await createInvitation({
      roundId: "rnd_l010b_test",
      companyId,
      investorEmail, // same email second time
      investorName: "L010b Test Investor",
      invitedByUserId: "u_l010b_test",
      dryRun: true,
    });

    const contacts = listContactsForCompany(companyId);
    const matches = contacts.filter(
      (c) => c.email.toLowerCase() === investorEmail.toLowerCase(),
    );
    // Should only have one CRM entry (idempotent upsert)
    expect(matches.length).toBe(1);
  });
});

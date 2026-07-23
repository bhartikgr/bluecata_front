/**
 * W-FIX3 F1b — investor invitations LIST handler companyId backfill.
 *
 * The DETAIL handler (`GET /api/investor/invitations/:id`, routes.ts ~L2463)
 * already backfills a null invitation companyId from the round record. The LIST
 * handler (`GET /api/investor/invitations`, routes.ts ~L2414) did NOT — it
 * emitted `companyId:null` / `company.id:""` for a null-companyId row, which
 * silently suppressed the investor's company / cap-table links.
 *
 * This test locks the LIST-path fix (mirrors DETAIL EXACTLY):
 *  (1) a null-companyId invitation whose round HAS a companyId now surfaces the
 *      resolved companyId in the LIST response (top-level + company.id); and
 *  (2) a genuinely company-less row (round missing / round.companyId null) stays
 *      "" — no over-inclusion, no fabricated id.
 *
 * Runs on the PRODUCTION invitation path (DEMO_SEED_ENABLED=false), so this file
 * must NOT be run with ENABLE_DEMO_SEED=1 (the demo gate short-circuits the LIST
 * handler to the in-memory mock array). It authenticates as the static investor
 * persona u_lapsed_lp (email lp@lapsed-fund.example — no demo identity overlay,
 * so identity.email is deterministic).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

// Force the PRODUCTION invitation path regardless of the process-wide
// ENABLE_DEMO_SEED=1 used by the other wfix3 suites: with the demo gate open the
// LIST handler short-circuits to the in-memory mock array and never reaches the
// F1b backfill under test. Scoped to this file only (vi.mock is per-module-graph).
vi.mock("../lib/demoGate", () => ({
  DEMO_SEED_ENABLED: false,
  isDemoSeedEnabled: () => false,
}));

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { createRound } from "../roundsStore";
import { _testAccessInvitations } from "../roundInvitationsStore";

let app: Express;
let server: http.Server;

const INVESTOR_ID = "u_lapsed_lp";
const INVESTOR_EMAIL = "lp@lapsed-fund.example";
const STAMP = Date.now();
const COMPANY_ID = `co_wfix3f1b_${STAMP}`;

/**
 * Push a null-companyId invitation into the in-memory mirror the LIST handler
 * reads (`listForInvestorEmail` → memInvitations). We cannot use
 * `createInvitation` here because its W-FIX2 F1 write-path fix backfills
 * companyId, so it can never persist the null row this test needs to exercise.
 */
function insertNullCompanyInvitation(id: string, roundId: string) {
  const now = new Date().toISOString();
  _testAccessInvitations.rows.push({
    id,
    tenantId: `tenant_${STAMP}`,
    roundId,
    companyId: null,
    investorEmail: INVESTOR_EMAIL,
    investorName: "Lapsed LP",
    investorFirstName: null,
    investorLastName: null,
    state: "sent",
    classification: null,
    tokenHash: `hash_${id}`,
    invitedByUserId: null,
    note: null,
    sentAt: now,
    viewedAt: null,
    redeemedAt: null,
    redeemedByUserId: null,
    expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
    createdAt: now,
    updatedAt: now,
  } as any);
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  getDb();
  await registerRoutes(server, app);
}, 30_000);

describe("W-FIX3 F1b — LIST handler resolves null companyId from the round", () => {
  it("surfaces the resolved companyId for a null-companyId invitation whose round has one", async () => {
    const round = createRound({
      companyId: COMPANY_ID,
      name: `F1b Round ${STAMP}`,
      type: "seed",
      instrument: "priced_equity",
      pricePerShare: 1,
      targetAmount: 1_000_000,
    } as any);

    const invId = `rinv_f1b_ok_${STAMP}`;
    insertNullCompanyInvitation(invId, round.id);

    const res = await request(app)
      .get("/api/investor/invitations")
      .set("x-user-id", INVESTOR_ID);

    expect(res.status).toBe(200);
    const row = (res.body as any[]).find((r) => r.id === invId);
    expect(row).toBeTruthy();
    // Mirrors DETAIL: top-level companyId AND company.id resolve from the round.
    expect(row.companyId).toBe(COMPANY_ID);
    expect(row.company.id).toBe(COMPANY_ID);
  });

  it("leaves a genuinely company-less row empty (round missing / no companyId)", async () => {
    const invId = `rinv_f1b_orphan_${STAMP}`;
    // Round id that does not resolve to any round → nothing to backfill from.
    insertNullCompanyInvitation(invId, `rnd_orphan_${STAMP}`);

    const res = await request(app)
      .get("/api/investor/invitations")
      .set("x-user-id", INVESTOR_ID);

    expect(res.status).toBe(200);
    const row = (res.body as any[]).find((r) => r.id === invId);
    expect(row).toBeTruthy();
    expect(row.companyId).toBe("");
    expect(row.company.id).toBe("");
  });
});

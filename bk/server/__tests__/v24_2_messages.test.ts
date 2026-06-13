/**
 * v24.2 Bug 5 — Messages visibility for secure-invite-redeemed investors.
 *
 * Root cause (V24_2_ROOTCAUSE.md §Bug 5): derivedMembership() relied ONLY on
 * ctx.investor.invitedRounds, which is populated for RUNTIME personas. A
 * secure-invite-redeemed investor has NO RUNTIME persona, so invitedRounds is
 * empty and the user failed every comms visibility check — channels vanished
 * from GET /api/comms/channels and POST message returned 403 not_member.
 *
 * The v24.2 fix hardens derivedMembership to ALSO consult the DURABLE stores
 * (softCircleStore.listForInvestor by userId, roundInvitationsStore by email,
 * multiCompanyStore for founders) and passes ctx into the four route gaps that
 * previously bypassed the helper (cap-table, soft-circle, typing, read-receipt).
 *
 * These tests reproduce the secure-redeemed shape precisely: the investor is
 * NOT in the channel's static participantUserIds and has an EMPTY
 * invitedRounds array (exactly what installV14TestIdentity injects). Membership
 * must be DERIVED from the durable soft-circle row alone. Tenant isolation is
 * asserted: a second investor with no relationship is still blocked.
 *
 * No mocks. Real comms routes, real soft-circle store.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import express, { type Express } from "express";
import http from "node:http";
import crypto from "node:crypto";

import { getDb } from "../db/connection";
import { registerCommsRoutes, _commsTest } from "../commsStore";
import { createSoftCircle } from "../softCircleStore";
import { softCircleChannelId } from "../../client/src/lib/comms/types";

let app: Express;
let server: http.Server;
let port: number;

// Unique tenant/company/round so we never collide with seeded demo data.
const SUFFIX = crypto.randomBytes(4).toString("hex");
const COMPANY_A = `co_v242_msg_${SUFFIX}`;
const ROUND_A = `rnd_v242_msg_${SUFFIX}`;
const CHANNEL_A = softCircleChannelId(ROUND_A);

const INVESTOR_A = `usr_v242_invA_${SUFFIX}`;
const INVESTOR_A_EMAIL = `inv_a_${SUFFIX}@test.example`;
const INVESTOR_B = `usr_v242_invB_${SUFFIX}`;
const INVESTOR_B_EMAIL = `inv_b_${SUFFIX}@test.example`;

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerCommsRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  port = (server.address() as any).port as number;

  // Seed a soft_circle channel for COMPANY_A / ROUND_A. CRITICAL: investor A is
  // NOT added to participantUserIds, so visibility MUST be derived from the
  // durable soft-circle row (the exact secure-redeem scenario).
  _commsTest.channels.set(CHANNEL_A, {
    id: CHANNEL_A,
    kind: "soft_circle",
    companyId: COMPANY_A,
    roundId: ROUND_A,
    participantUserIds: ["u_founder_v242"], // founder only; NOT investor A
    createdAt: new Date().toISOString(),
    metadata: {
      title: "v24.2 Soft-Circle",
      founderUserId: "u_founder_v242",
      roundName: "v24.2 Round",
    },
  } as any);

  // Durable soft-circle row binding investor A → COMPANY_A / ROUND_A.
  createSoftCircle({
    roundId: ROUND_A,
    companyId: COMPANY_A,
    investorUserId: INVESTOR_A,
    investorEmail: INVESTOR_A_EMAIL,
    investorName: "Investor A",
    amount: 50_000,
    currency: "USD",
    status: "confirmed",
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** HTTP helper that drives identity through the v14 test-identity headers. */
function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string; email?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    if (opts.email) headers["x-actor-email"] = opts.email;
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: buf });
        }
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

describe("v24.2 Bug 5 — secure-redeemed investor comms visibility", () => {
  it("secure-redeemed investor SEES their company channel in GET /api/comms/channels (derived from durable soft-circle)", async () => {
    const res = await call("GET", "/api/comms/channels?role=investor", {
      userId: INVESTOR_A,
      email: INVESTOR_A_EMAIL,
    });
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(CHANNEL_A);
  });

  it("secure-redeemed investor can POST a message to their company channel", async () => {
    const res = await call("POST", `/api/comms/channels/${CHANNEL_A}/messages`, {
      userId: INVESTOR_A,
      email: INVESTOR_A_EMAIL,
      body: { body: "Wire confirmed, excited to join." },
    });
    expect(res.status).toBe(200);
    expect(res.body?.id ?? res.body?.message?.id).toBeTruthy();
  });

  it("cross-tenant: investor B (no relationship) does NOT see investor A's channel", async () => {
    const res = await call("GET", "/api/comms/channels?role=investor", {
      userId: INVESTOR_B,
      email: INVESTOR_B_EMAIL,
    });
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((c) => c.id);
    expect(ids).not.toContain(CHANNEL_A);
  });

  it("cross-tenant: investor B CANNOT post to investor A's channel (403)", async () => {
    const res = await call("POST", `/api/comms/channels/${CHANNEL_A}/messages`, {
      userId: INVESTOR_B,
      email: INVESTOR_B_EMAIL,
      body: { body: "I should not be able to write here." },
    });
    expect(res.status).toBe(403);
  });
});

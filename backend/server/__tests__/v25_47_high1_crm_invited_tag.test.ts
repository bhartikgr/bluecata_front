/**
 * v25.47 APD-033 (HIGH-1) — invited-contact CRM lifecycle.
 *
 * Real-route supertest coverage (Tier-6). Invitations are SEEDED through the
 * canonical store (createInvitation, dryRun so no email leaves the box); the
 * redemption ASSERTION hits the REAL Express route POST /api/invitations/redeem.
 *
 *   1. Creating a round invitation auto-creates the founder CRM contact
 *      (upsertCrmContactForInvitation) at stage "lead".
 *   2. Redeeming the token flips that contact to "engaged" and stamps it
 *      "Registered via invitation redemption" (crmMarkInvitedRegistered).
 *   3. crmMarkInvitedRegistered is idempotent — a second call does not
 *      double-stamp the note nor regress the stage.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { createInvitation } from "../roundInvitationsStore";
import { crmMarkInvitedRegistered, listContactsForCompany } from "../founderCrmStore";

let app: Express;
let server: http.Server;
let port: number;

const ROUND_ID = `round_high1_${Date.now()}`;
const COMPANY_ID = `co_high1_${Date.now()}`;
const INVITEE_EMAIL = "high1.invited@example.com";

function tokenFromRedeemUrl(url: string): string {
  return decodeURIComponent(url.split("/invite/")[1] ?? "");
}

function crmRow(): { stage: string; notes: string | null } | undefined {
  const match = listContactsForCompany(COMPANY_ID).find(
    (c) => c.email.trim().toLowerCase() === INVITEE_EMAIL.toLowerCase(),
  );
  return match ? { stage: match.stage, notes: match.notes } : undefined;
}

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    if (payload) headers["content-length"] = String(Buffer.byteLength(payload));
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let liveToken = "";

beforeAll(async () => {
  getDb();
  const created = await createInvitation({
    roundId: ROUND_ID,
    companyId: COMPANY_ID,
    investorEmail: INVITEE_EMAIL,
    investorName: "High One",
    invitedByUserId: "u_founder",
    dryRun: true,
  });
  liveToken = tokenFromRedeemUrl(created.redeemUrl);

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("APD-033 invited-contact CRM lifecycle", () => {
  it("auto-creates the CRM contact at stage lead on invitation create", () => {
    const row = crmRow();
    expect(row).toBeTruthy();
    expect(row!.stage).toBe("lead");
    expect(row!.notes ?? "").toContain("Auto-created from round invitation");
  });

  it("flips the contact to engaged + stamps registered on redeem", async () => {
    const res = await call("POST", "/api/invitations/redeem", { body: { token: liveToken } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const row = crmRow();
    expect(row!.stage).toBe("engaged");
    expect(row!.notes ?? "").toContain("Registered via invitation redemption");
  });

  it("is idempotent — a second mark does not double-stamp or regress", () => {
    const before = crmRow();
    const stampCount = (s: string) =>
      (s.match(/Registered via invitation redemption/g) ?? []).length;
    expect(stampCount(before!.notes ?? "")).toBe(1);

    const marked = crmMarkInvitedRegistered({ companyId: COMPANY_ID, email: INVITEE_EMAIL });
    expect(marked).toBe(true);

    const after = crmRow();
    expect(after!.stage).toBe("engaged");
    expect(stampCount(after!.notes ?? "")).toBe(1);
  });
});

/**
 * W-AVI64 FIX 1 — a CRM pick with an email ON FILE must be invited, not silently
 * skipped as "no email".
 *
 * Root cause: the round-creation Step 4 sends CRM picks with email:"" (the modal
 * did not echo the stored CRM email back). PATCH
 * /api/founder/rounds/:roundId/initial-shareholders then saw an empty email and
 * counted the pick under skippedNoEmail — so the investor never got a round
 * invitation and never appeared on the round, even though the CRM contact HAD an
 * email on file.
 *
 * The fix (roundInitialShareholdersStore.lookupCrmContactEmail): before deciding
 * a CRM pick is un-invitable, resolve its email from the authoritative
 * founder_crm_contacts row (company-scoped) when the client sent none. The route
 * also now returns a per-pick `inviteResults` array so the founder sees exactly
 * what happened to each pick (invited / duplicate / no_email / error).
 *
 * This test seeds a real founder_crm_contacts row (email on file), PATCHes a CRM
 * pick that carries only its crmContactId (no email), and asserts the pick is
 * NOT counted as skippedNoEmail and its resolved email is reported back. A
 * second manual pick with genuinely no email is still reported as no_email,
 * proving the two paths are distinguished.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoundInitialShareholdersRoutes } from "../lib/roundInitialShareholdersStore";
import { rawDb } from "../db/connection";

const COMPANY = "co_wavi64_invite_test";
const ROUND = "rnd_wavi64_invite";
const CRM_ID = "fcrm_wavi64_onfile";
const CRM_EMAIL = "onfile@investor.example";
const ADMIN = "u_admin"; // PERSONAS admin → bypasses the round-ownership gate.

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  // Seed a CRM contact that HAS an email on file but whose id is what the client
  // will send (with an empty email) — the exact FIX 1 repro shape.
  const db: any = rawDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO founder_crm_contacts (id, tenant_id, company_id, investor_id, name, email, stage, ma_signals, created_at, deleted_at)
     VALUES (?, ?, ?, NULL, ?, ?, 'lead', 0, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, deleted_at = NULL`,
  ).run(CRM_ID, `tenant_co_${COMPANY}`, COMPANY, "On File Investor", CRM_EMAIL, now);

  app = express();
  app.use(express.json());
  registerRoundInitialShareholdersRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function patch(roundId: string, body: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/founder/rounds/${roundId}/initial-shareholders`,
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": ADMIN,
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: any = null;
          try { json = data ? JSON.parse(data) : null; } catch { json = data; }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("W-AVI64 FIX 1: CRM pick email is resolved from founder_crm_contacts", () => {
  it("a CRM pick sent WITHOUT an email is invited using its on-file email (not skippedNoEmail)", async () => {
    const r = await patch(ROUND, {
      companyId: COMPANY,
      shareholders: [
        // CRM pick: the client sent an empty email but the contact has one on file.
        { name: "On File Investor", source: "crm", crmContactId: CRM_ID, email: "" },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.count).toBe(1);

    // The core FIX 1 guarantee: the on-file email was resolved, so this pick was
    // NOT dropped as "no email".
    expect(r.json.skippedNoEmail).toBe(0);
    expect(Array.isArray(r.json.inviteResults)).toBe(true);
    expect(r.json.inviteResults.length).toBe(1);
    const pick = r.json.inviteResults[0];
    expect(pick.email).toBe(CRM_EMAIL);
    expect(pick.status).not.toBe("no_email");
  });

  it("a manual pick with genuinely no email is still reported as no_email", async () => {
    const r = await patch(ROUND, {
      companyId: COMPANY,
      shareholders: [
        { name: "No Email Angel", source: "manual" },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.skippedNoEmail).toBe(1);
    const pick = (r.json.inviteResults as Array<{ status: string; email: string | null }>)[0];
    expect(pick.status).toBe("no_email");
    expect(pick.email).toBeNull();
  });
});

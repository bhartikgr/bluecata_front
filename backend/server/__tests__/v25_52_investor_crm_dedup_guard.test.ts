/**
 * v25.52 Track 3.5.2 (GPT-5.5 R4 blocker F, AUTHORIZED sacred edit) — investor
 * CRM create/PATCH dedup guard. Symmetric to founder/partner: 0097 exempts
 * investor shared-inbox conflict groups from the 0098 partial UNIQUE index, so
 * the route-level guard is the only protection against reopening a duplicate.
 * Drives the REAL /api/investor/crm HTTP surface via registerInvestorCrmRoutes.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerInvestorCrmRoutes, _testInvestorCrm } from "../investorCrmStore";
import { seedInvestorCrmFromInvitation } from "../lib/investorCrmInvitationSeed";
import { rawDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;
const INVESTOR = "u_crm_dedup_test";

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method,
        headers: { "content-type": "application/json", "x-user-id": INVESTOR,
          ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}) } },
      (res) => { let d = ""; res.on("data", (c) => (d += c));
        res.on("end", () => { let j: any = null; try { j = d ? JSON.parse(d) : null; } catch { j = d; } resolve({ status: res.statusCode ?? 0, json: j }); }); },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerInvestorCrmRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); }));
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => _testInvestorCrm.reset());

describe("v25.52 — investor CRM dedup guard (create + PATCH)", () => {
  it("POST /api/investor/crm rejects a second same-email contact (409, case-insensitive)", async () => {
    const a = await call("POST", "/api/investor/crm", { name: "Inv One", email: "inv@acme.com" });
    expect(a.status).toBe(201);
    const b = await call("POST", "/api/investor/crm", { name: "Inv Two", email: "INV@acme.com" });
    expect(b.status).toBe(409);
    expect(b.json.error).toBe("crm_contact_duplicate_email");
  });

  it("POST /api/investor/crm/contacts (alias) also rejects duplicates", async () => {
    const a = await call("POST", "/api/investor/crm/contacts", { name: "Alias One", email: "alias@acme.com" });
    expect(a.status).toBe(201);
    const b = await call("POST", "/api/investor/crm/contacts", { name: "Alias Two", email: "alias@acme.com" });
    expect(b.status).toBe(409);
    expect(b.json.error).toBe("crm_contact_duplicate_email");
  });

  it("PATCH /api/investor/crm/:id rejects changing email to an existing one (409)", async () => {
    const a = await call("POST", "/api/investor/crm", { name: "PInv A", email: "pinva@acme.com" });
    expect(a.status).toBe(201);
    const b = await call("POST", "/api/investor/crm", { name: "PInv B", email: "pinvb@acme.com" });
    expect(b.status).toBe(201);
    const r = await call("PATCH", `/api/investor/crm/${b.json.id}`, { email: "PINVA@acme.com" });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("crm_contact_duplicate_email");
  });

  it("allows a different email and non-email edits", async () => {
    const a = await call("POST", "/api/investor/crm", { name: "Fresh Inv", email: "freshinv@acme.com" });
    expect(a.status).toBe(201);
    const diff = await call("POST", "/api/investor/crm", { name: "Other Inv", email: "otherinv@acme.com" });
    expect(diff.status).toBe(201);
    const patch = await call("PATCH", `/api/investor/crm/${a.json.id}`, { affiliation: "New Fund" });
    expect(patch.status).toBe(200);
  });

  // alias PATCH route parity (GPT-5.5 R5 test-gap)
  it("PATCH /api/investor/crm/contacts/:id (alias) rejects email change to a duplicate", async () => {
    const a = await call("POST", "/api/investor/crm/contacts", { name: "CAlias A", email: "caliasa@acme.com" });
    expect(a.status).toBe(201);
    const b = await call("POST", "/api/investor/crm/contacts", { name: "CAlias B", email: "caliasb@acme.com" });
    expect(b.status).toBe(201);
    const r = await call("PATCH", `/api/investor/crm/contacts/${b.json.contact.id}`, { email: "CALIASA@acme.com" });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("crm_contact_duplicate_email");
  });

  // GPT-5.5 R5 blocker 1: the invitation seed helper must NOT reopen a duplicate
  // for a (investor_id, email) that already exists — even under a DIFFERENT
  // company_id, and even if the existing rows are exempt shared-inbox conflicts.
  it("seedInvestorCrmFromInvitation skips when the same investor+email already exists (any company)", () => {
    const investorId = "u_seed_dedup_inv";
    const email = "sharedfounder@acme.com";
    const rdb = rawDb() as unknown as { prepare: (s: string) => any };
    const now = new Date().toISOString();
    // Seed an EXISTING (exempt) row for investorId+email under company A.
    try { rdb.prepare("ALTER TABLE investor_crm_contacts ADD COLUMN dedup_exempt INTEGER").run(); } catch { /* exists */ }
    rdb.prepare(
      `INSERT INTO investor_crm_contacts (id, tenant_id, investor_id, name, email, stage, created_at, updated_at, company_id, dedup_exempt)
       VALUES (?, 't', ?, ?, ?, 'invited', ?, ?, 'co_A', 1)`,
    ).run(`icrm_pre_${Date.now()}`, investorId, "Existing Founder", email, now, now);

    const before = (rdb.prepare("SELECT COUNT(*) c FROM investor_crm_contacts WHERE investor_id = ? AND lower(trim(email)) = lower(trim(?)) AND deleted_at IS NULL").get(investorId, email) as { c: number }).c;
    // Attempt to seed for the SAME investor+email but a DIFFERENT company_id.
    const seededId = seedInvestorCrmFromInvitation({
      investorId, companyId: "co_B", companyName: "Company B",
      founderName: "Another Founder", founderEmail: email.toUpperCase(),
    });
    expect(seededId).toBeNull(); // must skip — no duplicate reopened
    const after = (rdb.prepare("SELECT COUNT(*) c FROM investor_crm_contacts WHERE investor_id = ? AND lower(trim(email)) = lower(trim(?)) AND deleted_at IS NULL").get(investorId, email) as { c: number }).c;
    expect(after).toBe(before);
  });

  // GPT-5.5 R6 blocker 1: DELETE is now DB-first — a successful delete must both
  // return ok AND actually soft-delete the authoritative row (deleted_at set),
  // and the contact must disappear from subsequent reads.
  it("DELETE soft-deletes the authoritative row and removes it from reads", async () => {
    const a = await call("POST", "/api/investor/crm", { name: "Del Me", email: "delme@acme.com" });
    expect(a.status).toBe(201);
    const id = a.json.id;
    const del = await call("DELETE", `/api/investor/crm/${id}`);
    expect(del.status).toBe(200);
    expect(del.json.ok).toBe(true);
    // authoritative row is soft-deleted
    const rdb = rawDb() as unknown as { prepare: (s: string) => any };
    const row = rdb.prepare("SELECT deleted_at FROM investor_crm_contacts WHERE id = ?").get(id) as { deleted_at?: string } | undefined;
    expect(row?.deleted_at).toBeTruthy();
    // gone from reads
    const list = await call("GET", "/api/investor/crm");
    expect((list.json as any[]).find((c) => c.id === id)).toBeUndefined();
  });
});

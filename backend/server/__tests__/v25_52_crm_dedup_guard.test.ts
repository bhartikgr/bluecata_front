/**
 * v25.52 Track 3.5.1/3.5.2 — CRM dedup guard regression.
 *
 * Proves the founder-CRM create path returns a graceful 409 (not a 500, and not
 * a silent duplicate row) when a second live contact with the same
 * (company_id, lower(trim(email))) is submitted. This is the create-path dedup
 * guard backing migration 0098's partial UNIQUE index (no new "many Johns").
 *
 * Uses the real registerRoutes app + registerFounderUser (Tier-6: real routes),
 * and installs the 0097 column + 0098 index against the live in-memory DB so the
 * constraint is genuinely exercised.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { registerFounderUser } from "../lib/userContext";
import { addCompanyForFounder } from "../multiCompanyStore";
import { rawDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;
let userId: string;
let companyId: string;

function call(method: string, path: string, opts: { body?: unknown; userId?: string } = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(data)); }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = ""; res.on("data", (d) => (buf += d));
      res.on("end", () => { let body: any = {}; try { body = buf ? JSON.parse(buf) : {}; } catch { body = buf; } resolve({ status: res.statusCode ?? 0, body }); });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); }));

  // Install the 0097 column + 0098 partial unique index on the live test DB so
  // the constraint is real (the in-memory baseline starts pre-0097). Use the RAW
  // sqlite handle (rawDb) for DDL — getDb() returns the Drizzle wrapper.
  const db = rawDb() as unknown as { exec: (s: string) => void };
  try { db.exec("ALTER TABLE founder_crm_contacts ADD COLUMN dedup_exempt INTEGER"); } catch { /* already there */ }
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_founder_crm_email_scope
         ON founder_crm_contacts (company_id, lower(trim(email)))
         WHERE deleted_at IS NULL AND email IS NOT NULL AND trim(email) <> ''
           AND (dedup_exempt IS NULL OR dedup_exempt <> 1)`,
    );
  } catch { /* already there */ }

  ({ userId } = registerFounderUser({ email: `crmdedup_${Date.now()}@test.example`, name: "CRM Dedup Founder", password: "testpassword123" }));
  companyId = `co_crmdedup_${Date.now()}`;
  addCompanyForFounder(userId, {
    companyId, companyName: "Dedup Corp", legalName: "Dedup Corp, Inc.", logoUrl: null, role: "founder",
    lastActiveAt: new Date().toISOString(),
    kpi: { capTableHolders: 0, activeRoundsCount: 0, raisedThisYearUsd: 0, dataroomFiles: 0, pendingSoftCircles: 0, ownershipPct: 1.0 },
    collective: { status: "none" },
    billing: { plan: "Founder Free", monthlyUsd: 0, nextBillingDate: "—", cardLast4: null, invoiceCount: 0 },
    sector: "SaaS", stage: "Pre-Seed", hq: "US",
  } as any);
}, 30_000);

afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

describe("v25.52 — founder CRM create-path dedup guard (409, not 500)", () => {
  it("creates the first contact for an email", async () => {
    const r = await call("POST", "/api/founder/investor-crm", {
      userId,
      body: { companyId, firstName: "John", lastName: "Smith", email: "dupe@acme.com", stage: "lead" },
    });
    expect(r.status).toBeGreaterThanOrEqual(200);
    expect(r.status).toBeLessThan(300);
  });

  it("rejects a SECOND same-email contact as 409 (case-insensitive) — never 500, never a dup row", async () => {
    const r = await call("POST", "/api/founder/investor-crm", {
      userId,
      body: { companyId, firstName: "Johnny", lastName: "Smith", email: "DUPE@acme.com", stage: "lead" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("crm_contact_duplicate_email");
  });

  it("still allows a DIFFERENT email in the same company", async () => {
    const r = await call("POST", "/api/founder/investor-crm", {
      userId,
      body: { companyId, firstName: "Fresh", lastName: "Person", email: "fresh@acme.com", stage: "lead" },
    });
    expect(r.status).toBeGreaterThanOrEqual(200);
    expect(r.status).toBeLessThan(300);
  });

  // GPT-5.5 blocker #1 regression: the partial UNIQUE index (0098) EXCLUDES
  // dedup_exempt=1 rows. So for a shared-inbox email that 0097 left as 2+ exempt
  // conflict rows, the index holds ZERO entries and a NEW non-exempt insert would
  // NOT collide with the index alone — silently reopening "many Johns". The
  // PRE-INSERT guard (checks ANY live row, exempt or not) must still return 409.
  it("rejects a new insert against an EXEMPT shared-inbox email (pre-insert guard, not the index)", async () => {
    const db = rawDb() as unknown as { exec: (s: string) => void; prepare: (s: string) => any };
    const now = new Date().toISOString();
    // Seed two EXEMPT conflict rows (different names, same email) as 0097 would
    // leave a shared-inbox conflict flagged for manual admin resolution.
    const insert = db.prepare(
      `INSERT INTO founder_crm_contacts (id, tenant_id, company_id, name, stage, email, created_at, dedup_exempt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    );
    insert.run(`fcrm_exA_${Date.now()}`, "t", companyId, "Alice One", "lead", "shared@acme.com", now);
    insert.run(`fcrm_exB_${Date.now()}`, "t", companyId, "Bob Two", "lead", "shared@acme.com", now);

    const r = await call("POST", "/api/founder/investor-crm", {
      userId,
      body: { companyId, firstName: "Carol", lastName: "Three", email: "SHARED@acme.com", stage: "lead" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("crm_contact_duplicate_email");
  });

  // GPT-5.5 R3 blocker: the PATCH route must apply the SAME dedup guard on an
  // email change — changing a contact's email to one that already exists (incl.
  // on an exempt group) must 409, not silently reopen a duplicate.
  it("PATCH: rejects changing a contact's email to a duplicate (409)", async () => {
    // Create two distinct contacts.
    const a = await call("POST", "/api/founder/investor-crm", {
      userId, body: { companyId, firstName: "Patch", lastName: "A", email: "patcha@acme.com", stage: "lead" },
    });
    expect(a.status).toBeLessThan(300);
    const b = await call("POST", "/api/founder/investor-crm", {
      userId, body: { companyId, firstName: "Patch", lastName: "B", email: "patchb@acme.com", stage: "lead" },
    });
    expect(b.status).toBeLessThan(300);
    const bId = b.body?.id ?? b.body?.contact?.id;
    expect(bId).toBeTruthy();
    // Try to PATCH B's email to A's email — must be rejected.
    const r = await call("PATCH", `/api/founder/investor-crm/${bId}`, {
      userId, body: { email: "PATCHA@acme.com" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("crm_contact_duplicate_email");
  });

  it("PATCH: allows a no-op / non-conflicting email change and non-email edits", async () => {
    const c = await call("POST", "/api/founder/investor-crm", {
      userId, body: { companyId, firstName: "Patch", lastName: "C", email: "patchc@acme.com", stage: "lead" },
    });
    const cId = c.body?.id ?? c.body?.contact?.id;
    // non-email edit succeeds
    const notes = await call("PATCH", `/api/founder/investor-crm/${cId}`, { userId, body: { notes: "hello" } });
    expect(notes.status).toBeGreaterThanOrEqual(200); expect(notes.status).toBeLessThan(300);
    // change to a brand-new unique email succeeds
    const email = await call("PATCH", `/api/founder/investor-crm/${cId}`, { userId, body: { email: "patchc2@acme.com" } });
    expect(email.status).toBeGreaterThanOrEqual(200); expect(email.status).toBeLessThan(300);
  });
});

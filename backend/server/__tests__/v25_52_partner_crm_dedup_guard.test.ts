/**
 * v25.52 Track 3.5.2 (GPT-5.5 R2 blocker) — partner CRM create-path dedup guard.
 *
 * 0097 exempts ALL existing partner duplicate (partner_id, normalized email)
 * groups from 0098's partial UNIQUE index (to keep the audit hash chain
 * byte-identical — it never soft-deletes a chain row). So the index alone cannot
 * reject a NEW insert into an exempt group. The partner create route therefore
 * needs a PRE-INSERT dedup guard (mirrors the founder guard): reject any new
 * contact whose (partner_id, lower(trim(email))) matches ANY live row (exempt or
 * not) with 409; fail closed (503) if the guard cannot run. Crucially, a rejected
 * insert must NOT extend the partner hash chain.
 *
 * Uses the real registerRoutes app + partner sandbox (same pattern as
 * partnerCrmHashChain.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { eq } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { seedTestPartnerSandbox, TEST_PARTNER_USERS } from "../partnerWorkspaceStore";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { partnerCrmContacts as crmTable } from "../../shared/schema";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });
  await hydratePartnerWorkspaceV19Store();

  // Ensure the 0097 dedup_exempt column exists so we can simulate an exempt
  // shared-inbox group (the exact case the partial index cannot protect).
  const rdb = rawDb() as unknown as { exec: (s: string) => void };
  try { rdb.exec("ALTER TABLE partner_crm_contacts ADD COLUMN dedup_exempt INTEGER"); } catch { /* already there */ }

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, () => { port = (server.address() as { port: number }).port; resolve(); }));
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

function call(method: string, apiPath: string, opts: { body?: unknown; userId?: string } = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) { headers["content-type"] = "application/json"; headers["content-length"] = String(Buffer.byteLength(data)); }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request({ hostname: "127.0.0.1", port, path: apiPath, method, headers }, (res) => {
      let buf = ""; res.on("data", (c) => (buf += c));
      res.on("end", () => { let b: any = null; try { b = JSON.parse(buf); } catch { /* keep */ } resolve({ status: res.statusCode ?? 0, body: b }); });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function liveCountForEmail(email: string): number {
  const db: any = getDb();
  const rows = db.select().from(crmTable).where(eq((crmTable as any).partnerId, PARTNER_A)).all() as any[];
  return rows.filter((r) => !(r.deleted_at ?? r.deletedAt) && String(r.email ?? "").trim().toLowerCase() === email.toLowerCase()).length;
}
function chainTipCount(): number {
  const db: any = getDb();
  return (db.select().from(crmTable).where(eq((crmTable as any).partnerId, PARTNER_A)).all() as any[]).length;
}

describe("v25.52 — partner CRM create-path dedup guard (409, chain untouched)", () => {
  it("creates the first partner contact for an email", async () => {
    const r = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING_A,
      body: { name: "Partner Dedup One", email: "pdup@acme.com" },
    });
    expect(r.status).toBe(201);
    expect(r.body.contact.currHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a SECOND same-email partner contact as 409 (case-insensitive) and does NOT extend the chain", async () => {
    const rowsBefore = chainTipCount();
    const r = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING_A,
      body: { name: "Partner Dedup Two", email: "PDUP@acme.com" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("crm_contact_duplicate_email");
    // rejected insert must NOT have written a new chain row
    expect(chainTipCount()).toBe(rowsBefore);
    expect(liveCountForEmail("pdup@acme.com")).toBe(1);
  });

  it("rejects a new insert against an EXEMPT partner shared-inbox group (guard, not the index)", async () => {
    // Simulate 0097's exempt shared-inbox conflict: two live rows, same email,
    // different names, both dedup_exempt=1 (as 0097 would leave a partner dup).
    const rdb = rawDb() as unknown as { prepare: (s: string) => any };
    const now = new Date().toISOString();
    const ins = rdb.prepare(
      `INSERT INTO partner_crm_contacts (id, tenant_id, partner_id, contact_user_id, email, name, created_at, updated_at, prev_hash, curr_hash, dedup_exempt)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'GENESIS', ?, 1)`,
    );
    const tenantId = `tenant_partner_${PARTNER_A}`;
    ins.run(`pcc_exA_${Date.now()}`, tenantId, PARTNER_A, "shared@acme.com", "Alice Exempt", now, now, "a".repeat(64));
    ins.run(`pcc_exB_${Date.now()}`, tenantId, PARTNER_A, "shared@acme.com", "Bob Exempt", now, now, "b".repeat(64));

    const rowsBefore = chainTipCount();
    const r = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING_A,
      body: { name: "Carol New", email: "SHARED@acme.com" },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("crm_contact_duplicate_email");
    // guard rejected before any chain write
    expect(chainTipCount()).toBe(rowsBefore);
  });

  it("still allows a DIFFERENT email for the same partner", async () => {
    const r = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING_A,
      body: { name: "Partner Fresh", email: "pfresh@acme.com" },
    });
    expect(r.status).toBe(201);
  });

  // GPT-5.5 R3 blocker: the chain-extending PATCH route must apply the same
  // dedup guard on an email change, and a rejected PATCH must NOT write a chain
  // row (no hash-chain mutation).
  it("PATCH: rejects changing a contact's email to an existing one (409) without extending the chain", async () => {
    // Create two distinct partner contacts.
    const a = await call("POST", "/api/partner/crm/contacts", { userId: MANAGING_A, body: { name: "PPatch A", email: "ppatcha@acme.com" } });
    expect(a.status).toBe(201);
    const b = await call("POST", "/api/partner/crm/contacts", { userId: MANAGING_A, body: { name: "PPatch B", email: "ppatchb@acme.com" } });
    expect(b.status).toBe(201);
    const bId = b.body.contact.id;
    const bHashBefore = b.body.contact.currHash;
    const rowsBefore = chainTipCount();

    const r = await call("PATCH", `/api/partner/crm/contacts/${bId}`, { userId: MANAGING_A, body: { email: "PPATCHA@acme.com" } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("crm_contact_duplicate_email");
    // no new chain row written; B's hash unchanged
    expect(chainTipCount()).toBe(rowsBefore);
    const db: any = getDb();
    const bRow = (db.select().from(crmTable).where(eq((crmTable as any).partnerId, PARTNER_A)).all() as any[])
      .find((x) => x.id === bId);
    expect((bRow.curr_hash ?? bRow.currHash)).toBe(bHashBefore);
  });

  it("PATCH: allows a non-email edit and a non-conflicting email change (chain extends normally)", async () => {
    const c = await call("POST", "/api/partner/crm/contacts", { userId: MANAGING_A, body: { name: "PPatch C", email: "ppatchc@acme.com" } });
    expect(c.status).toBe(201);
    const cId = c.body.contact.id;
    const notes = await call("PATCH", `/api/partner/crm/contacts/${cId}`, { userId: MANAGING_A, body: { notes: "note" } });
    expect(notes.status).toBe(200);
    const email = await call("PATCH", `/api/partner/crm/contacts/${cId}`, { userId: MANAGING_A, body: { email: "ppatchc2@acme.com" } });
    expect(email.status).toBe(200);
    expect(email.body.contact.currHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

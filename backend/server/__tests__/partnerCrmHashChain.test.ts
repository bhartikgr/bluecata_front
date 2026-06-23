/**
 * CP Phase A — partner_crm_contacts hash chain tests (CP-008).
 *
 * Coverage:
 *   - POST /api/partner/crm/contacts writes prev_hash + curr_hash;
 *     first row's prev is null (per the V19 store) and subsequent rows
 *     chain to the previous tip.
 *   - PATCH extends the chain.
 *   - DELETE (soft-delete) extends the chain.
 *   - Stitcher: pre-populate raw rows with NULL hashes via direct DB insert,
 *     run stitchPartnerCrmChain(), assert chain becomes valid.
 *   - auditChainVerifier.verifyChainForTable('partner_crm_contacts')
 *     passes after stitching.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { eq, sql } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { stitchPartnerCrmChain } from "../lib/partnerCrmChainStitch";
import { verifyChainForTable } from "../lib/auditChainVerifier";
import { partnerCrmContacts as crmTable } from "../../shared/schema";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_STITCH = "ac_test_partner_crm_stitcher";
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });

  // Register a second partner for stitcher tests.
  _registerSeedPartner({
    id: PARTNER_STITCH,
    legalName: "CRM STITCHER PARTNER",
    displayName: "CRM STITCH",
    email: "stitch-crm@test.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });

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

describe("CP Phase A — partner_crm_contacts hash chain (CP-008)", () => {
  /* ===================== 1. POST writes hash chain ===================== */
  let firstContactId = "";
  let firstCurrHash = "";

  it("POST writes valid prev_hash + curr_hash; first row's prev is null OR existing tip", async () => {
    const r = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING_A,
      body: { name: "Chain Contact #1", email: "chain1@example.com" },
    });
    expect(r.status).toBe(201);
    expect(r.body.contact.id).toMatch(/^pcc_/);
    // CP-008: every row gets a curr_hash; prev_hash is the partner's chain tip
    // at insert time (may be null for genesis OR existing tip for in-flight tests).
    expect(r.body.contact.currHash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof r.body.contact.prevHash === "string" || r.body.contact.prevHash === null).toBe(true);
    firstContactId = r.body.contact.id;
    firstCurrHash = r.body.contact.currHash;
  });

  it("POST a second contact chains prev = previous curr", async () => {
    const r = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING_A,
      body: { name: "Chain Contact #2", email: "chain2@example.com" },
    });
    expect(r.status).toBe(201);
    expect(r.body.contact.prevHash).toBe(firstCurrHash);
    expect(r.body.contact.currHash).not.toBe(firstCurrHash);
    expect(r.body.contact.currHash).toMatch(/^[a-f0-9]{64}$/);
  });

  /* ===================== 2. PATCH extends the chain ===================== */

  it("PATCH extends the chain: new curr_hash, prev points to tip-at-write-time", async () => {
    // Read current tip from DB
    const db: any = getDb();
    const tipRows = db.select().from(crmTable).where(eq((crmTable as any).partnerId, PARTNER_A)).all() as any[];
    const sorted = tipRows.sort((a: any, b: any) => (a.created_at ?? a.createdAt).localeCompare(b.created_at ?? b.createdAt));
    const lastHash = (sorted[sorted.length - 1].curr_hash ?? sorted[sorted.length - 1].currHash) as string;

    const r = await call("PATCH", `/api/partner/crm/contacts/${firstContactId}`, {
      userId: MANAGING_A,
      body: { notes: "Updated by chain test" },
    });
    expect(r.status).toBe(200);
    expect(r.body.contact.currHash).not.toBe(firstCurrHash);
    expect(r.body.contact.prevHash).toBe(lastHash);
  });

  /* ===================== 3. DELETE extends the chain ===================== */

  it("DELETE (soft-delete) extends the chain", async () => {
    const create = await call("POST", "/api/partner/crm/contacts", {
      userId: MANAGING_A,
      body: { name: "Doomed Contact" },
    });
    expect(create.status).toBe(201);
    const id = create.body.contact.id;
    const created_hash = create.body.contact.currHash;

    const del = await call("DELETE", `/api/partner/crm/contacts/${id}`, { userId: MANAGING_A });
    expect(del.status).toBe(200);
    expect(del.body.contact.deletedAt).toBeTruthy();
    expect(del.body.contact.currHash).toMatch(/^[a-f0-9]{64}$/);
    expect(del.body.contact.currHash).not.toBe(created_hash);
    // prev_hash on the delete mutation should be the chain tip at delete time;
    // there may be other writes between create + delete (e.g. PATCH above) so
    // we don't pin it to created_hash, just assert it's a valid 64-hex string.
    expect(del.body.contact.prevHash).toMatch(/^[a-f0-9]{64}$/);
  });

  /* ===================== 4. Stitcher: pre-populate with NULL hashes ===================== */

  it("stitchPartnerCrmChain fills NULL hashes for raw-inserted rows", () => {
    const db: any = getDb();
    const tenantId = `tenant_partner_${PARTNER_STITCH}`;
    const now = new Date().toISOString();
    // Insert 3 raw rows with NULL/empty hashes via Drizzle (bypassing the route).
    db.transaction((tx: any) => {
      for (let i = 0; i < 3; i++) {
        tx.insert(crmTable).values({
          id: `pcc_raw_${i}_${Date.now()}`,
          tenantId,
          partnerId: PARTNER_STITCH,
          contactUserId: null,
          email: `raw${i}@stitch.example`,
          name: `Raw Stitch ${i}`,
          role: "",
          org: "",
          lastContactAt: null,
          notes: "",
          tags: "[]",
          prevHash: null,
          currHash: "",
          createdAt: new Date(Date.parse(now) + i * 1000).toISOString(),
          updatedAt: now,
          deletedAt: null,
        }).run();
      }
    });

    // Reset stitcher marker so it runs again in this process.
    db.run(sql`DELETE FROM _migrations_applied WHERE key = 'cp_a_crm_chain_stitch_v1'`);

    const result = stitchPartnerCrmChain();
    expect(result.stitched).toBeGreaterThanOrEqual(3);
    expect(result.partnersTouched).toBeGreaterThanOrEqual(1);

    // Verify the stitched rows for our PARTNER_STITCH now have valid chain
    const rows = db
      .select()
      .from(crmTable)
      .where(eq((crmTable as any).partnerId, PARTNER_STITCH))
      .all() as any[];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      const curr = (r.curr_hash ?? r.currHash) as string;
      expect(curr).toMatch(/^[a-f0-9]{64}$/);
      expect(curr).not.toBe("");
    }
  });

  /* ===================== 5. auditChainVerifier passes after stitching ===================== */

  it("auditChainVerifier passes for partner_crm_contacts after stitching", () => {
    const result = verifyChainForTable("partner_crm_contacts", {
      tenantId: `tenant_partner_${PARTNER_STITCH}`,
    });
    expect(result.total_rows).toBeGreaterThan(0);
    expect(result.broken_at_row_id).toBeNull();
    expect(result.broken_at_index).toBeNull();
    expect(result.verified).toBe(result.total_rows);
  });

  /* ===================== 6. Stitcher idempotency ===================== */

  it("stitcher is idempotent: re-running with marker present is a no-op", () => {
    // First run already set the marker; second invocation should report 0 stitched.
    const result = stitchPartnerCrmChain();
    expect(result.stitched).toBe(0);
    expect(result.partnersTouched).toBe(0);
  });
});

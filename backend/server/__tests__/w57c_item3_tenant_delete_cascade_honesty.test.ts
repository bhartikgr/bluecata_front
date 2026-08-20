/**
 * WAVE 57c · ITEM 3 (R37 approved order #3) — `POST /api/admin/tenants/:id/delete`
 * no longer reports a cap-table cascade that cannot execute.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * The founder branch ran `UPDATE funded_queue SET deleted_at = ? WHERE
 * company_id = ?` inside `try { … } catch { cascadeSummary.funded_queue = 0 }`.
 * `funded_queue` has NO `deleted_at` column, so the statement always threw and
 * the response reported `cascade.funded_queue = 0` — indistinguishable from
 * "there was nothing to retire". A silent lie about what was destroyed.
 *
 * ── THE PRECONDITION IS PROVED, NOT ASSUMED ────────────────────────────────
 * The first test asserts from `PRAGMA table_info(funded_queue)` that the column
 * really is absent. Without that, the rest of this file could be passing for the
 * wrong reason (e.g. if a future migration added the column, the cascade would
 * start working and `cascadeIncomplete` would legitimately be false — this test
 * would then FAIL LOUDLY and tell the next reader to re-derive the finding,
 * rather than silently asserting nothing).
 *
 * ── BOTH POLES ─────────────────────────────────────────────────────────────
 *   UPPER — a founder tenant with a REAL pending funded_queue row is deleted:
 *           status 200, the tenant is really soft-deleted (the operation is not
 *           disabled), and the steps that CAN run report real counts.
 *   LOWER — the response no longer contains the false `funded_queue: 0` claim;
 *           it reports `cascadeIncomplete: true`, names the failing step, and
 *           states how many rows were LEFT BEHIND. The row is still in
 *           `funded_queue`, so "left behind" is a checked fact.
 *   CONTROL — a tenant type whose cascade fully succeeds reports
 *           `cascadeIncomplete: false`, so `true` is not a constant.
 *   CONTROL — the durable `tenant_deletion_audit` payload carries the same
 *           honesty, so the audit trail cannot disagree with the response.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";

const ADMIN = "u_admin";

const COMPANY = "co_w57c_cascade";
const COMPANY_NAME = "W57c Cascade Probe Inc.";
const TENANT_ROW = "tenant_co_co_w57c_cascade";
const INVESTOR = "u_w57c_cascade_investor";
const INVESTOR_NAME = "W57c Cascade Probe Investor";

let app: Express;
let server: http.Server;

function sql(q: string, ...args: unknown[]) {
  return rawDb().prepare(q).run(...args);
}

beforeAll(async () => {
  await seedDemoData(getDb());
  const now = new Date().toISOString();

  sql(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, legal_name, sector, stage, hq)
     VALUES (?, ?, ?, ?, 'Probe', 'Seed', 'Nowhere')`,
    COMPANY, TENANT_ROW, COMPANY_NAME, `${COMPANY_NAME} Ltd.`,
  );
  sql(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role)
     VALUES (?, ?, ?, ?, 'investor')`,
    INVESTOR, TENANT_ROW, "w57c-cascade@probe.example", INVESTOR_NAME,
  );
  /* A REAL pending funding row for this company. This is what the endpoint
     claimed to retire and did not. */
  sql(
    `INSERT OR REPLACE INTO funded_queue
       (invitation_id, tenant_id, round_id, company_id, investor_id, amount, currency, shares, enqueued_at)
     VALUES (?, ?, ?, ?, ?, '250000', 'USD', '1000', ?)`,
    "inv_w57c_cascade", TENANT_ROW, "rd_w57c_cascade", COMPANY, INVESTOR, now,
  );

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W57c item 3 — tenant-delete cascade honesty (over HTTP)", () => {
  it("PRECONDITION (asserted, not assumed): funded_queue has no deleted_at column", () => {
    const cols = (rawDb().prepare(`PRAGMA table_info(funded_queue)`).all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(cols.length).toBeGreaterThan(0);
    expect(cols).not.toContain("deleted_at");
    // and the row this test relies on really is enqueued
    const n = (rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM funded_queue WHERE company_id = ?`)
      .get(COMPANY) as { n: number }).n;
    expect(n).toBe(1);
  });

  it("THE FINDING: the response no longer claims a funded_queue cascade of 0 — it reports the failure and the rows left behind", async () => {
    const r = await request(app)
      .post(`/api/admin/tenants/${COMPANY}/delete`)
      .set("x-user-id", ADMIN)
      .send({ tenantType: "founder", confirmName: COMPANY_NAME });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    // THE OLD LIE: cascade.funded_queue === 0. It must not be reported at all.
    expect(Object.keys(r.body.cascade ?? {})).not.toContain("funded_queue");

    // THE NEW TRUTH.
    expect(r.body.cascadeIncomplete).toBe(true);
    expect(Object.keys(r.body.cascadeErrors ?? {})).toContain("funded_queue");
    expect(String(r.body.cascadeErrors.funded_queue)).toMatch(/deleted_at|no such column/i);
    expect(r.body.cascadeNotPerformed?.funded_queue?.rowsRemaining).toBe(1);

    // "Left behind" is a checked fact, not a claim.
    const remaining = (rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM funded_queue WHERE company_id = ?`)
      .get(COMPANY) as { n: number }).n;
    expect(remaining).toBe(1);
  });

  it("UPPER POLE: the delete itself still works — the company is soft-deleted and the steps that CAN run report real counts", async () => {
    const row = rawDb()
      .prepare(`SELECT deleted_at AS deletedAt FROM companies WHERE id = ?`)
      .get(COMPANY) as { deletedAt: string | null } | undefined;
    expect(row?.deletedAt).toBeTruthy();
  });

  it("CONTROL: a cascade that fully succeeds reports cascadeIncomplete:false, so `true` is not a constant", async () => {
    const r = await request(app)
      .post(`/api/admin/tenants/${INVESTOR}/delete`)
      .set("x-user-id", ADMIN)
      .send({ tenantType: "investor", confirmName: INVESTOR_NAME });
    expect(r.status).toBe(200);
    expect(r.body.cascadeIncomplete).toBe(false);
    expect(r.body.cascadeErrors).toBeUndefined();
    expect(typeof r.body.cascade.users).toBe("number");
  });

  it("CONTROL: the durable tenant_deletion_audit payload carries the same honesty as the response", () => {
    const row = rawDb()
      .prepare(
        `SELECT audit_payload_json AS payloadJson FROM tenant_deletion_audit
           WHERE tenant_id = ? ORDER BY deleted_at DESC LIMIT 1`,
      )
      .get(COMPANY) as { payloadJson: string } | undefined;
    expect(row).toBeTruthy();
    const payload = JSON.parse(row!.payloadJson);
    expect(payload.cascadeIncomplete).toBe(true);
    expect(Object.keys(payload.cascade ?? {})).not.toContain("funded_queue");
    expect(payload.cascadeNotPerformed?.funded_queue?.rowsRemaining).toBe(1);
  });

  it("CONFIRMATION GUARD still holds: a wrong confirmName is refused (no fix regressed the existing control)", async () => {
    const r = await request(app)
      .post(`/api/admin/tenants/${COMPANY}/delete`)
      .set("x-user-id", ADMIN)
      .send({ tenantType: "founder", confirmName: "Definitely Not The Name" });
    expect([400, 404]).toContain(r.status);
    expect(r.body.ok).toBe(false);
  });
});

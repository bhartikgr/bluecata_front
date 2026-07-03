/**
 * v25.48.2 Q3/Q10 (Ozan) — per-entity founder sync-status endpoints are LIVE
 * and DB-driven.
 *
 * Previously GET /api/founder/sync/status/company/:id and …/investor/:id 404'd
 * (no route), and the query-param variant replied a hard-coded { synced: true }
 * for any id. Now all three read the sync_* tables via syncRepo:
 *   - an entity with a live sync row  → { synced: true, version, updatedAt }
 *   - an entity with no row            → { synced: false } (200, not 404)
 *
 * Drives the REAL routes via supertest against a fully-registered app.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { upsertSyncDoc } from "../db/syncRepo";

let app: Express;
const ADMIN = "u_admin";

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 30_000);

describe("v25.48.2 Q3/Q10 — DB-driven per-entity sync status", () => {
  it("reports synced:true with real version/updatedAt for a synced company", async () => {
    const id = `co_sync_${Date.now()}`;
    upsertSyncDoc("company", { id, tenantId: "tenant_x", payload: { name: "Acme" } });
    const res = await request(app)
      .get(`/api/founder/sync/status/company/${id}`)
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.synced).toBe(true);
    expect(res.body.entity).toBe("company");
    expect(res.body.id).toBe(id);
    expect(res.body.version).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.updatedAt).toBe("string");
  });

  it("reports synced:true for a synced investor", async () => {
    const id = `inv_sync_${Date.now()}`;
    upsertSyncDoc("investor", { id, payload: { email: "lp@fund.vc" } });
    const res = await request(app)
      .get(`/api/founder/sync/status/investor/${id}`)
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.synced).toBe(true);
    expect(res.body.entity).toBe("investor");
  });

  it("reports synced:false (200, not 404) for an entity that was never synced", async () => {
    const res = await request(app)
      .get(`/api/founder/sync/status/company/co_never_synced_${Date.now()}`)
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.synced).toBe(false);
    expect(res.body.version).toBeNull();
  });
});

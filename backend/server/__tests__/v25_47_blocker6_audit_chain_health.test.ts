/**
 * v25.47 BLOCKER-6 (APD-029) — Audit-chain continuity health.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. GET /api/admin/audit-chain-health (admin) returns a healthy row.
 *      Wave A-1 (ADR-3 action 4) flipped the seed from 'incident' to 'ok'
 *      because the v25.47 seed came up P0-red on every fresh install and
 *      every :memory: boot. The real incident (if any) is now detected by
 *      the verifier tick, not pre-seeded.
 *   2. A non-admin caller is rejected (router-level requireAdmin boundary).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port: number;

function call(
  method: string,
  apiPath: string,
  opts: { userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (opts.userId) headers["x-user-id"] = opts.userId;
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
    r.end();
  });
}

beforeAll(async () => {
  getDb();
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

describe("BLOCKER-6 audit-chain health", () => {
  it("returns healthy on a fresh boot (Wave A-1 ADR-3 action 4)", async () => {
    const res = await call("GET", "/api/admin/audit-chain-health", { userId: "u_admin" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Wave A-1 flipped the seed: fresh install must NOT come up P0-red.
    // The endpoint still surfaces the tenant row so admins can see it.
    expect(res.body.incident).toBe(false);
    const healthRow = res.body.rows.find((r: any) => r.key === "tenant_admin_capavate");
    expect(healthRow).toBeTruthy();
    expect(healthRow.status).toBe("ok");
  });

  it("establishes the owner-approved chain_genesis re-base contract end-to-end (Wave A-1 v2.2, ADR-3, GPT-5 v2.1 B2)", async () => {
    // Owner-approved contract: given an installed system with malformed
    // pre-genesis audit rows, the boot verifier tick MUST leave the tenant
    // healthy IFF (a) a chain_genesis row is pinned for it, (b) its anchor
    // matches a real audit_log row's hash, and (c) every post-genesis row
    // chain-verifies from anchor_hash.
    const { rawDb } = await import("../db/connection");
    const { verifyTenantAuditChain } = await import("../adminPlatformStore");
    const { runAuditChainBootVerifier } = await import("../lib/hydrateStores");
    const db = rawDb();
    // Snapshot pre-state so we can restore after the test.
    const priorHealth = db.prepare(`SELECT status FROM audit_chain_health WHERE key = 'tenant_admin_capavate'`).get() as { status: string } | undefined;
    const priorGenesis = db.prepare(`SELECT tenant_id FROM audit_chain_genesis WHERE tenant_id = 'tenant_admin_capavate'`).get();
    const testTenant = "tenant_a1_v22_genesis_e2e";
    // Cleanup any leftover from a previous run.
    db.prepare(`DELETE FROM audit_log WHERE tenant_id = ?`).run(testTenant);
    db.prepare(`DELETE FROM audit_chain_genesis WHERE tenant_id = ?`).run(testTenant);
    db.prepare(`DELETE FROM audit_chain_health WHERE key = ?`).run(testTenant);
    try {
      // 1) Simulate the pre-repair state: a malformed row (prev_hash NULL).
      db.prepare(
        `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, target_id, payload_json, prev_hash, hash, created_at) VALUES (?, ?, 'u_admin', 'admin.created', 'user:x', 'x', '{}', NULL, ?, ?)`,
      ).run("aud_e2e_bad", testTenant, "e2e_bad_hash", "2026-01-01T00:00:00.000Z");
      // Seed a health incident so we can prove it changes.
      db.prepare(
        `INSERT OR REPLACE INTO audit_chain_health (key, status, detail, updated_at) VALUES (?, 'incident', 'test-e2e', ?)`,
      ).run(testTenant, new Date().toISOString());
      // Without a genesis, verifier reports broken.
      const brokenBefore = verifyTenantAuditChain(db, testTenant);
      expect(brokenBefore.ok).toBe(false);
      // 2) Install the chain_genesis anchor exactly as migration 0124 would.
      db.prepare(
        `INSERT OR IGNORE INTO audit_chain_genesis (tenant_id, anchor_row_id, anchor_hash, effective_at, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(testTenant, "aud_e2e_bad", "e2e_bad_hash", "2026-01-01T00:00:00.000Z", "v25.47 e2e test", "2026-01-01T00:00:00.000Z");
      // 3) Verifier now returns clean; genesis is APPLIED and anchor matches.
      const cleanAfter = verifyTenantAuditChain(db, testTenant);
      expect(cleanAfter.ok).toBe(true);
      expect(cleanAfter.genesisApplied).toBe(true);
      expect(cleanAfter.preGenesisRowCount).toBe(1);
      // 4) Boot verifier tick flips the health row from 'incident' to 'ok'.
      await runAuditChainBootVerifier({ maxTenants: Infinity });
      const afterHealth = db.prepare(`SELECT status FROM audit_chain_health WHERE key = ?`).get(testTenant) as { status: string };
      expect(afterHealth.status).toBe("ok");
      // 5) The route reports the tenant as healthy (indirect confirmation).
      const res = await call("GET", "/api/admin/audit-chain-health", { userId: "u_admin" });
      expect(res.status).toBe(200);
      const testRow = res.body.rows.find((r: any) => r.key === testTenant);
      expect(testRow).toBeTruthy();
      expect(testRow.status).toBe("ok");
      // 6) Fail-closed on a tampered anchor: change anchor_hash to garbage;
      //    verifier must fail with brokenAt=-3 (hash mismatch sentinel).
      db.prepare(`UPDATE audit_chain_genesis SET anchor_hash = 'garbage' WHERE tenant_id = ?`).run(testTenant);
      const tampered = verifyTenantAuditChain(db, testTenant);
      expect(tampered.ok).toBe(false);
      expect(tampered.brokenAt).toBe(-3);
      // 7) Fail-closed on a dangling anchor: delete the anchor row.
      db.prepare(`UPDATE audit_chain_genesis SET anchor_hash = 'e2e_bad_hash' WHERE tenant_id = ?`).run(testTenant);
      db.prepare(`DELETE FROM audit_log WHERE id = 'aud_e2e_bad'`).run();
      const dangling = verifyTenantAuditChain(db, testTenant);
      expect(dangling.ok).toBe(false);
      expect(dangling.brokenAt).toBe(-2);
    } finally {
      // Restore state.
      db.prepare(`DELETE FROM audit_log WHERE tenant_id = ?`).run(testTenant);
      db.prepare(`DELETE FROM audit_chain_genesis WHERE tenant_id = ?`).run(testTenant);
      db.prepare(`DELETE FROM audit_chain_health WHERE key = ?`).run(testTenant);
      if (priorHealth) {
        db.prepare(`INSERT OR REPLACE INTO audit_chain_health (key, status, detail, updated_at) VALUES ('tenant_admin_capavate', ?, 'restored', ?)`).run(priorHealth.status, new Date().toISOString());
      }
      if (!priorGenesis) {
        db.prepare(`DELETE FROM audit_chain_genesis WHERE tenant_id = 'tenant_admin_capavate'`).run();
      }
    }
  });

  it("rejects a non-admin caller", async () => {
    const res = await call("GET", "/api/admin/audit-chain-health");
    expect([401, 403]).toContain(res.status);
  });
});

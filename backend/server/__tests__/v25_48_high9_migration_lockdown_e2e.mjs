/**
 * v25.48 HIGH-9 — mock-data migration commit locked out of production.
 * POST /api/admin/migration/commit must be refused (403
 * mock_migration_disabled_in_production) when NODE_ENV==='production' unless
 * MOCK_MIGRATION_ALLOWED=1. Guarded at the route layer (Sacred migrationRunner
 * untouched).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, closeApp, call } from "./v25_48_helpers.mjs";

let ctx;
const SAVED = {};
beforeAll(async () => {
  SAVED.NODE_ENV = process.env.NODE_ENV;
  SAVED.MOCK = process.env.MOCK_MIGRATION_ALLOWED;
  ctx = await buildApp();
}, 30_000);
afterAll(async () => {
  if (SAVED.NODE_ENV === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = SAVED.NODE_ENV;
  if (SAVED.MOCK === undefined) delete process.env.MOCK_MIGRATION_ALLOWED; else process.env.MOCK_MIGRATION_ALLOWED = SAVED.MOCK;
  await closeApp(ctx.server);
});

describe("v25.48 HIGH-9 migration commit prod lockdown", () => {
  it("in production without override → 403 mock_migration_disabled_in_production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.MOCK_MIGRATION_ALLOWED;
    // Authenticate as a real admin via the Vitest-only x-user-id header (this
    // path is NOT gated by NODE_ENV, unlike the ?as= sandbox fallback), so we
    // pass requireAdmin and reach the HIGH-9 route-layer lockdown in prod mode.
    const res = await call(ctx.port, "POST", "/api/admin/migration/commit", { userId: "u_admin", body: {} });
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("mock_migration_disabled_in_production");
  });

  it("in production WITH MOCK_MIGRATION_ALLOWED=1 → passes the lockdown (not the 403)", async () => {
    process.env.NODE_ENV = "production";
    process.env.MOCK_MIGRATION_ALLOWED = "1";
    const res = await call(ctx.port, "POST", "/api/admin/migration/commit", { userId: "u_admin", body: {} });
    expect(res.body?.error).not.toBe("mock_migration_disabled_in_production");
  });

  it("in non-production → not blocked by the lockdown", async () => {
    process.env.NODE_ENV = "test";
    delete process.env.MOCK_MIGRATION_ALLOWED;
    const res = await call(ctx.port, "POST", "/api/admin/migration/commit", { userId: "u_admin", body: {} });
    expect(res.body?.error).not.toBe("mock_migration_disabled_in_production");
  });
});

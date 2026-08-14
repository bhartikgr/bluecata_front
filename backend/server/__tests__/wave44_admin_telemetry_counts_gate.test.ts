/**
 * WAVE 44 — the new telemetry-counts endpoint is ADMIN-GATED, proved by execution.
 *
 * Fixing the /admin/telemetry counters added exactly one route,
 * `GET /api/admin/telemetry/counts`, which surfaces platform-wide event counts.
 * `wave28_item1_prefix_middleware_ordering.test.ts` case (13) noticed it joining
 * the `requireAdmin#2` missed-route set, and that pin was updated — so this file
 * exists so the update is backed by a measurement rather than by an argument.
 *
 * `requireAdmin#2` (server/routes.ts:1300) is a DOCUMENTED BENIGN DUPLICATE of
 * the mount at routes.ts:611. `registerAdminPlatformRoutes(app)` runs at
 * routes.ts:1090 — below the first mount and above the duplicate — so the first
 * mount gates this route, exactly as it gates the three sibling
 * `/api/admin/telemetry/*` routes already pinned in that same list.
 *
 * BOTH POLES, through the REAL `registerRoutes` stack: an anonymous caller is
 * REFUSED, and an admin caller is SERVED. A one-sided version of this file
 * (only the 401, or only the 200) would be satisfied by a route that refuses
 * everyone or admits everyone.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";

let app: Express;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 120_000);

describe("WAVE 44 — GET /api/admin/telemetry/counts is admin-gated (both poles)", () => {
  it("LOWER POLE: an anonymous caller is REFUSED", async () => {
    const r = await request(app).get("/api/admin/telemetry/counts");
    expect([401, 403]).toContain(r.status);
    // And it must not leak the numbers in the refusal body.
    expect(r.body?.today).toBeUndefined();
    expect(r.body?.allTime).toBeUndefined();
  }, 60_000);

  it("UPPER POLE: an admin caller is SERVED, with the honest measured contract", async () => {
    const r = await request(app)
      .get("/api/admin/telemetry/counts")
      .set("x-user-id", "u_admin")
      .set("x-role", "admin");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.ok).toBe(true);
    // R6: the response says whether it MEASURED, so "nothing recorded" and
    // "not measured" can never render as the same zero.
    expect(r.body.measured).toBe(true);
    expect(r.body.source).toBe("telemetry_events");
    for (const k of ["today", "thisWeek", "allTime"]) {
      expect(Number.isInteger(r.body[k]), `${k} must be an integer count`).toBe(true);
      expect(r.body[k]).toBeGreaterThanOrEqual(0);
    }
    // A week can never contain fewer events than today does.
    expect(r.body.thisWeek).toBeGreaterThanOrEqual(r.body.today);
    expect(r.body.allTime).toBeGreaterThanOrEqual(r.body.thisWeek);
  }, 60_000);
});

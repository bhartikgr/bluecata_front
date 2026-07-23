/**
 * W-FIX4 Item 7 — /api/healthz build/version marker.
 *
 * The healthz endpoint must (additively) expose buildSha + buildTime alongside
 * the existing version field:
 *   - buildSha from BUILD_SHA env when set (highest priority)
 *   - degrade to "unknown" when git is unavailable AND no env is set
 *   - existing fields (ok/version/uptimeSec/dbConnected/...) must be preserved
 *
 * The resolver runs once at route registration time and reads process.env, so
 * a fresh app is registered per scenario (mirrors v24_group_d_health.test.ts).
 */
import { describe, it, expect, afterEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

let server: http.Server | null = null;

async function boot(env: Record<string, string | undefined>): Promise<number> {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const app: Express = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server!.listen(0, () => resolve()));
  return (server!.address() as { port: number }).port;
}

function getHealthz(port: number): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: "127.0.0.1", port, path: "/api/healthz", method: "GET" }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let body: any = null;
        try { body = JSON.parse(buf); } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  delete process.env.BUILD_SHA;
  delete process.env.BUILD_TIME;
});

describe("W-FIX4 Item 7 — healthz build marker", () => {
  it("returns version + buildSha + buildTime, preserving existing fields", async () => {
    const port = await boot({ BUILD_SHA: "abc1234", BUILD_TIME: "2026-07-22T00:00:00.000Z" });
    const r = await getHealthz(port);
    expect(r.status).toBe(200);
    // additive fields
    expect(r.body?.buildSha).toBe("abc1234");
    expect(r.body?.buildTime).toBe("2026-07-22T00:00:00.000Z");
    // existing fields preserved (no silent-drop)
    expect(r.body?.ok).toBe(true);
    expect(r.body?.version).toBeTruthy();
    expect(typeof r.body?.uptimeSec).toBe("number");
    expect(r.body).toHaveProperty("dbConnected");
    expect(r.body).toHaveProperty("bridgeOutboxBacklog");
    expect(r.body).toHaveProperty("timestamp");
  });

  it("degrades buildSha to 'unknown' when git is unavailable and no env is set", async () => {
    // Force git to be unresolvable by pointing PATH at an empty dir so
    // `git rev-parse` cannot be found; the resolver must fall back to "unknown".
    const prevPath = process.env.PATH;
    const port = await boot({ BUILD_SHA: undefined, GIT_SHA: undefined, PATH: "/nonexistent-empty-dir" });
    const r = await getHealthz(port);
    process.env.PATH = prevPath;
    expect(r.status).toBe(200);
    expect(r.body?.buildSha).toBe("unknown");
    // still a valid, non-throwing response
    expect(r.body?.ok).toBe(true);
  });
});

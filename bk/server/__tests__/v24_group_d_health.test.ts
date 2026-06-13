/**
 * v24.0 — Group D regression: health version resolver (D1).
 *
 * The health endpoint must:
 *   - resolve version from APP_VERSION env when set (highest priority)
 *   - fall back to package.json version when APP_VERSION is unset
 *   - NEVER silently report "0.0.0" — on total failure it returns "unknown"
 *
 * Because the resolver runs once at route registration time and reads
 * process.env.APP_VERSION, we register a fresh app per scenario with the env
 * set accordingly.
 */
import { describe, it, expect, afterEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";

let server: http.Server | null = null;

async function bootWith(appVersion: string | undefined): Promise<number> {
  if (appVersion === undefined) delete process.env.APP_VERSION;
  else process.env.APP_VERSION = appVersion;
  process.env.COLLECTIVE_ENABLED = "1";
  const app: Express = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server!.listen(0, () => resolve()));
  return (server!.address() as { port: number }).port;
}

function getHealth(port: number): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ hostname: "127.0.0.1", port, path: "/api/health", method: "GET" }, (res) => {
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
  delete process.env.APP_VERSION;
  delete process.env.COLLECTIVE_ENABLED;
});

describe("v24.0 Group D — health version resolver", () => {
  it("D1: resolves version from APP_VERSION env (highest priority)", async () => {
    const port = await bootWith("24.0.0");
    const r = await getHealth(port);
    expect(r.status).toBe(200);
    expect(r.body?.version).toBe("24.0.0");
  });

  it("D1: APP_VERSION wins even over package.json (arbitrary override honored)", async () => {
    const port = await bootWith("99.9.9-test");
    const r = await getHealth(port);
    expect(r.body?.version).toBe("99.9.9-test");
  });

  it("D1: falls back to package.json version when APP_VERSION is unset, never '0.0.0'", async () => {
    const port = await bootWith(undefined);
    const r = await getHealth(port);
    expect(r.status).toBe(200);
    // package.json is bumped to 24.0.0 for this release; in any case the value
    // must NEVER be the old silent sentinel "0.0.0".
    expect(r.body?.version).toBeTruthy();
    expect(r.body?.version).not.toBe("0.0.0");
  });
});

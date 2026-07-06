/**
 * v25.51 Phase 4 (#6) — investor CRM First/Last name split, REAL routes.
 *
 * SACRED FILE: investorCrmStore.ts. The name-split wave is PURELY ADDITIVE:
 * discrete first/last are captured and persisted, but the composed `name`
 * stays the authoritative, always-populated "First Last" field for every
 * legacy reader/export. This test drives the actual HTTP surface (POST/PATCH
 * /api/investor/crm) to prove the round-trip and the composed-name invariant.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerInvestorCrmRoutes, _testInvestorCrm } from "../investorCrmStore";

let app: Express;
let server: http.Server;
let port: number;

const INVESTOR = "u_crm_namesplit_test";

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "content-type": "application/json",
          // Vitest-only persona header (see userContext.resolvePersonaId).
          "x-user-id": INVESTOR,
          ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json: any = null;
          try { json = data ? JSON.parse(data) : null; } catch { json = data; }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  registerInvestorCrmRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => _testInvestorCrm.reset());

describe("v25.51 Phase 4 — investor CRM first/last round-trip", () => {
  it("POST with firstName+lastName persists discrete fields AND composes name", async () => {
    const r = await call("POST", "/api/investor/crm", {
      firstName: "Maya",
      lastName: "Chen",
      email: "maya@greenwood.vc",
      affiliation: "Greenwood Capital",
    });
    expect(r.status).toBe(201);
    expect(r.json.firstName).toBe("Maya");
    expect(r.json.lastName).toBe("Chen");
    // Composed name is the authoritative "First Last".
    expect(r.json.name).toBe("Maya Chen");

    // Round-trips through GET (a fresh read from the store).
    const list = await call("GET", "/api/investor/crm");
    expect(list.status).toBe(200);
    const found = (list.json as any[]).find((c) => c.id === r.json.id);
    expect(found.firstName).toBe("Maya");
    expect(found.lastName).toBe("Chen");
    expect(found.name).toBe("Maya Chen");
  });

  it("POST with only a composed name splits into first/last (legacy caller path)", async () => {
    const r = await call("POST", "/api/investor/crm", {
      name: "Sam Okoro",
      email: "sam@harbor.vc",
    });
    expect(r.status).toBe(201);
    expect(r.json.name).toBe("Sam Okoro");
    expect(r.json.firstName).toBe("Sam");
    expect(r.json.lastName).toBe("Okoro");
  });

  it("PATCH of first/last recomposes the authoritative name in lockstep", async () => {
    const created = await call("POST", "/api/investor/crm", {
      firstName: "Maya",
      lastName: "Chen",
      email: "maya@greenwood.vc",
    });
    expect(created.status).toBe(201);
    const id = created.json.id;

    const patched = await call("PATCH", `/api/investor/crm/${id}`, {
      lastName: "Chen-Alvarez",
    });
    expect(patched.status).toBe(200);
    expect(patched.json.firstName).toBe("Maya");
    expect(patched.json.lastName).toBe("Chen-Alvarez");
    // Composed name never drifts from the discrete parts.
    expect(patched.json.name).toBe("Maya Chen-Alvarez");
  });

  it("keeps composed name populated even when only firstName is supplied", async () => {
    const r = await call("POST", "/api/investor/crm", {
      firstName: "Cher",
      email: "cher@solo.vc",
    });
    expect(r.status).toBe(201);
    expect(r.json.firstName).toBe("Cher");
    expect(r.json.name).toBe("Cher");
  });
});

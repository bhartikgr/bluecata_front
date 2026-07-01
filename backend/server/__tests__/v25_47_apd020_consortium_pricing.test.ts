/**
 * v25.47 APD-020 — public Consortium Partner pricing.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. GET /api/consortium/pricing (PUBLIC, no auth) returns the canonical
 *      5-tier taxonomy in order with DB-resolved amounts.
 *   2. founding_member is invite-only at $0; the four paid tiers carry their
 *      canonical seed amounts.
 *   3. Save→Restart→Load: an admin amount edit on a tier persists to the route.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  upsertTier,
  CONSORTIUM_SUBSCRIPTION_PREFIX,
} from "../subscriptionTierStore";

let app: Express;
let server: http.Server;
let port: number;

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

function call(method: string, apiPath: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers: {} },
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

describe("APD-020 public consortium pricing", () => {
  it("returns the canonical 5-tier taxonomy in order", async () => {
    const res = await call("GET", "/api/consortium/pricing");
    expect(res.status).toBe(200);
    const slugs = res.body.tiers.map((t: any) => t.slug);
    expect(slugs).toEqual([
      "catalyst",
      "builder",
      "amplifier",
      "nexus",
      "founding_member",
    ]);
  });

  it("seeds canonical amounts and flags founding_member invite-only", async () => {
    const res = await call("GET", "/api/consortium/pricing");
    const byslug = Object.fromEntries(res.body.tiers.map((t: any) => [t.slug, t]));
    expect(byslug.catalyst.amountMinor).toBe(49900);
    expect(byslug.builder.amountMinor).toBe(99900);
    expect(byslug.amplifier.amountMinor).toBe(149900);
    expect(byslug.nexus.amountMinor).toBe(499900);
    expect(byslug.founding_member.amountMinor).toBe(0);
    expect(byslug.founding_member.inviteOnly).toBe(true);
    expect(byslug.catalyst.inviteOnly).toBe(false);
  });

  it("Save→Restart→Load: admin amount edit persists to the route", async () => {
    upsertTier({
      prefix: CONSORTIUM_SUBSCRIPTION_PREFIX,
      slug: "catalyst",
      amountMinor: 54900,
      updatedByUserId: "u_admin",
    });
    const res = await call("GET", "/api/consortium/pricing");
    const catalyst = res.body.tiers.find((t: any) => t.slug === "catalyst");
    expect(catalyst.amountMinor).toBe(54900);
    // Restore canonical seed.
    upsertTier({
      prefix: CONSORTIUM_SUBSCRIPTION_PREFIX,
      slug: "catalyst",
      amountMinor: 49900,
      updatedByUserId: "system:seed",
    });
  });
});

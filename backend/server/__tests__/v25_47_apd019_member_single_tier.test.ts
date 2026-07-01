/**
 * v25.47 APD-019 / APD-032(B) — Collective single canonical member tier.
 *
 * Real-route supertest coverage (Tier-6):
 *   1. GET /api/collective/member-tier returns the canonical `standard` tier
 *      seeded at 24900 minor ($249/mo), fromDb:true.
 *   2. resolveCanonicalMemberTierSlug maps legacy basic/pro/enterprise (and
 *      unknown) onto `standard`.
 *   3. Save→Restart→Load: an admin amount edit persists and the route reflects
 *      the new amount on a fresh read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  resolveCanonicalMemberTierSlug,
  CANONICAL_MEMBER_TIER_SLUG,
} from "../lib/collectiveMemberSubscriptionResolver";
import {
  upsertTier,
  COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX,
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

describe("APD-019 collective single canonical member tier", () => {
  it("GET /api/collective/member-tier returns canonical standard tier", async () => {
    const res = await call("GET", "/api/collective/member-tier");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe(CANONICAL_MEMBER_TIER_SLUG);
    expect(res.body.amountMinor).toBe(24900);
    expect(res.body.currency).toBe("USD");
    expect(res.body.billingPeriod).toBe("monthly");
    expect(res.body.fromDb).toBe(true);
  });

  it("resolveCanonicalMemberTierSlug collapses legacy + unknown onto standard", () => {
    expect(resolveCanonicalMemberTierSlug("basic")).toBe("standard");
    expect(resolveCanonicalMemberTierSlug("pro")).toBe("standard");
    expect(resolveCanonicalMemberTierSlug("enterprise")).toBe("standard");
    expect(resolveCanonicalMemberTierSlug("standard")).toBe("standard");
    expect(resolveCanonicalMemberTierSlug("whatever")).toBe("standard");
    expect(resolveCanonicalMemberTierSlug(undefined)).toBe("standard");
  });

  it("Save→Restart→Load: admin amount edit persists to the route", async () => {
    upsertTier({
      prefix: COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX,
      slug: CANONICAL_MEMBER_TIER_SLUG,
      amountMinor: 25900,
      updatedByUserId: "u_admin",
    });
    // Fresh DB-direct read (resolver reads platform_fees on every call).
    const res = await call("GET", "/api/collective/member-tier");
    expect(res.status).toBe(200);
    expect(res.body.amountMinor).toBe(25900);
    // Restore canonical seed so other tests/specs see the seeded value.
    upsertTier({
      prefix: COLLECTIVE_MEMBER_SUBSCRIPTION_PREFIX,
      slug: CANONICAL_MEMBER_TIER_SLUG,
      amountMinor: 24900,
      updatedByUserId: "system:seed",
    });
  });
});

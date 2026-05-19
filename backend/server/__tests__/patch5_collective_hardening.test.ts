/**
 * Patch v5 — Collective hardening contract tests.
 *
 * Two concerns covered:
 *
 *   1. Auth gate: every /api/collective/* endpoint requires an
 *      authenticated session. Anonymous callers receive
 *      401 { error: "AUTH_REQUIRED" }. Authenticated personas (member /
 *      consortium-partner) pass through and receive 200 with data.
 *
 *   2. Demo-seed defense-in-depth: when NODE_ENV === "production",
 *      adminContacts rows flagged isSeed=true are stripped from
 *      /api/collective/members responses regardless of
 *      DEMO_SEED_ENABLED.
 *
 * Wires the real Express stack via `registerRoutes` so the patched
 * middleware ordering is exactly what production runs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { createContact } from "../adminContactsStore";

let app: Express;
let server: http.Server;
let port: number;

beforeAll(async () => {
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

/* ---------- HTTP helper ---------- */

function call(
  method: string,
  path: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any; bodyText: string }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body, bodyText: buf });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/* ---------- Anonymous gate tests ---------- *
 *
 * Each test forces production mode via vi.stubEnv so the userContext
 * resolver does NOT fall back to a demo persona. This is the exact
 * production posture: anonymous => no persona => 401.
 */

describe("Patch v5 — anonymous probe to every /api/collective/* endpoint returns 401", () => {
  const cases: Array<{ method: "GET" | "POST"; path: string; label: string }> = [
    { method: "GET", path: "/api/collective/dashboard", label: "dashboard" },
    { method: "GET", path: "/api/collective/members", label: "members" },
    { method: "GET", path: "/api/collective/companies", label: "companies" },
    { method: "GET", path: "/api/collective/dealroom/companies", label: "dealroom.companies" },
    { method: "GET", path: "/api/collective/dsc/scores", label: "dsc.scores" },
    { method: "GET", path: "/api/collective/dsc/pipeline", label: "dsc.pipeline" },
    { method: "GET", path: "/api/collective/activity", label: "activity" },
    { method: "GET", path: "/api/collective/soft-circles", label: "soft-circles" },
    { method: "GET", path: "/api/collective/dsc/prep", label: "dsc.prep" },
    { method: "GET", path: "/api/collective/dsc/composite/co_x", label: "dsc.composite" },
  ];

  for (const c of cases) {
    it(`${c.method} ${c.path} → 401 AUTH_REQUIRED (anonymous, production)`, async () => {
      vi.stubEnv("NODE_ENV", "production");
      try {
        const res = await call(c.method, c.path);
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ error: "AUTH_REQUIRED" });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  }
});

/* ---------- Authenticated pass-through tests ---------- */

describe("Patch v5 — authenticated callers reach Collective endpoints", () => {
  it("Authenticated member (aisha) → /api/collective/members → 200 with members", async () => {
    const res = await call("GET", "/api/collective/members", { userId: "u_aisha_patel" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
    // Seed populated in test env (ENABLE_DEMO_SEED=1) → members > 0.
    expect(res.body.members.length).toBeGreaterThan(0);
  });

  it("Authenticated consortium-partner (avi.managing) → /api/collective/members → 200 with members", async () => {
    const res = await call("GET", "/api/collective/members", { userId: "u_avi_managing" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.members.length).toBeGreaterThan(0);
  });

  it("Authenticated member (aisha) → /api/collective/dealroom/companies → 200 (collective.active passes)", async () => {
    const res = await call("GET", "/api/collective/dealroom/companies", { userId: "u_aisha_patel" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.companies)).toBe(true);
  });
});

/* ---------- Production-mode seed filter (defense in depth) ---------- *
 *
 * Tests 14 and 15 simulate a hostile boot: NODE_ENV=production at request
 * time. We use vi.stubEnv to flip the value just for the request, then
 * restore. Auth is supplied via x-user-id so we exercise the seed filter
 * code path (not the 401 gate).
 */

describe("Patch v5 — production-mode seed filter on /api/collective/members", () => {
  it("Production-mode (no ENABLE_DEMO_SEED) — /api/collective/members has zero rows flagged isSeed=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await call("GET", "/api/collective/members", { userId: "u_aisha_patel" });
      expect(res.status).toBe(200);
      // The members payload deliberately omits isSeed (PII-safe shape).
      // The contract we test is the leak surface: NONE of the well-known
      // seed legalNames/displayNames may appear in the response body in
      // production mode. This mirrors what an external auditor would do
      // against a live server.
      const KNOWN_SEED_NAMES = [
        "TEST PARTNER, INC",
        "Sequoia Capital",
        "Atomico",
        "OMERS Ventures",
        "GIC",
        "a16z",
        "Keiretsu Forum",
      ];
      for (const name of KNOWN_SEED_NAMES) {
        expect(res.bodyText).not.toContain(name);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("isSeed filter test — when adminContacts has both real (isSeed=false) and seed (isSeed=true) rows, only real ones appear in production-mode /api/collective/members", async () => {
    // Insert a real, non-seed investor contact. createContact does NOT set
    // isSeed (defaults to undefined/false) — proving the filter discriminates
    // by origin, not by row position.
    const realInvestor = createContact(
      {
        kind: "investor",
        legalName: "Patch v5 Real Investor LP",
        displayName: "Patch5 Real Investor",
        email: "realinvestor+patch5@example.com",
        type: "institutional",
        status: "active",
        verification: "verified",
        hqCity: "New York",
        hqCountry: "US",
        region: "US",
        aumMinor: null,
        aumCurrency: "USD",
        checkSizeMinMinor: null,
        checkSizeMaxMinor: null,
        industries: ["saas"],
        stages: ["seed"],
        companyIds: [],
        partnerWeight: null,
        partnerSince: null,
        phone: null,
        website: null,
        linkedinUrl: null,
        tags: ["patch5-real"],
        notes: "Patch v5 test row — must survive production-mode filter.",
        createdBy: "u_patch5_test",
        updatedBy: "u_patch5_test",
      },
      "u_patch5_test",
    );

    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await call("GET", "/api/collective/members", { userId: "u_aisha_patel" });
      expect(res.status).toBe(200);
      const names = (res.body.members as Array<{ displayName: string }>).map((m) => m.displayName);
      // Real contact survives.
      expect(names).toContain(realInvestor.displayName);
      // No seed names leak.
      expect(names).not.toContain("Sequoia Capital");
      expect(names).not.toContain("TEST PARTNER, INC");
      expect(names).not.toContain("Atomico");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

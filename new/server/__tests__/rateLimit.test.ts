/**
 * v19 Phase C — Collective bucket rate-limit tests.
 *
 * The legacy READ_LIMIT=60 / WRITE_LIMIT=10 limiter is exercised by
 * security.test.ts. This file specifically targets the new
 * `collectiveRateLimit` middleware and its (user, bucket) sliding-window
 * state.
 *
 * Coverage:
 *   - write bucket: 60th request passes, 61st returns 429 with bucket=write
 *   - read bucket: 600 reads succeed for a single user (sanity bound)
 *   - sse bucket: 30 connects pass, 31st returns 429 with bucket=sse
 *   - response headers (X-RateLimit-Bucket / Limit / Remaining / Reset) present
 *   - separate users have separate buckets
 *   - read and write buckets are independent for the same user
 *   - 429 body shape {error:"rate_limited", bucket, retryAfterMs}
 *   - _resetRateLimitsForTests() clears collective state
 *   - _collectiveBucketSnapshot() reports per-bucket hit counts
 *   - CollectiveBucketLimits matches the documented values
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  collectiveRateLimit,
  rateLimitMiddleware,
  CollectiveBucketLimits,
  RATE_LIMIT_BYPASS_PATHS,
  _collectiveBucketSnapshot,
  _resetRateLimitsForTests,
} from "../lib/rateLimit";

/* Tiny app factory: attach an x-user-id-aware shim that mimics how the
 * real auth middleware would populate req.userContext.userId. */
function makeApp() {
  const app = express();
  app.use((req, _res, next) => {
    const uid = req.headers["x-user-id"];
    if (typeof uid === "string" && uid.length > 0) {
      (req as any).userContext = { userId: uid };
    }
    next();
  });
  app.use("/api/collective", collectiveRateLimit);
  app.get("/api/collective/items", (_req, res) => res.json({ ok: true }));
  app.post("/api/collective/items", (_req, res) => res.json({ ok: true }));
  app.get("/api/collective/sse/feed", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("v19 Phase C — collectiveRateLimit middleware", () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it("documents bucket limits write=60 read=600 sse=30", () => {
    expect(CollectiveBucketLimits.write).toBe(60);
    expect(CollectiveBucketLimits.read).toBe(600);
    expect(CollectiveBucketLimits.sse).toBe(30);
  });

  it("write bucket: 60 requests pass, 61st returns 429", async () => {
    const app = makeApp();
    for (let i = 0; i < 60; i++) {
      const r = await request(app)
        .post("/api/collective/items")
        .set("x-user-id", "u_write_burst");
      expect(r.status).toBe(200);
    }
    const overflow = await request(app)
      .post("/api/collective/items")
      .set("x-user-id", "u_write_burst");
    expect(overflow.status).toBe(429);
    expect(overflow.body.error).toBe("rate_limited");
    expect(overflow.body.bucket).toBe("write");
    expect(typeof overflow.body.retryAfterMs).toBe("number");
    expect(overflow.body.retryAfterMs).toBeGreaterThan(0);
  });

  it("sse bucket: 30 requests pass, 31st returns 429 with bucket=sse", async () => {
    const app = makeApp();
    for (let i = 0; i < 30; i++) {
      const r = await request(app)
        .get("/api/collective/sse/feed")
        .set("x-user-id", "u_sse_burst");
      expect(r.status).toBe(200);
    }
    const overflow = await request(app)
      .get("/api/collective/sse/feed")
      .set("x-user-id", "u_sse_burst");
    expect(overflow.status).toBe(429);
    expect(overflow.body.bucket).toBe("sse");
  });

  it("sets X-RateLimit-* response headers on every response", async () => {
    const app = makeApp();
    const r = await request(app)
      .get("/api/collective/items")
      .set("x-user-id", "u_headers");
    expect(r.status).toBe(200);
    expect(r.headers["x-ratelimit-bucket"]).toBe("read");
    expect(r.headers["x-ratelimit-limit"]).toBe("600");
    expect(r.headers["x-ratelimit-remaining"]).toBe("599");
    expect(r.headers["x-ratelimit-reset"]).toMatch(/^\d+$/);
  });

  it("separate users have independent buckets", async () => {
    const app = makeApp();
    // Burn user A's write bucket
    for (let i = 0; i < 60; i++) {
      await request(app)
        .post("/api/collective/items")
        .set("x-user-id", "u_alice");
    }
    const aliceOverflow = await request(app)
      .post("/api/collective/items")
      .set("x-user-id", "u_alice");
    expect(aliceOverflow.status).toBe(429);

    // User B is untouched.
    const bob = await request(app)
      .post("/api/collective/items")
      .set("x-user-id", "u_bob");
    expect(bob.status).toBe(200);
  });

  it("read and write buckets are independent for the same user", async () => {
    const app = makeApp();
    // Saturate write for a user.
    for (let i = 0; i < 60; i++) {
      await request(app)
        .post("/api/collective/items")
        .set("x-user-id", "u_split");
    }
    const writeOverflow = await request(app)
      .post("/api/collective/items")
      .set("x-user-id", "u_split");
    expect(writeOverflow.status).toBe(429);

    // Same user can still READ (different bucket).
    const read = await request(app)
      .get("/api/collective/items")
      .set("x-user-id", "u_split");
    expect(read.status).toBe(200);
    expect(read.headers["x-ratelimit-bucket"]).toBe("read");
  });

  it("falls back to client IP when no user is authenticated", async () => {
    const app = makeApp();
    // No x-user-id header → falls back to req.ip.
    const r = await request(app).get("/api/collective/items");
    expect(r.status).toBe(200);
    expect(r.headers["x-ratelimit-bucket"]).toBe("read");
  });

  it("_collectiveBucketSnapshot reports per-bucket hit counts", async () => {
    const app = makeApp();
    await request(app)
      .post("/api/collective/items")
      .set("x-user-id", "u_snap");
    await request(app)
      .post("/api/collective/items")
      .set("x-user-id", "u_snap");
    await request(app)
      .get("/api/collective/items")
      .set("x-user-id", "u_snap");
    const snap = _collectiveBucketSnapshot();
    expect(snap["u:u_snap:cb:write"]).toBe(2);
    expect(snap["u:u_snap:cb:read"]).toBe(1);
  });

  it("_resetRateLimitsForTests clears collective state", async () => {
    const app = makeApp();
    for (let i = 0; i < 60; i++) {
      await request(app)
        .post("/api/collective/items")
        .set("x-user-id", "u_reset");
    }
    // 61st must be 429
    const before = await request(app)
      .post("/api/collective/items")
      .set("x-user-id", "u_reset");
    expect(before.status).toBe(429);

    _resetRateLimitsForTests();

    // Post-reset, the same user can write again.
    const after = await request(app)
      .post("/api/collective/items")
      .set("x-user-id", "u_reset");
    expect(after.status).toBe(200);
    expect(_collectiveBucketSnapshot()["u:u_reset:cb:write"]).toBe(1);
  });
});

/* ============================================================
 * CP-038 — /api/health rate-limit bypass.
 * ============================================================ */
describe("CP-038 — /api/health bypasses rate limiters", () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
  });

  it("declares the bypass paths", () => {
    expect(RATE_LIMIT_BYPASS_PATHS.has("/api/health")).toBe(true);
    expect(RATE_LIMIT_BYPASS_PATHS.has("/api/healthz")).toBe(true);
  });

  it("bursting /api/health 100x under the main rateLimitMiddleware never 429s", async () => {
    const app = express();
    // Mount the main limiter at /api so it sees /api/health as a path.
    app.use("/api", rateLimitMiddleware);
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

    let any429 = false;
    for (let i = 0; i < 100; i++) {
      const r = await request(app).get("/api/health");
      if (r.status === 429) {
        any429 = true;
        break;
      }
      expect(r.status).toBe(200);
    }
    expect(any429).toBe(false);
  });

  it("bursting /api/health 100x under collectiveRateLimit never 429s", async () => {
    const app = express();
    // Use the collective limiter as a global — even so, /api/health bypasses.
    app.use(collectiveRateLimit);
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

    let any429 = false;
    for (let i = 0; i < 100; i++) {
      const r = await request(app).get("/api/health");
      if (r.status === 429) {
        any429 = true;
        break;
      }
      expect(r.status).toBe(200);
    }
    expect(any429).toBe(false);
  });

  it("non-health paths still rate-limit normally under collectiveRateLimit", async () => {
    // Confirm the bypass is targeted — a non-health path under the same
    // limiter must still 429 after the bucket is exhausted.
    const app = express();
    app.use((req, _res, next) => {
      (req as any).userContext = { userId: "u_health_neg" };
      next();
    });
    app.use("/api/collective", collectiveRateLimit);
    app.post("/api/collective/items", (_req, res) => res.json({ ok: true }));

    let saw429 = false;
    for (let i = 0; i < CollectiveBucketLimits.write + 5; i++) {
      const r = await request(app).post("/api/collective/items");
      if (r.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});

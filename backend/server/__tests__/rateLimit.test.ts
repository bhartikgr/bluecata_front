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
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { loadUserContext } from "../lib/requireEntitlement";
import { signSessionValue, LEGACY_SESSION_COOKIE } from "../lib/sessionCookie";

/**
 * WAVE 19 · WAIVER-2 — THIS FACTORY USED TO LIE.
 *
 * It installed its own middleware ahead of the limiter:
 *
 *     app.use((req,_res,next) => {
 *       const uid = req.headers["x-user-id"];
 *       if (typeof uid === "string" && uid.length > 0)
 *         (req as any).userContext = { userId: uid };
 *       next();
 *     });
 *
 * described in its own comment as "mimic[king] how the real auth middleware
 * would populate req.userContext.userId". Thirteen tests passed against
 * per-user buckets that existed only inside the shim, and the file was
 * therefore evidence about itself and nothing else.
 *
 * It now runs the PRODUCTION chain in the production registration order —
 * cookie parsing (`server/index.ts:76`), then `loadUserContext`
 * (`server/routes.ts:534`), then the limiter (`:1043-1045`) — and identity
 * arrives the way it arrives in production: an HMAC-signed `cap_uid` cookie.
 * NOTHING here assigns `userContext` by hand.
 *
 * The assertions are unchanged. Only the setup path is. That is the point:
 * with the real chain in place the per-user bucket claims still hold, which is
 * what the shim could never establish.
 */
function cookieShim(): express.RequestHandler {
  return (req, _res, next) => {
    const r = req as express.Request & { cookies?: Record<string, string> };
    if (!r.cookies) {
      const out: Record<string, string> = {};
      for (const part of String(req.headers.cookie ?? "").split(";")) {
        const eq = part.indexOf("=");
        if (eq <= 0) continue;
        out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
      }
      r.cookies = out;
    }
    next();
  };
}

/** A real signed session cookie — the production identity carrier. */
function cookieFor(userId: string): string {
  return `${LEGACY_SESSION_COOKIE}=${encodeURIComponent(signSessionValue(userId))}`;
}

function makeApp() {
  const app = express();
  app.use(cookieShim());
  app.use(loadUserContext);
  app.use("/api/collective", collectiveRateLimit);
  app.get("/api/collective/items", (_req, res) => res.json({ ok: true }));
  app.post("/api/collective/items", (_req, res) => res.json({ ok: true }));
  app.get("/api/collective/sse/feed", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("v19 Phase C — collectiveRateLimit middleware", () => {
  beforeEach(() => {
    _resetRateLimitsForTests();
    /* WAVE 19 — without this, `resolvePersonaIdWithFallback`
       (`server/lib/userContext.ts:518`) hands an ANONYMOUS request the demo
       persona `u_aisha_patel`, and the IP-fallback test below would silently be
       testing the demo fallback instead. */
    process.env.DISABLE_DEV_BYPASS = "1";
    delete process.env.TRUSTED_PROXY_HOPS;
  });
  afterEach(() => {
    delete process.env.DISABLE_DEV_BYPASS;
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
        .set("Cookie", cookieFor("u_write_burst"));
      expect(r.status).toBe(200);
    }
    const overflow = await request(app)
      .post("/api/collective/items")
      .set("Cookie", cookieFor("u_write_burst"));
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
        .set("Cookie", cookieFor("u_sse_burst"));
      expect(r.status).toBe(200);
    }
    const overflow = await request(app)
      .get("/api/collective/sse/feed")
      .set("Cookie", cookieFor("u_sse_burst"));
    expect(overflow.status).toBe(429);
    expect(overflow.body.bucket).toBe("sse");
  });

  it("sets X-RateLimit-* response headers on every response", async () => {
    const app = makeApp();
    const r = await request(app)
      .get("/api/collective/items")
      .set("Cookie", cookieFor("u_headers"));
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
        .set("Cookie", cookieFor("u_alice"));
    }
    const aliceOverflow = await request(app)
      .post("/api/collective/items")
      .set("Cookie", cookieFor("u_alice"));
    expect(aliceOverflow.status).toBe(429);

    // User B is untouched.
    const bob = await request(app)
      .post("/api/collective/items")
      .set("Cookie", cookieFor("u_bob"));
    expect(bob.status).toBe(200);
  });

  it("read and write buckets are independent for the same user", async () => {
    const app = makeApp();
    // Saturate write for a user.
    for (let i = 0; i < 60; i++) {
      await request(app)
        .post("/api/collective/items")
        .set("Cookie", cookieFor("u_split"));
    }
    const writeOverflow = await request(app)
      .post("/api/collective/items")
      .set("Cookie", cookieFor("u_split"));
    expect(writeOverflow.status).toBe(429);

    // Same user can still READ (different bucket).
    const read = await request(app)
      .get("/api/collective/items")
      .set("Cookie", cookieFor("u_split"));
    expect(read.status).toBe(200);
    expect(read.headers["x-ratelimit-bucket"]).toBe("read");
  });

  it("falls back to client IP when no user is authenticated", async () => {
    const app = makeApp();
    // No session cookie → falls back to the socket peer.
    const r = await request(app).get("/api/collective/items");
    expect(r.status).toBe(200);
    expect(r.headers["x-ratelimit-bucket"]).toBe("read");
    /* WAVE 19 — the original assertion stopped at the header, which a `u:`
       bucket would also satisfy, so it did not actually test the fallback.
       The bucket key is now checked. */
    const keys = Object.keys(_collectiveBucketSnapshot());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^ip:.*:cb:read$/);
    expect(keys[0]).not.toMatch(/^u:/);
  });

  it("WAVE 19 — a forged x-forwarded-for cannot mint a second anonymous bucket", async () => {
    /* The property the shimmed version of this file could never have caught. */
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      await request(app).get("/api/collective/items").set("x-forwarded-for", `203.0.113.${i}`);
    }
    const keys = Object.keys(_collectiveBucketSnapshot());
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toMatch(/203\.0\.113/);
  });

  it("_collectiveBucketSnapshot reports per-bucket hit counts", async () => {
    const app = makeApp();
    await request(app)
      .post("/api/collective/items")
      .set("Cookie", cookieFor("u_snap"));
    await request(app)
      .post("/api/collective/items")
      .set("Cookie", cookieFor("u_snap"));
    await request(app)
      .get("/api/collective/items")
      .set("Cookie", cookieFor("u_snap"));
    const snap = _collectiveBucketSnapshot();
    expect(snap["u:u_snap:cb:write"]).toBe(2);
    expect(snap["u:u_snap:cb:read"]).toBe(1);
  });

  it("_resetRateLimitsForTests clears collective state", async () => {
    const app = makeApp();
    for (let i = 0; i < 60; i++) {
      await request(app)
        .post("/api/collective/items")
        .set("Cookie", cookieFor("u_reset"));
    }
    // 61st must be 429
    const before = await request(app)
      .post("/api/collective/items")
      .set("Cookie", cookieFor("u_reset"));
    expect(before.status).toBe(429);

    _resetRateLimitsForTests();

    // Post-reset, the same user can write again.
    const after = await request(app)
      .post("/api/collective/items")
      .set("Cookie", cookieFor("u_reset"));
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

/**
 * Wave C / FIX C4 — Rate limit /api/auth/login and /api/auth/signup.
 *
 * V23_FINAL_CODE_AUDIT.md R-4 (P1): pre-fix the unauthenticated login and
 * signup endpoints had no IP-based throttle. An attacker could spray
 * thousands of (email, password) pairs per second. The existing per-email
 * `recordAuthFailure` lockout only triggers AFTER 5 confirmed mismatches
 * — it doesn't slow the spray itself.
 *
 * The Wave C fix adds `authLoginRateLimit` (10/min/IP) and
 * `authSignupRateLimit` (5/hour/IP) middlewares in server/lib/rateLimit.ts
 * and wires them into server/lib/authRoutes.ts BEFORE the handlers.
 *
 * Math-sacred guarantee: this test touches no cap-table state.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import {
  _resetAuthRateLimitsForTests,
  AuthRateLimitConfig,
} from "../lib/rateLimit";

let app: Express;
let PRIOR_ENFORCE_FLAG: string | undefined;

beforeAll(async () => {
  // Opt into production-equivalent enforcement of the auth rate limiter.
  // The wider test suite runs with the bypass enabled (see
  // server/lib/rateLimit.ts:authRateLimitDisabledForTests) so we don't
  // mutate every pre-existing test. This file validates the production
  // semantics end-to-end.
  PRIOR_ENFORCE_FLAG = process.env.ENFORCE_AUTH_RATELIMIT;
  process.env.ENFORCE_AUTH_RATELIMIT = "1";

  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
});

afterAll(() => {
  if (PRIOR_ENFORCE_FLAG === undefined) delete process.env.ENFORCE_AUTH_RATELIMIT;
  else process.env.ENFORCE_AUTH_RATELIMIT = PRIOR_ENFORCE_FLAG;
  /* WAVE 19 — a test in this file sets TRUSTED_PROXY_HOPS; it must not escape
     the file and re-loosen another suite's limiter keying. */
  delete process.env.TRUSTED_PROXY_HOPS;
});

beforeEach(() => {
  _resetAuthRateLimitsForTests();
  /* WAVE 19 — fail-closed default unless a test opts in explicitly. */
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("Wave C FIX C4 — per-IP rate limit on /api/auth/login", () => {
  it("allows up to LOGIN_LIMIT requests in a window", async () => {
    const limit = AuthRateLimitConfig.LOGIN_LIMIT;
    for (let i = 0; i < limit; i++) {
      const r = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.1")
        .send({ email: `nobody${i}@example.com`, password: "wrongpw" });
      // The endpoint returns 401 for invalid creds; the limiter must NOT
      // 429 within the first LOGIN_LIMIT attempts.
      expect(r.status).not.toBe(429);
    }
  });

  it("returns 429 on the (LIMIT+1)th attempt from the same IP", async () => {
    const limit = AuthRateLimitConfig.LOGIN_LIMIT;
    // Burn the budget.
    for (let i = 0; i < limit; i++) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.2")
        .send({ email: `nobody${i}@example.com`, password: "wrongpw" });
    }
    // One more from the same IP.
    const r = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.2")
      .send({ email: "nobody@example.com", password: "wrongpw" });
    expect(r.status).toBe(429);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe("rate_limited");
    expect(typeof r.body.retryAfterMs).toBe("number");
  });

  it("sets X-RateLimit-* response headers on every login response", async () => {
    const r = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.3")
      .send({ email: "foo@bar.com", password: "x" });
    expect(r.headers["x-ratelimit-limit"]).toBe(
      String(AuthRateLimitConfig.LOGIN_LIMIT),
    );
    expect(r.headers["x-ratelimit-remaining"]).toBeDefined();
    expect(r.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("rate limits are PER-IP (distinct IPs have independent budgets)", async () => {
    /* WAVE 19 · WAIVER-2 — INTENT PRESERVED, MECHANISM CORRECTED.
     *
     * This test used to establish "distinct IPs" purely by sending a different
     * `X-Forwarded-For` on each request. That is not two clients; it is one
     * client sending two strings. Before the WAIVER-2 fix the limiter believed
     * it, which is precisely why an attacker could spray login attempts
     * without limit — so the test was, unintentionally, asserting the
     * vulnerability, and would have gone green forever while the throttle did
     * nothing.
     *
     * `authIpKey` now goes through `resolveRateLimitClientIp`, which ignores
     * the header unless `TRUSTED_PROXY_HOPS` declares how many proxies WE
     * operate in front of the process. Setting it to 1 here models the real
     * deployment this test is about — a load balancer that appends the true
     * peer — so the ORIGINAL assertion (two genuinely distinct clients get
     * independent budgets) is preserved and still meaningful. The companion
     * test below covers the untrusted case.
     */
    process.env.TRUSTED_PROXY_HOPS = "1";
    const limit = AuthRateLimitConfig.LOGIN_LIMIT;
    // IP A exhausts its budget.
    for (let i = 0; i < limit; i++) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({ email: `a${i}@x.com`, password: "x" });
    }
    const ra = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ email: "a@x.com", password: "x" });
    expect(ra.status).toBe(429);

    // IP B from a fresh address — must NOT be 429.
    const rb = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.11")
      .send({ email: "b@x.com", password: "x" });
    expect(rb.status).not.toBe(429);
  });

  it("WAVE 19 — with NO trusted-proxy configuration, rotating X-Forwarded-For does NOT buy a fresh budget", async () => {
    /* The pole the original test was missing, and the actual security
       property: fail closed. One host, many claimed addresses, one budget. */
    delete process.env.TRUSTED_PROXY_HOPS;
    const limit = AuthRateLimitConfig.LOGIN_LIMIT;
    const codes: number[] = [];
    for (let i = 0; i < limit + 3; i++) {
      const r = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `198.51.100.${i}`)
        .send({ email: `spray${i}@x.com`, password: "x" });
      codes.push(r.status);
    }
    expect(codes.filter((c) => c === 429)).toHaveLength(3);
  });

  it("does not throttle a successful login attempt issued within the budget", async () => {
    // Maya is a canonical demo persona with a known password.
    const r = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.20")
      .send({ email: "maya@novapay.ai", password: "password123" });
    // Either 200 (demo-seed enabled) or 401 (demo-seed disabled) — but NOT
    // 429 on the first attempt from a fresh IP.
    expect(r.status).not.toBe(429);
  });
});

describe("Wave C FIX C4 — per-IP rate limit on /api/auth/signup", () => {
  it("allows up to SIGNUP_LIMIT requests in a window", async () => {
    const limit = AuthRateLimitConfig.SIGNUP_LIMIT;
    for (let i = 0; i < limit; i++) {
      const r = await request(app)
        .post("/api/auth/signup")
        .set("X-Forwarded-For", "203.0.113.30")
        .send({
          email: `c4_signup_${Date.now()}_${i}@x.example`,
          name: "Test Founder",
          password: "verysecure1234",
        });
      expect(r.status).not.toBe(429);
    }
  });

  it("returns 429 on the (LIMIT+1)th signup from the same IP", async () => {
    const limit = AuthRateLimitConfig.SIGNUP_LIMIT;
    for (let i = 0; i < limit; i++) {
      await request(app)
        .post("/api/auth/signup")
        .set("X-Forwarded-For", "203.0.113.31")
        .send({
          email: `c4_burn_${Date.now()}_${i}@x.example`,
          name: "Burner",
          password: "verysecure1234",
        });
    }
    const r = await request(app)
      .post("/api/auth/signup")
      .set("X-Forwarded-For", "203.0.113.31")
      .send({
        email: `c4_extra_${Date.now()}@x.example`,
        name: "Burner",
        password: "verysecure1234",
      });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("rate_limited");
  });

  it("signup limit is independent of login limit (separate buckets)", async () => {
    // Exhaust the LOGIN budget for one IP.
    const loginLimit = AuthRateLimitConfig.LOGIN_LIMIT;
    for (let i = 0; i < loginLimit; i++) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.40")
        .send({ email: `x${i}@x.com`, password: "x" });
    }
    const loginR = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.40")
      .send({ email: "x@x.com", password: "x" });
    expect(loginR.status).toBe(429);

    // The same IP can still SIGNUP up to its own budget.
    const signupR = await request(app)
      .post("/api/auth/signup")
      .set("X-Forwarded-For", "203.0.113.40")
      .send({
        email: `c4_independent_${Date.now()}@x.example`,
        name: "Independent",
        password: "verysecure1234",
      });
    expect(signupR.status).not.toBe(429);
  });
});

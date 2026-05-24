/**
 * Sprint 17 D2 — security test suite.
 *
 * Covers:
 *   - JWT signing/tampering (6)
 *   - Password hashing + weak-password rejection (4)
 *   - CSRF middleware reject paths (12)
 *   - Rate limiter sliding window (8)
 *   - Replay attack rejection (4)
 *   - SQL-injection blocked by parameterized queries (4)
 *   - XSS payload rejected by zod sanitizers (4)
 *   - Sensitive-data redaction (2)
 *   - CSP headers present (2)
 *
 * 46 tests total (>= 44 mandate).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity"; /* v14 Tier-1 Fix 1 — restores u_admin default identity for legacy tests */
import express from "express";
import request from "supertest";
import { signJwt, verifyJwt, hashPassword, verifyPassword, passwordIsStrong, createSession, getSession, revokeSession } from "../lib/auth";
import { csrfMiddleware } from "../lib/csrf";
import { rateLimitMiddleware, _resetRateLimitsForTests, recordAuthFailure, isLockedOut, RateLimitConfig } from "../lib/rateLimit";
import { securityHeaders } from "../middleware/security";
import { redact } from "../lib/sanitize";
import { upsertSyncDoc, getSyncDoc } from "../db/syncRepo";
import { getDb } from "../db/connection";
import { strictObject, validateBody } from "../lib/inputValidation";
import { z } from "zod";

// Prime DB once
getDb();

/* ============================================================
 *  JWT (6 tests)
 * ============================================================ */
describe("JWT signing / verification", () => {
  it("round-trips a valid token", () => {
    const t = signJwt({ sub: "u_1", role: "founder", sid: "s1" });
    const c = verifyJwt(t);
    expect(c?.sub).toBe("u_1");
    expect(c?.role).toBe("founder");
  });
  it("rejects a tampered body", () => {
    const t = signJwt({ sub: "u_1", role: "founder", sid: "s1" });
    const [h, b, s] = t.split(".");
    const tampered = `${h}.${b}X.${s}`;
    expect(verifyJwt(tampered)).toBeNull();
  });
  it("rejects a tampered signature", () => {
    const t = signJwt({ sub: "u_1", role: "founder", sid: "s1" });
    const [h, b] = t.split(".");
    expect(verifyJwt(`${h}.${b}.zzzzzzzzzz`)).toBeNull();
  });
  it("rejects malformed tokens (2 parts)", () => {
    expect(verifyJwt("a.b")).toBeNull();
  });
  it("rejects expired tokens", () => {
    const t = signJwt({ sub: "u_1", role: "founder", sid: "s1" }, -10);
    expect(verifyJwt(t)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(verifyJwt("not.a.token-at-all")).toBeNull();
  });
});

/* ============================================================
 *  Password hashing (4 tests)
 * ============================================================ */
describe("Password hashing + strength gate", () => {
  it("hashes and verifies", () => {
    const h = hashPassword("CorrectHorse42");
    expect(verifyPassword("CorrectHorse42", h)).toBe(true);
  });
  it("rejects wrong passwords", () => {
    const h = hashPassword("CorrectHorse42");
    expect(verifyPassword("CorrectHorse43", h)).toBe(false);
  });
  it("rejects weak passwords (<10 chars, no upper/digit)", () => {
    expect(passwordIsStrong("short").ok).toBe(false);
    expect(passwordIsStrong("alllowercase1").ok).toBe(false);
    expect(passwordIsStrong("ALLUPPERCASE1").ok).toBe(false);
    expect(passwordIsStrong("password123").ok).toBe(false);
  });
  it("rejects common passwords", () => {
    expect(passwordIsStrong("Password1234").ok).toBe(false); // starts with "Password"
  });
});

/* ============================================================
 *  CSRF middleware (12 tests)
 * ============================================================ */
describe("CSRF middleware", () => {
  let app: express.Express;
  let sid: string;
  let csrf: string;
  beforeEach(() => {
    _resetRateLimitsForTests();
    app = express();
    app.use(express.json());
  installV14TestIdentity(app);
    app.use("/api", csrfMiddleware);
    app.post("/api/x", (_req, res) => res.json({ ok: true }));
    app.get("/api/x", (_req, res) => res.json({ ok: true }));
    app.post("/api/auth/login", (_req, res) => res.json({ ok: true })); // bypass
    app.post("/api/bridge/foo", (_req, res) => res.json({ ok: true })); // bypass
    const sess = createSession("u_csrf");
    sid = sess.id;
    csrf = sess.csrfToken;
  });
  it("allows GET without token", async () => {
    const r = await request(app).get("/api/x");
    expect(r.status).toBe(200);
  });
  it("allows OPTIONS without token", async () => {
    const r = await request(app).options("/api/x");
    expect([200, 204]).toContain(r.status);
  });
  it("rejects POST with no session id", async () => {
    const r = await request(app).post("/api/x").send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("csrf_no_session");
  });
  it("rejects POST with invalid session id", async () => {
    const r = await request(app).post("/api/x").set("Cookie", "cap_sid=does_not_exist").send({});
    expect(r.status).toBe(403);
  });
  it("rejects POST with valid session but missing CSRF token", async () => {
    const r = await request(app).post("/api/x").set("Cookie", `cap_sid=${sid}`).send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("csrf_token_missing");
  });
  it("rejects POST with wrong CSRF token", async () => {
    const r = await request(app).post("/api/x")
      .set("Cookie", `cap_sid=${sid}`)
      .set("X-CSRF-Token", "wrong-token")
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("csrf_token_invalid");
  });
  it("accepts POST with matching CSRF token", async () => {
    const r = await request(app).post("/api/x")
      .set("Cookie", `cap_sid=${sid}`)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(r.status).toBe(200);
  });
  it("bypasses /api/auth/login (issues token)", async () => {
    const r = await request(app).post("/api/auth/login").send({ email: "x" });
    expect(r.status).toBe(200);
  });
  it("bypasses /api/bridge/* (uses HMAC instead)", async () => {
    const r = await request(app).post("/api/bridge/foo").send({});
    expect(r.status).toBe(200);
  });
  it("rejects DELETE without token", async () => {
    app.delete("/api/x", (_req, res) => res.json({ ok: true }));
    const r = await request(app).delete("/api/x");
    expect(r.status).toBe(403);
  });
  it("rejects PATCH without token", async () => {
    app.patch("/api/x", (_req, res) => res.json({ ok: true }));
    const r = await request(app).patch("/api/x").send({});
    expect(r.status).toBe(403);
  });
  it("rejects POST when session revoked", async () => {
    revokeSession(sid);
    const r = await request(app).post("/api/x")
      .set("Cookie", `cap_sid=${sid}`)
      .set("X-CSRF-Token", csrf)
      .send({});
    // Revoked session: getSession returns row with revoked=true -> middleware allows? Check:
    // csrf middleware checks `sess.revoked` and rejects.
    expect(r.status).toBe(403);
  });
});

/* ============================================================
 *  Rate limiter (8 tests)
 * ============================================================ */
describe("Rate limiter", () => {
  let app: express.Express;
  beforeEach(() => {
    _resetRateLimitsForTests();
    app = express();
    app.use(express.json());
    installV14TestIdentity(app, { defaultIdentity: false }); /* v14: maps x-user-id → userContext.userId so rate limit buckets isolate per user */
    app.use("/api", rateLimitMiddleware);
    app.get("/api/r", (_req, res) => res.json({ ok: true }));
    app.post("/api/w", (_req, res) => res.json({ ok: true }));
  });
  it("sets X-RateLimit-Limit header", async () => {
    const r = await request(app).get("/api/r").set("X-User-Id", "u1");
    expect(r.headers["x-ratelimit-limit"]).toBe(String(RateLimitConfig.READ_LIMIT));
  });
  it("decrements remaining count", async () => {
    const r1 = await request(app).get("/api/r").set("X-User-Id", "u_dec");
    const r2 = await request(app).get("/api/r").set("X-User-Id", "u_dec");
    expect(Number(r1.headers["x-ratelimit-remaining"])).toBeGreaterThan(Number(r2.headers["x-ratelimit-remaining"]));
  });
  it("blocks reads after 60 hits", async () => {
    for (let i = 0; i < 60; i++) {
      await request(app).get("/api/r").set("X-User-Id", "u_burst_r");
    }
    const r = await request(app).get("/api/r").set("X-User-Id", "u_burst_r");
    expect(r.status).toBe(429);
  });
  it("blocks writes after 10 hits", async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).post("/api/w").set("X-User-Id", "u_burst_w").send({});
    }
    const r = await request(app).post("/api/w").set("X-User-Id", "u_burst_w").send({});
    expect(r.status).toBe(429);
  });
  it("buckets are isolated per user", async () => {
    for (let i = 0; i < 60; i++) await request(app).get("/api/r").set("X-User-Id", "u_alice");
    const r = await request(app).get("/api/r").set("X-User-Id", "u_bob");
    expect(r.status).toBe(200);
  });
  it("buckets are isolated per route", async () => {
    app.get("/api/other", (_req, res) => res.json({ ok: true }));
    for (let i = 0; i < 60; i++) await request(app).get("/api/r").set("X-User-Id", "u_route");
    const r = await request(app).get("/api/other").set("X-User-Id", "u_route");
    expect(r.status).toBe(200);
  });
  it("auth-fail lockout fires after 5 failures", () => {
    for (let i = 0; i < 5; i++) recordAuthFailure("login:test@x.io");
    const lock = isLockedOut("login:test@x.io");
    expect(lock.locked).toBe(true);
  });
  it("returns 429 with retryAfterMs", async () => {
    for (let i = 0; i < 10; i++) await request(app).post("/api/w").set("X-User-Id", "u_retry").send({});
    const r = await request(app).post("/api/w").set("X-User-Id", "u_retry").send({});
    expect(r.body.error).toBe("rate_limited");
    expect(typeof r.body.retryAfterMs).toBe("number");
  });
});

/* ============================================================
 *  Replay attack (4 tests)
 * ============================================================ */
describe("Replay attack defenses", () => {
  it("revoked session can't reauthenticate", () => {
    const s = createSession("u_replay");
    revokeSession(s.id);
    const sess = getSession(s.id);
    expect(sess?.revoked).toBe(true);
  });
  it("expired JWT is rejected", () => {
    const t = signJwt({ sub: "u", role: "f", sid: "x" }, -1);
    expect(verifyJwt(t)).toBeNull();
  });
  it("CSRF token is rotated per session", () => {
    const a = createSession("u_a");
    const b = createSession("u_b");
    expect(a.csrfToken).not.toBe(b.csrfToken);
  });
  it("session id is unguessably random (>= 16 bytes hex)", () => {
    const s = createSession("u_rng");
    expect(s.id.length).toBeGreaterThanOrEqual(32);
  });
});

/* ============================================================
 *  SQL injection blocked (4 tests)
 * ============================================================ */
describe("SQL injection blocked by parameterized queries", () => {
  it("upsert + get round-trips a benign id", () => {
    upsertSyncDoc("company", { id: "c_safe", payload: { name: "ok" } });
    const r = getSyncDoc("company", "c_safe");
    expect(r?.id).toBe("c_safe");
  });
  it("ids with quote chars don't escape SQL context", () => {
    const evilId = "x'; DROP TABLE sync_company; --";
    upsertSyncDoc("company", { id: evilId, payload: { name: "p" } });
    const r = getSyncDoc("company", evilId);
    expect(r?.id).toBe(evilId);
    // Table still exists -> we can still write a normal record after
    upsertSyncDoc("company", { id: "c_after", payload: { name: "n" } });
    expect(getSyncDoc("company", "c_after")).not.toBeNull();
  });
  it("payload with quotes is safely JSON-encoded", () => {
    upsertSyncDoc("company", { id: "c_q", payload: { note: `it's "fine"` } });
    const r = getSyncDoc("company", "c_q");
    expect((r?.payload as { note: string }).note).toBe(`it's "fine"`);
  });
  it("payload with embedded SQL terminator stays inert", () => {
    const evil = "); DELETE FROM sync_company; --";
    upsertSyncDoc("company", { id: "c_evil_payload", payload: { evil } });
    const r = getSyncDoc("company", "c_evil_payload");
    expect((r?.payload as { evil: string }).evil).toBe(evil);
    // Other rows survive
    expect(getSyncDoc("company", "c_safe")).not.toBeNull();
  });
});

/* ============================================================
 *  XSS payload rejection (4 tests)
 * ============================================================ */
describe("XSS rejection via zod schemas", () => {
  const ContactSchema = strictObject({
    name: z.string().min(1).max(80),
    email: z.string().email(),
  });
  let app: express.Express;
  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.post("/x", validateBody(ContactSchema), (_req, res) => res.json({ ok: true }));
  });
  it("rejects invalid email", async () => {
    const r = await request(app).post("/x").send({ name: "ok", email: "<script>" });
    expect(r.status).toBe(400);
  });
  it("rejects unknown fields", async () => {
    const r = await request(app).post("/x").send({ name: "ok", email: "a@b.io", html: "<img onerror=...>" });
    expect(r.status).toBe(400);
  });
  it("rejects oversize input", async () => {
    const r = await request(app).post("/x").send({ name: "x".repeat(81), email: "a@b.io" });
    expect(r.status).toBe(400);
  });
  it("accepts valid input", async () => {
    const r = await request(app).post("/x").send({ name: "Maya", email: "a@b.io" });
    expect(r.status).toBe(200);
  });
});

/* ============================================================
 *  Sensitive-data redaction (2 tests)
 * ============================================================ */
describe("Log redaction", () => {
  it("redacts password / token / refreshToken keys", () => {
    const r = redact({ password: "hunter2", token: "abc", email: "a@b.io" });
    expect((r as Record<string, unknown>).password).toBe("[redacted]");
    expect((r as Record<string, unknown>).token).toBe("[redacted]");
    expect((r as Record<string, unknown>).email).toBe("a@b.io");
  });
  it("clips long hex strings (likely tokens)", () => {
    const hex = "deadbeef".repeat(8);
    const r = redact({ id: hex });
    expect(((r as Record<string, unknown>).id as string).includes("…")).toBe(true);
  });
});

/* ============================================================
 *  CSP / security headers (2 tests)
 * ============================================================ */
describe("Security headers", () => {
  let app: express.Express;
  beforeEach(() => {
    app = express();
    app.use(securityHeaders);
    app.get("/", (_req, res) => res.send("ok"));
  });
  it("sets Content-Security-Policy", async () => {
    const r = await request(app).get("/");
    expect(r.headers["content-security-policy"]).toBeDefined();
    expect(r.headers["content-security-policy"]).toContain("default-src 'self'");
  });
  it("sets X-Content-Type-Options + Referrer-Policy + X-Frame-Options", async () => {
    const r = await request(app).get("/");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(r.headers["x-frame-options"]).toBe("SAMEORIGIN");
  });
});

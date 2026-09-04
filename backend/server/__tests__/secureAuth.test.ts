/**
 * Sprint 17 D6 — secure auth route tests.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerSecureAuthRoutes } from "../lib/secureAuthRoutes";
import { csrfMiddleware } from "../lib/csrf";
import { getDb } from "../db/connection";

let app: express.Express;
beforeAll(() => {
  getDb();
  app = express();
  app.use(express.json());
  app.use("/api/auth/secure", csrfMiddleware);
  registerSecureAuthRoutes(app);
});

const E = (s: string) => `${s}-${Math.random().toString(36).slice(2,7)}@example.com`;

describe("Secure auth — /api/auth/secure/*", () => {
  it("signup → 201 + cookies + csrf token", async () => {
    const r = await request(app).post("/api/auth/secure/signup").send({
      email: E("alice"), password: "StrongP@ssw0rd",
    });
    expect(r.status).toBe(201);
    expect(r.body.csrfToken).toBeDefined();
    expect((r.headers["set-cookie"] as unknown as string[]).join(",")).toMatch(/cap_jwt=/);
  });

  it("rejects weak password on signup", async () => {
    const r = await request(app).post("/api/auth/secure/signup").send({
      email: E("weak"), password: "short",
    });
    expect(r.status).toBe(400);
  });

  it("rejects unknown body fields (strict zod)", async () => {
    const r = await request(app).post("/api/auth/secure/signup").send({
      email: E("strict"), password: "StrongP@ssw0rd", admin: true,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_failed");
  });

  it("login with correct credentials succeeds", async () => {
    const email = E("login");
    const pw = "StrongP@ssw0rd";
    await request(app).post("/api/auth/secure/signup").send({ email, password: pw });
    const r = await request(app).post("/api/auth/secure/login").send({ email, password: pw });
    expect(r.status).toBe(200);
    expect(r.body.csrfToken).toBeDefined();
  });

  it("login with bad password 401s", async () => {
    const email = E("bad");
    await request(app).post("/api/auth/secure/signup").send({ email, password: "StrongP@ssw0rd" });
    const r = await request(app).post("/api/auth/secure/login").send({ email, password: "WrongP@ssw0rd1" });
    expect(r.status).toBe(401);
  });

  it("/me without token → 401", async () => {
    const r = await request(app).get("/api/auth/secure/me");
    expect(r.status).toBe(401);
  });

  it("/me with token → JSON user", async () => {
    const email = E("me");
    const sign = await request(app).post("/api/auth/secure/signup").send({ email, password: "StrongP@ssw0rd" });
    const cookies = (sign.headers["set-cookie"] as unknown as string[]).join("; ");
    const r = await request(app).get("/api/auth/secure/me").set("Cookie", cookies);
    expect(r.status).toBe(200);
    expect(r.body.email).toBe(email);
    expect(typeof r.body.exp).toBe("number");
  });

  // Helper: signup, return cookies + csrf for follow-up authenticated requests
  async function withSession() {
    const email = E("sess");
    const sign = await request(app).post("/api/auth/secure/signup").send({ email, password: "StrongP@ssw0rd" });
    const cookies = (sign.headers["set-cookie"] as unknown as string[]).join("; ");
    return { cookies, csrf: sign.body.csrfToken as string, email };
  }

  it("logout clears session (CSRF-enforced)", async () => {
    const { cookies, csrf } = await withSession();
    const r = await request(app).post("/api/auth/secure/logout")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", csrf);
    expect(r.status).toBe(204);
  });

  it("logout without CSRF token is rejected", async () => {
    const { cookies } = await withSession();
    const r = await request(app).post("/api/auth/secure/logout").set("Cookie", cookies);
    expect(r.status).toBe(403);
  });

  it("2fa setup returns secret + otpauth", async () => {
    const { cookies, csrf } = await withSession();
    const r = await request(app).post("/api/auth/secure/2fa/setup")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.secret).toMatch(/^[A-Z0-9]{20}$/);
    expect(r.body.otpauth).toMatch(/^otpauth:\/\/totp\//);
  });

  it("2fa verify accepts well-formed code (scaffold)", async () => {
    const { cookies, csrf } = await withSession();
    const r = await request(app).post("/api/auth/secure/2fa/verify")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", csrf)
      .send({ code: "123456" });
    expect(r.status).toBe(200);
    expect(r.body.scaffolded).toBe(true);
  });

  it("2fa verify rejects malformed code", async () => {
    const { cookies, csrf } = await withSession();
    const r = await request(app).post("/api/auth/secure/2fa/verify")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", csrf)
      .send({ code: "abc" });
    expect(r.status).toBe(400);
  });
});

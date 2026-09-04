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

  /* WAVE 305 · R251 — THESE THREE TESTS WERE UPDATED, NOT WEAKENED.
   *
   * They previously asserted the scaffold's behaviour, and one of them asserted
   * the defect itself in its own name: "2fa verify accepts well-formed code
   * (scaffold)". That endpoint accepted ANY six digits and never read the stored
   * secret. A test that requires a security hole to stay open has to be corrected
   * when the hole is closed; leaving it green would have meant leaving the hole.
   *
   * The routes are NOT deleted (R195.5). They are retired in place and now refuse
   * honestly with 501, naming the endpoint that replaces them. That is what these
   * tests now assert. The real implementation is proved in
   * server/__tests__/w305_mfa_http_and_lockout.test.ts and
   * server/__tests__/w305_mfa_totp_and_schema.test.ts.
   *
   * The ORIGINAL assertions are preserved verbatim in comments beside each
   * replacement so the change is auditable rather than merely described:
   *   setup : expect(r.status).toBe(200); expect(r.body.secret).toMatch(/^[A-Z0-9]{20}$/);
   *           expect(r.body.otpauth).toMatch(/^otpauth:\/\/totp\//);
   *   verify: expect(r.status).toBe(200); expect(r.body.scaffolded).toBe(true);
   *   bad   : expect(r.status).toBe(400);
   */

  it("2fa setup is RETIRED IN PLACE — still mounted, refuses honestly, names its replacement", async () => {
    const { cookies, csrf } = await withSession();
    const r = await request(app).post("/api/auth/secure/2fa/setup")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", csrf)
      .send({});
    /* Still mounted: a removed route would 404 here, and R195.5 forbids removal. */
    expect(r.status, `expected the retired 501, got ${r.status}: ${JSON.stringify(r.body)}`).toBe(501);
    expect(r.status).not.toBe(404);
    expect(r.body.error).toBe("SCAFFOLD_RETIRED");
    expect(r.body.retiredBy).toBe("wave305");
    /* It must NAME its replacement, not merely refuse. */
    expect(String(r.body.replacement ?? "")).toContain("/api/auth/mfa/enrol/begin");
    /* AND IT MUST NOT HAND OUT A SECRET ANY MORE — the actual defect. */
    expect(r.body.secret).toBeUndefined();
    expect(r.body.otpauth).toBeUndefined();
  });

  it("2fa verify NO LONGER ACCEPTS ANY SIX DIGITS — the defect is closed", async () => {
    const { cookies, csrf } = await withSession();
    const r = await request(app).post("/api/auth/secure/2fa/verify")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", csrf)
      .send({ code: "123456" });
    expect(r.status, `expected the retired 501, got ${r.status}: ${JSON.stringify(r.body)}`).toBe(501);
    expect(r.status).not.toBe(200);
    expect(r.body.error).toBe("SCAFFOLD_RETIRED");
    expect(r.body.scaffolded).toBeUndefined();
    expect(r.body.ok).not.toBe(true);
    expect(String(r.body.replacement ?? "")).toContain("/api/auth/login/mfa");
  });

  it("2fa verify refuses a malformed code too — it refuses EVERY caller, not just some", async () => {
    const { cookies, csrf } = await withSession();
    const r = await request(app).post("/api/auth/secure/2fa/verify")
      .set("Cookie", cookies)
      .set("X-CSRF-Token", csrf)
      .send({ code: "abc" });
    /* The retirement is unconditional: the same refusal regardless of input, so
     * no shape of code can find a way through. */
    expect(r.status).toBe(501);
    expect(r.body.error).toBe("SCAFFOLD_RETIRED");
  });
});

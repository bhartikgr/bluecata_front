/**
 * v23.4.7 Phase 13 / BUG 030 — company-logo upload endpoint.
 *
 * Replaces the prior base64-in-form-state behavior with a dedicated server
 * endpoint that accepts a small image via multipart/form-data and returns a
 * stable URL the client form can store as a plain string.
 *
 * ── TOUCHED BY WAVE 57d · D1 — PRECONDITION ADDED, NOTHING LOOSENED ─────────
 * WHAT CHANGED: each POST below now carries `x-user-id: u_admin`.
 * WHY: this file mounts `registerCompanyLogoRoutes(app)` on a BARE express app
 * with no auth middleware, and its three upload cases previously passed with NO
 * IDENTITY AT ALL against arbitrary company ids (`co_test_1..4`). That was not a
 * test of the upload contract — it was an assertion that the cross-tenant
 * overwrite hole was open (independent Review 1 of Wave 57c; closed in 57d D1).
 * `POST /api/founder/company/:id/logo` now asserts company ownership before it
 * replaces any bytes, and the platform-admin bypass is the intentional path for
 * an arbitrary id, so `u_admin` is the correct identity for these fixtures.
 *
 * NOTHING WAS WEAKENED: every original assertion is unchanged (200 + stable URL
 * + store entry; 400 on missing file; 400 on bad mime; 200 inline bytes on GET;
 * 404 when unset). Two assertions were ADDED at the bottom proving the refusals,
 * so this file now pins the closed hole instead of the open one.
 * Reverting is mechanical: delete the five `.set("x-user-id", ADMIN)` calls and
 * the final describe block; the file then goes red, which is the point.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerCompanyLogoRoutes, _logoStoreForTest } from "../lib/companyLogoRoutes";

/** Platform admin — the intentional bypass for an arbitrary company id
 *  (server/lib/requireIdentity.ts:142-146). See the header note. */
const ADMIN = "u_admin";

let app: Express;
beforeAll(() => {
  app = express();
  app.use(express.json());
  registerCompanyLogoRoutes(app);
});

// 1x1 transparent PNG (the smallest valid PNG we can generate inline).
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

describe("v23.4.7 Phase 13 / BUG 030 — POST /api/founder/company/:id/logo", () => {
  it("accepts a PNG upload and returns the stable URL", async () => {
    const r = await request(app)
      .post("/api/founder/company/co_test_1/logo")
      .set("x-user-id", ADMIN)
      .attach("logo", PNG_1x1, { filename: "logo.png", contentType: "image/png" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, url: "/api/founder/company/co_test_1/logo" });
    expect(_logoStoreForTest.has("co_test_1")).toBe(true);
  });

  it("rejects a missing file with 400", async () => {
    const r = await request(app).post("/api/founder/company/co_test_2/logo").set("x-user-id", ADMIN);
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
  });

  it("rejects unsupported mime types", async () => {
    const r = await request(app)
      .post("/api/founder/company/co_test_3/logo")
      .set("x-user-id", ADMIN)
      .attach("logo", Buffer.from("hello"), { filename: "x.txt", contentType: "text/plain" });
    // Multer fileFilter rejects with 400 + error in JSON body.
    expect(r.status).toBe(400);
  });

  it("GET /api/founder/company/:id/logo returns the bytes inline", async () => {
    // Re-upload to ensure the entry exists.
    await request(app)
      .post("/api/founder/company/co_test_4/logo")
      .set("x-user-id", ADMIN)
      .attach("logo", PNG_1x1, { filename: "logo.png", contentType: "image/png" });
    const r = await request(app).get("/api/founder/company/co_test_4/logo");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/image\/png/);
    expect(r.headers["content-disposition"] ?? "").toMatch(/^inline;/);
  });

  it("GET returns 404 when no logo is set", async () => {
    const r = await request(app).get("/api/founder/company/co_never_uploaded/logo");
    expect(r.status).toBe(404);
  });
});

/* ── ADDED BY WAVE 57d · D1 ─────────────────────────────────────────────────
   The upload is no longer available to a principal who does not own the company.
   These two cases are what the three cases above USED to assert the opposite of. */
describe("WAVE 57d D1 — the upload refuses a principal that does not own the company", () => {
  it("a non-owning principal cannot upload for an arbitrary company id", async () => {
    const r = await request(app)
      .post("/api/founder/company/co_test_stranger/logo")
      .attach("logo", PNG_1x1, { filename: "logo.png", contentType: "image/png" });
    expect(r.status).not.toBe(200);
    expect([401, 403]).toContain(r.status);
    expect(_logoStoreForTest.has("co_test_stranger")).toBe(false);
  });

  it("a refused upload does not replace bytes that already exist", async () => {
    // co_test_1 was uploaded by the admin above; a stranger must not overwrite it.
    const before = _logoStoreForTest.get("co_test_1");
    expect(before).toBeTruthy();
    const r = await request(app)
      .post("/api/founder/company/co_test_1/logo")
      .attach("logo", Buffer.from(PNG_1x1), { filename: "other.png", contentType: "image/png" });
    expect([401, 403]).toContain(r.status);
    expect(_logoStoreForTest.get("co_test_1")).toBe(before);
  });
});

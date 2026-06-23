/**
 * v23.4.7 Phase 13 / BUG 030 — company-logo upload endpoint.
 *
 * Replaces the prior base64-in-form-state behavior with a dedicated server
 * endpoint that accepts a small image via multipart/form-data and returns a
 * stable URL the client form can store as a plain string.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerCompanyLogoRoutes, _logoStoreForTest } from "../lib/companyLogoRoutes";

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
      .attach("logo", PNG_1x1, { filename: "logo.png", contentType: "image/png" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, url: "/api/founder/company/co_test_1/logo" });
    expect(_logoStoreForTest.has("co_test_1")).toBe(true);
  });

  it("rejects a missing file with 400", async () => {
    const r = await request(app).post("/api/founder/company/co_test_2/logo");
    expect(r.status).toBe(400);
    expect(r.body.ok).toBe(false);
  });

  it("rejects unsupported mime types", async () => {
    const r = await request(app)
      .post("/api/founder/company/co_test_3/logo")
      .attach("logo", Buffer.from("hello"), { filename: "x.txt", contentType: "text/plain" });
    // Multer fileFilter rejects with 400 + error in JSON body.
    expect(r.status).toBe(400);
  });

  it("GET /api/founder/company/:id/logo returns the bytes inline", async () => {
    // Re-upload to ensure the entry exists.
    await request(app)
      .post("/api/founder/company/co_test_4/logo")
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

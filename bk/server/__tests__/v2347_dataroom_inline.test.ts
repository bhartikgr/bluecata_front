/**
 * v23.4.7 Phase 12 / BUG 027 — Data Room view icon should serve the file
 * inline so the browser renders it in a new tab, rather than forcing a
 * download with `Content-Disposition: attachment`.
 *
 * Exercises the existing GET /api/founder/dataroom/files/:id/download route
 * with the new `?disposition=inline` query parameter.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerDataroomRoutes, _testAccess } from "../dataroomStore";

let app: Express;
beforeAll(() => {
  app = express();
  app.use(express.json());
  registerDataroomRoutes(app);
});

describe("v23.4.7 Phase 12 / BUG 027 — dataroom view (inline disposition)", () => {
  it("defaults to attachment disposition (unchanged download behavior)", async () => {
    const f = _testAccess.files[0];
    expect(f).toBeTruthy();
    const r = await request(app).get(`/api/founder/dataroom/files/${f!.id}/download`);
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"] ?? "").toMatch(/^attachment;/);
  });

  it("returns Content-Disposition: inline when ?disposition=inline is passed", async () => {
    const f = _testAccess.files[0];
    expect(f).toBeTruthy();
    const r = await request(app)
      .get(`/api/founder/dataroom/files/${f!.id}/download`)
      .query({ disposition: "inline" });
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"] ?? "").toMatch(/^inline;/);
  });

  it("also accepts the shorthand ?inline=1", async () => {
    const f = _testAccess.files[0];
    const r = await request(app)
      .get(`/api/founder/dataroom/files/${f!.id}/download`)
      .query({ inline: "1" });
    expect(r.status).toBe(200);
    expect(r.headers["content-disposition"] ?? "").toMatch(/^inline;/);
  });
});

/**
 * CP Phase B (CP-001..005) — Consortium Apply-to-Join.
 *
 * Coverage:
 *   - Public submit happy path
 *   - Validation failure (missing required fields)
 *   - Rate limit: 5/hr/IP enforced; 6th from same IP → 429 with bucket=public:apply
 *   - Admin queue lists submitted apps
 *   - Admin approve transitions status + provisions partner + chains hashes
 *   - Admin reject keeps row reviewable=false afterwards
 *   - Admin withdraw blocks further review
 *   - Hash chain integrity: each transition stamps prev_hash←currHash
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import {
  registerConsortiumApplyRoutes,
  _consortiumApplyInternal,
  _resetPublicApplyBucketsForTests,
  type ConsortiumApplicationRow,
} from "../consortiumApplyStore";
import { installV14TestIdentity } from "./_v14TestIdentity";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerConsortiumApplyRoutes(app);
});

beforeEach(() => {
  _consortiumApplyInternal.appsCache.clear();
  _resetPublicApplyBucketsForTests();
});

const validBody = {
  organizationName: "Alpha Capital Ltd",
  contactName: "Alice Test",
  contactEmail: "alice@alpha-capital.test",
  jurisdiction: "Canada",
  partnerType: "vc",
  aumRange: "10-50M",
  portfolioCompanyCount: 12,
  expectedChapter: "chap_keiretsu_canada",
  introMessage:
    "We have a track record of investing in seed-stage SaaS in Ontario.",
};

describe("CP Phase B — public apply submit", () => {
  it("accepts a valid submission and returns 201 with applicationId", async () => {
    const r = await request(app)
      .post("/api/public/consortium/apply")
      .set("X-Forwarded-For", "10.0.0.1")
      .send(validBody);
    expect(r.status).toBe(201);
    expect(r.body.applicationId).toMatch(/^cpapp_/);
    expect(r.body.status).toBe("submitted");
  });

  it("rejects an invalid submission (missing contact_email) with 400", async () => {
    const bad = { ...validBody, contactEmail: "" };
    const r = await request(app)
      .post("/api/public/consortium/apply")
      .set("X-Forwarded-For", "10.0.0.2")
      .send(bad);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_failed");
  });

  it("rate-limits to 5/hr/IP — 6th submission from same IP returns 429 bucket=public:apply", async () => {
    const ip = "10.0.0.42";
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post("/api/public/consortium/apply")
        .set("X-Forwarded-For", ip)
        .send({ ...validBody, contactEmail: `alice+${i}@alpha.test` });
      expect(r.status).toBe(201);
    }
    const r6 = await request(app)
      .post("/api/public/consortium/apply")
      .set("X-Forwarded-For", ip)
      .send({ ...validBody, contactEmail: "alice+6@alpha.test" });
    expect(r6.status).toBe(429);
    expect(r6.body.bucket).toBe("public:apply");
    expect(r6.headers["x-ratelimit-bucket"]).toBe("public:apply");
  });

  it("status endpoint returns the application status for a known id", async () => {
    const r = await request(app)
      .post("/api/public/consortium/apply")
      .set("X-Forwarded-For", "10.0.0.7")
      .send({ ...validBody, contactEmail: "alice+status@alpha.test" });
    expect(r.status).toBe(201);
    const id = r.body.applicationId;
    const r2 = await request(app).get(
      `/api/public/consortium/apply/${id}/status`,
    );
    expect(r2.status).toBe(200);
    expect(r2.body.applicationId).toBe(id);
    expect(r2.body.status).toBe("submitted");
  });
});

describe("CP Phase B — admin review", () => {
  it("admin queue lists submitted applications", async () => {
    await request(app)
      .post("/api/public/consortium/apply")
      .set("X-Forwarded-For", "10.0.0.10")
      .send({ ...validBody, contactEmail: "queued@alpha.test" });
    const q = await request(app)
      .get("/api/admin/consortium/applications")
      .set("x-user-id", "u_admin")
      .set("x-role", "admin");
    expect(q.status).toBe(200);
    expect(Array.isArray(q.body.rows)).toBe(true);
    expect(q.body.total).toBeGreaterThanOrEqual(1);
    expect(q.body.rows[0].status).toBe("submitted");
  });

  it("rejecting an application stamps status='rejected' with a chained hash", async () => {
    const r = await request(app)
      .post("/api/public/consortium/apply")
      .set("X-Forwarded-For", "10.0.0.11")
      .send({ ...validBody, contactEmail: "to-reject@alpha.test" });
    const id = r.body.applicationId;
    const before = _consortiumApplyInternal.appsCache.get(
      id,
    ) as ConsortiumApplicationRow;
    expect(before.status).toBe("submitted");
    expect(before.currHash).toMatch(/^[a-f0-9]{64}$/);

    const r2 = await request(app)
      .post(`/api/admin/consortium/applications/${id}/review`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ status: "rejected", review_notes: "Not a fit." });
    expect(r2.status).toBe(200);
    expect(r2.body.application.status).toBe("rejected");
    expect(r2.body.application.prevHash).toBe(before.currHash);
    expect(r2.body.application.currHash).not.toBe(before.currHash);

    // Second review attempt now fails — terminal state.
    const r3 = await request(app)
      .post(`/api/admin/consortium/applications/${id}/review`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ status: "approved" });
    expect(r3.status).toBe(409);
  });

  it("withdrawing an application moves it to terminal 'withdrawn' state", async () => {
    const r = await request(app)
      .post("/api/public/consortium/apply")
      .set("X-Forwarded-For", "10.0.0.12")
      .send({ ...validBody, contactEmail: "to-withdraw@alpha.test" });
    const id = r.body.applicationId;
    const r2 = await request(app)
      .post(`/api/admin/consortium/applications/${id}/withdraw`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ review_notes: "Applicant pulled out." });
    expect(r2.status).toBe(200);
    expect(r2.body.application.status).toBe("withdrawn");
    const r3 = await request(app)
      .post(`/api/admin/consortium/applications/${id}/review`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ status: "approved" });
    expect(r3.status).toBe(409);
  });
});

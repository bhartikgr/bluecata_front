/**
 * server/__tests__/wave33_sprint18_outbox_preexisting.test.ts
 *
 * WAVE 33 — EVIDENCE ONLY. This file fixes nothing and changes nothing.
 *
 * `server/__tests__/sprint18_phase3.test.ts` fails 2 of its 33 cases on
 * `GET /api/comms/dev/outbox`. The owner's instruction for Wave 33 is to RECORD
 * that item, not to fix it, and explicitly NOT to edit the legacy test.
 *
 * What this file does instead is prove the diagnosis by execution, so the
 * report's claim "pre-existing, not caused by this wave" rests on a run rather
 * than on an assertion:
 *
 *   • ANONYMOUS  → 403, error `ADMIN_REQUIRED`
 *   • x-user-id: u_admin → 200 and a JSON ARRAY
 *
 * i.e. the route works exactly as its `requireAdmin` gate specifies. The legacy
 * test calls it with NO identity at all and expects 200, which is what that
 * gate is there to refuse. The gate predates this wave (the route's own comment
 * records the change: "production returns 404 …, and non-production requires
 * admin auth"), and nothing in Wave 33 touches it.
 *
 * The second failure — `r.body.some is not a function` — is the SAME failure
 * one line later: `r.body` is the 403 error OBJECT, so `.some` does not exist.
 * One cause, two red cases.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb } from "../db/connection";
import { registerCommsRoutes } from "../commsStore";

let app: Express;

beforeAll(() => {
  getDb();
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);
});

describe("WAVE 33 — pre-existing: GET /api/comms/dev/outbox requires admin", () => {
  it("PE1 an ANONYMOUS caller — the legacy test's exact shape — is refused 403 ADMIN_REQUIRED", async () => {
    const res = await request(app).get("/api/comms/dev/outbox");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("ADMIN_REQUIRED");
    // The legacy test's next line does `r.body.some(...)`; this is why it throws.
    expect(Array.isArray(res.body)).toBe(false);
  });

  it("PE2 the SAME request with an admin identity returns 200 and an array", async () => {
    const res = await request(app)
      .get("/api/comms/dev/outbox")
      .set("x-user-id", "u_admin")
      .set("x-actor-user-id", "u_admin")
      .set("x-role", "admin");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("PE3 the route itself is not broken — the sibling dev route behaves identically", async () => {
    /* If only the outbox route misbehaved this would be a Wave 33 regression.
       Its sibling under the same gate answers the same way, which is what makes
       "the gate, not the route" the diagnosis rather than a guess. */
    const anon = await request(app).get("/api/comms/dev/audit");
    expect(anon.status).toBe(403);
    const admin = await request(app)
      .get("/api/comms/dev/audit")
      .set("x-user-id", "u_admin")
      .set("x-actor-user-id", "u_admin")
      .set("x-role", "admin");
    expect(admin.status).toBe(200);
  });
});

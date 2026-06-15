/**
 * Wave F4 FIX F4-2 (E2E-4, P0) regression suite.
 *
 * Proves the end-to-end "save displayName → reload → still there" contract.
 *
 * Before this fix: PATCH /api/auth/me wrote `display_name` to the SQL
 * `users` table correctly, but GET /api/auth/me's response spread the
 * persona-registry `ctx` LAST, so the stale `identity.name` value
 * clobbered the freshly-saved value. The client read
 * `m.identity?.name ?? m.name` and saw the OLD value on reload \u2014 the
 * E2E "founder.profile-persists" test caught this.
 *
 * After this fix: GET /api/auth/me re-reads from the `users` SQL table
 * and overlays the canonical fields LAST, so reload always returns the
 * most-recently-persisted name / email / title / displayName, no matter
 * what the in-process persona registry happens to hold.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerFounderUser } from "../lib/userContext";

let FOUNDER_USER_ID = "";
let app: Express;

beforeAll(async () => {
  const reg = registerFounderUser({
    email: `f42_reload_${Date.now()}@test.example`,
    name: "Reload Original Name",
    password: "waveF4Pass1234",
  });
  FOUNDER_USER_ID = reg.userId;

  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
}, 30_000);

describe("Wave F4 FIX F4-2 (E2E-4): displayName / name / title survive reload", () => {
  it("displayName written via PATCH is visible in the next GET", async () => {
    const patched = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ displayName: "F4-2 Displayed Value" });
    expect(patched.status).toBe(200);

    const after = await request(app)
      .get("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID);
    expect(after.status).toBe(200);
    expect(after.body.isAuthed).toBe(true);
    // Both top-level and identity.* must reflect the new value \u2014 client reads either.
    expect(after.body.displayName, "top-level displayName must reflect PATCH").toBe("F4-2 Displayed Value");
    expect(after.body.identity?.displayName, "identity.displayName must reflect PATCH").toBe("F4-2 Displayed Value");
  });

  it("name written via PATCH overrides the persona-registry stale value on GET", async () => {
    const patched = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ name: "Maya Lin Updated" });
    expect(patched.status).toBe(200);

    const after = await request(app)
      .get("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID);
    expect(after.status).toBe(200);
    // The Settings client reads `m.identity?.name ?? m.name` \u2014 BOTH must win.
    expect(after.body.name).toBe("Maya Lin Updated");
    expect(after.body.identity?.name).toBe("Maya Lin Updated");
  });

  it("title written via PATCH is visible in the next GET", async () => {
    const patched = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ title: "Co-Founder & CEO" });
    expect(patched.status).toBe(200);

    const after = await request(app)
      .get("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID);
    expect(after.status).toBe(200);
    expect(after.body.title).toBe("Co-Founder & CEO");
    expect(after.body.identity?.title).toBe("Co-Founder & CEO");
  });

  it("simulated reload (sequence of independent GETs) preserves all profile fields", async () => {
    // Stage 1: write a complete profile snapshot.
    const stamp = `f42-${Date.now().toString(36).slice(-5)}`;
    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({
        name: `Maya Reload ${stamp}`,
        displayName: `Maya Display ${stamp}`,
        title: `Title ${stamp}`,
      });

    // Stage 2: simulate three independent reloads (each GET is a fresh request).
    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .get("/api/auth/me")
        .set("x-user-id", FOUNDER_USER_ID);
      expect(r.status).toBe(200);
      expect(r.body.identity?.name).toBe(`Maya Reload ${stamp}`);
      expect(r.body.identity?.displayName).toBe(`Maya Display ${stamp}`);
      expect(r.body.identity?.title).toBe(`Title ${stamp}`);
      expect(r.body.name).toBe(`Maya Reload ${stamp}`);
      expect(r.body.displayName).toBe(`Maya Display ${stamp}`);
      expect(r.body.title).toBe(`Title ${stamp}`);
    }
  });

  it("clearing displayName to null is reflected on reload", async () => {
    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ displayName: "TempForClear" });
    let r = await request(app)
      .get("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID);
    expect(r.body.displayName).toBe("TempForClear");

    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ displayName: null });
    r = await request(app)
      .get("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID);
    expect(r.body.displayName).toBeNull();
  });
});

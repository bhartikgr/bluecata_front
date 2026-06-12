/**
 * Avi 22-May Issue 6 — Settings save not persisting.
 *
 * The Settings page calls PATCH /api/auth/me to update profile fields
 * (name, avatarUrl, timezone, notificationPrefs, ...). Pre-fix, that
 * endpoint wrote ONLY to a per-process in-memory `_meStore` Map, so:
 *   - Restarts wiped saved profile fields.
 *   - Two server replicas saw inconsistent state.
 *   - The `users` SQL table's `name` column never reflected what the
 *     founder typed into the profile form.
 *
 * The fix (see server/routes.ts ~1413): a SYNC `db.transaction` writes
 * the canonical fields (`name`, `avatarUrl`) into `users` table. Other
 * preferences continue to flow through the in-memory cache (which now
 * acts as a hot read cache, not the sole storage).
 *
 * Math-sacred guarantee: this test only touches the `users` table and
 * the in-process prefs cache. No cap-table tables are read or written.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import { users as usersTable } from "../../shared/schema";
import { registerFounderUser } from "../lib/userContext";

let FOUNDER_USER_ID = "";
let app: Express;

beforeAll(async () => {
  const reg = registerFounderUser({
    email: `settings_save_${Date.now()}@test.example`,
    name: "Original Name",
    password: "settingsPass1234",
  });
  FOUNDER_USER_ID = reg.userId;

  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
}, 30_000);

describe("Avi 22-May Issue 6 — PATCH /api/auth/me persists to users table", () => {
  it("updates the user's `name` in the SQL `users` table", async () => {
    // Sanity: row exists in users with the original name.
    const db = getDb();
    const before = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ id: string; name: string }>;
    expect(before.length).toBe(1);
    expect(before[0].name).toBe("Original Name");

    // PATCH the name.
    const r = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ name: "Renamed Founder" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.updated.name).toBe("Renamed Founder");

    // Verify the SQL row reflects the new name (the proof Avi asked for).
    const after = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ id: string; name: string; avatarUrl: string | null }>;
    expect(after.length).toBe(1);
    expect(after[0].name).toBe("Renamed Founder");
  });

  it("updates `avatarUrl` in the SQL `users` table", async () => {
    const r = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ avatarUrl: "https://cdn.example/avatar123.png" });
    expect(r.status).toBe(200);

    const db = getDb();
    const after = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ id: string; avatarUrl: string | null }>;
    expect(after[0].avatarUrl).toBe("https://cdn.example/avatar123.png");
  });

  it("non-canonical prefs round-trip via GET /api/auth/me", async () => {
    // Set a non-canonical field — should flow into the in-memory cache
    // (the canonical write-through is a no-op for unknown fields).
    const r = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({
        timezone: "America/Toronto",
        notificationPrefs: {
          emailDigest: false,
          pushAlerts: true,
          inAppToasts: true,
        },
      });
    expect(r.status).toBe(200);

    // Read back via GET /api/auth/me.
    const g = await request(app)
      .get("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID);
    expect(g.status).toBe(200);
    // Diagnostic context: print received body if assertion fails.
    if (g.body.timezone !== "America/Toronto") {
      // eslint-disable-next-line no-console
      console.error("DEBUG GET /api/auth/me body:", JSON.stringify(g.body).slice(0, 600));
    }
    expect(g.body.timezone).toBe("America/Toronto");
    expect(g.body.notificationPrefs.emailDigest).toBe(false);
    expect(g.body.notificationPrefs.pushAlerts).toBe(true);
  });

  it("rejects PATCH without an identity with 401", async () => {
    // In sandbox/Vitest the demo dev-bypass auto-resolves an anonymous
    // request to `u_aisha_patel` so existing fixtures keep working. We
    // disable that for THIS assertion only — the production code path
    // (DISABLE_DEV_BYPASS=1) is what real deployments run with, and that
    // is the path Settings.tsx will hit when no session cookie is present.
    const prior = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const r = await request(app)
        .patch("/api/auth/me")
        .send({ name: "Sneaky" });
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("UNAUTHORIZED");
    } finally {
      if (prior === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prior;
    }
  });

  it("multiple PATCHes accumulate via merge (last-write-wins per field)", async () => {
    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ name: "First Update" });
    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ avatarUrl: "https://cdn.example/v2.png" });

    const db = getDb();
    const final = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ name: string; avatarUrl: string | null }>;
    // Both fields preserved across the two patches.
    expect(final[0].name).toBe("First Update");
    expect(final[0].avatarUrl).toBe("https://cdn.example/v2.png");
  });
});

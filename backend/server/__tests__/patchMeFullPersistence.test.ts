/**
 * Wave C / FIX C2 — PATCH /api/auth/me full profile persistence.
 *
 * V23_FINAL_CODE_AUDIT.md R-2 (P1): pre-fix the PATCH endpoint persisted
 * only `name` and `avatarUrl` to the `users` SQL table (Avi 22-May Issue 6).
 * `email`, `title`, and `displayName` lived ONLY in the in-memory
 * `_meStore` Map cache — they were lost on process restart and not visible
 * to other server replicas.
 *
 * The Wave C fix (see server/routes.ts ~PATCH /api/auth/me) extends the
 * canonical-field write-through to include `email`, `title`, and
 * `displayName`. Migration 0050 adds the new columns. This test verifies
 * end-to-end persistence into the `users` table.
 *
 * Math-sacred guarantee: this test touches the `users` table ONLY. No
 * cap-table / round / commit / chain tables are read or written.
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
let ORIGINAL_EMAIL = "";
let app: Express;

beforeAll(async () => {
  ORIGINAL_EMAIL = `c2_persist_${Date.now()}@test.example`;
  const reg = registerFounderUser({
    email: ORIGINAL_EMAIL,
    name: "Original Name",
    password: "wavecPass1234",
  });
  FOUNDER_USER_ID = reg.userId;

  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, app);
}, 30_000);

describe("Wave C FIX C2 — PATCH /api/auth/me persists full profile", () => {
  it("persists `title` to the SQL users table", async () => {
    const r = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ title: "Founder & CEO" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);

    const db = getDb();
    const row = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ id: string; title: string | null }>;
    expect(row.length).toBe(1);
    expect(row[0].title).toBe("Founder & CEO");
  });

  it("persists `displayName` to the SQL users table", async () => {
    const r = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ displayName: "Mx. Original" });
    expect(r.status).toBe(200);

    const db = getDb();
    const row = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ displayName: string | null }>;
    expect(row[0].displayName).toBe("Mx. Original");
  });

  it("persists `email` to the SQL users table (lowercased + trimmed)", async () => {
    const newEmail = `c2_renamed_${Date.now()}@test.example`;
    const r = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ email: `   ${newEmail.toUpperCase()}   ` });
    expect(r.status).toBe(200);

    const db = getDb();
    const row = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ email: string }>;
    expect(row[0].email).toBe(newEmail); // lowercased + trimmed
  });

  it("ignores empty-string email (does not blank out the canonical login id)", async () => {
    const db = getDb();
    const before = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ email: string }>;
    const priorEmail = before[0].email;

    const r = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ email: "" });
    expect(r.status).toBe(200);

    const after = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ email: string }>;
    expect(after[0].email).toBe(priorEmail);
  });

  it("preserves existing fields when only one field is patched (merge semantics)", async () => {
    // Set title, displayName, name in three separate PATCHes.
    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ title: "CFO" });
    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ displayName: "MergeTest" });
    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ name: "Merge Founder" });

    const db = getDb();
    const row = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{
        name: string;
        title: string | null;
        displayName: string | null;
      }>;
    expect(row[0].name).toBe("Merge Founder");
    expect(row[0].title).toBe("CFO");
    expect(row[0].displayName).toBe("MergeTest");
  });

  it("clears displayName when explicitly set to null", async () => {
    // First set, then null it out.
    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ displayName: "TempName" });
    const r = await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({ displayName: null });
    expect(r.status).toBe(200);

    const db = getDb();
    const row = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ displayName: string | null }>;
    expect(row[0].displayName).toBeNull();
  });

  it("durability proof: data survives a fresh PATCH-then-SELECT round-trip", async () => {
    // Simulate the Avi-Issue-6 contract: the values written via PATCH are
    // present in the `users` table AS A ROW (not just in the in-memory
    // cache). A subsequent server replica that opens the same DB file
    // would read these values via Drizzle.
    await request(app)
      .patch("/api/auth/me")
      .set("x-user-id", FOUNDER_USER_ID)
      .send({
        title: "Director",
        displayName: "Durable Display",
      });

    const db = getDb();
    const row = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, FOUNDER_USER_ID))
      .all() as Array<{ title: string | null; displayName: string | null }>;
    expect(row[0].title).toBe("Director");
    expect(row[0].displayName).toBe("Durable Display");
  });
});

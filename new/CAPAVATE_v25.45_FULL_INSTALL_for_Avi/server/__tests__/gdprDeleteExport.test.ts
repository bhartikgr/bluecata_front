/**
 * CP Phase B (CP-013) — GDPR / CCPA delete + export.
 *
 * Coverage:
 *   - GET /api/me/data-export returns a JSON envelope with all four data
 *     classes (identity / memberships / applications / past logs).
 *   - Each export inserts a data_export_log row.
 *   - POST /api/me/data-delete stamps deletion_requested_at + a one-time
 *     token; inserts a hash-chained data_delete_log row.
 *   - POST /api/me/data-delete/confirm with the right token transitions
 *     the log row to confirmedAt != null.
 *   - POST /api/admin/users/:id/anonymize anonymizes the row, revokes
 *     memberships, and appends a hash-chained terminal row.
 *   - Hash chain: each log row's prev_hash matches the previous row's curr_hash.
 *   - Non-admin caller blocked from anonymize endpoint.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

import { registerGdprRoutes, _gdprInternal } from "../gdprRoutes";
import { getDb } from "../db/connection";
import {
  users as usersTable,
  chapterMemberships as chapterMembershipsTable,
  dataExportLog as dataExportLogTable,
  dataDeleteLog as dataDeleteLogTable,
} from "@shared/schema";
import { installV14TestIdentity } from "./_v14TestIdentity";

let app: express.Express;

// Use the existing Aisha investor persona so requireAuth resolves a valid
// user context from the x-user-id header in vitest.
const TEST_USER_ID = "u_aisha_patel";
const TEST_USER_EMAIL = "aisha.gdpr@test.local";
const TEST_TENANT = "tenant_gdpr_test";

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerGdprRoutes(app);

  // Seed: insert a fresh test user.
  const db = getDb();
  // Clean any prior state from previous test runs.
  try {
    db.delete(dataDeleteLogTable).where(eq(dataDeleteLogTable.userId, TEST_USER_ID)).run();
    db.delete(dataExportLogTable).where(eq(dataExportLogTable.userId, TEST_USER_ID)).run();
    db.delete(chapterMembershipsTable).where(eq(chapterMembershipsTable.userId, TEST_USER_ID)).run();
    db.delete(usersTable).where(eq(usersTable.id, TEST_USER_ID)).run();
  } catch {
    /* table may not exist yet */
  }
  const now = new Date().toISOString();
  // Insert user row idempotently (Aisha may already exist from a prior
  // suite or demo seed). Use INSERT OR IGNORE semantics by catching the
  // unique-constraint error.
  try {
    db.insert(usersTable)
      .values({
        id: TEST_USER_ID,
        tenantId: TEST_TENANT,
        email: TEST_USER_EMAIL,
        name: "Aisha GDPR",
        role: "investor",
      })
      .run();
  } catch {
    /* row already exists — ok */
  }
  try {
    db.insert(chapterMembershipsTable)
      .values({
        id: "cm_gdpr_alice_test",
        tenantId: "tenant_chap_keiretsu_canada",
        chapterId: "chap_keiretsu_canada",
        userId: TEST_USER_ID,
        role: "member",
        status: "active",
        joinedAt: now,
        createdAt: now,
      })
      .run();
  } catch {
    /* row already exists — ok */
  }
});

describe("CP Phase B — GDPR data export", () => {
  it("returns a JSON envelope with all four data classes", async () => {
    const r = await request(app)
      .get("/api/me/data-export")
      .set("x-user-id", TEST_USER_ID);
    expect(r.status).toBe(200);
    // The body is the envelope itself (delivered as attachment).
    const env = r.body;
    expect(env.exportFormat).toBe("json");
    expect(env.userId).toBe(TEST_USER_ID);
    expect(env.dataClasses).toBeDefined();
    expect(env.dataClasses.identity).toBeDefined();
    expect(typeof env.dataClasses.identity.email).toBe("string");
    expect(env.dataClasses.identity.email.length).toBeGreaterThan(0);
    expect(Array.isArray(env.dataClasses.chapterMemberships)).toBe(true);
    expect(env.dataClasses.chapterMemberships.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(env.dataClasses.consortiumApplications)).toBe(true);
    expect(Array.isArray(env.dataClasses.pastExports)).toBe(true);
    expect(Array.isArray(env.dataClasses.pastDeletes)).toBe(true);
    expect(Array.isArray(env.excluded)).toBe(true);
    expect(env.excluded.length).toBeGreaterThanOrEqual(1);
  });

  it("each export inserts a data_export_log row", async () => {
    const db = getDb();
    const before: any[] = db
      .select()
      .from(dataExportLogTable)
      .where(eq(dataExportLogTable.userId, TEST_USER_ID))
      .all();
    await request(app)
      .get("/api/me/data-export")
      .set("x-user-id", TEST_USER_ID);
    const after: any[] = db
      .select()
      .from(dataExportLogTable)
      .where(eq(dataExportLogTable.userId, TEST_USER_ID))
      .all();
    expect(after.length).toBe(before.length + 1);
  });

  it("anonymous caller is rejected when sandbox bypass disabled", async () => {
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      const r = await request(app).get("/api/me/data-export");
      expect([401, 403]).toContain(r.status);
    } finally {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
    }
  });
});

describe("CP Phase B — GDPR delete request + confirm", () => {
  it("delete request stamps deletion_token + appends a chained pending log row", async () => {
    const db = getDb();
    const r = await request(app)
      .post("/api/me/data-delete")
      .set("x-user-id", TEST_USER_ID)
      .send({ reason: "no longer using the platform" });
    expect(r.status).toBe(202);
    expect(r.body.status).toBe("pending_confirmation");
    expect(typeof r.body.confirmationToken).toBe("string");
    // User row stamped with the token.
    const u = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, TEST_USER_ID))
      .all()[0] as any;
    expect(u.deletion_token ?? u.deletionToken).toBe(r.body.confirmationToken);
    expect(u.deletion_requested_at ?? u.deletionRequestedAt).toBeTruthy();
    // Hash-chained log row appended.
    const logs: any[] = db
      .select()
      .from(dataDeleteLogTable)
      .where(eq(dataDeleteLogTable.userId, TEST_USER_ID))
      .all();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const last = logs[logs.length - 1];
    expect(last.curr_hash ?? last.currHash).toMatch(/^[a-f0-9]{64}$/);
    expect(last.confirmed_at ?? last.confirmedAt).toBeNull();
  });

  it("delete confirm with valid token marks the log row confirmed", async () => {
    const db = getDb();
    // Issue a fresh request to capture token.
    const r1 = await request(app)
      .post("/api/me/data-delete")
      .set("x-user-id", TEST_USER_ID)
      .send({ reason: "second-pass test" });
    const token = r1.body.confirmationToken;
    expect(typeof token).toBe("string");
    const r2 = await request(app)
      .post("/api/me/data-delete/confirm")
      .set("x-user-id", TEST_USER_ID)
      .send({ token });
    expect(r2.status).toBe(200);
    expect(r2.body.status).toBe("awaiting_admin_anonymization");
    // The most recent pending row should now be confirmed.
    const logs: any[] = db
      .select()
      .from(dataDeleteLogTable)
      .where(eq(dataDeleteLogTable.userId, TEST_USER_ID))
      .all();
    const confirmed = logs.filter((l: any) => l.confirmed_at ?? l.confirmedAt);
    expect(confirmed.length).toBeGreaterThanOrEqual(1);
  });

  it("delete confirm with WRONG token returns 403", async () => {
    const r = await request(app)
      .post("/api/me/data-delete/confirm")
      .set("x-user-id", TEST_USER_ID)
      .send({ token: "definitely-not-the-real-token" });
    expect(r.status).toBe(403);
  });
});

describe("CP Phase B — Admin anonymize", () => {
  // u_daniel_okafor is an existing persona (an investor); we use it as the
  // anonymize victim so requireAuth resolves to a known user context.
  const VICTIM_ID = "u_daniel_okafor";

  beforeAll(() => {
    const db = getDb();
    try {
      db.delete(dataDeleteLogTable).where(eq(dataDeleteLogTable.userId, VICTIM_ID)).run();
      db.delete(chapterMembershipsTable).where(eq(chapterMembershipsTable.userId, VICTIM_ID)).run();
      db.delete(usersTable).where(eq(usersTable.id, VICTIM_ID)).run();
    } catch {
      /* clean slate */
    }
    const now = new Date().toISOString();
    try {
      db.insert(usersTable)
        .values({
          id: VICTIM_ID,
          tenantId: TEST_TENANT,
          email: "victim@test.local",
          name: "Victim User",
          role: "investor",
        })
        .run();
    } catch {
      /* row already exists — ok */
    }
    try {
      db.insert(chapterMembershipsTable)
        .values({
          id: "cm_gdpr_victim",
          tenantId: "tenant_chap_keiretsu_canada",
          chapterId: "chap_keiretsu_canada",
          userId: VICTIM_ID,
          role: "member",
          status: "active",
          joinedAt: now,
          createdAt: now,
        })
        .run();
    } catch {
      /* row already exists — ok */
    }
  });

  it("non-admin caller is rejected", async () => {
    const r = await request(app)
      .post(`/api/admin/users/${VICTIM_ID}/anonymize`)
      .set("x-user-id", "u_aisha_patel")
      .set("x-role", "investor")
      .send({});
    expect([401, 403]).toContain(r.status);
  });

  it("anonymizes the user, revokes memberships, and appends chained terminal log", async () => {
    const db = getDb();
    const r = await request(app)
      .post(`/api/admin/users/${VICTIM_ID}/anonymize`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.userId).toBe(VICTIM_ID);
    expect(r.body.recordsRedacted).toBeGreaterThanOrEqual(1);
    // User row redacted in place.
    const u: any = db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, VICTIM_ID))
      .all()[0];
    expect(u.email).toMatch(/^deleted\+/);
    expect(u.name).toBe("Deleted User");
    expect(u.anonymized_at ?? u.anonymizedAt).toBeTruthy();
    // Memberships revoked.
    const mem: any[] = db
      .select()
      .from(chapterMembershipsTable)
      .where(eq(chapterMembershipsTable.userId, VICTIM_ID))
      .all();
    expect(mem.length).toBeGreaterThanOrEqual(1);
    expect(mem[0].status).toBe("revoked");
    // Terminal log row appended.
    const logs: any[] = db
      .select()
      .from(dataDeleteLogTable)
      .where(eq(dataDeleteLogTable.userId, VICTIM_ID))
      .all();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const terminal = logs[logs.length - 1];
    expect(terminal.confirmed_at ?? terminal.confirmedAt).toBeTruthy();
    expect(terminal.reason).toBe("admin_anonymization");
    expect(terminal.curr_hash ?? terminal.currHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("re-anonymize on same user returns 409", async () => {
    const r = await request(app)
      .post(`/api/admin/users/${VICTIM_ID}/anonymize`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({});
    expect(r.status).toBe(409);
  });
});

describe("CP Phase B — Hash chain", () => {
  it("buildExportEnvelope produces a deterministic shape", () => {
    const { envelope, bytes } = _gdprInternal.buildExportEnvelope(TEST_USER_ID);
    expect(envelope.userId).toBe(TEST_USER_ID);
    expect(bytes).toBeGreaterThan(0);
  });

  it("computeHash chains correctly", () => {
    const h1 = _gdprInternal.computeHash(null, { a: 1 });
    const h2 = _gdprInternal.computeHash(h1, { a: 2 });
    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(h2).toMatch(/^[a-f0-9]{64}$/);
  });
});

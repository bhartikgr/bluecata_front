/**
 * v25.48.2 MF-D — GET /api/collective/applications/mine must read STRICTLY
 * from the DB (the authoritative store), never from the in-memory `applications`
 * mirror. The prior implementation read the in-memory array first and only fell
 * back to the DB when the mirror was empty — a violation of the 100% DB-driven
 * rule that could hide a persisted application.
 *
 * Proof strategy: seed a row DIRECTLY into the collective_apps table via the raw
 * connection (so it is present in the DB but ABSENT from the in-memory
 * `applications` array, which is only mutated by the submit route). If /mine
 * returns that row, the read is genuinely DB-driven. A second test forces a DB
 * read error and asserts a FAIL-CLOSED 500 (not a false empty / 404).
 *
 * Identity via the x-user-id header (Vitest-only test-harness convenience).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import crypto from "node:crypto";
import { getDb, rawDb } from "../db/connection";

let app: Express;

async function buildApp(): Promise<Express> {
  const a = express();
  a.use(express.json());
  const server = http.createServer(a);
  const { registerRoutes } = await import("../routes");
  await registerRoutes(server, a);
  return a;
}

function seedAppRowInDbOnly(userId: string): { id: string; submittedAt: string } {
  const id = `app_mfd_${crypto.randomBytes(6).toString("hex")}`;
  const submittedAt = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO collective_apps (id, tenant_id, chapter_id, user_id, status, payload_json, submitted_at, created_at)
       VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?)`,
    )
    .run(
      id,
      "tenant_default",
      "chapter_default",
      userId,
      JSON.stringify({ thesis: "MF-D DB-driven proof", sectors: ["fintech"] }),
      submittedAt,
      submittedAt,
    );
  return { id, submittedAt };
}

beforeAll(async () => {
  getDb();
  app = await buildApp();
});

describe("v25.48.2 MF-D — /applications/mine is strictly DB-driven", () => {
  it("returns a DB-only application row (never written to the in-memory mirror)", async () => {
    const userId = `u_mfd_${crypto.randomBytes(4).toString("hex")}`;
    const { id } = seedAppRowInDbOnly(userId);

    const res = await request(app)
      .get("/api/collective/applications/mine")
      .set("x-user-id", userId);

    expect(res.status).toBe(200);
    expect(res.body.application).toBeTruthy();
    expect(res.body.application.id).toBe(id);
    expect(res.body.application.userId).toBe(userId);
  });

  it("fails closed (500) — not a false 404/empty — when the DB read throws", async () => {
    const userId = `u_mfd_${crypto.randomBytes(4).toString("hex")}`;
    seedAppRowInDbOnly(userId);

    const db = rawDb();
    db.prepare(`ALTER TABLE collective_apps RENAME TO collective_apps_mfd_bak`).run();
    try {
      const res = await request(app)
        .get("/api/collective/applications/mine")
        .set("x-user-id", userId);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("APPLICATIONS_LOOKUP_FAILED");
    } finally {
      db.prepare(`ALTER TABLE collective_apps_mfd_bak RENAME TO collective_apps`).run();
    }
  });
});

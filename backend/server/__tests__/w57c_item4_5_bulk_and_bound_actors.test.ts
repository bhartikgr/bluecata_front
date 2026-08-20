/**
 * WAVE 57c · ITEMS 4 and 5 (R37 approved order #4 and #5).
 *
 * ITEM 4 — `POST /api/admin/users/bulk` had an unbounded `ids[]`, hard-deleted
 * `auth_sessions` rows per id via `force_logout`, required no confirmation, and
 * audited under `"system:bulk"`. Now: actor bound and fail-closed, ids capped at
 * `MAX_BULK_USER_IDS`, deduped and type-checked, two-phase confirmation naming
 * the exact rows (the `adminContactsStore.ts:2044` shape), and one batch audit
 * entry alongside the per-id entries.
 *
 * ITEM 5 — the anonymous audit actors on destructive endpoints:
 *   `"system:bulk"`  — server/adminPlatformStore.ts (bulk)               → bound
 *   `"system:admin"` — server/adminPlatformStore.ts (sessions/revoke)    → bound
 *   `"system"`       — server/captableCommitStore.ts (compliance hold)   → bound
 *                      (proved separately in w57c_item2_compliance_hold_audit)
 *   `"u_unknown_admin"` — server/partnerResponderStore.ts (responder DELETE)
 *                                                                       → bound
 *
 * ── BOTH POLES, ALWAYS ─────────────────────────────────────────────────────
 * A handler that refused everything would satisfy "unbounded is refused" while
 * breaking the operation, which R37 forbids. So every refusal below is paired
 * with a request that MUST succeed and MUST really move rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { MAX_BULK_USER_IDS } from "../adminPlatformStore";

const ADMIN = "u_admin";
const STAMP = "w57c45";
const U1 = `u_${STAMP}_a`;
const U2 = `u_${STAMP}_b`;

let app: Express;
let server: http.Server;

function sql(q: string, ...args: unknown[]) {
  return rawDb().prepare(q).run(...args);
}

function auditRows(action: string) {
  return rawDb()
    .prepare(
      `SELECT actor_id AS actorId, payload_json AS payloadJson FROM audit_log
         WHERE action = ? ORDER BY created_at DESC, id DESC LIMIT 10`,
    )
    .all(action) as Array<{ actorId: string | null; payloadJson: string | null }>;
}

beforeAll(async () => {
  await seedDemoData(getDb());
  const now = new Date().toISOString();
  for (const uid of [U1, U2]) {
    sql(
      `INSERT OR REPLACE INTO auth_users (id, email, password_hash, role, status, created_at)
       VALUES (?, ?, 'x_not_a_real_hash', 'founder', 'active', ?)`,
      uid, `${uid}@probe.example`, now,
    );
  }
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W57c item 4 — POST /api/admin/users/bulk blast radius and confirmation (over HTTP)", () => {
  it("LOWER POLE: an unbounded ids[] beyond the cap is refused with the cap and the received count named", async () => {
    const tooMany = Array.from({ length: MAX_BULK_USER_IDS + 1 }, (_, i) => `u_${STAMP}_bulk_${i}`);
    const r = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "force_logout", ids: tooMany, confirmCount: tooMany.length });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("bulk_limit_exceeded");
    expect(r.body.limit).toBe(MAX_BULK_USER_IDS);
    expect(r.body.received).toBe(MAX_BULK_USER_IDS + 1);
  });

  it("LOWER POLE: a call with no confirmation is refused 409 and told exactly what would change", async () => {
    const r = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "force_logout", ids: [U1, U2] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("confirmation_required");
    expect(r.body.proposedChange).toMatchObject({
      action: "force_logout",
      count: 2,
      hardDeletesSessions: true,
    });
    expect(r.body.proposedChange.ids).toEqual([U1, U2]);
  });

  it("LOWER POLE: a MISMATCHED confirmCount is refused (the confirmation is not a rubber stamp)", async () => {
    const r = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "suspend", ids: [U1, U2], confirmCount: 1 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("confirmation_required");
    // and nothing was applied
    const row = rawDb().prepare(`SELECT status FROM auth_users WHERE id = ?`).get(U1) as { status: string };
    expect(row.status).toBe("active");
  });

  it("LOWER POLE: a non-string id is refused rather than silently matching nothing", async () => {
    const r = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "suspend", ids: [U1, 42], confirmCount: 2 });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("invalid_ids");
  });

  it("UPPER POLE: with a matching confirmCount the operation applies, really moves rows, and is audited as a batch with a BOUND actor", async () => {
    const r = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "suspend", ids: [U1, U2], confirmCount: 2 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, action: "suspend", count: 2 });
    expect(r.body.applied).toBeGreaterThanOrEqual(2);

    // The rows really moved — the fix did not disable the operation.
    for (const uid of [U1, U2]) {
      const row = rawDb().prepare(`SELECT status FROM auth_users WHERE id = ?`).get(uid) as { status: string };
      expect(row.status).toBe("suspended");
    }

    // Batch audit entry, bound actor.
    const batch = auditRows("user.bulk.suspend");
    expect(batch.length).toBeGreaterThan(0);
    expect(batch[0].actorId).toBe(ADMIN);
    const payload = JSON.parse(batch[0].payloadJson ?? "{}");
    expect(payload).toMatchObject({ requested: 2, limit: MAX_BULK_USER_IDS });
    expect(payload.ids).toEqual([U1, U2]);

    // Per-id audit entries, also bound.
    const perId = auditRows("user.suspend");
    expect(perId.length).toBeGreaterThan(0);
    for (const row of perId.slice(0, 2)) {
      expect(String(row.actorId ?? "")).not.toMatch(/^system/);
    }
  });

  it("DUPLICATES are collapsed, so the confirmed count is the count that is actually acted on", async () => {
    const r = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "unsuspend", ids: [U1, U1, U1], confirmCount: 1 });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(1);
    const row = rawDb().prepare(`SELECT status FROM auth_users WHERE id = ?`).get(U1) as { status: string };
    expect(row.status).toBe("active");
  });
});

describe("W57c item 5 — no destructive admin endpoint writes an anonymous audit actor", () => {
  it("sessions/revoke audits to the real admin id, never 'system:admin'", async () => {
    const r = await request(app)
      .post(`/api/admin/users/${U2}/sessions/revoke`)
      .set("x-user-id", ADMIN)
      .send({});
    expect(r.status).toBe(200);
    const rows = auditRows("user.sessions.revoked");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actorId).toBe(ADMIN);
  });

  it("CENSUS: no audit_log row written by this suite carries a system:*/u_unknown_admin actor for the four named actions", () => {
    const rows = rawDb()
      .prepare(
        `SELECT actor_id AS actorId, action FROM audit_log
           WHERE action IN ('user.sessions.revoked','user.bulk.suspend','user.bulk.unsuspend',
                            'user.suspend','user.unsuspend','user.force_logout',
                            'partner_responder.deleted','compliance_hold.released','compliance_hold.set')`,
      )
      .all() as Array<{ actorId: string | null; action: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(String(row.actorId ?? "")).not.toMatch(/^system/);
      expect(String(row.actorId ?? "")).not.toBe("u_unknown_admin");
      expect(String(row.actorId ?? "")).not.toBe("");
    }
  });
});

/**
 * WAVE 57c · ITEM 2 (R37 approved order #2) — releasing a compliance hold is
 * now AUDITED with a BOUND ACTOR, and the sacred `"system"` fallback is
 * unreachable over HTTP.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * `DELETE /api/admin/compliance-hold/:tenantId` (server/captableCommitStore.ts:1366,
 * SACRED) turns OFF the control that blocks cap-table commits for a tenant. It
 * wrote NO audit record, and its actor resolution was
 * `let heldBy = "system"; try { heldBy = requireIdentity(req).userId } catch {}`
 * (:1370) — so an unresolvable identity produced a real financial-control change
 * attributed to `"system"`. Same fallback on the sibling POST (:1360).
 *
 * ── HOW IT IS FIXED WITHOUT TOUCHING THE SACRED FILE ───────────────────────
 * `server/lib/complianceHoldAuditGuard.ts` is registered on the same two paths
 * BEFORE `registerCaptableCommitRoutes(app)` (server/routes.ts) — the same
 * registration-order mechanism `registerRoundMathRoutes` already uses on the
 * sacred commit paths. It fails closed on identity before anything mutates and
 * appends a hash-chained `appendAdminAudit` entry on success.
 *
 * ── EVERY ASSERTION IS THROUGH HTTP ────────────────────────────────────────
 * Nothing here calls `setComplianceHoldForTenant` directly. The hold is SET
 * through the shipped POST route and RELEASED through the shipped DELETE route,
 * because the whole point of the finding is what the HTTP surface does. The
 * pre-existing test for this feature (v15_compliance_hold_per_tenant.test.ts)
 * asserts the positive cases at STORE level only, which is exactly why the
 * missing audit survived.
 *
 * Both poles:
 *   UPPER — an authenticated admin CAN still set and release a hold (200), so
 *           the fix does not disable a legitimate operation, and the hold state
 *           really flips (read back through GET).
 *   LOWER — the audit row exists, its actor is the real admin id, and it is
 *           NOT "system"-shaped; a non-admin cannot release.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";

const ADMIN = "u_admin";
const FOUNDER = "u_maya_chen";
const TENANT = "tenant_w57c_hold_probe";

let app: Express;
let server: http.Server;

function auditRows(action: string, target: string) {
  return rawDb()
    .prepare(
      `SELECT actor_id AS actorId, action, target, payload_json AS payloadJson
         FROM audit_log WHERE action = ? AND target = ?
         ORDER BY created_at DESC, id DESC LIMIT 5`,
    )
    .all(action, target) as Array<{
    actorId: string | null;
    action: string;
    target: string;
    payloadJson: string | null;
  }>;
}

beforeAll(async () => {
  await seedDemoData(getDb());
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W57c item 2 — compliance-hold release is audited with a bound actor (over HTTP)", () => {
  it("UPPER POLE: an admin can still SET a hold through HTTP, and it is audited to the real admin id", async () => {
    const set = await request(app)
      .post("/api/admin/compliance-hold")
      .set("x-user-id", ADMIN)
      .send({ tenantId: TENANT, on: true, reason: "W57c probe — AML escalation" });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ ok: true, tenantId: TENANT, held: true });

    const rows = auditRows("compliance_hold.set", `tenant:${TENANT}`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actorId).toBe(ADMIN);
    expect(String(rows[0].actorId ?? "")).not.toMatch(/^system/);
  });

  it("UPPER POLE: the hold is really visible through the shipped GET (the SET was not a no-op)", async () => {
    const list = await request(app)
      .get("/api/admin/compliance-hold")
      .set("x-user-id", ADMIN);
    expect(list.status).toBe(200);
    const holds = (list.body?.holds ?? []) as Array<{ tenantId: string }>;
    expect(holds.map((h) => h.tenantId)).toContain(TENANT);
  });

  it("THE FINDING: DELETE /api/admin/compliance-hold/:tenantId now writes an audit row with a BOUND actor", async () => {
    const before = auditRows("compliance_hold.released", `tenant:${TENANT}`).length;

    const del = await request(app)
      .delete(`/api/admin/compliance-hold/${TENANT}`)
      .set("x-user-id", ADMIN);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ ok: true, tenantId: TENANT, held: false });

    const rows = auditRows("compliance_hold.released", `tenant:${TENANT}`);
    expect(rows.length).toBe(before + 1);
    // R35 — the actor is BOUND. "system" would be a record of nothing.
    expect(rows[0].actorId).toBe(ADMIN);
    expect(String(rows[0].actorId ?? "")).not.toMatch(/^system/);
    expect(String(rows[0].actorId ?? "")).not.toBe("");
    // The payload records what actually changed, not merely what was asked.
    const payload = JSON.parse(rows[0].payloadJson ?? "{}");
    expect(payload).toMatchObject({ tenantId: TENANT, priorHeld: true, resultHeld: false, changed: true });
  });

  it("UPPER POLE: the release really took effect (the audited operation is not disabled)", async () => {
    const list = await request(app)
      .get("/api/admin/compliance-hold")
      .set("x-user-id", ADMIN);
    expect(list.status).toBe(200);
    const holds = (list.body?.holds ?? []) as Array<{ tenantId: string }>;
    expect(holds.map((h) => h.tenantId)).not.toContain(TENANT);
  });

  it("LOWER POLE: a founder (non-admin) cannot release a hold, and no audit row is minted for them", async () => {
    const before = auditRows("compliance_hold.released", `tenant:${TENANT}`).length;
    const r = await request(app)
      .delete(`/api/admin/compliance-hold/${TENANT}`)
      .set("x-user-id", FOUNDER);
    expect([401, 403]).toContain(r.status);
    const after = auditRows("compliance_hold.released", `tenant:${TENANT}`);
    expect(after.length).toBe(before);
  });

  it("no audit row on this platform is attributed to a 'system'-shaped actor for compliance holds", async () => {
    const rows = rawDb()
      .prepare(
        `SELECT actor_id AS actorId FROM audit_log
           WHERE action LIKE 'compliance_hold.%'`,
      )
      .all() as Array<{ actorId: string | null }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(String(r.actorId ?? "")).not.toMatch(/^system/);
      expect(String(r.actorId ?? "")).not.toBe("");
    }
  });
});

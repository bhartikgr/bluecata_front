/* v25.40 FIX-5 / FIX-6 / FIX-7 — E2E: mutating admin endpoints emit audit rows.
 *
 * CONTRACT: "every mutating admin endpoint leaves an audit trail." Prior to
 * v25.40 several privileged admin mutations completed WITHOUT writing an
 * audit_log row, leaving forensic gaps. This suite proves each now appends.
 *
 * Endpoints covered:
 *   FIX-5  POST /api/admin/dsc/promote              → action "dsc.role.promoted"
 *          POST /api/admin/dsc/demote               → action "dsc.role.demoted"
 *   FIX-6  POST /api/admin/collective/members/bootstrap
 *                                                   → action "collective.member.bootstrapped"
 *          POST /api/admin/collective/members/:userId/suspend
 *                                                   → action "collective.member.suspended"
 *   FIX-7  POST /api/admin/users/:id/sessions/revoke
 *                                                   → action "user.sessions.revoked"
 *
 * Each test snapshots the per-action audit_log row count, performs the
 * mutation, and asserts exactly one new audit_log row was written for the
 * expected action with the expected target.
 *
 * DSC promote requires an ACTIVE collective member; we activate the target via
 * collectiveMembershipStore.activate() before promoting.
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import * as collectiveMembershipStore from "../collectiveMembershipStore.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2540_audit_admin_${STAMP}`;
const DSC_TARGET = `u_v2540_dsc_target_${STAMP}`;
const MEMBER_TARGET = `u_v2540_member_target_${STAMP}`;
const SESSION_TARGET = `u_v2540_session_target_${STAMP}`;

function req(method, path, { body, userId } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json", "x-user-id": userId ?? ADMIN };
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** Count audit_log rows for a given action (optionally filtered by target). */
function auditCount(action, target) {
  try {
    if (target !== undefined) {
      return rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ? AND target = ?`)
        .get(action, target).n;
    }
    return rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`)
      .get(action).n;
  } catch {
    return 0;
  }
}

beforeAll(async () => {
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2540.test`, name: "v25.40 Audit Admin",
    isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false,
  });
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.40 FIX-5 — DSC promote/demote emit audit rows", () => {
  it("promote writes a dsc.role.promoted audit row", async () => {
    // Precondition: target must be an ACTIVE collective member.
    collectiveMembershipStore.activate(DSC_TARGET, ADMIN, "standard");
    expect(collectiveMembershipStore.isActive(DSC_TARGET)).toBe(true);

    const target = `dsc:${DSC_TARGET}`;
    const before = auditCount("dsc.role.promoted", target);
    const res = await req("POST", "/api/admin/dsc/promote", { body: { userId: DSC_TARGET } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(auditCount("dsc.role.promoted", target)).toBe(before + 1);
  });

  it("demote writes a dsc.role.demoted audit row", async () => {
    const target = `dsc:${DSC_TARGET}`;
    const before = auditCount("dsc.role.demoted", target);
    const res = await req("POST", "/api/admin/dsc/demote", { body: { userId: DSC_TARGET } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(auditCount("dsc.role.demoted", target)).toBe(before + 1);
  });
});

describe("v25.40 FIX-6 — collective member bootstrap/suspend emit audit rows", () => {
  it("bootstrap writes a collective.member.bootstrapped audit row", async () => {
    const target = `member:${MEMBER_TARGET}`;
    const before = auditCount("collective.member.bootstrapped", target);
    const res = await req("POST", "/api/admin/collective/members/bootstrap", {
      body: { userId: MEMBER_TARGET, tier: "standard" },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(auditCount("collective.member.bootstrapped", target)).toBe(before + 1);
  });

  it("suspend writes a collective.member.suspended audit row", async () => {
    const target = `member:${MEMBER_TARGET}`;
    const before = auditCount("collective.member.suspended", target);
    const res = await req("POST", `/api/admin/collective/members/${MEMBER_TARGET}/suspend`, {
      body: { reason: "v25.40 audit completeness test" },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(auditCount("collective.member.suspended", target)).toBe(before + 1);
  });
});

describe("v25.40 FIX-7 — session revoke emits audit row", () => {
  it("sessions/revoke writes a user.sessions.revoked audit row", async () => {
    const target = `user:${SESSION_TARGET}`;
    const before = auditCount("user.sessions.revoked", target);
    const res = await req("POST", `/api/admin/users/${SESSION_TARGET}/sessions/revoke`, { body: {} });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(auditCount("user.sessions.revoked", target)).toBe(before + 1);
  });
});

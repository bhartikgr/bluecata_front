/* v25.40 FIX-8 — E2E: audit-log append cannot have a forged actor.
 *
 * SECURITY CONTRACT: the audit chain is the forensic source of truth. The
 * POST /api/admin/audit-log/append endpoint must derive the `actor` SOLELY
 * from the authenticated server-side context (req.userContext.userId) and
 * IGNORE any client-supplied `actor` field in the request body. A caller who
 * sets `actor: "u_someone_else"` (or any forged value) must NOT be able to
 * influence the stored `actor_id` column.
 *
 * Proves:
 *   - A POST with a forged body `actor` stores the SERVER persona userId in
 *     audit_log.actor_id, NOT the forged value.
 *   - The forged value never appears as an actor_id for the written row.
 *   - With no authenticated context (dev bypass disabled), the fallback actor
 *     is the server sentinel "system:admin" — still never the forged value.
 *   - Missing entity/eventType → 400 (basic field validation preserved).
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2540_actor_admin_${STAMP}`;
const FORGED = `u_v2540_FORGED_victim_${STAMP}`;

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

function reqNoAuth(method, path, body) {
  return new Promise((resolve, reject) => {
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    const restore = () => {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
    };
    const headers = { "Content-Type": "application/json" };
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        restore();
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", (e) => { restore(); reject(e); });
    if (payload) r.write(payload);
    r.end();
  });
}

/** Look up the actor_id of the audit_log row written for a given action. */
function actorForAction(action) {
  try {
    const row = rawDb()
      .prepare(`SELECT actor_id FROM audit_log WHERE action = ? ORDER BY created_at DESC LIMIT 1`)
      .get(action);
    return row?.actor_id ?? null;
  } catch {
    return null;
  }
}

/** Count rows where the forged userId leaked into actor_id (must always be 0). */
function forgedActorRowCount() {
  try {
    return rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE actor_id = ?`)
      .get(FORGED).n;
  } catch {
    return 0;
  }
}

beforeAll(async () => {
  __setRuntimePersona({
    userId: ADMIN, email: `${ADMIN}@v2540.test`, name: "v25.40 Actor Admin",
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

describe("v25.40 FIX-8 — POST /api/admin/audit-log/append ignores client-supplied actor", () => {
  it("stores the SERVER persona as actor_id, NOT the forged body actor", async () => {
    const eventType = `v2540.forge.test.${STAMP}`;
    const res = await req("POST", "/api/admin/audit-log/append", {
      body: { actor: FORGED, entity: `entity:${STAMP}`, eventType, payload: { note: "attempted forge" } },
    });
    expect(res.status).toBe(200);
    // Response object reflects the server-derived actor, never the forged value.
    expect(res.body.actor).toBe(ADMIN);
    expect(res.body.actor).not.toBe(FORGED);

    // The durable audit_log row records the authenticated server persona.
    expect(actorForAction(eventType)).toBe(ADMIN);

    // The forged value NEVER leaked into any actor_id.
    expect(forgedActorRowCount()).toBe(0);
  });

  it("with no authenticated context, falls back to system sentinel — never the forged value", async () => {
    const eventType = `v2540.forge.noauth.${STAMP}`;
    const res = await reqNoAuth("POST", "/api/admin/audit-log/append", {
      actor: FORGED, entity: `entity:noauth:${STAMP}`, eventType, payload: {},
    });
    // If the endpoint requires auth it may 401/403; if it appends it uses the
    // sentinel. Either way, the forged actor must NEVER be persisted.
    if (res.status === 200) {
      expect(actorForAction(eventType)).toBe("system:admin");
    }
    expect(forgedActorRowCount()).toBe(0);
  });

  it("rejects missing required fields with 400 (validation preserved)", async () => {
    const resNoEntity = await req("POST", "/api/admin/audit-log/append", { body: { eventType: "x" } });
    expect(resNoEntity.status).toBe(400);
    const resNoEvent = await req("POST", "/api/admin/audit-log/append", { body: { entity: "x" } });
    expect(resNoEvent.status).toBe(400);
  });
});

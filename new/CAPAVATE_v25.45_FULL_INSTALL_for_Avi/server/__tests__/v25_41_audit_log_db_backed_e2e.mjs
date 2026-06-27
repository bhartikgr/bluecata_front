/* v25.41 Phase 4 — E2E: admin audit-log is DB-backed (Q3, Avi=A).
 *
 * Q3 (Avi answer = A): the admin Audit Log page (AuditLog.tsx) now reads its
 * rows from GET /api/admin/audit-log (DB-backed via appendAdminAudit's
 * write-through to the audit_log table) rather than rendering an in-memory /
 * telemetry-only projection. Per Avi's unifying directive, the page is dynamic
 * from the record table.
 *
 * Contract pinned here:
 *   - appendAdminAudit writes a durable row to the audit_log table
 *   - GET /api/admin/audit-log returns that entry (eventType + entity + actor)
 *   - the eventType filter narrows results to the matching entries
 *   - the durable audit_log table contains the same action/target row
 *   - unauthenticated GET → 401; non-admin GET → 403
 */
process.env.COLLECTIVE_ENABLED = "1";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { registerRoutes } from "../routes.ts";
import { rawDb } from "../db/connection.ts";
import { __setRuntimePersona } from "../lib/userContext.ts";
import { appendAdminAudit } from "../adminPlatformStore.ts";

let app, server, port;
const STAMP = Date.now();
const ADMIN = `u_v2541_audit_admin_${STAMP}`;
const NONADMIN = `u_v2541_audit_member_${STAMP}`;

// Use a `co_<id>` entity so resolveTenantId() routes to `tenant_co_<id>` —
// a fresh, isolated tenant chain we own. Generic strings fall back to
// `tenant_platform`, which is a shared chain that may have pre-existing
// state from other tests and would yield a false-fail on verification.
const ENTITY = `co_v2541_audit_${STAMP}`;
const EVENT_TYPE = `v2541.audit.probe_${STAMP}`;

const results = [];
function record(name, pass, extra = "") {
  results.push({ name, pass });
  // eslint-disable-next-line no-console
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${extra ? " - " + extra : ""}`);
}

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

function reqNoAuth(method, path) {
  return new Promise((resolve, reject) => {
    const prev = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    const headers = { "Content-Type": "application/json" };
    const r = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
        else process.env.DISABLE_DEV_BYPASS = prev;
        let parsed = buf;
        try { parsed = JSON.parse(buf); } catch { /* raw */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on("error", (e) => {
      if (prev === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = prev;
      reject(e);
    });
    r.end();
  });
}

function dbHasAuditRow(eventType, entity) {
  try {
    const row = rawDb()
      .prepare(`SELECT id FROM audit_log WHERE action = ? AND target = ? LIMIT 1`)
      .get(eventType, entity);
    return !!row;
  } catch { return false; }
}

beforeAll(async () => {
  __setRuntimePersona({ userId: ADMIN, email: `${ADMIN}@v2541.test`, name: "v25.41 Audit Admin", isFounder: false, isInvestor: false, isAdmin: true, hasInvitations: false });
  __setRuntimePersona({ userId: NONADMIN, email: `${NONADMIN}@v2541.test`, name: "v25.41 Audit Member", isFounder: true, isInvestor: false, isAdmin: false, hasInvitations: false });

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise((resolve) => server.listen(0, () => { port = server.address().port; resolve(); }));

  // Write a durable audit entry (DB write-through + memory mirror).
  appendAdminAudit(ADMIN, ENTITY, EVENT_TYPE, { probe: STAMP });
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

describe("v25.41 admin audit-log DB-backed (Q3) — E2E", () => {
  it("0. the written audit entry lands in the durable audit_log table", () => {
    record("audit_log DB row exists for the probe", dbHasAuditRow(EVENT_TYPE, ENTITY));
    expect(dbHasAuditRow(EVENT_TYPE, ENTITY)).toBe(true);
  });

  it("1. unauthenticated GET /api/admin/audit-log → 401", async () => {
    const res = await reqNoAuth("GET", "/api/admin/audit-log");
    record("unauth audit-log 401", res.status === 401, `status ${res.status}`);
    expect(res.status).toBe(401);
  });

  it("2. non-admin GET /api/admin/audit-log → 403", async () => {
    const res = await req("GET", "/api/admin/audit-log", { userId: NONADMIN });
    record("non-admin audit-log 403", res.status === 403, `status ${res.status}`);
    expect(res.status).toBe(403);
  });

  it("3. admin GET /api/admin/audit-log returns the DB-backed entry", async () => {
    const res = await req("GET", "/api/admin/audit-log");
    record("admin audit-log 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const items = res.body?.items ?? [];
    record("response carries an items array + count", Array.isArray(items) && typeof res.body?.count === "number", `count ${res.body?.count}`);
    expect(Array.isArray(items)).toBe(true);
    const probe = items.find((a) => a.eventType === EVENT_TYPE && a.entity === ENTITY);
    record("probe entry present in audit-log items", !!probe, probe ? `actor ${probe.actor}` : "missing");
    expect(probe).toBeTruthy();
    record("probe entry actor is the admin", probe?.actor === ADMIN, probe?.actor);
    expect(probe?.actor).toBe(ADMIN);
  });

  it("4. eventType filter narrows to the matching entry only", async () => {
    const res = await req("GET", `/api/admin/audit-log?eventType=${encodeURIComponent(EVENT_TYPE)}`);
    record("filtered audit-log 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const items = res.body?.items ?? [];
    const allMatch = items.length >= 1 && items.every((a) => a.eventType === EVENT_TYPE);
    record("filtered items all match eventType", allMatch, `len ${items.length}`);
    expect(allMatch).toBe(true);
  });

  // v25.41 round-3 (per GPT-5.5 re-verify): DB-backed pagination & wildcard.
  it("5. response carries total/limit/offset for server-side pagination", async () => {
    const res = await req("GET", "/api/admin/audit-log?limit=10&offset=0");
    record("pagination meta present",
      typeof res.body?.total === "number"
      && typeof res.body?.limit === "number"
      && typeof res.body?.offset === "number",
      `total=${res.body?.total} limit=${res.body?.limit} offset=${res.body?.offset}`);
    expect(typeof res.body?.total).toBe("number");
    expect(typeof res.body?.limit).toBe("number");
    expect(typeof res.body?.offset).toBe("number");
    record("limit clamped to <=10 items returned", (res.body?.items ?? []).length <= 10, `items=${res.body?.items?.length}`);
    expect((res.body?.items ?? []).length).toBeLessThanOrEqual(10);
  });

  it("6. entity wildcard prefix matches the probe via 'prefix*'", async () => {
    // Use first half of the entity name + `*` to force wildcard match.
    const prefix = ENTITY.slice(0, 14) + "*";
    const res = await req("GET", `/api/admin/audit-log?entity=${encodeURIComponent(prefix)}`);
    record("wildcard prefix 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    const items = res.body?.items ?? [];
    const found = items.some((a) => a.entity === ENTITY);
    record("wildcard returned the probe row", found, `len ${items.length}`);
    expect(found).toBe(true);
  });

  it("7. tenant-scoped verifier returns ok for the probe's tenant chain", async () => {
    // Probe entity is `co_v2541_audit_<stamp>` → resolveTenantId returns
    // `tenant_co_v2541_audit_<stamp>`, a fresh isolated chain.
    const res = await req("GET", `/api/admin/audit-log/verify?entity=${encodeURIComponent(ENTITY)}`);
    record("verify by-entity 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("chain ok for probe tenant", res.body?.ok === true, `ok=${res.body?.ok} scope=${res.body?.scope}`);
    expect(res.body?.ok).toBe(true);
    record("scope is tenant:* form", String(res.body?.scope ?? "").startsWith("tenant:"), String(res.body?.scope));
    expect(String(res.body?.scope ?? "").startsWith("tenant:")).toBe(true);
  });

  it("7b. verifier response shape NEVER returns scope='unavailable' with ok=true", async () => {
    // v25.41 round-3 R3 (per GPT-5.5): fail-closed contract assertion.
    // The verifier endpoint MUST NOT advertise ok:true when it could not
    // actually verify (SOC 2 CC7.2). Even on the happy path, scope must be
    // `tenant:<id>` or `all-tenants`, never `unavailable` paired with ok:true.
    const [r1, r2] = await Promise.all([
      req("GET", `/api/admin/audit-log/verify?entity=${encodeURIComponent(ENTITY)}`),
      req("GET", "/api/admin/audit-log/verify"),
    ]);
    for (const res of [r1, r2]) {
      const isUnavailable = res.body?.scope === "unavailable" || res.body?.error === "db_unavailable";
      const failClosed = !isUnavailable || res.body?.ok === false;
      record("verifier fail-closed contract", failClosed, `scope=${res.body?.scope} ok=${res.body?.ok}`);
      expect(failClosed).toBe(true);
      if (isUnavailable) {
        // If it IS unavailable, the HTTP status must reflect server error.
        record("unavailable verifier returns 503", res.status === 503, `status=${res.status}`);
        expect(res.status).toBe(503);
      }
    }
  });

  it("8. whole-platform verifier returns per-tenant array (per-tenant validity may vary by data set)", async () => {
    // The all-tenants verifier returns a per-tenant array of {ok, brokenAt,
    // totalLinks}. We assert the SHAPE is correct and that the probe's own
    // tenant is present and ok. We deliberately do NOT assert `overall ok`
    // because the shared `tenant_platform` chain may contain rows from prior
    // tests/seeds whose validity is not under v25.41's control — that's
    // exactly the kind of historical-data signal the per-tenant view is
    // designed to surface to the admin.
    const res = await req("GET", "/api/admin/audit-log/verify");
    record("verify all-tenants 200", res.status === 200, `status ${res.status}`);
    expect(res.status).toBe(200);
    record("perTenant array present", Array.isArray(res.body?.perTenant), `len=${res.body?.perTenant?.length}`);
    expect(Array.isArray(res.body?.perTenant)).toBe(true);
    const probeTenantId = `tenant_${ENTITY.split("_").slice(0, 2).join("_")}_${ENTITY.split("_").slice(2).join("_")}`;
    // Construct expected tenantId directly: tenant_<entity> when entity starts with co_<id>
    const expectedTenant = `tenant_${ENTITY}`;
    const probeChain = (res.body?.perTenant ?? []).find((t) => t.tenantId === expectedTenant);
    record("probe tenant present in perTenant array", !!probeChain, `expected=${expectedTenant} got=${probeChain?.tenantId}`);
    expect(!!probeChain).toBe(true);
    record("probe tenant chain is ok", probeChain?.ok === true, `ok=${probeChain?.ok}`);
    expect(probeChain?.ok).toBe(true);
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.41 audit-log DB-backed E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});

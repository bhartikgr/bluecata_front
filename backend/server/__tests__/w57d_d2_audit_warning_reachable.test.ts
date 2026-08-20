/**
 * WAVE 57d · D2 — `X-Audit-Warning` WAS DEAD CODE. THIS PROVES IT NOW FIRES.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * `appendAudit()` (server/adminPlatformStore.ts) catches its own DB write
 * failure, logs `AUDIT_DB_WRITE_FAILED`, and RETURNS NORMALLY with an empty-hash
 * sentinel — by design, because unconditionally throwing would crash the many
 * call sites that are not wrapped in try/catch (v25.23 NH-J). Wave 57c then added
 * five `X-Audit-Warning` paths, all of them inside `catch` blocks, and NO caller
 * inspected the sentinel. Result: every one of those warning paths was
 * unreachable — written in five places, executed in none. All three independent
 * 57c reviews found this; Review 3 §1.2 put it exactly right: "not merely
 * untested — unreachable", including in production.
 *
 * ── WHAT 57d CHANGES, AND WHAT IT DELIBERATELY DOES NOT ────────────────────
 * `isAuditWriteFailure(entry)` names the sentinel, and the call sites check it.
 * That is the whole fix (~5 lines each). It makes audit failure **VISIBLE**.
 * It does NOT make any path fail-closed: every destructive operation below still
 * completes when the audit cannot be written. That trade-off is unchanged on
 * purpose — see the comment on `isAuditWriteFailure` and Review 3 §1.1.
 *
 * ── HOW THE FAILURE IS INDUCED (this is the load-bearing part) ─────────────
 * The `audit_log` table is RENAMED out of the way for the duration of one
 * request, so the writer's transaction really fails inside `appendAudit` and the
 * real sentinel is really returned. Nothing is stubbed, spied or monkey-patched,
 * and the assertion is made on the HTTP RESPONSE HEADER of a real request through
 * the real `registerRoutes(...)` registration — never by calling the store
 * directly. The table is renamed back in the same test, and a control request
 * afterwards proves audit writing recovered (so a broken restore cannot leave a
 * false green behind it).
 *
 * MUTATION TRANSCRIPT: build_log/wave57d/W57D_TESTS.md (M2).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import { isAuditWriteFailure, appendAdminAudit } from "../adminPlatformStore";

const COMPANY_A = "co_arboreal";
const FOUNDER_A = "u_maya_chen";
const ADMIN = "u_admin";

const PNG_WHITE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  "base64",
);

let app: Express;
let server: http.Server;

/** Run `fn` with the audit_log table renamed away, so every audit write fails.
 *  Restored in `finally` even if the assertion throws. */
async function withUnwritableAuditLog<T>(fn: () => Promise<T>): Promise<T> {
  const db = rawDb();
  db.exec(`ALTER TABLE audit_log RENAME TO audit_log_w57d_offline`);
  try {
    return await fn();
  } finally {
    db.exec(`ALTER TABLE audit_log_w57d_offline RENAME TO audit_log`);
  }
}

beforeAll(async () => {
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W57d D2 — the audit-write failure sentinel is detectable", () => {
  it("UNIT: the sentinel predicate recognises the empty-hash entry and accepts a real one", () => {
    const real = appendAdminAudit(ADMIN, "platform", "w57d.d2.probe", { probe: true });
    expect(real.hash).toHaveLength(64);
    expect(isAuditWriteFailure(real)).toBe(false);
    expect(isAuditWriteFailure({ ...real, hash: "" })).toBe(true);
    expect(isAuditWriteFailure(null)).toBe(true);
    expect(isAuditWriteFailure(undefined)).toBe(true);
  });

  it("the writer really returns the empty-hash sentinel (and does NOT throw) when audit_log is unwritable", async () => {
    await withUnwritableAuditLog(async () => {
      const entry = appendAdminAudit(ADMIN, "platform", "w57d.d2.probe.failing", { probe: true });
      // The contract 57c relied on — a throw — does not happen. This is the bug.
      expect(entry.hash).toBe("");
      expect(entry.priorHash).toBe("");
      expect(isAuditWriteFailure(entry)).toBe(true);
    });
  });
});

describe("W57d D2 — X-Audit-Warning fires over real HTTP when the audit row cannot be written", () => {
  it("POST /api/founder/company/:id/logo sets X-Audit-Warning, and the upload still succeeds (fail-OPEN, visibly)", async () => {
    const clean = await request(app)
      .post(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", FOUNDER_A)
      .attach("logo", PNG_WHITE, { filename: "logo.png", contentType: "image/png" });
    expect(clean.status).toBe(200);
    expect(clean.headers["x-audit-warning"]).toBeUndefined();

    const degraded = await withUnwritableAuditLog(async () =>
      request(app)
        .post(`/api/founder/company/${COMPANY_A}/logo`)
        .set("x-user-id", FOUNDER_A)
        .attach("logo", PNG_WHITE, { filename: "logo.png", contentType: "image/png" }),
    );
    // VISIBLE …
    expect(degraded.headers["x-audit-warning"]).toBe("audit_log_write_failed");
    // … and still fail-OPEN, which is the honest description of the behaviour.
    expect(degraded.status).toBe(200);
    expect(degraded.body).toMatchObject({ ok: true });

    // CONTROL: the restore worked, so the green above is not a stuck state.
    const recovered = await request(app)
      .post(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", FOUNDER_A)
      .attach("logo", PNG_WHITE, { filename: "logo.png", contentType: "image/png" });
    expect(recovered.status).toBe(200);
    expect(recovered.headers["x-audit-warning"]).toBeUndefined();
  });

  it("DELETE /api/founder/company/:id/logo sets X-Audit-Warning, and the delete still happens", async () => {
    expect(
      (
        await request(app)
          .post(`/api/founder/company/${COMPANY_A}/logo`)
          .set("x-user-id", FOUNDER_A)
          .attach("logo", PNG_WHITE, { filename: "logo.png", contentType: "image/png" })
      ).status,
    ).toBe(200);

    const degraded = await withUnwritableAuditLog(async () =>
      request(app).delete(`/api/founder/company/${COMPANY_A}/logo`).set("x-user-id", FOUNDER_A),
    );
    expect(degraded.headers["x-audit-warning"]).toBe("audit_log_write_failed");
    expect(degraded.status).toBe(200);
    expect(degraded.body).toMatchObject({ ok: true, deleted: true });
    // The bytes really are gone — the destructive half was NOT rolled back.
    const after = await request(app)
      .get(`/api/founder/company/${COMPANY_A}/logo`)
      .set("x-user-id", FOUNDER_A);
    expect(after.status).toBe(404);
  });

  it("POST /api/admin/users/bulk sets X-Audit-Warning when neither the batch nor the per-id rows can be written", async () => {
    const ids = ["u_daniel_okafor"];
    const clean = await request(app)
      .post("/api/admin/users/bulk")
      .set("x-user-id", ADMIN)
      .send({ action: "unsuspend", ids, confirmCount: 1 });
    expect(clean.status).toBe(200);
    expect(clean.headers["x-audit-warning"]).toBeUndefined();

    const degraded = await withUnwritableAuditLog(async () =>
      request(app)
        .post("/api/admin/users/bulk")
        .set("x-user-id", ADMIN)
        .send({ action: "unsuspend", ids, confirmCount: 1 }),
    );
    expect(degraded.headers["x-audit-warning"]).toBe("audit_log_write_failed");
    expect(degraded.status).toBe(200);
    expect(degraded.body).toMatchObject({ ok: true, action: "unsuspend" });
  });

  it("DELETE /api/admin/compliance-hold/:tenantId sets X-Audit-Warning, and the hold is still released (identity fail-closed, audit fail-open)", async () => {
    const TENANT = "tenant_w57d_d2_probe";
    const set = await request(app)
      .post("/api/admin/compliance-hold")
      .set("x-user-id", ADMIN)
      .send({ tenantId: TENANT, on: true, reason: "W57d D2 probe" });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ ok: true, held: true });

    const degraded = await withUnwritableAuditLog(async () =>
      request(app).delete(`/api/admin/compliance-hold/${TENANT}`).set("x-user-id", ADMIN),
    );
    expect(degraded.headers["x-audit-warning"]).toBe("audit_log_write_failed");
    expect(degraded.status).toBe(200);
    expect(degraded.body).toMatchObject({ ok: true, held: false });
  });
});

/**
 * slide13b WAVE D — D-B2 + D-B3 (core early review, WAVE_D_CORE_EARLY_REVIEW_SOL.md).
 *
 * D-B2 — every mutation's audit payload is a self-contained before/after record:
 *   `{ action, namespace, value, old, new }`, built from the row as read INSIDE
 *   the transaction. Parsed from `audit_log.payload_json`, not from a return
 *   value. Rejected (409/400/404) and no-op mutations leave NO audit row.
 *
 * D-B3 — the OUTER COMMIT can fail after `appendAdminAudit` returned success.
 *   The audit writer pushes into its in-memory read mirror as soon as ITS
 *   savepoint releases, so without reconciliation the admin audit page's
 *   DB-failure fallback would present a rolled-back event as durable. Proof
 *   here uses a REAL commit failure: inside the transaction, after the audit
 *   append, the test seam inserts a row that violates a DEFERRABLE INITIALLY
 *   DEFERRED foreign key, so SQLite rejects the COMMIT itself. Asserted:
 *   no taxonomy row, no audit DB row, no mirror entry, other mirror entries
 *   untouched, and the connection is out of the transaction.
 *
 * Real audit writer (no module mock). In-memory SQLite (NODE_ENV=test).
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

import { rawDb } from "../db/connection";
import { getAuditLog } from "../adminPlatformStore";
import { registerCompanyTaxonomyRoutes } from "../companyTaxonomyRoutes";
import {
  __setAfterAuditHookForTests,
  createTaxonomyTerm,
  reactivateTaxonomyTerm,
  retireTaxonomyTerm,
  updateTaxonomyTermLabel,
} from "../companyTaxonomyStore";

const NS = "company_sector";
const ACTOR = { actor: "u_admin" };
let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerCompanyTaxonomyRoutes(app);
  // Warm the bootstrap so the first mutation below is not also the installer.
  createTaxonomyTerm(NS, { value: "Forensics Warmup" }, ACTOR);
});
afterEach(() => __setAfterAuditHookForTests(null));

type AuditRow = { actor_id: string; action: string; target: string; payload_json: string; hash: string };
function auditRows(value: string): AuditRow[] {
  return rawDb()
    .prepare(`SELECT actor_id, action, target, payload_json, hash FROM audit_log WHERE target = ? ORDER BY created_at, id`)
    .all(`taxonomy_term:${NS}:${value}`) as AuditRow[];
}
function payloadOf(r: AuditRow) { return JSON.parse(r.payload_json) as Record<string, unknown>; }
function row(value: string) {
  return rawDb().prepare(`SELECT value, label, active, sort_order FROM taxonomy_terms WHERE namespace=? AND value=?`).get(NS, value) as
    | { value: string; label: string; active: number; sort_order: number } | undefined;
}

describe("D-B2 · audit payloads carry old/new mutable state", () => {
  const V = "Forensic Sector";

  it("create: old:null, new:{label, active:true}", () => {
    createTaxonomyTerm(NS, { value: V, label: "Forensic Sector" }, ACTOR);
    const rows = auditRows(V);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("company_taxonomy.term.create");
    expect(rows[0].actor_id).toBe("u_admin");
    expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
    const p = payloadOf(rows[0]);
    expect(p).toMatchObject({ action: "company_taxonomy.term.create", namespace: NS, value: V, old: null });
    expect(p.new).toMatchObject({ label: "Forensic Sector", active: true });
    expect((p.new as { sort_order: number }).sort_order).toBe(row(V)!.sort_order);
  });

  it("relabel: old.label → new.label, value unchanged in the payload and in the row", () => {
    updateTaxonomyTermLabel(NS, V, "Forensic Sector (renamed)", ACTOR);
    const rows = auditRows(V);
    expect(rows).toHaveLength(2);
    expect(rows[1].action).toBe("company_taxonomy.term.relabel");
    expect(payloadOf(rows[1])).toEqual({
      action: "company_taxonomy.term.relabel", namespace: NS, value: V,
      old: { label: "Forensic Sector" }, new: { label: "Forensic Sector (renamed)" },
    });
    expect(row(V)).toMatchObject({ value: V, label: "Forensic Sector (renamed)" });
  });

  it("retire: old.active true → new.active false", () => {
    retireTaxonomyTerm(NS, V, ACTOR);
    const rows = auditRows(V);
    expect(rows).toHaveLength(3);
    expect(payloadOf(rows[2])).toEqual({
      action: "company_taxonomy.term.retire", namespace: NS, value: V,
      old: { active: true }, new: { active: false },
    });
  });

  it("reactivate: old.active false → new.active true", () => {
    reactivateTaxonomyTerm(NS, V, ACTOR);
    const rows = auditRows(V);
    expect(rows).toHaveLength(4);
    expect(payloadOf(rows[3])).toEqual({
      action: "company_taxonomy.term.reactivate", namespace: NS, value: V,
      old: { active: false }, new: { active: true },
    });
  });

  it("rejected and no-op mutations write NO audit row (409 duplicate value / label, 409 already-in-state, 400 empty, 404 unknown)", async () => {
    const before = auditRows(V).length;
    const beforeAll = (rawDb().prepare(`SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'company_taxonomy.%'`).get() as { n: number }).n;
    const h = (r: request.Test) => r.set("x-user-id", "u_admin");
    expect((await h(request(app).post(`/api/admin/company-taxonomy/${NS}/terms`)).send({ value: V })).status).toBe(409);
    expect((await h(request(app).post(`/api/admin/company-taxonomy/${NS}/terms`)).send({ value: "Other", label: "forensic sector (RENAMED)" })).status).toBe(409);
    expect((await h(request(app).post(`/api/admin/company-taxonomy/${NS}/terms/reactivate`)).send({ value: V })).status).toBe(409);
    expect((await h(request(app).post(`/api/admin/company-taxonomy/${NS}/terms`)).send({ value: "   " })).status).toBe(400);
    expect((await h(request(app).post(`/api/admin/company-taxonomy/${NS}/terms/label`)).send({ value: "Nope", label: "x" })).status).toBe(404);
    expect((await h(request(app).post(`/api/admin/company-taxonomy/${NS}/terms/retire`)).send({ value: "Nope" })).status).toBe(404);
    expect(auditRows(V).length).toBe(before);
    expect((rawDb().prepare(`SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'company_taxonomy.%'`).get() as { n: number }).n).toBe(beforeAll);
    expect(row("Other")).toBeUndefined();
  });
});

describe("D-B3 · outer COMMIT failure after a successful audit append", () => {
  const V = "Commit Failure Probe";

  function armRealCommitFailure() {
    const db = rawDb();
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    db.exec(`CREATE TABLE IF NOT EXISTS _t_db3_parent (id INTEGER PRIMARY KEY)`);
    db.exec(`CREATE TABLE IF NOT EXISTS _t_db3_child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES _t_db3_parent(id) DEFERRABLE INITIALLY DEFERRED)`);
    // Runs INSIDE the taxonomy transaction, AFTER appendAdminAudit returned a
    // real entry. The violating child row is accepted now and rejected by the
    // COMMIT itself ("FOREIGN KEY constraint failed").
    __setAfterAuditHookForTests(() => {
      db.prepare(`INSERT INTO _t_db3_child (parent_id) VALUES (?)`).run(999_999);
    });
  }

  it("create: DB row, audit DB row and audit MIRROR entry are all absent; other mirror entries untouched; connection idle", () => {
    const mirror = getAuditLog();
    const mirrorBefore = mirror.length;
    const mirrorIdsBefore = mirror.map((e) => e.id);
    const auditDbBefore = (rawDb().prepare(`SELECT COUNT(*) n FROM audit_log`).get() as { n: number }).n;
    armRealCommitFailure();

    let err: unknown;
    try { createTaxonomyTerm(NS, { value: V }, ACTOR); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).toMatch(/FOREIGN KEY constraint failed/);

    expect(rawDb().inTransaction).toBe(false);
    expect(row(V)).toBeUndefined();                                   // taxonomy row rolled back
    expect(auditRows(V)).toHaveLength(0);                             // audit DB row rolled back
    expect((rawDb().prepare(`SELECT COUNT(*) n FROM audit_log`).get() as { n: number }).n).toBe(auditDbBefore);
    expect(mirror.some((e) => e.entity === `taxonomy_term:${NS}:${V}`)).toBe(false); // mirror reconciled
    expect(mirror.length).toBe(mirrorBefore);
    expect(mirror.map((e) => e.id)).toEqual(mirrorIdsBefore);         // nothing else removed / reordered
    expect((rawDb().prepare(`SELECT COUNT(*) n FROM _t_db3_child`).get() as { n: number }).n).toBe(0);
  });

  it("retire: same guarantees; the term stays ACTIVE", () => {
    const mirror = getAuditLog();
    const mirrorBefore = mirror.length;
    expect(row("Energy")?.active).toBe(1);
    armRealCommitFailure();
    expect(() => retireTaxonomyTerm(NS, "Energy", ACTOR)).toThrow(/FOREIGN KEY constraint failed/);
    expect(rawDb().inTransaction).toBe(false);
    expect(row("Energy")?.active).toBe(1);
    expect(auditRows("Energy").filter((r) => r.action === "company_taxonomy.term.retire")).toHaveLength(0);
    expect(mirror.some((e) => e.entity === `taxonomy_term:${NS}:Energy` && e.eventType === "company_taxonomy.term.retire")).toBe(false);
    expect(mirror.length).toBe(mirrorBefore);
  });

  it("HTTP: the failure surfaces as a 5xx with ok:false — never a 2xx for a rolled-back mutation", async () => {
    armRealCommitFailure();
    const r = await request(app).post(`/api/admin/company-taxonomy/${NS}/terms`).set("x-user-id", "u_admin").send({ value: `${V} HTTP` });
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.body.ok).toBe(false);
    expect(row(`${V} HTTP`)).toBeUndefined();
    expect(getAuditLog().some((e) => e.entity === `taxonomy_term:${NS}:${V} HTTP`)).toBe(false);
  });

  it("control: with the seam disarmed the same create commits — row, audit DB row AND mirror entry present", () => {
    const mirror = getAuditLog();
    const before = mirror.length;
    createTaxonomyTerm(NS, { value: V }, ACTOR);
    expect(row(V)).toMatchObject({ value: V, active: 1 });
    expect(auditRows(V)).toHaveLength(1);
    expect(mirror.length).toBe(before + 1);
    expect(mirror[mirror.length - 1]).toMatchObject({ entity: `taxonomy_term:${NS}:${V}`, eventType: "company_taxonomy.term.create", hash: auditRows(V)[0].hash });
  });
});

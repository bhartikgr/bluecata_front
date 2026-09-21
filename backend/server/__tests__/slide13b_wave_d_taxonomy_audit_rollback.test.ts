/**
 * slide13b WAVE D — a mutation whose audit row cannot be written is ROLLED
 * BACK. "Fail-closed durable outcome": no audit row ⇒ no term row.
 *
 * Own file: the audit writer is module-mocked to return the empty-hash
 * sentinel (exactly what adminPlatformStore.appendAudit returns on a DB
 * write failure) for ONE call, then delegates to the real writer. The store
 * checks `isAuditWriteFailure` INSIDE its SQLite transaction and throws, so
 * better-sqlite3 rolls the INSERT/UPDATE back. Then the real writer is used
 * to prove the same mutation commits when the audit succeeds.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

let failNext = 0;
vi.mock("../adminPlatformStore", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../adminPlatformStore")>();
  return {
    ...mod,
    appendAdminAudit: (...args: Parameters<typeof mod.appendAdminAudit>) => {
      if (failNext > 0) {
        failNext -= 1;
        // The documented sentinel: hash === "" never occurs on a real write.
        return { ...mod.appendAdminAudit(args[0], "taxonomy_sentinel:probe", "company_taxonomy.sentinel", {}), hash: "" };
      }
      return mod.appendAdminAudit(...args);
    },
  };
});

import { rawDb } from "../db/connection";
import { registerCompanyTaxonomyRoutes } from "../companyTaxonomyRoutes";
import { createTaxonomyTerm, retireTaxonomyTerm, TaxonomyAuditWriteError } from "../companyTaxonomyStore";

const NS = "company_sector";
let app: Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerCompanyTaxonomyRoutes(app);
});

function rowFor(value: string) {
  return rawDb().prepare(`SELECT value, label, active FROM taxonomy_terms WHERE namespace = ? AND value = ?`).get(NS, value) as
    | { value: string; label: string; active: number }
    | undefined;
}
function auditCount(action: string, value: string): number {
  return (rawDb().prepare(`SELECT COUNT(*) n FROM audit_log WHERE action = ? AND target = ?`).get(action, `taxonomy_term:${NS}:${value}`) as { n: number }).n;
}

describe("audit sentinel ⇒ rollback", () => {
  it("store: create with failing audit throws AUDIT_WRITE_FAILED and leaves NO row", () => {
    failNext = 1;
    expect(() => createTaxonomyTerm(NS, { value: "Rollback Probe" }, { actor: "u_admin" }))
      .toThrow(TaxonomyAuditWriteError);
    expect(rowFor("Rollback Probe")).toBeUndefined();
    expect(auditCount("company_taxonomy.term.create", "Rollback Probe")).toBe(0);
  });

  it("store: retire with failing audit leaves the term ACTIVE", () => {
    expect(rowFor("Energy")?.active).toBe(1);
    failNext = 1;
    expect(() => retireTaxonomyTerm(NS, "Energy", { actor: "u_admin" })).toThrow(TaxonomyAuditWriteError);
    expect(rowFor("Energy")?.active).toBe(1);
    expect(auditCount("company_taxonomy.term.retire", "Energy")).toBe(0);
  });

  it("HTTP: 500 AUDIT_WRITE_FAILED with durable:false; the term is absent from every list", async () => {
    failNext = 1;
    const r = await request(app).post(`/api/admin/company-taxonomy/${NS}/terms`).set("x-user-id", "u_admin").send({ value: "HTTP Rollback Probe" });
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, error: "AUDIT_WRITE_FAILED", durable: false });
    const all = await request(app).get(`/api/admin/company-taxonomy/${NS}?includeRetired=1`).set("x-user-id", "u_admin");
    expect(all.body.terms.some((t: { value: string }) => t.value === "HTTP Rollback Probe")).toBe(false);
    expect(rowFor("HTTP Rollback Probe")).toBeUndefined();
  });

  it("control: the same create commits when the audit write succeeds — row AND audit row both present", async () => {
    expect(failNext).toBe(0);
    const r = await request(app).post(`/api/admin/company-taxonomy/${NS}/terms`).set("x-user-id", "u_admin").send({ value: "Rollback Probe" });
    expect(r.status).toBe(201);
    expect(rowFor("Rollback Probe")).toEqual({ value: "Rollback Probe", label: "Rollback Probe", active: 1 });
    expect(auditCount("company_taxonomy.term.create", "Rollback Probe")).toBe(1);
  });
});

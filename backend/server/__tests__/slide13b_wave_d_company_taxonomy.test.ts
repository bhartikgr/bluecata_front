/**
 * slide13b WAVE D — DB-backed company-sector taxonomy: migration, store, API.
 *
 * Runs against the ordinary `:memory:` SQLite handle (NODE_ENV=test). Never
 * touches data.db. Positive AND negative paths over REAL HTTP (supertest) and
 * the REAL store; the only thing faked is the `x-user-id` header the Vitest
 * bypass already honours (userContext.ts).
 *
 * Companion files (isolated module state on purpose):
 *   slide13b_wave_d_taxonomy_bootstrap_failclosed.test.ts  — retry + fail-closed
 *   slide13b_wave_d_taxonomy_audit_rollback.test.ts       — audit sentinel → rollback
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { rawDb } from "../db/connection";
import { registerCompanyTaxonomyRoutes } from "../companyTaxonomyRoutes";
import {
  listTaxonomyTerms,
  TAXONOMY_ORDER_BY,
  __resetCompanyTaxonomyBootstrapForTests,
  ensureCompanyTaxonomySchema,
} from "../companyTaxonomyStore";
import { applyCompanyTaxonomySchema } from "../lib/applyCompanyTaxonomySchema";
import { COLLECTIVE_SECTORS_45, COLLECTIVE_STAGES } from "../../shared/schema";
import { INDUSTRY_OPTIONS } from "../../client/src/lib/profile/data/enums";
import { compareTaxonomyTerms, mergeTaxonomyOptions } from "../../shared/companyTaxonomy";
import { createTaxonomyTerm, retireTaxonomyTerm } from "../companyTaxonomyStore";

const ADMIN = "u_admin";
const FOUNDER = "u_maya_chen"; // isAdmin: false
const NS = "company_sector";
const PUB = `/api/company-taxonomy/${NS}`;
const ADM = `/api/admin/company-taxonomy/${NS}`;

let app: Express;

const asAdmin = (r: request.Test) => r.set("x-user-id", ADMIN);
const asFounder = (r: request.Test) => r.set("x-user-id", FOUNDER);

/** Sandbox mode maps a header-less request to a demo persona. The production
 *  posture (no session → anonymous) is reproduced with DISABLE_DEV_BYPASS=1,
 *  the same switch userContext.ts honours (resolvePersonaIdWithFallback). */
async function anonymous<T>(fn: () => Promise<T>): Promise<T> {
  vi.stubEnv("DISABLE_DEV_BYPASS", "1");
  try {
    return await fn();
  } finally {
    vi.unstubAllEnvs();
  }
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerCompanyTaxonomyRoutes(app);
});

/* ── D1 · migration ─────────────────────────────────────────────────────── */

describe("D1 · migration 0236", () => {
  const a = path.join(process.cwd(), "migrations", "0236_company_taxonomy.sql");
  const b = path.join(process.cwd(), "server", "db", "migrations", "0236_company_taxonomy.sql");

  it("exists in BOTH trees and the mirrors are byte-identical", () => {
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    expect(fs.readFileSync(a)).toEqual(fs.readFileSync(b));
  });

  it("carries the SQLite dialect statement and does not claim PostgreSQL", () => {
    const sql = fs.readFileSync(a, "utf8");
    expect(sql).toMatch(/DIALECT: SQLite/);
    expect(sql).toMatch(/no PG support is claimed/);
  });

  it("no other 0236_* migration collides in either tree", () => {
    for (const dir of ["migrations", path.join("server", "db", "migrations")]) {
      const hits = fs.readdirSync(path.join(process.cwd(), dir)).filter((f) => f.startsWith("0236_"));
      expect(hits).toEqual(["0236_company_taxonomy.sql"]);
    }
  });

  it("seeds EXACTLY the 45 COLLECTIVE_SECTORS_45 values (value == label, all active) on a fresh DB", () => {
    ensureCompanyTaxonomySchema();
    const rows = rawDb()
      .prepare(`SELECT value, label, active FROM taxonomy_terms WHERE namespace = ?`)
      .all(NS) as Array<{ value: string; label: string; active: number }>;
    expect(rows.length).toBe(45);
    expect(new Set(rows.map((r) => r.value))).toEqual(new Set(COLLECTIVE_SECTORS_45));
    for (const r of rows) {
      expect(r.label).toBe(r.value);
      expect(r.active).toBe(1);
    }
  });

  it("re-applying the migration preserves admin edits (idempotent seed, no overwrite)", () => {
    rawDb()
      .prepare(`UPDATE taxonomy_terms SET label = 'Financial Technology', active = 0 WHERE namespace = ? AND value = 'Fintech'`)
      .run(NS);
    const sql = fs.readFileSync(a, "utf8");
    rawDb().exec(sql);
    const row = rawDb()
      .prepare(`SELECT label, active FROM taxonomy_terms WHERE namespace = ? AND value = 'Fintech'`)
      .get(NS) as { label: string; active: number };
    expect(row).toEqual({ label: "Financial Technology", active: 0 });
    expect(
      (rawDb().prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace = ?`).get(NS) as { n: number }).n,
    ).toBe(45);
    // restore for the rest of the file
    rawDb()
      .prepare(`UPDATE taxonomy_terms SET label = 'Fintech', active = 1 WHERE namespace = ? AND value = 'Fintech'`)
      .run(NS);
  });

  it("the DB itself rejects a case-insensitive duplicate label", () => {
    expect(() =>
      rawDb()
        .prepare(`INSERT INTO taxonomy_terms (namespace, value, label, created_at, updated_at) VALUES (?, 'x_fintech', 'FINTECH', 't', 't')`)
        .run(NS),
    ).toThrow(/UNIQUE/);
  });

  it("apply-or-verify against the already-migrated handle reports applied:false and seed 45/45", () => {
    __resetCompanyTaxonomyBootstrapForTests();
    const r = applyCompanyTaxonomySchema(rawDb());
    expect(r.applied).toBe(false);
    expect(r.seed).toEqual({ present: 45, expected: 45 });
  });
});

/* ── D2 · read contract ─────────────────────────────────────────────────── */

describe("D2 · read contract", () => {
  it("store read is alphabetical by label (case-insensitive), NOT seed order", () => {
    expect(TAXONOMY_ORDER_BY).toBe("ORDER BY label COLLATE NOCASE, label, value");
    const terms = listTaxonomyTerms(NS);
    expect(terms.length).toBe(45);
    const labels = terms.map((t) => t.label);
    const expected = [...terms].sort(compareTaxonomyTerms).map((t) => t.label);
    expect(labels).toEqual(expected);
    // The seed order starts "Fintech"; alphabetical starts "Aerospace & Defense".
    expect(COLLECTIVE_SECTORS_45[0]).toBe("Fintech");
    expect(labels[0]).toBe("Aerospace & Defense");
    expect(labels[labels.length - 1]).toBe("Wealthtech");
  });

  it("GET public list requires auth (401 anonymous) and serves 45 active terms to a non-admin", async () => {
    const anon = await anonymous(() => request(app).get(PUB));
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("UNAUTHORIZED");
    const r = await asFounder(request(app).get(PUB));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.namespace).toBe(NS);
    expect(r.body.dialect).toBe("sqlite");
    expect(r.body.includesRetired).toBe(false);
    expect(r.body.terms).toHaveLength(45);
    expect(r.body.terms.every((t: { active: boolean }) => t.active)).toBe(true);
  });

  it("public GET ?includeRetired=1 returns retired rows WITH active:false (for labelling held values); default stays active-only", async () => {
    createTaxonomyTerm(NS, { value: "Public Retired Probe" }, { actor: "u_admin" });
    retireTaxonomyTerm(NS, "Public Retired Probe", { actor: "u_admin" });
    const def = await request(app).get(`/api/company-taxonomy/${NS}`).set("x-user-id", "u_maya_chen");
    expect(def.status).toBe(200);
    expect(def.body.includesRetired).toBe(false);
    expect(def.body.terms.some((t: { value: string }) => t.value === "Public Retired Probe")).toBe(false);
    expect(def.body.terms.every((t: { active: boolean }) => t.active === true)).toBe(true);
    const all = await request(app).get(`/api/company-taxonomy/${NS}?includeRetired=1`).set("x-user-id", "u_maya_chen");
    expect(all.status).toBe(200);
    expect(all.body.includesRetired).toBe(true);
    const probe = all.body.terms.find((t: { value: string }) => t.value === "Public Retired Probe");
    expect(probe).toMatchObject({ value: "Public Retired Probe", active: false });
    // consumer contract on top of that payload: retired is LABELLED when held, never offered otherwise
    const merged = mergeTaxonomyOptions(all.body.terms, ["Public Retired Probe"]);
    expect(merged.find((o) => o.value === "Public Retired Probe")?.kind).toBe("retired");
    expect(mergeTaxonomyOptions(all.body.terms, []).some((o) => o.value === "Public Retired Probe")).toBe(false);
    // (anonymous 401 for this route is covered above with DISABLE_DEV_BYPASS stubbed)
  });

  it("unknown namespace → 404 TAXONOMY_NOT_FOUND (never an empty 200)", async () => {
    const r = await asFounder(request(app).get(`/api/company-taxonomy/industry`));
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("TAXONOMY_NOT_FOUND");
    expect(r.body.code).toBe("UNKNOWN_NAMESPACE");
  });
});

/* ── D2 · admin authz ───────────────────────────────────────────────────── */

describe("D2 · admin authorization", () => {
  it("admin routes: 401 anonymous, 403 non-admin, 200 admin", async () => {
    expect((await anonymous(() => request(app).get(ADM))).status).toBe(401);
    expect((await anonymous(() => request(app).post(`${ADM}/terms`).send({ value: "Anon" }))).status).toBe(401);
    const f = await asFounder(request(app).get(ADM));
    expect(f.status).toBe(403);
    expect(f.body.error).toBe("ADMIN_REQUIRED");
    expect((await asAdmin(request(app).get(ADM))).status).toBe(200);
  });

  it("non-admin cannot mutate (403) and nothing is written", async () => {
    const before = (rawDb().prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace = ?`).get(NS) as { n: number }).n;
    const r = await asFounder(request(app).post(`${ADM}/terms`).send({ value: "Quantum" }));
    expect(r.status).toBe(403);
    const after = (rawDb().prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace = ?`).get(NS) as { n: number }).n;
    expect(after).toBe(before);
  });
});

/* ── D2 · mutations, audit, immutability ────────────────────────────────── */

function auditRows(action: string, target: string): Array<{ actor_id: string; payload_json: string }> {
  return rawDb()
    .prepare(`SELECT actor_id, payload_json FROM audit_log WHERE action = ? AND target = ?`)
    .all(action, target) as Array<{ actor_id: string; payload_json: string }>;
}

describe("D2 · secure, audited mutations", () => {
  it("create → 201, appears in public list alphabetically, audit row is durable", async () => {
    const r = await asAdmin(request(app).post(`${ADM}/terms`).send({ value: "Quantum Computing" }));
    expect(r.status).toBe(201);
    expect(r.body.term).toMatchObject({ value: "Quantum Computing", label: "Quantum Computing", active: true });

    const pub = await asFounder(request(app).get(PUB));
    const labels = pub.body.terms.map((t: { label: string }) => t.label);
    expect(labels).toHaveLength(46);
    const i = labels.indexOf("Quantum Computing");
    expect(i).toBeGreaterThan(0);
    expect(labels[i - 1].toLowerCase() < "quantum computing").toBe(true);
    expect(labels[i + 1].toLowerCase() > "quantum computing").toBe(true);

    const audit = auditRows("company_taxonomy.term.create", `taxonomy_term:${NS}:Quantum Computing`);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].payload_json)).toMatchObject({ namespace: NS, value: "Quantum Computing" });
  });

  it("create rejects: duplicate value (409), case-insensitive duplicate label (409), empty (400), too long (400)", async () => {
    const dupV = await asAdmin(request(app).post(`${ADM}/terms`).send({ value: "Fintech" }));
    expect(dupV.status).toBe(409);
    expect(dupV.body.code).toBe("VALUE_EXISTS");

    const dupL = await asAdmin(request(app).post(`${ADM}/terms`).send({ value: "fintech_v2", label: "FINTECH" }));
    expect(dupL.status).toBe(409);
    expect(dupL.body.code).toBe("LABEL_EXISTS");

    const empty = await asAdmin(request(app).post(`${ADM}/terms`).send({ value: "   " }));
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("VALUE_REQUIRED");

    const long = await asAdmin(request(app).post(`${ADM}/terms`).send({ value: "x".repeat(81) }));
    expect(long.status).toBe(400);
    expect(long.body.code).toBe("VALUE_TOO_LONG");

    // none of the rejected writes left a row or an audit entry
    expect(
      (rawDb().prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace = ? AND value IN ('fintech_v2','   ')`).get(NS) as { n: number }).n,
    ).toBe(0);
    expect(auditRows("company_taxonomy.term.create", `taxonomy_term:${NS}:fintech_v2`)).toHaveLength(0);
  });

  it("relabel edits the LABEL only — stored VALUE is immutable and there is no rename route", async () => {
    const r = await asAdmin(request(app).post(`${ADM}/terms/label`).send({ value: "Crypto / Web3", label: "Web3 & Digital Assets" }));
    expect(r.status).toBe(200);
    expect(r.body.term).toMatchObject({ value: "Crypto / Web3", label: "Web3 & Digital Assets" });
    const row = rawDb().prepare(`SELECT value, label FROM taxonomy_terms WHERE namespace = ? AND value = 'Crypto / Web3'`).get(NS);
    expect(row).toEqual({ value: "Crypto / Web3", label: "Web3 & Digital Assets" });
    expect(auditRows("company_taxonomy.term.relabel", `taxonomy_term:${NS}:Crypto / Web3`)).toHaveLength(1);

    // value-with-slash travels in the body; no path variant exists for it
    const noRoute = await asAdmin(request(app).patch(`${ADM}/terms/${encodeURIComponent("Crypto / Web3")}`).send({ value: "renamed" }));
    expect(noRoute.status).toBe(404);

    // relabel to an existing label (different case) is refused
    const clash = await asAdmin(request(app).post(`${ADM}/terms/label`).send({ value: "Crypto / Web3", label: "energy" }));
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe("LABEL_EXISTS");

    // relabel of an unknown value → 404
    const nf = await asAdmin(request(app).post(`${ADM}/terms/label`).send({ value: "Nope", label: "X" }));
    expect(nf.status).toBe(404);
    expect(nf.body.code).toBe("TERM_NOT_FOUND");
  });

  it("retire hides from the public list, keeps the row, is idempotent-refused, and reactivate restores", async () => {
    const ret = await asAdmin(request(app).post(`${ADM}/terms/retire`).send({ value: "Pharma" }));
    expect(ret.status).toBe(200);
    expect(ret.body.term.active).toBe(false);

    const pub = await asFounder(request(app).get(PUB));
    expect(pub.body.terms.some((t: { value: string }) => t.value === "Pharma")).toBe(false);

    const adm = await asAdmin(request(app).get(`${ADM}?includeRetired=1`));
    expect(adm.body.includesRetired).toBe(true);
    expect(adm.body.terms.find((t: { value: string }) => t.value === "Pharma")).toMatchObject({ active: false });

    const admActiveOnly = await asAdmin(request(app).get(ADM));
    expect(admActiveOnly.body.terms.some((t: { value: string }) => t.value === "Pharma")).toBe(false);

    const again = await asAdmin(request(app).post(`${ADM}/terms/retire`).send({ value: "Pharma" }));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_IN_STATE");

    expect(auditRows("company_taxonomy.term.retire", `taxonomy_term:${NS}:Pharma`)).toHaveLength(1);

    const re = await asAdmin(request(app).post(`${ADM}/terms/reactivate`).send({ value: "Pharma" }));
    expect(re.status).toBe(200);
    expect(re.body.term.active).toBe(true);
    expect(auditRows("company_taxonomy.term.reactivate", `taxonomy_term:${NS}:Pharma`)).toHaveLength(1);

    const pub2 = await asFounder(request(app).get(PUB));
    expect(pub2.body.terms.some((t: { value: string }) => t.value === "Pharma")).toBe(true);
  });

  it("the audit actor is the admin persona, never u_unknown_admin", async () => {
    const rows = rawDb()
      .prepare(`SELECT DISTINCT actor_id FROM audit_log WHERE action LIKE 'company_taxonomy.%'`)
      .all() as Array<{ actor_id: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.actor_id).not.toBe("u_unknown_admin");
  });
});

/* ── consumer helper contract ───────────────────────────────────────────── */

describe("consumer contract · mergeTaxonomyOptions", () => {
  it("union of active terms + held retired/custom values; held values are never dropped", () => {
    const all = listTaxonomyTerms(NS, { includeRetired: true });
    const active = all.filter((t) => t.active);
    const held = ["Fintech", "Deep-Sea Robotics", "Pharma"];
    // retire Pharma in the input set only (pure function)
    const withRetired = all.map((t) => (t.value === "Pharma" ? { ...t, active: false } : t));
    const opts = mergeTaxonomyOptions(withRetired, held);
    expect(opts.filter((o) => o.kind === "active").length).toBe(active.length - 1);
    expect(opts.find((o) => o.value === "Fintech")?.kind).toBe("active");
    expect(opts.find((o) => o.value === "Pharma")?.kind).toBe("retired");
    expect(opts.find((o) => o.value === "Deep-Sea Robotics")?.kind).toBe("custom");
    // with only active terms in hand, a retired held value is reported as custom, still present
    const opts2 = mergeTaxonomyOptions(withRetired.filter((t) => t.active), held);
    expect(opts2.find((o) => o.value === "Pharma")?.kind).toBe("custom");
  });
});

/* ── out-of-scope invariants (R91 / spec) ───────────────────────────────── */

describe("out of scope — untouched", () => {
  it("INDUSTRY_OPTIONS still has 48 entries and is not in taxonomy_terms", () => {
    expect(INDUSTRY_OPTIONS.length).toBe(48);
    const n = (rawDb().prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace = 'industry'`).get() as { n: number }).n;
    expect(n).toBe(0);
  });
  it("COLLECTIVE_STAGES order is unchanged (R91) and not in taxonomy_terms", () => {
    expect([...COLLECTIVE_STAGES]).toEqual(["Pre-Seed", "Seed", "Series A", "Series B", "Series C+", "Growth", "Late Stage"]);
    const n = (rawDb().prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace = 'stage'`).get() as { n: number }).n;
    expect(n).toBe(0);
  });
  it("partner_sectors (0149) is a different table and is untouched by this wave", () => {
    const names = (rawDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('partner_sectors','taxonomy_terms')`).all() as Array<{ name: string }>).map((r) => r.name).sort();
    expect(names).toContain("taxonomy_terms");
    expect(
      (rawDb().prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace LIKE 'partner%'`).get() as { n: number }).n,
    ).toBe(0);
  });
});

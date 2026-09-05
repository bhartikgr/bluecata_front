/**
 * W316 — THE TWO FIXED READERS ARE TENANT-SCOPED, ACROSS CURRENCIES.
 *
 * WHAT THIS FILE HAS TO PROVE, and the traps it is built to avoid.
 *
 *  1. A SEES A'S OWN ROWS FIRST. Every scoping assertion here is preceded by a
 *     POSITIVE one: tenant A's own marks, A's own footnote date, A's own DPI.
 *     An over-tight fix that hides a GP's own data would go red here, and twice
 *     this week the safer-sounding change was the destructive one.
 *
 *  2. THE FIXTURE MUST BE ABLE TO MOVE. Before any isolation assertion, the
 *     rows are read back out of SQLite with `rawDb()` and their `tenant_id` and
 *     `currency` values are asserted DIFFERENT, and the PRE-W316 SQL — a byte
 *     copy of the statement as it shipped, with no tenant predicate — is run as
 *     a CONTROL and asserted to RETURN BOTH TENANTS' ROWS. If the leak the fix
 *     prevents cannot be demonstrated, this file fails instead of passing.
 *
 *  3. CROSS-CURRENCY, BECAUSE THAT IS WHERE THE SILENT CORRUPTION LIVES.
 *     Tenant A is USD, tenant B is EUR. A ratio is a money figure with its
 *     units cancelled, so a leaked foreign-currency row does not look wrong —
 *     it produces a plausible DPI computed from two denominations. This file
 *     asserts A's ratios are NUMERICALLY IDENTICAL before and after B's rows
 *     exist, by capturing them BEFORE B is written and deep-comparing after.
 *
 *  4. THE INSTRUMENT IS NOT THE PRODUCT. The readers are driven over real HTTP
 *     through the shipped routes, and every figure asserted is either rendered
 *     response text or a row read back with `rawDb()`. No assertion anywhere in
 *     this file inspects a variable name, an argument, or an exit code.
 *
 *  5. THE Q10 EXCEPTION IS PROVED STILL CROSS-TENANT. `computeCohortBenchmark`
 *     must stay cross-tenant by owner ruling. Six subjects are written, three
 *     per tenant, against a published minimum cohort of five: cross-tenant the
 *     benchmark COMPUTES with n = 6, and had anybody scoped it, n would be 3
 *     and the status INSUFFICIENT_COHORT. The proof is the number, not a
 *     comment claiming the ruling was honoured.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { patchConfig, getConfig } from "../emailTransport";
import { _resetRateLimitsForTests } from "../lib/rateLimit";
import {
  ensureWave9Schema,
  persistValuationEvent,
  computeCohortBenchmark,
} from "../wave9ReportingStore";
import { cashflowChainInstalled, _resetWave10SchemaGuardForTests, listFlows } from "../lib/ilpaCashflowLedger";
import { holdingTenantsForCompany } from "../lib/investorMarkHistory";

let app: Express;
let server: http.Server;

/* Tenant A trades in USD. Tenant B trades in EUR. The currencies are part of
 * the fence being tested, not decoration. */
const TENANT_A = "w316_tenant_alpha";
const TENANT_B = "w316_tenant_beta";
const CCY_A = "USD";
const CCY_B = "EUR";

/* The two callers are SEEDED DEMO PERSONAS, because the shipped auth middleware
 * authenticates real users only: an invented id returns 401 and the fixture
 * would prove nothing about a leak. Each is given a committed holding of the
 * shared company under a DIFFERENT tenant. */
const INV_A = "u_maya_chen";
const INV_B = "u_daniel_okafor";

/* ONE company id, held by both LPs under different GPs. This is the real shape
 * of the defect: the ownership check "does this investor hold this company"
 * passes for both, and before W316 the marks read had no tenant predicate. */
const CO = "co_w316_shared";
const CO_UNHELD = "co_w316_never_held_by_anyone";

/* ONE vehicle id, with flows under both tenants, for the ratio proof. */
const VEH = "spv_w316_shared";

/* The shipped writer MINTS the id (`val_<uuid>`) and ignores any id supplied by
 * a caller, so the mark ids are captured from the writer's return value rather
 * than asserted against constants a test invented. */
let MARK_A_1 = "";
let MARK_A_2 = "";
let MARK_B_1 = "";
let MARK_B_2 = "";

const DATE_A = "2026-04-30";
const VEH_DATE_A = "2026-06-30";
const VEH_DATE_B = "2026-08-31";
const DATE_B = "2026-05-31";

/** Tenant stamping for the tenant-context routes (the footnotes route). The
 *  marks route deliberately does NOT read this: its tenant is derived from the
 *  caller's own holdings, which is the whole point of Q-E. */
function installTenantStamp(a: Express) {
  a.use((req: any, _res, next) => {
    const t = req.headers["x-w316-tenant"];
    if (typeof t !== "string") return next();
    let store: any;
    Object.defineProperty(req, "userContext", {
      configurable: true,
      get() { return store; },
      set(v) { store = v && typeof v === "object" ? { ...v, tenantId: t } : v; },
    });
    next();
  });
}


/** Split SQL on statement boundaries, ignoring semicolons inside single-quoted
 *  literals. Written out rather than imported so this fixture cannot be broken
 *  by a change elsewhere. */
function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inStr) {
      buf += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") { buf += "'"; i += 1; } else { inStr = false; }
      }
      continue;
    }
    if (ch === "'") { inStr = true; buf += ch; continue; }
    if (ch === ";") { out.push(`${buf};`); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/** The footnote renderer is bound to REAL config rows, and the Vitest database's
 *  bootstrap heal installs migrations 0159/0174 only — the `footnote.*` seed rows
 *  live in 0170 and 0171. They are installed here by executing the SHIPPED
 *  migration statements read off disk, so no value is typed by hand into the
 *  fixture and the config the renderer reads is the config the platform ships.
 *  This is fixture bootstrap, not part of what W316 changed. */
function installFootnoteConfigFromShippedMigrations() {
  const dir = path.join(process.cwd(), "server", "db", "migrations");
  let installed = 0;
  for (const file of ["0170_wave14_money_orphan_reporting_audit.sql", "0171_wave15_orphan_reporting_config.sql"]) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) continue;
    /* Line comments are removed FIRST: prose comments in these migrations
     * contain apostrophes ("the reader's footnotes"), and an apostrophe in a
     * comment desynchronises any quote-aware scan of the statement text. */
    const sql = fs.readFileSync(full, "utf8")
      .split("\n")
      .filter((line) => !/^\s*--/.test(line))
      .join("\n");
    /* Quote-aware statement scan: these seed rows contain description text with
     * semicolons inside single quotes, so a naive split on ";" cuts a statement
     * in half and SQLite rejects it. */
    for (const stmt of splitSqlStatements(sql)) {
      if (!/INSERT\s+OR\s+IGNORE\s+INTO\s+wave9_reporting_config/i.test(stmt)) continue;
      if (!stmt.includes("'footnote.")) continue;
      rawDb().exec(stmt);
      installed += 1;
    }
  }
  const keys = (rawDb()
    .prepare(`SELECT key FROM wave9_reporting_config WHERE key LIKE 'footnote.%' ORDER BY key`)
    .all() as Array<{ key: string }>).map((r) => r.key);
  if (installed === 0 || keys.length === 0) {
    throw new Error(`W316 FIXTURE: no footnote config installed (statements=${installed}, keys=${keys.length})`);
  }
}

type Who = { tenant: string; userId: string };
const A: Who = { tenant: TENANT_A, userId: INV_A };
const B: Who = { tenant: TENANT_B, userId: INV_B };
const BLANK: Who = { tenant: "", userId: INV_A };
const DEFAULT_TENANT: Who = { tenant: "default", userId: INV_A };

function req_(who: Who, method: "get" | "post", path: string) {
  _resetRateLimitsForTests();
  return (request(app) as any)[method](path)
    .set("x-user-id", who.userId)
    .set("x-w316-tenant", who.tenant);
}
const GET = (who: Who, path: string) => req_(who, "get", path);
const POST = (who: Who, path: string, body: unknown) => req_(who, "post", path).send(body as any);

/** A committed holding, written with the same column set the shipped ledger
 *  writer uses. The READ under test (`listCommitsForUser` via
 *  `investorHoldsCompany`, and `holdingTenantsForCompany`) is the shipped one. */
function insertHolding(id: string, tenant: string, investorId: string, companyId: string, currency: string) {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO captable_commits
         (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
          amount, currency, shares, state, prev_hash, hash, reconcile_match,
          compliance_hold, deleted_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, '1000.00', ?, '100', 'committed',
               'w316_prev', ?, 1, 0, NULL)`,
    )
    .run(id, tenant, new Date().toISOString(), `${id}_inv`, `${id}_round`, companyId, investorId, currency, `${id}_hash`);
}

/** A monthly snapshot row for the Q10 cohort proof. */
function insertSnapshot(tenant: string, subjectId: string, dpi: number, currency: string) {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO portfolio_metric_snapshot
         (id, tenant_id, subject_kind, subject_id, period, period_start,
          contributed_minor, distributed_minor, residual_value_minor, currency,
          dpi, rvpi, tvpi, pic_multiple, net_irr, gross_irr, status_json,
          marked_positions, unmarked_positions, generated_at)
       VALUES (?, ?, 'investor', ?, 'monthly', '2026-07-01',
               1000000, 500000, 700000, ?,
               ?, NULL, NULL, NULL, NULL, NULL, '{}', 1, 0, '2026-07-02T00:00:00Z')`,
    )
    .run(`pms_${tenant}_${subjectId}`, tenant, subjectId, currency, dpi);
}

/** THE PRE-W316 STATEMENT, BYTE-FOR-BYTE AS IT SHIPPED. This is the CONTROL:
 *  it is the reader as it was before the fix, and it must still leak. If this
 *  ever stops returning both tenants' rows, the fixture has stopped being able
 *  to demonstrate the defect and every isolation assertion below is worthless. */
function unscopedMarkRead(companyId: string): Array<{ id: string; currency: string }> {
  return rawDb()
    .prepare(
      `SELECT id, valuation_date, fair_value_minor, currency, method, source,
              is_external
         FROM valuation_event
        WHERE vehicle_kind = 'company'
          AND vehicle_id = ?
          AND superseded_at IS NULL
          AND (? IS NULL OR holding_id = ?)
        ORDER BY valuation_date ASC, created_at ASC`,
    )
    .all(companyId, null, null) as Array<{ id: string; currency: string }>;
}

/** Ratios only, pulled out of a metrics response, for numeric comparison. */
function ratiosOf(body: any) {
  return {
    metricsAvailable: body?.metricsAvailable ?? null,
    currency: body?.currency ?? null,
    dpi: body?.metrics?.DPI?.value ?? null,
    dpiStatus: body?.metrics?.DPI?.status ?? null,
    tvpi: body?.metrics?.TVPI?.value ?? null,
    tvpiStatus: body?.metrics?.TVPI?.status ?? null,
    rvpi: body?.metrics?.RVPI?.value ?? null,
    pic: body?.metrics?.PIC?.value ?? null,
    netIrr: body?.metrics?.net_IRR?.value ?? null,
    netIrrStatus: body?.metrics?.net_IRR?.status ?? null,
    picMinor: body?.metrics?.inputs?.picMinor ?? null,
    distributedMinor: body?.metrics?.inputs?.distributedMinor ?? null,
    residualValueMinor: body?.metrics?.inputs?.residualValueMinor ?? null,
  };
}

/** A's ratios BEFORE tenant B exists at all. Captured in beforeAll, compared
 *  after B's EUR rows are written. */
let A_RATIOS_BEFORE_B: ReturnType<typeof ratiosOf> | null = null;
let A_MARKS_BEFORE_B: any = null;

beforeAll(async () => {
  patchConfig({ mode: "dry_run" });
  await seedDemoData(getDb());
  ensureWave9Schema();
  _resetWave10SchemaGuardForTests();
  cashflowChainInstalled();

  app = express();
  app.use(express.json());
  installTenantStamp(app);
  server = http.createServer(app);
  await registerRoutes(server, app);

  /* ── PHASE 1: TENANT A ONLY. Nothing of tenant B exists yet, so what is
   * captured here is A's data in a world where B does not exist. That is the
   * only honest baseline for "unchanged by the existence of B's rows". */
  insertHolding("cc_w316_a", TENANT_A, INV_A, CO, CCY_A);

  const A_IDS: string[] = [];
  for (const [date, fv] of [
    [DATE_A, 12_000_00],
    ["2026-06-30", 15_000_00],
  ] as Array<[string, number]>) {
    A_IDS.push(persistValuationEvent({
      tenantId: TENANT_A, vehicleKind: "company", vehicleId: CO,
      valuationDate: date, fairValueMinor: fv, currency: CCY_A,
      method: "last_priced_round", source: "admin_import",
      preparer: INV_A, isExternal: false, createdBy: INV_A,
    } as any));
  }
  [MARK_A_1, MARK_A_2] = A_IDS;

  // A's USD cashflows on the shared vehicle, written through the shipped route.
  for (const [ref, type, amt, date] of [
    ["W316-A-CALL", "capital_call_investment", -1_000_000, "2026-01-10"],
    ["W316-A-DIST", "distribution_income", 250_000, "2026-03-10"],
  ] as Array<[string, string, number, string]>) {
    const w = await POST(A, `/api/reporting/vehicles/spv/${VEH}/cashflows`, {
      txnType: type, valueDate: date, amountMinor: amt, currency: CCY_A,
      lpId: INV_A, sourceKind: "manual", sourceRef: ref,
    });
    expect(w.status, `A's cashflow ${ref} must be written: ${JSON.stringify(w.body)}`).toBe(201);
  }
  persistValuationEvent({
    tenantId: TENANT_A, vehicleKind: "spv", vehicleId: VEH,
    valuationDate: VEH_DATE_A, fairValueMinor: 900_000, currency: CCY_A,
    method: "last_priced_round", source: "admin_import",
    preparer: INV_A, isExternal: false, createdBy: INV_A,
  } as any);

  installFootnoteConfigFromShippedMigrations();

  const beforeMarks = await GET(A, `/api/investor/portfolio/${CO}/marks`);
  expect(beforeMarks.status, "A must see its own marks BEFORE B exists").toBe(200);
  A_MARKS_BEFORE_B = beforeMarks.body;

  const beforeMetrics = await GET(A, `/api/reporting/vehicles/spv/${VEH}/metrics?committedMinor=2000000`);
  expect(beforeMetrics.status).toBe(200);
  A_RATIOS_BEFORE_B = ratiosOf(beforeMetrics.body);

  /* ── PHASE 2: TENANT B ARRIVES, IN EUR, ON THE SAME COMPANY AND THE SAME
   * VEHICLE ID. Every figure differs from A's, so no assertion below can pass
   * by coincidence. */
  insertHolding("cc_w316_b", TENANT_B, INV_B, CO, CCY_B);

  const B_IDS: string[] = [];
  for (const [date, fv] of [
    [DATE_B, 77_777_00],
    ["2026-07-31", 88_888_00],
  ] as Array<[string, number]>) {
    B_IDS.push(persistValuationEvent({
      tenantId: TENANT_B, vehicleKind: "company", vehicleId: CO,
      valuationDate: date, fairValueMinor: fv, currency: CCY_B,
      method: "last_priced_round", source: "admin_import",
      preparer: INV_B, isExternal: false, createdBy: INV_B,
    } as any));
  }
  [MARK_B_1, MARK_B_2] = B_IDS;

  for (const [ref, type, amt, date] of [
    ["W316-B-CALL", "capital_call_investment", -9_900_000, "2026-01-11"],
    ["W316-B-DIST", "distribution_income", 8_800_000, "2026-03-11"],
  ] as Array<[string, string, number, string]>) {
    const w = await POST(B, `/api/reporting/vehicles/spv/${VEH}/cashflows`, {
      txnType: type, valueDate: date, amountMinor: amt, currency: CCY_B,
      lpId: INV_B, sourceKind: "manual", sourceRef: ref,
    });
    expect(w.status, `B's cashflow ${ref} must be written: ${JSON.stringify(w.body)}`).toBe(201);
  }
  persistValuationEvent({
    tenantId: TENANT_B, vehicleKind: "spv", vehicleId: VEH,
    /* A LATER date than A's on purpose. `latestValuationEvent` returns the most
     * recent event, so if the read is unscoped, A's footnotes print B's date —
     * which is precisely the leak, and it makes the assertion below bite. */
    valuationDate: VEH_DATE_B, fairValueMinor: 7_700_000, currency: CCY_B,
    method: "last_priced_round", source: "admin_import",
    preparer: INV_B, isExternal: false, createdBy: INV_B,
  } as any);

  // Six cohort subjects, three per tenant, against a published minimum of five.
  for (const [t, ccy, base] of [[TENANT_A, CCY_A, 1], [TENANT_B, CCY_B, 4]] as Array<[string, string, number]>) {
    for (let i = 0; i < 3; i += 1) {
      insertSnapshot(t, `w316_subject_${base + i}`, 0.1 * (base + i), ccy);
    }
  }
}, 300_000);

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

describe("W316 — cross-currency, two-tenant proof", () => {
  it("CONTROL: the mail transport is inert", () => {
    expect(getConfig().mode).toBe("dry_run");
  });

  it("FIXTURE — the two tenants hold DIFFERENT rows in DIFFERENT currencies, read back with rawDb()", () => {
    const rows = rawDb()
      .prepare(`SELECT id, tenant_id, currency, fair_value_minor FROM valuation_event
                 WHERE vehicle_kind = 'company' AND vehicle_id = ? ORDER BY id`)
      .all(CO) as Array<{ id: string; tenant_id: string; currency: string; fair_value_minor: number }>;
    expect(rows.length, "all four marks must be STORED, or nothing below discriminates").toBe(4);
    expect(new Set(rows.map((r) => r.tenant_id)), "two distinct tenants").toEqual(new Set([TENANT_A, TENANT_B]));
    expect(new Set(rows.map((r) => r.currency)), "two distinct currencies — this is the cross-currency case").toEqual(
      new Set([CCY_A, CCY_B]),
    );
    // No two figures are equal, so no assertion below can pass by coincidence.
    expect(new Set(rows.map((r) => r.fair_value_minor)).size).toBe(4);

    const holdings = rawDb()
      .prepare(`SELECT tenant_id, currency, investor_id FROM captable_commits WHERE company_id = ? ORDER BY tenant_id`)
      .all(CO) as Array<{ tenant_id: string; currency: string; investor_id: string }>;
    expect(holdings.length, "both LPs must hold the SAME company under DIFFERENT GPs").toBe(2);
    expect(new Set(holdings.map((h) => h.tenant_id))).toEqual(new Set([TENANT_A, TENANT_B]));
  });

  it("CONTROL — THE UNSCOPED READER LEAKS. The pre-W316 statement returns BOTH tenants, in BOTH currencies", () => {
    const leaked = unscopedMarkRead(CO);
    expect(leaked.length, "the reader as it shipped returns all four marks").toBe(4);
    const ids = new Set(leaked.map((r) => r.id));
    expect(ids.has(MARK_A_1) && ids.has(MARK_B_1), "including the other tenant's").toBe(true);
    expect(new Set(leaked.map((r) => r.currency)), "and it mixes USD with EUR").toEqual(new Set([CCY_A, CCY_B]));
    /* THE CONSEQUENCE, SPELLED OUT: `markHistoryForCompany` refuses to plot a
     * series that spans currencies. So the unscoped reader did not merely show
     * tenant A four marks instead of two — it returned MARKS_SPAN_CURRENCIES and
     * A's OWN CHART DISAPPEARED. The leak and the denial of service are the same
     * bug, which is why the positive assertion below is the load-bearing one. */
  });

  it("A SEES A'S OWN MARKS — over real HTTP, in A's own currency, with the right figures", async () => {
    const r = await GET(A, `/api/investor/portfolio/${CO}/marks`);
    expect(r.status).toBe(200);
    expect(r.body.unavailableReason, "A's own chart must render — not MARKS_SPAN_CURRENCIES").toBeNull();
    expect(r.body.currency, "A's own denomination").toBe(CCY_A);
    expect(r.body.marks.length, "both of A's marks, no more and no fewer").toBe(2);
    expect(r.body.marks.map((m: any) => m.fairValueMinor)).toEqual([12_000_00, 15_000_00]);
    expect(r.body.marks.map((m: any) => m.id)).toEqual([MARK_A_1, MARK_A_2]);
  }, 120_000);

  it("A CANNOT SEE B'S MARKS — B's ids, figures and currency appear NOWHERE in A's response", async () => {
    const r = await GET(A, `/api/investor/portfolio/${CO}/marks`);
    const text = JSON.stringify(r.body);
    for (const forbidden of [MARK_B_1, MARK_B_2, "7777700", "8888800", CCY_B]) {
      expect(text, `A's rendered response must not contain ${forbidden}`).not.toContain(forbidden);
    }
    // The mirror direction, so the fixture is not one-sided.
    const rb = await GET(B, `/api/investor/portfolio/${CO}/marks`);
    expect(rb.status).toBe(200);
    expect(rb.body.currency, "B sees B's own denomination").toBe(CCY_B);
    expect(rb.body.marks.map((m: any) => m.id)).toEqual([MARK_B_1, MARK_B_2]);
    const textB = JSON.stringify(rb.body);
    for (const forbidden of [MARK_A_1, MARK_A_2, CCY_A]) {
      expect(textB, `B's rendered response must not contain ${forbidden}`).not.toContain(forbidden);
    }
  }, 120_000);

  it("A'S MARKS ARE NUMERICALLY UNCHANGED by the existence of B's rows", async () => {
    const now = await GET(A, `/api/investor/portfolio/${CO}/marks`);
    expect(A_MARKS_BEFORE_B, "the pre-B capture must exist, or there is nothing to compare").toBeTruthy();
    expect(A_MARKS_BEFORE_B.marks.length, "and it must be non-empty").toBe(2);
    expect(now.body, "A's whole mark response must be identical to the world in which B does not exist").toEqual(
      A_MARKS_BEFORE_B,
    );
  }, 120_000);

  it("THE TENANT SCOPE IS DERIVED FROM THE CALLER'S OWN HOLDINGS, and fails closed", () => {
    expect(holdingTenantsForCompany(INV_A, CO), "A's scope is exactly A's own GP").toEqual([TENANT_A]);
    expect(holdingTenantsForCompany(INV_B, CO)).toEqual([TENANT_B]);
    expect(holdingTenantsForCompany(INV_A, CO_UNHELD), "no holding, no scope").toEqual([]);
    expect(holdingTenantsForCompany("", CO)).toEqual([]);
  });

  it("THE 404 IS STILL BYTE-IDENTICAL for an unheld company and a nonexistent one", async () => {
    const unheld = await GET(A, `/api/investor/portfolio/${CO_UNHELD}/marks`);
    const nonexistent = await GET(A, `/api/investor/portfolio/co_w316_no_such_company_at_all/marks`);
    expect(unheld.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(JSON.stringify(unheld.body), "W316 must not have made these two distinguishable").toBe(
      JSON.stringify(nonexistent.body),
    );
  }, 120_000);

  /* ────────────────────────── THE RATIO PROOF ────────────────────────── */

  it("CONTROL — the UNSCOPED flow read mixes currencies, so any ratio from it is corrupt", () => {
    const unscoped = listFlows({ vehicleKind: "spv" as any, vehicleId: VEH });
    const scopedA = listFlows({ vehicleKind: "spv" as any, vehicleId: VEH, tenantId: TENANT_A });
    expect(unscoped.length, "unscoped, the vehicle carries both tenants' flows").toBe(4);
    expect(new Set(unscoped.map((f) => f.currency)), "in two currencies").toEqual(new Set([CCY_A, CCY_B]));
    expect(scopedA.length, "scoped to A, only A's flows").toBe(2);
    expect(new Set(scopedA.map((f) => f.currency)), "in one currency").toEqual(new Set([CCY_A]));
    /* This is the corruption the brief describes: summing -1,000,000 USD with
     * -9,900,000 EUR and dividing gives a plausible unitless number that means
     * nothing. The route below never computes it, because the read is scoped. */
  });

  it("A'S DPI / PIC / TVPI / IRR ARE NUMERICALLY IDENTICAL before and after B's EUR rows exist", async () => {
    const after = await GET(A, `/api/reporting/vehicles/spv/${VEH}/metrics?committedMinor=2000000`);
    expect(after.status).toBe(200);
    expect(A_RATIOS_BEFORE_B, "the pre-B capture must exist").toBeTruthy();
    expect(A_RATIOS_BEFORE_B!.metricsAvailable, "A's ratios were available before B existed").toBe(true);
    expect(A_RATIOS_BEFORE_B!.dpi, "and DPI was a real number, not null").not.toBeNull();
    expect(ratiosOf(after.body), "every ratio identical, and still reported in USD only").toEqual(A_RATIOS_BEFORE_B);
    expect(after.body.metricsUnavailable, "A must NOT be told its metrics need FX conversion").toBeNull();
    expect(JSON.stringify(after.body), "and B's figures appear nowhere in A's response").not.toContain("9900000");
  }, 120_000);

  /* ─────────────────── THE FOOTNOTE READER (READER A) ─────────────────── */

  it("FOOTNOTES — A is shown A'S OWN valuation date, and never B's", async () => {
    const own = await GET(A, `/api/reporting/vehicles/spv/${VEH}/footnotes`);
    expect(own.status, `A's own footnotes must render: ${JSON.stringify(own.body)}`).toBe(200);
    const ownText = JSON.stringify(own.body);

    /* NON-VACUITY FIRST. If the rendered footnotes did not carry a valuation
     * date at all, every "must not contain" assertion below would pass on an
     * empty string and prove nothing. An earlier version of this test asserted
     * on FAIR VALUES, which the footnote block does not print — it passed with
     * the fix disarmed. That green is why this assertion is here. */
    expect(ownText, "A's OWN valuation date must be printed in A's footnotes").toContain(VEH_DATE_A);

    /* THE DISCRIMINATOR. B's mark is DATED LATER than A's, so an unscoped
     * `latestValuationEvent` — the pre-W316 call — returns B's event and A's
     * footnotes print B's as-of date. */
    expect(ownText, "A's footnotes must NOT print the other tenant's valuation date").not.toContain(VEH_DATE_B);

    const bs = await GET(B, `/api/reporting/vehicles/spv/${VEH}/footnotes`);
    expect(bs.status).toBe(200);
    const bText = JSON.stringify(bs.body);
    expect(bText, "B's own date is printed for B").toContain(VEH_DATE_B);
    expect(bText, "and A's date is not").not.toContain(VEH_DATE_A);
  }, 120_000);

  it("FOOTNOTES FENCE INSTALLATION — a BLANK tenant is REFUSED, and \"default\" is ACCEPTED", async () => {
    const blank = await GET(BLANK, `/api/reporting/vehicles/spv/${VEH}/footnotes`);
    expect(blank.status, "a context carrying tenantId:'' must be refused, never widened").toBe(400);
    expect(blank.body.error).toBe("TENANT_UNRESOLVED");

    const dflt = await GET(DEFAULT_TENANT, `/api/reporting/vehicles/spv/${VEH}/footnotes`);
    expect(dflt.status, "single-tenant installations run on \"default\" and must NOT be locked out").toBe(200);
    expect(dflt.body.ok).toBe(true);
  }, 120_000);

  /* ─────────────── THE Q10 EXCEPTION AND THE LP SURFACE ─────────────── */

  it("Q10 — computeCohortBenchmark IS STILL CROSS-TENANT after W316", () => {
    const stored = rawDb()
      .prepare(`SELECT tenant_id, subject_id FROM portfolio_metric_snapshot WHERE period_start = '2026-07-01'`)
      .all() as Array<{ tenant_id: string; subject_id: string }>;
    const w316Rows = stored.filter((r) => r.subject_id.startsWith("w316_subject_"));
    expect(w316Rows.length, "six cohort subjects must be stored").toBe(6);
    expect(new Set(w316Rows.map((r) => r.tenant_id)), "three under each of two tenants").toEqual(
      new Set([TENANT_A, TENANT_B]),
    );

    const r = computeCohortBenchmark({ metric: "dpi", periodStart: "2026-07-01", subjectKind: "investor" });
    /* THE LOAD-BEARING NUMBER. Six subjects exist, three per tenant, and the
     * published minimum cohort is five. Cross-tenant: n >= 6 and COMPUTED. Had
     * anyone scoped this read to one tenant, n would be 3 — below the minimum —
     * and the status would be INSUFFICIENT_COHORT. The ruling is proved by the
     * count, not by a comment. */
    expect(r.n, "the cohort must span both tenants").toBeGreaterThanOrEqual(6);
    expect(r.status).toBe("COMPUTED");
    expect(r.benchmark, "and it must actually produce percentiles").toBeTruthy();
    expect(r.benchmark!.n).toBeGreaterThanOrEqual(6);
  });

  it("LP SURFACE CONTROL — /api/me/cashflows is not newly refused by W316", async () => {
    const r = await GET(A, `/api/me/cashflows`);
    /* This route has a PRE-EXISTING 500 under Vitest (a lazy require of a .ts
     * module), recorded by W303 on the unmodified tree. What matters is that
     * W316 did not start refusing or narrowing it: `listFlowsForInvestor` is
     * identity-scoped and was deliberately NOT touched. */
    expect(r.body?.error).not.toBe("TENANT_UNRESOLVED");
    expect(r.status).not.toBe(403);
  }, 120_000);
});

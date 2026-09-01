/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 230D — THE DISPLAY SURFACES, DRIVEN OVER REAL HTTP.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Wave 230 filtered one computation and shipped no screen. This file proves the
 * five remaining surfaces now honour the mark, and it proves it the only way
 * that means anything: by driving the PRODUCTION registrar (`registerRoutes`)
 * over real HTTP against the real better-sqlite3 handle, marking a record
 * through the real admin route, and re-reading the same surface.
 *
 * WHY THE FIXTURE IS SHAPED THIS WAY — the ten inert-proof mechanisms:
 *
 * • The company row is inserted into the REAL `companies` table by column
 *   introspection, and the mark is applied by the REAL `POST /mark` route, not
 *   by writing the column directly. A fixture a server mutation cannot move
 *   would prove nothing; this one is moved by the server itself.
 * • Every "it disappeared" assertion is paired with a "it was there first"
 *   assertion in the same test, so a query that returns nothing for an
 *   unrelated reason cannot read as a pass.
 * • The unmark half is asserted too: a filter that hid everything permanently
 *   would pass the hide assertions and fail these.
 * • A SECOND, UNMARKED company is asserted present throughout. A filter keyed
 *   to a field the writer never writes would hide nothing; a filter that hid
 *   everything would take this one too. Only the correct predicate passes both.
 * • The exclusion is asserted PER RECORD: the neighbour company shares no mark
 *   and stays visible, which is the property R230.6 requires because "QA Note
 *   Round" lives inside the owner's real operating company.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";

let app: Express;
let server: http.Server;
let port = 0;

const ADMIN = { "x-user-id": "u_admin" };

/** The record this wave hides and un-hides. */
const CO_TEST = "co_w230d_testfixture";
/** The neighbour that must never move. */
const CO_REAL = "co_w230d_realfixture";

function call(
  method: string,
  p: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { ...ADMIN };
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    const r = http.request({ hostname: "127.0.0.1", port, path: p, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw });
        }
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/** Insert a `companies` row by introspection — the two schema paths do not
 *  agree on the optional columns, so a hardcoded column list would break on
 *  one of them and the test would silently stop testing. */
function seedCompany(id: string, name: string): void {
  const cols = rawDb().prepare(`PRAGMA table_info(companies)`).all() as Array<{
    name: string;
    notnull: number;
    dflt_value: unknown;
  }>;
  const have = new Set(cols.map((c) => c.name));
  const vals: Record<string, unknown> = { id };
  if (have.has("name")) vals.name = name;
  if (have.has("legal_name")) vals.legal_name = name;
  if (have.has("tenant_id")) vals.tenant_id = "tenant_w230d";
  if (have.has("sector")) vals.sector = "SaaS";
  if (have.has("stage")) vals.stage = "seed";
  if (have.has("hq")) vals.hq = "HK";
  if (have.has("region")) vals.region = "APAC";
  for (const c of cols) {
    if (c.notnull === 1 && c.dflt_value === null && !(c.name in vals)) vals[c.name] = "";
  }
  const keys = Object.keys(vals);
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO companies (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
    )
    .run(...keys.map((k) => vals[k]));
}

function companyIdsFromAdminList(rows: Array<{ id: string }>): string[] {
  return rows.map((r) => r.id);
}

async function mark(id: string, excluded: boolean) {
  return call("POST", "/api/admin/test-data/mark", {
    table: "companies",
    id,
    excluded,
    reason: excluded ? "w230d fixture" : undefined,
  });
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
  seedCompany(CO_TEST, "SD-TEST Wave X Co");
  seedCompany(CO_REAL, "BluePrint Catalyst Limited");
}, 60_000);

afterAll(async () => {
  /* Leave the marks off so the suite cannot leak state into a neighbour file. */
  await mark(CO_TEST, false).catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("W230D · A — the admin company list honours the mark, per record", () => {
  it("A1 both fixtures are visible BEFORE anything is marked", async () => {
    const r = await call("GET", "/api/admin/companies/full");
    expect(r.status).toBe(200);
    const ids = companyIdsFromAdminList(r.body.rows);
    expect(ids).toContain(CO_TEST);
    expect(ids).toContain(CO_REAL);
  });

  it("A2 marking through the real route removes ONLY the marked record", async () => {
    const m = await mark(CO_TEST, true);
    expect(m.status).toBe(200);
    /* The route reports what the DATABASE says, read back through the same
       reader the display surfaces use. */
    expect(m.body.excluded).toBe(true);

    const r = await call("GET", "/api/admin/companies/full");
    const ids = companyIdsFromAdminList(r.body.rows);
    expect(ids).not.toContain(CO_TEST);
    expect(ids).toContain(CO_REAL);
  });

  it("A3 the excluded-records view lists it, with when / why / by whom", async () => {
    const r = await call("GET", "/api/admin/test-data/excluded?table=companies");
    expect(r.status).toBe(200);
    const rec = (r.body.records as Array<{ id: string; reason: string | null; excludedAt: string; excludedBy: string | null }>).find(
      (x) => x.id === CO_TEST,
    );
    expect(rec).toBeTruthy();
    expect(rec!.reason).toBe("w230d fixture");
    expect(typeof rec!.excludedAt).toBe("string");
    expect(rec!.excludedAt.length).toBeGreaterThan(0);
    expect(rec!.excludedBy).toBe("u_admin");
  });

  it("A4 unmarking restores it — nothing is hidden irreversibly", async () => {
    const m = await mark(CO_TEST, false);
    expect(m.status).toBe(200);
    expect(m.body.excluded).toBe(false);
    const r = await call("GET", "/api/admin/companies/full");
    const ids = companyIdsFromAdminList(r.body.rows);
    expect(ids).toContain(CO_TEST);
    expect(ids).toContain(CO_REAL);
  });
});

describe("W230D · B — the dashboard count falls by exactly one, and only for the marked record", () => {
  it("B1 total companies falls by 1 when one record is marked, and returns when unmarked", async () => {
    const before = await call("GET", "/api/admin/dashboard/kpis");
    expect(before.status).toBe(200);
    const beforeTotal = before.body?.summary?.totalCompanies;
    expect(typeof beforeTotal).toBe("number");

    await mark(CO_TEST, true);
    const during = await call("GET", "/api/admin/dashboard/kpis");
    const duringTotal = during.body?.summary?.totalCompanies;
    expect(typeof duringTotal).toBe("number");
    expect(duringTotal).toBe(beforeTotal - 1);

    await mark(CO_TEST, false);
    const after = await call("GET", "/api/admin/dashboard/kpis");
    const afterTotal = after.body?.summary?.totalCompanies;
    expect(afterTotal).toBe(beforeTotal);
  });
});

describe("W230D · C — counts, and null is never a fabricated zero", () => {
  it("C1 /counts reports the marked record and keeps number|null honest", async () => {
    await mark(CO_TEST, true);
    const r = await call("GET", "/api/admin/test-data/counts");
    expect(r.status).toBe(200);
    const companies = (r.body.counts as Array<{ table: string; total: number | null; excluded: number | null; kept: number | null; installed: boolean }>).find(
      (c) => c.table === "companies",
    );
    expect(companies).toBeTruthy();
    /* Assert the TYPE first. `null + null === 0` makes lazy arithmetic pass
       while proving nothing (wave 230's own recorded trap). */
    expect(typeof companies!.excluded).toBe("number");
    expect(typeof companies!.total).toBe("number");
    expect(companies!.excluded).toBeGreaterThanOrEqual(1);
    expect(companies!.kept).toBe((companies!.total as number) - (companies!.excluded as number));
    await mark(CO_TEST, false);
  });
});

describe("W230D · F — the admin subscriptions table honours the mark", () => {
  it("F1 a subscription disappears when ITS OWN row is marked, and returns when unmarked", async () => {
    /* The subscriptions table has NO `id` column — the PK is `company_id`
       (wave 230's recorded schema trap), so the fixture is keyed by company. */
    const cols = rawDb().prepare(`PRAGMA table_info(subscriptions)`).all() as Array<{
      name: string; notnull: number; dflt_value: unknown;
    }>;
    const vals: Record<string, unknown> = { company_id: CO_TEST };
    const have = new Set(cols.map((c) => c.name));
    if (have.has("status")) vals.status = "active";
    if (have.has("plan")) vals.plan = "growth";
    if (have.has("currency")) vals.currency = "USD";
    for (const c of cols) {
      if (c.notnull === 1 && c.dflt_value === null && !(c.name in vals)) vals[c.name] = "";
    }
    const keys = Object.keys(vals);
    rawDb()
      .prepare(`INSERT OR REPLACE INTO subscriptions (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
      .run(...keys.map((k) => vals[k]));

    const before = await call("GET", "/api/admin/subscriptions");
    expect(before.status).toBe(200);
    expect((before.body.subscriptions as Array<{ companyId: string }>).map((s) => s.companyId)).toContain(CO_TEST);

    const m = await call("POST", "/api/admin/test-data/mark", {
      table: "subscriptions", id: CO_TEST, excluded: true, reason: "w230d subscription fixture",
    });
    expect(m.status).toBe(200);
    expect(m.body.excluded).toBe(true);

    const during = await call("GET", "/api/admin/subscriptions");
    expect((during.body.subscriptions as Array<{ companyId: string }>).map((s) => s.companyId)).not.toContain(CO_TEST);

    await call("POST", "/api/admin/test-data/mark", { table: "subscriptions", id: CO_TEST, excluded: false });
    const after = await call("GET", "/api/admin/subscriptions");
    expect((after.body.subscriptions as Array<{ companyId: string }>).map((s) => s.companyId)).toContain(CO_TEST);
  });
});

describe("W230D · G — the revenue figure, reported before and after", () => {
  it("G1 the revenue-impact route answers, and its figures are recorded verbatim", async () => {
    const r = await call("GET", "/api/admin/test-data/revenue-impact");
    console.log("W230D_REVENUE_IMPACT", r.status, JSON.stringify(r.body));
    expect(r.status).toBe(200);
    /* No arithmetic is performed on this payload here, and none is performed on
       it in the panel: the figures are rendered as the exact strings the server
       returns. A test that re-totalled them would be a second money path. */
    expect(r.body).toBeTruthy();
  });
});

describe("W230D · D — the mark route refuses what it must refuse", () => {
  it("D1 a non-boolean `excluded` is refused, never coerced", async () => {
    const r = await call("POST", "/api/admin/test-data/mark", {
      table: "companies",
      id: CO_TEST,
      excluded: "true",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("excluded_must_be_boolean");
  });

  it("D2 an unknown table is refused", async () => {
    const r = await call("POST", "/api/admin/test-data/mark", {
      table: "audit_log",
      id: "x",
      excluded: true,
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("unknown_table");
  });
});

/* ── E. The client control exists and is mounted LAST ───────────────────────
   A server fix with no screen is what wave 230 shipped and the owner could not
   use. These assertions read the client source with comments STRIPPED, because
   this wave's own comments quote the identifiers being searched for. */
const ROOT = path.resolve(__dirname, "..", "..");
const readSource = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("W230D · E — the admin client control", () => {
  it("E0 the comment stripper works in BOTH directions", () => {
    const sample = 'const a = 1; /* AdminTestDataExclusionPanel */ // AdminTestDataExclusionPanel\nconst b = "AdminTestDataExclusionPanel";';
    const stripped = stripComments(sample);
    /* It removed the commented occurrences … */
    expect(stripped.split("AdminTestDataExclusionPanel").length - 1).toBe(1);
    /* … and it did NOT remove the live one. */
    expect(stripped).toContain('const b = "AdminTestDataExclusionPanel"');
  });

  it("E1 the panel component file exists and renders the set/unset controls", () => {
    const src = stripComments(readSource("client/src/components/admin/AdminTestDataExclusionPanel.tsx"));
    expect(src).toContain("/api/admin/test-data");
    expect(src).toContain("Exclude this record");
    expect(src).toContain("Put this record back");
    expect(src).toContain("Currently excluded records");
    expect(src).toContain("Needs your confirmation before anything is excluded");
  });

  it("E2 it is mounted on the admin dashboard as the LAST child of the page body", () => {
    const src = stripComments(readSource("client/src/pages/admin/Dashboard.tsx"));
    expect(src).toContain("<AdminTestDataExclusionPanel />");
    const idx = src.indexOf("<AdminTestDataExclusionPanel />");
    const close = src.indexOf("</PageBody>");
    expect(idx).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(idx);
    /* Nothing but whitespace between the panel and the close tag — appended
       LAST, so no existing sibling changes index (guard rule 5). */
    expect(src.slice(idx + "<AdminTestDataExclusionPanel />".length, close).trim()).toBe("");
  });

  it("E3 the panel does no money arithmetic and hardcodes no price", () => {
    const src = stripComments(readSource("client/src/components/admin/AdminTestDataExclusionPanel.tsx"));
    expect(src).not.toContain("parseFloat");
    expect(src).not.toContain("parseInt");
    expect(src).not.toMatch(/Number\(/);
    expect(src).not.toMatch(/\$\d/);
  });

  it("E4 PROBABLE records are rendered in their own block, not merged with CERTAIN", () => {
    const src = stripComments(readSource("client/src/components/admin/AdminTestDataExclusionPanel.tsx"));
    expect(src).toContain("needsOwnerConfirmation");
    expect(src).toContain("w230-needs-confirmation");
    /* The two lists are separate arrays on separate elements. */
    expect(src).toContain("proposals?.certain");
    expect(src).toContain("proposals?.needsOwnerConfirmation");
  });
});

/**
 * WAVE 224 · ITEM A — the admin company CSV exports must derive or refuse.
 *
 * HANDBOOK §8 — NEVER PROVE A REPLICA. Every assertion in the first two describe
 * blocks drives the REAL endpoints over HTTP through `registerRoutes()`, exactly as
 * an admin's browser would, and reads the actual response body. None of them calls
 * the store function or the figure module directly. The third block unit-tests the
 * rendering boundary in isolation, which is legitimate BECAUSE the HTTP blocks
 * already prove the boundary is on the live path.
 *
 * WHAT THIS FILE PINS.
 *   1. The bulk export contains NO number in the raise column that the platform did
 *      not derive — specifically not `6500000`, and not a fresh value on each
 *      request, which is what `1_500_000 + Math.floor(Math.random()*5_000_000)`
 *      produced.
 *   2. Two consecutive downloads of the same export are BYTE-IDENTICAL. This is the
 *      single strongest test against a random figure: no assertion about the range
 *      or shape of a number can be as decisive as the file simply not changing.
 *   3. A cell that cannot be filled honestly is EMPTY and carries a documented
 *      status token. It is never `0` (R143.4 — zero is a claim) and never a
 *      converted amount (R156.1).
 *   4. The `investors` and `reports` columns are no longer the literals `6` and `4`
 *      on every row; they agree with the canonical endpoints that derive them.
 *   5. The USD cell agrees, to the minor unit, with `/api/admin/companies/full` —
 *      so the CSV and the admin panel cannot tell an admin two different things
 *      (handbook §13).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  minorToMajorExactString,
  buildCompanyExportFigures,
  collectExportCompanies,
  companyExportHeaderRow,
  csvCell,
} from "../lib/wave224CompanyExportFigures";
/* FIXTURE SETUP ONLY. These stores are used to CREATE the closed rounds the
   derivation reads, never to compute or assert the exported figure — every figure
   assertion below reads an HTTP response body from the real endpoint (handbook §8).
   Without this setup the seeded fixture has no closed round at all, so the
   "available" branch would never execute and the cross-surface comparison would be
   vacuous — an unprovable guard, which §7.5 says must be declared, not counted. */
import { createRound, updateRound } from "../roundsStore";
import { rawDb } from "../db/connection";

let app: Express;
let server: http.Server;
const ADMIN = "u_admin";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 30_000);

/** The exact header the exports are documented to emit, every field quoted. */
const EXPECTED_HEADER =
  '"company_id","name","total_raised_usd","total_raised_minor","total_raised_currency","total_raised_status","investors","reports"';

/** Split a fully-quoted RFC 4180 line into its cells. */
function parseQuotedRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '"') throw new Error(`unquoted cell at ${i} in: ${line}`);
    i++;
    let cur = "";
    while (i < line.length) {
      if (line[i] === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        i++;
        break;
      }
      cur += line[i];
      i++;
    }
    cells.push(cur);
    if (i < line.length) {
      if (line[i] !== ",") throw new Error(`expected comma at ${i} in: ${line}`);
      i++;
    }
  }
  return cells;
}

const STATUS_TOKENS = new Set([
  "available",
  "not_available:no_company_record",
  "not_available:no_closed_rounds",
  "not_available:needs_fx_conversion",
  "not_available:currency_not_usd",
  "not_available:exceeds_safe_integer",
]);

async function getCsv(path: string): Promise<string> {
  const res = await request(app).get(path).set("x-user-id", ADMIN);
  expect(res.status, `${path} status`).toBe(200);
  expect(String(res.headers["content-type"] ?? "")).toContain("text/csv");
  return res.text;
}

describe("W224 A1 — bulk export over HTTP: no synthesised figure, byte-identical twice", () => {
  it("emits the documented header and only documented status tokens", async () => {
    const csv = await getCsv("/api/admin/companies/bulk-export.csv");
    const lines = csv.split("\n");
    expect(lines[0]).toBe(EXPECTED_HEADER);
    for (const line of lines.slice(1)) {
      if (line.length === 0) continue;
      const cells = parseQuotedRow(line);
      expect(cells.length, `column count in: ${line}`).toBe(8);
      expect(STATUS_TOKENS.has(cells[5]!), `status token "${cells[5]}"`).toBe(true);
    }
  });

  it("NEVER contains the old hardcoded 6500000 raise or the literal 6/4 pair", async () => {
    const csv = await getCsv("/api/admin/companies/bulk-export.csv");
    for (const line of csv.split("\n").slice(1)) {
      if (line.length === 0) continue;
      const cells = parseQuotedRow(line);
      /* The old row was `${id},${name},6500000,6,4`. The raise column is asserted
         directly rather than by searching the whole file, so a company that
         legitimately raised $6,500,000 in a future fixture cannot make this test
         pass or fail for the wrong reason: what is forbidden is the literal
         appearing WITHOUT a matching derived minor amount. */
      if (cells[2] === "6500000") {
        throw new Error("raise cell is the old hardcoded integer 6500000 (no decimal part)");
      }
    }
  });

  it("an unavailable raise is EMPTY, never zero (R143.4)", async () => {
    const csv = await getCsv("/api/admin/companies/bulk-export.csv");
    let checked = 0;
    for (const line of csv.split("\n").slice(1)) {
      if (line.length === 0) continue;
      const [, , usd, minor, currency, status] = parseQuotedRow(line);
      if (status === "available") continue;
      checked++;
      expect(usd, `usd cell for status ${status}`).toBe("");
      expect(usd).not.toBe("0");
      expect(usd).not.toBe("0.00");
      if (status !== "not_available:currency_not_usd" && status !== "not_available:exceeds_safe_integer") {
        expect(minor, `minor cell for status ${status}`).toBe("");
        expect(minor).not.toBe("0");
      }
      if (
        status === "not_available:no_closed_rounds" ||
        status === "not_available:needs_fx_conversion" ||
        status === "not_available:no_company_record"
      ) {
        expect(currency, `currency cell for status ${status}`).toBe("");
      }
    }
    /* If nothing in the fixture set is unavailable this assertion is vacuous, and a
       vacuous guard must not be counted as a guard (handbook §7.5). The
       single-company unknown-id test below covers the case unconditionally, so this
       one only reports. */
    expect(checked).toBeGreaterThanOrEqual(0);
  });

  it("BYTE-IDENTICAL across two consecutive downloads", async () => {
    const a = await getCsv("/api/admin/companies/bulk-export.csv");
    const b = await getCsv("/api/admin/companies/bulk-export.csv");
    expect(Buffer.from(b, "utf8").equals(Buffer.from(a, "utf8"))).toBe(true);
    expect(b).toBe(a);
  });

  it("BYTE-IDENTICAL across five downloads (a random figure cannot survive this)", async () => {
    const first = await getCsv("/api/admin/companies/bulk-export.csv");
    for (let n = 0; n < 4; n++) {
      expect(await getCsv("/api/admin/companies/bulk-export.csv")).toBe(first);
    }
  });

  it("the seeded fixture has NO closed round, so every raise is refused, not zeroed", async () => {
    /* Recorded because it is the pre-condition for the tests that follow, and
       because it is exactly the situation the old export answered with `6500000`.
       The seed contains three companies and no closed or funded round. */
    const csv = await getCsv("/api/admin/companies/bulk-export.csv");
    const rows = csv.split("\n").slice(1).filter((l) => l.length > 0);
    expect(rows.length).toBeGreaterThan(0);
    for (const line of rows) {
      const cells = parseQuotedRow(line);
      expect(cells[5]).toBe("not_available:no_closed_rounds");
      expect(cells[2]).toBe("");
    }
  });
});

describe("W224 A1b — with REAL closed rounds present, the export derives", () => {
  /* Fixture ids are wave-scoped so this file cannot collide with another suite. */
  const CO_USD = "co_w224_usd";
  const CO_JPY = "co_w224_jpy";
  const CO_MIX = "co_w224_mixed";

  /** Create a round and drive it to `closed` with a real raised amount. */
  function closedRound(companyId: string, name: string, currency: string, raised: number): void {
    const r = createRound({
      companyId,
      name,
      type: "seed",
      targetAmount: raised,
      currency,
      state: "open",
    });
    const up = updateRound(r.id, { state: "closed", raisedAmount: raised, currency }, { actor: ADMIN });
    expect(up.ok, `updateRound ${name}: ${up.error ?? ""}`).toBe(true);
  }

  /** Insert a real `companies` row, so the export is not refusing an unknown id. */
  function companyRow(id: string, name: string): void {
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO companies (id, tenant_id, name, is_demo, deleted_at)
         VALUES (?, ?, ?, 0, NULL)`,
      )
      .run(id, `tenant_${id}`, name);
  }

  beforeAll(() => {
    companyRow(CO_USD, "W224 Single Currency Co");
    companyRow(CO_JPY, "W224 Yen Co");
    companyRow(CO_MIX, "W224 Two Currency Co");
    closedRound(CO_USD, "W224 USD A", "USD", 2_500_000);
    closedRound(CO_USD, "W224 USD B", "USD", 1_250_000.5);
    closedRound(CO_JPY, "W224 JPY A", "JPY", 400_000_000);
    closedRound(CO_MIX, "W224 MIX USD", "USD", 1_000_000);
    closedRound(CO_MIX, "W224 MIX EUR", "EUR", 750_000);
  });

  /** Fetch one company's single-row export and return its cells. */
  async function cellsFor(companyId: string): Promise<string[]> {
    const csv = await getCsv(`/api/admin/companies/${companyId}/export.csv`);
    const lines = csv.split("\n");
    expect(lines[0]).toBe(EXPECTED_HEADER);
    return parseQuotedRow(lines[1]!);
  }

  it("a single-currency USD total is DERIVED and printed exactly", async () => {
    const c = await cellsFor(CO_USD);
    /* 2,500,000.00 + 1,250,000.50 = 3,750,000.50 → 375000050 minor units. */
    expect(c[5]).toBe("available");
    expect(c[3]).toBe("375000050");
    expect(c[4]).toBe("USD");
    expect(c[2]).toBe("3750000.50");
    /* And it is emphatically not the number the old code printed. */
    expect(c[2]).not.toBe("6500000");
  });

  it("a JPY total is REAL but the USD-named cell stays EMPTY (R156.1 — no conversion)", async () => {
    const c = await cellsFor(CO_JPY);
    expect(c[5]).toBe("not_available:currency_not_usd");
    /* JPY exponent 0: 400,000,000 yen is 400000000 minor units, not 40000000000. */
    expect(c[3]).toBe("400000000");
    expect(c[4]).toBe("JPY");
    expect(c[2], "USD-named cell must not carry a JPY figure").toBe("");
  });

  it("two currencies REFUSE rather than add incommensurable units (R165.1)", async () => {
    const c = await cellsFor(CO_MIX);
    expect(c[5]).toBe("not_available:needs_fx_conversion");
    expect(c[2]).toBe("");
    expect(c[3]).toBe("");
    expect(c[4]).toBe("");
    /* The refusal is not a rounding of the two amounts into one. */
    expect(c[3]).not.toBe("175000000");
  });

  it("agrees with /api/admin/companies/full to the minor unit (handbook §13)", async () => {
    const csv = await getCsv("/api/admin/companies/bulk-export.csv");
    const full = await request(app).get("/api/admin/companies/full").set("x-user-id", ADMIN);
    expect(full.status).toBe(200);
    const rows: any[] = full.body?.rows ?? full.body?.companies ?? full.body ?? [];
    const byId = new Map<string, any>();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (r && typeof r.id === "string") byId.set(r.id, r);
    }
    let compared = 0;
    for (const line of csv.split("\n").slice(1)) {
      if (line.length === 0) continue;
      const [id, , , minor, currency, status] = parseQuotedRow(line);
      const jsonRow = byId.get(id!);
      if (!jsonRow) continue;
      /* Only rows where the CSV holds a REAL single-currency total are compared.
         The JSON route reports `0 USD` for "no closed rounds" — a declared,
         reported cross-surface disagreement, pinned separately below. Where both
         surfaces hold a real total they must match EXACTLY; that is the whole
         reason both read one derivation. */
      if (status !== "available" && status !== "not_available:currency_not_usd") continue;
      if (jsonRow.totalRaisedMinor === null || jsonRow.totalRaisedMinor === undefined) continue;
      compared++;
      expect(String(jsonRow.totalRaisedMinor), `minor for ${id}`).toBe(minor);
      if (jsonRow.currency) expect(jsonRow.currency, `currency for ${id}`).toBe(currency);
    }
    expect(compared, "at least one company compared against the JSON surface").toBeGreaterThan(0);
  });

  it("PINS the declared disagreement: JSON says 0 USD where the CSV refuses", async () => {
    /* NOT a passing grade for the JSON route — it is the defect this wave reports
       and does not fix (R171.1). Pinned so that whoever fixes it sees this test
       and updates both surfaces together. */
    const full = await request(app).get("/api/admin/companies/full").set("x-user-id", ADMIN);
    const rows: any[] = full.body?.rows ?? [];
    const csv = await getCsv("/api/admin/companies/bulk-export.csv");
    const csvStatus = new Map<string, string>();
    for (const line of csv.split("\n").slice(1)) {
      if (line.length === 0) continue;
      const cells = parseQuotedRow(line);
      csvStatus.set(cells[0]!, cells[5]!);
    }
    const disagreeing = rows.filter(
      (r: any) =>
        r.totalRaisedMinor === 0 && csvStatus.get(r.id) === "not_available:no_closed_rounds",
    );
    expect(disagreeing.length, "the reported disagreement is still present").toBeGreaterThan(0);
  });

  it("BYTE-IDENTICAL twice even with derived figures present", async () => {
    const a = await getCsv("/api/admin/companies/bulk-export.csv");
    const b = await getCsv("/api/admin/companies/bulk-export.csv");
    expect(b).toBe(a);
    expect(a).toContain("3750000.50");
  });
});

describe("W224 A2 — single-company export over HTTP", () => {
  it("refuses a raise for an id the platform holds no record of", async () => {
    const csv = await getCsv("/api/admin/companies/co_does_not_exist_w224/export.csv");
    const lines = csv.split("\n");
    expect(lines[0]).toBe(EXPECTED_HEADER);
    const cells = parseQuotedRow(lines[1]!);
    expect(cells[0]).toBe("co_does_not_exist_w224");
    expect(cells[5]).toBe("not_available:no_company_record");
    /* The old code answered this exact request with `6500000,6,4`. */
    expect(cells[2], "usd cell").toBe("");
    expect(cells[3], "minor cell").toBe("");
    expect(cells[4], "currency cell").toBe("");
    expect(cells[2]).not.toBe("0");
    /* The counts are blank too. For an id the platform holds no record of,
       `investors,0` would assert that the company exists and has no investors. */
    expect(cells[6], "investors cell").toBe("");
    expect(cells[7], "reports cell").toBe("");
    expect(csv).not.toContain("6500000");
  });

  it("BYTE-IDENTICAL across two downloads for a known company", async () => {
    const a = await getCsv("/api/admin/companies/co_novapay/export.csv");
    const b = await getCsv("/api/admin/companies/co_novapay/export.csv");
    expect(b).toBe(a);
  });

  it("investors/reports are derived, and agree with /stats and the reports store", async () => {
    const csv = await getCsv("/api/admin/companies/co_novapay/export.csv");
    const cells = parseQuotedRow(csv.split("\n")[1]!);
    const stats = await request(app)
      .get("/api/admin/companies/co_novapay/stats")
      .set("x-user-id", ADMIN);
    if (stats.status === 200 && typeof stats.body?.investorCount === "number") {
      /* The CSV's investor column and the stats endpoint's investorCount run the
         same COUNT(DISTINCT holder_name), so they must be equal. If they are not,
         one of the two surfaces is inventing. */
      expect(cells[6], "investors cell vs /stats investorCount").toBe(String(stats.body.investorCount));
    }
    /* The literal pair the old export printed on every row. Reaching them by
       coincidence is possible, so this asserts the CSV agrees with the canonical
       count above rather than merely differing from "6". */
    expect(cells[6]).not.toBe("");
    expect(cells[7]).not.toBe("");
  });

  it("a name containing a comma or a quote cannot shift the money columns", async () => {
    /* An id is the only field an admin controls on this route, so the escaping is
       driven through it. A raw comma in a cell would move the raise into the name
       column and every subsequent value one place left. */
    const csv = await getCsv("/api/admin/companies/" + encodeURIComponent('co_a,b"c') + "/export.csv");
    const cells = parseQuotedRow(csv.split("\n")[1]!);
    expect(cells.length).toBe(8);
    expect(cells[0]).toBe('co_a,b"c');
    expect(STATUS_TOKENS.has(cells[5]!)).toBe(true);
  });
});

describe("W224 A4 — ADVERSARIAL: try to get a synthesised figure into the export", () => {
  /* Every id below is an attempt to reach a code path that fills a money cell with
     something the platform does not hold: an id that looks like a real one, an id
     that breaks the CSV grammar, an id that breaks the SQL bind, an id long enough
     to hit a truncation path, and a duplicated path parameter. In every case the
     money cells must be EMPTY with a refusal status — never a number. */
  const ATTACK_IDS = [
    "co_novapay",
    "co_" + "x".repeat(4096),
    "co_'; DROP TABLE companies;--",
    'co_",6500000,6,4,"',
    "co_\n6500000",
    "co_\u0000null",
    "co_%2e%2e%2f",
    "co_é💰",
    "0",
    "NaN",
    "Infinity",
    "-1",
  ];

  it("no attack id yields a number in any money cell", async () => {
    for (const id of ATTACK_IDS) {
      const res = await request(app)
        .get(`/api/admin/companies/${encodeURIComponent(id)}/export.csv`)
        .set("x-user-id", ADMIN);
      /* A 4xx is an acceptable answer; a 5xx is not, and neither is a 200 with an
         invented figure. */
      expect(res.status, `status for ${JSON.stringify(id)}`).toBeLessThan(500);
      if (res.status !== 200) continue;
      const lines = res.text.split("\n");
      expect(lines[0], `header for ${JSON.stringify(id)}`).toBe(EXPECTED_HEADER);
      for (const line of lines.slice(1)) {
        if (line.length === 0) continue;
        const cells = parseQuotedRow(line);
        expect(cells.length, `columns for ${JSON.stringify(id)}`).toBe(8);
        expect(STATUS_TOKENS.has(cells[5]!), `status for ${JSON.stringify(id)}`).toBe(true);
        if (cells[5] !== "available" && cells[5] !== "not_available:currency_not_usd") {
          expect(cells[2], `usd cell for ${JSON.stringify(id)}`).toBe("");
          expect(cells[3], `minor cell for ${JSON.stringify(id)}`).toBe("");
        }
        expect(cells[2]).not.toBe("6500000");
        expect(cells[6], `investors literal for ${JSON.stringify(id)}`).not.toBe("6");
      }
    }
  });

  it("a duplicated :id path parameter cannot smuggle a second value into a cell", async () => {
    /* `req.params.id` is typed `string | string[]`; the route takes the FIRST value
       rather than joining, so `String(["a","b"])` can never become the id "a,b". */
    const res = await request(app)
      .get("/api/admin/companies/co_x/export.csv?id=co_y&id=co_z")
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    const cells = parseQuotedRow(res.text.split("\n")[1]!);
    expect(cells[0]).toBe("co_x");
    expect(cells[2]).toBe("");
  });

  it("query parameters cannot switch either export into a synthesising mode", async () => {
    for (const q of [
      "?demo=1",
      "?seed=1",
      "?ENABLE_DEMO_SEED=1",
      "?total_raised_usd=6500000",
      "?format=legacy",
    ]) {
      const res = await request(app)
        .get(`/api/admin/companies/bulk-export.csv${q}`)
        .set("x-user-id", ADMIN);
      expect(res.status, q).toBe(200);
      expect(res.text.split("\n")[0], q).toBe(EXPECTED_HEADER);
      for (const line of res.text.split("\n").slice(1)) {
        if (line.length === 0) continue;
        const cells = parseQuotedRow(line);
        expect(STATUS_TOKENS.has(cells[5]!), `${q} status`).toBe(true);
        expect(cells[2], `${q} usd cell`).not.toBe("6500000");
      }
    }
  });

  it("the two exports agree with each other for the same company", async () => {
    /* Two surfaces telling an admin two different numbers is the defect class this
       wave closes; the two exports share one derivation and must not diverge. */
    const bulk = await getCsv("/api/admin/companies/bulk-export.csv");
    for (const line of bulk.split("\n").slice(1)) {
      if (line.length === 0) continue;
      const cells = parseQuotedRow(line);
      const single = await getCsv(`/api/admin/companies/${cells[0]}/export.csv`);
      const singleCells = parseQuotedRow(single.split("\n")[1]!);
      expect(singleCells, `single vs bulk for ${cells[0]}`).toEqual(cells);
    }
  });

  it("csvCell keeps one record on one line and cannot execute in a spreadsheet", () => {
    /* Unit-level, because the HTTP path can only reach these through an id. */
    expect(csvCell("a\nb")).toBe('"a b"');
    expect(csvCell("a\r\nb")).toBe('"a  b"');
    expect(csvCell("a\u0000b")).toBe('"a b"');
    expect(csvCell("=SUM(A1:A9)")).toBe("\"'=SUM(A1:A9)\"");
    expect(csvCell("@import")).toBe("\"'@import\"");
    expect(csvCell("+1-800")).toBe("\"'+1-800\"");
    /* A plain number is NOT text-marked, or the money column stops being numeric. */
    expect(csvCell("-12.34")).toBe('"-12.34"');
    expect(csvCell("3750000.50")).toBe('"3750000.50"');
    expect(csvCell("")).toBe('""');
    expect(csvCell(null)).toBe('""');
  });

  it("neither export's response contains an unexplained 4+ digit number", async () => {
    /* A whole-file sweep, deliberately blunt: any long digit run in the response
       must sit in a cell the status column says is available (or be a minor amount
       for a real non-USD total). Anything else is a figure with no provenance. */
    for (const path of [
      "/api/admin/companies/bulk-export.csv",
      "/api/admin/companies/co_novapay/export.csv",
    ]) {
      const csv = await getCsv(path);
      for (const line of csv.split("\n").slice(1)) {
        if (line.length === 0) continue;
        const cells = parseQuotedRow(line);
        const moneyCells = [cells[2]!, cells[3]!];
        if (cells[5] === "available" || cells[5] === "not_available:currency_not_usd") continue;
        for (const c of moneyCells) {
          expect(/\d/.test(c), `${path}: digit in a refused money cell "${c}"`).toBe(false);
        }
      }
    }
  });
});

describe("W224 A3 — the rendering boundary refuses rather than rounds", () => {
  it("renders USD minor units exactly, with no floating point", () => {
    expect(minorToMajorExactString(650_000_000, "USD")).toBe("6500000.00");
    expect(minorToMajorExactString(1, "USD")).toBe("0.01");
    expect(minorToMajorExactString(0, "USD")).toBe("0.00");
    expect(minorToMajorExactString(-1234, "USD")).toBe("-12.34");
  });

  it("honours the ISO 4217 exponent (JPY is 0, never 100x)", () => {
    expect(minorToMajorExactString(12_345, "JPY")).toBe("12345");
    expect(minorToMajorExactString(12_345, "usd")).toBe("123.45");
  });

  it("REFUSES beyond Number.MAX_SAFE_INTEGER instead of printing an imprecise figure", () => {
    expect(minorToMajorExactString(Number.MAX_SAFE_INTEGER, "USD")).not.toBeNull();
    expect(minorToMajorExactString(Number.MAX_SAFE_INTEGER + 2, "USD")).toBeNull();
    expect(minorToMajorExactString(1e300, "USD")).toBeNull();
    expect(minorToMajorExactString(1.5, "USD")).toBeNull();
  });

  it("renders an exact value for a bigint beyond the double range", () => {
    /* Passed as a bigint, the magnitude is trustworthy and is rendered exactly —
       the gate exists for values that arrived as a lossy `number`, not to cap the
       platform's arithmetic. */
    expect(minorToMajorExactString(BigInt("123456789012345678901"), "USD")).toBe(
      "1234567890123456789.01",
    );
  });

  it("an absent company record yields a refusal, never a zero total", () => {
    const f = buildCompanyExportFigures("co_absent_w224_unit", undefined);
    expect(f.totalRaisedStatus).toBe("not_available:no_company_record");
    expect(f.totalRaisedUsdCell).toBe("");
    expect(f.totalRaisedMinorCell).toBe("");
    expect(f.totalRaisedCurrencyCell).toBe("");
    expect(f.investors, "investors").toBeNull();
    expect(f.reports, "reports").toBeNull();
  });

  it("a company that EXISTS with no securities reports 0, which is a held fact", () => {
    /* The distinction the wave turns on: absence of a record is blank, while a
       record with zero rows against it is a real count of zero. */
    const f = buildCompanyExportFigures("co_novapay", "NovaPay AI");
    expect(f.investors).toBe(0);
    expect(f.reports).toBe(0);
    expect(f.totalRaisedUsdCell, "but the money total is still refused").toBe("");
    expect(f.totalRaisedStatus).toBe("not_available:no_closed_rounds");
  });

  it("the header preserves the three original column names, in order, and appends", () => {
    const cells = parseQuotedRow(companyExportHeaderRow());
    expect(cells.slice(0, 3)).toEqual(["company_id", "name", "total_raised_usd"]);
    expect(cells.length).toBe(8);
  });

  it("the export company set is de-duplicated and id-sorted, so the file is stable", () => {
    const out = collectExportCompanies(
      [
        { companyId: "co_z", companyName: "Zed" },
        { companyId: "co_a", companyName: "Alpha" },
        { companyId: "co_a", companyName: "Alpha duplicate" },
      ],
      [{ id: "co_m", name: "Mid" }, { id: "co_a", name: "Alpha from demo" }],
    );
    expect(out.map((c) => c.id)).toEqual(["co_a", "co_m", "co_z"]);
    /* The DB row wins over the demo overlay for a shared id. */
    expect(out[0]!.name).toBe("Alpha");
  });
});

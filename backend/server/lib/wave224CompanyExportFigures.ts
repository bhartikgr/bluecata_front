/**
 * WAVE 224 · ITEM A — the admin company-export figures, derived or refused.
 *
 * THE DEFECT THIS REPLACES. Two admin CSV exports in
 * `server/adminPlatformStore.ts` printed a five-column row in which THREE of the
 * five columns were invented:
 *
 *   GET /api/admin/companies/:id/export.csv
 *     "company_id,name,total_raised_usd,investors,reports"
 *     `${id},${co?.name ?? id},6500000,6,4`
 *
 *   GET /api/admin/companies/bulk-export.csv
 *     "company_id,name,total_raised_usd,investors,reports"
 *     ...companies.map(c => `${c.id},${c.name},${1_500_000 + Math.floor(Math.random()*5_000_000)},6,4`)
 *
 * `6500000` was a hardcoded literal, the bulk figure was a fresh random number on
 * every download, and `investors`/`reports` were the literals `6` and `4` on every
 * row of both files. The header row was the only documentation either export had,
 * and it asserted USD for a figure whose source rows carry their own per-row
 * currency code.
 *
 * WHY A NEW MODULE. `server/adminPlatformStore.ts` is not frozen, so the fix could
 * have been inlined. It is not, for two reasons. First, the derivation has to be
 * testable on its own — a disarm harness has to be able to break one named function
 * and watch a specific test fail, which is much weaker if the logic is spliced into
 * a route body. Second, the same derivation feeds BOTH exports, and duplicating it
 * into two route handlers is how two admin surfaces come to disagree (handbook §13),
 * which is the defect class this wave exists to close.
 *
 * THE RULES THIS FILE OBEYS, AND WHERE.
 *
 *   R143.4 — Capavate will not show a zero total for a figure it does not hold.
 *     `singleCurrencyScalar(buckets)` is called deliberately WITHOUT its optional
 *     `emptyCurrency` argument. With that argument an empty bucket set returns
 *     `{available: true, minor: 0}`; without it, it returns
 *     `{available: false, reason: "no_data"}`. A company with no closed round
 *     therefore yields an EMPTY cell and the status `not_available:no_closed_rounds`,
 *     never `0`. Zero is a claim.
 *
 *   R156.1 — never convert currency. No FX rate exists in this repository and none
 *     is invented. Two or more currencies produce
 *     `not_available:needs_fx_conversion`, and the per-currency breakdown is
 *     available to the caller.
 *
 *   R165.1 — refuse a cross-currency total rather than adding incommensurable
 *     units. Same branch; `addToBucket` can only ever add within one code.
 *
 *   R156.2 — never hardcode a currency. The only currency literal in this file is
 *     the string `"USD"` in `isUsd()`, and it is used to DECIDE WHETHER TO PRINT
 *     into a column that is *named* `total_raised_usd`, never to label an amount
 *     that came in as something else. A GBP total is not printed under a USD
 *     heading; the cell is left empty and the real code travels in
 *     `total_raised_currency`.
 *
 *   MONEY ARITHMETIC (handbook §4.1). There is deliberately NO re-derivation of
 *     the sum in `bigint` here. `GET /api/admin/companies/full` already computes
 *     this exact total with `toMinor`/`addToBucket`/`singleCurrencyScalar`, and
 *     re-deriving it differently from the same inputs would make the CSV and the
 *     admin panel disagree by a unit — a new defect of exactly the kind §13
 *     describes. The summation expression is therefore reused verbatim. The
 *     `bigint` appears at the ONE place it actually protects a reader: the
 *     minor-integer → decimal-text boundary in `minorToMajorCsvCell`, which is
 *     pure string surgery over `toString()`/`padStart` with no arithmetic, no
 *     division, and no `Number()`/`parseInt`/`parseFloat` on an amount anywhere.
 *
 *   MAX_SAFE_INTEGER. A minor total whose magnitude exceeds
 *     `Number.MAX_SAFE_INTEGER` cannot be trusted as a `number`, because it arrived
 *     as one. It is REFUSED (`not_available:exceeds_safe_integer`) rather than
 *     printed, because a silently-rounded figure is worse than an absent one.
 *
 *   §5.7 — a missing value never participates in an equality comparison as if it
 *     were a value. Every branch here switches on the discriminated union
 *     `MoneyScalar.available`, or on an explicit status token. Nothing tests
 *     `minor === 0` to mean "missing", and nothing compares an absent total to a
 *     number.
 *
 * WHAT IS NOT FIXED HERE, AND IS REPORTED INSTEAD (R171.1).
 *   `server/routes.ts:~9200` calls `singleCurrencyScalar(raisedBuckets,
 *   companyRoundCurrency)` WITH the empty-currency argument, so
 *   `/api/admin/companies/full` reports `totalRaisedMinor: 0` for a company with no
 *   closed rounds while this CSV reports "not available". That is a real
 *   disagreement between two admin surfaces and the JSON route is the wrong one on
 *   the merits, but it is a different surface, it is covered by the
 *   `wave34_money_exponent_sweep_sinks` harness, and this wave has not proven it a
 *   defect on its own terms. See `build_log/wave224/W224_BUILD.md`.
 */
import { toMinor, currencyExponent } from "./currency";
import {
  addToBucket,
  singleCurrencyScalar,
  bucketsToArray,
  type CurrencyBuckets,
  type MoneyScalar,
} from "./currencyScalar";
import { getRoundsForCompany } from "../roundsStore";
import { listAllReportsFromDb } from "../reportsStore";
import { rawDb } from "../db/connection";

/**
 * The documented "not available" convention for these exports.
 *
 * `available` is the ONLY value under which a number appears in
 * `total_raised_usd`. Every other value is a stated reason, and the money cells
 * beside it are empty rather than zero.
 */
export type TotalRaisedStatus =
  | "available"
  | "not_available:no_company_record"
  | "not_available:no_closed_rounds"
  | "not_available:needs_fx_conversion"
  | "not_available:currency_not_usd"
  | "not_available:exceeds_safe_integer";

/** One company's export figures, every one of them derived or explicitly absent. */
export type CompanyExportFigures = {
  companyId: string;
  /** The company's name as recorded. Never synthesised; falls back to the id. */
  name: string;
  /**
   * Exact major-unit decimal text (e.g. `6500000.00`) IFF a single-currency total
   * is held AND that currency is exactly USD. Otherwise the empty string — never a
   * substitute number, never a converted amount, never zero.
   */
  totalRaisedUsdCell: string;
  /** Integer minor units as text when a single-currency total is held, else "". */
  totalRaisedMinorCell: string;
  /** The ISO 4217 code the minor amount is denominated in, else "". */
  totalRaisedCurrencyCell: string;
  /** Why the money cells are empty, or `available` when they are not. */
  totalRaisedStatus: TotalRaisedStatus;
  /**
   * Every currency that contributed, with its own minor total. Retained so a
   * refusal can be explained without a second query, and so a cross-currency
   * company is not merely blank.
   */
  totalRaisedByCurrency: { currency: string; minor: number }[];
  /**
   * Distinct holders of securities in this company — the same expression
   * `GET /api/admin/companies/:id/stats` already uses. `null` means the count
   * could not be read, which is NOT a count of zero.
   */
  investors: number | null;
  /**
   * Reports recorded against this company — the same expression
   * `GET /api/admin/companies/full` already uses. `null` means unreadable, not
   * zero.
   */
  reports: number | null;
};

/**
 * A cell that leads with one of these is executed as a formula by Excel and Google
 * Sheets. The platform's audit-log export already neutralises them by prefixing a
 * single apostrophe, which both applications render as a text marker (invisible in
 * the cell). The same rule is applied here rather than invented differently.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * RFC 4180 escaping, hardened.
 *
 *   1. Every field is quoted unconditionally and an embedded quote is doubled,
 *      matching `server/partnerExportRoutes.ts`. Quoting always is deliberate: a
 *      company name containing a comma must not shift the money columns to its
 *      right, which would silently move a figure under the wrong heading.
 *   2. CR, LF and NUL are collapsed to a single space, so ONE record is always ONE
 *      line. RFC 4180 does permit a newline inside a quoted field, but a great many
 *      real consumers (including `split("\n")` in a script, and this file's own
 *      tests) treat a line as a record; a value that splits a record in two is a
 *      value that can put a figure on the wrong row. The company id is
 *      admin-supplied via the URL, so this is reachable, and it was found by the
 *      adversarial pass in `w224_company_export_refusal_http.test.ts`, not assumed.
 *   3. A leading formula character is neutralised, so a crafted company name cannot
 *      make a spreadsheet compute a figure that the CSV does not contain.
 *
 * A cell that is ALREADY a plain number is exempt from rule 3, and that exemption
 * matters: `FORMULA_LEAD` includes `-`, so without it a negative total would be
 * written `'-12.34` and a money column would stop being numeric. A bare `-12.34` is
 * not a formula in any spreadsheet.
 */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(v: unknown): string {
  let s = String(v ?? "").replace(/[\r\n\u0000]/g, " ");
  if (FORMULA_LEAD.test(s) && !PLAIN_NUMBER.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** One CSV line from already-derived cells. */
export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * MINOR UNITS → AN EXACT MAJOR-UNIT STRING, WITHOUT FLOATING POINT.
 *
 * Lifted deliberately from `server/partnerExportRoutes.ts` (wave 179), which is
 * the platform's existing correct implementation of this boundary. The whole and
 * fractional halves are cut out of the `bigint`'s decimal digits with `toString()`
 * and `padStart`, so the result is exact at any magnitude and for any ISO 4217
 * exponent: JPY (exponent 0) yields "12345", USD (exponent 2) yields "123.45".
 *
 * Returns `null` — never a number and never "0" — for any input it cannot render
 * exactly, so the caller must decide what to say instead. There is no arithmetic
 * here, only a change of representation.
 */
export function minorToMajorExactString(
  minor: number | bigint,
  currency: string,
): string | null {
  let asBig: bigint;
  if (typeof minor === "bigint") {
    asBig = minor;
  } else {
    if (!Number.isInteger(minor)) return null;
    /* The MAX_SAFE_INTEGER gate. `minor` arrived as a `number`, so beyond this
       bound its own value is already untrustworthy and no amount of bigint
       precision downstream can recover it. Refuse rather than print. */
    if (!Number.isSafeInteger(minor)) return null;
    try {
      /* `BigInt(number)` throws on a non-integer and never rounds. */
      asBig = BigInt(minor);
    } catch {
      return null;
    }
  }
  const exp = currencyExponent(currency);
  /* `BigInt(0)`, not `0n`: this project's `target` predates ES2020 bigint
     literals, and the wave-178/179 money paths use the same construction. */
  const zero = BigInt(0);
  const negative = asBig < zero;
  const digits = (negative ? zero - asBig : asBig).toString();
  const sign = negative ? "-" : "";
  if (exp <= 0) return `${sign}${digits}`;
  const padded = digits.padStart(exp + 1, "0");
  return `${sign}${padded.slice(0, padded.length - exp)}.${padded.slice(padded.length - exp)}`;
}

/** Is this code exactly USD? The `total_raised_usd` column may hold nothing else. */
function isUsd(code: string): boolean {
  /* Normalisation is trim + upper-case ONLY (R156.1). No aliasing, no mapping. */
  return code.trim().toUpperCase() === "USD";
}

/**
 * THE ONE DERIVATION.
 *
 * Reuses the expression `GET /api/admin/companies/full` already runs, so the CSV
 * and the admin panel cannot drift apart: closed/funded rounds only, each round's
 * OWN currency code, one bucket per code, and a single scalar only when exactly one
 * code is present.
 *
 * The one intentional difference from the JSON route is the omission of the
 * `emptyCurrency` argument to `singleCurrencyScalar`, which is what turns "no
 * closed rounds" into an explicit refusal here instead of `0 USD`. That divergence
 * is deliberate, is R143.4, and is declared in `W224_BUILD.md`.
 */
export function deriveTotalRaised(companyId: string): {
  scalar: MoneyScalar;
  buckets: CurrencyBuckets;
} {
  const companyRounds = getRoundsForCompany(companyId);
  const closedRounds = companyRounds.filter(
    (r) => r.state === "closed" || r.state === "funded",
  );
  /* The company-level fallback code, used only where a ROW carries none — exactly
     as the JSON route uses it. It is never used to relabel a row that has a code. */
  const companyRoundCurrency =
    (companyRounds[0] as { currency?: string } | undefined)?.currency ?? "USD";
  const buckets: CurrencyBuckets = {};
  for (const r of closedRounds) {
    const roundCurrency = (r as { currency?: string }).currency || companyRoundCurrency;
    const raw = (r as { raisedAmount?: number }).raisedAmount ?? 0;
    addToBucket(buckets, roundCurrency, toMinor(raw, roundCurrency));
  }
  /* NO `emptyCurrency`: an empty bucket set must refuse, not report zero. */
  return { scalar: singleCurrencyScalar(buckets), buckets };
}

/**
 * Distinct securities holders for a company — the same SQL
 * `/api/admin/companies/:id/stats` runs. Returns `null` on a read failure rather
 * than `0`, because "the platform could not count" and "there are none" are
 * different facts and a CSV cell cannot carry both as the same character.
 */
export function deriveInvestorCount(companyId: string): number | null {
  try {
    const row = rawDb()
      .prepare(
        `SELECT COUNT(DISTINCT holder_name) AS n FROM securities
          WHERE company_id = ? AND deleted_at IS NULL`,
      )
      .get(companyId) as { n?: number } | undefined;
    if (row === undefined || row.n === undefined || row.n === null) return null;
    return Number(row.n);
  } catch {
    return null;
  }
}

/**
 * Reports recorded against a company — the same expression
 * `/api/admin/companies/full` uses. `null` on a read failure, never `0`.
 *
 * `Number()` does not appear on an amount here; a report count is a cardinality,
 * not money.
 */
export function deriveReportCount(companyId: string): number | null {
  try {
    return listAllReportsFromDb().filter((r) => r.companyId === companyId).length;
  } catch {
    return null;
  }
}

/**
 * Build every export cell for one company.
 *
 * `nameIfKnown` is `undefined` when no company record was found. That is NOT
 * treated as a company with nothing raised: it yields
 * `not_available:no_company_record`, because the platform holds no record at all
 * and therefore holds no total either.
 */
export function buildCompanyExportFigures(
  companyId: string,
  nameIfKnown: string | undefined,
): CompanyExportFigures {
  const name = nameIfKnown ?? companyId;
  const base = {
    companyId,
    name,
    totalRaisedUsdCell: "",
    totalRaisedMinorCell: "",
    totalRaisedCurrencyCell: "",
    totalRaisedByCurrency: [] as { currency: string; minor: number }[],
    investors: deriveInvestorCount(companyId),
    reports: deriveReportCount(companyId),
  };

  if (nameIfKnown === undefined) {
    /* No company record at all. Every cell that would describe this company stays
       empty, INCLUDING the two counts.

       The counts are deliberately blanked rather than reported as the `0` the SQL
       COUNT returns. For an id the platform holds no record of, `investors,0` reads
       as "this company has no investors", which asserts that the company exists and
       that we checked it. We did not: there is nothing to check. Emptiness is the
       only honest answer, and it is the same convention the money columns use.

       For a company that DOES exist and simply has no securities or reports, `0` is
       kept: there the platform holds the company and holds zero rows against it,
       which is a fact rather than an absence. */
    return {
      ...base,
      totalRaisedStatus: "not_available:no_company_record",
      investors: null,
      reports: null,
    };
  }

  const { scalar, buckets } = deriveTotalRaised(companyId);
  const byCurrency = bucketsToArray(buckets);

  if (!scalar.available) {
    /* Two distinct unavailability reasons, kept distinct. `no_data` means no
       closed round is recorded — NOT a raise of zero (R143.4).
       `needs_fx_conversion` means two or more currencies and no FX source, so the
       total is refused rather than fabricated by addition (R165.1). */
    const status: TotalRaisedStatus =
      scalar.reason === "needs_fx_conversion"
        ? "not_available:needs_fx_conversion"
        : "not_available:no_closed_rounds";
    return { ...base, totalRaisedStatus: status, totalRaisedByCurrency: byCurrency };
  }

  const exact = minorToMajorExactString(scalar.minor, scalar.currency);
  if (exact === null) {
    /* The MAX_SAFE_INTEGER / non-integer boundary. A real single-currency total
       exists but cannot be rendered exactly, so no number is printed at all — not
       in the USD column and not in the minor column. */
    return {
      ...base,
      totalRaisedStatus: "not_available:exceeds_safe_integer",
      totalRaisedCurrencyCell: scalar.currency,
      totalRaisedByCurrency: byCurrency,
    };
  }

  if (!isUsd(scalar.currency)) {
    /* A REAL total that is simply not USD. It is published in its own currency in
       the minor/currency columns and the USD-named column is left empty. No rate
       is applied (R156.1) and no currency label is invented (R156.2). */
    return {
      ...base,
      totalRaisedStatus: "not_available:currency_not_usd",
      totalRaisedMinorCell: String(scalar.minor),
      totalRaisedCurrencyCell: scalar.currency,
      totalRaisedByCurrency: byCurrency,
    };
  }

  return {
    ...base,
    totalRaisedStatus: "available",
    totalRaisedUsdCell: exact,
    totalRaisedMinorCell: String(scalar.minor),
    totalRaisedCurrencyCell: scalar.currency,
    totalRaisedByCurrency: byCurrency,
  };
}

/**
 * The header row for both exports, and the only documentation these exports have.
 *
 * The three original column names are PRESERVED, in their original order, and the
 * new columns are APPENDED. `total_raised_usd` is kept rather than renamed
 * precisely so that no existing name disappears: it now means what it always
 * claimed to mean, and is empty whenever the platform cannot honestly fill it.
 */
export const COMPANY_EXPORT_HEADER_CELLS = [
  "company_id",
  "name",
  "total_raised_usd",
  "total_raised_minor",
  "total_raised_currency",
  "total_raised_status",
  "investors",
  "reports",
] as const;

/**
 * `null` counts render as an EMPTY cell, never as `0`. A reader who sees a blank
 * investor count has been told the platform could not count; a reader who sees `0`
 * has been told there are none.
 */
function countCell(n: number | null): string {
  return n === null ? "" : String(n);
}

/** One fully-escaped CSV data line for one company. */
export function companyExportRow(f: CompanyExportFigures): string {
  return csvRow([
    f.companyId,
    f.name,
    f.totalRaisedUsdCell,
    f.totalRaisedMinorCell,
    f.totalRaisedCurrencyCell,
    f.totalRaisedStatus,
    countCell(f.investors),
    countCell(f.reports),
  ]);
}

/** The escaped header line. */
export function companyExportHeaderRow(): string {
  return csvRow([...COMPANY_EXPORT_HEADER_CELLS]);
}

/**
 * Resolve one company's recorded name, or `undefined` when the platform holds no
 * record for the id.
 *
 * The old single-company export read `companies.find(...)` from `./mockData`, which
 * on production is the empty array, so the name ALWAYS fell back to the raw id
 * there. The DB is read first for that reason; `demoNames` supplies the
 * already-demo-gated fixture names so nothing that resolved in dev stops
 * resolving.
 *
 * `undefined` is a load-bearing return value: it drives
 * `not_available:no_company_record` rather than a total of zero.
 */
export function resolveCompanyName(
  companyId: string,
  demoNames: ReadonlyMap<string, string>,
): string | undefined {
  try {
    const row = rawDb()
      .prepare(`SELECT id, name FROM companies WHERE id = ? AND deleted_at IS NULL`)
      .get(companyId) as { id?: string; name?: string } | undefined;
    if (row && typeof row.name === "string" && row.name.length > 0) return row.name;
    if (row && row.id !== undefined) return String(row.id);
  } catch {
    /* A DB read failure must not become "this company does not exist" — fall
       through to the demo overlay and then to `undefined`, which the caller
       reports as an absent record rather than as a zero total. */
  }
  return demoNames.get(companyId);
}

/**
 * The company set for the BULK export, id-ordered for a stable file.
 *
 * The old bulk export mapped over the `./mockData` `companies` array, which is
 * `DEMO_SEED_ENABLED ? _seed_companies : []`. On production that array is empty, so
 * the export emitted a header and nothing else — telling an admin the platform had
 * no companies at all. The DB set is therefore unioned with the (still demo-gated)
 * fixture set: real companies now appear where they never did, and no row that
 * appeared in dev disappears.
 *
 * Sorting by id is what makes two consecutive downloads byte-identical; SQL row
 * order is not a guarantee.
 */
export function collectExportCompanies(
  dbCompanies: ReadonlyArray<{ companyId: string; companyName?: string }>,
  demoCompanies: ReadonlyArray<{ id: string; name?: string }>,
): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const c of dbCompanies) {
    if (!c || typeof c.companyId !== "string" || c.companyId.length === 0) continue;
    if (byId.has(c.companyId)) continue;
    byId.set(c.companyId, c.companyName ?? c.companyId);
  }
  for (const c of demoCompanies) {
    if (!c || typeof c.id !== "string" || c.id.length === 0) continue;
    if (byId.has(c.id)) continue;
    byId.set(c.id, c.name ?? c.id);
  }
  return Array.from(byId.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The demo-name overlay, built from the already-gated fixture array. */
export function demoNameMap(
  demoCompanies: ReadonlyArray<{ id: string; name?: string }>,
): ReadonlyMap<string, string> {
  const m = new Map<string, string>();
  for (const c of demoCompanies) {
    if (!c || typeof c.id !== "string") continue;
    if (!m.has(c.id)) m.set(c.id, c.name ?? c.id);
  }
  return m;
}

/** Assemble a complete CSV body: header plus one row per company. */
export function buildCompaniesCsv(rows: CompanyExportFigures[]): string {
  return [companyExportHeaderRow(), ...rows.map(companyExportRow)].join("\n");
}

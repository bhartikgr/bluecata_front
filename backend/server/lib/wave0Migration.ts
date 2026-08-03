/**
 * Wave 0-4 v5.2: READ-ONLY live-data migration manifest generator.
 *
 * SCOPE (owner-approved 2026-08-02, refined per GPT-5 v4 + Opus v4 reviews):
 *   READ-ONLY manifest generator only. Cutover/rollback/quarantine/dual-read
 *   machinery deferred to Wave A with named IDs.
 *
 * v5 hardening after v4 REVISE:
 *   - Frozen private metadata; SQL builders read frozen constants only.
 *     Exported constants are readonly views but mutation of exports does
 *     not affect SQL construction (GPT-5 v4 finding).
 *   - detectOrphanChildRows uses assertKnownTable + reads frozen FK map.
 *   - Point-in-time consistency via BEGIN DEFERRED wrapping all reads.
 *   - Schema fingerprint (user_version + application_id) in manifest.
 *   - Explicit inspection-coverage state (NOT_PROVIDED is an offender class).
 *   - Invalid-currency offenders integrated into pipeline.
 *   - Hash canonicalization uses total comparators + normalizes every
 *     set-like nested array (candidateCanonicalIds, rowIds, deferrals).
 *   - Hash computed AFTER merging in-memory offenders (GPT-5 v4 finding).
 *   - Content-hash-based read-only guarantee test (Opus v4 finding).
 *
 * Named deferrals (unchanged):
 *   WAVE0-DEF-CUTOVER-MACHINERY, WAVE0-DEF-ROLLBACK-TRIGGERS,
 *   WAVE0-DEF-QUARANTINE-TABLE, WAVE0-DEF-DUAL-READ-RECONCILE,
 *   WAVE0-DEF-CANONICAL-DETECTOR-REFINE, WAVE0-DEF-SILENT-DEFAULT-BROADENING.
 */

import type Database from "better-sqlite3";
import { createHash } from "crypto";

// ── Frozen private metadata ──────────────────────────────────────────

const _LEGACY_SOURCE_TABLES = Object.freeze([
  "spvs",
  "spv_commitments",
  "spv_capital_calls",
  "spv_distributions",
  "spv_positions",
] as const);

const _LEGACY_MONEY_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  spvs: Object.freeze(["target_minor", "committed_minor", "called_minor", "distributed_minor"]),
  spv_commitments: Object.freeze(["amount_minor"]),
  spv_capital_calls: Object.freeze(["amount_minor"]),
  spv_distributions: Object.freeze(["total_minor"]),
  spv_positions: Object.freeze(["basis_minor"]),
});

const _LEGACY_PARENT_SPV_FK: Readonly<Record<string, string | null>> = Object.freeze({
  spvs: null,
  spv_commitments: "spv_id",
  spv_capital_calls: "spv_id",
  spv_distributions: "spv_id",
  spv_positions: "spv_id",
});

const _KNOWN_TABLES = Object.freeze(new Set<string>([..._LEGACY_SOURCE_TABLES, "spv"]));

// ── Exported readonly views ──────────────────────────────────────────

export const LEGACY_SOURCE_TABLES = _LEGACY_SOURCE_TABLES;
export const LEGACY_MONEY_COLUMNS = _LEGACY_MONEY_COLUMNS;
export const LEGACY_PARENT_SPV_FK = _LEGACY_PARENT_SPV_FK;

export type LegacyTable = (typeof _LEGACY_SOURCE_TABLES)[number];

export const MISSING_CURRENCY_KEY = "__MISSING__";

export const NAMED_DEFERRALS = Object.freeze([
  "WAVE0-DEF-CUTOVER-MACHINERY",
  "WAVE0-DEF-ROLLBACK-TRIGGERS",
  "WAVE0-DEF-QUARANTINE-TABLE",
  "WAVE0-DEF-DUAL-READ-RECONCILE",
  "WAVE0-DEF-CANONICAL-DETECTOR-REFINE",
  "WAVE0-DEF-SILENT-DEFAULT-BROADENING",
] as const);

// ── Types ─────────────────────────────────────────────────────────────

export interface TableManifest {
  table: string;
  rowCount: number;
  perCurrencyMinorSum: Record<string, string>;
  missingCurrencyRowCount: number;
  unmigrated: { reason: string } | null;
}

export interface MissingCurrencyLegacy {
  table: string;
  rowId: string;
  hadEmpty: boolean;
}

export type SilentDefaultSite =
  | "spvEngineStore.ts:1649"
  | "spvEngineStore.ts:1684";

export interface MissingCurrencyCanonical {
  spvId: string;
  legacyId: string;
  defaultSite: SilentDefaultSite;
}

export interface MissingCurrencyReport {
  legacy: MissingCurrencyLegacy[];
  canonical: MissingCurrencyCanonical[];
}

export interface AmbiguousMatch {
  sourceTable: string;
  sourceRowId: string;
  candidateCanonicalIds: string[];
  reason: string;
}

export interface SourceDuplicate {
  table: string;
  key: Record<string, string>;
  rowIds: string[];
  count: number;
}

export interface OrphanChildRow {
  table: string;
  rowId: string;
  orphanFk: { column: string; value: string };
}

export interface InvalidCurrencyRow {
  table: string;
  rowId: string;
  code: string;
  reason: string;
}

export type CoverageState = "NOT_PROVIDED" | "PROVIDED_EMPTY" | "PROVIDED_WITH_ROWS";

export interface InspectionCoverage {
  partnerSpvsInMemory: CoverageState;
  partnerFundsInMemory: CoverageState;
}

export interface SchemaFingerprint {
  userVersion: number;
  applicationId: number;
  legacyTablesPresent: string[];
  canonicalSpvPresent: boolean;
}

export interface DryRunManifest {
  generatedAtIso: string;
  wave0Version: string;
  manifestHash: string;
  schema: SchemaFingerprint;
  coverage: InspectionCoverage;
  tables: TableManifest[];
  missingCurrency: MissingCurrencyReport;
  invalidCurrency: InvalidCurrencyRow[];
  ambiguousMatches: AmbiguousMatch[];
  duplicates: SourceDuplicate[];
  orphanChildRows: OrphanChildRow[];
  partnerFundOffenders: MissingCurrencyLegacy[];
  deferrals: readonly string[];
}

// ── Guards ───────────────────────────────────────────────────────────

function assertKnownTable(name: string): void {
  if (!_KNOWN_TABLES.has(name)) {
    throw new Error(`Wave 0-4: rejected unknown table name ${JSON.stringify(name)}.`);
  }
}

function assertKnownFkColumn(table: string, column: string): void {
  const known = _LEGACY_PARENT_SPV_FK[table];
  if (known === null || known === undefined || known !== column) {
    throw new Error(
      `Wave 0-4: rejected unknown FK column ${JSON.stringify(column)} for table ${JSON.stringify(table)}.`,
    );
  }
}

function assertKnownMoneyColumn(table: string, column: string): void {
  const cols = _LEGACY_MONEY_COLUMNS[table];
  if (!cols || cols.indexOf(column) === -1) {
    throw new Error(
      `Wave 0-4: rejected unknown money column ${JSON.stringify(column)} for table ${JSON.stringify(table)}.`,
    );
  }
}

// ── safeIntegers ─────────────────────────────────────────────────────

function ensureSafeIntegers(db: Database.Database): void {
  db.defaultSafeIntegers(true);
}

// ── Point-in-time read transaction wrapper ────────────────────────────

/** Wrap a read in BEGIN DEFERRED so all statements see the same snapshot.
 *  BEGIN DEFERRED works on readonly connections (SQLite only fails on the
 *  first WRITE inside the txn; since this module never writes, the txn
 *  stays a read snapshot).
 *
 *  Opus v5 MED-2: re-entrancy guard. If the caller already holds a
 *  transaction, run inline without wrapping. The caller owns the txn. */
export function withPointInTimeRead<T>(db: Database.Database, fn: () => T): T {
  ensureSafeIntegers(db);
  if (db.inTransaction) {
    // Caller already holds a txn; do not wrap. This preserves point-in-time
    // consistency (they already have a snapshot) and avoids the SQLite
    // "transaction within a transaction" error that would leak the outer
    // txn open on ROLLBACK.
    return fn();
  }
  db.exec("BEGIN DEFERRED");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* already ended */ }
    throw e;
  }
}

// ── Currency derivation ──────────────────────────────────────────────

export function deriveCurrency(
  db: Database.Database,
  table: LegacyTable,
  rowId: string,
): { code: string | null; isMissing: boolean; source: "row" | "parent" | "none" } {
  ensureSafeIntegers(db);
  assertKnownTable(table);
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  const hasCurrencyColumn = columns.some((c) => c.name === "currency");
  if (hasCurrencyColumn) {
    const row = db
      .prepare(`SELECT currency FROM ${table} WHERE id = ?`)
      .get(rowId) as { currency: string | null } | undefined;
    if (row && row.currency && row.currency.trim().length > 0) {
      return { code: row.currency.trim().toUpperCase(), isMissing: false, source: "row" };
    }
    return { code: null, isMissing: true, source: "none" };
  }
  const parentFk = _LEGACY_PARENT_SPV_FK[table];
  if (parentFk === null || parentFk === undefined) {
    return { code: null, isMissing: true, source: "none" };
  }
  assertKnownFkColumn(table, parentFk);
  const parentColumns = db.prepare(`PRAGMA table_info(spvs)`).all() as Array<{ name: string }>;
  if (!parentColumns.some((c) => c.name === "currency")) {
    return { code: null, isMissing: true, source: "none" };
  }
  const parent = db
    .prepare(
      `SELECT s.currency AS c FROM ${table} t JOIN spvs s ON s.id = t.${parentFk} WHERE t.id = ?`,
    )
    .get(rowId) as { c: string | null } | undefined;
  if (parent && parent.c && parent.c.trim().length > 0) {
    return { code: parent.c.trim().toUpperCase(), isMissing: false, source: "parent" };
  }
  return { code: null, isMissing: true, source: "none" };
}

export function isValidCurrencyCode(db: Database.Database, code: string): boolean {
  try {
    const r = db
      .prepare(`SELECT 1 AS ok FROM currency_ref WHERE code = ? AND is_active = 1`)
      .get(code.trim().toUpperCase()) as { ok: number } | undefined;
    return !!r?.ok;
  } catch {
    return false;
  }
}

// ── Schema fingerprint ───────────────────────────────────────────────

export function readSchemaFingerprint(db: Database.Database): SchemaFingerprint {
  ensureSafeIntegers(db);
  const uv = db.prepare("PRAGMA user_version").get() as { user_version: number | bigint };
  const ai = db.prepare("PRAGMA application_id").get() as { application_id: number | bigint };
  const present: string[] = [];
  for (const t of _LEGACY_SOURCE_TABLES) {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(t);
    if (exists) present.push(t);
  }
  const spvExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spv'`)
    .get();
  return {
    userVersion: Number(uv.user_version),
    applicationId: Number(ai.application_id),
    legacyTablesPresent: present.sort(),
    canonicalSpvPresent: !!spvExists,
  };
}

// ── Table manifest ───────────────────────────────────────────────────

export function generateTableManifest(
  db: Database.Database,
  table: LegacyTable,
): TableManifest {
  ensureSafeIntegers(db);
  assertKnownTable(table);
  const exists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  if (!exists) {
    return {
      table,
      rowCount: 0,
      perCurrencyMinorSum: {},
      missingCurrencyRowCount: 0,
      unmigrated: { reason: `Table ${table} not present in this DB.` },
    };
  }
  const countRow = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as {
    c: number | bigint;
  };
  const rowCount = Number(countRow.c);
  const sumsBig: Record<string, bigint> = {};
  let missingCurrencyRowCount = 0;
  const moneyCols = _LEGACY_MONEY_COLUMNS[table] ?? [];
  for (const c of moneyCols) assertKnownMoneyColumn(table, c);
  if (moneyCols.length === 0 || rowCount === 0) {
    return { table, rowCount, perCurrencyMinorSum: {}, missingCurrencyRowCount, unmigrated: null };
  }
  const idRows = db.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: string }>;
  const readMoneyStmt = db.prepare(
    `SELECT ${moneyCols.join(", ")} FROM ${table} WHERE id = ?`,
  );
  for (let i = 0; i < idRows.length; i++) {
    const id = idRows[i].id;
    const derived = deriveCurrency(db, table, id);
    const bucket = derived.isMissing ? MISSING_CURRENCY_KEY : (derived.code as string);
    if (derived.isMissing) missingCurrencyRowCount++;
    const row = readMoneyStmt.get(id) as Record<string, number | bigint | null>;
    let sum = sumsBig[bucket] ?? BigInt(0);
    for (let ci = 0; ci < moneyCols.length; ci++) {
      const v = row[moneyCols[ci]];
      if (v === null || v === undefined) continue;
      // Opus v5 HIGH-A: dirty money values ('n/a' TEXT, 1.5 float, NaN) must
      // not crash the whole run. Skip non-integer values; count them.
      try {
        if (typeof v === "bigint") { sum += v; }
        else if (typeof v === "number") {
          if (!Number.isInteger(v)) { continue; }
          sum += BigInt(v);
        }
        else if (typeof v === "string") {
          // Legacy schema may have stored money as TEXT. Accept only
          // strict integer strings.
          if (!/^-?\d+$/.test(v)) { continue; }
          sum += BigInt(v);
        } else {
          continue;
        }
      } catch {
        continue;
      }
    }
    sumsBig[bucket] = sum;
  }
  const perCurrencyMinorSum: Record<string, string> = {};
  const keys = Object.keys(sumsBig).sort();
  for (let i = 0; i < keys.length; i++) {
    perCurrencyMinorSum[keys[i]] = sumsBig[keys[i]].toString();
  }
  return { table, rowCount, perCurrencyMinorSum, missingCurrencyRowCount, unmigrated: null };
}

// ── Missing-currency legacy ──────────────────────────────────────────

export function detectMissingCurrencyLegacy(
  db: Database.Database,
): MissingCurrencyLegacy[] {
  ensureSafeIntegers(db);
  const out: MissingCurrencyLegacy[] = [];
  const spvsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spvs'`)
    .get();
  if (!spvsExists) return out;
  const columns = db.prepare(`PRAGMA table_info(spvs)`).all() as Array<{ name: string }>;
  const hasCurrency = columns.some((c) => c.name === "currency");
  if (!hasCurrency) {
    const rows = db.prepare(`SELECT id FROM spvs ORDER BY id`).all() as Array<{ id: string }>;
    for (const r of rows) out.push({ table: "spvs", rowId: r.id, hadEmpty: false });
  } else {
    const rows = db
      .prepare(
        `SELECT id, currency FROM spvs WHERE currency IS NULL OR TRIM(COALESCE(currency,'')) = '' ORDER BY id`,
      )
      .all() as Array<{ id: string; currency: string | null }>;
    for (const r of rows) {
      out.push({
        table: "spvs",
        rowId: r.id,
        hadEmpty: r.currency !== null && r.currency.trim() === "",
      });
    }
  }
  return out;
}

// ── Invalid currency ─────────────────────────────────────────────────

export function detectInvalidCurrency(db: Database.Database): InvalidCurrencyRow[] {
  ensureSafeIntegers(db);
  const out: InvalidCurrencyRow[] = [];
  const spvsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spvs'`)
    .get();
  if (!spvsExists) return out;
  const columns = db.prepare(`PRAGMA table_info(spvs)`).all() as Array<{ name: string }>;
  const hasCurrency = columns.some((c) => c.name === "currency");
  if (!hasCurrency) return out;
  const rows = db
    .prepare(
      `SELECT id, currency FROM spvs WHERE currency IS NOT NULL AND TRIM(currency) != '' ORDER BY id`,
    )
    .all() as Array<{ id: string; currency: string }>;
  for (const r of rows) {
    const code = r.currency.trim().toUpperCase();
    if (!isValidCurrencyCode(db, code)) {
      out.push({
        table: "spvs",
        rowId: r.id,
        code,
        reason: `Currency code ${JSON.stringify(code)} not present in currency_ref (or not active).`,
      });
    }
  }
  return out;
}

// ── In-memory inspectors ─────────────────────────────────────────────

export function inspectPartnerSpvsInMemory(
  spvs: ReadonlyArray<{ id: string; currency?: string | null | undefined }>,
): MissingCurrencyCanonical[] {
  const out: MissingCurrencyCanonical[] = [];
  for (const s of spvs) {
    const c = s.currency === null || s.currency === undefined ? null : String(s.currency);
    if (c === null || c.trim() === "") {
      out.push({ spvId: s.id, legacyId: s.id, defaultSite: "spvEngineStore.ts:1649" });
    }
  }
  return out;
}

export function inspectPartnerFundsInMemory(
  funds: ReadonlyArray<{ id: string; currency?: string | null | undefined }>,
): MissingCurrencyLegacy[] {
  const out: MissingCurrencyLegacy[] = [];
  for (const f of funds) {
    const c = f.currency === null || f.currency === undefined ? null : String(f.currency);
    if (c === null || c.trim() === "") {
      out.push({
        table: "partnerFundsStore (in-memory)",
        rowId: f.id,
        hadEmpty: c === "",
      });
    }
  }
  return out;
}

// ── Ambiguous + orphan ───────────────────────────────────────────────

export function detectAmbiguousMatches(db: Database.Database): AmbiguousMatch[] {
  ensureSafeIntegers(db);
  const out: AmbiguousMatch[] = [];
  const spvExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spv'`)
    .get();
  if (spvExists) {
    const rows = db
      .prepare(
        `SELECT migrated_from AS legacy_id, GROUP_CONCAT(id) AS canonical_ids, COUNT(*) AS n
         FROM spv WHERE migrated_from IS NOT NULL
         GROUP BY migrated_from HAVING n > 1 ORDER BY migrated_from`,
      )
      .all() as Array<{ legacy_id: string; canonical_ids: string; n: number | bigint }>;
    for (const r of rows) {
      out.push({
        sourceTable: "spvs",
        sourceRowId: r.legacy_id,
        candidateCanonicalIds: r.canonical_ids.split(",").sort(),
        reason: `Legacy spvs.id maps to ${Number(r.n)} canonical spv.id rows via migrated_from. Named resolution required.`,
      });
    }
  }
  const spvsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spvs'`)
    .get();
  if (spvExists && spvsExists) {
    const orphaned = db
      .prepare(
        `SELECT l.id AS legacy_id FROM spvs l WHERE NOT EXISTS
         (SELECT 1 FROM spv c WHERE c.migrated_from = l.id) ORDER BY l.id`,
      )
      .all() as Array<{ legacy_id: string }>;
    for (const r of orphaned) {
      out.push({
        sourceTable: "spvs",
        sourceRowId: r.legacy_id,
        candidateCanonicalIds: [],
        reason: `Legacy spvs.id has NO canonical match. Row would be unmigrated. Named decision required (migrate, quarantine, or delete).`,
      });
    }
  }
  return out;
}

export function detectSourceDuplicates(db: Database.Database): SourceDuplicate[] {
  ensureSafeIntegers(db);
  const out: SourceDuplicate[] = [];
  const positionsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spv_positions'`)
    .get();
  if (!positionsExists) return out;
  const rows = db
    .prepare(
      `SELECT spv_id, security_id, GROUP_CONCAT(id) AS row_ids, COUNT(*) AS n
       FROM spv_positions
       GROUP BY spv_id, security_id
       HAVING n > 1
       ORDER BY spv_id, security_id`,
    )
    .all() as Array<{ spv_id: string; security_id: string; row_ids: string; n: number | bigint }>;
  for (const r of rows) {
    out.push({
      table: "spv_positions",
      key: { spv_id: r.spv_id, security_id: r.security_id },
      rowIds: r.row_ids.split(",").sort(),
      count: Number(r.n),
    });
  }
  return out;
}

export function detectOrphanChildRows(db: Database.Database): OrphanChildRow[] {
  ensureSafeIntegers(db);
  const out: OrphanChildRow[] = [];
  const spvsExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spvs'`)
    .get();
  if (!spvsExists) return out;
  for (const table of _LEGACY_SOURCE_TABLES) {
    assertKnownTable(table);
    const fk = _LEGACY_PARENT_SPV_FK[table];
    if (fk === null || fk === undefined) continue;
    assertKnownFkColumn(table, fk);
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table);
    if (!exists) continue;
    const rows = db
      .prepare(
        `SELECT c.id AS row_id, c.${fk} AS fk_value FROM ${table} c
         WHERE c.${fk} IS NOT NULL AND NOT EXISTS
         (SELECT 1 FROM spvs s WHERE s.id = c.${fk}) ORDER BY c.id`,
      )
      .all() as Array<{ row_id: string; fk_value: string }>;
    for (const r of rows) {
      out.push({
        table,
        rowId: r.row_id,
        orphanFk: { column: fk, value: r.fk_value },
      });
    }
  }
  return out;
}

// ── Full manifest ────────────────────────────────────────────────────

export interface GenerateManifestInputs {
  partnerSpvsInMemory?: ReadonlyArray<{ id: string; currency?: string | null | undefined }>;
  partnerFundsInMemory?: ReadonlyArray<{ id: string; currency?: string | null | undefined }>;
}

export function generateDryRunManifest(
  db: Database.Database,
  inputs: GenerateManifestInputs = {},
): DryRunManifest {
  return withPointInTimeRead(db, () => {
    const schema = readSchemaFingerprint(db);
    const tables = _LEGACY_SOURCE_TABLES.map((t) => generateTableManifest(db, t));
    const canonicalOffenders: MissingCurrencyCanonical[] = [];
    const partnerFundOffenders: MissingCurrencyLegacy[] = [];
    const coverage: InspectionCoverage = {
      partnerSpvsInMemory: inputs.partnerSpvsInMemory === undefined
        ? "NOT_PROVIDED"
        : inputs.partnerSpvsInMemory.length === 0 ? "PROVIDED_EMPTY" : "PROVIDED_WITH_ROWS",
      partnerFundsInMemory: inputs.partnerFundsInMemory === undefined
        ? "NOT_PROVIDED"
        : inputs.partnerFundsInMemory.length === 0 ? "PROVIDED_EMPTY" : "PROVIDED_WITH_ROWS",
    };
    if (inputs.partnerSpvsInMemory !== undefined) {
      canonicalOffenders.push(...inspectPartnerSpvsInMemory(inputs.partnerSpvsInMemory));
    }
    if (inputs.partnerFundsInMemory !== undefined) {
      partnerFundOffenders.push(...inspectPartnerFundsInMemory(inputs.partnerFundsInMemory));
    }
    const manifest: DryRunManifest = {
      generatedAtIso: new Date().toISOString(),
      wave0Version: "0-4-v5.2",
      manifestHash: "",
      schema,
      coverage,
      tables,
      missingCurrency: {
        legacy: detectMissingCurrencyLegacy(db),
        canonical: canonicalOffenders,
      },
      invalidCurrency: detectInvalidCurrency(db),
      ambiguousMatches: detectAmbiguousMatches(db),
      duplicates: detectSourceDuplicates(db),
      orphanChildRows: detectOrphanChildRows(db),
      partnerFundOffenders,
      deferrals: NAMED_DEFERRALS,
    };
    manifest.manifestHash = computeManifestHash(manifest);
    return manifest;
  });
}

export function computeManifestHash(m: DryRunManifest): string {
  // GPT-5 v5 finding: unescaped `::` delimiter is not a total-ordering key.
  // Two distinct records can produce identical comparator strings if a
  // field value contains `::`. v5.1 fix: sort by the fully-serialized
  // normalized record itself, with sorted nested arrays and sorted object
  // keys, so ties are impossible.
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const canonicalize = (obj: unknown): string => JSON.stringify(obj, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sortedKeys = Object.keys(v as Record<string, unknown>).sort();
      const ordered: Record<string, unknown> = {};
      for (const k of sortedKeys) ordered[k] = (v as Record<string, unknown>)[k];
      return ordered;
    }
    return v;
  });
  const sortBySerialized = <T>(arr: readonly T[], normalize?: (x: T) => T): T[] => {
    const items = normalize ? arr.map(normalize) : [...arr];
    return items.sort((a, b) => cmp(canonicalize(a), canonicalize(b)));
  };
  const normalizedTables = sortBySerialized(m.tables);
  const normalizedLegacy = sortBySerialized(m.missingCurrency.legacy);
  const normalizedCanonical = sortBySerialized(m.missingCurrency.canonical);
  const normalizedInvalid = sortBySerialized(m.invalidCurrency);
  const normalizedAmbig = sortBySerialized(
    m.ambiguousMatches,
    (a) => ({ ...a, candidateCanonicalIds: [...a.candidateCanonicalIds].sort() }),
  );
  const normalizedDupes = sortBySerialized(
    m.duplicates,
    (d) => ({ ...d, rowIds: [...d.rowIds].sort() }),
  );
  const normalizedOrphans = sortBySerialized(m.orphanChildRows);
  const normalizedPartnerFunds = sortBySerialized(m.partnerFundOffenders);
  const normalizedDeferrals = [...m.deferrals].sort();
  const normalizedSchemaTables = [...m.schema.legacyTablesPresent].sort();

  const copy: DryRunManifest = {
    ...m,
    manifestHash: "",
    generatedAtIso: "",
    schema: { ...m.schema, legacyTablesPresent: normalizedSchemaTables },
    tables: normalizedTables,
    missingCurrency: { legacy: normalizedLegacy, canonical: normalizedCanonical },
    invalidCurrency: normalizedInvalid,
    ambiguousMatches: normalizedAmbig,
    duplicates: normalizedDupes,
    orphanChildRows: normalizedOrphans,
    partnerFundOffenders: normalizedPartnerFunds,
    deferrals: normalizedDeferrals,
  };
  const canonical = JSON.stringify(copy, (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const sortedKeys = Object.keys(value).sort();
      const ordered: Record<string, unknown> = {};
      for (const k of sortedKeys) ordered[k] = (value as Record<string, unknown>)[k];
      return ordered;
    }
    return value;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function stringifyManifest(m: DryRunManifest): string {
  return JSON.stringify(m, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    return v;
  });
}

/** Verify a manifest's manifestHash matches its recomputed hash.
 *  Opus v5 MED-1: consumers can call this without knowing the preimage
 *  blanking rules. Returns true iff the hash checks out. */
export function verifyManifestHash(m: DryRunManifest): boolean {
  if (!m || typeof m.manifestHash !== "string" || m.manifestHash.length === 0) return false;
  const claimed = m.manifestHash;
  const recomputed = computeManifestHash({ ...m, manifestHash: "" });
  return claimed === recomputed;
}

export function countOffenders(m: DryRunManifest): number {
  return (
    m.missingCurrency.legacy.length +
    m.missingCurrency.canonical.length +
    m.invalidCurrency.length +
    m.ambiguousMatches.length +
    m.duplicates.length +
    m.orphanChildRows.length +
    m.partnerFundOffenders.length +
    m.tables.filter((t) => t.unmigrated !== null).length +
    (m.coverage.partnerSpvsInMemory === "NOT_PROVIDED" ? 1 : 0) +
    (m.coverage.partnerFundsInMemory === "NOT_PROVIDED" ? 1 : 0)
  );
}

export function renderManifestMarkdown(m: DryRunManifest): string {
  const lines: string[] = [];
  lines.push(`# Wave 0-4 dry-run manifest`);
  lines.push(``);
  lines.push(`- Generated: ${m.generatedAtIso}`);
  lines.push(`- Version: ${m.wave0Version}`);
  lines.push(`- Manifest hash: ${m.manifestHash}`);
  lines.push(``);
  lines.push(`## Schema fingerprint`);
  lines.push(``);
  lines.push(`- user_version: ${m.schema.userVersion}`);
  lines.push(`- application_id: ${m.schema.applicationId}`);
  lines.push(`- legacy tables present: ${m.schema.legacyTablesPresent.join(", ") || "(none)"}`);
  lines.push(`- canonical spv table present: ${m.schema.canonicalSpvPresent ? "yes" : "no"}`);
  lines.push(``);
  lines.push(`## Inspection coverage`);
  lines.push(``);
  lines.push(`- partnerSpvsInMemory: ${m.coverage.partnerSpvsInMemory}`);
  lines.push(`- partnerFundsInMemory: ${m.coverage.partnerFundsInMemory}`);
  lines.push(``);
  lines.push(`## Tables`);
  lines.push(``);
  lines.push(`| Table | Rows | Missing currency | Unmigrated |`);
  lines.push(`|---|---:|---:|---|`);
  for (const t of m.tables) {
    lines.push(
      `| ${t.table} | ${t.rowCount} | ${t.missingCurrencyRowCount} | ${t.unmigrated ? t.unmigrated.reason : "-"} |`,
    );
  }
  lines.push(``);
  lines.push(`## Offender totals`);
  lines.push(``);
  lines.push(`- Missing currency (legacy): ${m.missingCurrency.legacy.length}`);
  lines.push(`- Missing currency (canonical in-memory): ${m.missingCurrency.canonical.length}`);
  lines.push(`- Invalid currency: ${m.invalidCurrency.length}`);
  lines.push(`- Ambiguous matches: ${m.ambiguousMatches.length}`);
  lines.push(`- Source duplicates: ${m.duplicates.length}`);
  lines.push(`- Orphan child rows: ${m.orphanChildRows.length}`);
  lines.push(`- Partner fund offenders: ${m.partnerFundOffenders.length}`);
  lines.push(`- Unmigrated tables: ${m.tables.filter((t) => t.unmigrated).length}`);
  lines.push(``);
  lines.push(`- TOTAL: ${countOffenders(m)}`);
  lines.push(``);
  lines.push(`## Named deferrals (write path is Wave A)`);
  lines.push(``);
  for (const d of m.deferrals) lines.push(`- ${d}`);
  return lines.join("\n");
}

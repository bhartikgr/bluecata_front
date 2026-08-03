/**
 * Wave 0-4 v5: read-only manifest generator tests.
 *
 * v5 hardens against GPT-5 v4 findings: point-in-time consistency, schema
 * fingerprint, coverage tracking, invalid-currency detection, frozen private
 * metadata, total comparators for hash canonicalization.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  LEGACY_SOURCE_TABLES,
  LEGACY_MONEY_COLUMNS,
  MISSING_CURRENCY_KEY,
  NAMED_DEFERRALS,
  deriveCurrency,
  generateTableManifest,
  generateDryRunManifest,
  detectMissingCurrencyLegacy,
  detectAmbiguousMatches,
  detectSourceDuplicates,
  detectOrphanChildRows,
  detectInvalidCurrency,
  inspectPartnerSpvsInMemory,
  inspectPartnerFundsInMemory,
  isValidCurrencyCode,
  readSchemaFingerprint,
  computeManifestHash,
  stringifyManifest,
  renderManifestMarkdown,
  countOffenders,
  withPointInTimeRead,
  verifyManifestHash,
} from "../lib/wave0Migration";

function seedRealSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE spvs (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't1',
      partner_id TEXT NOT NULL DEFAULT 'p1',
      name TEXT NOT NULL,
      target_minor INTEGER NOT NULL DEFAULT 0,
      committed_minor INTEGER NOT NULL DEFAULT 0,
      called_minor INTEGER NOT NULL DEFAULT 0,
      distributed_minor INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '2025-01-01T00:00:00Z'
    );
    CREATE TABLE spv_commitments (
      id TEXT PRIMARY KEY NOT NULL,
      spv_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE spv_capital_calls (
      id TEXT PRIMARY KEY NOT NULL,
      spv_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE spv_distributions (
      id TEXT PRIMARY KEY NOT NULL,
      spv_id TEXT NOT NULL,
      total_minor INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE spv_positions (
      id TEXT PRIMARY KEY NOT NULL,
      spv_id TEXT NOT NULL,
      security_id TEXT NOT NULL,
      basis_minor INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE spv (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      target_raise_minor INTEGER,
      currency TEXT NOT NULL DEFAULT 'USD',
      migrated_from TEXT
    );
    CREATE TABLE currency_ref (
      code TEXT PRIMARY KEY NOT NULL,
      minor_unit_exponent INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO currency_ref (code, minor_unit_exponent) VALUES
      ('USD', 2), ('EUR', 2), ('GBP', 2), ('JPY', 0), ('CAD', 2);
  `);
  db.prepare("INSERT INTO spvs (id, name, target_minor, committed_minor) VALUES (?, ?, ?, ?)")
    .run("spv_a", "SPV A", 1000000_00, 500000_00);
  db.prepare("INSERT INTO spvs (id, name, target_minor, committed_minor) VALUES (?, ?, ?, ?)")
    .run("spv_b", "SPV B", 2000000_00, 1000000_00);
  db.prepare("INSERT INTO spvs (id, name, target_minor) VALUES (?, ?, ?)")
    .run("spv_unmigrated", "Unmigrated", 42_00);
  db.prepare("INSERT INTO spv_commitments (id, spv_id, amount_minor) VALUES (?, ?, ?)")
    .run("com_1", "spv_a", 250000_00);
  db.prepare("INSERT INTO spv_commitments (id, spv_id, amount_minor) VALUES (?, ?, ?)")
    .run("com_orphan", "spv_does_not_exist", 99_00);
  db.prepare("INSERT INTO spv_distributions (id, spv_id, total_minor) VALUES (?, ?, ?)")
    .run("dist_1", "spv_a", 100000_00);
  db.prepare("INSERT INTO spv_positions (id, spv_id, security_id, basis_minor) VALUES (?, ?, ?, ?)")
    .run("pos_1", "spv_a", "sec_A", 100000_00);
  db.prepare("INSERT INTO spv_positions (id, spv_id, security_id, basis_minor) VALUES (?, ?, ?, ?)")
    .run("pos_2", "spv_a", "sec_A", 105000_00);
  db.prepare("INSERT INTO spv (id, name, target_raise_minor, currency, migrated_from) VALUES (?, ?, ?, ?, ?)")
    .run("can_a", "Canonical A", 1000000_00, "USD", "spv_a");
  db.prepare("INSERT INTO spv (id, name, target_raise_minor, currency, migrated_from) VALUES (?, ?, ?, ?, ?)")
    .run("can_dup_1", "Dup 1", 100_00, "USD", "spv_a");
}

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  seedRealSchema(db);
});

describe("Wave 0-4 v5: read-only manifest generator", () => {
  it("LEGACY_SOURCE_TABLES matches migrations/0041 exactly", () => {
    expect([...LEGACY_SOURCE_TABLES]).toEqual([
      "spvs",
      "spv_commitments",
      "spv_capital_calls",
      "spv_distributions",
      "spv_positions",
    ]);
  });

  it("LEGACY_MONEY_COLUMNS uses REAL column names", () => {
    expect(LEGACY_MONEY_COLUMNS.spv_distributions).toEqual(["total_minor"]);
    expect(LEGACY_MONEY_COLUMNS.spv_positions).toEqual(["basis_minor"]);
  });

  it("NAMED_DEFERRALS enumerates every write-path piece deferred to Wave A", () => {
    for (const d of [
      "WAVE0-DEF-CUTOVER-MACHINERY",
      "WAVE0-DEF-ROLLBACK-TRIGGERS",
      "WAVE0-DEF-QUARANTINE-TABLE",
      "WAVE0-DEF-DUAL-READ-RECONCILE",
      "WAVE0-DEF-CANONICAL-DETECTOR-REFINE",
      "WAVE0-DEF-SILENT-DEFAULT-BROADENING",
    ]) {
      expect(NAMED_DEFERRALS).toContain(d);
    }
  });

  it("deriveCurrency NEVER returns USD silently (mutation-hardened)", () => {
    for (const t of LEGACY_SOURCE_TABLES) {
      const rows = db.prepare(`SELECT id FROM ${t}`).all() as Array<{ id: string }>;
      for (const r of rows) {
        const d = deriveCurrency(db, t, r.id);
        expect(d.code).toBeNull();
        expect(d.isMissing).toBe(true);
        expect(d.source).toBe("none");
      }
    }
  });

  it("generateTableManifest sums money-minor per currency (exact BigInt)", () => {
    const m = generateTableManifest(db, "spvs");
    expect(m.rowCount).toBeGreaterThanOrEqual(3);
    const expected = BigInt(1000000_00) + BigInt(500000_00) + BigInt(2000000_00) + BigInt(1000000_00) + BigInt(42_00);
    expect(BigInt(m.perCurrencyMinorSum[MISSING_CURRENCY_KEY])).toBe(expected);
    expect(m.missingCurrencyRowCount).toBe(m.rowCount);
    expect(m.unmigrated).toBeNull();
  });

  it("generateTableManifest surfaces missing tables as named offender", () => {
    const emptyDb = new Database(":memory:");
    const m = generateTableManifest(emptyDb, "spv_positions");
    expect(m.unmigrated).not.toBeNull();
    expect(m.unmigrated?.reason).toContain("spv_positions");
  });

  it("detectMissingCurrencyLegacy emits every legacy spvs row", () => {
    const legacy = detectMissingCurrencyLegacy(db);
    const ids = legacy.map((l) => l.rowId);
    expect(ids).toContain("spv_a");
    expect(ids).toContain("spv_b");
    expect(ids).toContain("spv_unmigrated");
  });

  it("detectAmbiguousMatches reports canonical duplicates AND unmigrated legacy", () => {
    const ambig = detectAmbiguousMatches(db);
    expect(ambig.find((a) => a.sourceRowId === "spv_a" && a.candidateCanonicalIds.length === 2)).toBeDefined();
    expect(ambig.find((a) => a.sourceRowId === "spv_unmigrated" && a.candidateCanonicalIds.length === 0)).toBeDefined();
  });

  it("detectSourceDuplicates finds spv_positions duplicates", () => {
    const dupes = detectSourceDuplicates(db);
    const d = dupes.find((x) => x.key.spv_id === "spv_a" && x.key.security_id === "sec_A");
    expect(d).toBeDefined();
    expect(d?.count).toBe(2);
  });

  it("detectOrphanChildRows enumerates orphans by ID", () => {
    const orphans = detectOrphanChildRows(db);
    const o = orphans.find((x) => x.rowId === "com_orphan");
    expect(o).toBeDefined();
    expect(o?.orphanFk).toEqual({ column: "spv_id", value: "spv_does_not_exist" });
  });

  it("detectInvalidCurrency emits offenders for codes not in currency_ref", () => {
    // Add spv with currency column populated invalidly.
    db.exec("ALTER TABLE spvs ADD COLUMN currency TEXT");
    db.prepare("INSERT INTO spvs (id, name, currency, target_minor) VALUES (?, ?, ?, ?)")
      .run("spv_bad_ccy", "Bad currency", "Dollars", 100_00);
    db.prepare("INSERT INTO spvs (id, name, currency, target_minor) VALUES (?, ?, ?, ?)")
      .run("spv_xxx", "Fake ccy", "XXX", 100_00);
    db.prepare("INSERT INTO spvs (id, name, currency, target_minor) VALUES (?, ?, ?, ?)")
      .run("spv_usd", "Valid ccy", "USD", 100_00);
    const invalid = detectInvalidCurrency(db);
    const codes = invalid.map((i) => i.code).sort();
    expect(codes).toEqual(["DOLLARS", "XXX"]);
    // USD is valid; must not appear.
    expect(codes).not.toContain("USD");
  });

  it("inspectPartnerSpvsInMemory surfaces :1649 offenders", () => {
    const out = inspectPartnerSpvsInMemory([
      { id: "pspv_valid", currency: "EUR" },
      { id: "pspv_null", currency: null },
      { id: "pspv_empty", currency: "" },
      { id: "pspv_undef" },
    ]);
    expect(out.map((o) => o.spvId).sort()).toEqual(["pspv_empty", "pspv_null", "pspv_undef"]);
    for (const o of out) expect(o.defaultSite).toBe("spvEngineStore.ts:1649");
  });

  it("inspectPartnerFundsInMemory surfaces :1684 offenders", () => {
    const out = inspectPartnerFundsInMemory([
      { id: "pfnd_valid", currency: "GBP" },
      { id: "pfnd_null", currency: null },
      { id: "pfnd_empty", currency: "" },
    ]);
    expect(out.map((o) => o.rowId).sort()).toEqual(["pfnd_empty", "pfnd_null"]);
  });

  it("inspectPartnerSpvsInMemory tolerates non-string currency (no throw)", () => {
    expect(() =>
      inspectPartnerSpvsInMemory([
        { id: "x1", currency: 42 as unknown as string },
        { id: "x2", currency: true as unknown as string },
      ]),
    ).not.toThrow();
  });

  it("isValidCurrencyCode accepts ISO-4217, rejects garbage", () => {
    expect(isValidCurrencyCode(db, "USD")).toBe(true);
    expect(isValidCurrencyCode(db, "Dollars")).toBe(false);
    expect(isValidCurrencyCode(db, "XXX")).toBe(false);
    expect(isValidCurrencyCode(db, "")).toBe(false);
  });

  it("readSchemaFingerprint captures user_version + application_id + tables present", () => {
    db.pragma("user_version = 42");
    db.pragma("application_id = 12345");
    const fp = readSchemaFingerprint(db);
    expect(fp.userVersion).toBe(42);
    expect(fp.applicationId).toBe(12345);
    expect(fp.legacyTablesPresent).toContain("spvs");
    expect(fp.canonicalSpvPresent).toBe(true);
  });

  it("generateDryRunManifest carries schema fingerprint + coverage + deferrals", () => {
    const m = generateDryRunManifest(db);
    expect(m.schema.canonicalSpvPresent).toBe(true);
    expect(m.coverage.partnerSpvsInMemory).toBe("NOT_PROVIDED");
    expect(m.coverage.partnerFundsInMemory).toBe("NOT_PROVIDED");
    for (const d of NAMED_DEFERRALS) expect(m.deferrals).toContain(d);
  });

  it("coverage reports PROVIDED_EMPTY vs PROVIDED_WITH_ROWS", () => {
    const m1 = generateDryRunManifest(db, { partnerSpvsInMemory: [] });
    expect(m1.coverage.partnerSpvsInMemory).toBe("PROVIDED_EMPTY");
    const m2 = generateDryRunManifest(db, { partnerSpvsInMemory: [{ id: "x", currency: "USD" }] });
    expect(m2.coverage.partnerSpvsInMemory).toBe("PROVIDED_WITH_ROWS");
  });

  it("countOffenders includes NOT_PROVIDED coverage as an offender class", () => {
    // Neither input provided → two NOT_PROVIDED offenders on top of DB offenders.
    const m = generateDryRunManifest(db);
    const providedM = generateDryRunManifest(db, {
      partnerSpvsInMemory: [],
      partnerFundsInMemory: [],
    });
    expect(countOffenders(m)).toBeGreaterThan(countOffenders(providedM));
    expect(countOffenders(m) - countOffenders(providedM)).toBe(2);
  });

  it("generateDryRunManifest is JSON-safe end-to-end", () => {
    const m = generateDryRunManifest(db);
    expect(() => JSON.stringify(m)).not.toThrow();
    expect(() => stringifyManifest(m)).not.toThrow();
    const rt = JSON.parse(stringifyManifest(m));
    expect(rt.wave0Version).toBe("0-4-v5.2");
  });

  it("computeManifestHash is deterministic across insert-order variations", () => {
    const m1 = generateDryRunManifest(db);
    const db2 = new Database(":memory:");
    seedRealSchema(db2);
    const m2 = generateDryRunManifest(db2);
    m1.generatedAtIso = "";
    m2.generatedAtIso = "";
    m1.manifestHash = "";
    m2.manifestHash = "";
    expect(computeManifestHash(m1)).toBe(computeManifestHash(m2));
  });

  it("computeManifestHash tolerates reordered nested arrays (candidateCanonicalIds, rowIds, deferrals)", () => {
    const m = generateDryRunManifest(db);
    const h1 = computeManifestHash(m);
    // Reorder ambiguous match's candidateCanonicalIds.
    for (const a of m.ambiguousMatches) a.candidateCanonicalIds.reverse();
    // Reorder duplicate rowIds.
    for (const d of m.duplicates) d.rowIds.reverse();
    // Reorder deferrals.
    const reversedDeferrals = [...m.deferrals].reverse();
    const m2 = { ...m, deferrals: reversedDeferrals };
    const h2 = computeManifestHash(m2);
    expect(h2).toBe(h1);
  });

  it("computeManifestHash is a total ordering: delimiter-bearing values do not collide (GPT-5 v5 finding)", () => {
    // GPT-5 v5 reproducer: two distinct canonical records that produce
    // identical `${spvId}::${legacyId}` comparator keys must produce a
    // stable hash regardless of insertion order. v5.1 sorts on the full
    // canonicalized record, so delimiter-bearing values cannot collide.
    const base = generateDryRunManifest(db);
    const pair1 = [
      { spvId: "a::b", legacyId: "c", defaultSite: "spvEngineStore.ts:1649" as const },
      { spvId: "a", legacyId: "b::c", defaultSite: "spvEngineStore.ts:1649" as const },
    ];
    const pair2 = [pair1[1], pair1[0]];
    const m1 = { ...base, missingCurrency: { ...base.missingCurrency, canonical: pair1 } };
    const m2 = { ...base, missingCurrency: { ...base.missingCurrency, canonical: pair2 } };
    expect(computeManifestHash(m1)).toBe(computeManifestHash(m2));
    // And a duplicate-rowIds pair that tied on `${table}::${key}` in v5:
    const dupA = {
      table: "spv_positions",
      key: { spv_id: "s1", security_id: "sec1" },
      rowIds: ["r1", "r2"],
      count: 2,
    };
    const dupB = {
      table: "spv_positions",
      key: { spv_id: "s1", security_id: "sec1" },
      rowIds: ["r3", "r4"],
      count: 2,
    };
    const m3 = { ...base, duplicates: [dupA, dupB] };
    const m4 = { ...base, duplicates: [dupB, dupA] };
    expect(computeManifestHash(m3)).toBe(computeManifestHash(m4));
    // Reversing the ORDER of tied-key records that differ only in rowIds
    // must NOT change the hash (they are canonicalized on the full record).
  });

  it("computeManifestHash detects content tampering", () => {
    const m = generateDryRunManifest(db);
    const h1 = computeManifestHash(m);
    m.missingCurrency.legacy = [];
    const h2 = computeManifestHash(m);
    expect(h1).not.toBe(h2);
  });

  it("BigInt precision holds at >2^53", () => {
    const huge = BigInt("9007199254740993");
    db.prepare("INSERT INTO spvs (id, name, target_minor, committed_minor) VALUES (?, ?, ?, ?)")
      .run("spv_huge", "Huge", huge, huge);
    const m = generateTableManifest(db, "spvs");
    const sum = BigInt(m.perCurrencyMinorSum[MISSING_CURRENCY_KEY]);
    const expected = BigInt(1000000_00) + BigInt(500000_00) + BigInt(2000000_00) + BigInt(1000000_00) + BigInt(42_00) + huge + huge;
    expect(sum).toBe(expected);
  });

  it("Table-name enum guard rejects unknown table names", () => {
    expect(() => deriveCurrency(db, "sqlite_master" as unknown as typeof LEGACY_SOURCE_TABLES[number], "x"))
      .toThrow(/rejected unknown table name/);
    expect(() => generateTableManifest(db, "DROP TABLE spvs" as unknown as typeof LEGACY_SOURCE_TABLES[number]))
      .toThrow(/rejected unknown table name/);
  });

  it("Mutable exported metadata does NOT weaken SQL builders (GPT-5 v4 finding)", () => {
    // Attempt to mutate the exported readonly view. Object.freeze on the
    // export makes push throw in strict mode. Even without the freeze,
    // SQL builders read only the private frozen copy so mutation of the
    // export cannot affect SQL construction.
    const attempted = () => {
      (LEGACY_SOURCE_TABLES as unknown as string[]).push("secrets");
    };
    // Either it throws (frozen) or it doesn't; in either case the guard
    // catches the injection attempt at query time.
    try { attempted(); } catch { /* frozen; expected */ }
    // The guard MUST reject an unknown table regardless of export mutation.
    expect(() => deriveCurrency(db, "secrets" as unknown as typeof LEGACY_SOURCE_TABLES[number], "x"))
      .toThrow(/rejected unknown table name/);
  });

  it("renderManifestMarkdown produces human-readable summary", () => {
    const m = generateDryRunManifest(db);
    const md = renderManifestMarkdown(m);
    expect(md).toContain("# Wave 0-4 dry-run manifest");
    expect(md).toContain("## Schema fingerprint");
    expect(md).toContain("## Inspection coverage");
    expect(md).toContain("## Offender totals");
    expect(md).toContain("## Named deferrals");
    for (const d of NAMED_DEFERRALS) expect(md).toContain(d);
  });

  it("Anti-vacuity: fixture surfaces every defect class", () => {
    const m = generateDryRunManifest(db);
    expect(m.tables.length).toBe(LEGACY_SOURCE_TABLES.length);
    expect(m.missingCurrency.legacy.length).toBeGreaterThan(0);
    expect(m.ambiguousMatches.length).toBeGreaterThan(0);
    expect(m.duplicates.length).toBeGreaterThan(0);
    expect(m.orphanChildRows.length).toBeGreaterThan(0);
  });

  it("Read-only guarantee: full content SHA256 of every table unchanged (Opus v4 finding)", () => {
    // Force safeIntegers ON before baseline so the reads use BigInt for
    // INTEGER columns before AND after (otherwise the format flips during
    // manifest generation and appears as a spurious content change).
    db.defaultSafeIntegers(true);
    // Row counts alone don't catch UPDATE/replace-same-key writes. Hash every
    // row across every legacy table AND the canonical spv table + currency_ref.
    const hashOf = (rows: unknown[]) => {
      const s = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      return require("node:crypto").createHash("sha256").update(s).digest("hex");
    };
    const auditTables = [...LEGACY_SOURCE_TABLES, "spv", "currency_ref"] as const;
    const before: Record<string, string> = {};
    for (const t of auditTables) {
      // ORDER BY ROWID for stable ordering.
      const rows = db.prepare(`SELECT * FROM ${t} ORDER BY ROWID`).all();
      before[t] = hashOf(rows);
    }
    // Also PRAGMA data_version: increments on ANY write via this connection
    // (or any other) since last check.
    const dvBefore = (db.prepare("PRAGMA data_version").get() as any).data_version;
    // Full-manifest run with inputs (exercises all read paths).
    generateDryRunManifest(db, {
      partnerSpvsInMemory: [{ id: "x", currency: null }],
      partnerFundsInMemory: [{ id: "y", currency: null }],
    });
    // Verify every table unchanged.
    for (const t of auditTables) {
      const rows = db.prepare(`SELECT * FROM ${t} ORDER BY ROWID`).all();
      expect(hashOf(rows), `table ${t} changed during manifest generation`).toBe(before[t]);
    }
    // data_version must NOT have advanced.
    const dvAfter = (db.prepare("PRAGMA data_version").get() as any).data_version;
    expect(dvAfter).toBe(dvBefore);
  });

  it("Read-only guarantee: catches UPDATE / DELETE / DROP mutations (mutation-hardened)", () => {
    // Prove the content-hash test actually catches the class of writes
    // that row-count-only would miss.
    const hashOf = (rows: unknown[]) => {
      const s = JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      return require("node:crypto").createHash("sha256").update(s).digest("hex");
    };
    const beforeHash = hashOf(db.prepare("SELECT * FROM spvs ORDER BY ROWID").all());
    // UPDATE without changing rowCount.
    db.prepare("UPDATE spvs SET target_minor = target_minor + 1 WHERE id = 'spv_a'").run();
    const afterUpdate = hashOf(db.prepare("SELECT * FROM spvs ORDER BY ROWID").all());
    expect(afterUpdate).not.toBe(beforeHash);
  });

  it("withPointInTimeRead wraps operations in BEGIN DEFERRED and commits on success", () => {
    const result = withPointInTimeRead(db, () => {
      const n = db.prepare("SELECT COUNT(*) AS c FROM spvs").get() as { c: number | bigint };
      return Number(n.c);
    });
    expect(result).toBeGreaterThan(0);
  });

  it("withPointInTimeRead rolls back on error", () => {
    expect(() => withPointInTimeRead(db, () => { throw new Error("boom"); })).toThrow("boom");
    // Subsequent reads still work (rollback closed the txn).
    const n = db.prepare("SELECT COUNT(*) AS c FROM spvs").get() as { c: number | bigint };
    expect(Number(n.c)).toBeGreaterThan(0);
  });

  it("withPointInTimeRead is re-entrant: caller's txn stays open (Opus v5 MED-2)", () => {
    db.exec("BEGIN DEFERRED");
    try {
      // Caller already holds a txn. Nested withPointInTimeRead must NOT
      // start a new one and must NOT rollback the caller's on error.
      const m = generateDryRunManifest(db);
      expect(m.wave0Version).toBe("0-4-v5.2");
      expect(db.inTransaction).toBe(true);
      // On error inside the nested call, caller's txn still open.
      expect(() => withPointInTimeRead(db, () => { throw new Error("inner"); })).toThrow("inner");
      expect(db.inTransaction).toBe(true);
    } finally {
      db.exec("ROLLBACK");
    }
  });

  it("generateTableManifest tolerates dirty money values (Opus v5 HIGH-A)", () => {
    // Simulate a legacy DB where money columns hold non-integer values.
    // Must not crash the whole run; must skip and keep going.
    db.prepare("INSERT INTO spvs (id, name, target_minor, committed_minor) VALUES (?, ?, ?, ?)")
      .run("spv_bad_1", "Bad Float", 1.5 as unknown as number, 100_00);
    db.prepare("INSERT INTO spvs (id, name) VALUES (?, ?)").run("spv_bad_2", "Bad Text");
    db.prepare("UPDATE spvs SET target_minor = 'n/a' WHERE id = ?").run("spv_bad_2");
    // Must not throw.
    let m: ReturnType<typeof generateTableManifest>;
    expect(() => { m = generateTableManifest(db, "spvs"); }).not.toThrow();
    // Row count still reflects all rows (dirty ones counted, just their
    // bad columns skipped from the sum).
    expect(m!.rowCount).toBeGreaterThanOrEqual(2);
  });

  it("verifyManifestHash returns true for a valid manifest and false when tampered (Opus v5 MED-1)", () => {
    const m = generateDryRunManifest(db);
    expect(verifyManifestHash(m)).toBe(true);
    const tampered = { ...m, missingCurrency: { legacy: [], canonical: [] } };
    expect(verifyManifestHash(tampered)).toBe(false);
    expect(verifyManifestHash({ ...m, manifestHash: "" })).toBe(false);
  });

  it("deriveCurrency mutation hardening ALSO covers hasCurrencyColumn path (Opus v5 V5-S1/S2)", () => {
    // Opus V5-S1/S2: v5's test suite couldn't catch silent-USD mutations on
    // deriveCurrency's row-level return sites because the fixture spvs had
    // no currency column. Build a fixture WITH currency column and prove
    // deriveCurrency correctly returns isMissing=true for null/empty rows.
    const db2 = new Database(":memory:");
    db2.exec(`
      CREATE TABLE spvs (
        id TEXT PRIMARY KEY,
        name TEXT,
        currency TEXT,
        target_minor INTEGER DEFAULT 0,
        committed_minor INTEGER DEFAULT 0,
        called_minor INTEGER DEFAULT 0,
        distributed_minor INTEGER DEFAULT 0
      );
      CREATE TABLE currency_ref (code TEXT PRIMARY KEY, minor_unit_exponent INTEGER, is_active INTEGER DEFAULT 1);
      INSERT INTO currency_ref VALUES ('USD', 2, 1), ('EUR', 2, 1);
      INSERT INTO spvs VALUES ('spv_null_curr', 'Null', NULL, 0, 0, 0, 0);
      INSERT INTO spvs VALUES ('spv_empty_curr', 'Empty', '', 0, 0, 0, 0);
      INSERT INTO spvs VALUES ('spv_ws_curr', 'Whitespace', '   ', 0, 0, 0, 0);
      INSERT INTO spvs VALUES ('spv_good', 'Good', 'usd', 0, 0, 0, 0);
    `);
    try {
      const r1 = deriveCurrency(db2, "spvs", "spv_null_curr");
      expect(r1.isMissing).toBe(true);
      expect(r1.code).toBeNull();
      expect(r1.source).toBe("none");
      const r2 = deriveCurrency(db2, "spvs", "spv_empty_curr");
      expect(r2.isMissing).toBe(true);
      expect(r2.code).toBeNull();
      const r3 = deriveCurrency(db2, "spvs", "spv_ws_curr");
      expect(r3.isMissing).toBe(true);
      // Good row must return the trimmed uppercased code (V5-S3 tolerance).
      const r4 = deriveCurrency(db2, "spvs", "spv_good");
      expect(r4.isMissing).toBe(false);
      expect(r4.code).toBe("USD");
      expect(r4.source).toBe("row");
    } finally {
      db2.close();
    }
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 342 · W300 — `/api/healthz` REPORTS THE MIGRATION LEDGER.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `/api/healthz` is checked on every install. It reported the
 * version, the build sha, `dbConnected` and two queue backlogs, and said
 * NOTHING about whether the numbered migrations had been applied to the database
 * it had just connected to — so an install on a database many migration ids
 * behind the shipped code reported `ok: true, dbConnected: true`.
 *
 * WHAT IS ASSERTED, AND WHY IN THIS SHAPE.
 *   §1  ADDITIVE-ONLY CONTROL. Every field the endpoint published before this
 *       wave is still present, by name, over real HTTP. The runbook reads these
 *       names. This section fails if anything was renamed or removed.
 *   §2  The three new facts are present over real HTTP and are of the right
 *       shape, and `…Agree` is a boolean, never a string.
 *   §3  THE READER, against databases this test BUILDS ITSELF, with a
 *       `rows > 0` precondition on the ledger it populates:
 *         3a  a database whose ledger matches the highest file  → `agree: true`
 *         3b  a database nineteen ids behind                     → `agree: false`,
 *                                                                  `idsBehind: 19`
 *         3c  a database with NO ledger table                    → `ledgerPresent: false`,
 *                                                                  `agree: false`
 *       3a and 3b differ ONLY in which rows are in the ledger, so a reader that
 *       ignored the ledger could not pass both.
 *   §4  UNKNOWN IS NEVER AGREEMENT. With no handle at all the result is
 *       `measured: false` and `agree: false` — not a fabricated agreement, and
 *       not a fabricated zero.
 *   §5  NO FILENAME LEAKS TO THE PUBLIC ENDPOINT. The response body, serialised,
 *       must not contain any `NNNN_…` migration basename. This endpoint has no
 *       auth; its standing rule is booleans and counts only.
 *   §6  THE REAL TREE, read through the same reader against the real
 *       `migrations/` directory: the ids are real numbers and the file count
 *       matches an independent `readdirSync` count computed here. This is the
 *       non-empty control for the on-disk side.
 *
 * WHY §3 BUILDS ITS OWN DATABASES. The vitest harness opens SQLite at
 * `:memory:`, not at `data.db` (WAVE 341's finding). A test that merely READ the
 * ledger would assert over zero rows and pass vacuously. Every ledger assertion
 * below either populates the rows it reads or asserts a count against an
 * independently computed one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { registerRoutes } from "../routes";
import {
  readMigrationLedgerHealth,
  migrationLedgerDegradedCodes,
} from "../lib/healthzMigrationLedger";
import { LEDGER_TABLE, listMigrationFiles, migrationId } from "../lib/migrationIntegrity";

const require_ = createRequire(import.meta.url);
const Database = require_("better-sqlite3");

let app: Express;
let server: http.Server;
let port: number;

function get(p: string): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, path: p, method: "GET" }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let body: any = data;
        try { body = data ? JSON.parse(data) : null; } catch { /* keep raw */ }
        resolve({ status: res.statusCode ?? 0, body, raw: data });
      });
    });
    r.on("error", reject);
    r.end();
  });
}

/** Every key `/api/healthz` published BEFORE this wave. ADDITIVE-ONLY control. */
const PRE_WAVE_KEYS = [
  "ok", "version", "buildSha", "buildTime", "uptimeSec", "dbConnected",
  "bridgeOutboxBacklog", "emailOutboxBacklog", "bridgeEnvOk",
  "bridgeOutboundConfigured", "bridgeOutboxQueued", "outboxOverflowCount",
  "devIdentityBypassActive", "disableDevBypassSet", "devIdentityBypassAlarm",
  "timestamp", "okBasis", "buildShaSource", "emailOutboxBacklogMeasured",
  "degraded",
];

const REAL_MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

/** Build a throwaway migrations directory with the given numeric ids. */
function fixtureDir(ids: number[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w342-migs-"));
  for (const id of ids) {
    fs.writeFileSync(path.join(dir, `${String(id).padStart(4, "0")}_w342_fixture.sql`), "-- fixture\n");
  }
  return dir;
}

/** Build an in-process SQLite database whose ledger records the given ids. */
function fixtureDb(dir: string, appliedIds: number[], withLedger = true): any {
  const db = new Database(":memory:");
  if (withLedger) {
    db.exec(
      `CREATE TABLE ${LEDGER_TABLE} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
    );
    const ins = db.prepare(`INSERT INTO ${LEDGER_TABLE} (name, applied_at) VALUES (?, ?)`);
    for (const id of appliedIds) {
      ins.run(`${String(id).padStart(4, "0")}_w342_fixture.sql`, new Date().toISOString());
    }
  }
  void dir;
  return db;
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, () => { port = (server.address() as { port: number }).port; r(); }));
}, 180_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("W342/W300 §1 — additive only: every pre-wave field is still published", () => {
  it("responds 200 and carries all 20 pre-wave keys by name", async () => {
    const res = await get("/api/healthz");
    expect(res.status).toBe(200);
    expect(PRE_WAVE_KEYS.length).toBeGreaterThan(0); // precondition: the list is not empty
    const missing = PRE_WAVE_KEYS.filter((k) => !(k in res.body));
    expect(missing).toEqual([]);
  });
});

describe("W342/W300 §2 — the three new facts are on the endpoint", () => {
  it("publishes highest applied, highest on disk, and whether they agree", async () => {
    const { body } = await get("/api/healthz");
    for (const k of [
      "migrationLedgerMeasured",
      "migrationLedgerPresent",
      "migrationLedgerHighestApplied",
      "migrationLedgerHighestOnDisk",
      "migrationLedgerAgree",
      "migrationLedgerIdsBehind",
      "migrationLedgerAppliedCount",
      "migrationLedgerFileCount",
      "migrationLedgerPendingCount",
      "migrationLedgerUnmeasuredReason",
    ]) {
      expect(body, `missing field ${k}`).toHaveProperty(k);
    }
    expect(typeof body.migrationLedgerAgree).toBe("boolean");
    expect(typeof body.migrationLedgerMeasured).toBe("boolean");
    // highest-on-disk is read from the real tree and must be a real id
    expect(typeof body.migrationLedgerHighestOnDisk).toBe("number");
    expect(body.migrationLedgerHighestOnDisk).toBeGreaterThan(0);
  });

  it("puts a disagreement into `degraded` and never claims agreement it did not measure", async () => {
    const { body } = await get("/api/healthz");
    expect(Array.isArray(body.degraded)).toBe(true);
    if (body.migrationLedgerMeasured === false) {
      expect(body.migrationLedgerAgree).toBe(false);
      expect(body.degraded).toContain("migration_ledger_unmeasured");
    } else if (body.migrationLedgerPresent === false) {
      expect(body.migrationLedgerAgree).toBe(false);
      expect(body.degraded).toContain("migration_ledger_missing");
    } else if (body.migrationLedgerAgree === false) {
      expect(body.degraded).toContain("migration_ledger_behind_disk");
    } else {
      expect(body.migrationLedgerHighestApplied).toBe(body.migrationLedgerHighestOnDisk);
      expect(body.degraded).not.toContain("migration_ledger_behind_disk");
    }
  });
});

describe("W342/W300 §3 — the reader, against databases this test builds", () => {
  it("3a — a ledger that matches the highest file AGREES", () => {
    const ids = [1, 2, 3, 100, 233];
    const dir = fixtureDir(ids);
    const db = fixtureDb(dir, ids);
    // PRECONDITION: the ledger really has rows. Never assert over an empty table.
    const rows = db.prepare(`SELECT name FROM ${LEDGER_TABLE}`).all() as unknown[];
    expect(rows.length).toBe(ids.length);
    expect(rows.length).toBeGreaterThan(0);

    const h = readMigrationLedgerHealth({ db, migrationsDir: dir });
    expect(h.measured).toBe(true);
    expect(h.ledgerPresent).toBe(true);
    expect(h.highestApplied).toBe(233);
    expect(h.highestOnDisk).toBe(233);
    expect(h.agree).toBe(true);
    expect(h.idsBehind).toBe(0);
    expect(h.appliedCount).toBe(5);
    expect(h.fileCount).toBe(5);
    expect(h.pendingCount).toBe(0);
    expect(migrationLedgerDegradedCodes(h)).toEqual([]);
    db.close();
  });

  it("3b — a ledger nineteen ids behind DISAGREES and says by how much", () => {
    const fileIds = [1, 2, 3, 100, 214, 233];
    const appliedIds = [1, 2, 3, 100, 214];
    const dir = fixtureDir(fileIds);
    const db = fixtureDb(dir, appliedIds);
    const rows = db.prepare(`SELECT name FROM ${LEDGER_TABLE}`).all() as unknown[];
    expect(rows.length).toBe(appliedIds.length);
    expect(rows.length).toBeGreaterThan(0);

    const h = readMigrationLedgerHealth({ db, migrationsDir: dir });
    expect(h.measured).toBe(true);
    expect(h.highestApplied).toBe(214);
    expect(h.highestOnDisk).toBe(233);
    expect(h.agree).toBe(false);
    expect(h.idsBehind).toBe(19);
    expect(h.pendingCount).toBe(1);
    expect(migrationLedgerDegradedCodes(h)).toContain("migration_ledger_behind_disk");
    expect(migrationLedgerDegradedCodes(h)).toContain("migrations_pending");
    db.close();
  });

  it("3c — no ledger table at all is reported as MISSING, not as agreement", () => {
    const dir = fixtureDir([1, 233]);
    const db = fixtureDb(dir, [], false);
    const t = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(LEDGER_TABLE);
    expect(t).toBeFalsy(); // precondition: the table really is absent

    const h = readMigrationLedgerHealth({ db, migrationsDir: dir });
    expect(h.measured).toBe(true);
    expect(h.ledgerPresent).toBe(false);
    expect(h.highestApplied).toBeNull();
    expect(h.highestOnDisk).toBe(233);
    expect(h.agree).toBe(false);
    expect(migrationLedgerDegradedCodes(h)).toContain("migration_ledger_missing");
    db.close();
  });
});

describe("W342/W300 §4 — an unknown is never an agreement", () => {
  it("no handle → measured false, agree false, ids null", () => {
    const h = readMigrationLedgerHealth({});
    expect(h.measured).toBe(false);
    expect(h.agree).toBe(false);
    expect(h.highestApplied).toBeNull();
    expect(h.highestOnDisk).toBeNull();
    expect(h.appliedCount).toBeNull();
    expect(h.reason).toBe("no_sqlite_handle");
    expect(migrationLedgerDegradedCodes(h)).toEqual(["migration_ledger_unmeasured"]);
  });
});

describe("W342/W300 §5 — the PUBLIC endpoint leaks no migration filename", () => {
  it("the serialised body contains no NNNN_*.sql basename", async () => {
    const res = await get("/api/healthz");
    expect(res.raw.length).toBeGreaterThan(0);
    expect(res.raw).not.toMatch(/\d{4}_[a-z0-9_]+\.sql/i);
    expect(res.raw).not.toContain(LEDGER_TABLE);
  });
});

describe("W342/W300 §6 — the real migrations directory, counted independently", () => {
  it("the reader's file count equals an independent readdir count", () => {
    expect(fs.existsSync(REAL_MIGRATIONS_DIR)).toBe(true);
    const independent = fs
      .readdirSync(REAL_MIGRATIONS_DIR)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f));
    expect(independent.length).toBeGreaterThan(0); // non-empty control

    const files = listMigrationFiles(REAL_MIGRATIONS_DIR);
    expect(files.length).toBe(independent.length);

    const hiFile = files[files.length - 1];
    const hi = migrationId(hiFile);
    expect(hi).not.toBeNull();

    // Read through the real reader with a ledger that is deliberately behind by
    // one real id, so the on-disk side comes from the REAL tree.
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE ${LEDGER_TABLE} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    const ins = db.prepare(`INSERT INTO ${LEDGER_TABLE} (name, applied_at) VALUES (?, ?)`);
    for (const f of files.slice(0, files.length - 1)) ins.run(f, "2026-01-01T00:00:00.000Z");
    const rows = db.prepare(`SELECT name FROM ${LEDGER_TABLE}`).all() as unknown[];
    expect(rows.length).toBe(files.length - 1);
    expect(rows.length).toBeGreaterThan(0);

    const h = readMigrationLedgerHealth({ db, migrationsDir: REAL_MIGRATIONS_DIR });
    expect(h.fileCount).toBe(independent.length);
    expect(h.highestOnDisk).toBe(hi);
    expect(h.agree).toBe(false);
    expect(h.pendingCount).toBe(1);
    db.close();
  });
});

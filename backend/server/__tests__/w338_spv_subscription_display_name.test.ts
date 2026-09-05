/**
 * WAVE 338 — A COLUMN CALLED "ID" THAT HOLDS NAMES GETS A REAL NAME COLUMN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `spv_subscription.investor_id` — a column whose name says "id" —
 * sometimes contains display text. Live, the partner LP-roster endpoint returned
 * `investorId: "Mark Invest Partners"` with `name: "Pending member"`. Every
 * screen reading that column must GUESS whether it holds a key or a person, and
 * the guess is made by a text heuristic rather than by the schema.
 *
 * WHY NOTHING IS RENAMED. The same string is a JSON OBJECT KEY inside
 * `spv.terms._fundsConfirmations`, with money matched against it (live:
 * `"Mark Invest Partners"` → receivedMinor 250000, status "matched"). A display
 * string is load-bearing as a money key. Renaming or normalising it would break
 * the link between an investor and their money. Migration 0232 is ADDITIVE ONLY
 * and `investor_id` is not written by a single statement in it.
 *
 * ── POLE ORDER IS DELIBERATE: THE CONTROL RUNS FIRST ────────────────────────
 * §2 is the CONTROL. It proves that a database WITHOUT migration 0232 has no
 * such column and renders the fixtures the OLD way. Only after that
 * DISAGREEMENT is demonstrated does §3 assert the migrated database's new
 * behaviour. A suite that showed only the migrated side could not tell the fix
 * from the defect.
 *
 * ── ANTI-VACUITY ────────────────────────────────────────────────────────────
 *   · Every row count is asserted with `toBe(n)` against a number computed by
 *     hand in the fixture table below, never against a re-derivation of the
 *     thing under test. A migration once ran with FAILED=0 and inserted zero
 *     rows; only a row-count assertion caught it, so `changes` is read from the
 *     UPDATE itself AND cross-checked against a `SELECT COUNT(*)`.
 *   · Expected names are STRING LITERALS. `displayNameFromNonIdentifier` is
 *     never called inside an assertion about what the SQL produced — that would
 *     be a normalising call inside an equality assertion.
 *   · §3 compares EVERY pre-existing column of EVERY row, byte for byte,
 *     before and after the migration.
 *   · §8 asserts through the HTTP response body and the CSV text, not through a
 *     variable name.
 *
 * ── NO DESTRUCTIVE SQL ──────────────────────────────────────────────────────
 * Scratch databases are created fresh under `mkdtemp`. Nothing in this file
 * writes to, copies over or deletes any database in the working tree.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerPartnerWorkspaceV19Routes } from "../partnerWorkspaceV19Store";
import { registerPartnerExportRoutes } from "../partnerExportRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore, hydrateSpvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { splitStatements } from "../db/migrate";
import {
  SPV_SUBSCRIPTION_DISPLAY_NAME_MIGRATION,
  SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN,
  SPV_SUBSCRIPTION_DISPLAY_NAME_SQL,
  spvSubscriptionDisplayNameSections,
  ensureSpvSubscriptionDisplayName,
} from "../lib/spvSubscriptionDisplayNameSchema";
import { investorRealDisplayName } from "../lib/investorDisplayName";
import { displayNameFromNonIdentifier } from "../../shared/partyIdentifierShape";

const REPO = path.resolve(__dirname, "..", "..");
const DEPLOY_SQL_PATH = path.join(REPO, "migrations", SPV_SUBSCRIPTION_DISPLAY_NAME_MIGRATION);
const MIRROR_SQL_PATH = path.join(
  REPO,
  "server",
  "db",
  "migrations",
  SPV_SUBSCRIPTION_DISPLAY_NAME_MIGRATION,
);
const SOURCE_0084 = path.join(REPO, "migrations", "0084_v25_49_spv_engine.sql");
/* A DRIFT PIN, not the provenance proof. The provenance proof is that the run
   appears inside 0084 CONTIGUOUSLY AND EXACTLY ONCE (asserted in 1d); this
   constant only makes a later silent edit to the copied block loud. Recorded
   over the anchored, trimmed run. */
const COPIED_DDL_SHA256 = "f6c2d8d56054ffea7adb06edec0241dc270703262dec5d9f7bd33dc7ca4d414e";

/* ══ ADVERSARIAL-PASS FINDING A, FIXED HERE ═══════════════════════════════════
   The first version of this suite applied `SPV_SUBSCRIPTION_DISPLAY_NAME_SQL`
   — the TypeScript constant — in every backfill and idempotence pole. The
   disarm pass caught it: editing the REAL deploy file
   `migrations/0232_....sql` (removing a backfill clause) left every §3 and §4
   pole GREEN, because those poles were measuring a different artefact from the
   one the deploy path runs. That is exactly the "measuring a different tree"
   defect this platform keeps finding inside its own cures.

   Every applied-SQL pole now reads THE DEPLOY FILE FROM DISK. Byte-identity
   between the three homes is asserted separately, in §1, where it belongs. */
const deploySqlText = (): string => fs.readFileSync(DEPLOY_SQL_PATH, "utf8");

/* ══════════════════════════════════════════════════════════════════════════
   THE FIXTURE TABLE. Every expectation in §2 and §3 is read off this table,
   and the two totals below are counted BY HAND from it — not derived from the
   predicate under test.

   `expectBackfill` is the value migration 0232 must write; `null` means the
   column must be left NULL because the value is AMBIGUOUS.
   `oldHeuristic` is what the pre-wave display chain renders for that id today,
   asserted as a literal in §2.
   ══════════════════════════════════════════════════════════════════════════ */
const FIXTURES: Array<{
  id: string;
  investorId: string;
  expectBackfill: string | null;
  oldHeuristic: string | null;
  why: string;
}> = [
  {
    id: "spvsub_w338_f01",
    investorId: "Mark Invest Partners",
    expectBackfill: "Mark Invest Partners",
    oldHeuristic: "Mark Invest Partners",
    why: "THE LIVE ROW. Multi-word, letters, no underscore — unambiguously a name.",
  },
  {
    id: "spvsub_w338_f02",
    investorId: "u_redeemed_1783181835779",
    expectBackfill: null,
    oldHeuristic: null,
    why: "A REAL STORAGE ID. Underscores; also a known prefix.",
  },
  {
    id: "spvsub_w338_f03",
    investorId: "co_261cb9e192f7",
    expectBackfill: null,
    oldHeuristic: null,
    why: "A REAL STORAGE ID, different prefix.",
  },
  {
    id: "spvsub_w338_f04",
    investorId: "Blackstone",
    expectBackfill: null,
    oldHeuristic: null,
    why: "THE AMBIGUITY RULE. One word: could be a firm, could be a login. NULL.",
  },
  {
    id: "spvsub_w338_f05",
    investorId: "123 456",
    expectBackfill: null,
    oldHeuristic: "123 456",
    why:
      "THE ONE DELIBERATE NARROWING. The TS heuristic accepts this; the SQL " +
      "requires an ASCII letter, so it stays NULL rather than storing digits as a name.",
  },
  {
    id: "spvsub_w338_f06",
    investorId: `${"A".repeat(100)} ${"B".repeat(100)}`,
    expectBackfill: null,
    oldHeuristic: null,
    why: "201 characters — over PARTY_DISPLAY_NAME_MAX_LENGTH (200).",
  },
  {
    id: "spvsub_w338_f07",
    investorId: "   ",
    expectBackfill: null,
    oldHeuristic: null,
    why: "Whitespace only — empty after trimming.",
  },
  {
    id: "spvsub_w338_f08",
    investorId: "  Padded Name Co  ",
    expectBackfill: "Padded Name Co",
    oldHeuristic: "Padded Name Co",
    why: "TRIMMED, not rejected. The stored id keeps its padding; only the copy is trimmed.",
  },
  {
    id: "spvsub_w338_f09",
    investorId: "Tab\tSeparated Firm",
    expectBackfill: "Tab\tSeparated Firm",
    oldHeuristic: "Tab\tSeparated Firm",
    why:
      "THE \\s-vs-SPACE ASYMMETRY, PINNED. This value contains BOTH a tab and a " +
      "space, so it qualifies under either rule. The pure-tab case is f10.",
  },
  {
    id: "spvsub_w338_f10",
    investorId: "Tab\tOnly",
    expectBackfill: null,
    oldHeuristic: "Tab\tOnly",
    why:
      "THE ASYMMETRY ITSELF. TypeScript's /\\s/ accepts a tab; the SQL's LIKE '% %' " +
      "does not. The SQL is NARROWER, so this row keeps today's behaviour and " +
      "stores nothing. Stated in the migration header, not hidden.",
  },
];

/** Counted BY HAND off the table above: f01, f08, f09. */
const EXPECT_BACKFILLED = 3;
/** Counted BY HAND off the table above: f02..f07, f10. */
const EXPECT_LEFT_NULL = 7;

const SENTINEL = "Ω_SENTINEL_ONE";

const NOW = "2026-09-05T00:00:00.000Z";
const ZERO_HASH = "0".repeat(64);

/** The `spv_subscription` DDL, READ FROM migration 0084 rather than retyped, so
 *  a scratch database has exactly the pre-wave shape. */
function preWaveSubscriptionDdl(): string {
  const lines = fs.readFileSync(SOURCE_0084, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("CREATE TABLE IF NOT EXISTS spv_subscription ("));
  expect(start).toBeGreaterThan(0);
  const end = lines.findIndex(
    (l, i) => i > start && l.startsWith("CREATE UNIQUE INDEX IF NOT EXISTS uq_spv_subscription_spv_investor"),
  );
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

let tmpRoot = "";
function scratchDb(name: string, opts: { withTable: boolean }): Database.Database {
  const file = path.join(tmpRoot, `${name}.db`);
  const db = new Database(file);
  if (opts.withTable) db.exec(preWaveSubscriptionDdl());
  return db;
}

function seedFixtures(db: Database.Database): void {
  const ins = db.prepare(
    `INSERT INTO spv_subscription
       (id, spv_id, investor_id, investor_persona, commitment_minor, wired_minor, currency,
        status, kyc_ref, accreditation_ref, subscription_doc_ref, ownership_pct,
        created_at, updated_at, updated_by, prev_hash, curr_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  let n = 0;
  for (const f of FIXTURES) {
    ins.run(
      f.id,
      "spv_w338_fixture",
      f.investorId,
      "partner",
      /* Deliberately DIFFERENT amounts and DIFFERENT currencies per row, so §3's
         "no existing value changed" comparison cannot pass by every row being
         identical, and so a cross-currency total would be visible if one ever
         appeared. Never summed anywhere in this file. */
      100000 + n,
      n,
      n % 2 === 0 ? "USD" : "JPY",
      "review",
      null,
      null,
      null,
      null,
      NOW,
      NOW,
      "u_w338_seed",
      ZERO_HASH,
      `hash_${f.id}`,
    );
    n++;
  }
}

type Row = Record<string, unknown>;
const PRE_WAVE_COLUMNS = [
  "id",
  "spv_id",
  "investor_id",
  "investor_persona",
  "commitment_minor",
  "wired_minor",
  "currency",
  "status",
  "kyc_ref",
  "accreditation_ref",
  "subscription_doc_ref",
  "ownership_pct",
  "created_at",
  "updated_at",
  "updated_by",
  "prev_hash",
  "curr_hash",
];

function snapshotPreWave(db: Database.Database): Row[] {
  return db
    .prepare(`SELECT ${PRE_WAVE_COLUMNS.join(", ")} FROM spv_subscription ORDER BY id`)
    .all() as Row[];
}

/** The DEPLOY path, statement by statement, using the runner's OWN exported
 *  splitter. Returns the row count the backfill UPDATE actually changed and the
 *  messages of any statement that threw. */
function applyDeployPath(db: Database.Database, sqlText: string): { changes: number; errors: string[] } {
  const errors: string[] = [];
  let changes = 0;
  for (const stmt of splitStatements(sqlText)) {
    const bare = stmt
      .split("\n")
      .map((l) => (l.trimStart().startsWith("--") ? "" : l))
      .join("\n")
      .trim();
    if (!bare) continue;
    try {
      if (/^UPDATE\b/i.test(bare)) {
        changes += (db.prepare(bare.replace(/;\s*$/, "")).run() as { changes: number }).changes;
      } else {
        db.exec(bare);
      }
    } catch (e) {
      errors.push(String((e as Error)?.message ?? e));
    }
  }
  return { changes, errors };
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "w338-"));
});

/* ══════════════════════════════════════════════════════════════════════════
   §1 · THREE SCHEMA HOMES, PROVED TO AGREE
   ══════════════════════════════════════════════════════════════════════════ */
describe("W338 §1 — migration 0232 exists in THREE homes that cannot drift", () => {
  it("1a the deploy copy and the mirror copy are byte-identical", () => {
    const deploy = fs.readFileSync(DEPLOY_SQL_PATH);
    const mirror = fs.readFileSync(MIRROR_SQL_PATH);
    expect(deploy.length).toBeGreaterThan(1000);
    expect(mirror.equals(deploy)).toBe(true);
  });

  it("1b the SQL embedded in the TypeScript installer is byte-identical to BOTH", () => {
    expect(SPV_SUBSCRIPTION_DISPLAY_NAME_SQL).toBe(fs.readFileSync(DEPLOY_SQL_PATH, "utf8"));
    expect(SPV_SUBSCRIPTION_DISPLAY_NAME_SQL).toBe(fs.readFileSync(MIRROR_SQL_PATH, "utf8"));
  });

  it("1c 0232 is the highest migration id in BOTH directories, and 0231 precedes it", () => {
    for (const dir of [path.join(REPO, "migrations"), path.join(REPO, "server", "db", "migrations")]) {
      const ids = fs
        .readdirSync(dir)
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .map((f) => f.slice(0, 4))
        .sort();
      expect(ids[ids.length - 1]).toBe("0232");
      expect(ids).toContain("0231");
      /* Exactly one file may claim slot 0232 in each directory. */
      expect(ids.filter((i) => i === "0232").length).toBe(1);
    }
  });

  it("1d the section 1 DDL is a CONTIGUOUS BYTE RUN of migration 0084, not a retyping", () => {
    const source = fs.readFileSync(SOURCE_0084, "utf8");
    const sections = spvSubscriptionDisplayNameSections();
    expect(sections.length).toBe(3);
    /* HARNESS CORRECTION (first run gave a RED here for the WRONG reason):
       section 1 also carries the three banner/provenance comment lines THIS
       wave wrote, which are of course not in 0084. The copied run is the block
       that begins at 0084's own comment above the table. Anchor on that line
       and take everything to the end of the section, then require the whole
       thing to be one CONTIGUOUS byte run of 0084 — a retyping would differ by
       at least one byte and `includes` would fail. */
    const ANCHOR = "-- One LP commitment.";
    expect(sections[0]).toContain(ANCHOR);
    const body = sections[0].slice(sections[0].indexOf(ANCHOR)).trim();
    expect(body.length).toBeGreaterThan(400);
    expect(source.includes(body)).toBe(true);
    /* And the run is not merely present, it is the run the generator recorded. */
    expect(crypto.createHash("sha256").update(body, "utf8").digest("hex")).toBe(COPIED_DDL_SHA256);
    /* Both ends of the run are inside 0084, contiguously, exactly once. */
    expect(source.split(body).length - 1).toBe(1);
  });

  it("1e the file contains NO destructive SQL and never writes investor_id", () => {
    const sql = SPV_SUBSCRIPTION_DISPLAY_NAME_SQL;
    const executable = sql
      .split("\n")
      .map((l) => (l.trimStart().startsWith("--") ? "" : l))
      .join("\n");
    for (const forbidden of [/\bDROP\b/i, /\bDELETE\b/i, /\bTRUNCATE\b/i, /\bINSERT\b/i, /\bRENAME\b/i]) {
      expect(executable).not.toMatch(forbidden);
    }
    /* The ONLY assignment in the file is to the new column. */
    const sets = executable.match(/SET\s+([A-Za-z0-9_]+)\s*=/gi) ?? [];
    expect(sets.length).toBe(1);
    /* `String(sets[0])` rather than `sets[0]!`: this file must not add a single
       error to the typecheck baseline, and it must not use a non-null assertion
       to do it. */
    expect(String(sets[0]).toLowerCase()).toContain(SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN);
    /* Exactly one ALTER, exactly one UPDATE, exactly one CREATE TABLE. */
    expect((executable.match(/\bALTER\s+TABLE\b/gi) ?? []).length).toBe(1);
    expect((executable.match(/\bUPDATE\b/gi) ?? []).length).toBe(1);
    expect((executable.match(/\bCREATE\s+TABLE\b/gi) ?? []).length).toBe(1);
  });

  it("1f the nine identifier prefixes appear in declaration order, one clause each", () => {
    const order = ["u_", "ac_", "co_", "ext_", "spvlp_", "spv_", "round_", "inv_", "mp_"];
    /* HARNESS CORRECTION (first run gave a RED here for the WRONG reason): the
       prose comment that documents the rule also writes `NOT GLOB 'u_*'`, so a
       whole-file match counted the documentation as a tenth clause. What has to
       be in declaration order is the EXECUTABLE clause list, so comments are
       removed before matching — the same stripping 1e uses. */
    const executable = SPV_SUBSCRIPTION_DISPLAY_NAME_SQL.split("\n")
      .map((l) => (l.trimStart().startsWith("--") ? "" : l))
      .join("\n");
    const found = [...executable.matchAll(/NOT GLOB '([a-z_]+)\*'/g)].map((m) => m[1]);
    expect(found).toEqual(order);
    expect(found.length).toBe(9);
    /* Guard the correction itself: the prose really does mention it, so this
       test would silently pass for the wrong reason if the strip were dropped. */
    expect([...SPV_SUBSCRIPTION_DISPLAY_NAME_SQL.matchAll(/NOT GLOB '([a-z_]+)\*'/g)].length).toBe(10);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §2 · THE CONTROL, RUN FIRST. A database WITHOUT 0232.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W338 §2 — CONTROL: without migration 0232 there is no column and no stored name", () => {
  let db: Database.Database;
  beforeAll(() => {
    db = scratchDb("control", { withTable: true });
    seedFixtures(db);
  });

  it("2a the fixture reproduces the live shape: a firm NAME sitting in investor_id", () => {
    const ids = (
      db.prepare("SELECT investor_id FROM spv_subscription ORDER BY id").all() as Array<{
        investor_id: string;
      }>
    ).map((r) => r.investor_id);
    expect(ids.length).toBe(FIXTURES.length);
    expect(ids).toContain("Mark Invest Partners");
    expect(ids).toContain("u_redeemed_1783181835779");
    expect(ids).toContain("Blackstone");
  });

  it("2b the column DOES NOT EXIST — reading it raises 'no such column'", () => {
    const cols = (db.prepare("PRAGMA table_info(spv_subscription)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).not.toContain(SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN);
    let msg = "";
    try {
      db.prepare(`SELECT ${SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN} FROM spv_subscription`).all();
    } catch (e) {
      msg = String((e as Error).message);
    }
    expect(msg).toMatch(/no such column/i);
    expect(msg).toContain(SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN);
  });

  it("2c the pre-wave display chain renders each fixture the OLD way (literals)", () => {
    for (const f of FIXTURES) {
      /* No `storedDisplayName` argument at all — this is the pre-wave call
         shape, and it must produce the pre-wave answer. */
      expect(
        investorRealDisplayName({
          investorId: f.investorId,
          resolvedName: null,
          identityName: null,
        }),
      ).toBe(f.oldHeuristic);
    }
    /* Both sides of the old behaviour are non-empty: some rows render a name,
       some render nothing. A control where everything answered null could not
       distinguish anything. */
    expect(FIXTURES.filter((f) => f.oldHeuristic !== null).length).toBeGreaterThan(0);
    expect(FIXTURES.filter((f) => f.oldHeuristic === null).length).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §3 · THE MIGRATED DATABASE. Rows asserted, and nothing else moved.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W338 §3 — migrated: the backfill writes the unambiguous rows and NOTHING else", () => {
  let db: Database.Database;
  let before: Row[];
  let after: Row[];
  let applied: { changes: number; errors: string[] };

  beforeAll(() => {
    db = scratchDb("migrated", { withTable: true });
    seedFixtures(db);
    before = snapshotPreWave(db);
    applied = applyDeployPath(db, deploySqlText());
    after = snapshotPreWave(db);
  });

  it("3a every statement applied cleanly on a first run", () => {
    expect(applied.errors).toEqual([]);
    const cols = (db.prepare("PRAGMA table_info(spv_subscription)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain(SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN);
  });

  it(`3b the UPDATE reports exactly ${EXPECT_BACKFILLED} changed rows — the count, not the exit status`, () => {
    expect(applied.changes).toBe(EXPECT_BACKFILLED);
  });

  it("3c the STORED rows match the hand-written fixture table, value by value", () => {
    const rows = db
      .prepare(`SELECT id, investor_display_name FROM spv_subscription ORDER BY id`)
      .all() as Array<{ id: string; investor_display_name: string | null }>;
    const got = new Map(rows.map((r) => [r.id, r.investor_display_name]));
    for (const f of FIXTURES) {
      expect(got.get(f.id)).toBe(f.expectBackfill === null ? null : f.expectBackfill);
    }
  });

  it(`3d the counts add up: ${EXPECT_BACKFILLED} named + ${EXPECT_LEFT_NULL} NULL = ${FIXTURES.length}`, () => {
    const c = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN investor_display_name IS NULL THEN 1 ELSE 0 END) AS nulls,
                SUM(CASE WHEN investor_display_name IS NOT NULL THEN 1 ELSE 0 END) AS named
           FROM spv_subscription`,
      )
      .get() as { total: number; nulls: number; named: number };
    expect(c.total).toBe(FIXTURES.length);
    expect(c.named).toBe(EXPECT_BACKFILLED);
    expect(c.nulls).toBe(EXPECT_LEFT_NULL);
    expect(c.named + c.nulls).toBe(c.total);
    /* Cross-check: the UPDATE's own `changes` and the table's own COUNT agree.
       A migration once reported success having written zero rows. */
    expect(applied.changes).toBe(c.named);
  });

  it("3e NO PRE-EXISTING VALUE CHANGED — all 17 original columns, row by row", () => {
    expect(before.length).toBe(FIXTURES.length);
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      for (const col of PRE_WAVE_COLUMNS) {
        expect(after[i][col]).toBe(before[i][col]);
      }
    }
    /* And specifically: the padded id kept its padding. The copy was trimmed;
       the source was not. */
    const padded = after.find((r) => r["id"] === "spvsub_w338_f08");
    expect(padded?.["investor_id"]).toBe("  Padded Name Co  ");
  });

  it("3f the ambiguous rows are NULL — not '', not the id, not a guess", () => {
    const rows = db
      .prepare(
        `SELECT id, investor_id, investor_display_name FROM spv_subscription
          WHERE investor_display_name IS NULL ORDER BY id`,
      )
      .all() as Array<{ id: string; investor_id: string; investor_display_name: null }>;
    expect(rows.length).toBe(EXPECT_LEFT_NULL);
    for (const r of rows) {
      expect(r.investor_display_name).toBeNull();
      expect(r.investor_display_name).not.toBe("");
    }
    expect(rows.map((r) => r.id)).toEqual([
      "spvsub_w338_f02",
      "spvsub_w338_f03",
      "spvsub_w338_f04",
      "spvsub_w338_f05",
      "spvsub_w338_f06",
      "spvsub_w338_f07",
      "spvsub_w338_f10",
    ]);
  });

  it("3g NAME-SET DIFF: both sides non-empty, and the diff is the declared narrowing", () => {
    const heuristicNames = new Set(
      FIXTURES.filter((f) => f.oldHeuristic !== null).map((f) => f.investorId),
    );
    const storedNames = new Set(
      (
        db
          .prepare(`SELECT investor_id FROM spv_subscription WHERE investor_display_name IS NOT NULL`)
          .all() as Array<{ investor_id: string }>
      ).map((r) => r.investor_id),
    );
    expect(heuristicNames.size).toBeGreaterThan(0);
    expect(storedNames.size).toBeGreaterThan(0);
    /* The SQL is NARROWER by exactly two declared cases: digits-only, and
       whitespace that is not an ASCII space. */
    const onlyHeuristic = [...heuristicNames].filter((v) => !storedNames.has(v)).sort();
    const onlyStored = [...storedNames].filter((v) => !heuristicNames.has(v)).sort();
    expect(onlyHeuristic).toEqual(["123 456", "Tab\tOnly"]);
    expect(onlyStored).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §4 · IDEMPOTENCE AND SELF-SUFFICIENCY
   ══════════════════════════════════════════════════════════════════════════ */
describe("W338 §4 — safe to run twice, safe where the column exists, safe with no table at all", () => {
  it("4a a SECOND run changes zero rows and does not corrupt the first run's values", () => {
    const db = scratchDb("twice", { withTable: true });
    seedFixtures(db);
    const first = applyDeployPath(db, deploySqlText());
    expect(first.errors).toEqual([]);
    expect(first.changes).toBe(EXPECT_BACKFILLED);
    const afterFirst = db
      .prepare("SELECT id, investor_display_name FROM spv_subscription ORDER BY id")
      .all();

    const second = applyDeployPath(db, deploySqlText());
    /* The ALTER is the only statement that can throw on a second run, and it
       throws exactly the message the runner classifies as idempotent. */
    expect(second.errors.length).toBe(1);
    expect(second.errors[0]).toMatch(/duplicate column name/i);
    expect(second.errors[0]).toContain(SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN);
    expect(second.changes).toBe(0);
    expect(
      db.prepare("SELECT id, investor_display_name FROM spv_subscription ORDER BY id").all(),
    ).toEqual(afterFirst);
  });

  it("4b the runner's OWN predicate classifies that message as idempotent (read off migrate.ts)", () => {
    /* Not a re-implementation of the predicate: the regex literal is READ from
       server/db/migrate.ts, so if that line ever changes this assertion moves
       with it instead of quietly disagreeing. */
    const src = fs.readFileSync(path.join(REPO, "server", "db", "migrate.ts"), "utf8");
    const fn = src.slice(src.indexOf("function isIdempotentSqliteError"));
    expect(fn.slice(0, 400)).toContain("/duplicate column name/i");

    const db = scratchDb("predicate", { withTable: true });
    db.exec(`ALTER TABLE spv_subscription ADD COLUMN ${SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN} TEXT`);
    let msg = "";
    try {
      db.exec(`ALTER TABLE spv_subscription ADD COLUMN ${SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN} TEXT`);
    } catch (e) {
      msg = String((e as Error).message);
    }
    expect(/duplicate column name/i.test(msg)).toBe(true);
  });

  it("4c a database that ALREADY has the column, with a HAND-EDITED value, is not overwritten", () => {
    const db = scratchDb("preexisting", { withTable: true });
    db.exec(`ALTER TABLE spv_subscription ADD COLUMN ${SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN} TEXT`);
    seedFixtures(db);
    /* Somebody has already corrected f04 — the ambiguous "Blackstone" row —
       to the real firm name. The migration must not touch it, and must not
       "correct" it back to NULL. */
    db.prepare(
      `UPDATE spv_subscription SET investor_display_name = ? WHERE id = 'spvsub_w338_f04'`,
    ).run("Blackstone Group Inc.");
    const out = applyDeployPath(db, deploySqlText());
    expect(out.errors.length).toBe(1);
    expect(out.errors[0]).toMatch(/duplicate column name/i);
    expect(out.changes).toBe(EXPECT_BACKFILLED);
    expect(
      (
        db
          .prepare("SELECT investor_display_name AS v FROM spv_subscription WHERE id='spvsub_w338_f04'")
          .get() as { v: string }
      ).v,
    ).toBe("Blackstone Group Inc.");
  });

  it("4d SELF-SUFFICIENT: with NO spv_subscription table at all, 0232 alone succeeds", () => {
    const bare = scratchDb("nosuchtable", { withTable: false });
    expect(
      bare.prepare("SELECT name FROM sqlite_master WHERE name='spv_subscription'").all().length,
    ).toBe(0);
    const out = applyDeployPath(bare, deploySqlText());
    expect(out.errors).toEqual([]);
    /* A TRUTHFUL ZERO: the table it just created is empty, so nothing was
       backfilled. That is not a failure and must not be reported as one. */
    expect(out.changes).toBe(0);
    const cols = (bare.prepare("PRAGMA table_info(spv_subscription)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(cols).toContain("investor_id");
    expect(cols).toContain("curr_hash");
    expect(cols).toContain(SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN);
    /* Its three indexes came too. */
    const idx = (
      bare
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='spv_subscription'")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(idx).toContain("idx_spv_subscription_spv");
    expect(idx).toContain("idx_spv_subscription_investor");
    expect(idx).toContain("uq_spv_subscription_spv_investor");
  });

  it("4e the table 0232 creates is IDENTICAL to the table 0084 creates", () => {
    const fromMigration = scratchDb("shape_0232", { withTable: false });
    applyDeployPath(fromMigration, deploySqlText());
    const from0084 = scratchDb("shape_0084", { withTable: true });
    const sqlOf = (db: Database.Database) =>
      (
        db
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='spv_subscription'")
          .get() as { sql: string }
      ).sql;
    /* 0232's copy carries the extra column because the ALTER ran; strip it and
       the two CREATE statements must be byte-identical. */
    const stripped = sqlOf(fromMigration).replace(
      new RegExp(`,\\s*"?${SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN}"? TEXT`),
      "",
    );
    expect(stripped).toBe(sqlOf(from0084));
  });

  it("4f the TypeScript installer reaches the SAME end state as the deploy path", () => {
    const viaSql = scratchDb("agree_sql", { withTable: true });
    seedFixtures(viaSql);
    applyDeployPath(viaSql, deploySqlText());

    const viaTs = scratchDb("agree_ts", { withTable: true });
    seedFixtures(viaTs);
    const res = ensureSpvSubscriptionDisplayName(viaTs as never);
    expect(res.failures).toEqual([]);
    expect(res.tableCreated).toBe(false);
    expect(res.columnAdded).toBe(true);
    expect(res.columnAlreadyPresent).toBe(false);
    expect(res.backfilled).toBe(EXPECT_BACKFILLED);
    expect(res.leftNull).toBe(EXPECT_LEFT_NULL);
    expect(res.totalRows).toBe(FIXTURES.length);

    const dump = (db: Database.Database) =>
      db.prepare("SELECT * FROM spv_subscription ORDER BY id").all();
    expect(dump(viaTs)).toEqual(dump(viaSql));

    /* And the installer is idempotent too, reporting a truthful zero. */
    const again = ensureSpvSubscriptionDisplayName(viaTs as never);
    expect(again.failures).toEqual([]);
    expect(again.columnAlreadyPresent).toBe(true);
    expect(again.columnAdded).toBe(false);
    expect(again.backfilled).toBe(0);
    expect(dump(viaTs)).toEqual(dump(viaSql));
  });

  it("4g the installer is SELF-SUFFICIENT too: it creates the table when it is missing", () => {
    const bare = scratchDb("ts_nosuchtable", { withTable: false });
    const res = ensureSpvSubscriptionDisplayName(bare as never);
    expect(res.failures).toEqual([]);
    expect(res.tableCreated).toBe(true);
    expect(res.columnAdded).toBe(true);
    expect(res.backfilled).toBe(0);
    expect(res.totalRows).toBe(0);
    expect(res.leftNull).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §5 · THE HASH CHAIN. The new field is stripped from the hashed body.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W338 §5 — the hash chain still verifies because the new field is stripped", () => {
  /** `chain()`'s canonical string, exactly as server/spvEngineStore.ts:366 forms
   *  it. Reproduced here — and cross-checked against that line's source text in
   *  5c — because `chain` is module-private. */
  const canonical = (body: Record<string, unknown>) => JSON.stringify(body, Object.keys(body).sort());

  const liveShape = {
    id: "spvsub_live",
    spvId: "spv_13ac1ceb06eeb6c7",
    investorId: "Mark Invest Partners",
    investorPersona: "partner",
    commitmentMinor: 250000,
    wiredMinor: 250000,
    currency: "USD",
    status: "committed",
    kycRef: null,
    accreditationRef: null,
    subscriptionDocRef: null,
    ownershipPct: null,
    createdAt: NOW,
    updatedAt: NOW,
    revisionHash: "",
  };

  it("5a the canonical string is byte-identical with and without the new field", () => {
    /* PRE-WAVE: the DTO had no such key at all, and `revisionHash` was the only
       thing stripped. This is the exact line wave 338 replaced. */
    const preWave = canonical({ ...liveShape, revisionHash: undefined });
    /* POST-WAVE: the DTO now CARRIES the field with a real value, and
       `_persistSub` strips it the same way `revisionHash` has always been
       stripped. `JSON.stringify` omits a key whose value is `undefined` even
       when that key is listed in the replacer array — that is the whole
       mechanism, and this is the assertion that it holds. */
    const postWaveDto = { ...liveShape, investorDisplayName: "Mark Invest Partners" };
    const postWave = canonical({
      ...postWaveDto,
      revisionHash: undefined,
      investorDisplayName: undefined,
    });
    expect(postWave).toBe(preWave);
    expect(postWave).not.toContain("investorDisplayName");
  });

  it("5b NOT stripping it WOULD change the hash — the risk is real, not hypothetical", () => {
    const stripped = canonical({ ...liveShape, revisionHash: undefined, investorDisplayName: undefined });
    const unstripped = canonical({
      ...liveShape,
      revisionHash: undefined,
      investorDisplayName: "Mark Invest Partners",
    });
    expect(unstripped).not.toBe(stripped);
    expect(unstripped).toContain("investorDisplayName");
  });

  it("5c _persistSub really does strip it, and chain() really does hash sorted keys", () => {
    const src = fs.readFileSync(path.join(REPO, "server", "spvEngineStore.ts"), "utf8");
    expect(src).toContain("JSON.stringify(bodyWithoutHash, Object.keys(bodyWithoutHash).sort())");
    const persist = src.slice(src.indexOf("_persistSub(sub: SpvSubscriptionDTO)"));
    const call = persist.slice(persist.indexOf('chain("spv_subscription"'), persist.indexOf("sub.revisionHash = curr"));
    expect(call).toContain("revisionHash: undefined");
    expect(call).toContain("investorDisplayName: undefined");
    /* And the INSERT does not mention the column, so a re-persist cannot blank
       a value the migration wrote. */
    const insert = persist.slice(persist.indexOf("INSERT INTO spv_subscription"), persist.indexOf("ON CONFLICT"));
    expect(insert).not.toContain(SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §6 · THE READ PATH, INCLUDING DEGRADATION FOR NULL ROWS
   ══════════════════════════════════════════════════════════════════════════ */
describe("W338 §6 — the read chain uses the column when present and is UNCHANGED when it is not", () => {
  it("6a a NULL / absent / blank stored name renders EXACTLY as it does today", () => {
    for (const f of FIXTURES) {
      const preWave = investorRealDisplayName({
        investorId: f.investorId,
        resolvedName: null,
        identityName: null,
      });
      expect(preWave).toBe(f.oldHeuristic);
      for (const stored of [null, undefined, "", "   "]) {
        expect(
          investorRealDisplayName({
            investorId: f.investorId,
            resolvedName: null,
            identityName: null,
            storedDisplayName: stored,
          }),
        ).toBe(preWave);
      }
    }
  });

  it("6b a stored name RESCUES a row the heuristic gives up on", () => {
    expect(
      investorRealDisplayName({
        investorId: "u_redeemed_1783181835779",
        resolvedName: null,
        identityName: null,
      }),
    ).toBeNull();
    expect(
      investorRealDisplayName({
        investorId: "u_redeemed_1783181835779",
        resolvedName: null,
        identityName: null,
        storedDisplayName: "Redeemed Holdings LLC",
      }),
    ).toBe("Redeemed Holdings LLC");
  });

  it("6c the stored name NEVER displaces a resolved identity or a GP-typed register name", () => {
    expect(
      investorRealDisplayName({
        investorId: "u_x",
        resolvedName: "Resolved Person",
        identityName: "Register Person",
        storedDisplayName: "Stored Person",
      }),
    ).toBe("Resolved Person");
    expect(
      investorRealDisplayName({
        investorId: "u_x",
        resolvedName: null,
        identityName: "Register Person",
        storedDisplayName: "Stored Person",
      }),
    ).toBe("Register Person");
  });

  it("6d the stored name BEATS the heuristic's guess about the id", () => {
    /* The heuristic would answer "Mark Invest Partners" off the id itself; the
       column is better evidence and wins. */
    expect(
      investorRealDisplayName({
        investorId: "Mark Invest Partners",
        resolvedName: null,
        identityName: null,
        storedDisplayName: "Mark Invest Partners LP",
      }),
    ).toBe("Mark Invest Partners LP");
  });

  it("6e the stored name is trimmed, and a whitespace-only value is not a name", () => {
    expect(
      investorRealDisplayName({
        investorId: "u_x",
        resolvedName: null,
        identityName: null,
        storedDisplayName: "  Spaced Firm  ",
      }),
    ).toBe("Spaced Firm");
    expect(
      investorRealDisplayName({
        investorId: "u_x",
        resolvedName: null,
        identityName: null,
        storedDisplayName: "\t\n ",
      }),
    ).toBeNull();
  });

  it("6f the heuristic itself is UNTOUCHED by this wave", () => {
    expect(displayNameFromNonIdentifier("Mark Invest Partners")).toBe("Mark Invest Partners");
    expect(displayNameFromNonIdentifier("Blackstone")).toBeNull();
    expect(displayNameFromNonIdentifier("u_abc_def")).toBeNull();
    expect(displayNameFromNonIdentifier("123 456")).toBe("123 456");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   §7 · RENDERED TEXT. The sentinel travels the real HTTP surfaces.
   ══════════════════════════════════════════════════════════════════════════ */
const liveHarness = {
  app: null as unknown as express.Express,
  partnerId: "ac_consortium_partner_test_partner_inc",
  actor: "u_avi_managing",
  fundUsd: "",
  /* An id the heuristic can NEVER turn into a name (it has underscores), so any
     name that appears for this row must have come from the new column. */
  sentinelLp: "u_w338_sentinel_lp",
  /* A second LP left NULL, to prove the degradation path on the same screen. */
  nullLp: "u_w338_null_lp",
};

describe("W338 §7 — the stored name renders on all three GP surfaces; NULL rows do not change", () => {
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerPartnerRoutes(app);
    registerSpvEngineRoutes(app);
    registerPartnerWorkspaceV19Routes(app);
    registerPartnerExportRoutes(app);
    seedTestPartnerSandbox({ force: true });
    liveHarness.app = app;

    const created = await request(app)
      .post("/api/partner/me/funds")
      .set("x-user-id", liveHarness.actor)
      .send({
        fundName: "W338 Display Name Fund",
        fundType: "closed_end",
        jurisdiction: "delaware",
        vintage: 2026,
        currency: "USD",
        status: "raising",
        signoffLegalName: "Managing Partner",
        signoffAccepted: true,
      });
    expect(created.status).toBe(201);
    liveHarness.fundUsd = (created.body?.fund?.id ?? created.body?.spv?.id) as string;
    expect(typeof liveHarness.fundUsd).toBe("string");

    spvEngineStore.subscribe(
      liveHarness.partnerId,
      liveHarness.fundUsd,
      { investorId: liveHarness.sentinelLp, commitmentMinor: 500000 },
      liveHarness.actor,
    );
    spvEngineStore.subscribe(
      liveHarness.partnerId,
      liveHarness.fundUsd,
      { investorId: liveHarness.nullLp, commitmentMinor: 250000 },
      liveHarness.actor,
    );

    /* ══ ADVERSARIAL-PASS FINDING B, FIXED HERE ══════════════════════════════
       This block used to call `ensureSpvSubscriptionDisplayName(rawDb())`
       ITSELF. The disarm pass caught it: stubbing out the installer call inside
       `hydrateSpvEngineStore` left all 40 poles GREEN, because the harness was
       installing the column on its own behalf. The RUNTIME install path — the
       third schema home, needed because server/db/connection.ts is frozen and
       therefore never creates this column for a `:memory:` test database — was
       not proved by anything.

       So the harness now installs NOTHING. It calls the real boot path and then
       asserts, through PRAGMA on the real database, that the column is there.
       If the hydrate-time installer stops running, this fails here. */
    await hydrateSpvEngineStore();
    const bootCols = (
      rawDb().prepare("PRAGMA table_info(spv_subscription)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(bootCols).toContain(SPV_SUBSCRIPTION_DISPLAY_NAME_COLUMN);

    const changed = (
      rawDb()
        .prepare(
          `UPDATE spv_subscription SET investor_display_name = ?
            WHERE spv_id = ? AND investor_id = ?`,
        )
        .run(SENTINEL, liveHarness.fundUsd, liveHarness.sentinelLp) as { changes: number }
    ).changes;
    /* ASSERT THE ROW. A zero here would make every pole below vacuous. */
    expect(changed).toBe(1);

    /* The boot read path is what carries a stored column into the projection the
       routes read. This is the real function, not a test-only shim. */
    await hydrateSpvEngineStore();
  });

  it("7a PRECONDITION: the sentinel is in the DATABASE, and the other row is NULL", () => {
    const rows = rawDb()
      .prepare(
        `SELECT investor_id, investor_display_name FROM spv_subscription
          WHERE spv_id = ? ORDER BY investor_id`,
      )
      .all(liveHarness.fundUsd) as Array<{ investor_id: string; investor_display_name: string | null }>;
    expect(rows.length).toBe(2);
    const map = new Map(rows.map((r) => [r.investor_id, r.investor_display_name]));
    expect(map.get(liveHarness.sentinelLp)).toBe(SENTINEL);
    expect(map.get(liveHarness.nullLp)).toBeNull();
    /* And the id column was NOT touched. */
    expect([...map.keys()].sort()).toEqual([liveHarness.nullLp, liveHarness.sentinelLp].sort());
  });

  it("7b PRECONDITION: the sentinel CANNOT be produced by the heuristic", () => {
    expect(SENTINEL).toContain("_");
    expect(displayNameFromNonIdentifier(liveHarness.sentinelLp)).toBeNull();
    expect(displayNameFromNonIdentifier(SENTINEL)).toBeNull();
  });

  it("7c the LP ROSTER response body contains the sentinel as the row's NAME", async () => {
    const res = await request(liveHarness.app)
      .get(`/api/partner/me/spv/${liveHarness.fundUsd}/lp-roster`)
      .set("x-user-id", liveHarness.actor)
      .set("x-actor-user-id", liveHarness.actor)
      .set("x-role", "partner");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(SENTINEL);
    /* HARNESS CORRECTION (first run threw here, which is NOT a RED): the roster
       payload's row array is `subscribers` — read off `buildPartnerLpRosterPayload`
       in server/spvEngineRoutes.ts — not `entries`. */
    const entries = res.body.subscribers as Array<{ investorId: string; name: string | null }>;
    expect(Array.isArray(entries)).toBe(true);
    const sentinelRow = entries.find((e) => e.investorId === liveHarness.sentinelLp);
    expect(sentinelRow?.name).toBe(SENTINEL);
  });

  it("7d the CSV EXPORT text contains the sentinel", async () => {
    const res = await request(liveHarness.app)
      .get(`/api/partner/me/spv/${liveHarness.fundUsd}/lp-roster.csv`)
      .set("x-user-id", liveHarness.actor)
      .set("x-actor-user-id", liveHarness.actor)
      .set("x-role", "partner");
    expect(res.status).toBe(200);
    expect(res.text).toContain(SENTINEL);
  });

  it("7e the FUND COMMITMENT REGISTER response contains the sentinel as investorName", async () => {
    const res = await request(liveHarness.app)
      .get(`/api/partner/me/funds/${liveHarness.fundUsd}`)
      .set("x-user-id", liveHarness.actor)
      .set("x-actor-user-id", liveHarness.actor)
      .set("x-role", "partner");
    expect(res.status).toBe(200);
    const rows = res.body.commitments as Array<{ investorId: string; investorName: string | null }>;
    expect(rows.length).toBeGreaterThan(0);
    const sentinelRow = rows.find((r) => r.investorId === liveHarness.sentinelLp);
    expect(sentinelRow?.investorName).toBe(SENTINEL);
  });

  it("7f DEGRADATION: the NULL row renders its pre-wave floor on every surface", async () => {
    const roster = await request(liveHarness.app)
      .get(`/api/partner/me/spv/${liveHarness.fundUsd}/lp-roster`)
      .set("x-user-id", liveHarness.actor)
      .set("x-actor-user-id", liveHarness.actor)
      .set("x-role", "partner");
    const entries = roster.body.subscribers as Array<{ investorId: string; name: string | null }>;
    expect(Array.isArray(entries)).toBe(true);
    const nullRow = entries.find((e) => e.investorId === liveHarness.nullLp);
    /* The literal pre-wave floor for an unresolvable id on this screen. Asserted
       as a string, not as `idn?.name`. */
    expect(nullRow?.name).toBe("Pending member");
    expect(JSON.stringify(nullRow)).not.toContain(SENTINEL);

    const fund = await request(liveHarness.app)
      .get(`/api/partner/me/funds/${liveHarness.fundUsd}`)
      .set("x-user-id", liveHarness.actor)
      .set("x-actor-user-id", liveHarness.actor)
      .set("x-role", "partner");
    const reg = (fund.body.commitments as Array<{ investorId: string; investorName: string | null }>).find(
      (r) => r.investorId === liveHarness.nullLp,
    );
    /* `null` means "no honest name" — the register then renders its OWN floor
       client-side, exactly as before this wave. */
    expect(reg?.investorName).toBeNull();
  });

  it("7g MONEY IS UNMOVED and no currency was converted", async () => {
    const fund = await request(liveHarness.app)
      .get(`/api/partner/me/funds/${liveHarness.fundUsd}`)
      .set("x-user-id", liveHarness.actor)
      .set("x-actor-user-id", liveHarness.actor)
      .set("x-role", "partner");
    const rows = fund.body.commitments as Array<{
      investorId: string;
      commitmentMinor: number;
      currency?: string;
    }>;
    const byId = new Map(rows.map((r) => [r.investorId, r]));
    expect(byId.get(liveHarness.sentinelLp)?.commitmentMinor).toBe(500000);
    expect(byId.get(liveHarness.nullLp)?.commitmentMinor).toBe(250000);
    for (const r of rows) {
      if (r.currency !== undefined) expect(r.currency).toBe("USD");
    }
  });
  /* ══ 7h · THE HASH-CHAIN PROOF ON A REAL, PERSISTED ROW ══════════════════
     FIRST-RUN CORRECTION, RECORDED RATHER THAN HIDDEN. The first version of
     this test asserted that re-persisting a subscription leaves `curr_hash`
     unchanged. THAT PREMISE IS FALSE and its RED was a BAD RED, not a defect:
     `chain()` is an APPEND LOG — `curr = sha256(prev + "|" + body)` and `prev`
     is the previous tip — so every re-persist advances the hash BY DESIGN,
     with or without this wave. A suite that "fixed" the product until that
     test went green would have broken the audit chain.

     What actually has to be true is narrower and stronger: the stored
     `curr_hash` must be EXACTLY the hash of the body WITH the new field
     STRIPPED, computed independently here from the stored `prev_hash`. The
     control is in the same test: the same computation WITHOUT the strip must
     NOT match the stored hash — which is what makes the strip load-bearing
     rather than decorative. */
  it("7h the stored curr_hash is the STRIPPED-body recomputation, and the un-stripped body does not match", () => {
    const spvId = liveHarness.fundUsd;
    const canonical = (body: Record<string, unknown>) =>
      JSON.stringify(body, Object.keys(body).sort());
    const sha = (s: string) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

    const subs = spvEngineStore.listSubscriptions(liveHarness.partnerId, spvId);
    expect(subs.length).toBeGreaterThan(0);
    const dto = subs.find((s) => s.investorId === liveHarness.sentinelLp);
    expect(dto).toBeTruthy();
    /* The field is really populated on the DTO the writer will hash — so this
       is not a proof about an absent key. */
    expect(dto!.investorDisplayName).toBe(SENTINEL);
    const bodyAtWrite: Record<string, unknown> = { ...dto! };

    spvEngineStore._persistSub(dto!);

    const row = rawDb()
      .prepare("SELECT prev_hash, curr_hash, investor_display_name FROM spv_subscription WHERE id = ?")
      .get(dto!.id) as { prev_hash: string; curr_hash: string; investor_display_name: string | null };
    expect(row.curr_hash).toMatch(/^[0-9a-f]{64}$/);

    const strippedHash = sha(
      `${row.prev_hash}|${canonical({ ...bodyAtWrite, revisionHash: undefined, investorDisplayName: undefined })}`,
    );
    const unstrippedHash = sha(
      `${row.prev_hash}|${canonical({ ...bodyAtWrite, revisionHash: undefined })}`,
    );

    expect(row.curr_hash).toBe(strippedHash);
    expect(row.curr_hash).not.toBe(unstrippedHash);
    expect(strippedHash).not.toBe(unstrippedHash);
    /* And the write did not blank the stored display name: the INSERT does not
       mention the column, so a re-persist cannot erase what 0232 wrote. */
    expect(row.investor_display_name).toBe(SENTINEL);
  });
});

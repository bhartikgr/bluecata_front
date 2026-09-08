/**
 * WAVE 340 · ITEM 2 — THE CARRY DEFAULT IS NULL, NOT ZERO. STORED ROWS, READ BACK.
 *
 * The owner ruled on 2026-09-06: a vehicle created without a carry percentage must
 * not store 0%, because a stored 0 reads as a definite commercial claim that the
 * GP takes no carry. It must store NULL and the screen must read "Not set".
 *
 * WHAT THIS FILE PROVES, AND HOW.
 *   §1  THREE HOMES, NO DRIFT. Migration 0233 exists byte-identically in
 *       migrations/ and server/db/migrations/, and its bytes are embedded verbatim
 *       in server/lib/angelChapterCarrySchema.ts. Read off disk, compared as bytes.
 *   §2  THE COLUMN IS NULLABLE AND HAS NO DEFAULT. Read out of
 *       `PRAGMA table_info`, not out of the migration text.
 *   §3  THE STORED ROW. A chapter created with no carry supplied stores NULL in
 *       `carry_bps_recorded`; a chapter created with an explicit 0 stores 0. The
 *       two are now DISTINGUISHABLE in the database — which is the entire wave.
 *       Asserted with `rawDb()` against the real table.
 *   §4  THE LEGACY COLUMN DID NOT MOVE. `carry_bps` still holds exactly what it
 *       held before (`recorded ?? 0`), so every existing reader is unaffected.
 *   §5  NOTHING IS BACKFILLED. Rows written before the migration keep their bytes;
 *       the installer reports the ambiguous ones instead of guessing at them.
 *   §6  THE RENDER RULE. `recordedCarryBps` returns 0 for a deliberate 0 (so the
 *       screen shows 0.00%), the legacy rate for a pre-migration row (so nothing
 *       is hidden), and null for "Not set".
 *   §7  CONTROL — a database WITHOUT the column. The whole thing is measured on a
 *       handle built from the OLD DDL, to prove the assertions are not passing on
 *       a column that was always there. And a control that tries to MANUFACTURE a
 *       green: it asserts the old writer's behaviour is genuinely gone.
 *
 * THE ONE THING THIS FILE DOES NOT CLAIM. It does not claim a pre-existing stored
 * 0 can be told apart from a defaulted 0. It cannot be, the migration writes
 * nothing to those rows, and §5 asserts that absence.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import Database from "better-sqlite3";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore } from "../managedFounderStore";
import { mfcrmAngelStore, recordedCarryBpsFromInput } from "../mfcrmAngelStore";
import { rawDb } from "../db/connection";
import {
  ANGEL_CHAPTER_CARRY_MIGRATION,
  ANGEL_CHAPTER_CARRY_COLUMN,
  ANGEL_CHAPTER_CARRY_SQL,
  angelChapterCarrySections,
  ensureAngelChapterCarryRecorded,
} from "../lib/angelChapterCarrySchema";
import {
  ANGEL_CHAPTER_CARRY_NOT_SET_LABEL,
  recordedCarryBps,
  hasRecordedCarry,
} from "../../shared/angelChapterCarry";

const ACTOR = "u_w340_actor";
const ROOT = resolve(__dirname, "..", "..");

beforeAll(() => applyMfcrmSchema());

function profile(pid: string): void {
  managedFounderStore.setCapabilityProfile(
    pid,
    { classified: true, sourcesCapital: true, chapterScoping: true },
    ACTOR,
  );
}

function storedRow(chapterId: string): any {
  return rawDb()
    .prepare(
      "SELECT id, name, carry_bps, carry_bps_recorded, created_at, updated_at FROM mf_angel_chapter WHERE id = ?",
    )
    .get(chapterId);
}

/** The OLD table, exactly as it was before migration 0233: no companion column. */
function legacyDb(): any {
  const db: any = new Database(":memory:");
  db.exec(`CREATE TABLE IF NOT EXISTS mf_angel_chapter (
      id          TEXT PRIMARY KEY NOT NULL,
      partner_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      region      TEXT,
      carry_bps   INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );`);
  return db;
}

describe("W340 §1 — migration 0233 exists in THREE homes that cannot drift", () => {
  it("1a the two .sql copies are byte-identical", () => {
    const a = readFileSync(resolve(ROOT, "migrations", ANGEL_CHAPTER_CARRY_MIGRATION));
    const b = readFileSync(resolve(ROOT, "server", "db", "migrations", ANGEL_CHAPTER_CARRY_MIGRATION));
    expect(a.length).toBeGreaterThan(1000);
    expect(a.equals(b)).toBe(true);
  });

  it("1b the embedded constant is byte-identical to the migration file", () => {
    const a = readFileSync(resolve(ROOT, "migrations", ANGEL_CHAPTER_CARRY_MIGRATION), "utf8");
    expect(ANGEL_CHAPTER_CARRY_SQL).toBe(a);
  });

  it("1c the migration contains NO destructive statement and NO backfill", () => {
    const body = ANGEL_CHAPTER_CARRY_SQL.split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(body).not.toMatch(/\bDROP\b/i);
    expect(body).not.toMatch(/\bDELETE\b/i);
    expect(body).not.toMatch(/\bUPDATE\b/i);
    expect(body).toMatch(/ALTER TABLE mf_angel_chapter ADD COLUMN carry_bps_recorded INTEGER/);
  });

  it("1d section 3 parses, and contains no executable statement at all", () => {
    const sections = angelChapterCarrySections();
    expect(sections.length).toBe(3);
    const third = sections[2]
      .split("\n")
      .map((l) => (l.trimStart().startsWith("--") ? "" : l))
      .join("")
      .trim();
    expect(third).toBe("");
  });
});

describe("W340 §2/§7 — the column, and the CONTROL that it was not always there", () => {
  it("2a CONTROL: the OLD table has no carry_bps_recorded column", () => {
    const db = legacyDb();
    const cols = (db.prepare("PRAGMA table_info(mf_angel_chapter)").all() as any[]).map((c) => c.name);
    expect(cols).toContain("carry_bps");
    expect(cols).not.toContain(ANGEL_CHAPTER_CARRY_COLUMN);
  });

  it("2b the installer adds it NULLABLE with NO default, and says what it did", () => {
    const db = legacyDb();
    const res = ensureAngelChapterCarryRecorded(db);
    expect(res.failures).toEqual([]);
    expect(res.columnAdded).toBe(true);
    expect(res.columnAlreadyPresent).toBe(false);

    const col = (db.prepare("PRAGMA table_info(mf_angel_chapter)").all() as any[]).find(
      (c) => c.name === ANGEL_CHAPTER_CARRY_COLUMN,
    );
    expect(col).toBeTruthy();
    /* notnull=0 is the whole ruling: NULL must be storable. dflt_value must be
       absent — a default of 0 would put the fabricated zero straight back. */
    expect(col.notnull).toBe(0);
    expect(col.dflt_value).toBeNull();
  });

  it("2c the installer is idempotent and reports the second run honestly", () => {
    const db = legacyDb();
    ensureAngelChapterCarryRecorded(db);
    const again = ensureAngelChapterCarryRecorded(db);
    expect(again.failures).toEqual([]);
    expect(again.columnAdded).toBe(false);
    expect(again.columnAlreadyPresent).toBe(true);
  });

  it("2d the live store's table HAS the column (the installer runs on the real handle)", () => {
    const pid = "p_w340_col";
    profile(pid);
    mfcrmAngelStore.createChapter(pid, { name: "Column Present Check" }, ACTOR);
    const cols = (rawDb().prepare("PRAGMA table_info(mf_angel_chapter)").all() as any[]).map((c) => c.name);
    expect(cols).toContain(ANGEL_CHAPTER_CARRY_COLUMN);
  });
});

describe("W340 §3/§4 — the STORED ROW distinguishes 'not set' from a deliberate 0%", () => {
  it("3a a chapter created with NO carry stores NULL, not 0", () => {
    const pid = "p_w340_blank";
    profile(pid);
    const ch = mfcrmAngelStore.createChapter(pid, { name: "No Carry Agreed" }, ACTOR);
    const row = storedRow(ch.id);
    expect(row).toBeTruthy();
    expect(row.carry_bps_recorded).toBeNull();
    /* §4 — the legacy column is UNCHANGED in behaviour: still the integer 0. */
    expect(row.carry_bps).toBe(0);
  });

  it("3b a chapter created with an EXPLICIT 0 stores 0, and is now a different row", () => {
    const pid = "p_w340_zero";
    profile(pid);
    const blank = mfcrmAngelStore.createChapter(pid, { name: "Never Discussed" }, ACTOR);
    const zero = mfcrmAngelStore.createChapter(pid, { name: "Agreed Zero Percent", carryBps: 0 }, ACTOR);

    const a = storedRow(blank.id);
    const b = storedRow(zero.id);
    /* The old defect, stated as an assertion: the LEGACY column still cannot tell
       them apart. The NEW column can. Both halves are asserted so a regression in
       either direction is red. */
    expect(a.carry_bps).toBe(b.carry_bps);
    expect(a.carry_bps_recorded).toBeNull();
    expect(b.carry_bps_recorded).toBe(0);
    expect(a.carry_bps_recorded).not.toBe(b.carry_bps_recorded);
  });

  it("3c a real rate round-trips unchanged, and clearing it stores NULL again", () => {
    const pid = "p_w340_set";
    profile(pid);
    const ch = mfcrmAngelStore.createChapter(pid, { name: "Twenty Percent", carryBps: 2000 }, ACTOR);
    expect(storedRow(ch.id).carry_bps_recorded).toBe(2000);
    expect(storedRow(ch.id).carry_bps).toBe(2000);

    mfcrmAngelStore.setChapterCarry(pid, ch.id, 0);
    expect(storedRow(ch.id).carry_bps_recorded).toBe(0);

    mfcrmAngelStore.setChapterCarry(pid, ch.id, null);
    const cleared = storedRow(ch.id);
    expect(cleared.carry_bps_recorded).toBeNull();
    expect(cleared.carry_bps).toBe(0);
  });

  it("3d an UNUSABLE input records nothing rather than claiming 0%", () => {
    /* The old writer clamped: `Math.max(0, Math.trunc(NaN))` and `Number("")`
       both became 0, i.e. a claim. The new one records absence. The name-set of
       inputs that mean "nothing recorded" is asserted, not sampled. */
    const absent = [null, undefined, "", Number.NaN, -1, "abc"];
    expect(absent.map(recordedCarryBpsFromInput)).toEqual([null, null, null, null, null, null]);
    const present: Array<[unknown, number]> = [[0, 0], [1, 1], [2000, 2000], ["1250", 1250], [12.9, 12]];
    expect(present.map(([v]) => recordedCarryBpsFromInput(v))).toEqual(present.map(([, n]) => n));
  });

  it("3e the carry report exposes the honest field ALONGSIDE the legacy one", () => {
    const pid = "p_w340_report";
    profile(pid);
    mfcrmAngelStore.createChapter(pid, { name: "Reported Blank" }, ACTOR);
    const rows = mfcrmAngelStore.chapterCarryReport(pid);
    expect(rows.length).toBe(1);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["activeCount", "carryBps", "carryBpsRecorded", "chapterId", "engagementCount", "name", "region"],
    );
    expect(rows[0].carryBpsRecorded).toBeNull();
    expect(rows[0].carryBps).toBe(0);
  });
});

describe("W340 §5 — NOTHING is backfilled, and the ambiguity is reported", () => {
  it("5a rows written before the migration keep their bytes exactly", () => {
    const db = legacyDb();
    const ins = db.prepare(
      "INSERT INTO mf_angel_chapter (id, partner_id, name, carry_bps, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    );
    ins.run("legacy_zero", "p", "Legacy Zero", 0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    ins.run("legacy_rate", "p", "Legacy Rate", 2000, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    const before = db.prepare("SELECT id, carry_bps, created_at, updated_at FROM mf_angel_chapter ORDER BY id").all();

    const res = ensureAngelChapterCarryRecorded(db);
    expect(res.failures).toEqual([]);

    const after = db.prepare("SELECT id, carry_bps, created_at, updated_at FROM mf_angel_chapter ORDER BY id").all();
    expect(after).toEqual(before);
    /* Neither legacy row is given a recorded value. The migration guesses nothing. */
    const recorded = db
      .prepare("SELECT id, carry_bps_recorded FROM mf_angel_chapter ORDER BY id")
      .all() as any[];
    expect(recorded.every((r) => r.carry_bps_recorded === null)).toBe(true);
  });

  it("5b the installer COUNTS the rows whose zero is ambiguous, and names them", () => {
    const db = legacyDb();
    const ins = db.prepare(
      "INSERT INTO mf_angel_chapter (id, partner_id, name, carry_bps, created_at, updated_at) VALUES (?,?,?,?,?,?)",
    );
    ins.run("z1", "p", "Legacy Zero A", 0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    ins.run("z2", "p", "Legacy Zero B", 0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    ins.run("r1", "p", "Legacy Rate", 2500, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");

    const res = ensureAngelChapterCarryRecorded(db);
    expect(res.totalRows).toBe(3);
    expect(res.recordedRows).toBe(0);
    expect(res.legacyNonZeroRows).toBe(1);
    expect(res.ambiguousLegacyZeroRows).toBe(2);
  });

  it("5c a NEGATIVE recorded rate is refused by the column's own CHECK", () => {
    const db = legacyDb();
    ensureAngelChapterCarryRecorded(db);
    expect(() =>
      db
        .prepare(
          "INSERT INTO mf_angel_chapter (id, partner_id, name, carry_bps, carry_bps_recorded, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run("neg", "p", "Negative", 0, -1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toThrow(/CHECK constraint failed/i);
  });
});

describe("W340 §6 — the render rule, stated once in shared/", () => {
  it("6a a recorded 0 renders as a rate, NOT as 'Not set'", () => {
    expect(recordedCarryBps({ carry_bps: 0, carry_bps_recorded: 0 })).toBe(0);
    expect(hasRecordedCarry({ carry_bps: 0, carry_bps_recorded: 0 })).toBe(true);
  });

  it("6b nothing recorded and no legacy rate means 'Not set'", () => {
    expect(recordedCarryBps({ carry_bps: 0, carry_bps_recorded: null })).toBeNull();
    expect(hasRecordedCarry({ carry_bps: 0, carry_bps_recorded: null })).toBe(false);
    expect(ANGEL_CHAPTER_CARRY_NOT_SET_LABEL).toBe("Not set");
  });

  it("6c a PRE-MIGRATION rate is still shown — nothing is hidden by this wave", () => {
    expect(recordedCarryBps({ carry_bps: 2000, carry_bps_recorded: null })).toBe(2000);
    expect(recordedCarryBps({ carryBps: 2000, carryBpsRecorded: null })).toBe(2000);
  });

  it("6d the camelCase report shape is read by the same rule", () => {
    expect(recordedCarryBps({ carryBps: 0, carryBpsRecorded: 0 })).toBe(0);
    expect(recordedCarryBps({ carryBps: 0, carryBpsRecorded: null })).toBeNull();
    expect(recordedCarryBps(null)).toBeNull();
    expect(recordedCarryBps(undefined)).toBeNull();
  });
});

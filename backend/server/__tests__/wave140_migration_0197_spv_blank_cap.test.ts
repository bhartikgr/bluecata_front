/**
 * WAVE 140 — BATCH 1 · ITEM 1, DATA HALF: migrations/0197_wave140_spv_blank_cap_repair.sql.
 *
 * WHAT THE MIGRATION MAY AND MAY NOT DO, and how each clause is tested here:
 *
 *  · It MUST turn a PROVABLY CONTRADICTORY `cap_minor = 0` into NULL — a vehicle
 *    that says "raise 5,000,000 (or accept a 25,000 minimum cheque) and admit at
 *    most 0" is the shape the wizard's blank-means-zero bug produced, and it
 *    refuses every investor.
 *  · It MUST NOT touch an AMBIGUOUS row. `cap_minor = 0` with target 0 and
 *    minimum cheque 0 is self-consistent, there is no provenance column for
 *    `cap_minor`, and a deliberate zero is indistinguishable from a blank one
 *    there. Never destroy a deliberate value — so that row is reported to the
 *    owner, not rewritten. The count is asserted below AND measured against the
 *    real databases.
 *  · It MUST NOT use a `created_at` cutoff. A cutoff already in the past would
 *    permanently exempt vehicles created earlier the same day by unfixed code,
 *    and migrations never re-run. Asserted as a literal absence in the SQL.
 *  · It MUST be idempotent and a verified no-op against the real databases,
 *    which are only ever COPIED — their sha256 is captured before and after.
 *
 * ANTI-VACUITY. The fixture asserts BOTH POLES on every row class: repaired rows
 * become NULL, and untouched rows keep their exact prior value, in the same
 * table, in the same run. The statement count is pinned so the file can never
 * degrade into running nothing. The DDL for the fixture is READ OUT OF THE REAL
 * DATABASE's `sqlite_master`, not hand-written, so the fixture cannot drift into
 * a shape the migration would behave differently against.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { splitStatements } from "../db/migrate";

const ROOT = process.cwd();
const SCRATCH = join(ROOT, "w140_scratch", "dbs");
const M0197 = "migrations/0197_wave140_spv_blank_cap_repair.sql";
const MIRROR = "server/db/migrations/0197_wave140_spv_blank_cap_repair.sql";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require("better-sqlite3");

type Db = {
  exec: (s: string) => unknown;
  prepare: (s: string) => {
    get: (...a: unknown[]) => any;
    all: (...a: unknown[]) => any[];
    run: (...a: unknown[]) => { changes: number };
  };
  close: () => void;
};

function sqlOf(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}
function sha(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/** The migration's executable statements, `--` comment lines stripped. */
function statements(): string[] {
  const out = splitStatements(sqlOf(M0197))
    .map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
    .filter((s) => s.length > 0);
  expect(out.length).toBe(1); // anti-vacuity: never run zero statements
  expect(out[0].slice(0, 6).toUpperCase()).toBe("UPDATE");
  return out;
}

function fresh(name: string): Db {
  mkdirSync(SCRATCH, { recursive: true });
  const p = join(SCRATCH, name);
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(p + suffix)) rmSync(p + suffix);
  return new Database(p) as Db;
}
function copyDb(src: string, name: string): Db {
  mkdirSync(SCRATCH, { recursive: true });
  const dest = join(SCRATCH, name);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dest + suffix)) rmSync(dest + suffix);
    if (existsSync(join(ROOT, src + suffix))) copyFileSync(join(ROOT, src + suffix), dest + suffix);
  }
  return new Database(dest) as Db;
}
/** Run the migration exactly as `server/db/migrate.ts` would. */
function apply(db: Db): number {
  let changes = 0;
  for (const s of splitStatements(sqlOf(M0197))) {
    if (s.trim()) changes += db.prepare(s.trim()).run().changes;
  }
  return changes;
}

/** The REAL `spv` DDL and the REAL WAVE48/0186 money triggers, from data.db. */
function realSpvSchema(): string[] {
  const src = copyDb("data.db", "schema_source.db");
  const ddl: string[] = [
    src.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='spv'`).get().sql,
  ];
  for (const r of src.prepare(
    `SELECT sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'w48_money_typefloor_%_spv_cap_minor'`,
  ).all()) {
    ddl.push(r.sql);
  }
  src.close();
  // Both the insert and the update type-floor trigger must be present, or the
  // "the trigger accepts NULL" case below would prove nothing.
  expect(ddl.length).toBe(3);
  return ddl;
}

type Row = { id: string; cap: number | null; target: number | null; minCheck: number | null };

function seed(db: Db, rows: Row[]): void {
  for (const d of realSpvSchema()) db.exec(d);
  const ins = db.prepare(`
    INSERT INTO spv (id, sponsor_partner_id, name, jurisdiction, carry_basis,
                     target_raise_minor, min_check_minor, cap_minor,
                     created_at, updated_at, curr_hash)
    VALUES (?, 'ac_w140', ?, 'delaware', 'whole_spv', ?, ?, ?,
            '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'h')`);
  for (const r of rows) ins.run(r.id, `W140 ${r.id}`, r.target, r.minCheck, r.cap);
}
const capOf = (db: Db, id: string): number | null =>
  db.prepare(`SELECT cap_minor FROM spv WHERE id=?`).get(id).cap_minor;
const ambiguousCount = (db: Db): number =>
  db.prepare(
    `SELECT COUNT(*) AS n FROM spv
      WHERE cap_minor = 0
        AND COALESCE(target_raise_minor, 0) = 0
        AND COALESCE(min_check_minor, 0) = 0`,
  ).get().n;

/** The five row classes, all in ONE table, so both poles are proven together. */
const FIXTURE: Row[] = [
  // contradictory: a real target with a 0 cap — the wizard's blank-cap shape
  { id: "s_contra_target", cap: 0, target: 5000000, minCheck: null },
  // contradictory the other way: a minimum cheque larger than the 0 cap
  { id: "s_contra_mincheck", cap: 0, target: 0, minCheck: 25000 },
  // AMBIGUOUS: every money field 0. Self-consistent. Must survive untouched.
  { id: "s_ambiguous", cap: 0, target: 0, minCheck: 0 },
  // a deliberate, coherent cap. Must survive untouched.
  { id: "s_real_cap", cap: 100000, target: 100000, minCheck: 25000 },
  // already correct: no cap at all. Must stay NULL.
  { id: "s_null_cap", cap: null, target: 5000000, minCheck: 25000 },
];

describe("WAVE 140 · 0197 — repairs only what is provably contradictory", () => {
  it("M1 — a contradictory 0 cap becomes NULL; an ambiguous 0 and a real cap are untouched", () => {
    const db = fresh("fixture.db");
    seed(db, FIXTURE);

    // Pre-state, asserted, so the post-state is a measured change and not a
    // coincidence with the seed.
    expect(capOf(db, "s_contra_target")).toBe(0);
    expect(capOf(db, "s_contra_mincheck")).toBe(0);
    expect(capOf(db, "s_ambiguous")).toBe(0);
    expect(capOf(db, "s_real_cap")).toBe(100000);
    expect(capOf(db, "s_null_cap")).toBeNull();

    const changes = apply(db);
    expect(changes).toBe(2); // exactly the two contradictory rows

    expect(capOf(db, "s_contra_target")).toBeNull();
    expect(capOf(db, "s_contra_mincheck")).toBeNull();
    expect(capOf(db, "s_ambiguous")).toBe(0); // NOT destroyed
    expect(capOf(db, "s_real_cap")).toBe(100000); // NOT destroyed
    expect(capOf(db, "s_null_cap")).toBeNull();

    // and the ambiguous row is still countable by the diagnostic the migration
    // header gives the owner.
    expect(ambiguousCount(db)).toBe(1);
    db.close();
  });

  it("M2 — nothing else on the repaired rows is rewritten", () => {
    const db = fresh("fields.db");
    seed(db, FIXTURE);
    const before = db.prepare(`SELECT * FROM spv WHERE id='s_contra_target'`).get();
    apply(db);
    const after = db.prepare(`SELECT * FROM spv WHERE id='s_contra_target'`).get();
    for (const k of Object.keys(before)) {
      if (k === "cap_minor") continue;
      expect(after[k]).toBe(before[k]);
    }
    // Including the fields a careless repair would have touched.
    expect(after.updated_at).toBe("2026-08-01T00:00:00.000Z");
    expect(after.target_raise_minor).toBe(5000000);
    expect(after.curr_hash).toBe("h");
    db.close();
  });

  it("M3 — idempotent: a second and third run change nothing", () => {
    const db = fresh("idem.db");
    seed(db, FIXTURE);
    expect(apply(db)).toBe(2);
    expect(apply(db)).toBe(0);
    expect(apply(db)).toBe(0);
    expect(capOf(db, "s_ambiguous")).toBe(0);
    expect(capOf(db, "s_real_cap")).toBe(100000);
    db.close();
  });

  it("M4 — the WAVE48/0186 money type floor accepts the NULL this migration writes", () => {
    const db = fresh("trigger.db");
    seed(db, FIXTURE);
    // The trigger is genuinely armed: a non-integer cap is refused.
    expect(() =>
      db.prepare(`UPDATE spv SET cap_minor='oops' WHERE id='s_real_cap'`).run(),
    ).toThrow(/money type floor/);
    // …and the migration still runs.
    expect(apply(db)).toBe(2);
    expect(capOf(db, "s_contra_target")).toBeNull();
    db.close();
  });
});

describe("WAVE 140 · 0197 — the SQL itself", () => {
  it("M5 — exactly one UPDATE, and no created_at cutoff anywhere in it", () => {
    const [stmt] = statements();
    expect(stmt).toContain("cap_minor = NULL");
    expect(stmt).toContain("WHERE cap_minor = 0");
    // R108.4 item 7: a cutoff already in the past would exempt rows forever.
    expect(stmt.toLowerCase()).not.toContain("created_at");
    expect(stmt.toLowerCase()).not.toContain("updated_at");
  });

  it("M6 — no float, no CAST, no /100 or *100 in the EXECUTABLE SQL", () => {
    /* Measured on the comment-stripped statement, not the whole file. The header
       prose deliberately DISCUSSES `/100` and `×100` in order to record that
       neither is used, and a whole-file grep would be fooled by its own
       documentation — the exact trap the money rules warn about. */
    const [stmt] = statements();
    expect(stmt).not.toMatch(/\/\s*100\b/);
    expect(stmt).not.toMatch(/\*\s*100\b/);
    expect(stmt.toUpperCase()).not.toContain("CAST(");
    expect(stmt).not.toMatch(/\d+\.\d+/); // no decimal literals
    // and it is a data repair only
    for (const forbidden of ["CREATE TABLE", "ALTER TABLE", "DROP ", "INSERT INTO"]) {
      expect(stmt.toUpperCase()).not.toContain(forbidden);
    }
  });

  it("M7 — the byte mirror under server/db/migrations is identical", () => {
    expect(sqlOf(MIRROR)).toBe(sqlOf(M0197));
    expect(sha(join(ROOT, MIRROR))).toBe(sha(join(ROOT, M0197)));
  });

  it("M8 — the file documents the ambiguous-row diagnostic the owner needs", () => {
    const full = sqlOf(M0197);
    // The exact countable query, so the owner is not left to invent one.
    expect(full).toContain("SELECT COUNT(*) FROM spv");
    expect(full).toContain("COALESCE(min_check_minor, 0) = 0");
  });
});

describe("WAVE 140 · 0197 — against the REAL databases, by copy only", () => {
  for (const src of ["data.db", "test.db"]) {
    it(`M9 — ${src}: a verified no-op, with the ambiguous count reported`, () => {
      if (!existsSync(join(ROOT, src))) return; // nothing to prove
      const before = sha(join(ROOT, src));

      const db = copyDb(src, `copy_${src}`);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM spv`).get().n;
      const zeros = db.prepare(`SELECT COUNT(*) AS n FROM spv WHERE cap_minor = 0`).get().n;
      const ambiguous = ambiguousCount(db);

      const changes = apply(db);
      // The measured claim recorded in W140_BUILD.md: this workspace holds no
      // damaged row, so the repair is a no-op here and NOTHING is ambiguous.
      expect(changes).toBe(zeros - ambiguous);
      expect(changes).toBe(0);
      expect(ambiguous).toBe(0);
      expect(total).toBeGreaterThanOrEqual(0);
      // idempotent on real data too
      expect(apply(db)).toBe(0);
      db.close();

      // THE ORIGINAL WAS NEVER OPENED FOR WRITE.
      expect(sha(join(ROOT, src))).toBe(before);
    });
  }
});

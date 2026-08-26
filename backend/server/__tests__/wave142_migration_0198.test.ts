/**
 * WAVE 142 — BATCH 1 · ITEM 2, DATA HALF:
 * migrations/0198_batch1_collective_application_fee_decontamination.sql
 *
 * WHAT THE MIGRATION MUST AND MUST NOT DO, and how each clause is tested here:
 *
 *  · It MUST move a contaminated `amount_minor = 24000` row (the CONSORTIUM
 *    PARTNER ANNUAL figure from 0185/`partner_tier_prices`, which reached a
 *    Collective surface and was quoted to a founder) to the canonical
 *    30000 = $300.00 (R101), in TRUE MINOR UNITS, as an integer.
 *  · It MUST NOT clobber a price a human deliberately set. The guard is VALUE
 *    (=24000) AND PROVENANCE (updated_by IS NULL OR ''), because
 *    `updateApplicationFee()` coerces a falsy actor to 'admin' and therefore can
 *    never leave NULL or ''. Both poles are asserted in the same run.
 *  · It MUST leave any other amount alone — 30000 already-correct rows, and any
 *    other figure, are out of scope.
 *  · It MUST be idempotent, and a verified NO-OP against the real databases,
 *    which are only ever COPIED. Their sha256 is captured before and after.
 *  · It MUST NOT convert units. WAVE48/0186 installs a BEFORE UPDATE type-floor
 *    trigger that ABORTS a non-integer amount; the fixture installs the REAL
 *    triggers read out of the REAL database's `sqlite_master`, so a /100 or a
 *    float literal would fail here rather than in production.
 *
 * ANTI-VACUITY. The statement count is pinned (the file can never degrade into
 * running nothing), the DDL and triggers are read from the real database rather
 * than hand-written, the mirror is byte-compared, and every row class asserts
 * BOTH poles: repaired rows change, protected rows keep their exact prior values.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { splitStatements } from "../db/migrate";

const ROOT = process.cwd();
const SCRATCH = join(ROOT, "w142_scratch", "dbs");
const NAME = "0198_batch1_collective_application_fee_decontamination.sql";
const M0198 = `migrations/${NAME}`;
const MIRROR = `server/db/migrations/${NAME}`;
const TABLE = "collective_application_fee_config";

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

type Row = {
  id: string;
  amount_minor: number;
  currency: string;
  updated_at: string;
  updated_by: string | null;
};

function sqlOf(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}
function sha(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}
/** The executable SQL only: every `--` comment line removed. */
function executable(): string {
  return sqlOf(M0198)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .trim();
}
function statements(): string[] {
  const out = splitStatements(sqlOf(M0198))
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
  for (const s of splitStatements(sqlOf(M0198))) {
    if (s.trim()) changes += db.prepare(s.trim()).run().changes;
  }
  return changes;
}
/** The REAL config DDL and the REAL WAVE48/0186 money triggers, from data.db. */
function realSchema(): string[] {
  const src = copyDb("data.db", "schema_source.db");
  const ddl: string[] = [
    src.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${TABLE}'`).get().sql,
  ];
  for (const r of src
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='trigger'
         AND name LIKE 'w48_money_typefloor_%_${TABLE}_amount_minor'`,
    )
    .all()) {
    ddl.push(r.sql);
  }
  src.close();
  /* Insert AND update type-floor triggers, or "the trigger would have caught a
     float" proves nothing below. */
  expect(ddl.length).toBe(3);
  return ddl;
}
function seed(db: Db, rows: Row[]): void {
  for (const d of realSchema()) db.exec(d);
  const ins = db.prepare(
    `INSERT INTO ${TABLE} (id, amount_minor, currency, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const r of rows) ins.run(r.id, r.amount_minor, r.currency, r.updated_at, r.updated_by);
}
function read(db: Db, id: string): Row {
  return db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Row;
}

const CONTAMINATED: Row = {
  id: "default",
  amount_minor: 24000,
  currency: "USD",
  updated_at: "2026-07-01 10:00:00",
  updated_by: null,
};

describe("WAVE 142 · G — the file itself", () => {
  it("G1 is byte-identical to its server/db/migrations mirror (id >= 0068)", () => {
    expect(existsSync(join(ROOT, MIRROR))).toBe(true);
    expect(sha(join(ROOT, M0198))).toBe(sha(join(ROOT, MIRROR)));
  });

  it("G2 is exactly ONE guarded UPDATE against the Collective config table", () => {
    const s = statements();
    expect(s[0]).toContain(TABLE);
    expect(s[0]).toContain("amount_minor = 24000");
    expect(s[0]).toContain("updated_by IS NULL OR updated_by = ''");
    /* platform_fees is not touched: R108.3 deferred consolidation to batch 2. */
    expect(s[0]).not.toContain("platform_fees");
    /* And it never widens into every row. */
    expect(s[0]).toContain("id = 'default'");
  });

  it("G3 converts no units — no /100, *100, float literal or CAST anywhere", () => {
    /* Applied to COMMENT-STRIPPED text: the header discusses these tokens in
       prose, and matching prose would make this assertion a lie either way. */
    const code = executable();
    expect(code).not.toMatch(/\/\s*100/);
    expect(code).not.toMatch(/\*\s*100/);
    expect(code).not.toMatch(/CAST/i);
    /* Float check runs on the code with SQL string literals removed: the
       provenance timestamp '2026-08-25T00:00:00.000Z' is a quoted TEXT value,
       not an arithmetic literal, and must not be mistaken for one. */
    const noLiterals = code.replace(/'[^']*'/g, "''");
    expect(noLiterals).not.toMatch(/\d+\.\d+/);
    expect(noLiterals).toContain("amount_minor = 30000");
    /* The target is the canonical integer, in true minor units. */
    expect(code).toMatch(/amount_minor = 30000/);
  });
});

describe("WAVE 142 · H — behaviour on a fresh database with the REAL schema", () => {
  it("H1 THE REPAIR — a 24000 row with NO provenance becomes 30000/USD, stamped", () => {
    const db = fresh("h1.db");
    seed(db, [CONTAMINATED]);
    expect(apply(db)).toBe(1);
    const r = read(db, "default");
    expect(r.amount_minor).toBe(30000);
    expect(Number.isInteger(r.amount_minor)).toBe(true);
    expect(r.currency).toBe("USD");
    expect(r.updated_by).toBe("system:migration:0198_batch1");
    /* The foreign figure is gone, and was not merely re-denominated. */
    expect(r.amount_minor).not.toBe(24000);
    expect(r.amount_minor).not.toBe(240);
    expect(r.amount_minor).not.toBe(2400000);
    db.close();
  });

  it("H2 an EMPTY-STRING provenance is the same 'no provenance' class and is repaired", () => {
    const db = fresh("h2.db");
    seed(db, [{ ...CONTAMINATED, updated_by: "" }]);
    expect(apply(db)).toBe(1);
    expect(read(db, "default").amount_minor).toBe(30000);
    db.close();
  });

  it("H3 THE PROTECTION POLE — a HUMAN-SET 24000 survives completely untouched", () => {
    /* A deliberately-set value is never clobbered. If an administrator really
       chose $240.00, this migration must not overrule them; the resolver's new
       `source` surfacing is how the owner sees and corrects it instead. */
    const db = fresh("h3.db");
    const human: Row = { ...CONTAMINATED, updated_by: "u_admin_shadie" };
    seed(db, [human]);
    expect(apply(db)).toBe(0);
    expect(read(db, "default")).toEqual(human);
    db.close();
  });

  it("H4 any OTHER amount is out of scope, including the already-correct 30000", () => {
    const db = fresh("h4.db");
    /* The real table's id is a PRIMARY KEY, so these are separate rows to prove
       the WHERE never widens; only `default` is ever a candidate anyway. */
    const already: Row = { ...CONTAMINATED, id: "default", amount_minor: 30000, updated_by: null };
    seed(db, [already]);
    expect(apply(db)).toBe(0);
    expect(read(db, "default")).toEqual(already);
    db.close();

    const db2 = fresh("h4b.db");
    const other: Row = { ...CONTAMINATED, amount_minor: 45000, updated_by: null };
    seed(db2, [other]);
    expect(apply(db2)).toBe(0);
    expect(read(db2, "default")).toEqual(other);
    db2.close();
  });

  it("H5 IDEMPOTENT — a second and third apply change nothing further", () => {
    const db = fresh("h5.db");
    seed(db, [CONTAMINATED]);
    expect(apply(db)).toBe(1);
    const after = read(db, "default");
    expect(apply(db)).toBe(0);
    expect(apply(db)).toBe(0);
    expect(read(db, "default")).toEqual(after);
    db.close();
  });

  it("H6 the REAL type-floor trigger is live in the fixture — a float WOULD have aborted", () => {
    /* Proves H1 was not passing through a triggerless fixture: the same handle
       rejects a fractional amount, which is what a /100 in the migration would
       have produced. */
    const db = fresh("h6.db");
    seed(db, [CONTAMINATED]);
    expect(() =>
      db.prepare(`UPDATE ${TABLE} SET amount_minor = 300.5 WHERE id = 'default'`).run(),
    ).toThrow();
    expect(read(db, "default").amount_minor).toBe(24000);
    db.close();
  });
});

describe("WAVE 142 · I — against COPIES of the real databases", () => {
  const targets = ["data.db", "test.db"].filter((f) => existsSync(join(ROOT, f)));

  it("I0 both real databases exist and are readable", () => {
    expect(targets.length).toBe(2);
  });

  for (const file of targets) {
    it(`I — ${file}: no row holds 24000, so the migration is a verified NO-OP (changes = 0)`, () => {
      const before = sha(join(ROOT, file));
      const db = copyDb(file, `real_${file}`);
      const prior = read(db, "default");
      /* Measured state of this tree: 30000/USD with NULL provenance. */
      expect(prior.amount_minor).toBe(30000);
      expect(prior.updated_by).toBeNull();

      expect(apply(db)).toBe(0);
      expect(read(db, "default")).toEqual(prior);
      /* Idempotent on the real shape too. */
      expect(apply(db)).toBe(0);
      db.close();

      /* The original file was never opened for writing. */
      expect(sha(join(ROOT, file))).toBe(before);
    });

    it(`I — ${file}: if that same row WERE contaminated, the copy repairs to 30000`, () => {
      /* Anti-vacuity for the no-op above: the migration is proven to still bite
         against the REAL schema, triggers and neighbouring rows of this file —
         only the COPY is contaminated, never the original. */
      const before = sha(join(ROOT, file));
      const db = copyDb(file, `real_bite_${file}`);
      db.prepare(
        `UPDATE ${TABLE} SET amount_minor = 24000, updated_by = NULL WHERE id = 'default'`,
      ).run();
      expect(apply(db)).toBe(1);
      const r = read(db, "default");
      expect(r.amount_minor).toBe(30000);
      expect(r.updated_by).toBe("system:migration:0198_batch1");
      db.close();
      expect(sha(join(ROOT, file))).toBe(before);
    });
  }
});

/**
 * WAVE 36 · ROW 8 — falsification harness for the fresh-install schema gap.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * The v25.51 name split shipped as three migrations written into the MIRROR
 * only (server/db/migrations/0092, 0093, 0095). Canonical `migrations/` has
 * never contained them, so an install performed from the canonical directory
 * ends with EIGHT tables missing NINETEEN columns the running code reads and
 * writes. The second review reported 12; the true number is 19 — every
 * `first_name` it listed has an equally missing `last_name`, plus
 * `founder_crm_contacts.company_name`.
 *
 * It stayed invisible because server/db/connection.ts self-heals the same
 * columns, and that self-heal runs only on the SQLITE branch (`getDb()` returns
 * early for Postgres at connection.ts:115). On Postgres, nothing supplies them.
 *
 * ── WHAT THIS HARNESS ASSERTS, AND HOW ──────────────────────────────────────
 * It asserts the RESULTING SCHEMA, never an exit code. Every pole executes real
 * DDL against a real database engine and then reads the catalogue back:
 *
 *   P1 (regression witness)  canonical migrations/ WITHOUT 0182 do not supply a
 *                            single one of the 19 columns — proven by parsing
 *                            every canonical .sql, so the fix is not credited
 *                            with work some other file already did.
 *   P2 (SQLite, fresh)       real better-sqlite3 DB + the shipped runner over a
 *                            directory containing ONLY 0182 → all 19 present.
 *   P3 (SQLite, already healed)  same file over a DB that ALREADY has the
 *                            columns → succeeds, columns unchanged, no
 *                            duplicate-column explosion.
 *   P4 (Postgres, fresh)     real Postgres (PGlite/wasm) → all 19 present,
 *                            read from information_schema.
 *   P5 (Postgres, re-run)    the identical file applied twice → the second run
 *                            raises exactly the error class the SHIPPED
 *                            `isIdempotentPostgresError` swallows.
 *   P6 (mirror + identity)   canonical and mirror copies are byte-identical;
 *                            0182 is a STABLE IDENTITY (uniquely claimed in
 *                            both directories, cmp-identical, no BURNT id
 *                            reused) and the canonical corpus ALONE carries all
 *                            19 columns — none of them without 0182.
 *                            WAVE 38: the old "0182 is the highest id" pin was
 *                            invalidated by migration 0183 and was REPLACED,
 *                            not re-pinned to 0183. See the comment at P6.
 *
 * Static imports only. Every precondition is built by the test; nothing is read
 * from process.env.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { PGlite } from "@electric-sql/pglite";

import { runMigrations, splitStatements } from "../db/migrate";

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATION = "0182_wave36_name_split_fresh_install.sql";
const CANONICAL = path.join(ROOT, "migrations", MIGRATION);
const MIRROR = path.join(ROOT, "server", "db", "migrations", MIGRATION);

/** The full name-split surface: 8 tables, 19 columns. */
const EXPECTED: Array<[string, string]> = [
  ["founder_crm_contacts", "first_name"],
  ["founder_crm_contacts", "last_name"],
  ["founder_crm_contacts", "company_name"],
  ["partner_crm_contacts", "first_name"],
  ["partner_crm_contacts", "last_name"],
  ["consortium_applications", "contact_first_name"],
  ["consortium_applications", "contact_last_name"],
  ["round_invitations", "investor_first_name"],
  ["round_invitations", "investor_last_name"],
  ["soft_circles", "investor_first_name"],
  ["soft_circles", "investor_last_name"],
  ["users", "first_name"],
  ["users", "last_name"],
  ["user_credentials", "first_name"],
  ["user_credentials", "last_name"],
  ["investor_crm_contacts", "first_name"],
  ["investor_crm_contacts", "last_name"],
  ["captable_commits", "holder_first_name"],
  ["captable_commits", "holder_last_name"],
];

const TABLES = [...new Set(EXPECTED.map(([t]) => t))];

/** The eight tables in their PRE-name-split shape, i.e. exactly what a fresh
 *  install has before 0182 runs. Deliberately minimal: this harness is about
 *  the 19 added columns, and a fuller shape would only add ways to be wrong
 *  about something else. */
function baseTableDdl(idType: string): string[] {
  return TABLES.map((t) => `CREATE TABLE ${t} (id ${idType} PRIMARY KEY, name TEXT)`);
}

let tmpRoot = "";
beforeAll(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "w36row8-")); });
afterAll(() => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* noop */ } });

/** A directory containing ONLY 0182, so the run under test cannot be carried by
 *  any other migration. */
function soloMigrationDir(): string {
  const d = fs.mkdtempSync(path.join(tmpRoot, "solo-"));
  fs.copyFileSync(CANONICAL, path.join(d, MIGRATION));
  return d;
}

function sqliteColumns(db: InstanceType<typeof Database>, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/* ── P1 — the regression witness ─────────────────────────────────────────── */

describe("WAVE 36 ROW 8 · P1 — canonical migrations WITHOUT 0182 supply none of the 19 columns", () => {
  it("no canonical .sql other than 0182 creates or adds any of them", () => {
    const dir = path.join(ROOT, "migrations");
    const files = fs.readdirSync(dir).filter((f) => /^\d{4,}_.*\.sql$/i.test(f));
    /* S0 — the scan is scanning. 162 files existed before 0182 was added. */
    expect(files.length).toBeGreaterThan(150);
    expect(files).toContain(MIGRATION);

    const suppliers = new Map<string, string[]>();
    for (const f of files) {
      if (f === MIGRATION) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const [t, c] of EXPECTED) {
        const alter = new RegExp(`ALTER\\s+TABLE\\s+${t}\\s+ADD\\s+COLUMN\\s+${c}\\b`, "i");
        const create = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${t}\\s*\\(([\\s\\S]*?)\\n\\s*\\)`, "i");
        const m = create.exec(src);
        const inCreate = m ? new RegExp(`(^|[\\s,(])${c}\\s`, "m").test(m[1]) : false;
        if (alter.test(src) || inCreate) {
          const k = `${t}.${c}`;
          suppliers.set(k, [...(suppliers.get(k) ?? []), f]);
        }
      }
    }
    expect(
      [...suppliers.entries()].map(([k, v]) => `${k} <- ${v.join(",")}`),
      "some other canonical migration already supplies these — 0182 would be redundant for them",
    ).toEqual([]);
  });

  it("the MIRROR does contain the three files canonical never received", () => {
    /* The asymmetry IS the defect; asserted so the diagnosis cannot rot. */
    const mirrorDir = path.join(ROOT, "server", "db", "migrations");
    const mirror = fs.readdirSync(mirrorDir);
    for (const f of [
      "0092_v25_51_founder_crm_first_last_company.sql",
      "0093_v25_51_name_split_phase1.sql",
      "0095_v25_51_name_split_phase4.sql",
    ]) {
      expect(mirror, `mirror should still have ${f}`).toContain(f);
      expect(fs.readdirSync(path.join(ROOT, "migrations")), `canonical must NOT have ${f}`).not.toContain(f);
    }
  });
});

/* ── P2 / P3 — SQLite, through the SHIPPED runner ────────────────────────── */

describe("WAVE 36 ROW 8 · P2 — a fresh SQLite database gets all 19 columns", () => {
  it("runs 0182 via the shipped runMigrations and the SCHEMA proves it", async () => {
    const dbFile = path.join(tmpRoot, `fresh-${crypto.randomUUID()}.db`);
    const seed = new Database(dbFile);
    for (const ddl of baseTableDdl("TEXT")) seed.exec(ddl);
    /* Precondition asserted, not assumed: zero of the 19 exist yet. */
    for (const [t, c] of EXPECTED) expect(sqliteColumns(seed, t).has(c), `${t}.${c} present too early`).toBe(false);
    seed.close();

    const res = await runMigrations({
      databaseUrl: `file:${dbFile}`,
      migrationsDir: soloMigrationDir(),
      skipInlineBaseline: true,   // the whole point: NO connection.ts self-heal
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(res.applied).toEqual([MIGRATION]);
    expect(res.deferred).toEqual([]);

    /* THE ASSERTION THAT MATTERS — the catalogue, not the exit code. */
    const db = new Database(dbFile, { readonly: true });
    const missing: string[] = [];
    for (const [t, c] of EXPECTED) if (!sqliteColumns(db, t).has(c)) missing.push(`${t}.${c}`);
    db.close();
    expect(missing).toEqual([]);
  });
});

describe("WAVE 36 ROW 8 · P3 — a database that already self-healed is unharmed", () => {
  it("0182 over an already-healed SQLite DB succeeds and changes nothing", async () => {
    const dbFile = path.join(tmpRoot, `healed-${crypto.randomUUID()}.db`);
    const seed = new Database(dbFile);
    for (const ddl of baseTableDdl("TEXT")) seed.exec(ddl);
    /* Reproduce what connection.ts's self-heal leaves behind. */
    for (const [t, c] of EXPECTED) seed.exec(`ALTER TABLE ${t} ADD COLUMN ${c} TEXT`);
    const before = Object.fromEntries(TABLES.map((t) => [t, [...sqliteColumns(seed, t)].sort().join(",")]));
    seed.close();

    const res = await runMigrations({
      databaseUrl: `file:${dbFile}`,
      migrationsDir: soloMigrationDir(),
      skipInlineBaseline: true,
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    expect(res.applied).toEqual([MIGRATION]);

    const db = new Database(dbFile, { readonly: true });
    const after = Object.fromEntries(TABLES.map((t) => [t, [...sqliteColumns(db, t)].sort().join(",")]));
    db.close();
    expect(after).toEqual(before);
  });
});

/* ── P4 / P5 — Postgres, the branch with NO self-heal at all ─────────────── */

describe("WAVE 36 ROW 8 · P4/P5 — the Postgres branch, where nothing else supplies the columns", () => {
  it("a real Postgres database gets all 19, and a re-run is idempotent by the SHIPPED rule", async () => {
    const pg = new PGlite("memory://");
    try {
      for (const ddl of baseTableDdl("TEXT")) await pg.exec(ddl);
      const cols = async (t: string) => {
        const r = await pg.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_name = $1", [t],
        );
        return new Set(r.rows.map((x) => x.column_name));
      };
      for (const [t, c] of EXPECTED) expect((await cols(t)).has(c), `${t}.${c} present too early`).toBe(false);

      const stmts = splitStatements(fs.readFileSync(CANONICAL, "utf8"));
      /* S0 — the shipped splitter found the 19 ALTERs and did not, for example,
         hand back one giant blob of comment text. */
      expect(stmts.filter((s) => /ALTER TABLE/i.test(s)).length).toBe(19);
      for (const s of stmts) await pg.exec(s);

      const missing: string[] = [];
      for (const [t, c] of EXPECTED) if (!(await cols(t)).has(c)) missing.push(`${t}.${c}`);
      expect(missing).toEqual([]);

      /* P5 — the second run. Postgres DOES raise on a duplicate ADD COLUMN; the
         claim under test is that the error is one the SHIPPED runner swallows,
         so the file is safe to re-apply. Both halves are asserted: the real
         error text, and the fact that the shipped predicate matches it. */
      let msg = "";
      try { await pg.exec(stmts.find((s) => /ALTER TABLE/i.test(s))!); }
      catch (e: any) { msg = e?.message ?? String(e); }
      expect(msg, "a duplicate ADD COLUMN must actually raise, or this pole proves nothing").not.toBe("");
      expect(msg).toMatch(/already exists/i);

      const runnerSrc = fs.readFileSync(path.join(ROOT, "server", "db", "migrate.ts"), "utf8");
      expect(runnerSrc).toContain("function isIdempotentPostgresError");   // S0
      const body = runnerSrc.slice(
        runnerSrc.indexOf("function isIdempotentPostgresError"),
        runnerSrc.indexOf("}", runnerSrc.indexOf("function isIdempotentPostgresError")),
      );
      expect(body).toMatch(/\/already exists\/i/);
      expect(/already exists/i.test(msg), "the shipped predicate must match the REAL error").toBe(true);
    } finally {
      await pg.close();
    }
  }, 60_000);
});

/* ── P6 — mirrored byte-identically ──────────────────────────────────────── */

describe("WAVE 36 ROW 8 · P6 — canonical and mirror are the same bytes", () => {
  it("sha256(canonical) === sha256(mirror)", () => {
    const h = (p: string) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    expect(fs.existsSync(CANONICAL)).toBe(true);
    expect(fs.existsSync(MIRROR)).toBe(true);
    expect(h(MIRROR)).toBe(h(CANONICAL));
  });

  /**
   * WAVE 38 — THE COUNT PIN IS GONE, AND IT WAS NOT REPLACED BY A BIGGER COUNT.
   *
   * WHAT WAS HERE. `expect(top(dir)).toBe(MIGRATION)` — "0182 is the highest id
   * in BOTH directories". Wave 38 Row 4 added migration 0183, so it went red.
   *
   * WHY IT WAS NOT SIMPLY BUMPED TO 0183. That is the exact failure Row 3 of
   * this wave documented at length: two pins in this codebase had been
   * re-pinned to a fresh NUMBER, wave after wave, rather than repaired, and a
   * number-shaped pin goes red for arithmetic reasons every time the codebase
   * legitimately grows while staying blind to the substitution that matters
   * (one route leaving the missed set while another joins). Re-pinning to 0183
   * would guarantee the next migration reopens this file, and would still not
   * assert anything about 0182 itself. "Highest id" was never the property
   * under test; it was a proxy for "0182 landed, in both directories, intact".
   *
   * WHAT REPLACED IT — a STABLE IDENTITY assertion, true before 0183 existed
   * and true after 0999 lands:
   *   (a) exactly one file in each directory claims id 0182, and it is THIS
   *       file, by name — an identity, not an extremum;
   *   (b) the two copies are byte-identical (`cmp`-equivalent: length + a
   *       `Buffer.equals`, so a same-length one-byte edit cannot slip through);
   *   (c) neither directory reuses a BURNT id (0152/0154/0155/0158, ruling
   *       A-17), and 0182 is not one of them;
   *   (d) no id is double-claimed inside either directory.
   * Nothing here mentions the number of migrations, or which one is last.
   */
  it("0182 is a stable identity in BOTH directories: uniquely claimed, byte-identical, no BURNT id reused", () => {
    const numbered = (dir: string) =>
      fs.readdirSync(dir).filter((f) => /^\d{4,}_.*\.sql$/i.test(f));
    const idOf = (f: string) => Number(/^(\d{4,})_/.exec(f)![1]);

    /* S0 — anti-vacuity. An empty or mis-globbed listing would make every
       assertion below trivially true, which is the failure class this file
       exists to prevent. */
    const dirs: Array<[string, string]> = [
      ["migrations", path.join(ROOT, "migrations")],
      ["server/db/migrations", path.join(ROOT, "server", "db", "migrations")],
    ];
    for (const [label, dir] of dirs) {
      const files = numbered(dir);
      expect(files.length, `${label} listing is empty — the scan is not scanning`).toBeGreaterThan(50);

      /* (a) IDENTITY, not extremum: id 0182 is claimed exactly once, by us. */
      const claimants = files.filter((f) => idOf(f) === 182);
      expect(claimants, `${label} must contain exactly one file claiming id 0182`).toEqual([MIGRATION]);

      /* (d) no id double-claimed anywhere in the directory, EXCEPT the one
         historical triple-claim that predates every wave in this build and is
         pinned BY NAME below. Found by execution, not assumed: the first run of
         this assertion surfaced it. It is pinned as the exact file list rather
         than as "1 known duplicate", so a NEW double-claim cannot cancel out
         against it — the same reasoning that removed the count pin this test
         replaces. Id 0002 is not repaired here: renaming a long-applied
         migration would change what the runner has already recorded. */
      const KNOWN_DUPLICATE_IDS: Record<string, Record<number, string[]>> = {
        migrations: {
          2: ["0002_glorious_nomad.sql", "0002_slow_medusa.sql", "0002_v12_tenants_softdelete.sql"],
        },
        "server/db/migrations": {},
      };
      const seen = new Map<number, string[]>();
      for (const f of files) seen.set(idOf(f), [...(seen.get(idOf(f)) ?? []), f]);
      const dupes = Object.fromEntries(
        [...seen.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => [k, [...v].sort()]),
      );
      const expectedDupes = Object.fromEntries(
        Object.entries(KNOWN_DUPLICATE_IDS[label]).map(([k, v]) => [k, [...v].sort()]),
      );
      expect(dupes, `${label} double-claims a migration id that is not the pinned historical one`).toEqual(
        expectedDupes,
      );
      /* ...and 0182 is emphatically not among them. */
      expect(Object.keys(dupes)).not.toContain("182");

      /* (c) BURNT ids (ruling A-17) stay burnt, in both directories. */
      for (const burnt of [152, 154, 155, 158]) {
        expect(
          files.filter((f) => idOf(f) === burnt),
          `${label}: migration ${String(burnt).padStart(4, "0")} is BURNT (ruling A-17) and must never be reused`,
        ).toEqual([]);
      }
    }
    expect([152, 154, 155, 158]).not.toContain(idOf(MIGRATION));

    /* (b) cmp-identical. Length first so a truncation is named as such, then a
       full byte compare so a same-length edit cannot pass. */
    const a = fs.readFileSync(CANONICAL);
    const b = fs.readFileSync(MIRROR);
    expect(b.length, "mirror and canonical differ in length").toBe(a.length);
    expect(b.equals(a), "mirror and canonical differ in bytes at equal length").toBe(true);
  });

  /**
   * The other half of what "0182 is the highest id" was standing in for: that a
   * database built from the CANONICAL corpus ALONE — no `connection.ts` inline
   * baseline, no self-heal installer — ends up carrying the name-split surface.
   * A later migration cannot invalidate this; only DROPPING the columns can,
   * which is precisely the regression worth failing on.
   *
   * BOTH POLES, and the negative one is what makes the positive one mean
   * something: rebuild the identical chain with 0182 OMITTED and all 19 columns
   * must be ABSENT. If some other migration ever starts supplying them, this
   * pole goes red and says so instead of letting 0182 be quietly redundant.
   */
  it("canonical migrations ALONE yield all 19 name-split columns — and none of them without 0182", () => {
    const dir = path.join(ROOT, "migrations");
    const build = (omit: string[]) => {
      const skip = new Set(omit);
      const files = fs
        .readdirSync(dir)
        .filter((f) => /^\d{4,}_.*\.sql$/i.test(f) && !skip.has(f))
        .sort((x, y) => Number(/^(\d{4,})_/.exec(x)![1]) - Number(/^(\d{4,})_/.exec(y)![1]) || x.localeCompare(y));
      const db = new Database(":memory:");
      /* Matches 0131's own rebuild preamble; referential integrity is not what
         is under test here and would fail historical out-of-order inserts. */
      db.pragma("foreign_keys = OFF");
      let executed = 0;
      const failures: string[] = [];
      for (const f of files) {
        for (const stmt of splitStatements(fs.readFileSync(path.join(dir, f), "utf8"))) {
          if (stmt.trim() === "") continue;
          executed += 1;
          /* Failures are COLLECTED, never swallowed: the chain has documented
             pre-existing red statements from 0040 onward, and aborting there
             would mean this test never reaches 0182 at all. What is asserted is
             that ZERO of them are attributable to 0182 — see below. */
          try { db.exec(stmt); } catch (err) { failures.push(`${f}: ${(err as Error).message}`); }
        }
      }
      return { db, files: files.length, executed, failures };
    };

    const withIt = build([]);
    try {
      /* S0 — anti-vacuity floors on the build itself. */
      expect(withIt.files).toBeGreaterThan(150);
      expect(withIt.executed).toBeGreaterThan(1500);
      /* 0182 must contribute NO failures. Pinned as the failing statements
         themselves, not as a count, so a new 0182 failure cannot be cancelled
         out by an old one elsewhere disappearing. */
      expect(withIt.failures.filter((m) => m.startsWith("0182"))).toEqual([]);

      const cols = (t: string) =>
        new Set((withIt.db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((r) => r.name));
      const missing = EXPECTED.filter(([t, c]) => !cols(t).has(c)).map(([t, c]) => `${t}.${c}`);
      expect(missing, "canonical migrations alone must supply the whole name-split surface").toEqual([]);
    } finally {
      withIt.db.close();
    }

    const without = build([MIGRATION]);
    try {
      const cols = (t: string) =>
        new Set((without.db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((r) => r.name));
      const stillPresent = EXPECTED.filter(([t, c]) => cols(t).has(c)).map(([t, c]) => `${t}.${c}`);
      expect(
        stillPresent,
        "without 0182 the columns must be ABSENT — if they are not, 0182 is redundant for them and P1's diagnosis has rotted",
      ).toEqual([]);
    } finally {
      without.db.close();
    }
  }, 120_000);
});

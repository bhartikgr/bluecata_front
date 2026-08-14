/**
 * WAVE 49 · C-3 (+ A-6B) — BOTH POLES OF THE STRENGTHENED BOOT DOCTOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PROVES, AND WHY BOTH DIRECTIONS MATTER
 * ─────────────────────────────────────────────────────────────────────────────
 * Review C, finding C-3: the pre-Wave-49 boot doctor checked 14 columns in 3
 * tables and printed "schema is current" on a database with NO migration ledger,
 * 0 of Wave 48's 142 money type-floor triggers, and no `partner_invoice` table.
 *
 * POLE A — the doctor PASSES on a database built by the real migration runner.
 *   A checker that fails on everything gets bypassed with SKIP_DB_DOCTOR=1
 *   within a week and then protects nothing. It has to be quiet when the
 *   database is right.
 * POLE B — the doctor FAILS, AND NAMES WHAT IS WRONG, on each way of being
 *   wrong: no ledger at all; behind (0186 not applied); triggers deleted;
 *   and a trigger whose NAME is right but whose BODY is a weaker constraint
 *   (finding A-6B — the exact case `CREATE TRIGGER IF NOT EXISTS` cannot see).
 *   Asserting only "ok === false" would pass for a checker that returns a bare
 *   boolean, so every pole-B case asserts the problem CODE and that the detail
 *   text names the missing or divergent subject.
 *
 * The fixtures are built by running the SHIPPED runner (`server/db/migrate.ts`,
 * which is SACRED and untouched by this wave) against throw-away files under
 * `.w49tmp/`. Nothing here reads or writes `data.db`, `test.db`, `dev.db` or
 * `data/opus_audit.db`.
 *
 * Sequential, and each pole-B fixture is a fresh COPY of the pole-A file, so no
 * test can see another's damage.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import {
  checkMigrationIntegrity,
  formatMigrationIntegrity,
  parseTypefloorTriggers,
  normalizeTriggerSql,
  listMigrationFiles,
  migrationId,
  TYPEFLOOR_MIGRATION,
  TYPEFLOOR_TRIGGER_PREFIX,
  LEDGER_TABLE,
  KNOWN_DEFERRED,
} from "../lib/migrationIntegrity";

const REPO = path.resolve(__dirname, "..", "..");

/* WAVE 50 — DERIVED, NOT RE-PINNED.
 *
 * Three assertions below used TYPEFLOOR_MIGRATION (0186) to mean "the highest
 * migration on disk". Those were the same file when Wave 49 was written, and
 * they stopped being the same file the moment Wave 50 added 0187. Re-pinning
 * them to 0186 would make the doctor's central invariant — "highest applied ==
 * highest on disk" — a no-op that silently accepts any newer migration; pinning
 * them to 0187 just moves the same trap one wave along. Deriving from the
 * directory keeps BOTH poles meaningful for every future wave, and is strictly
 * stronger than what it replaces. TYPEFLOOR_MIGRATION is untouched everywhere it
 * genuinely means the type-floor migration (its trigger DDL, its mirror).
 * Coverage is not lost: the type-floor migration is still asserted APPLIED. */
const MIGRATION_FILES_ON_DISK = listMigrationFiles(path.join(REPO, "migrations"));
const HIGHEST_MIGRATION_FILE =
  MIGRATION_FILES_ON_DISK[MIGRATION_FILES_ON_DISK.length - 1];
const SECOND_HIGHEST_MIGRATION_FILE =
  MIGRATION_FILES_ON_DISK[MIGRATION_FILES_ON_DISK.length - 2];
const MIGRATIONS_DIR = path.join(REPO, "migrations");
const TMP = path.join(REPO, ".w49tmp");
const GOLDEN = path.join(TMP, "w49_c3_golden.db");

/** Codes present at `fail` severity. */
function failCodes(r: ReturnType<typeof checkMigrationIntegrity>): string[] {
  return r.problems.filter((p) => p.severity === "fail").map((p) => p.code);
}
/** Concatenated detail text of the `fail` problems, for "does it name it?" checks. */
function failText(r: ReturnType<typeof checkMigrationIntegrity>): string {
  return r.problems
    .filter((p) => p.severity === "fail")
    .map((p) => p.detail)
    .join("\n");
}

function openCopy(label: string): { db: any; file: string } {
  const file = path.join(TMP, `w49_c3_${label}.db`);
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(file + suffix);
    } catch {
      /* not present */
    }
  }
  fs.copyFileSync(GOLDEN, file);
  return { db: new Database(file), file };
}

const openDbs: any[] = [];
function track<T extends { db: any }>(x: T): T {
  openDbs.push(x.db);
  return x;
}

beforeAll(() => {
  fs.mkdirSync(TMP, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(GOLDEN + suffix);
    } catch {
      /* not present */
    }
  }
  /* Build the golden fixture with the SHIPPED, SACRED runner — not with a
   * hand-rolled schema. A fixture assembled by this test file would only prove
   * the test agrees with itself. 300s ceiling: 167 migrations on a cold tsx. */
  execFileSync("npx", ["tsx", "server/db/migrate.ts"], {
    cwd: REPO,
    env: { ...process.env, DATABASE_URL: `file:${GOLDEN}`, NODE_ENV: "development" },
    timeout: 300_000,
    stdio: "pipe",
  });
}, 320_000);

afterAll(() => {
  for (const db of openDbs) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POLE A — a correctly migrated database PASSES, and the summary is useful
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 49 · C-3 · POLE A — doctor passes on a correctly-migrated database", () => {
  it("passes with no fail-severity problems", () => {
    const { db } = track(openCopy("poleA"));
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(failCodes(r), `unexpected failures:\n${failText(r)}`).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("sees the ledger, and its highest applied id equals the highest migration file", () => {
    const { db } = track(openCopy("poleA_ledger"));
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(r.ledgerPresent).toBe(true);
    expect(r.highestMigrationFile).toBe(HIGHEST_MIGRATION_FILE);
    expect(migrationId(r.highestAppliedMigration!)).toBe(migrationId(r.highestMigrationFile!));
    /* the original intent, kept explicitly: the type-floor migration IS applied */
    expect(r.pendingMigrations).not.toContain(TYPEFLOOR_MIGRATION);
    /* 167 files on disk; the one legitimate deferral is KNOWN_DEFERRED. */
    expect(r.migrationFileCount).toBe(listMigrationFiles(MIGRATIONS_DIR).length);
    expect(r.appliedCount).toBe(r.migrationFileCount - r.pendingMigrations.length);
  });

  it("reports the one known-deferred migration as a WARNING, never as a pass-in-silence", () => {
    const { db } = track(openCopy("poleA_deferred"));
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    /* 0040_perf_indexes defers by design (WAVE 23 WAIVER-3). It must not fail
     * the doctor, and it must not be invisible either. */
    for (const p of r.pendingMigrations) expect(KNOWN_DEFERRED).toHaveProperty(p);
    if (r.pendingMigrations.length > 0) {
      const warnCodes = r.problems.filter((x) => x.severity === "warn").map((x) => x.code);
      expect(warnCodes).toContain("migration_known_deferred");
    }
    expect(r.unexpectedPending).toEqual([]);
  });

  it("finds all 142 money type-floor triggers, each with the definition migration 0186 ships", () => {
    const { db } = track(openCopy("poleA_triggers"));
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(r.expectedTypefloorTriggers).toBe(142);
    expect(r.installedTypefloorTriggers).toBe(142);
    expect(r.missingTriggers).toEqual([]);
    expect(r.mismatchedTriggers).toEqual([]);
  });

  it("finds partner_invoice — the table whose absence Review C measured as a 409 on every approval", () => {
    const { db } = track(openCopy("poleA_invoice"));
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(r.missingTables).toEqual([]);
    expect(r.missingColumns).toEqual([]);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='partner_invoice'")
      .get();
    expect(row).toBeTruthy();
  });

  it("its summary states the numbers rather than only a verdict", () => {
    const { db } = track(openCopy("poleA_summary"));
    const out = formatMigrationIntegrity(
      checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR }),
    );
    expect(out).toMatch(/migration ledger: present/);
    expect(out).toMatch(/142 installed \/ 142 expected/);
    expect(out).toMatch(new RegExp(HIGHEST_MIGRATION_FILE.replace(/\./g, "\\.")));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * POLE B — every way of being behind FAILS, and the failure names the subject
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 49 · C-3 · POLE B — doctor fails, naming what is missing", () => {
  it("FAILS when the migration ledger does not exist at all (the state Review C measured)", () => {
    const { db } = track(openCopy("poleB_noledger"));
    db.exec(`DROP TABLE ${LEDGER_TABLE}`);
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(r.ok).toBe(false);
    expect(failCodes(r)).toContain("ledger_missing");
    expect(r.ledgerPresent).toBe(false);
    /* It has to name the ledger and say the runner never completed — otherwise
     * an operator reads "out of date" and re-checks the same 14 columns. */
    expect(failText(r)).toContain(LEDGER_TABLE);
    expect(failText(r)).toMatch(/never completed|db:migrate/i);
  });

  it("FAILS, naming both ids, when the highest applied migration is behind the highest file", () => {
    const { db } = track(openCopy("poleB_behind"));
    db.prepare(`DELETE FROM ${LEDGER_TABLE} WHERE name = ?`).run(HIGHEST_MIGRATION_FILE);
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(r.ok).toBe(false);
    expect(failCodes(r)).toContain("highest_migration_mismatch");
    const t = failText(r);
    expect(t).toContain(HIGHEST_MIGRATION_FILE); // the file it is behind
    expect(t).toContain(SECOND_HIGHEST_MIGRATION_FILE); // where it actually is
  });

  it("FAILS, naming the count and examples, when the 142 triggers are gone", () => {
    const { db } = track(openCopy("poleB_notriggers"));
    const names = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE ?")
        .all(`${TYPEFLOOR_TRIGGER_PREFIX}%`) as { name: string }[]
    ).map((x) => x.name);
    expect(names.length).toBe(142);
    for (const n of names) db.exec(`DROP TRIGGER "${n}"`);
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(r.ok).toBe(false);
    expect(failCodes(r)).toContain("typefloor_triggers_missing");
    expect(r.installedTypefloorTriggers).toBe(0);
    expect(r.missingTriggers.length).toBe(142);
    const t = failText(r);
    expect(t).toMatch(/142 of 142/);
    expect(t).toContain(names[0]); // names an actual missing trigger
    expect(t).toMatch(/not-a-number/); // says what the absence costs
  });

  it("FAILS, naming the specific table, when a recent-migration table is missing (partner_invoice ⇒ 409)", () => {
    const { db } = track(openCopy("poleB_noinvoice"));
    /* Drop 0186's triggers on the table first — SQLite refuses to drop a table
     * that a trigger references. The interesting assertion is the table one. */
    for (const n of (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='partner_invoice'")
        .all() as { name: string }[]
    ).map((x) => x.name)) {
      db.exec(`DROP TRIGGER "${n}"`);
    }
    db.exec("DROP TABLE partner_invoice");
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(r.ok).toBe(false);
    expect(failCodes(r)).toContain("recent_table_missing");
    expect(r.missingTables).toContain("partner_invoice");
    expect(failText(r)).toMatch(/partner_invoice/);
    expect(failText(r)).toMatch(/409/); // says what it breaks
  });

  /* ── A-6B ─────────────────────────────────────────────────────────────────
   * The finding: 0186 created all 142 triggers with `CREATE TRIGGER IF NOT
   * EXISTS`, which matches on NAME ONLY. A database carrying a same-named
   * trigger with different logic keeps the old body and the migration reports
   * success. Two independent defences, both asserted below. */
  it("A-6B · FAILS, naming the trigger, when a trigger's NAME is right but its BODY is weaker", () => {
    const { db } = track(openCopy("poleB_swapped"));
    const target = "w48_money_typefloor_ins_billing_disputes_amount_minor";
    const before = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name = ?")
      .get(target) as { sql: string };
    expect(before?.sql).toBeTruthy();

    /* A plausible bad revision: same name, same table, same column — but the
     * WHEN clause has been loosened so a REAL like 12.5 now passes. This is
     * exactly what an earlier revision or a hand-applied hotfix leaves behind,
     * and it is invisible to `CREATE TRIGGER IF NOT EXISTS`. */
    db.exec(`DROP TRIGGER "${target}"`);
    db.exec(
      `CREATE TRIGGER ${target}
         BEFORE INSERT ON "billing_disputes"
         FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") = 'text'
         BEGIN SELECT RAISE(ABORT, 'weaker floor from an earlier revision'); END;`,
    );

    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(r.ok).toBe(false);
    expect(failCodes(r)).toContain("trigger_definition_mismatch");
    expect(r.mismatchedTriggers).toEqual([target]);
    /* Count is unchanged — a count-based check would have passed here. That is
     * the whole point of A-6B. */
    expect(r.installedTypefloorTriggers).toBe(142);
    expect(r.missingTriggers).toEqual([]);
    const t = failText(r);
    expect(t).toContain(target);
    expect(t).toMatch(/A-6B/);
    expect(t).toMatch(/NOT the one this build ships/i);
  });

  it("A-6B · the weaker trigger it detects really does accept a value 0186 refuses", () => {
    const { db } = track(openCopy("poleB_weaker_behaviour"));
    const target = "w48_money_typefloor_ins_billing_disputes_amount_minor";
    const cols = (db.prepare(`PRAGMA table_info("billing_disputes")`).all() as {
      name: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }[]).filter((c) => c.notnull === 1 && c.dflt_value === null);

    /* Under 0186 as shipped, a REAL 12.5 in a money column is refused. */
    const insertReal = () => {
      const names = ["amount_minor", ...cols.filter((c) => c.name !== "amount_minor").map((c) => c.name)];
      const vals = names.map((n) => (n === "amount_minor" ? 12.5 : `w49c3_${n}`));
      db.prepare(
        `INSERT INTO "billing_disputes" (${names.map((n) => `"${n}"`).join(",")}) ` +
          `VALUES (${names.map(() => "?").join(",")})`,
      ).run(...vals);
    };
    expect(insertReal).toThrow(/money type floor/i);

    /* Swap in the weaker body and the very same insert is accepted. This is the
     * damage a name-only match hides, demonstrated rather than asserted. */
    db.exec(`DROP TRIGGER "${target}"`);
    db.exec(
      `CREATE TRIGGER ${target}
         BEFORE INSERT ON "billing_disputes"
         FOR EACH ROW WHEN NEW."amount_minor" IS NOT NULL AND typeof(NEW."amount_minor") = 'text'
         BEGIN SELECT RAISE(ABORT, 'weaker floor from an earlier revision'); END;`,
    );
    const tx = db.transaction(() => {
      insertReal();
      throw new Error("__rollback__"); // never keep the row
    });
    expect(() => tx()).toThrow(/__rollback__/);

    /* And the doctor catches it. */
    const r = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(r.mismatchedTriggers).toContain(target);
    expect(r.ok).toBe(false);
  });

  it("A-6B · migration 0186 no longer uses CREATE TRIGGER IF NOT EXISTS — it drops and recreates", () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, TYPEFLOOR_MIGRATION), "utf8");
    const conditional = sql.match(
      new RegExp(`^CREATE TRIGGER IF NOT EXISTS ${TYPEFLOOR_TRIGGER_PREFIX}`, "gm"),
    );
    expect(conditional, "0186 must not create type-floor triggers conditionally").toBeNull();
    const drops = sql.match(new RegExp(`^DROP TRIGGER IF EXISTS ${TYPEFLOOR_TRIGGER_PREFIX}`, "gm"));
    const creates = sql.match(new RegExp(`^CREATE TRIGGER ${TYPEFLOOR_TRIGGER_PREFIX}`, "gm"));
    expect(drops?.length).toBe(142);
    expect(creates?.length).toBe(142);
    /* Each DROP is immediately followed by the CREATE of the SAME name, so the
     * pair is atomic within the runner's per-file transaction and cannot drop a
     * floor it does not replace. */
    const pairs = Array.from(
      sql.matchAll(
        new RegExp(
          `^DROP TRIGGER IF EXISTS (${TYPEFLOOR_TRIGGER_PREFIX}[A-Za-z0-9_]+);\\n` +
            `CREATE TRIGGER (${TYPEFLOOR_TRIGGER_PREFIX}[A-Za-z0-9_]+)$`,
          "gm",
        ),
      ),
    );
    expect(pairs.length).toBe(142);
    for (const p of pairs) expect(p[1]).toBe(p[2]);
  });

  it("A-6B · the mirror at server/db/migrations stays byte-identical", () => {
    const a = fs.readFileSync(path.join(MIGRATIONS_DIR, TYPEFLOOR_MIGRATION));
    const b = fs.readFileSync(path.join(REPO, "server", "db", "migrations", TYPEFLOOR_MIGRATION));
    expect(a.equals(b)).toBe(true);
  });

  it("re-running 0186 over already-installed triggers replaces them and leaves exactly 142", () => {
    /* The drop-and-recreate has to be genuinely re-runnable, or A-6B's fix
     * trades a silent-weak-trigger bug for a broken migration. Damage one
     * trigger, replay only 0186's statements, and require full repair. */
    const { db } = track(openCopy("poleB_rerun"));
    const target = "w48_money_typefloor_upd_chapters_membership_fee_annual_minor";
    const expected = parseTypefloorTriggers(
      fs.readFileSync(path.join(MIGRATIONS_DIR, TYPEFLOOR_MIGRATION), "utf8"),
    );
    expect(expected.has(target)).toBe(true);
    db.exec(`DROP TRIGGER "${target}"`);
    db.exec(
      `CREATE TRIGGER ${target} BEFORE UPDATE OF "membership_fee_annual_minor" ON "chapters"
         FOR EACH ROW WHEN 0 BEGIN SELECT RAISE(ABORT, 'never fires'); END;`,
    );
    expect(
      checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR }).mismatchedTriggers,
    ).toContain(target);

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, TYPEFLOOR_MIGRATION), "utf8");
    const replay = db.transaction(() => {
      for (const m of Array.from(
        sql.matchAll(
          new RegExp(
            `^DROP TRIGGER IF EXISTS ${TYPEFLOOR_TRIGGER_PREFIX}[A-Za-z0-9_]+;\\n` +
              `CREATE TRIGGER [\\s\\S]*?\\bEND;`,
            "gm",
          ),
        ),
      )) {
        db.exec(m[0]);
      }
    });
    replay();

    const after = checkMigrationIntegrity({ db, migrationsDir: MIGRATIONS_DIR });
    expect(after.mismatchedTriggers).toEqual([]);
    expect(after.missingTriggers).toEqual([]);
    expect(after.installedTypefloorTriggers).toBe(142);
    expect(
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
        .get(target).sql,
    ).toBeTruthy();
    expect(
      normalizeTriggerSql(
        db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(target).sql,
      ),
    ).toBe(expected.get(target));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * The comparator itself — a normaliser that collapses real differences would
 * make every pole-B assertion above vacuous.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 49 · C-3 · the trigger comparator does not over-normalise", () => {
  it("ignores only whitespace, `IF NOT EXISTS` and the trailing semicolon", () => {
    const base = `CREATE TRIGGER t BEFORE INSERT ON "x" FOR EACH ROW WHEN typeof(NEW."a") <> 'integer' BEGIN SELECT RAISE(ABORT, 'no'); END`;
    expect(normalizeTriggerSql(`CREATE TRIGGER IF NOT EXISTS t\n  BEFORE INSERT ON "x"\n  FOR EACH ROW WHEN typeof(NEW."a") <> 'integer'\n  BEGIN SELECT RAISE(ABORT, 'no'); END;`)).toBe(base);
    expect(normalizeTriggerSql(base + ";")).toBe(base);
  });

  it("does NOT ignore a changed operator, column, table or abort message", () => {
    const base = normalizeTriggerSql(
      `CREATE TRIGGER t BEFORE INSERT ON "x" FOR EACH ROW WHEN typeof(NEW."a") <> 'integer' BEGIN SELECT RAISE(ABORT, 'no'); END;`,
    );
    for (const variant of [
      `CREATE TRIGGER t BEFORE INSERT ON "x" FOR EACH ROW WHEN typeof(NEW."a") = 'integer' BEGIN SELECT RAISE(ABORT, 'no'); END;`,
      `CREATE TRIGGER t BEFORE INSERT ON "x" FOR EACH ROW WHEN typeof(NEW."b") <> 'integer' BEGIN SELECT RAISE(ABORT, 'no'); END;`,
      `CREATE TRIGGER t BEFORE INSERT ON "y" FOR EACH ROW WHEN typeof(NEW."a") <> 'integer' BEGIN SELECT RAISE(ABORT, 'no'); END;`,
      `CREATE TRIGGER t BEFORE UPDATE ON "x" FOR EACH ROW WHEN typeof(NEW."a") <> 'integer' BEGIN SELECT RAISE(ABORT, 'no'); END;`,
      `CREATE TRIGGER t BEFORE INSERT ON "x" FOR EACH ROW WHEN typeof(NEW."a") <> 'integer' BEGIN SELECT RAISE(ABORT, 'different'); END;`,
      `CREATE TRIGGER t BEFORE INSERT ON "x" FOR EACH ROW WHEN typeof(NEW."a") <> 'real' BEGIN SELECT RAISE(ABORT, 'no'); END;`,
    ]) {
      expect(normalizeTriggerSql(variant), variant).not.toBe(base);
    }
  });

  it("parses exactly the 142 type-floor triggers out of 0186 and nothing else", () => {
    const parsed = parseTypefloorTriggers(
      fs.readFileSync(path.join(MIGRATIONS_DIR, TYPEFLOOR_MIGRATION), "utf8"),
    );
    expect(parsed.size).toBe(142);
    for (const [name, def] of Array.from(parsed.entries())) {
      expect(name.startsWith(TYPEFLOOR_TRIGGER_PREFIX)).toBe(true);
      expect(def.startsWith("CREATE TRIGGER ")).toBe(true);
      expect(def).toMatch(/RAISE\(ABORT/);
      expect(def).not.toMatch(/IF NOT EXISTS/i);
    }
    /* 71 columns × (insert + update) = 142, matching Wave 48's inventory. */
    const ins = Array.from(parsed.keys()).filter((n) => n.includes("_ins_")).length;
    const upd = Array.from(parsed.keys()).filter((n) => n.includes("_upd_")).length;
    expect(ins).toBe(71);
    expect(upd).toBe(71);
  });
});

/**
 * WAVE 139 — migrations/0196_wave139_application_fee_seed_correction.sql.
 *
 * R101/R102/R103: the canonical Collective application fee is $300.00 = 30000
 * TRUE minor units. Two migration seeds disagreed —
 * `0057_v25_38_application_fee_config.sql:30-31` seeded
 * `collective_application_fee_config.amount_minor = 2500` ($25.00) and
 * `0066_v25_45_4_platform_fees.sql:31-32` seeded
 * `platform_fees['collective_application_fee'].amount_minor = 250000`
 * ($2,500.00). Both are `INSERT OR IGNORE`, so on an environment provisioned
 * from the migrations the stale seed wins permanently.
 *
 * 0196 is a FORWARD repair (R103 forbids rewriting 0057/0066) that updates a row
 * ONLY where it still holds the exact stale seed value AND carries no human
 * provenance.
 *
 * Every DB here is a THROWAWAY file under `w139_scratch/` or a COPY of
 * data.db / test.db. Neither data.db nor test.db is opened for writing.
 *
 * Run:
 *   npx vitest run server/__tests__/w139_application_fee_seed_correction.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { splitStatements } from "../db/migrate";

const ROOT = process.cwd();
const SCRATCH = join(ROOT, "w139_scratch", "dbs");

const M0057 = "migrations/0057_v25_38_application_fee_config.sql";
const M0066 = "migrations/0066_v25_45_4_platform_fees.sql";
const M0196 = "migrations/0196_wave139_application_fee_seed_correction.sql";
const M0196_MIRROR = "server/db/migrations/0196_wave139_application_fee_seed_correction.sql";

const CANONICAL_MINOR = 30000;
const STALE_CONFIG_MINOR = 2500;
const STALE_PLATFORM_MINOR = 250000;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require("better-sqlite3");

type Db = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => { get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => { changes: number } };
  close: () => void;
};

function sql(rel: string): string {
  const p = join(ROOT, rel);
  expect(existsSync(p), `${rel} is missing`).toBe(true);
  return readFileSync(p, "utf8");
}

/** Apply one migration file through the runner's OWN statement splitter. */
function applyFile(db: Db, rel: string): void {
  for (const stmt of splitStatements(sql(rel))) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    db.exec(trimmed);
  }
}

/**
 * The runner's splitter KEEPS comment text inside the statement it precedes, so a
 * split chunk begins with the `--` banner rather than the keyword. Strip leading
 * comment/blank lines so a statement can be classified and re-executed on its
 * own. Anti-vacuity: every caller asserts the resulting count is 2.
 */
function executableStatements(rel: string): string[] {
  return splitStatements(sql(rel))
    .map((s) =>
      s.split("\n")
        .filter((l) => !l.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
}

function updateStatements(rel: string): string[] {
  const updates = executableStatements(rel).filter((s) => /^UPDATE/i.test(s));
  expect(updates.length, "0196 must contain exactly two UPDATE statements").toBe(2);
  return updates;
}

function freshDb(name: string): Db {
  const p = join(SCRATCH, `${name}.db`);
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(p + suffix, { force: true }); } catch { /* noop */ }
  }
  return new Database(p) as Db;
}

function configRow(db: Db) {
  return db.prepare(
    `SELECT amount_minor, currency, updated_at, updated_by
       FROM collective_application_fee_config WHERE id = 'default'`,
  ).get() as { amount_minor: number; currency: string; updated_at: string | null; updated_by: string | null };
}

function platformRow(db: Db) {
  return db.prepare(
    `SELECT amount_minor, currency, updated_at, updated_by_user_id
       FROM platform_fees WHERE key = 'collective_application_fee'`,
  ).get() as { amount_minor: number; currency: string; updated_at: string; updated_by_user_id: string | null };
}

beforeAll(() => {
  mkdirSync(SCRATCH, { recursive: true });
});

describe("W139 — 0196 corrects both stale application-fee seeds to 30000", () => {
  it("the migration exists at the next free id 0196 and is mirrored byte-identically", () => {
    const canon = readFileSync(join(ROOT, M0196));
    const mirror = readFileSync(join(ROOT, M0196_MIRROR));
    expect(createHash("sha256").update(mirror).digest("hex"))
      .toBe(createHash("sha256").update(canon).digest("hex"));
  });

  it("the migration touches ONLY the two fee rows and creates/drops nothing", () => {
    const body = sql(M0196)
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(/\bCREATE\s+TABLE\b/i.test(body)).toBe(false);
    expect(/\bALTER\s+TABLE\b/i.test(body)).toBe(false);
    expect(/\bDROP\b/i.test(body)).toBe(false);
    expect(/\bINSERT\b/i.test(body)).toBe(false);
    expect(/\bDELETE\b/i.test(body)).toBe(false);
    expect(/\bREPLACE\b/i.test(body)).toBe(false);
    // No money arithmetic anywhere in the executable SQL.
    expect(/\/\s*100|\*\s*100|CAST\s*\(/i.test(body)).toBe(false);
    expect(body.match(/\bUPDATE\b/gi)?.length).toBe(2);
  });

  /* TEST 1 — the fresh-environment repair. */
  it("TEST 1 — a database built from the migrations in order ends at 30000 in BOTH tables", () => {
    const db = freshDb("t1_fresh");
    // Seeds, in numeric order, exactly as the runner applies them.
    applyFile(db, M0057);
    applyFile(db, M0066);
    // Fail-before witness: this is the state a fresh environment is left in today.
    expect(configRow(db).amount_minor).toBe(STALE_CONFIG_MINOR);
    expect(platformRow(db).amount_minor).toBe(STALE_PLATFORM_MINOR);

    applyFile(db, M0196);

    const cfg = configRow(db);
    const pf = platformRow(db);
    expect(cfg.amount_minor).toBe(CANONICAL_MINOR);
    expect(pf.amount_minor).toBe(CANONICAL_MINOR);
    expect(cfg.amount_minor).not.toBe(STALE_CONFIG_MINOR);
    expect(pf.amount_minor).not.toBe(STALE_PLATFORM_MINOR);
    // Currency is carried, never rewritten.
    expect(cfg.currency).toBe("USD");
    expect(pf.currency).toBe("USD");
    // Integer minor units on disk — the WAVE48/0186 type floor's contract.
    expect(
      (db.prepare(`SELECT typeof(amount_minor) AS t FROM collective_application_fee_config WHERE id='default'`)
        .get() as { t: string }).t,
    ).toBe("integer");
    expect(
      (db.prepare(`SELECT typeof(amount_minor) AS t FROM platform_fees WHERE key='collective_application_fee'`)
        .get() as { t: string }).t,
    ).toBe("integer");
    // Provenance records WHICH migration repaired the row.
    expect(cfg.updated_by).toBe("system:migration:0196_wave139");
    expect(pf.updated_by_user_id).toBe("system:migration:0196_wave139");
    db.close();
  });

  /* TEST 2 — a deliberate admin price is never clobbered. */
  it("TEST 2 — a row a human edited SURVIVES, in both tables, stale value or not", () => {
    const db = freshDb("t2_human");
    applyFile(db, M0057);
    applyFile(db, M0066);

    // (a) A human deliberately set the very value the migration hunts for.
    db.prepare(
      `UPDATE collective_application_fee_config
          SET amount_minor = ?, updated_at = '2026-08-20T10:00:00.000Z', updated_by = 'admin:user_42'
        WHERE id = 'default'`,
    ).run(STALE_CONFIG_MINOR);
    db.prepare(
      `UPDATE platform_fees
          SET amount_minor = ?, updated_at = '2026-08-20T10:00:00.000Z', updated_by_user_id = 'user_42'
        WHERE key = 'collective_application_fee'`,
    ).run(STALE_PLATFORM_MINOR);

    applyFile(db, M0196);

    const cfg = configRow(db);
    const pf = platformRow(db);
    expect(cfg.amount_minor).toBe(STALE_CONFIG_MINOR);
    expect(cfg.updated_by).toBe("admin:user_42");
    expect(cfg.updated_at).toBe("2026-08-20T10:00:00.000Z");
    expect(pf.amount_minor).toBe(STALE_PLATFORM_MINOR);
    expect(pf.updated_by_user_id).toBe("user_42");
    expect(pf.updated_at).toBe("2026-08-20T10:00:00.000Z");
    db.close();

    // (b) A human price that is NOT the stale seed is untouched too.
    const db2 = freshDb("t2_human_other");
    applyFile(db2, M0057);
    applyFile(db2, M0066);
    db2.prepare(
      `UPDATE collective_application_fee_config
          SET amount_minor = 45000, updated_by = 'admin:owner' WHERE id = 'default'`,
    ).run();
    db2.prepare(
      `UPDATE platform_fees
          SET amount_minor = 45000, updated_by_user_id = 'admin:owner'
        WHERE key = 'collective_application_fee'`,
    ).run();
    applyFile(db2, M0196);
    expect(configRow(db2).amount_minor).toBe(45000);
    expect(platformRow(db2).amount_minor).toBe(45000);
    db2.close();
  });

  /* TEST 3 — idempotency. */
  it("TEST 3 — running the migration twice is a no-op the second time", () => {
    const db = freshDb("t3_idem");
    applyFile(db, M0057);
    applyFile(db, M0066);
    applyFile(db, M0196);
    const afterFirst = { cfg: configRow(db), pf: platformRow(db) };

    // Second application must match ZERO rows.
    const updates = updateStatements(M0196);
    for (const u of updates) {
      expect(db.prepare(u).run().changes, `re-run changed rows: ${u.slice(0, 60)}`).toBe(0);
    }

    expect(configRow(db)).toEqual(afterFirst.cfg);
    expect(platformRow(db)).toEqual(afterFirst.pf);
    expect(afterFirst.cfg.amount_minor).toBe(CANONICAL_MINOR);
    expect(afterFirst.pf.amount_minor).toBe(CANONICAL_MINOR);
    db.close();
  });

  /* TEST 4 — no-op where the value is already canonical, including the real DBs. */
  it("TEST 4a — a row already at 30000 is left byte-for-byte alone", () => {
    const db = freshDb("t4_already_canonical");
    applyFile(db, M0057);
    applyFile(db, M0066);
    // Recreate the LIVE shape: canonical amount, seed/system provenance.
    db.prepare(
      `UPDATE collective_application_fee_config
          SET amount_minor = ?, updated_at = '2026-08-15 19:25:39', updated_by = NULL
        WHERE id = 'default'`,
    ).run(CANONICAL_MINOR);
    db.prepare(
      `UPDATE platform_fees
          SET amount_minor = ?, updated_at = '2026-06-30T00:00:00.000Z', updated_by_user_id = 'system:seed'
        WHERE key = 'collective_application_fee'`,
    ).run(CANONICAL_MINOR);
    const before = { cfg: configRow(db), pf: platformRow(db) };

    const updates = updateStatements(M0196);
    for (const u of updates) expect(db.prepare(u).run().changes).toBe(0);

    expect(configRow(db)).toEqual(before.cfg);
    expect(platformRow(db)).toEqual(before.pf);
    db.close();
  });

  it("TEST 4b — the migration is a NO-OP against copies of this workspace's data.db and test.db", () => {
    for (const name of ["data.db", "test.db"]) {
      const src = join(ROOT, name);
      expect(existsSync(src), `${name} not found`).toBe(true);
      const dst = join(SCRATCH, `copy_${name}`);
      for (const suffix of ["", "-wal", "-shm"]) {
        try { rmSync(dst + suffix, { force: true }); } catch { /* noop */ }
      }
      copyFileSync(src, dst);
      const db = new Database(dst) as Db;
      const before = { cfg: configRow(db), pf: platformRow(db) };
      expect(before.cfg.amount_minor, `${name} config row is not canonical`).toBe(CANONICAL_MINOR);
      expect(before.pf.amount_minor, `${name} platform_fees row is not canonical`).toBe(CANONICAL_MINOR);

      const updates = updateStatements(M0196);
      for (const u of updates) {
        expect(db.prepare(u).run().changes, `${name}: migration changed a row`).toBe(0);
      }
      expect(configRow(db)).toEqual(before.cfg);
      expect(platformRow(db)).toEqual(before.pf);
      db.close();
    }
  });
});

describe("W139 — resolver comment truth (Review G item 18), logic untouched", () => {
  const REL = "server/lib/collectiveApplicationFeeResolver.ts";
  const src = () => readFileSync(join(ROOT, REL), "utf8");

  it("the stale whole-unit 'Unit note' prose is gone", () => {
    const s = src();
    expect(s).not.toMatch(/renders the number directly/);
    expect(s).not.toMatch(/no \/100/);
    expect(s).not.toMatch(/\$2,500/);
    expect(s).not.toMatch(/fmtUSD/);
  });

  it("the '(cents / 100)' mirror-write comment is gone — wave 131 made the mirror unscaled", () => {
    expect(src()).not.toMatch(/cents\s*(÷|\/)\s*100/);
  });

  it("the prose states the truth: TRUE minor units, $300 = 30000, rendered with formatMinor", () => {
    const s = src();
    expect(s).toMatch(/TRUE minor units/);
    expect(s).toMatch(/\$300\s*=\s*30000/);
    expect(s).toMatch(/formatMinor/);
  });

  /* R98 · BATCH 1 · ITEM 2 (WAVE 142) — THIS PIN WAS STALE AND IS RE-FROZEN.
   *
   * WAVE 139 froze the resolver's executable logic to prove its own edit was
   * comment-only. WAVE 142 changes that logic DELIBERATELY under R108.2: the
   * seed-default fallback that returned DEFAULT_APPLICATION_FEE_MINOR for a
   * missing row is deleted, and the resolver now reports `source: "missing"` /
   * "unreadable" with a NULL amount. A frozen digest of the OLD logic therefore
   * asserts something the owner ruled must no longer be true.
   *
   * Under R98 the pin is re-frozen rather than deleted, and the assertion count
   * GOES UP: the digest still guards against an unintended logic edit, and three
   * new assertions pin WHY it moved, so the fallback cannot creep back in without
   * failing here as well as in batch1_item2_*.
   *
   * PREVIOUS DIGEST (pre-WAVE-142 logic, WAVE 139's value), kept on the record:
   *   5b437df53a92bc0b7f7e515a1991de712ec7c61983dcac30bb620d8fdcef3d5b
   * That value was independently re-derived from the reconstructed pre-142 source
   * in w142_scratch/before/, which is how the WAVE 142 fail-before evidence was
   * proven to be byte-exact. Nothing about migration 0196 is touched by this
   * change (R103): every 0196 assertion in this file is unchanged. */
  const strippedResolver = () =>
    src()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/\/\/[^\n"'`]*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();

  it("the executable logic matches the WAVE 142 re-freeze (R98 — was the wave-138 baseline)", () => {
    expect(createHash("sha256").update(strippedResolver()).digest("hex"))
      .toBe("8f7026472b555526d5f484e0a5dfc43d0b9207f6a544943de3a5835311b24bf6");
    /* And it is NOT the pre-142 logic any more: the fallback really did go. */
    expect(createHash("sha256").update(strippedResolver()).digest("hex"))
      .not.toBe("5b437df53a92bc0b7f7e515a1991de712ec7c61983dcac30bb620d8fdcef3d5b");
  });

  it("R108.2 — no read path returns DEFAULT_APPLICATION_FEE_MINOR any more", () => {
    const code = strippedResolver();
    /* The constant survives as a documented reference figure… */
    expect(code).toContain("export const DEFAULT_APPLICATION_FEE_MINOR = 30000;");
    /* …but it is never handed back as a resolved amount. */
    expect(code).not.toContain("amountMinor: DEFAULT_APPLICATION_FEE_MINOR");
    expect(code).not.toContain('source: "default"');
  });

  it("R108.2 — absence and unreadability are reported as distinct, amount-free states", () => {
    const code = strippedResolver();
    expect(code).toContain('source: "missing"');
    expect(code).toContain('source: "unreadable"');
    /* Every non-"db" return states a NULL amount rather than a number. */
    expect(code).toContain('{ amountMinor: null, currency: null, source: "missing" }');
    expect(code).toContain('{ amountMinor: null, currency: null, source: "unreadable" }');
  });

  it("DEFAULT_APPLICATION_FEE_MINOR is still exactly 30000", () => {
    expect(src()).toMatch(/export const DEFAULT_APPLICATION_FEE_MINOR = 30000;/);
  });
});

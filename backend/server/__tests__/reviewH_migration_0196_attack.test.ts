/**
 * REVIEW H (adversarial review artifact) — try to make migrations/0196 clobber a
 * price an administrator deliberately set, and try to make it non-idempotent or
 * non-no-op against the real databases.
 *
 * Every database here is a COPY. data.db and test.db are never opened for write:
 * their sha256 is captured before and after and asserted unchanged.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { splitStatements } from "../db/migrate";

const ROOT = process.cwd();
const SCRATCH = join(ROOT, "reviewH_scratch", "dbs");
const M0196 = "migrations/0196_wave139_application_fee_seed_correction.sql";
const M0057 = "migrations/0057_v25_38_application_fee_config.sql";
const M0066 = "migrations/0066_v25_45_4_platform_fees.sql";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require("better-sqlite3");

type Db = {
  exec: (s: string) => unknown;
  prepare: (s: string) => { get: (...a: unknown[]) => any; run: (...a: unknown[]) => { changes: number } };
  close: () => void;
};

function sqlOf(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}
function sha(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}
/** The two UPDATE statements of 0196, comments removed, as the runner splits them. */
function updates(): string[] {
  const out = splitStatements(sqlOf(M0196))
    .map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
    .filter((s) => s.length > 0);
  expect(out.length).toBe(2); // anti-vacuity: never run zero statements
  for (const s of out) expect(s.slice(0, 6).toUpperCase()).toBe("UPDATE");
  return out;
}
function fresh(name: string): Db {
  mkdirSync(SCRATCH, { recursive: true });
  const p = join(SCRATCH, name);
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(p + suffix)) rmSync(p + suffix);
  return new Database(p) as Db;
}
function apply(db: Db, rel: string): void {
  for (const s of splitStatements(sqlOf(rel))) if (s.trim()) db.exec(s.trim());
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
const cfg = (db: Db) =>
  db.prepare(`SELECT amount_minor, currency, updated_at, updated_by FROM collective_application_fee_config WHERE id='default'`).get();
const pf = (db: Db) =>
  db.prepare(`SELECT amount_minor, currency, updated_at, updated_by_user_id FROM platform_fees WHERE key='collective_application_fee'`).get();

describe("REVIEW H — attack the 0196 provenance guard", () => {
  it("baseline: the stale seeds really are 2500 / 250000 and 0196 repairs both", () => {
    const db = fresh("repair.db");
    apply(db, M0057);
    apply(db, M0066);
    expect(cfg(db).amount_minor).toBe(2500);
    expect(pf(db).amount_minor).toBe(250000);
    apply(db, M0196);
    expect(cfg(db).amount_minor).toBe(30000);
    expect(pf(db).amount_minor).toBe(30000);
    expect(cfg(db).currency).toBe("USD");
    expect(pf(db).currency).toBe("USD");
    expect(cfg(db).updated_by).toBe("system:migration:0196_wave139");
    expect(pf(db).updated_by_user_id).toBe("system:migration:0196_wave139");
    db.close();
  });

  it("ATTACK 1: an admin who deliberately set the STALE numbers is not clobbered", () => {
    const db = fresh("admin_stale.db");
    apply(db, M0057);
    apply(db, M0066);
    // exactly what updateApplicationFee()/setFee() write for a real actor
    db.prepare(
      `UPDATE collective_application_fee_config SET amount_minor=2500, updated_at='2026-08-20T10:00:00.000Z', updated_by='u_admin' WHERE id='default'`,
    ).run();
    db.prepare(
      `UPDATE platform_fees SET amount_minor=250000, updated_at='2026-08-20T10:00:00.000Z', updated_by_user_id='u_admin' WHERE key='collective_application_fee'`,
    ).run();
    const before = { c: cfg(db), p: pf(db) };
    for (const s of updates()) {
      const info = db.prepare(s).run();
      expect(info.changes).toBe(0);
    }
    expect(cfg(db)).toEqual(before.c);
    expect(pf(db)).toEqual(before.p);
    db.close();
  });

  it("ATTACK 2: an admin price that is NOT the stale value survives", () => {
    const db = fresh("admin_other.db");
    apply(db, M0057);
    apply(db, M0066);
    db.prepare(`UPDATE collective_application_fee_config SET amount_minor=45000, updated_by='admin:owner' WHERE id='default'`).run();
    db.prepare(`UPDATE platform_fees SET amount_minor=45000, updated_by_user_id='admin:owner' WHERE key='collective_application_fee'`).run();
    for (const s of updates()) expect(db.prepare(s).run().changes).toBe(0);
    expect(cfg(db).amount_minor).toBe(45000);
    expect(pf(db).amount_minor).toBe(45000);
    db.close();
  });

  it("ATTACK 3 (the hole): a stale-valued row with NULL/seed provenance IS overwritten", () => {
    // This is the documented design. It is only safe while every human write
    // path records a non-seed actor. Recorded here as the guard's exact edge.
    const db = fresh("null_actor.db");
    apply(db, M0057);
    apply(db, M0066);
    db.prepare(`UPDATE platform_fees SET amount_minor=250000, updated_by_user_id=NULL WHERE key='collective_application_fee'`).run();
    for (const s of updates()) db.prepare(s).run();
    expect(pf(db).amount_minor).toBe(30000); // clobbered — provenance was NULL
    db.close();
  });

  it("ATTACK 4: an empty-string actor is NOT treated as seed provenance", () => {
    const db = fresh("empty_actor.db");
    apply(db, M0057);
    apply(db, M0066);
    db.prepare(`UPDATE platform_fees SET amount_minor=250000, updated_by_user_id='' WHERE key='collective_application_fee'`).run();
    for (const s of updates()) db.prepare(s).run();
    expect(pf(db).amount_minor).toBe(250000); // survived
    db.close();
  });

  it("idempotency: a second and third run change nothing", () => {
    const db = fresh("idem.db");
    apply(db, M0057);
    apply(db, M0066);
    apply(db, M0196);
    const after1 = { c: cfg(db), p: pf(db) };
    for (let i = 0; i < 2; i++) for (const s of updates()) expect(db.prepare(s).run().changes).toBe(0);
    expect(cfg(db)).toEqual(after1.c);
    expect(pf(db)).toEqual(after1.p);
    db.close();
  });

  it("genuine NO-OP against COPIES of the real data.db and test.db (originals untouched)", () => {
    for (const src of ["data.db", "test.db"]) {
      const before = sha(join(ROOT, src));
      const db = copyDb(src, `copy_${src}`);
      // anti-vacuity: the copy really does carry the canonical value already
      expect(cfg(db).amount_minor).toBe(30000);
      expect(pf(db).amount_minor).toBe(30000);
      const snap = { c: cfg(db), p: pf(db) };
      for (const s of updates()) expect(db.prepare(s).run().changes).toBe(0);
      expect(cfg(db)).toEqual(snap.c);
      expect(pf(db)).toEqual(snap.p);
      db.close();
      expect(sha(join(ROOT, src))).toBe(before);
    }
  });

  it("0057 and 0066 still seed the stale values — they were NOT rewritten", () => {
    expect(sqlOf(M0057)).toMatch(/2500/);
    expect(sqlOf(M0066)).toMatch(/250000/);
    expect(sqlOf(M0057)).not.toMatch(/30000/);
    expect(sqlOf(M0066)).not.toMatch(/\b30000\b/);
  });

  it("0196 contains no CREATE/ALTER/DROP/INSERT/DELETE/CAST and no money arithmetic", () => {
    const stripped = sqlOf(M0196)
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const bad of ["CREATE", "ALTER", "DROP", "INSERT", "DELETE", "REPLACE", "CAST", "/100", "*100"]) {
      expect(stripped.toUpperCase()).not.toContain(bad);
    }
    expect((stripped.match(/UPDATE/g) ?? []).length).toBe(2);
  });
});

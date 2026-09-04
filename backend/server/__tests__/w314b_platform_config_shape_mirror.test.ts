/**
 * WAVE 314b — THE INLINE-BOOTSTRAP MIRROR, GUARDED (R204, R265.5).
 *
 * `server/lib/platformConfigShapeSchema.ts` embeds migration 0231's text so that
 * the `:memory:` bootstrap schema and the migrated deploy schema converge on the
 * same `platform_config` column set. An embedded copy is only safe if drift FAILS
 * LOUDLY, so this file asserts byte-identity against BOTH shipped .sql copies and
 * asserts the two schema paths actually agree.
 *
 * Model: server/__tests__/w305_mfa_migration_mirror.test.ts, which does the same
 * job for migration 0230 and server/lib/mfaSchema.ts.
 *
 * Nothing here opens the application database. Every assertion is on a throwaway
 * in-memory handle or on file bytes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import {
  PLATFORM_CONFIG_SHAPE_SQL,
  PLATFORM_CONFIG_SHAPE_MIGRATION,
  platformConfigShapeAlters,
  ensurePlatformConfigShape,
} from "../lib/platformConfigShapeSchema";

const ROOT = path.resolve(__dirname, "../..");
const A = path.join(ROOT, "migrations", PLATFORM_CONFIG_SHAPE_MIGRATION);
const B = path.join(ROOT, "server/db/migrations", PLATFORM_CONFIG_SHAPE_MIGRATION);

/* The bootstrap's own CREATE, read out of the SACRED file rather than retyped, so
   this test cannot pass against a friendlier schema than the one that ships. */
function bootstrapDdl(table = "platform_config"): string {
  const src = fs.readFileSync(path.join(ROOT, "server/db/connection.ts"), "utf8");
  const fnAt = src.indexOf("function applyWave0PlatformConfigSchema");
  expect(fnAt, "applyWave0PlatformConfigSchema must exist in server/db/connection.ts").toBeGreaterThan(-1);
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, "g");
  re.lastIndex = fnAt;
  const m = re.exec(src);
  expect(m, `the bootstrap must contain a CREATE TABLE for ${table}`).not.toBeNull();
  let i = src.indexOf("(", m!.index);
  let d = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") d++;
    else if (src[i] === ")") {
      d--;
      if (d === 0) break;
    }
  }
  let body = src.slice(m!.index, i + 1);
  const opt = src.slice(i + 1, i + 40).match(/^\s*(STRICT)/i);
  if (opt) body += " " + opt[1];
  return body + ";";
}

function columns(db: Database.Database): string[] {
  return (db.prepare("PRAGMA table_info(platform_config)").all() as Array<{ name: string }>)
    .map((r) => String(r.name).toLowerCase())
    .sort();
}

/** Build the MIGRATED shape on a fresh handle: the old 4-column table, the
 *  history table the migration's seed rows reference, then 0231 verbatim. The
 *  history table is read out of the bootstrap for the same reason the
 *  platform_config one is: it is not retyped here. */
function migratedHandle(): Database.Database {
  const db = new Database(":memory:");
  db.exec(
    `CREATE TABLE IF NOT EXISTS platform_config (
       key TEXT PRIMARY KEY NOT NULL,
       version INTEGER NOT NULL DEFAULT 1,
       updated_at TEXT NOT NULL,
       updated_by TEXT NOT NULL);`,
  );
  db.exec(bootstrapDdl("platform_config_history"));
  db.exec(PLATFORM_CONFIG_SHAPE_SQL);
  return db;
}

describe("W314b — migration 0231 is mirrored, byte-for-byte, into the bootstrap path", () => {
  it("PRECONDITION: both shipped copies of the migration exist and are byte-identical to each other", () => {
    expect(fs.existsSync(A), `${A} must exist`).toBe(true);
    expect(fs.existsSync(B), `${B} must exist`).toBe(true);
    const a = fs.readFileSync(A);
    const b = fs.readFileSync(B);
    expect(a.length).toBeGreaterThan(0);
    expect(a.equals(b)).toBe(true);
  });

  it("the embedded SQL is byte-identical to migrations/0231…sql", () => {
    expect(PLATFORM_CONFIG_SHAPE_SQL).toBe(fs.readFileSync(A, "utf8"));
  });

  it("the embedded SQL is byte-identical to server/db/migrations/0231…sql", () => {
    expect(PLATFORM_CONFIG_SHAPE_SQL).toBe(fs.readFileSync(B, "utf8"));
  });

  it("every ALTER … ADD COLUMN in the migration is parsed out of it, and none is invented", () => {
    const parsed = platformConfigShapeAlters();
    /* Count the real statements independently, from the file, with comment lines
       removed — a commented-out ALTER must not be counted by either side. */
    const fromFile = fs
      .readFileSync(A, "utf8")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n")
      .match(/ALTER\s+TABLE\s+platform_config\s+ADD\s+COLUMN\s+[A-Za-z0-9_]+/gi);
    expect(fromFile, "the migration must contain ALTER TABLE platform_config ADD COLUMN statements").not.toBeNull();
    expect(parsed.length).toBe(fromFile!.length);
    expect(parsed.length).toBe(11);
    expect(new Set(parsed.map((p) => p.column)).size).toBe(parsed.length);
  });

  it("CONTROL: the UNPATCHED bootstrap schema DISAGREES with the migrated schema", () => {
    /* Run the control first. If the bootstrap already matched, there would be
       nothing to mirror and every assertion below would be vacuous. */
    const boot = new Database(":memory:");
    boot.exec(bootstrapDdl());
    const bootCols = columns(boot);
    boot.close();

    const mig = migratedHandle();
    const migCols = columns(mig);
    mig.close();

    expect(bootCols).not.toEqual(migCols);
    expect(migCols.filter((c) => !bootCols.includes(c))).toEqual(["hash", "prev_hash", "value"]);
  });

  it("RESULT: bootstrap + installer produces exactly the migrated column set", () => {
    const boot = new Database(":memory:");
    boot.exec(bootstrapDdl());
    const res = ensurePlatformConfigShape(boot as never);
    expect(res.tablePresent).toBe(true);
    expect(res.failed).toEqual([]);
    expect(res.applied.sort()).toEqual(["hash", "prev_hash", "value"]);
    const after = columns(boot);
    boot.close();

    const mig = migratedHandle();
    const migCols = columns(mig);
    mig.close();

    expect(after).toEqual(migCols);
    expect(after.length).toBe(15);
  });

  it("the installer is idempotent and applies nothing on a second call", () => {
    const boot = new Database(":memory:");
    boot.exec(bootstrapDdl());
    ensurePlatformConfigShape(boot as never);
    const once = columns(boot);
    const second = ensurePlatformConfigShape(boot as never);
    expect(second.applied).toEqual([]);
    expect(second.failed).toEqual([]);
    expect(second.alreadyPresent.length).toBe(11);
    expect(columns(boot)).toEqual(once);
    boot.close();
  });

  it("on a database with no platform_config table at all it does nothing and says so", () => {
    const empty = new Database(":memory:");
    const res = ensurePlatformConfigShape(empty as never);
    expect(res.tablePresent).toBe(false);
    expect(res.applied).toEqual([]);
    empty.close();
  });

  it("the installer executes no INSERT, UPDATE, DELETE or DROP (R195.5 — nothing deleted)", () => {
    /* Read the module's own source and assert the shape of what it can execute:
       only the ALTER statements parsed out of the migration ever reach db.exec. */
    for (const a of platformConfigShapeAlters()) {
      expect(a.sql).toMatch(/^ALTER TABLE platform_config ADD COLUMN /i);
      expect(a.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|REPLACE)\b/i);
    }
    const src = fs.readFileSync(path.join(ROOT, "server/lib/platformConfigShapeSchema.ts"), "utf8");
    /* The only executor in the file. */
    const execCalls = src.match(/db\.exec\(/g) ?? [];
    expect(execCalls.length).toBe(1);
    expect(src).toContain("db.exec(a.sql)");
  });
});

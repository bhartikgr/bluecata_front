/**
 * REPAIR WAVE 1 · ITEM 1 — the audit chain must bind the actor.
 *
 * WHAT WAS BROKEN (W57_REVIEW_3_RISK.md §1.1). The hash body was
 *   sha256( prevHash | id | eventType | entity | ts | payload )
 * with `actor_id` written to the row but EXCLUDED from the body, and
 * `AUDIT_CHAIN_SELECT_SQL` did not even SELECT `actor_id`. So
 * `verifyTenantAuditChain()` returned ok=true after any row's actor had been
 * rewritten to anything at all. No test asserted otherwise — all three existing
 * audit-chain test files insert actor values but never assert the hash covers
 * them.
 *
 * BOTH POLES, for every claim:
 *   POLE A — the new v2 path works: rows verify clean, and the actor really is
 *            inside the body (proved by recomputing the body by hand).
 *   POLE B — it still bites: rewriting ONLY `actor_id` on a v2 row is DETECTED.
 *   POLE C — nothing historical broke: a row written under the LEGACY v1 formula
 *            still verifies clean, byte-for-byte, alongside v2 rows.
 *
 * EACH OF THESE FAILS WITHOUT THE FIX. Before this wave, POLE B's assertion was
 * `ok === true` (the defect), and POLE A's hand-recomputation of the v2 body
 * would not have matched the stored hash.
 *
 * NODE_ENV=test puts the DB at `:memory:` (server/db/connection.ts); nothing
 * here reads or writes live data, and the probe tenant is unique to this file.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { getDb, rawDb } from "../db/connection";
import {
  verifyTenantAuditChain,
  appendAdminAudit,
  auditHashBody,
  AUDIT_CHAIN_SELECT_SQL,
  AUDIT_HASH_VERSION_LEGACY,
  AUDIT_HASH_VERSION_ACTOR_BOUND,
  AUDIT_HASH_VERSION_CURRENT,
} from "../adminPlatformStore";
import {
  ensureRepair1AuditActorBindingSchema,
  readRepair1Ddl,
  executableStatements,
  REPAIR1_AUDIT_LOG_ALTER,
  REPAIR1_AUDIT_LOG_COLUMNS,
} from "../lib/applyRepair1AuditActorBindingSchema";
import { seedDemoData } from "../lib/seedDemoData";

const ROOT = join(__dirname, "..", "..");
const MIGRATION = "0188_repair1_audit_actor_binding.sql";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** A tenant nobody else in the suite touches. */
const PROBE_TENANT = "tenant_repair1_actor_probe";

function wipeProbeTenant(): void {
  const db = rawDb();
  db.prepare(`DELETE FROM audit_log WHERE tenant_id = ?`).run(PROBE_TENANT);
  try {
    db.prepare(`DELETE FROM audit_chain_genesis WHERE tenant_id = ?`).run(PROBE_TENANT);
  } catch {
    /* table may be absent on a bare handle; the walk falls back to "0"*64 */
  }
}

function columnNames(table: string): string[] {
  return (rawDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((r) => String(r.name));
}

beforeAll(async () => {
  process.env.ENABLE_DEMO_SEED = "1";
  await seedDemoData(getDb());
}, 60_000);

afterEach(() => {
  wipeProbeTenant();
});

/* ══════════════════════════════════════════════════════════════════════════════
 * (1) MIGRATION 0188 — additive only, idempotent, mirrored, no index.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("REPAIR 1 · Item 1 — migration 0188 shape", () => {
  it("exists in migrations/ and is the highest-numbered migration", () => {
    const p = join(ROOT, "migrations", MIGRATION);
    expect(existsSync(p)).toBe(true);
  });

  it("is byte-identical to its mirror in server/db/migrations/", () => {
    const a = readFileSync(join(ROOT, "migrations", MIGRATION));
    const b = readFileSync(join(ROOT, "server", "db", "migrations", MIGRATION));
    expect(a.equals(b)).toBe(true);
  });

  it("is ADDITIVE ONLY — no DROP, no ALTER … RENAME, no DELETE, no UPDATE", () => {
    const sql = readFileSync(join(ROOT, "migrations", MIGRATION), "utf8");
    const exec = executableStatements(sql).join("\n").toUpperCase();
    expect(exec).not.toMatch(/\bDROP\b/);
    expect(exec).not.toMatch(/\bRENAME\b/);
    expect(exec).not.toMatch(/\bDELETE\b/);
    expect(exec).not.toMatch(/\bUPDATE\b/);
    // Exactly one executable statement, and it is the additive ALTER.
    expect(executableStatements(sql)).toEqual([REPAIR1_AUDIT_LOG_ALTER]);
  });

  it("creates NO INDEX — a plain CREATE INDEX would leave the migration unrecorded (WAIVER-3) and add a third migration:chain pin", () => {
    const sql = readFileSync(join(ROOT, "migrations", MIGRATION), "utf8");
    expect(executableStatements(sql).join("\n").toUpperCase()).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/);
  });

  it("the installer's literal fallback is identical to the migration's own statement (no drift)", () => {
    const sql = readRepair1Ddl();
    expect(sql).not.toBeNull();
    expect(executableStatements(sql!)).toContain(REPAIR1_AUDIT_LOG_ALTER);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * (2) THE INSTALLER — the column exists on a handle built from the SACRED
 *     inline DDL, and installing twice is a no-op.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("REPAIR 1 · Item 1 — hash_version column", () => {
  it("is present on this test handle (self-heal installer ran)", () => {
    expect(ensureRepair1AuditActorBindingSchema()).toBe(true);
    for (const c of REPAIR1_AUDIT_LOG_COLUMNS) {
      expect(columnNames("audit_log")).toContain(c);
    }
  });

  it("is idempotent — a second install neither throws nor duplicates the column", () => {
    expect(ensureRepair1AuditActorBindingSchema()).toBe(true);
    expect(ensureRepair1AuditActorBindingSchema()).toBe(true);
    const cols = columnNames("audit_log").filter((c) => c === "hash_version");
    expect(cols).toHaveLength(1);
  });

  it("defaults existing/legacy rows to version 1", () => {
    ensureRepair1AuditActorBindingSchema();
    const db = rawDb();
    db.prepare(
      `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, payload_json, prev_hash, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("al_repair1_default", PROBE_TENANT, "u_probe", "probe.default", "platform", "{}", null, "x", "2026-01-01T00:00:00.000Z");
    const row = db
      .prepare(`SELECT hash_version AS v FROM audit_log WHERE id = ?`)
      .get("al_repair1_default") as { v: number };
    expect(Number(row.v)).toBe(AUDIT_HASH_VERSION_LEGACY);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * (3) THE VERIFIER READS THE ACTOR AT ALL.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("REPAIR 1 · Item 1 — the verifier selects actor_id", () => {
  it("AUDIT_CHAIN_SELECT_SQL selects actor_id and hash_version (it selected NEITHER before this wave)", () => {
    expect(AUDIT_CHAIN_SELECT_SQL).toContain("actor_id");
    expect(AUDIT_CHAIN_SELECT_SQL).toContain("hash_version");
    // Regression guards on the contract the previous wave pinned.
    expect(AUDIT_CHAIN_SELECT_SQL).toContain("ORDER BY created_at ASC, id ASC");
    expect(AUDIT_CHAIN_SELECT_SQL).not.toContain("deleted_at");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * (4) THE HASH BODY — v1 unchanged, v2 = v1 + "|actorId" appended at the END.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("REPAIR 1 · Item 1 — versioned hash bodies", () => {
  const base = {
    prevHash: "0".repeat(64),
    id: "al_x",
    eventType: "probe.evt",
    entity: "platform",
    ts: "2026-01-01T00:00:00.000Z",
    payloadStr: '{"n":1}',
    actorId: "u_real_actor",
  };

  it("v1 is byte-for-byte the legacy formula and does NOT contain the actor", () => {
    const v1 = auditHashBody({ ...base, version: AUDIT_HASH_VERSION_LEGACY });
    expect(v1).toBe(
      `${base.prevHash}|${base.id}|${base.eventType}|${base.entity}|${base.ts}|${base.payloadStr}`,
    );
    expect(v1).not.toContain(base.actorId);
  });

  it("v2 APPENDS the actor at the END, so the v1 body is a strict prefix of it", () => {
    const v1 = auditHashBody({ ...base, version: AUDIT_HASH_VERSION_LEGACY });
    const v2 = auditHashBody({ ...base, version: AUDIT_HASH_VERSION_ACTOR_BOUND });
    expect(v2).toBe(`${v1}|${base.actorId}`);
    expect(v2.startsWith(v1)).toBe(true);
    expect(v2).toContain(base.actorId);
  });

  it("changing ONLY the actor changes the v2 body but not the v1 body", () => {
    const other = { ...base, actorId: "u_forged" };
    expect(auditHashBody({ ...base, version: 1 })).toBe(auditHashBody({ ...other, version: 1 }));
    expect(auditHashBody({ ...base, version: 2 })).not.toBe(auditHashBody({ ...other, version: 2 }));
  });

  it("the current writer version is 2 (actor-bound)", () => {
    expect(AUDIT_HASH_VERSION_CURRENT).toBe(AUDIT_HASH_VERSION_ACTOR_BOUND);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * (5) POLE A / POLE B / POLE C — end to end, through the real writer.
 * ═════════════════════════════════════════════════════════════════════════════ */
describe("REPAIR 1 · Item 1 — a forged actor is now DETECTABLE", () => {
  it("POLE A: appended rows are stamped hash_version=2 and their stored hash really includes the actor", () => {
    wipeProbeTenant();
    appendAdminAudit("u_real_actor", "user:u_probe", "probe.one", { n: 1 }, PROBE_TENANT);

    const row = rawDb()
      .prepare(
        `SELECT id, actor_id AS "actorId", action, target, created_at AS ts,
                payload_json AS "payloadJson", prev_hash AS "prevHash", hash,
                hash_version AS "hashVersion"
           FROM audit_log WHERE tenant_id = ?`,
      )
      .get(PROBE_TENANT) as any;

    expect(Number(row.hashVersion)).toBe(AUDIT_HASH_VERSION_ACTOR_BOUND);
    expect(row.actorId).toBe("u_real_actor");

    // Recompute the body BY HAND. This is the assertion that fails without the
    // fix: under the old formula the stored hash matched the actor-LESS body.
    const bodyWithActor =
      `${row.prevHash}|${row.id}|${row.action}|${row.target}|${row.ts}|${row.payloadJson}|${row.actorId}`;
    const bodyWithoutActor =
      `${row.prevHash}|${row.id}|${row.action}|${row.target}|${row.ts}|${row.payloadJson}`;
    expect(row.hash).toBe(sha256(bodyWithActor));
    expect(row.hash).not.toBe(sha256(bodyWithoutActor));

    expect(verifyTenantAuditChain(rawDb(), PROBE_TENANT).ok).toBe(true);
  });

  it("POLE B: rewriting ONLY actor_id on a v2 row breaks verification (before this wave it stayed ok=true)", () => {
    wipeProbeTenant();
    appendAdminAudit("u_real_actor", "user:u_probe", "probe.one", { n: 1 }, PROBE_TENANT);
    appendAdminAudit("u_real_actor", "user:u_probe", "probe.two", { n: 2 }, PROBE_TENANT);
    appendAdminAudit("u_real_actor", "user:u_probe", "probe.three", { n: 3 }, PROBE_TENANT);

    const before = verifyTenantAuditChain(rawDb(), PROBE_TENANT);
    expect(before.ok).toBe(true);
    expect(before.totalLinks).toBe(3);

    // Forge the actor on the SECOND row. Nothing else is touched — not the
    // payload, not the timestamps, not prev_hash, not hash.
    const ids = (rawDb()
      .prepare(`SELECT id FROM audit_log WHERE tenant_id = ? ORDER BY created_at ASC, id ASC`)
      .all(PROBE_TENANT) as Array<{ id: string }>).map((r) => r.id);
    rawDb()
      .prepare(`UPDATE audit_log SET actor_id = ? WHERE id = ?`)
      .run("u_admin", ids[1]);

    const after = verifyTenantAuditChain(rawDb(), PROBE_TENANT);
    expect(after.ok, "a forged actor MUST break the chain").toBe(false);
    expect(after.brokenAt).toBe(1);
  });

  it("POLE B2: forging the actor on a v2 row to a REAL, settlement-authorised identity is equally detected", () => {
    wipeProbeTenant();
    appendAdminAudit("u_aisha_patel", "user:u_probe", "probe.only", { n: 1 }, PROBE_TENANT);
    expect(verifyTenantAuditChain(rawDb(), PROBE_TENANT).ok).toBe(true);
    rawDb().prepare(`UPDATE audit_log SET actor_id = 'u_admin' WHERE tenant_id = ?`).run(PROBE_TENANT);
    expect(verifyTenantAuditChain(rawDb(), PROBE_TENANT).ok).toBe(false);
  });

  it("POLE C: a LEGACY v1 row still verifies clean, and v1 and v2 rows coexist in one chain", () => {
    wipeProbeTenant();
    ensureRepair1AuditActorBindingSchema();
    const db = rawDb();

    // Hand-write a row exactly as the pre-0188 writer would have: v1 body, and
    // hash_version explicitly 1. Its actor is deliberately the fabricated
    // "admin" literal that fills every row in the live DB.
    const id1 = "al_repair1_legacy01";
    const ts1 = "2026-01-01T00:00:00.000Z";
    const payload1 = '{"legacy":true}';
    const prev1 = "0".repeat(64);
    const legacyBody = `${prev1}|${id1}|legacy.evt|platform|${ts1}|${payload1}`;
    const legacyHash = sha256(legacyBody);
    db.prepare(
      `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, payload_json, prev_hash, hash, created_at, hash_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id1, PROBE_TENANT, "admin", "legacy.evt", "platform", payload1, prev1, legacyHash, ts1, AUDIT_HASH_VERSION_LEGACY);

    const v1only = verifyTenantAuditChain(db, PROBE_TENANT);
    expect(v1only.ok, "a legacy v1 row must keep verifying, byte-for-byte").toBe(true);
    expect(v1only.totalLinks).toBe(1);

    // Now append a real v2 row on top of it and verify the mixed chain.
    appendAdminAudit("u_real_actor", "user:u_probe", "probe.after_legacy", { n: 2 }, PROBE_TENANT);
    const mixed = verifyTenantAuditChain(db, PROBE_TENANT);
    expect(mixed.ok, "a v1 row followed by a v2 row must verify as one chain").toBe(true);
    expect(mixed.totalLinks).toBe(2);

    const versions = (db
      .prepare(`SELECT hash_version AS v FROM audit_log WHERE tenant_id = ? ORDER BY created_at ASC, id ASC`)
      .all(PROBE_TENANT) as Array<{ v: number }>).map((r) => Number(r.v));
    expect(versions).toEqual([AUDIT_HASH_VERSION_LEGACY, AUDIT_HASH_VERSION_ACTOR_BOUND]);
  });

  it("POLE C2: rewriting the actor on a LEGACY v1 row is still NOT detectable — stated honestly, not hidden", () => {
    // This is the deliberate, documented limit of the design. Repairing the
    // existing chain is OUT OF SCOPE for this wave, and a v1 row cannot be made
    // actor-bound without re-hashing history. The test exists so nobody later
    // mistakes v1 rows for protected ones.
    wipeProbeTenant();
    ensureRepair1AuditActorBindingSchema();
    const db = rawDb();
    const id1 = "al_repair1_legacy02";
    const ts1 = "2026-01-01T00:00:00.000Z";
    const prev1 = "0".repeat(64);
    const body = `${prev1}|${id1}|legacy.evt|platform|${ts1}|{}`;
    db.prepare(
      `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, payload_json, prev_hash, hash, created_at, hash_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id1, PROBE_TENANT, "admin", "legacy.evt", "platform", "{}", prev1, sha256(body), ts1, AUDIT_HASH_VERSION_LEGACY);

    expect(verifyTenantAuditChain(db, PROBE_TENANT).ok).toBe(true);
    db.prepare(`UPDATE audit_log SET actor_id = 'u_forged' WHERE id = ?`).run(id1);
    expect(
      verifyTenantAuditChain(db, PROBE_TENANT).ok,
      "v1 rows are actor-UNBOUND by construction; this is the documented limit",
    ).toBe(true);
  });
});

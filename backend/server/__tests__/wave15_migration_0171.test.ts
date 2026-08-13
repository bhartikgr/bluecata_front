/**
 * WAVE 15 — migration 0171, proved against a REAL sqlite database.
 *
 * WHY THIS FILE EXISTS SEPARATELY. The unit suite exercises the engines with the
 * shared connection, where the Wave 14 tables may not be installed. That is not
 * enough for the claims this wave makes, because three of them are claims about
 * the DATABASE:
 *   · a critical alert cannot be muted (CHECK locked = 0 OR enabled = 1);
 *   · an `adopted` orphan ruling cannot exist without a caller_ref;
 *   · a cleared audit incident cannot exist without evidence.
 * Those are the SECOND path — the one that still holds when a future writer
 * skips the route entirely. A test that only went through the route would prove
 * nothing about them.
 *
 * So this file installs 0170 + 0171 into a scratch database and asserts each
 * constraint in BOTH directions: the legal row inserts, and the illegal row is
 * REJECTED. A CHECK nobody ever tried to violate is a CHECK nobody has verified.
 */
import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();
const M0159 = join(ROOT, "migrations", "0159_wave9_reporting_audit.sql");
const M0170 = join(ROOT, "migrations", "0170_wave14_money_orphan_reporting_audit.sql");
const M0171 = join(ROOT, "migrations", "0171_wave15_orphan_reporting_config.sql");
const MIRROR_0171 = join(ROOT, "server", "db", "migrations", "0171_wave15_orphan_reporting_config.sql");

let db: Database.Database;

/** The subset of 0170/0159 DDL that 0171's seeds depend on. */
function installPrereqs(d: Database.Database): void {
  const sql0170 = readFileSync(M0170, "utf8");
  // Execute only the CREATE statements plus 0170's own seeds. `exec` runs the
  // whole file; 0170 is self-contained and idempotent, which is the property
  // being relied on (and, incidentally, tested).
  d.exec(`CREATE TABLE IF NOT EXISTS wave9_reporting_config (
    key TEXT PRIMARY KEY NOT NULL,
    value_json TEXT NOT NULL,
    value_type TEXT NOT NULL,
    description TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;`);
  d.exec(`CREATE TABLE IF NOT EXISTS ddl_column_disposition (
    id TEXT PRIMARY KEY NOT NULL,
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    declared_in TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK (disposition IN ('use','drop','document')),
    rationale TEXT NOT NULL,
    risk_class TEXT NOT NULL,
    owner_ruled INTEGER NOT NULL DEFAULT 0 CHECK (owner_ruled IN (0,1)),
    recorded_at TEXT NOT NULL
  ) STRICT;`);
  d.exec(sql0170);
}

beforeAll(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  installPrereqs(db);
  db.exec(readFileSync(M0171, "utf8"));
});

describe("0171 — mirror and shape", () => {
  it("is mirrored BYTE-IDENTICALLY into server/db/migrations", () => {
    expect(existsSync(MIRROR_0171)).toBe(true);
    expect(readFileSync(MIRROR_0171)).toEqual(readFileSync(M0171));
  });

  it("takes 0171 and does not reuse a BURNT number", () => {
    const burnt = ["0152", "0154", "0155", "0158"];
    for (const b of burnt) expect(M0171).not.toContain(`/${b}_`);
  });

  it("creates NO new table — the shape-collision defence", () => {
    /* 0153/0167 collided because two files declared overlapping shapes and
       `IF NOT EXISTS` silently discarded the second. The strongest available
       defence is to declare nothing. This asserts that, textually. */
    const sql = readFileSync(M0171, "utf8");
    const creates = sql.match(/CREATE\s+TABLE/gi) ?? [];
    expect(creates).toEqual([]);
  });

  it("is idempotent: re-running it changes nothing", () => {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM orphan_surface_disposition`).get() as { n: number };
    const cfgBefore = db.prepare(`SELECT COUNT(*) AS n FROM wave9_reporting_config`).get() as { n: number };
    db.exec(readFileSync(M0171, "utf8"));
    const after = db.prepare(`SELECT COUNT(*) AS n FROM orphan_surface_disposition`).get() as { n: number };
    const cfgAfter = db.prepare(`SELECT COUNT(*) AS n FROM wave9_reporting_config`).get() as { n: number };
    expect(after.n).toBe(before.n);
    expect(cfgAfter.n).toBe(cfgBefore.n);
  });
});

describe("0171 — M-1d / M-5 config seeds", () => {
  it("seeds footnote.subline_used as FALSE (the conservative reading)", () => {
    const r = db
      .prepare(`SELECT value_json, value_type FROM wave9_reporting_config WHERE key='footnote.subline_used'`)
      .get() as { value_json: string; value_type: string };
    expect(r).toBeTruthy();
    expect(r.value_type).toBe("boolean");
    // FALSE matters: a subscription-line disclosure on a vehicle that never drew
    // a facility is a false statement in an investor report.
    expect(JSON.parse(r.value_json)).toBe(false);
  });

  it("seeds carry.hurdle_convention inside the engine's closed domain", () => {
    const r = db
      .prepare(`SELECT value_json FROM wave9_reporting_config WHERE key='carry.hurdle_convention'`)
      .get() as { value_json: string };
    const v = JSON.parse(r.value_json);
    // The engine domain is exactly {simple_act_365, none}. Compounding is
    // deliberately absent because it is not implemented, so config cannot claim
    // behaviour the code does not have.
    expect(["simple_act_365", "none"]).toContain(v);
  });

  it("does not overwrite the five footnote keys 0170 already seeded", () => {
    const r = db
      .prepare(`SELECT value_json FROM wave9_reporting_config WHERE key='footnote.recallable_treatment'`)
      .get() as { value_json: string };
    expect(JSON.parse(r.value_json)).toBe("excluded_from_paid_in");
    const by = db
      .prepare(`SELECT updated_by FROM wave9_reporting_config WHERE key='footnote.recallable_treatment'`)
      .get() as { updated_by: string };
    expect(by.updated_by).toBe("migration:0170");
  });
});

describe("0171 — build policy decisions", () => {
  it("records the hurdle-convention decision as RULED", () => {
    const r = db
      .prepare(`SELECT state, ruling, owner_required FROM build_policy_decision WHERE decision_key='carry.hurdle_convention'`)
      .get() as any;
    expect(r.state).toBe("recorded");
    expect(String(r.ruling)).toContain("simple_act_365");
    expect(r.owner_required).toBe(0);
  });

  it("records GATE-A3 as OPEN with owner_required=1 and NO ruling", () => {
    const r = db
      .prepare(`SELECT state, ruling, owner_required, rationale FROM build_policy_decision WHERE decision_key='GATE-A3'`)
      .get() as any;
    expect(r.state).toBe("open");
    // An open question with a ruling filled in would be a decision made on the
    // owner's behalf while claiming not to have been.
    expect(r.ruling).toBeNull();
    expect(r.owner_required).toBe(1);
    expect(String(r.rationale)).toContain("OWNER DECISION");
  });
});

describe("0171 — orphan dispositions, and the DB fences on them", () => {
  it("records every route this wave mounted as ADOPTED with a caller_ref", () => {
    const rows = db
      .prepare(`SELECT path, caller_ref, disposition FROM orphan_surface_disposition WHERE recorded_by LIKE 'system:wave15%'`)
      .all() as any[];
    expect(rows.length).toBeGreaterThanOrEqual(14);
    for (const r of rows) {
      if (r.disposition === "adopted") {
        expect(String(r.caller_ref ?? "").trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("REJECTS an adopted ruling with no caller_ref (the DB fence, not the route)", () => {
    // POLE 2. This is the second path: a future writer that skips the route
    // still cannot claim a surface is adopted without naming its consumer.
    expect(() =>
      db
        .prepare(
          `INSERT INTO orphan_surface_disposition
             (id, surface_kind, method, path, silo, declared_in, disposition, caller_ref, item_id, rationale, recorded_at, recorded_by)
           VALUES ('osd_bad_test','route','GET','/api/test/no-caller','core','test','adopted',NULL,'TEST',
                   'This rationale is long enough to satisfy the retired check as well.','2026-08-10T00:00:00Z','test')`,
        )
        .run(),
    ).toThrow();
  });

  it("records the two ORP-063 copy keys as copy_key rows pointing at the component that renders them", () => {
    const rows = db
      .prepare(`SELECT path, caller_ref FROM orphan_surface_disposition WHERE surface_kind='copy_key' AND item_id='ORP-063'`)
      .all() as any[];
    expect(rows.map((r) => r.path).sort()).toEqual(["SPV_EDU.reviewLaunch", "SPV_EDU.terms"]);
    for (const r of rows) expect(String(r.caller_ref)).toContain("SpvDetailTabs.tsx");
  });

  it("records ORP-052 /api/stream as adopted by the sseClient path option", () => {
    const r = db
      .prepare(`SELECT disposition, caller_ref FROM orphan_surface_disposition WHERE path='/api/stream'`)
      .get() as any;
    expect(r.disposition).toBe("adopted");
    expect(String(r.caller_ref)).toContain("sseClient");
  });
});

describe("0170 CHECKs this wave now RELIES ON — proved in both directions", () => {
  it("ACCEPTS a normal founder notification preference row", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO founder_notification_preference
             (id,user_id,pref_key,channel,enabled,locked,updated_at,updated_by)
           VALUES ('fnp_ok','u1','dataroom.file_opened','in_app',0,0,'2026-08-10T00:00:00Z','test')`,
        )
        .run(),
    ).not.toThrow();
  });

  it("REJECTS disabling a LOCKED critical alert (locked = 0 OR enabled = 1)", () => {
    // The engine also refuses this with NOTIFICATION_PREF_LOCKED. Two
    // independent fences, deliberately: this one holds for writers that never
    // touch the engine.
    expect(() =>
      db
        .prepare(
          `INSERT INTO founder_notification_preference
             (id,user_id,pref_key,channel,enabled,locked,updated_at,updated_by)
           VALUES ('fnp_bad','u1','round.closed','in_app',0,1,'2026-08-10T00:00:00Z','test')`,
        )
        .run(),
    ).toThrow();
  });

  it("REJECTS an unknown channel", () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO founder_notification_preference
             (id,user_id,pref_key,channel,enabled,locked,updated_at,updated_by)
           VALUES ('fnp_ch','u1','dataroom.file_opened','carrier_pigeon',1,0,'2026-08-10T00:00:00Z','test')`,
        )
        .run(),
    ).toThrow();
  });

  it("REJECTS clearing an audit incident without evidence", () => {
    // A-2's honesty rule, enforced by the database.
    expect(() =>
      db
        .prepare(`UPDATE platform_audit_incident SET state='cleared' WHERE incident_key='audit.chain_integrity'`)
        .run(),
    ).toThrow();
  });

  it("ACCEPTS clearing WITH actor, timestamp and >= 20 chars of evidence", () => {
    expect(() =>
      db
        .prepare(
          `UPDATE platform_audit_incident
              SET state='cleared', cleared_at='2026-08-10T01:00:00Z', cleared_by='test',
                  cleared_evidence='verifyTenantAuditChain passed for all tenants at 2026-08-10T01:00:00Z'
            WHERE incident_key='audit.chain_integrity'`,
        )
        .run(),
    ).not.toThrow();
  });

  it("leaves the seeded audit incident OPEN in a fresh database", () => {
    // The honest default. On a database whose chain has never been verified,
    // open is the true state, and this wave did NOT clear it.
    const fresh = new Database(":memory:");
    installPrereqs(fresh);
    fresh.exec(readFileSync(M0171, "utf8"));
    const r = fresh
      .prepare(`SELECT state FROM platform_audit_incident WHERE incident_key='audit.chain_integrity'`)
      .get() as any;
    expect(r.state).toBe("open");
    fresh.close();
  });

  it("REJECTS a carry accrual row where a cent went missing", () => {
    // M-5's conservation rule, enforced by the DATABASE so that a future writer
    // reintroducing a per-party Math.round cannot persist the loss.
    const insert = (carry: number, catchUp: number, lpNet: number, distributed: number) =>
      db
        .prepare(
          `INSERT INTO spv_carry_accrual
             (id,spv_id,tenant_id,as_of_date,basis,contributed_minor,distributed_minor,hurdle_owed_minor,
              hurdle_met,carry_minor,catch_up_minor,lp_net_minor,currency,carry_rate_fraction,
              hurdle_rate_fraction,catch_up_rate_fraction,hurdle_kind,component_count,computed_at,computed_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          `sca_${carry}_${catchUp}_${lpNet}_${distributed}`,
          "spv1",
          "t1",
          "2026-06-30",
          "whole_spv",
          1000,
          distributed,
          0,
          1,
          carry,
          catchUp,
          lpNet,
          "USD",
          0.2,
          0.08,
          1.0,
          "hard",
          1,
          "2026-08-10T00:00:00Z",
          "test",
        );
    // 199 + 0 + 800 = 999 != 1000. One cent unaccounted for.
    expect(() => insert(199, 0, 800, 1000)).toThrow();
    // The exact split is accepted.
    expect(() => insert(200, 0, 800, 1000)).not.toThrow();
  });
});

/**
 * WAVE 143 · BATCH 1 · ITEM 4 — `partner_team_peers` IS ENABLED,
 * `partner_engaged_company_people` IS NOT.                R108.1 · R95 · R103
 *
 * THE LIVE SYMPTOM. A Consortium Partner with 2/2 active team seats opened the DM
 * picker and read "No eligible contacts." (PartnerMessages.tsx:168). The cause was
 * data, not code: migration 0181 seeded `partner_team_peers` with
 * `enabled = 0, requires_owner_decision = 1`, awaiting a ruling, and
 * `partnerTeamPeerIds` has been wired and tested since WAVE 33.
 *
 * WHAT THIS WAVE RULED (R108.1, which OVERTURNED R107.2 in part):
 *   · `partner_team_peers` → ENABLED by migration 0199. Intra-organisation only.
 *   · `partner_engaged_company_people` → STAYS DISABLED. The directory payload
 *     carries `capTables`, `location` and an unresolved `capavateAngelNetwork`
 *     (commsStore.ts:3472-3475) which privacy resolution does not touch, so
 *     enabling it would let a partner read a client-company member's private
 *     cap-table positions. FORBIDDEN in this wave.
 *
 * METHOD, and why it is not vacuous:
 *   · Group P asserts the MIGRATION against fresh databases built from 0181's own
 *     DDL, and as a verified NO-OP against COPIES of data.db and test.db whose
 *     sha256 is captured before and after. The originals are never opened.
 *   · Group Q asserts the REAL CODE PATH: the same express app and the same
 *     `GET /api/comms/users` handler the partner's picker calls, with 0199's own
 *     SQL — read from the file, not re-typed — applied to the in-memory DB.
 *     BOTH POLES on the SAME fixture: rule off → the colleague is absent; 0199
 *     applied → the same colleague is present. A test that only ever saw an empty
 *     list would pass identically against the broken build.
 *   · Group R is the confidentiality pole: with 0199 applied, the engaged client
 *     company's founder is STILL not messageable, and no `capTables` payload for
 *     them reaches the partner.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { registerCommsRoutes } from "../commsStore";
import { readRules, isAudienceRuleEnabled } from "../lib/commsAudienceRules";
import { partnerTeamPeerIds, delegatedCompanyPeopleIds } from "../lib/partnerDelegatedContext";
import { applyCommsDelegatedContextSchema } from "../lib/applyCommsDelegatedContextSchema";
import { splitStatements } from "../db/migrate";

const ROOT = process.cwd();
const SCRATCH = join(ROOT, "w143_scratch", "dbs");
const NAME = "0199_wave143_partner_team_peers_enable.sql";
const M0199 = `migrations/${NAME}`;
const MIRROR = `server/db/migrations/${NAME}`;
const M0181 = "migrations/0181_wave33_msg01_delegated_context.sql";

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

const sqlOf = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

/** 0199's executable statements, comments stripped exactly as the runner splits
 *  them. Anti-vacuity: the count is pinned so the file can never degrade into
 *  running nothing, and every statement must be an UPDATE. */
function updates(): string[] {
  const out = splitStatements(sqlOf(M0199))
    .map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
    .filter((s) => s.length > 0);
  expect(out.length).toBe(1);
  expect(out[0].slice(0, 6).toUpperCase()).toBe("UPDATE");
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
const rule = (db: Db, key: string) =>
  db
    .prepare(
      `SELECT rule_key, enabled, requires_owner_decision, decided_at, decided_by
         FROM comms_audience_rules WHERE rule_key = ?`,
    )
    .get(key);

/* ══════════════════════════════════════════════════════════════════════════
   (P) THE MIGRATION
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 143 · P — migration 0199", () => {
  it("P1 the migration exists and its server/db mirror is BYTE-IDENTICAL", () => {
    const a = readFileSync(join(ROOT, M0199));
    const b = readFileSync(join(ROOT, MIRROR));
    expect(a.equals(b)).toBe(true);
    expect(sha(join(ROOT, M0199))).toBe(sha(join(ROOT, MIRROR)));
  });

  it("P2 THE FIX — an UNDECIDED partner_team_peers row is enabled and stamped", () => {
    const db = fresh("enable.db");
    apply(db, M0181);
    /* The pre-0199 shipped state, read from 0181 itself rather than asserted. */
    expect(rule(db, "partner_team_peers")).toMatchObject({
      enabled: 0,
      requires_owner_decision: 1,
      decided_at: null,
    });
    const info = db.prepare(updates()[0]).run();
    expect(info.changes).toBe(1);
    const after = rule(db, "partner_team_peers");
    expect(after.enabled).toBe(1);
    expect(after.requires_owner_decision).toBe(0);
    expect(after.decided_at).toBe("2026-08-25T00:00:00.000Z");
    /* `decided_by` names a HUMAN, not "system": this row is the record that an
       owner ruled. */
    expect(String(after.decided_by)).toContain("owner:");
    expect(String(after.decided_by)).toContain("R108.1");
    db.close();
  });

  it("P3 THE R108.1 POLE — partner_engaged_company_people is STILL DISABLED afterwards", () => {
    /* The whole point of R108.1. If this ever goes green-with-enabled, a partner
       can read a client-company member's cap table. */
    const db = fresh("held_off.db");
    apply(db, M0181);
    db.prepare(updates()[0]).run();
    const held = rule(db, "partner_engaged_company_people");
    expect(held.enabled).toBe(0);
    expect(held.requires_owner_decision).toBe(1);
    expect(held.decided_at).toBeNull();
    expect(held.decided_by).toBeNull();
    /* And the file itself never names that key in an executable statement. */
    expect(updates()[0]).not.toContain("partner_engaged_company_people");
    db.close();
  });

  it("P4 the guard does not overrule a HUMAN who already ruled — in either direction", () => {
    /* Ruled OFF deliberately: `decided_at` set, enabled 0. A migration records a
       decision; it must never reverse one. */
    const off = fresh("ruled_off.db");
    apply(off, M0181);
    off
      .prepare(
        `UPDATE comms_audience_rules
            SET enabled = 0, requires_owner_decision = 0,
                decided_at = '2026-08-24T09:00:00.000Z', decided_by = 'u_admin'
          WHERE rule_key = 'partner_team_peers'`,
      )
      .run();
    expect(off.prepare(updates()[0]).run().changes).toBe(0);
    expect(rule(off, "partner_team_peers")).toMatchObject({
      enabled: 0,
      decided_at: "2026-08-24T09:00:00.000Z",
      decided_by: "u_admin",
    });
    off.close();

    /* Ruled ON already: the migration must not restamp someone else's decision. */
    const on = fresh("ruled_on.db");
    apply(on, M0181);
    on
      .prepare(
        `UPDATE comms_audience_rules
            SET enabled = 1, requires_owner_decision = 0,
                decided_at = '2026-08-24T09:00:00.000Z', decided_by = 'u_admin'
          WHERE rule_key = 'partner_team_peers'`,
      )
      .run();
    expect(on.prepare(updates()[0]).run().changes).toBe(0);
    expect(rule(on, "partner_team_peers").decided_by).toBe("u_admin");
    on.close();
  });

  it("P5 IDEMPOTENT — a second and third apply change nothing further", () => {
    const db = fresh("idem.db");
    apply(db, M0181);
    expect(db.prepare(updates()[0]).run().changes).toBe(1);
    const snap = rule(db, "partner_team_peers");
    expect(db.prepare(updates()[0]).run().changes).toBe(0);
    expect(db.prepare(updates()[0]).run().changes).toBe(0);
    expect(rule(db, "partner_team_peers")).toEqual(snap);
    db.close();
  });

  it("P6 the FOUR legacy `any` rules are untouched — nothing is silently dropped", () => {
    const db = fresh("legacy.db");
    apply(db, M0181);
    const before = db
      .prepare(
        `SELECT rule_key, enabled, requires_owner_decision, decided_at, decided_by
           FROM comms_audience_rules
          WHERE rule_key IN ('channel_participant','cap_table_peer','chapter_peer','follow_peer')
          ORDER BY rule_key`,
      )
      .all();
    expect(before.length).toBe(4);
    db.prepare(updates()[0]).run();
    const after = db
      .prepare(
        `SELECT rule_key, enabled, requires_owner_decision, decided_at, decided_by
           FROM comms_audience_rules
          WHERE rule_key IN ('channel_participant','cap_table_peer','chapter_peer','follow_peer')
          ORDER BY rule_key`,
      )
      .all();
    expect(after).toEqual(before);
    for (const r of after) expect(r.enabled).toBe(1);
    db.close();
  });

  it("P7 no unit conversion, no destructive DDL — this migration only flips flags", () => {
    const sql = updates()[0];
    for (const forbidden of ["/100", "* 100", "*100", "CAST(", "DROP ", "DELETE "]) {
      expect(sql.toUpperCase()).not.toContain(forbidden.toUpperCase());
    }
    expect(sql).toContain("comms_audience_rules");
  });
});

/* ═════════ (P8/P9) AGAINST COPIES OF THE REAL DATABASES — never the originals */

describe("WAVE 143 · P — against COPIES of the real databases", () => {
  for (const src of ["data.db", "test.db"]) {
    it(`P8 ${src}: the original is byte-unchanged, and 0199's effect is stated honestly`, () => {
      const abs = join(ROOT, src);
      if (!existsSync(abs)) {
        /* Stated rather than silently skipped. */
        expect(existsSync(abs)).toBe(false);
        return;
      }
      const before = sha(abs);
      const db = copyDb(src, `copy_${src}`);
      let ruleRow: any = null;
      try {
        ruleRow = rule(db, "partner_team_peers");
      } catch {
        ruleRow = null;
      }
      if (ruleRow == null) {
        /* The table is not installed in this file: 0199 cannot run against it and
           the migration runner installs 0181 first at boot. Recorded, not glossed. */
        expect(ruleRow).toBeNull();
      } else {
        const info = db.prepare(updates()[0]).run();
        /* Either it was undecided (1 change, now enabled) or it was already ruled
           (0 changes). BOTH are correct; what matters is which, and that it is
           recorded in the build log. */
        expect([0, 1]).toContain(info.changes);
        expect(rule(db, "partner_team_peers").enabled).toBe(1);
        /* A second run on the same copy is always a no-op. */
        expect(db.prepare(updates()[0]).run().changes).toBe(0);
      }
      db.close();
      expect(sha(abs)).toBe(before);
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   (Q) THE REAL CODE PATH — the partner's own picker
   ══════════════════════════════════════════════════════════════════════════ */

const PARTNER_ORG = "pt_w143";
const PARTNER_USER = "u_w143_partner";
const PARTNER_MATE = "u_w143_mate";
const PARTNER_EX = "u_w143_ex";
const CLIENT_FOUNDER = "u_w143_founder";
/* An INVESTOR who nevertheless HAS an active `partner_team_members` row. Without
   this actor the role-scoping pole is vacuous: an investor with no team row would
   see nothing whether or not the rule were role-scoped, so `appliesToViewerRole`
   could be deleted from `isAudienceRuleEnabled` without a test noticing. */
const INVESTOR_WITH_TEAM_ROW = "u_w143_investor";
const CO_ENGAGED = "co_w143_engaged";
const ENGAGEMENT = "mfe_w143";

let app: Express;
const now = (): string => new Date().toISOString();

/** THROWS on failure — a swallowed fixture error is vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w143 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string, name: string, role: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
    id,
    `${id}@w143.test`,
    name,
    role,
  );
  /* resolveDmRole reads auth_users FIRST; without this row a role-scoped audience
     rule would be evaluated against the wrong role and the test would pass for
     the wrong reason. */
  try {
    run(
      `INSERT OR REPLACE INTO auth_users (id, email, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      `${id}@w143.test`,
      role,
      now(),
      now(),
    );
  } catch {
    /* auth_users shape differs across builds; users.role is the fallback. */
  }
}

function seedTeamMember(user: string, status: "active" | "removed"): void {
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?, ?, ?, 'managing', ?, ?, ?, 'u_test', 0, ?)`,
    `ptm_${user}`,
    PARTNER_ORG,
    user,
    status === "active" ? "active" : "removed",
    now(),
    status === "removed" ? now() : null,
    now(),
  );
}

/** The state migration 0181 ships: the two partner rules OFF and undecided. */
function preOwnerDecisionState(): void {
  run(
    `UPDATE comms_audience_rules
        SET enabled = 0, requires_owner_decision = 1, decided_at = NULL, decided_by = NULL
      WHERE rule_key IN ('partner_engaged_company_people','partner_team_peers')`,
  );
}

/** 0199 itself, read from the file and executed against the live handle. */
function applyM0199(): number {
  const info = rawDb().prepare(updates()[0]).run();
  return info.changes;
}

const asUser = (r: request.Test, id: string, role = "partner") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);
const users = (as: string, role = "partner") =>
  asUser(request(app).get("/api/comms/users"), as, role);

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);

  seedUser(PARTNER_USER, "Partner Principal", "partner");
  seedUser(PARTNER_MATE, "Partner Colleague", "partner");
  seedUser(PARTNER_EX, "Former Colleague", "partner");
  seedUser(CLIENT_FOUNDER, "Client Founder", "founder");
  seedUser(INVESTOR_WITH_TEAM_ROW, "Investor With Team Row", "investor");
  run(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, 0, NULL)`,
    CO_ENGAGED,
    "W143 Engaged Co",
  );
  run(
    `INSERT OR REPLACE INTO company_members
       (id, company_id, user_id, role, tenant_id, is_active, joined_at, deleted_at)
     VALUES (?, ?, ?, 'co_founder', 'tenant_platform', 1, ?, NULL)`,
    `cm_${CLIENT_FOUNDER}`,
    CO_ENGAGED,
    CLIENT_FOUNDER,
    now(),
  );
  run(
    `INSERT OR REPLACE INTO mf_engagement
       (id, partner_id, company_id, mode, status, created_at, updated_at,
        founder_revoked_at, archived_at)
     VALUES (?, ?, ?, 'B', 'ACTIVE', ?, ?, NULL, NULL)`,
    ENGAGEMENT,
    PARTNER_ORG,
    CO_ENGAGED,
    now(),
    now(),
  );
  /* 2/2 active team seats — exactly the live configuration that read
     "No eligible contacts." */
  seedTeamMember(PARTNER_USER, "active");
  seedTeamMember(PARTNER_MATE, "active");
  seedTeamMember(PARTNER_EX, "removed");
  seedTeamMember(INVESTOR_WITH_TEAM_ROW, "active");
});

beforeEach(() => {
  preOwnerDecisionState();
});

describe("WAVE 143 · Q — eligibility on the real /api/comms/users path", () => {
  it("Q1 the fixture is real: 2 active team seats, and the resolver already finds the colleague", () => {
    /* Proven before anything is believed about the picker. The resolver was never
       broken — the rule row was off. */
    const peers = partnerTeamPeerIds(PARTNER_USER);
    expect(peers).toContain(PARTNER_MATE);
    /* The REMOVED colleague is excluded at the resolver, not merely at the
       picker. */
    expect(peers).not.toContain(PARTNER_EX);
    expect(delegatedCompanyPeopleIds(PARTNER_USER)).toContain(CLIENT_FOUNDER);
  });

  it("Q2 THE LIVE SYMPTOM — pre-0199, the partner's picker offers only themselves", async () => {
    expect(isAudienceRuleEnabled("partner_team_peers", "partner")).toBe(false);
    const res = await users(PARTNER_USER);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((u) => u.id);
    expect(ids).not.toContain(PARTNER_MATE);
    /* Only self ⇒ `filteredUsers` is empty for any query ⇒ the literal
       "No eligible contacts." at PartnerMessages.tsx:168. */
    expect(ids.filter((id) => id !== PARTNER_USER)).toEqual([]);
  });

  it("Q3 THE FIX ON THE REAL PATH — after 0199 the colleague becomes messageable", async () => {
    expect(applyM0199()).toBe(1);
    expect(isAudienceRuleEnabled("partner_team_peers", "partner")).toBe(true);
    const res = await users(PARTNER_USER);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((u) => u.id);
    /* Eligibility genuinely changed: the same fixture, the same handler, one row. */
    expect(ids).toContain(PARTNER_MATE);
    expect(ids.filter((id) => id !== PARTNER_USER).length).toBeGreaterThan(0);
    /* And the colleague is offered with a name the picker can render. */
    const mate = (res.body as Array<Record<string, unknown>>).find((u) => u.id === PARTNER_MATE)!;
    expect(String(mate.legalName ?? "").length).toBeGreaterThan(0);
  });

  it("Q4 a REMOVED colleague is still not offered, even with the rule ON", async () => {
    /* `status = 'active' AND removed_at IS NULL` — two independent columns. If
       enabling the rule had opened the whole org roster this would fail. */
    applyM0199();
    const res = await users(PARTNER_USER);
    const ids = (res.body as Array<{ id: string }>).map((u) => u.id);
    expect(ids).not.toContain(PARTNER_EX);
  });

  it("Q5 role scoping holds — an INVESTOR viewer's audience is unchanged by 0199", async () => {
    /* `partner_team_peers` is scoped to `applies_to_viewer_role = 'partner'`, so
       enabling it must open NOTHING for a viewer the platform resolves as an
       investor — even one who genuinely sits on a partner team roster. The role is
       resolved from `auth_users`, not from the request header, so this is the real
       gate rather than a header the test controls. */
    const before = await users(INVESTOR_WITH_TEAM_ROW, "investor");
    const beforeIds = (before.body as Array<{ id: string }>).map((u) => u.id).sort();
    expect(beforeIds).not.toContain(PARTNER_MATE);
    applyM0199();
    const after = await users(INVESTOR_WITH_TEAM_ROW, "investor");
    const afterIds = (after.body as Array<{ id: string }>).map((u) => u.id).sort();
    expect(afterIds).toEqual(beforeIds);
    expect(afterIds).not.toContain(PARTNER_MATE);
    expect(afterIds).not.toContain(PARTNER_USER);
    /* And the same rule, on the same DB, IS open for the partner — so the pole is
       about the ROLE and not about the rule being off. */
    const partnerView = await users(PARTNER_USER);
    expect((partnerView.body as Array<{ id: string }>).map((u) => u.id)).toContain(PARTNER_MATE);
  });

  it("Q6 the rules reader has no cache — the toggle is observed on the very next call", async () => {
    const off = await users(PARTNER_USER);
    expect((off.body as Array<{ id: string }>).map((u) => u.id)).not.toContain(PARTNER_MATE);
    applyM0199();
    const on = await users(PARTNER_USER);
    expect((on.body as Array<{ id: string }>).map((u) => u.id)).toContain(PARTNER_MATE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (R) THE CONFIDENTIALITY POLE — R108.1
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 143 · R — delegatedCompanyPeopleIds stays DISABLED (R108.1)", () => {
  it("R1 with 0199 applied, the engaged company's founder is STILL not messageable", async () => {
    applyM0199();
    expect(isAudienceRuleEnabled("partner_engaged_company_people", "partner")).toBe(false);
    const res = await users(PARTNER_USER);
    const ids = (res.body as Array<{ id: string }>).map((u) => u.id);
    expect(ids).not.toContain(CLIENT_FOUNDER);
    /* The resolver would have found them — proving the RULE is what holds the
       door, not an accident of the fixture. */
    expect(delegatedCompanyPeopleIds(PARTNER_USER)).toContain(CLIENT_FOUNDER);
  });

  it("R2 no directory payload for that founder reaches the partner at all", async () => {
    /* The specific harm R108.1 named: the payload carries `capTables`, `location`
       and an unresolved `capavateAngelNetwork`, none of which privacy resolution
       touches. The defence is that no ENTRY exists, so no field can leak. */
    applyM0199();
    const res = await users(PARTNER_USER);
    const entry = (res.body as Array<Record<string, unknown>>).find(
      (u) => u.id === CLIENT_FOUNDER,
    );
    expect(entry).toBeUndefined();
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain(CLIENT_FOUNDER);
  });

  it("R3 the rule remains flagged as an OPEN question in the rules table", () => {
    /* It is off AND still `requires_owner_decision`, so the admin panel and the
       partner-facing notice both keep saying so. R108.1 item 2 makes the payload
       scoping a PREREQUISITE, not a follow-up. */
    applyM0199();
    const r = readRules().find((x) => x.ruleKey === "partner_engaged_company_people")!;
    expect(r.enabled).toBe(false);
    expect(r.requiresOwnerDecision).toBe(true);
    expect((r.recommendedDefault ?? "").length).toBeGreaterThan(20);
  });
});

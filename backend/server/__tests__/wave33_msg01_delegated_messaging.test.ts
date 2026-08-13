/**
 * server/__tests__/wave33_msg01_delegated_messaging.test.ts
 *
 * WAVE 33 · CP-MSG-01 — partner messaging with delegated context.
 *
 * WHAT WAS WRONG, PRECISELY
 *   1. `GET /api/comms/users` derived its candidate pool from four peer sources
 *      written into the handler as code: channel co-participants, cap-table
 *      peers, chapter peers, follow peers. A Consortium Partner team member is
 *      in none of them, so the partner picker was empty — and so is an
 *      investor's or founder's the moment they have no cap table and no
 *      chapter. One SHARED PLATFORM rule, three surfaces.
 *   2. A partner acting under an ACTIVE `mf_engagement` wrote as themselves.
 *      Nothing on the record said which client company they were acting for.
 *
 *   (1) is a COMMERCIAL question — who may message whom — and this build does
 *   NOT answer it. The rules became DATA (`comms_audience_rules`), the two
 *   partner rules ship DISABLED and flagged `requires_owner_decision`, and the
 *   UI states the open question. (2) is plumbing, and is built.
 *
 * ANTI-VACUITY METHOD
 *   Every rule assertion asserts BOTH POLES against the SAME fixture: the rule
 *   off → the peer is absent; the rule on → the same peer is present. A test
 *   that only ever saw an empty list would pass identically against the broken
 *   build, which is exactly the failure mode this wave keeps finding.
 *   Group F proves the fixtures are real before any of that is believed, and
 *   F5 is the sanity pole: an unrelated stranger is never offered to anyone.
 *
 *   Assertions are on EMITTED values — response bodies, projected keys, rows
 *   actually in SQLite — never on source text.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { registerCommsRoutes } from "../commsStore";
import {
  readRules,
  isAudienceRuleEnabled,
  pendingOwnerDecisions,
  setAudienceRuleEnabled,
  AUDIENCE_RULE_KEYS,
} from "../lib/commsAudienceRules";
import {
  resolveDelegatedContext,
  resolvePartnerIdForUser,
  liveEngagementsForPartner,
  engagementFor,
  delegatedCompanyPeopleIds,
  partnerTeamPeerIds,
  stampDelegatedContext,
  readDelegatedContext,
} from "../lib/partnerDelegatedContext";
import { applyCommsDelegatedContextSchema } from "../lib/applyCommsDelegatedContextSchema";
import {
  durableCapTablePeerIds,
  listDurableCommsUserIds,
} from "../lib/commsUserDirectory";

/* ------------------------------------------------------------------ actors */

const PARTNER_ORG = "pt_w33msg";
const PARTNER_USER = "u_w33msg_partner"; // ACTIVE partner_team_members row
const PARTNER_MATE = "u_w33msg_mate"; // same partner org, ACTIVE
const PARTNER_EX = "u_w33msg_ex"; // same org, REMOVED
const CLIENT_FOUNDER = "u_w33msg_founder"; // active member of the engaged company
const OTHER_FOUNDER = "u_w33msg_other"; // member of a company with NO engagement
const STRANGER = "u_w33msg_stranger"; // related to nothing
/* Mutation-run closures (see wave33_msg01_mutants.py M9/M10/M15/M19). Each of
   these actors exists to make one silent-drop mutant OBSERVABLE — without them
   the assertions above are true for the wrong reason. */
const FORMER_MEMBER = "u_w33msg_former"; // company_members row with is_active = 0
const CAP_PEER = "u_w33msg_cappeer"; // committed on the same cap table as CAP_SELF
const CAP_SELF = "u_w33msg_capself"; // the viewer for the cap-table-peer pole
/* `requireAdmin` resolves identity through `getUserContext`, which reads the
   PERSONA registry (and a durable credential fallback), NOT the test harness's
   injected `req.userContext`. A freshly seeded `users` row therefore does not
   authenticate — the first draft of R1/R3 asserted 200/404 and got 401 twice,
   which is the guard working. The platform's own admin persona is used instead,
   so the case exercises the real middleware rather than a bypass. */
const ADMIN = "u_admin";

const CO_ENGAGED = "co_w33msg_engaged";
const CO_UNENGAGED = "co_w33msg_unengaged";
const ENGAGEMENT = "mfe_w33msg";

let app: Express;

const now = (): string => new Date().toISOString();

/** THROWS on failure — a swallowed fixture error is vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w33msg fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};
const get = (sql: string, ...args: unknown[]): any => rawDb().prepare(sql).get(...(args as any[]));

function seedUser(id: string, name: string, role: "founder" | "investor" | "partner" | "admin"): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
    id,
    `${id}@w33msg.test`,
    name,
    role,
  );
  /* messagingPolicy.resolveDmRole reads auth_users FIRST. Without this row a
     partner resolves as whatever `users.role` says, and a role-scoped audience
     rule would then be evaluated against the wrong role — the test would pass
     for the wrong reason. */
  try {
    run(
      `INSERT OR REPLACE INTO auth_users (id, email, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      `${id}@w33msg.test`,
      role,
      now(),
      now(),
    );
  } catch {
    /* auth_users shape differs across builds; users.role is the fallback. */
  }
}

function seedCompany(id: string, name: string): void {
  run(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, 0, NULL)`,
    id,
    name,
  );
}

function seedMember(user: string, companyId: string, isActive = true): void {
  run(
    `INSERT OR REPLACE INTO company_members
       (id, company_id, user_id, role, tenant_id, is_active, joined_at, deleted_at)
     VALUES (?, ?, ?, 'founder', 'tenant_platform', ?, ?, NULL)`,
    `cm_${user}_${companyId}`,
    companyId,
    user,
    isActive ? 1 : 0,
    now(),
  );
}

/** A COMMITTED cap-table row. `state` and `deleted_at` are what
 *  `durableCapTablePeerIds` filters on, so both are set explicitly. */
function seedCommit(id: string, companyId: string, investorId: string, seq: number): void {
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, reconcile_match,
        compliance_hold, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '1000', 'USD', '10',
             'committed', 'h0', ?, 1, 0, NULL)`,
    id,
    seq,
    now(),
    `inv_${id}`,
    `rd_${companyId}`,
    companyId,
    investorId,
    `h_${id}`,
  );
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

function seedEngagement(
  opts: { status?: string; revoked?: boolean; archived?: boolean; companyId?: string } = {},
): void {
  run(
    `INSERT OR REPLACE INTO mf_engagement
       (id, partner_id, company_id, mode, status, created_at, updated_at,
        founder_revoked_at, archived_at)
     VALUES (?, ?, ?, 'B', ?, ?, ?, ?, ?)`,
    ENGAGEMENT,
    PARTNER_ORG,
    opts.companyId ?? CO_ENGAGED,
    opts.status ?? "ACTIVE",
    now(),
    now(),
    opts.revoked ? now() : null,
    opts.archived ? now() : null,
  );
}

/** Restore every rule to its shipped seed state. */
function resetRules(): void {
  run(
    `UPDATE comms_audience_rules SET enabled = 1, requires_owner_decision = 0,
        decided_at = NULL, decided_by = NULL
      WHERE rule_key IN ('channel_participant','cap_table_peer','chapter_peer','follow_peer')`,
  );
  run(
    `UPDATE comms_audience_rules SET enabled = 0, requires_owner_decision = 1,
        decided_at = NULL, decided_by = NULL
      WHERE rule_key IN ('partner_engaged_company_people','partner_team_peers')`,
  );
}

const asUser = (r: request.Test, id: string, role = "investor") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);

const users = (as: string, role = "partner") =>
  asUser(request(app).get("/api/comms/users"), as, role);

const policy = (as: string, role = "partner") =>
  asUser(request(app).get("/api/comms/audience-policy"), as, role);

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
  seedUser(OTHER_FOUNDER, "Unrelated Founder", "founder");
  seedUser(STRANGER, "Stranger", "investor");
  seedCompany(CO_ENGAGED, "W33 Engaged Co");
  seedCompany(CO_UNENGAGED, "W33 Unengaged Co");
  seedUser(FORMER_MEMBER, "Former Member", "founder");
  seedUser(CAP_SELF, "Cap Table Self", "investor");
  seedUser(CAP_PEER, "Cap Table Peer", "investor");
  seedMember(CLIENT_FOUNDER, CO_ENGAGED);
  seedMember(OTHER_FOUNDER, CO_UNENGAGED);
  /* An INACTIVE member of the very company the partner is engaged for. Without
     this row `delegatedCompanyPeopleIds` has no negative case at all and its
     `is_active = 1` filter can be deleted without a test noticing. */
  seedMember(FORMER_MEMBER, CO_ENGAGED, false);
  /* Two committed holders on the SAME company — the cap-table peer source.
     CO_UNENGAGED is used deliberately: it has no engagement, so this pole
     cannot be satisfied by the partner rules under test elsewhere. */
  seedCommit("cc_w33msg_self", CO_UNENGAGED, CAP_SELF, 9001);
  seedCommit("cc_w33msg_peer", CO_UNENGAGED, CAP_PEER, 9002);
  seedTeamMember(PARTNER_USER, "active");
  seedTeamMember(PARTNER_MATE, "active");
  seedTeamMember(PARTNER_EX, "removed");
  seedEngagement();
});

beforeEach(() => {
  resetRules();
  seedEngagement();
  run(`DELETE FROM comms_delegated_context WHERE ref_id LIKE 'w33msg%'`);
});

/* ══════════════════════════════════════════════════════════════════════════
   (F) THE FIXTURES ARE REAL
   ══════════════════════════════════════════════════════════════════════════ */

describe("(F) preconditions", () => {
  it("F1 migration 0181's two tables exist and the six rules are seeded", () => {
    for (const t of ["comms_audience_rules", "comms_delegated_context"]) {
      expect(get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, t)?.name).toBe(t);
    }
    const keys = readRules().map((r) => r.ruleKey).sort();
    expect(keys).toEqual([...AUDIENCE_RULE_KEYS].sort());
  });

  it("F2 the four PRE-EXISTING sources ship ENABLED — installing 0181 drops nothing", () => {
    for (const k of ["channel_participant", "cap_table_peer", "chapter_peer", "follow_peer"]) {
      const r = readRules().find((x) => x.ruleKey === k)!;
      expect({ key: k, enabled: r.enabled, pending: r.requiresOwnerDecision }).toEqual({
        key: k,
        enabled: true,
        pending: false,
      });
    }
  });

  it("F3 the two PARTNER rules ship DISABLED and flagged for an owner decision", () => {
    for (const k of ["partner_engaged_company_people", "partner_team_peers"]) {
      const r = readRules().find((x) => x.ruleKey === k)!;
      expect({ key: k, enabled: r.enabled, pending: r.requiresOwnerDecision }).toEqual({
        key: k,
        enabled: false,
        pending: true,
      });
      // A recommendation was recorded — the question is put, not merely noted.
      expect((r.recommendedDefault ?? "").length).toBeGreaterThan(20);
    }
  });

  it("F4 the partner, the team and the engagement resolve from durable rows", () => {
    expect(resolvePartnerIdForUser(PARTNER_USER)).toBe(PARTNER_ORG);
    expect(liveEngagementsForPartner(PARTNER_ORG).map((e) => e.companyId)).toEqual([CO_ENGAGED]);
    expect(engagementFor(PARTNER_USER, CO_ENGAGED)?.engagementId).toBe(ENGAGEMENT);
    expect(delegatedCompanyPeopleIds(PARTNER_USER)).toContain(CLIENT_FOUNDER);
    expect(partnerTeamPeerIds(PARTNER_USER)).toEqual([PARTNER_MATE]); // NOT the removed one
  });

  it("F6 a REMOVED team member is not a principal — at the resolver AND at the picker", async () => {
    /* Closes M15. PARTNER_EX existed only as an object other people must not
       see (A3). Nothing ever asked what the platform thinks PARTNER_EX IS, so
       `AND status = 'active' AND removed_at IS NULL` could be deleted from
       `resolvePartnerIdForUser` and a person removed from a partner firm would
       keep acting as that firm's principal — with no test failing. */
    expect(resolvePartnerIdForUser(PARTNER_EX)).toBeNull();
    expect(resolveDelegatedContext(PARTNER_EX)).toBeNull();
    expect(partnerTeamPeerIds(PARTNER_EX)).toEqual([]);
    expect(delegatedCompanyPeopleIds(PARTNER_EX)).toEqual([]);
    expect(engagementFor(PARTNER_EX, CO_ENGAGED)).toBeNull();
    // They cannot stamp a delegation either — the write sink, not just the read.
    expect(stampDelegatedContext("message", "w33msg_ex1", PARTNER_EX, CO_ENGAGED)).toBeNull();

    /* Both partner rules ON — the most permissive state the owner could rule —
       and a removed colleague is still offered nobody. */
    setAudienceRuleEnabled("partner_engaged_company_people", true, "u_owner");
    setAudienceRuleEnabled("partner_team_peers", true, "u_owner");
    const res = await users(PARTNER_EX);
    expect(res.status).toBe(200);
    const ids = res.body.map((u: any) => u.id);
    expect(ids).not.toContain(CLIENT_FOUNDER);
    expect(ids).not.toContain(PARTNER_MATE);
    expect(ids).not.toContain(PARTNER_USER);
  });

  it("F7 a FORMER company member is not delegated audience — both poles on one company", async () => {
    /* Closes M19. Every seeded `company_members` row was `is_active = 1`, so
       `AND is_active = 1` could be deleted from `delegatedCompanyPeopleIds` and
       a departed employee of the client company would be offered to the partner
       as a current contact. */
    const people = delegatedCompanyPeopleIds(PARTNER_USER);
    expect(people).toContain(CLIENT_FOUNDER); // the active pole
    expect(people).not.toContain(FORMER_MEMBER); // the inactive pole, same company

    setAudienceRuleEnabled("partner_engaged_company_people", true, "u_owner");
    const res = await users(PARTNER_USER);
    const ids = res.body.map((u: any) => u.id);
    expect(ids).toContain(CLIENT_FOUNDER);
    expect(ids).not.toContain(FORMER_MEMBER);
  });

  it("F5 SANITY POLE — a stranger is not a partner, holds nothing, is offered nothing", async () => {
    expect(resolveDelegatedContext(STRANGER)).toBeNull();
    expect(partnerTeamPeerIds(STRANGER)).toEqual([]);
    expect(delegatedCompanyPeopleIds(STRANGER)).toEqual([]);
    const res = await users(STRANGER, "investor");
    expect(res.status).toBe(200);
    expect(res.body.map((u: any) => u.id)).not.toContain(CLIENT_FOUNDER);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (A) THE AUDIENCE IS DATA — both poles, same fixture
   ══════════════════════════════════════════════════════════════════════════ */

describe("(A) the audience rules drive the picker", () => {
  it("A1 the partner rule OFF (shipped state) → the client founder is NOT offered", async () => {
    const res = await users(PARTNER_USER);
    expect(res.status).toBe(200);
    expect(res.body.map((u: any) => u.id)).not.toContain(CLIENT_FOUNDER);
  });

  it("A2 the SAME fixture with the rule ON → the client founder IS offered", async () => {
    setAudienceRuleEnabled("partner_engaged_company_people", true, "u_owner");
    const res = await users(PARTNER_USER);
    expect(res.status).toBe(200);
    expect(res.body.map((u: any) => u.id)).toContain(CLIENT_FOUNDER);
    /* Still scoped: a founder at a company with NO engagement never appears. */
    expect(res.body.map((u: any) => u.id)).not.toContain(OTHER_FOUNDER);
  });

  it("A3 team peers, both poles — and a REMOVED colleague never appears at either", async () => {
    const off = await users(PARTNER_USER);
    expect(off.body.map((u: any) => u.id)).not.toContain(PARTNER_MATE);
    setAudienceRuleEnabled("partner_team_peers", true, "u_owner");
    const on = await users(PARTNER_USER);
    expect(on.body.map((u: any) => u.id)).toContain(PARTNER_MATE);
    expect(on.body.map((u: any) => u.id)).not.toContain(PARTNER_EX);
  });

  it("A4 the engagement is the scope: revoking it removes the audience with the rule still ON", async () => {
    setAudienceRuleEnabled("partner_engaged_company_people", true, "u_owner");
    expect((await users(PARTNER_USER)).body.map((u: any) => u.id)).toContain(CLIENT_FOUNDER);
    seedEngagement({ revoked: true });
    expect((await users(PARTNER_USER)).body.map((u: any) => u.id)).not.toContain(CLIENT_FOUNDER);
    seedEngagement({ status: "TERMINATED" });
    expect((await users(PARTNER_USER)).body.map((u: any) => u.id)).not.toContain(CLIENT_FOUNDER);
    seedEngagement({ archived: true });
    expect((await users(PARTNER_USER)).body.map((u: any) => u.id)).not.toContain(CLIENT_FOUNDER);
  });

  it("A5 a LEGACY source is switchable too — and switching it off is the owner's, not the code's", () => {
    expect(isAudienceRuleEnabled("cap_table_peer")).toBe(true);
    run(`UPDATE comms_audience_rules SET enabled = 0 WHERE rule_key = 'cap_table_peer'`);
    expect(isAudienceRuleEnabled("cap_table_peer")).toBe(false);
    resetRules();
    expect(isAudienceRuleEnabled("cap_table_peer")).toBe(true);
  });

  it("A8 the CAP-TABLE source, both poles — the pre-existing audience is not merely assumed present", async () => {
    /* Closes M9. Before this case nothing on the platform had a cap-table peer
       in the fixture, so `if (isAudienceRuleEnabled("cap_table_peer", ...))`
       could be replaced with `if (false)` — dropping a source that shipped long
       before this item — and every test stayed green. That is the exact silent
       functionality drop the rules table was introduced to make impossible. */
    expect(durableCapTablePeerIds(CAP_SELF)).toContain(CAP_PEER);

    const on = await users(CAP_SELF, "investor");
    expect(on.status).toBe(200);
    expect(on.body.map((u: any) => u.id)).toContain(CAP_PEER);

    run(`UPDATE comms_audience_rules SET enabled = 0 WHERE rule_key = 'cap_table_peer'`);
    const off = await users(CAP_SELF, "investor");
    expect(off.body.map((u: any) => u.id)).not.toContain(CAP_PEER);
    resetRules();
    const back = await users(CAP_SELF, "investor");
    expect(back.body.map((u: any) => u.id)).toContain(CAP_PEER);
  });

  it("A9 an EMPTIED rules table does not empty the picker — the reader heals it back", async () => {
    /* The dangerous shape: `DELETE FROM comms_audience_rules` (a bad migration,
       a truncate, a restore from a partial dump) leaving every source off and
       every picker on the platform empty, with no error anywhere.

       `readRules()` heals the schema BEFORE it reads, so an empty table is
       re-seeded rather than falling through to `legacyFallback()`. This case
       pins that healing path by execution — it is the reason mutant M4
       (deleting the `rows.length === 0` guard) is equivalent rather than a gap,
       and without this assertion that claim would be unverified. */
    run(`DELETE FROM comms_audience_rules`);
    const healed = readRules();
    expect(healed.length).toBe(AUDIENCE_RULE_KEYS.length);
    for (const k of ["channel_participant", "cap_table_peer", "chapter_peer", "follow_peer"]) {
      expect({ k, on: healed.find((r) => r.ruleKey === k)?.enabled }).toEqual({ k, on: true });
    }
    // And the emitted picker is not empty either.
    const res = await users(CAP_SELF, "investor");
    expect(res.body.map((u: any) => u.id)).toContain(CAP_PEER);
    resetRules();
  });

  it("A10 a partner peer OUTSIDE the durable candidate window is still offered", async () => {
    /* Closes M10. `candidateIds` is seeded from `listDurableCommsUserIds(500)`,
       which is CAPPED and ordered by id ASC. On a platform with more than 500
       users a partner's own colleague can fall outside that window entirely, so
       adding them to `peers` alone is not enough — they must also be added to
       `candidateIds`, or the enabled rule yields nothing.

       The fixture makes that real rather than hypothetical: 520 users whose ids
       sort BEFORE the colleague's fill the window, and the assertion is that the
       colleague is emitted anyway. Dropping `candidateIds.add(p)` fails here and
       nowhere else. */
    const FLOOD = 520;
    try {
      for (let i = 0; i < FLOOD; i += 1) {
        seedUser(`u_a_w33flood_${String(i).padStart(4, "0")}`, `Flood ${i}`, "investor");
      }
      const window = listDurableCommsUserIds(500);
      expect(window.length).toBe(500);
      // The precondition this case depends on, asserted rather than assumed.
      expect(window).not.toContain(PARTNER_MATE);

      setAudienceRuleEnabled("partner_team_peers", true, "u_owner");
      const res = await users(PARTNER_USER);
      expect(res.status).toBe(200);
      expect(res.body.map((u: any) => u.id)).toContain(PARTNER_MATE);
    } finally {
      run(`DELETE FROM users WHERE id LIKE 'u_a_w33flood_%'`);
      try {
        run(`DELETE FROM auth_users WHERE id LIKE 'u_a_w33flood_%'`);
      } catch {
        /* auth_users shape differs across builds; the users cleanup is what matters. */
      }
    }
  });

  it("A6 a rule the DATABASE has never heard of is OFF, not implicitly on", () => {
    expect(isAudienceRuleEnabled("rule_that_does_not_exist")).toBe(false);
  });

  it("A7 role scoping: a partner-scoped rule does not open an audience for an investor", () => {
    setAudienceRuleEnabled("partner_team_peers", true, "u_owner");
    expect(isAudienceRuleEnabled("partner_team_peers", "partner")).toBe(true);
    expect(isAudienceRuleEnabled("partner_team_peers", "investor")).toBe(false);
    expect(isAudienceRuleEnabled("partner_team_peers", "founder")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (P) THE POLICY IS STATED, NOT INFERRED FROM AN EMPTY LIST
   ══════════════════════════════════════════════════════════════════════════ */

describe("(P) the audience-policy endpoint", () => {
  it("P1 a partner is TOLD the two rules are awaiting an owner decision", async () => {
    const res = await policy(PARTNER_USER);
    expect(res.status).toBe(200);
    const pending = res.body.pendingOwnerDecision.map((r: any) => r.ruleKey).sort();
    expect(pending).toEqual(["partner_engaged_company_people", "partner_team_peers"]);
    for (const r of res.body.pendingOwnerDecision) {
      expect(typeof r.recommendedDefault).toBe("string");
      expect(r.recommendedDefault).toContain("RECOMMENDED");
    }
  });

  it("P2 the same endpoint reports the viewer's live delegated context", async () => {
    const res = await policy(PARTNER_USER);
    expect(res.body.delegatedContext?.partnerId).toBe(PARTNER_ORG);
    expect(res.body.delegatedContext?.engagements.map((e: any) => e.companyId)).toEqual([CO_ENGAGED]);
    /* partner_organizations is EMPTY on every DB inspected in Wave 33 (OQ-33-3),
       so the name is NULL and the UI renders a stated fallback. It is never
       invented server-side. */
    expect(res.body.delegatedContext?.partnerName).toBeNull();
  });

  it("P3 POLE — a non-partner gets `delegatedContext: null`, never an empty object", async () => {
    const res = await policy(STRANGER, "investor");
    expect(res.status).toBe(200);
    expect(res.body.delegatedContext).toBeNull();
  });

  it("P4 an unauthenticated caller gets 401 and no policy at all", async () => {
    const res = await request(app).get("/api/comms/audience-policy");
    expect(res.status).toBe(401);
    expect(res.body.rules).toBeUndefined();
  });

  it("P5 once the owner rules, the surface STOPS saying the question is open", async () => {
    setAudienceRuleEnabled("partner_engaged_company_people", true, "u_owner");
    const res = await policy(PARTNER_USER);
    const pending = res.body.pendingOwnerDecision.map((r: any) => r.ruleKey);
    expect(pending).not.toContain("partner_engaged_company_people");
    expect(pending).toContain("partner_team_peers"); // the other is still open
    const row = get(
      `SELECT enabled, requires_owner_decision, decided_by FROM comms_audience_rules WHERE rule_key = ?`,
      "partner_engaged_company_people",
    );
    expect({ e: row.enabled, p: row.requires_owner_decision, by: row.decided_by }).toEqual({
      e: 1,
      p: 0,
      by: "u_owner",
    });
  });

  it("P6 pendingOwnerDecisions() is role-filtered", () => {
    expect(pendingOwnerDecisions("partner").length).toBe(2);
    expect(pendingOwnerDecisions("investor").length).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (R) THE ADMIN DECISION ROUTE — "no code change" made good
   ══════════════════════════════════════════════════════════════════════════ */

describe("(R) the owner decision route", () => {
  it("R1 an admin enables a rule over HTTP and the picker changes on the NEXT request", async () => {
    expect((await users(PARTNER_USER)).body.map((u: any) => u.id)).not.toContain(CLIENT_FOUNDER);
    const res = await asUser(
      request(app)
        .post("/api/comms/audience-rules/partner_engaged_company_people")
        .send({ enabled: true }),
      ADMIN,
      "admin",
    );
    expect(res.status).toBe(200);
    expect(res.body.rule.enabled).toBe(true);
    expect((await users(PARTNER_USER)).body.map((u: any) => u.id)).toContain(CLIENT_FOUNDER);
  });

  it("R2 a NON-admin cannot decide the platform's messaging policy", async () => {
    const res = await asUser(
      request(app)
        .post("/api/comms/audience-rules/partner_team_peers")
        .send({ enabled: true }),
      PARTNER_USER,
      "partner",
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(500);
    expect(
      get(`SELECT enabled FROM comms_audience_rules WHERE rule_key='partner_team_peers'`).enabled,
    ).toBe(0);
  });

  it("R3 an unknown rule key is a 404, and a missing `enabled` is a 400", async () => {
    const unknown = await asUser(
      request(app).post("/api/comms/audience-rules/not_a_rule").send({ enabled: true }),
      ADMIN,
      "admin",
    );
    expect(unknown.status).toBe(404);
    const bad = await asUser(
      request(app).post("/api/comms/audience-rules/partner_team_peers").send({}),
      ADMIN,
      "admin",
    );
    expect(bad.status).toBe(400);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (D) THE DELEGATED-CONTEXT STAMP
   ══════════════════════════════════════════════════════════════════════════ */

describe("(D) the delegated stamp is written only when the authority is provable", () => {
  it("D1 a partner with a live engagement stamps, and the row is in SQLite", () => {
    const stamp = stampDelegatedContext("message", "w33msg_m1", PARTNER_USER, CO_ENGAGED);
    expect(stamp?.partnerId).toBe(PARTNER_ORG);
    expect(stamp?.engagementId).toBe(ENGAGEMENT);
    const row = get(`SELECT * FROM comms_delegated_context WHERE ref_id = 'w33msg_m1'`);
    expect(row.company_id).toBe(CO_ENGAGED);
    expect(row.acting_user_id).toBe(PARTNER_USER);
  });

  it("D2 POLES — non-partner, unengaged company, revoked, terminated and blank all write NOTHING", () => {
    expect(stampDelegatedContext("message", "w33msg_m2", STRANGER, CO_ENGAGED)).toBeNull();
    expect(stampDelegatedContext("message", "w33msg_m3", PARTNER_USER, CO_UNENGAGED)).toBeNull();
    expect(stampDelegatedContext("message", "w33msg_m4", PARTNER_USER, "")).toBeNull();
    expect(stampDelegatedContext("message", "", PARTNER_USER, CO_ENGAGED)).toBeNull();
    seedEngagement({ revoked: true });
    expect(stampDelegatedContext("message", "w33msg_m5", PARTNER_USER, CO_ENGAGED)).toBeNull();
    seedEngagement({ status: "TERMINATED" });
    expect(stampDelegatedContext("message", "w33msg_m6", PARTNER_USER, CO_ENGAGED)).toBeNull();
    const n = get(`SELECT COUNT(*) AS n FROM comms_delegated_context WHERE ref_id LIKE 'w33msg_m%'`).n;
    expect(n).toBe(0);
  });

  it("D3 the stamp is HISTORICAL — a later revocation does not rewrite it", () => {
    stampDelegatedContext("message", "w33msg_hist", PARTNER_USER, CO_ENGAGED);
    seedEngagement({ revoked: true });
    const read = readDelegatedContext("message", "w33msg_hist");
    expect(read?.engagementId).toBe(ENGAGEMENT);
    expect(read?.companyId).toBe(CO_ENGAGED);
  });

  it("D4 one stamp per (scope, ref) — a re-stamp keeps the FIRST", () => {
    stampDelegatedContext("channel", "w33msg_ch", PARTNER_USER, CO_ENGAGED);
    stampDelegatedContext("channel", "w33msg_ch", PARTNER_MATE, CO_ENGAGED);
    const rows = rawDb()
      .prepare(`SELECT acting_user_id FROM comms_delegated_context WHERE ref_id = 'w33msg_ch'`)
      .all() as Array<{ acting_user_id: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].acting_user_id).toBe(PARTNER_USER);
  });

  it("D6 the INNER control that makes the partner-id lookup redundant is itself pinned", () => {
    /* Mutant M14 replaces `resolvePartnerIdForUser(userId) ?? null` with a
       fabricated `'pt_unknown'` in `stampDelegatedContext`, and survives — not
       because nothing checks, but because `engagementFor` independently
       re-resolves the partner and returns null for a non-partner. That makes
       M14 an EQUIVALENT mutant. The claim is only safe while the inner check
       is itself under test, so it is asserted directly here: remove it and
       this case fails even though the outer guard is intact. */
    expect(engagementFor(STRANGER, CO_ENGAGED)).toBeNull();
    expect(engagementFor(CLIENT_FOUNDER, CO_ENGAGED)).toBeNull(); // a member is not a partner
    expect(engagementFor(PARTNER_USER, CO_ENGAGED)?.engagementId).toBe(ENGAGEMENT);
  });

  it("D5 scopes are independent: a channel stamp is not a message stamp", () => {
    stampDelegatedContext("channel", "w33msg_scope", PARTNER_USER, CO_ENGAGED);
    expect(readDelegatedContext("channel", "w33msg_scope")).not.toBeNull();
    expect(readDelegatedContext("message", "w33msg_scope")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (S) THE TWO WRITE SINKS, EXECUTED OVER HTTP
   ══════════════════════════════════════════════════════════════════════════ */

describe("(S) the message and channel sinks", () => {
  async function openDm(onBehalfOf?: string) {
    return asUser(
      request(app)
        .post("/api/comms/dm/start")
        .send({ targetUserId: CLIENT_FOUNDER, ...(onBehalfOf ? { onBehalfOfCompanyId: onBehalfOf } : {}) }),
      PARTNER_USER,
      "partner",
    );
  }

  it("S1 SINK 2 — opening a DM on a client's behalf stamps the CHANNEL", async () => {
    const res = await openDm(CO_ENGAGED);
    expect(res.status).toBe(200);
    const channelId = res.body.channelId as string;
    expect(readDelegatedContext("channel", channelId)?.companyId).toBe(CO_ENGAGED);
    expect(res.body.channel.delegatedContext?.engagementId).toBe(ENGAGEMENT);
  });

  it("S2 POLE — an UNPROVABLE claim is REFUSED (422), never downgraded to a personal DM", async () => {
    const res = await openDm(CO_UNENGAGED);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("delegated_authority_not_provable");
    const anyStamp = get(
      `SELECT COUNT(*) AS n FROM comms_delegated_context WHERE company_id = ?`,
      CO_UNENGAGED,
    ).n;
    expect(anyStamp).toBe(0);
  });

  it("S3 SINK 1 — a message sent on a client's behalf is stamped and PROJECTED as such", async () => {
    const dm = await openDm();
    const channelId = dm.body.channelId as string;
    const res = await asUser(
      request(app)
        .post(`/api/comms/channels/${channelId}/messages`)
        .send({ body: "Following up on the term sheet.", onBehalfOfCompanyId: CO_ENGAGED }),
      PARTNER_USER,
      "partner",
    );
    expect(res.status).toBe(200);
    expect(res.body.delegatedContext).toMatchObject({
      partnerId: PARTNER_ORG,
      companyId: CO_ENGAGED,
      engagementId: ENGAGEMENT,
      actingUserId: PARTNER_USER,
    });
    /* The stamp is durable, not a response-shaped nicety. */
    expect(readDelegatedContext("message", res.body.id)?.companyId).toBe(CO_ENGAGED);
  });

  it("S4 POLE — a message with NO claim carries no delegatedContext key at all", async () => {
    const dm = await openDm();
    const res = await asUser(
      request(app)
        .post(`/api/comms/channels/${dm.body.channelId}/messages`)
        .send({ body: "Personal note." }),
      PARTNER_USER,
      "partner",
    );
    expect(res.status).toBe(200);
    expect(res.body.delegatedContext).toBeUndefined();
    expect(readDelegatedContext("message", res.body.id)).toBeNull();
  });

  it("S5 POLE — an unprovable claim on the MESSAGE sink is 422 and writes no message", async () => {
    const dm = await openDm();
    const before = get(`SELECT COUNT(*) AS n FROM comms_messages WHERE channel_id = ?`, dm.body.channelId).n;
    const res = await asUser(
      request(app)
        .post(`/api/comms/channels/${dm.body.channelId}/messages`)
        .send({ body: "Should never land.", onBehalfOfCompanyId: CO_UNENGAGED }),
      PARTNER_USER,
      "partner",
    );
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("delegated_authority_not_provable");
    const after = get(`SELECT COUNT(*) AS n FROM comms_messages WHERE channel_id = ?`, dm.body.channelId).n;
    expect(after).toBe(before);
  });

  it("S6 a NON-partner cannot claim delegation at all — the same 422, not a silent pass", async () => {
    const dm = await asUser(
      request(app).post("/api/comms/dm/start").send({ targetUserId: PARTNER_USER }),
      CLIENT_FOUNDER,
      "founder",
    );
    const res = await asUser(
      request(app)
        .post(`/api/comms/channels/${dm.body.channelId}/messages`)
        .send({ body: "I represent them.", onBehalfOfCompanyId: CO_ENGAGED }),
      CLIENT_FOUNDER,
      "founder",
    );
    expect(res.status).toBe(422);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (X) THE INSTALLER — A-22, both directions
   ══════════════════════════════════════════════════════════════════════════ */

describe("(X) schema self-heal", () => {
  it("X1 the installer is idempotent and does not duplicate or reset rules", () => {
    setAudienceRuleEnabled("partner_team_peers", true, "u_owner");
    applyCommsDelegatedContextSchema(rawDb() as any);
    applyCommsDelegatedContextSchema(rawDb() as any);
    expect(readRules().length).toBe(AUDIENCE_RULE_KEYS.length);
    /* An owner decision SURVIVES a heal — an installer that re-seeded over the
       owner's ruling would silently un-decide the platform's policy. */
    expect(readRules().find((r) => r.ruleKey === "partner_team_peers")!.enabled).toBe(true);
  });

  it("X2 a HALF-healed database (table present, rules missing) is re-seeded, not left ruleless", () => {
    /* The dangerous state: the table exists, so a table-existence probe returns
       early and every user's picker is empty forever. Proved on a scratch DB so
       the shared test database is untouched. */
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE comms_audience_rules (
               rule_key TEXT PRIMARY KEY NOT NULL,
               applies_to_viewer_role TEXT NOT NULL DEFAULT 'any',
               enabled INTEGER NOT NULL DEFAULT 0,
               requires_owner_decision INTEGER NOT NULL DEFAULT 0,
               description TEXT NOT NULL DEFAULT '',
               recommended_default TEXT,
               decided_at TEXT, decided_by TEXT,
               created_at TEXT NOT NULL DEFAULT (datetime('now')),
               updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM comms_audience_rules`).get().n).toBe(0);
    applyCommsDelegatedContextSchema(db as any);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM comms_audience_rules`).get().n).toBe(
      AUDIENCE_RULE_KEYS.length,
    );
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE name='comms_delegated_context'`).get()?.name,
    ).toBe("comms_delegated_context");
    db.close();
  });

  it("X6 a database with BOTH tables present but ZERO rules is re-seeded", () => {
    /* Closes M25. X2's scratch DB creates only `comms_audience_rules`, so
       `haveStamp` is false and the installer proceeds for that reason alone —
       the `ruleCount(db) > 0` term is never what decides. Deleting it therefore
       changed nothing observable and the mutant survived.

       This case builds the state that actually discriminates: BOTH tables
       present, rules empty. Without the row-count term the installer returns
       early and the database is left ruleless forever — every picker on the
       platform empty, no error raised. */
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE comms_audience_rules (
               rule_key TEXT PRIMARY KEY NOT NULL,
               applies_to_viewer_role TEXT NOT NULL DEFAULT 'any',
               enabled INTEGER NOT NULL DEFAULT 0,
               requires_owner_decision INTEGER NOT NULL DEFAULT 0,
               description TEXT NOT NULL DEFAULT '',
               recommended_default TEXT,
               decided_at TEXT, decided_by TEXT,
               created_at TEXT NOT NULL DEFAULT (datetime('now')),
               updated_at TEXT NOT NULL DEFAULT (datetime('now')));
             CREATE TABLE comms_delegated_context (
               id TEXT PRIMARY KEY NOT NULL,
               scope TEXT NOT NULL,
               ref_id TEXT NOT NULL,
               acting_user_id TEXT NOT NULL,
               partner_id TEXT NOT NULL,
               company_id TEXT NOT NULL,
               engagement_id TEXT NOT NULL,
               created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    // The discriminating precondition, asserted rather than assumed.
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE name='comms_delegated_context'`).get()?.name,
    ).toBe("comms_delegated_context");
    expect(db.prepare(`SELECT COUNT(*) AS n FROM comms_audience_rules`).get().n).toBe(0);

    applyCommsDelegatedContextSchema(db as any);

    expect(db.prepare(`SELECT COUNT(*) AS n FROM comms_audience_rules`).get().n).toBe(
      AUDIENCE_RULE_KEYS.length,
    );
    /* And the four pre-existing sources come back ON, not merely present — a
       re-seed that inserted six disabled rows would be the same outage. */
    const on = db
      .prepare(
        `SELECT COUNT(*) AS n FROM comms_audience_rules
          WHERE enabled = 1 AND rule_key IN
            ('channel_participant','cap_table_peer','chapter_peer','follow_peer')`,
      )
      .get().n;
    expect(on).toBe(4);
    db.close();
  });

  it("X4 the notice is MOUNTED on all THREE Messages surfaces — a component mounted nowhere is not shipped", () => {
    const fs = require("node:fs");
    /* Comments are stripped first: a file whose PROSE mentions the component
       would otherwise satisfy this check without rendering it — the exact
       vacuous-assertion bug this wave hit twice. */
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    for (const f of [
      "client/src/pages/partner/PartnerMessages.tsx",
      "client/src/pages/investor/Messages.tsx",
      "client/src/pages/founder/Messages.tsx",
    ]) {
      const src = strip(fs.readFileSync(f, "utf8"));
      expect({ file: f, mounted: src.includes("<MessagingAudienceNotice") }).toEqual({
        file: f,
        mounted: true,
      });
      expect(src).toContain('from "@/components/comms/MessagingAudienceNotice"');
    }
  });

  it("X5 the stripper this file relies on really does remove a commented mention", () => {
    const strip = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(strip("/* <MessagingAudienceNotice /> */")).not.toContain("MessagingAudienceNotice");
    expect(strip("// <MessagingAudienceNotice />")).not.toContain("MessagingAudienceNotice");
    expect(strip("<MessagingAudienceNotice />")).toContain("MessagingAudienceNotice");
  });

  it("X3 the two migration copies are byte-identical", () => {
    const fs = require("node:fs");
    const a = fs.readFileSync("migrations/0181_wave33_msg01_delegated_context.sql");
    const b = fs.readFileSync("server/db/migrations/0181_wave33_msg01_delegated_context.sql");
    expect(Buffer.compare(a, b)).toBe(0);
  });
});

/**
 * WAVE 185 · ITEM E — THE ACTIVE ATTACK THAT WAVE 185 NEVER RAN.
 * ══════════════════════════════════════════════════════════════════════════════
 * Wave 185 WIDENED investor peer resolution (Item A made `durableCapTablePeerIds`
 * alias-aware; Item D put the resolved peers into `candidateIds` so they are
 * actually iterated). Every existing test asserts that the people who SHOULD be
 * reachable now are. Nobody had yet sat down as an attacker and tried to reach
 * somebody they must NOT reach.
 *
 * This file is that attempt. It is deliberately written as an ATTACK, not as a
 * fence description: each test picks a target, states the relationship the
 * attacker does NOT have with them, and then tries every door in turn.
 *
 * TWO ATTACKERS, both non-admin:
 *   1. A SEEDED W185 TEST MEMBER (`u_w185_test_1`), created by the real Item C
 *      seeder. This is the sharpest case, because the seeder deliberately grants
 *      `cap_table_exempt = 1` to get past gate step 3 WITHOUT a cap-table
 *      position: the member is a fully admitted Collective member who owns
 *      nothing. If the exemption leaked into reach, it would leak here.
 *   2. AN ORDINARY INVESTOR (`u_w185e_ordinary`) who holds a genuine position on
 *      one operating company, so their audience is non-empty and the test cannot
 *      pass merely because everything is empty.
 *
 * THREE TARGETS, exactly as the brief specifies:
 *   T1 another investor with NO shared cap table (holds a different company);
 *   T2 another partner's LP (an SPV limited partner of a partner organisation the
 *      attacker has no relationship with — the WAIVER-4 population);
 *   T3 a founder at an unrelated company (no follow, no shared chapter, no
 *      shared cap table).
 *
 * FOUR DOORS PER TARGET, because a fence that holds on one door and not the next
 * is not a fence:
 *   door 1  DISCOVERY  — `GET /api/comms/users`, the recipient picker.
 *   door 2  RESOLVER   — `durableCapTablePeerIds`, in case the picker merely
 *                        filters something the resolver already leaked.
 *   door 3  NAMING     — `areCoMembersOnAnyCapTableAliasAware`, the gate that
 *                        decides whether a real legal name is disclosed.
 *   door 4  ID-GUESS   — `POST /api/comms/dm/start` addressed at the target's raw
 *                        id, bypassing discovery entirely.
 *
 * WHAT DOOR 4 HONESTLY FINDS, STATED UP FRONT RATHER THAN BURIED. Door 4 is NOT
 * closed, and it was not closed before this wave either. `canDM`
 * (`server/messagingPolicy.ts:322-333`, "Mode A") ALLOWS investor↔investor DMs
 * unconditionally by design, and `openDmChannelCore` honours that. On that path
 * the platform's confidentiality control is not refusal but ALIASING: the
 * counterparty is presented as an alias / "Private Investor" unless a shared cap
 * table unblocks the real name. So door 4 is asserted for what it actually
 * guarantees — `privacyMode` must be `alias`, never `unblocked-by-cap-table`, and
 * the response must never carry the target's raw legal name. That is a
 * PRE-EXISTING policy of this platform, is unchanged by wave 185, and is recorded
 * here so it is a known accepted design rather than an unexamined gap.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { registerCommsRoutes } from "../commsStore";
import { applyCommsDelegatedContextSchema } from "../lib/applyCommsDelegatedContextSchema";
import { applyWave10EngineSchema } from "../lib/applyWave10EngineSchema";
import { _resetAliasSchemaGuardForTests } from "../lib/investorIdentityAliasStore";
import { durableCapTablePeerIds } from "../lib/commsUserDirectory";
import { areCoMembersOnAnyCapTable } from "../lib/capTableMembership";
import { areCoMembersOnAnyCapTableAliasAware } from "../lib/capTableCoMembershipAliasAware";
import { canDM } from "../messagingPolicy";
import { seedW185CollectiveTestData, W185_ID_TOKEN } from "../lib/w185CollectiveTestSeed";

/* ── the attackers ─────────────────────────────────────────────────────────── */
const SEEDED = `u_${W185_ID_TOKEN}_1`; // real Item C seeder output, cap_table_exempt
const ORDINARY = "u_w185e_ordinary"; // holds ONE real position

/* ── the targets ───────────────────────────────────────────────────────────── */
const T1_INVESTOR = "u_w185e_t1_investor"; // different company entirely
const T2_PARTNER_LP = "u_w185e_t2_partner_lp"; // another partner's SPV LP
const T2_PARTNER_LP_EXT = "ext_w185e_t2_partner_lp"; // seated under a ledger id
const T3_FOUNDER = "u_w185e_t3_founder"; // unrelated company's founder

/* A legitimate peer of ORDINARY, so no assertion below can pass vacuously. */
const LEGIT_PEER = "u_w185e_legit_peer";

const CO_ORDINARY = "co_w185e_ordinary"; // ORDINARY + LEGIT_PEER
const CO_T1 = "co_w185e_t1"; // T1 only
const CO_T3 = "co_w185e_t3"; // T3 only
const OTHER_PARTNER_SPV = "spv_w185e_other_partner";
const OTHER_PARTNER = "ac_consortium_partner_w185e_other";

const TARGETS: Array<[string, string]> = [
  ["T1 another investor with NO shared cap table", T1_INVESTOR],
  ["T2 another partner's LP", T2_PARTNER_LP],
  ["T3 a founder at an unrelated company", T3_FOUNDER],
];

const now = () => new Date().toISOString();
let seq = 960000;

const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w185e fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string, role: string, name: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at, anonymized_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL, NULL)`,
    id,
    `${id}@w185e.test.invalid`,
    name,
    role,
  );
}

function seedCompany(id: string, name: string): void {
  run(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, 0, NULL)`,
    id,
    name,
  );
}

/** `amount` / `shares` are TEXT on this SACRED ledger; written as string literals
 *  with no `Number()`, `parseInt` or `parseFloat` anywhere near them. */
function seedCommit(companyId: string, investorId: string): void {
  seq += 1;
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '1', 'USD', '1', 'committed', '', ?, NULL)`,
    `ccm_w185e_${companyId}_${investorId}`,
    seq,
    now(),
    `inv_w185e_${seq}`,
    `rnd_w185e_${companyId}`,
    companyId,
    investorId,
    `hash_w185e_${seq}`,
  );
}

let app: Express;

const asUser = (r: request.Test, id: string, role = "investor") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);
const usersFor = (as: string, role = "investor") =>
  asUser(request(app).get("/api/comms/users"), as, role);
const idsOf = (body: unknown): string[] =>
  (body as Array<{ id: string }>).map((u) => u.id);
const dmStart = (as: string, target: string, role = "investor") =>
  asUser(request(app).post("/api/comms/dm/start"), as, role).send({ targetUserId: target });

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  applyWave10EngineSchema(rawDb() as any);
  _resetAliasSchemaGuardForTests();
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);

  /* ATTACKER 1 — the REAL Item C seeder, not a hand-rolled imitation. */
  const report = seedW185CollectiveTestData();
  expect(report.ok).toBe(true);

  /* ATTACKER 2 and the cast. */
  seedUser(ORDINARY, "investor", "W185E Ordinary Investor");
  seedUser(LEGIT_PEER, "investor", "W185E Legitimate Peer");
  seedUser(T1_INVESTOR, "investor", "W185E Target One Investor");
  seedUser(T2_PARTNER_LP, "investor", "W185E Target Two Partner LP");
  seedUser(T3_FOUNDER, "founder", "W185E Target Three Founder");

  seedCompany(CO_ORDINARY, "W185E Ordinary Co");
  seedCompany(CO_T1, "W185E Target One Co");
  seedCompany(CO_T3, "W185E Target Three Co");

  /* ORDINARY's ONE genuine relationship. Non-SPV, so it is a real cap-table
     co-membership and the attacker's audience is provably non-empty. */
  seedCommit(CO_ORDINARY, ORDINARY);
  seedCommit(CO_ORDINARY, LEGIT_PEER);

  /* T1 holds a company nobody else in this fixture holds. */
  seedCommit(CO_T1, T1_INVESTOR);

  /* T3 founds a company ORDINARY does not follow and holds no position in. */
  seedCommit(CO_T3, T3_FOUNDER);
  run(
    `INSERT OR REPLACE INTO company_members
       (id, company_id, user_id, role, tenant_id, is_active, joined_at, deleted_at)
     VALUES (?, ?, ?, 'founder', 'tenant_platform', 1, ?, NULL)`,
    `cm_w185e_${T3_FOUNDER}`,
    CO_T3,
    T3_FOUNDER,
    now(),
  );

  /* T2 — ANOTHER PARTNER'S LP. Registered in `spv` under a sponsor neither
     attacker has anything to do with, and seated under an `ext_*` ledger id with
     an ACTIVE alias, which is exactly the population Item A newly resolves. */
  run(
    `INSERT OR REPLACE INTO spv
       (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
        distribution_scope, currency, carry_basis, lp_visibility,
        created_at, created_by, updated_at, updated_by, curr_hash)
     VALUES (?, ?, 'u_w185e_other_gp', 'W185E Other Partner Vehicle', 'spv', 'DE',
             'open', 'private', 'USD', 'whole_fund', 'own_only', ?, 'u_w185e_admin', ?,
             'u_w185e_admin', 'hash_w185e_spv')`,
    OTHER_PARTNER_SPV,
    OTHER_PARTNER,
    now(),
    now(),
  );
  seedCommit(OTHER_PARTNER_SPV, T2_PARTNER_LP_EXT);
  run(
    `INSERT OR REPLACE INTO investor_identity_alias
       (id, tenant_id, alias_investor_id, canonical_user_id, match_email, basis, state,
        created_by, created_at, updated_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 'admin_manual', 'active', 'u_w185e_admin', ?, ?)`,
    `alias_w185e_t2`,
    T2_PARTNER_LP_EXT,
    T2_PARTNER_LP,
    `${T2_PARTNER_LP}@w185e.test.invalid`,
    now(),
    now(),
  );
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 0 — ANTI-VACUITY. Both attackers must be REAL, ADMITTED, NON-ADMIN
   accounts with something to lose, or every refusal below is meaningless.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · E · the attackers are real, admitted and non-admin", () => {
  it("E-0 the seeded member exists, is an ACTIVE Collective member, and is NOT admin", () => {
    const u = rawDb()
      .prepare(`SELECT id, role FROM users WHERE id = ?`)
      .get(SEEDED) as { id?: string; role?: string } | undefined;
    expect(u?.id).toBe(SEEDED);
    expect(u?.role).not.toBe("admin");
    const m = rawDb()
      .prepare(`SELECT status, cap_table_exempt FROM collective_memberships WHERE user_id = ?`)
      .get(SEEDED) as { status?: string; cap_table_exempt?: number } | undefined;
    expect(m?.status).toBe("active");
    /* The sharp bit: admitted past gate step 3 by EXEMPTION, owning nothing. */
    expect(m?.cap_table_exempt).toBe(1);
    const pos = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM captable_commits WHERE investor_id = ?`)
      .get(SEEDED) as { n: number };
    expect(pos.n).toBe(0);
  });

  it("E-1 the ordinary investor's audience is genuinely NON-EMPTY", async () => {
    /* Without this, every 'not.toContain' below could pass because the endpoint
       returns nothing at all to anyone. */
    expect(durableCapTablePeerIds(ORDINARY)).toContain(LEGIT_PEER);
    const res = await usersFor(ORDINARY);
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toContain(LEGIT_PEER);
  });

  it("E-2 all three targets exist and are resolvable users", () => {
    for (const [, target] of TARGETS) {
      const u = rawDb().prepare(`SELECT id FROM users WHERE id = ?`).get(target) as
        | { id?: string }
        | undefined;
      expect(u?.id).toBe(target);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP A — ATTACKER 1: THE SEEDED W185 TEST MEMBER.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · E · ATTACK as a SEEDED test member (cap_table_exempt, owns nothing)", () => {
  it("A-1 DISCOVERY: the picker offers the seeded member NONE of the three targets", async () => {
    const res = await usersFor(SEEDED);
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    for (const [label, target] of TARGETS) {
      expect(ids, label).not.toContain(target);
    }
    /* And no OTHER real investor either — the seeded member reaches only the
       other four seeded members, whose chapter they share. */
    expect(ids).not.toContain(ORDINARY);
    expect(ids).not.toContain(LEGIT_PEER);
  });

  it("A-2 RESOLVER: the cap-table peer resolver returns NOTHING for them", () => {
    /* `cap_table_exempt` bypasses gate step 3 and ONLY gate step 3. It confers no
       position, therefore no co-membership, therefore no peer. */
    expect(durableCapTablePeerIds(SEEDED)).toEqual([]);
  });

  it("A-3 NAMING: no target's real name can be unlocked by the seeded member", () => {
    for (const [label, target] of TARGETS) {
      expect(areCoMembersOnAnyCapTable(SEEDED, target), label).toBe(false);
      expect(areCoMembersOnAnyCapTableAliasAware(SEEDED, target), label).toBe(false);
      /* Both directions — a fence that holds one way only is not a fence. */
      expect(areCoMembersOnAnyCapTableAliasAware(target, SEEDED), label).toBe(false);
    }
    /* Including when the attacker supplies the LP's RAW LEDGER ID, which is the
       form a leaked export or a guessed hash would take. */
    expect(areCoMembersOnAnyCapTableAliasAware(SEEDED, T2_PARTNER_LP_EXT)).toBe(false);
  });

});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP B — ATTACKER 2: AN ORDINARY INVESTOR WITH ONE REAL POSITION.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · E · ATTACK as an ORDINARY investor with one real position", () => {
  it("B-1 DISCOVERY: the picker offers their ONE legitimate peer and none of the targets", async () => {
    const res = await usersFor(ORDINARY);
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(LEGIT_PEER); // the entitlement is real
    for (const [label, target] of TARGETS) {
      expect(ids, label).not.toContain(target);
    }
    /* Nor any seeded test member — the Item C seed did not make its people
       reachable by real investors, which was the cross-item fence at stake. */
    expect(ids.filter((id) => id.includes(W185_ID_TOKEN))).toEqual([]);
  });

  it("B-2 RESOLVER: the peer resolver returns EXACTLY the one entitled peer", () => {
    expect(durableCapTablePeerIds(ORDINARY)).toEqual([LEGIT_PEER]);
  });

  it("B-3 NAMING: no target's name unlocks, in either direction, raw id or not", () => {
    for (const [label, target] of TARGETS) {
      expect(areCoMembersOnAnyCapTableAliasAware(ORDINARY, target), label).toBe(false);
      expect(areCoMembersOnAnyCapTableAliasAware(target, ORDINARY), label).toBe(false);
    }
    expect(areCoMembersOnAnyCapTableAliasAware(ORDINARY, T2_PARTNER_LP_EXT)).toBe(false);
    /* The control: the LEGITIMATE peer DOES unlock, so the gate is not simply
       answering false to everything. */
    expect(areCoMembersOnAnyCapTableAliasAware(ORDINARY, LEGIT_PEER)).toBe(true);
  });

  it("B-5 THE SPV FENCE HELD FOR AN OUTSIDER TOO — T2 is invisible through the alias", () => {
    /* T2 is seated under an `ext_*` id with an ACTIVE alias, so they are exactly
       the shape Item A newly resolves. They are still unreachable, because the
       vehicle is `spv`-registered and `notSpvBackedSql` excludes it. */
    expect(durableCapTablePeerIds(ORDINARY)).not.toContain(T2_PARTNER_LP);
    expect(durableCapTablePeerIds(T2_PARTNER_LP)).toEqual([]);
    expect(durableCapTablePeerIds(T2_PARTNER_LP_EXT)).toEqual([]);
  });

  it("B-6 REVERSE DIRECTION: none of the three targets can reach the attackers either", async () => {
    /* Runs BEFORE group C, which deliberately opens DM threads and would
       legitimately create a channel relationship this assertion would then see.
       Test order is the fixture here, and it is stated rather than relied on
       silently. */
    for (const [label, target] of TARGETS) {
      const role = target === T3_FOUNDER ? "founder" : "investor";
      const res = await usersFor(target, role);
      const ids = idsOf(res.body);
      expect(ids, label).not.toContain(ORDINARY);
      expect(ids, label).not.toContain(SEEDED);
      expect(ids, label).not.toContain(LEGIT_PEER);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP C — DOOR 4, THE ID-GUESS. RUN LAST, BECAUSE IT CHANGES THE WORLD.
   ══════════════════════════════════════════════════════════════════════════════
   This group records a PRE-EXISTING, DELIBERATE property of the platform that
   wave 185 neither introduced nor widened, found by actually attacking it rather
   than by reading the fence code:

   `canDM` (`server/messagingPolicy.ts`, "Mode A") ALLOWS investor↔investor DMs
   unconditionally, and `openDmChannelCore` honours it. An attacker who already
   KNOWS a target's raw user id can therefore open a thread with them without
   appearing in — or consulting — the recipient picker. The platform's control on
   that path is not refusal but ALIASING, and the thread it creates then makes the
   two parties `channel_participant` peers of each other, which is a genuine and
   intended relationship.

   So the correct assertions on door 4 are about IDENTITY, not reachability: the
   real legal name must never be disclosed and `privacyMode` must never become
   `unblocked-by-cap-table` for a pair with no shared cap table. C-3 states the
   manufactured-channel consequence explicitly so it is a known accepted design
   rather than an unexamined gap.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · E · DOOR 4 — the ID-GUESS, and what it does and does not buy", () => {
  it("C-1 SEEDED member: direct addressing never unblocks a target's real name", async () => {
    for (const [label, target] of TARGETS) {
      const res = await dmStart(SEEDED, target);
      expect(canDM(SEEDED, target).privacyMode, label).not.toBe("unblocked-by-cap-table");
      expect(JSON.stringify(res.body), label).not.toContain("W185E Target");
      expect(res.status, label).toBeLessThan(500);
    }
  });

  it("C-2 ORDINARY investor: same — aliased for strangers, unblocked only for the real peer", async () => {
    for (const [label, target] of TARGETS) {
      const res = await dmStart(ORDINARY, target);
      expect(canDM(ORDINARY, target).privacyMode, label).not.toBe("unblocked-by-cap-table");
      expect(JSON.stringify(res.body), label).not.toContain("W185E Target");
      expect(res.status, label).toBeLessThan(500);
    }
    /* The control: the LEGITIMATE peer IS unblocked by the shared cap table,
       which is the whole point of the relationship. */
    expect(canDM(ORDINARY, LEGIT_PEER).privacyMode).toBe("unblocked-by-cap-table");
  });

  it("C-3 THE FINDING: an opened thread DOES make the pair channel peers — by design", async () => {
    /* Recorded, not glossed. After C-1/C-2 opened threads, T1 legitimately sees
       the two attackers as channel co-participants. That is the
       `channel_participant` audience rule working as specified, and it is exactly
       what the aliasing is there to make safe. */
    const res = await usersFor(T1_INVESTOR);
    const ids = idsOf(res.body);
    expect(ids).toContain(ORDINARY);
    /* AND YET THE NAME IS STILL WITHHELD — this is the assertion that matters. */
    const entry = (res.body as Array<{ id: string; legalName?: string }>).find(
      (u) => u.id === ORDINARY,
    );
    expect(entry).toBeDefined();
    expect(entry?.legalName).not.toBe("W185E Ordinary Investor");
    /* And no cap-table relationship was manufactured along with the thread. */
    expect(areCoMembersOnAnyCapTableAliasAware(T1_INVESTOR, ORDINARY)).toBe(false);
    expect(durableCapTablePeerIds(T1_INVESTOR)).toEqual([]);
  });
});

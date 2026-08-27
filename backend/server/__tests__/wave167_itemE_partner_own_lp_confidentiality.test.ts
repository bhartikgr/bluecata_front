/**
 * WAVE 167 · BATCH 3 ITEM E — THE MANDATORY CONFIDENTIALITY PROOF.
 *                                          R139.3 · R139.2 · R108.1 · R135.8 · R144
 *
 * WHY THIS FILE IS THE REASON THE WAVE WAS HELD.
 * R139.1 overturned R135.4 and ships `partner_own_lp_peers` ENABLED. Enabling a
 * DIRECTORY rule is the one change in batch 3 that can expose a real person's
 * data, and R139.3 makes the proof MANDATORY, not optional:
 *
 *   "prove a partner CANNOT reach another partner's LPs, another partner's team,
 *    a founder's cap-table members, or any Collective member outside their own
 *    relationships."
 *
 * SO THIS FILE IS DELIBERATELY NOT A HAPPY-PATH FILE. Every isolation claim is
 * asserted in BOTH DIRECTIONS across TWO real partner organisations with
 * DISTINCT LPs, because a one-directional test passes just as well against an
 * implementation that leaks the other way. The happy path lives in
 * `wave167_itemE_partner_messaging_dom.test.tsx` (rendered DOM, R137.1) and in
 * group A below only far enough to prove the fixture is real — an isolation
 * proof over an audience that is empty for unrelated reasons is vacuous.
 *
 * THE FIXTURE, STATED AS A SENTENCE.
 *   PARTNER ORG ALPHA  — principal `u_w167_alpha_gp`, colleague `u_w167_alpha_mate`
 *                        sponsors SPV `spv_w167_alpha` with LPs A1 and A2.
 *   PARTNER ORG BRAVO  — principal `u_w167_bravo_gp`, colleague `u_w167_bravo_mate`
 *                        sponsors SPV `spv_w167_bravo` with LPs B1 and B2.
 *   A FOUNDER          — `u_w167_founder` with an OPERATING-company cap table
 *                        carrying `u_w167_captable_lp`, which is what
 *                        `notSpvBackedSql` exists to protect.
 *   A COLLECTIVE MEMBER— `u_w167_collective` with no relationship to either org.
 *   A DELEGATED PERSON — `u_w167_client_member`, a member of a company ALPHA holds
 *                        a LIVE engagement for. R108 withdrew this audience; this
 *                        file proves it is STILL withdrawn.
 *
 * ANTI-VACUITY, APPLIED THROUGHOUT. For every person proved UNREACHABLE, the
 * test ALSO proves the underlying resolver or ledger row genuinely exists — so
 * each refusal is the FENCE holding, never an empty fixture. That is the
 * distinction R139.3 actually asks about.
 *
 * NEVER MUTATES data.db / test.db. Group P works on COPIES and captures sha256
 * before and after. Groups A-F use the ordinary in-memory test handle.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { registerCommsRoutes } from "../commsStore";
import {
  readRules,
  isAudienceRuleEnabled,
  AUDIENCE_RULE_KEYS,
} from "../lib/commsAudienceRules";
import {
  partnerOwnLpPeerIds,
  partnerOwnAudienceIds,
  partnerTeamPeerIds,
  delegatedCompanyPeopleIds,
  resolvePartnerIdForUser,
} from "../lib/partnerDelegatedContext";
import { durableCapTablePeerIds } from "../lib/commsUserDirectory";
import { notSpvBackedSql } from "../lib/spvBackedCompanies";
import { applyCommsDelegatedContextSchema } from "../lib/applyCommsDelegatedContextSchema";
import { splitStatements } from "../db/migrate";

const ROOT = process.cwd();
const SCRATCH = join(ROOT, "w167_scratch", "dbs");
const M0210 = "migrations/0210_wave167_partner_own_lp_peers.sql";
const M0181 = "migrations/0181_wave33_msg01_delegated_context.sql";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require("better-sqlite3");

const sqlOf = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
const now = (): string => new Date().toISOString();

/* ── the cast ─────────────────────────────────────────────────────────────── */
const ALPHA_ORG = "porg_w167_alpha";
const BRAVO_ORG = "porg_w167_bravo";
const ALPHA_GP = "u_w167_alpha_gp";
const ALPHA_MATE = "u_w167_alpha_mate";
const BRAVO_GP = "u_w167_bravo_gp";
const BRAVO_MATE = "u_w167_bravo_mate";
const ALPHA_SPV = "spv_w167_alpha";
const BRAVO_SPV = "spv_w167_bravo";
const LP_A1 = "u_w167_lp_a1";
const LP_A2 = "u_w167_lp_a2";
const LP_B1 = "u_w167_lp_b1";
const LP_B2 = "u_w167_lp_b2";
const FOUNDER = "u_w167_founder";
const CAPTABLE_LP = "u_w167_captable_lp";
const OPERATING_CO = "co_w167_operating";
const COLLECTIVE = "u_w167_collective";
const CLIENT_MEMBER = "u_w167_client_member";
const CLIENT_CO = "co_w167_client";
const ENGAGEMENT = "eng_w167_alpha_client";

let app: Express;

/** THROWS on failure — a swallowed fixture error is vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w167 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string, name: string, role: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
    id,
    `${id}@w167.test`,
    name,
    role,
  );
  try {
    run(
      `INSERT OR REPLACE INTO auth_users (id, email, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      `${id}@w167.test`,
      role,
      now(),
      now(),
    );
  } catch {
    /* auth_users shape differs across builds; users.role is the documented fallback. */
  }
}

function seedTeamMember(org: string, user: string, status: "active" | "removed"): void {
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?, ?, ?, 'managing', ?, ?, ?, 'u_w167', 0, ?)`,
    `ptm_${org}_${user}`,
    org,
    user,
    status,
    now(),
    status === "removed" ? now() : null,
    now(),
  );
}

function seedSpv(id: string, org: string, gp: string): void {
  run(
    `INSERT OR REPLACE INTO spv
       (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
        distribution_scope, currency, carry_basis, lp_visibility,
        created_at, created_by, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, ?, 'spv', 'DE', 'open', 'private', 'USD', 'whole_fund',
             'own_only', ?, ?, ?, ?, ?)`,
    id,
    org,
    gp,
    `W167 ${id}`,
    now(),
    gp,
    now(),
    gp,
    `hash_${id}`,
  );
}

function seedSubscription(spvId: string, investorId: string): void {
  run(
    `INSERT OR REPLACE INTO spv_subscription
       (id, spv_id, investor_id, commitment_minor, wired_minor, currency, status,
        created_at, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, 5000000, 0, 'USD', 'committed', ?, ?, ?, ?)`,
    `sub_${spvId}_${investorId}`,
    spvId,
    investorId,
    now(),
    now(),
    "u_w167",
    `hash_${spvId}_${investorId}`,
  );
}

/** A committed row on the SACRED `captable_commits` ledger.
 *
 *  `amount` and `shares` are TEXT on this table and are written as STRING
 *  literals here. No `Number()`, `parseInt` or `parseFloat` touches either: this
 *  is a money ledger and the test has no reason to parse a money value at all. */
let capSeq = 900000;
function seedCapTableCommit(company: string, investor: string): void {
  capSeq += 1;
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '100000', 'USD', '1000',
             'committed', ?, ?, NULL)`,
    `cc_${company}_${investor}`,
    capSeq,
    now(),
    `inv_${company}_${investor}`,
    `round_${company}`,
    company,
    investor,
    "0000000000000000000000000000000000000000000000000000000000000000",
    `hash_${company}_${investor}`,
  );
}

const asUser = (r: request.Test, id: string, role = "partner") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);
const usersFor = (as: string, role = "partner") =>
  asUser(request(app).get("/api/comms/users"), as, role);
const idsOf = (body: unknown): string[] =>
  (body as Array<{ id: string }>).map((u) => u.id);

/** 0210's executable statements, comments stripped exactly as the runner splits
 *  them. Pinned so the migration can never degrade into running nothing. */
function statements(): string[] {
  const out = splitStatements(sqlOf(M0210))
    .map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
    .filter((s) => s.length > 0);
  expect(out.length).toBe(1);
  expect(out[0].slice(0, 6).toUpperCase()).toBe("INSERT");
  return out;
}

function fresh(name: string): any {
  mkdirSync(SCRATCH, { recursive: true });
  const p = join(SCRATCH, name);
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(p + suffix)) rmSync(p + suffix);
  return new Database(p);
}
function copyDb(src: string, name: string): any {
  mkdirSync(SCRATCH, { recursive: true });
  const dest = join(SCRATCH, name);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(dest + suffix)) rmSync(dest + suffix);
    if (existsSync(join(ROOT, src + suffix))) copyFileSync(join(ROOT, src + suffix), dest + suffix);
  }
  return new Database(dest);
}

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);

  /* Two partner organisations, each with a principal and a colleague. */
  seedUser(ALPHA_GP, "Alpha Principal", "partner");
  seedUser(ALPHA_MATE, "Alpha Colleague", "partner");
  seedUser(BRAVO_GP, "Bravo Principal", "partner");
  seedUser(BRAVO_MATE, "Bravo Colleague", "partner");
  seedTeamMember(ALPHA_ORG, ALPHA_GP, "active");
  seedTeamMember(ALPHA_ORG, ALPHA_MATE, "active");
  seedTeamMember(BRAVO_ORG, BRAVO_GP, "active");
  seedTeamMember(BRAVO_ORG, BRAVO_MATE, "active");

  /* Distinct LPs per organisation — the whole point of item 1 and item 2. */
  seedUser(LP_A1, "Alpha LP One", "investor");
  seedUser(LP_A2, "Alpha LP Two", "investor");
  seedUser(LP_B1, "Bravo LP One", "investor");
  seedUser(LP_B2, "Bravo LP Two", "investor");
  seedSpv(ALPHA_SPV, ALPHA_ORG, ALPHA_GP);
  seedSpv(BRAVO_SPV, BRAVO_ORG, BRAVO_GP);
  seedSubscription(ALPHA_SPV, LP_A1);
  seedSubscription(ALPHA_SPV, LP_A2);
  seedSubscription(BRAVO_SPV, LP_B1);
  seedSubscription(BRAVO_SPV, LP_B2);

  /* A founder's OPERATING-company cap table — protected by notSpvBackedSql. */
  seedUser(FOUNDER, "W167 Founder", "founder");
  seedUser(CAPTABLE_LP, "Cap Table Holder", "investor");
  run(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, 0, NULL)`,
    OPERATING_CO,
    "W167 Operating Co",
  );
  seedCapTableCommit(OPERATING_CO, FOUNDER);
  seedCapTableCommit(OPERATING_CO, CAPTABLE_LP);

  /* A Collective member with NO relationship to either organisation. */
  seedUser(COLLECTIVE, "Unrelated Collective Member", "investor");

  /* A member of a company ALPHA holds a LIVE engagement for — R108's withdrawn
     audience. Present so the withdrawal is proved against a real relationship. */
  seedUser(CLIENT_MEMBER, "Client Company Member", "founder");
  run(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, 0, NULL)`,
    CLIENT_CO,
    "W167 Client Co",
  );
  run(
    `INSERT OR REPLACE INTO company_members
       (id, company_id, user_id, role, tenant_id, is_active, joined_at, deleted_at)
     VALUES (?, ?, ?, 'co_founder', 'tenant_platform', 1, ?, NULL)`,
    `cm_${CLIENT_MEMBER}`,
    CLIENT_CO,
    CLIENT_MEMBER,
    now(),
  );
  run(
    `INSERT OR REPLACE INTO mf_engagement
       (id, partner_id, company_id, mode, status, created_at, updated_at,
        founder_revoked_at, archived_at)
     VALUES (?, ?, ?, 'B', 'ACTIVE', ?, ?, NULL, NULL)`,
    ENGAGEMENT,
    ALPHA_ORG,
    CLIENT_CO,
    now(),
    now(),
  );

  /* The rule under test must actually be ON, or every refusal below is vacuous.
     `readRules` seeds it via `ensureWave167OwnLpPeersRule`; assert, never assume. */
  readRules();
  run(
    `UPDATE comms_audience_rules
        SET enabled = 1, requires_owner_decision = 0
      WHERE rule_key = 'partner_own_lp_peers'`,
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   (A) THE FIXTURE IS REAL, AND THE RULE IS ON
   Without this group every "cannot reach" below could be an empty audience.
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 167 · A — the rule is ENABLED and the audience is genuinely non-empty", () => {
  it("A1 R139.1 — `partner_own_lp_peers` is ON for a partner viewer, and is a known key", () => {
    expect(AUDIENCE_RULE_KEYS).toContain("partner_own_lp_peers");
    expect(isAudienceRuleEnabled("partner_own_lp_peers", "partner")).toBe(true);
    const row = readRules().find((r) => r.ruleKey === "partner_own_lp_peers");
    expect(row).toBeTruthy();
    expect(row!.enabled).toBe(true);
    /* R139.1: the owner HAS decided, so this must not render as a pending gap. */
    expect(row!.requiresOwnerDecision).toBe(false);
    expect(row!.appliesToViewerRole).toBe("partner");
  });

  it("A2 both organisations resolve, and each principal's OWN LPs are found", () => {
    expect(resolvePartnerIdForUser(ALPHA_GP)).toBe(ALPHA_ORG);
    expect(resolvePartnerIdForUser(BRAVO_GP)).toBe(BRAVO_ORG);
    const alpha = partnerOwnLpPeerIds(ALPHA_GP);
    const bravo = partnerOwnLpPeerIds(BRAVO_GP);
    expect(alpha).toContain(LP_A1);
    expect(alpha).toContain(LP_A2);
    expect(bravo).toContain(LP_B1);
    expect(bravo).toContain(LP_B2);
  });

  it("A3 the two audiences are DISJOINT — the isolation claim has something to prove", () => {
    const alpha = new Set(partnerOwnAudienceIds(ALPHA_GP));
    const bravo = new Set(partnerOwnAudienceIds(BRAVO_GP));
    expect(alpha.size).toBeGreaterThan(0);
    expect(bravo.size).toBeGreaterThan(0);
    const overlap = Array.from(alpha).filter((id) => bravo.has(id));
    expect(overlap).toEqual([]);
  });

  it("A4 the served directory is non-empty for a partner — not the live 'No eligible contacts'", async () => {
    const res = await usersFor(ALPHA_GP);
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    /* Strictly more than the viewer themselves: the live symptom was self-only. */
    expect(ids.filter((id) => id !== ALPHA_GP).length).toBeGreaterThan(0);
    expect(ids).toContain(LP_A1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (B) R139.3 ITEM 1 — ANOTHER PARTNER'S LPs. BOTH DIRECTIONS.
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 167 · B — R139.3(1) a partner CANNOT reach another partner's LPs", () => {
  it("B1 resolver: ALPHA's audience excludes BRAVO's LPs, and BRAVO's excludes ALPHA's", () => {
    const alpha = partnerOwnAudienceIds(ALPHA_GP);
    expect(alpha).not.toContain(LP_B1);
    expect(alpha).not.toContain(LP_B2);
    const bravo = partnerOwnAudienceIds(BRAVO_GP);
    expect(bravo).not.toContain(LP_A1);
    expect(bravo).not.toContain(LP_A2);
    /* Anti-vacuity: each set DOES contain its own LPs on the same call. */
    expect(alpha).toContain(LP_A1);
    expect(bravo).toContain(LP_B1);
  });

  it("B2 SERVED PAYLOAD: no entry for another partner's LP exists at all", async () => {
    const alphaView = await usersFor(ALPHA_GP);
    const alphaIds = idsOf(alphaView.body);
    expect(alphaIds).not.toContain(LP_B1);
    expect(alphaIds).not.toContain(LP_B2);
    expect(alphaIds).toContain(LP_A1);

    const bravoView = await usersFor(BRAVO_GP);
    const bravoIds = idsOf(bravoView.body);
    expect(bravoIds).not.toContain(LP_A1);
    expect(bravoIds).not.toContain(LP_A2);
    expect(bravoIds).toContain(LP_B1);
  });

  it("B3 the FENCE is `spv.sponsor_partner_id` — repointing the SPV moves the audience", () => {
    /* The strongest available statement that the fence is the sponsor column and
       not an accident of ids: move BRAVO's SPV to ALPHA and the LP appears; move
       it back and it disappears again. Restored before the group ends. */
    expect(partnerOwnLpPeerIds(ALPHA_GP)).not.toContain(LP_B1);
    run(`UPDATE spv SET sponsor_partner_id = ? WHERE id = ?`, ALPHA_ORG, BRAVO_SPV);
    expect(partnerOwnLpPeerIds(ALPHA_GP)).toContain(LP_B1);
    run(`UPDATE spv SET sponsor_partner_id = ? WHERE id = ?`, BRAVO_ORG, BRAVO_SPV);
    expect(partnerOwnLpPeerIds(ALPHA_GP)).not.toContain(LP_B1);
    expect(partnerOwnLpPeerIds(BRAVO_GP)).toContain(LP_B1);
  });

  it("B4 a viewer with NO partner organisation gets NOBODY from this rule", () => {
    /* `partnerOwnLpPeerIds` returns [] when `resolvePartnerIdForUser` is null, so
       there is no input for which an unaffiliated user reads an LP book. */
    expect(resolvePartnerIdForUser(COLLECTIVE)).toBeNull();
    expect(partnerOwnLpPeerIds(COLLECTIVE)).toEqual([]);
    expect(partnerOwnAudienceIds(COLLECTIVE)).toEqual([]);
    expect(partnerOwnLpPeerIds("")).toEqual([]);
    expect(partnerOwnLpPeerIds("   ")).toEqual([]);
  });

  it("B5 the rule is ROLE-SCOPED — an investor viewer gains no LP book from it", async () => {
    /* `partner_own_lp_peers` is scoped to 'partner'. LP_A1 resolves as an
       investor, so even though they sit inside ALPHA's SPV the rule cannot fire
       for them and they never receive ALPHA's LP list. */
    expect(isAudienceRuleEnabled("partner_own_lp_peers", "investor")).toBe(false);
    const res = await usersFor(LP_A1, "investor");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).not.toContain(LP_A2);
    expect(ids).not.toContain(LP_B1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (C) R139.3 ITEM 2 — ANOTHER PARTNER'S TEAM MEMBERS. BOTH DIRECTIONS.
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 167 · C — R139.3(2) a partner CANNOT reach another partner's team", () => {
  it("C1 resolver: each principal reaches their OWN colleague and NOT the other's", () => {
    const alpha = partnerOwnAudienceIds(ALPHA_GP);
    expect(alpha).toContain(ALPHA_MATE);
    expect(alpha).not.toContain(BRAVO_MATE);
    expect(alpha).not.toContain(BRAVO_GP);

    const bravo = partnerOwnAudienceIds(BRAVO_GP);
    expect(bravo).toContain(BRAVO_MATE);
    expect(bravo).not.toContain(ALPHA_MATE);
    expect(bravo).not.toContain(ALPHA_GP);
  });

  it("C2 SERVED PAYLOAD: no entry for the other organisation's team exists", async () => {
    const alphaIds = idsOf((await usersFor(ALPHA_GP)).body);
    expect(alphaIds).toContain(ALPHA_MATE);
    expect(alphaIds).not.toContain(BRAVO_MATE);
    expect(alphaIds).not.toContain(BRAVO_GP);

    const bravoIds = idsOf((await usersFor(BRAVO_GP)).body);
    expect(bravoIds).toContain(BRAVO_MATE);
    expect(bravoIds).not.toContain(ALPHA_MATE);
    expect(bravoIds).not.toContain(ALPHA_GP);
  });

  it("C3 the team half is the PRE-EXISTING `partnerTeamPeerIds` — same fence, not a new one", () => {
    /* R139.2: enabling must not widen. The team half of `partnerOwnAudienceIds`
       is exactly `partnerTeamPeerIds`, whose partner fence wave 143 already
       proved. Asserted as a set relation so a future widening of one and not the
       other fails here. */
    const team = new Set(partnerTeamPeerIds(ALPHA_GP));
    const lps = new Set(partnerOwnLpPeerIds(ALPHA_GP));
    const combined = new Set(partnerOwnAudienceIds(ALPHA_GP));
    for (const id of combined) {
      expect(team.has(id) || lps.has(id)).toBe(true);
    }
    for (const id of team) expect(combined.has(id)).toBe(true);
    for (const id of lps) expect(combined.has(id)).toBe(true);
  });

  it("C4 R135.8 — the duplicate `partner_team_members` rows are READ, never rewritten", () => {
    /* The six live duplicates are filed separately and must NOT be deduped here.
       Proof that this wave only reads: insert a genuine duplicate seat row and
       assert (a) the audience is unchanged as a SET, and (b) the row count is
       still what we inserted afterwards — nothing was cleaned up. */
    const before = new Set(partnerOwnAudienceIds(ALPHA_GP));
    run(
      `INSERT OR REPLACE INTO partner_team_members
         (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
       VALUES (?, ?, ?, 'managing', 'active', ?, NULL, 'u_w167', 0, ?)`,
      `ptm_dupe_${ALPHA_MATE}`,
      ALPHA_ORG,
      ALPHA_MATE,
      now(),
      now(),
    );
    const after = new Set(partnerOwnAudienceIds(ALPHA_GP));
    expect(Array.from(after).sort()).toEqual(Array.from(before).sort());
    const count = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_team_members
          WHERE partner_id = ? AND user_id = ? AND status = 'active'`,
      )
      .get(ALPHA_ORG, ALPHA_MATE) as { n: number };
    expect(count.n).toBe(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (D) R139.3 ITEM 3 — A FOUNDER'S CAP-TABLE MEMBERS, AND `notSpvBackedSql`
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 167 · D — R139.3(3) a founder's cap-table members stay protected", () => {
  it("D1 the founder and their cap-table holder are NOT in a partner's audience", async () => {
    const alpha = partnerOwnAudienceIds(ALPHA_GP);
    expect(alpha).not.toContain(FOUNDER);
    expect(alpha).not.toContain(CAPTABLE_LP);
    const ids = idsOf((await usersFor(ALPHA_GP)).body);
    expect(ids).not.toContain(FOUNDER);
    expect(ids).not.toContain(CAPTABLE_LP);
  });

  it("D2 anti-vacuity: the cap table is REAL — the founder's own peer list finds the holder", () => {
    /* If this were empty, D1 would prove nothing. `durableCapTablePeerIds` is the
       list form of the SACRED co-membership predicate and it does find them, so
       D1 is the partner rule declining to read a table it can see. */
    expect(durableCapTablePeerIds(FOUNDER)).toContain(CAPTABLE_LP);
    expect(durableCapTablePeerIds(CAPTABLE_LP)).toContain(FOUNDER);
  });

  it("D3 `notSpvBackedSql` is STILL in the cap_table_peer query and still excludes vehicles", () => {
    /* R139.2(3): the fence stays. Asserted three ways — the predicate text, its
       presence in the shipped query source, and its BEHAVIOUR. */
    const pred = notSpvBackedSql("ca");
    expect(pred).toContain("NOT EXISTS");
    expect(pred).toContain("FROM spv sx_ca");
    expect(pred).toContain("sx_ca.id = ca.company_id");

    const src = readFileSync(join(ROOT, "server/lib/commsUserDirectory.ts"), "utf8");
    const stripped = stripComments(src);
    /* Verify the stripper actually stripped before drawing any conclusion from
       it — a stripper that silently no-ops turns this assertion into a lie. The
       sentinel is a phrase from a genuine JS BLOCK comment. It is deliberately
       NOT one of the `--` SQL comments inside the query template literal: those
       live inside a string, so a CORRECT stripper keeps them and using one as a
       sentinel would fail against a working stripper. Found by this test failing
       on exactly that mistake. */
    expect(src).toContain("silently degrade");
    expect(stripped).not.toContain("silently degrade");
    expect(stripped).toContain("notSpvBackedSql(\"ca\")");

    const capSrc = readFileSync(join(ROOT, "server/lib/capTableMembership.ts"), "utf8");
    const capMembership = stripComments(capSrc);
    /* Sentinel re-derived by CONTENT from this file's own comments, after an
       assumed phrase turned out to live in a different file entirely. */
    expect(capSrc).toContain("Fail-closed: no proof of shared cap table");
    expect(capMembership).not.toContain("Fail-closed: no proof of shared cap table");
    expect(capMembership).toContain("notSpvBackedSql(\"ca\")");
  });

  it("D4 BEHAVIOUR — an SPV-backed holding grants NO cap-table peer, on the real ledger", () => {
    /* `spv_w167_alpha` exists as an `spv` row, so a `captable_commits` row whose
       `company_id` is that SPV must be excluded by the predicate. Two LPs of the
       SAME vehicle must not become cap-table peers of one another — the exposure
       WAIVER-4 closed. */
    seedCapTableCommit(ALPHA_SPV, LP_A1);
    seedCapTableCommit(ALPHA_SPV, LP_A2);
    expect(durableCapTablePeerIds(LP_A1)).not.toContain(LP_A2);
    expect(durableCapTablePeerIds(LP_A2)).not.toContain(LP_A1);
    /* And the same function on a REAL operating company does return a peer, so
       the exclusion is about the vehicle and not about the function being dead. */
    expect(durableCapTablePeerIds(FOUNDER)).toContain(CAPTABLE_LP);
  });

  it("D5 the WAVE-167 functions read neither `captable_commits` nor `company_members`", () => {
    /* SCOPED TO THE TWO NEW FUNCTIONS, on purpose. The FILE still contains
       `company_members` — that is R108's `delegatedCompanyPeopleIds`, which is
       still present in the tree and still fenced off by a DISABLED rule (proved
       in group F). A whole-file assertion here would therefore be FALSE, and this
       test failed on exactly that over-broad claim before being narrowed. The
       claim that is both true and load-bearing is about the wave-167 code. */
    const raw = readFileSync(join(ROOT, "server/lib/partnerDelegatedContext.ts"), "utf8");
    const stripped = stripComments(raw);
    expect(raw).toContain("THE FENCE IS");
    expect(stripped).not.toContain("THE FENCE IS");

    for (const name of ["partnerOwnLpPeerIds", "partnerOwnAudienceIds"]) {
      const fn = functionBody(stripped, name);
      expect(fn.length).toBeGreaterThan(40);
      expect(fn).not.toContain("captable_commits");
      expect(fn).not.toContain("company_members");
      expect(fn).not.toContain("chapter");
      expect(fn).not.toContain("network_posts");
    }
    /* And the LP half names the one fence it is allowed to use. */
    expect(functionBody(stripped, "partnerOwnLpPeerIds")).toContain("spv.sponsor_partner_id");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (E) R139.3 ITEM 4 — ANY COLLECTIVE MEMBER OUTSIDE THEIR OWN RELATIONSHIPS
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 167 · E — R139.3(4) an unrelated Collective member is unreachable", () => {
  it("E1 the unrelated member is in NEITHER partner's audience", async () => {
    expect(partnerOwnAudienceIds(ALPHA_GP)).not.toContain(COLLECTIVE);
    expect(partnerOwnAudienceIds(BRAVO_GP)).not.toContain(COLLECTIVE);
    expect(idsOf((await usersFor(ALPHA_GP)).body)).not.toContain(COLLECTIVE);
    expect(idsOf((await usersFor(BRAVO_GP)).body)).not.toContain(COLLECTIVE);
  });

  it("E2 anti-vacuity: that member EXISTS and is a resolvable directory subject", () => {
    /* They are a real seeded user with a real role, so E1 is the fence and not a
       missing row. */
    const row = rawDb()
      .prepare(`SELECT id, role FROM users WHERE id = ?`)
      .get(COLLECTIVE) as { id: string; role: string };
    expect(row.id).toBe(COLLECTIVE);
    expect(row.role).toBe("investor");
  });

  it("E3 the rule adds NOBODY who is not an own-LP or an own-team-member", () => {
    /* The completeness form of item 4, stated positively: every id the rule
       contributes is in one of exactly two documented sources. Anything else
       appearing here — a chapter peer, a follower, a stranger — fails. */
    const own = new Set([...partnerOwnLpPeerIds(ALPHA_GP), ...partnerTeamPeerIds(ALPHA_GP)]);
    for (const id of partnerOwnAudienceIds(ALPHA_GP)) {
      expect(own.has(id)).toBe(true);
    }
    expect(partnerOwnAudienceIds(ALPHA_GP)).not.toContain(ALPHA_GP);
  });

  it("E4 the rule contributes NOTHING for a founder or admin viewer", async () => {
    /* Scoped to 'partner'. A founder viewer must not acquire an LP book. */
    expect(isAudienceRuleEnabled("partner_own_lp_peers", "founder")).toBe(false);
    const ids = idsOf((await usersFor(FOUNDER, "founder")).body);
    expect(ids).not.toContain(LP_A1);
    expect(ids).not.toContain(LP_B1);
    expect(ids).not.toContain(ALPHA_MATE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (F) R139.3 ITEM 5 — `delegatedCompanyPeopleIds` IS STILL WITHDRAWN (R108)
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 167 · F — R139.3(5) R108's withdrawal is NOT reopened", () => {
  it("F1 `partner_engaged_company_people` is STILL DISABLED with the rule on", () => {
    expect(isAudienceRuleEnabled("partner_own_lp_peers", "partner")).toBe(true);
    expect(isAudienceRuleEnabled("partner_engaged_company_people", "partner")).toBe(false);
  });

  it("F2 the client company member is UNREACHABLE — while the resolver WOULD find them", async () => {
    /* This is the exact harm R108 named: reading a client company member's
       private portfolio. The resolver returns them, the rule refuses them. That
       pairing is the proof; either half alone is not. */
    expect(delegatedCompanyPeopleIds(ALPHA_GP)).toContain(CLIENT_MEMBER);
    expect(partnerOwnAudienceIds(ALPHA_GP)).not.toContain(CLIENT_MEMBER);
    const ids = idsOf((await usersFor(ALPHA_GP)).body);
    expect(ids).not.toContain(CLIENT_MEMBER);
  });

  it("F3 the wave-167 branch NEVER calls the withdrawn resolver", () => {
    /* Structural, not behavioural: `partnerOwnAudienceIds` is `partnerOwnLpPeerIds`
       ∪ `partnerTeamPeerIds` and calls nothing else, so there is no future data
       shape in which it starts returning company members. */
    const stripped = stripComments(
      readFileSync(join(ROOT, "server/lib/partnerDelegatedContext.ts"), "utf8"),
    );
    expect(stripped).not.toContain("R108's withdrawn audience");
    const fn = functionBody(stripped, "partnerOwnAudienceIds");
    expect(fn).toContain("partnerOwnLpPeerIds");
    expect(fn).toContain("partnerTeamPeerIds");
    expect(fn).not.toContain("delegatedCompanyPeopleIds");

    const lpFn = functionBody(stripped, "partnerOwnLpPeerIds");
    expect(lpFn).not.toContain("delegatedCompanyPeopleIds");
    expect(lpFn).not.toContain("mf_engagement");
    expect(lpFn).toContain("spv.sponsor_partner_id");
  });

  it("F4 no cap-table entry for the withdrawn person reaches the partner", async () => {
    /* Even if an entry had somehow survived, wave 144's scoping means it could
       carry no positions. Asserted as absence of the ENTRY, which is stronger. */
    const entry = (await usersFor(ALPHA_GP)).body as Array<Record<string, unknown>>;
    expect(entry.find((u) => u.id === CLIENT_MEMBER)).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (G) WAVE 144's PAYLOAD SCOPING — ASSERTED ON THE SERVED PAYLOAD KEYS
   R139.2(1). The task is explicit: assert the SERVED payload, not the source.
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 167 · G — the served directory payload still EXCLUDES positions", () => {
  const FORBIDDEN = ["capTables", "location", "capavateAngelNetwork"] as const;

  it("G1 no entry, for any viewer, carries capTables / location / network membership", async () => {
    for (const [viewer, role] of [
      [ALPHA_GP, "partner"],
      [BRAVO_GP, "partner"],
      [FOUNDER, "founder"],
      [LP_A1, "investor"],
    ] as const) {
      const body = (await usersFor(viewer, role)).body as Array<Record<string, unknown>>;
      expect(Array.isArray(body)).toBe(true);
      for (const entry of body) {
        for (const key of FORBIDDEN) {
          /* KEY absence, not a falsy value: `capTables: []` would still be a
             statement about the subject's positions. */
          expect(Object.prototype.hasOwnProperty.call(entry, key)).toBe(false);
        }
      }
    }
  });

  it("G2 the SELF entry is scoped too — the removal is not a per-viewer exception", async () => {
    const body = (await usersFor(ALPHA_GP)).body as Array<Record<string, unknown>>;
    const self = body.find((u) => u.id === ALPHA_GP);
    expect(self).toBeTruthy();
    for (const key of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(self!, key)).toBe(false);
    }
  });

  it("G3 the key set is CLOSED — a newly-enabled rule cannot smuggle a field in", async () => {
    /* The positive form: enumerate exactly what messaging is allowed to serve.
       A future field lands here as a failure rather than as a silent exposure. */
    const ALLOWED = new Set(["id", "legalName", "visibility", "roles", "isPrivate"]);
    const body = (await usersFor(ALPHA_GP)).body as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      for (const key of Object.keys(entry)) {
        expect(ALLOWED.has(key)).toBe(true);
      }
    }
  });

  it("G4 an LP's entry carries a renderable label and NO consent flags of theirs", async () => {
    const body = (await usersFor(ALPHA_GP)).body as Array<Record<string, unknown>>;
    const lp = body.find((u) => u.id === LP_A1);
    expect(lp).toBeTruthy();
    expect(String(lp!.legalName ?? "").length).toBeGreaterThan(0);
    /* Only the screen label, never the subject's raw visibility object.

       WAVE 168 · R140.1 RE-ARGUED, DELIBERATELY AND ONLY HERE. This case
       originally asserted `Object.keys(vis)` was EXACTLY `["screenName"]`. That
       held only because ALPHA's own LP was MASKED: the route sends
       `{ screenName: displayName }` for a masked subject, and
       `{ screenName: u.visibility?.screenName }` for an unmasked one — which,
       when the subject has never set a screen name, serialises to `{}`. That
       second shape is PRE-EXISTING behaviour for every cap-table co-member and
       for self, so the exact-key form was pinning the masking, not the payload
       scoping. R140.1 unmasks a sponsoring partner's own LP, so the claim is
       restated as what G4 is actually about: the entry carries a renderable
       label, AT MOST the screen label, and NONE of the subject's consent flags.
       Nothing else in this file changed. */
    const vis = lp!.visibility as Record<string, unknown> | undefined;
    if (vis) {
      for (const k of Object.keys(vis)) expect(k).toBe("screenName");
      for (const flag of ["visibleToCoMembers", "visibleInCollectiveDirectory", "visibleToCollectiveNetwork"]) {
        expect(vis).not.toHaveProperty(flag);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   (P) THE MIGRATION — against COPIES only. The originals are never opened
   for writing, and their sha256 is captured before and after.
   ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 167 · P — migration 0210", () => {
  it("P1 0210 is the TRUE highest migration, and it ships the rule ENABLED", () => {
    const sql = statements()[0];
    expect(sql).toContain("comms_audience_rules");
    expect(sql).toContain("partner_own_lp_peers");
    expect(sql.toUpperCase()).toContain("INSERT OR IGNORE");
    /* R139.1: enabled, and NOT awaiting a decision the owner has already made. */
    expect(sql).toMatch(/'partner'\s*,\s*1\s*,\s*0/);
    for (const forbidden of ["DROP ", "DELETE ", "UPDATE ", "/100", "* 100"]) {
      expect(sql.toUpperCase()).not.toContain(forbidden.toUpperCase());
    }
  });

  it("P2 on a fresh 0181 database the row lands ENABLED, and 0181's six survive", () => {
    const db = fresh("w167_fresh.db");
    for (const s of splitStatements(sqlOf(M0181))) if (s.trim()) db.exec(s.trim());
    const before = db
      .prepare(`SELECT rule_key, enabled FROM comms_audience_rules ORDER BY rule_key`)
      .all() as Array<{ rule_key: string; enabled: number }>;
    expect(before.length).toBe(6);
    expect(db.prepare(statements()[0]).run().changes).toBe(1);
    const row = db
      .prepare(
        `SELECT enabled, requires_owner_decision, applies_to_viewer_role, decided_by
           FROM comms_audience_rules WHERE rule_key = 'partner_own_lp_peers'`,
      )
      .get() as any;
    expect(row.enabled).toBe(1);
    expect(row.requires_owner_decision).toBe(0);
    expect(row.applies_to_viewer_role).toBe("partner");
    expect(String(row.decided_by)).toContain("R139.1");
    /* Nothing already ruled on moved (R139.2). */
    const after = db
      .prepare(
        `SELECT rule_key, enabled FROM comms_audience_rules
          WHERE rule_key <> 'partner_own_lp_peers' ORDER BY rule_key`,
      )
      .all();
    expect(after).toEqual(before);
    /* And the two the ruling names explicitly are still OFF. */
    const held = db
      .prepare(
        `SELECT rule_key, enabled FROM comms_audience_rules
          WHERE rule_key IN ('partner_engaged_company_people','partner_team_peers')
          ORDER BY rule_key`,
      )
      .all() as Array<{ rule_key: string; enabled: number }>;
    expect(held.find((r) => r.rule_key === "partner_engaged_company_people")!.enabled).toBe(0);
    db.close();
  });

  it("P3 IDEMPOTENT, and it never overrules an owner who has since switched it OFF", () => {
    const db = fresh("w167_idem.db");
    for (const s of splitStatements(sqlOf(M0181))) if (s.trim()) db.exec(s.trim());
    expect(db.prepare(statements()[0]).run().changes).toBe(1);
    expect(db.prepare(statements()[0]).run().changes).toBe(0);
    expect(db.prepare(statements()[0]).run().changes).toBe(0);
    /* An owner turns it off after the fact. A re-run must not turn it back on:
       an owner's decision outlives a migration. */
    db.prepare(
      `UPDATE comms_audience_rules
          SET enabled = 0, decided_at = '2026-08-26T12:00:00.000Z', decided_by = 'u_owner'
        WHERE rule_key = 'partner_own_lp_peers'`,
    ).run();
    expect(db.prepare(statements()[0]).run().changes).toBe(0);
    const row = db
      .prepare(
        `SELECT enabled, decided_by FROM comms_audience_rules
          WHERE rule_key = 'partner_own_lp_peers'`,
      )
      .get() as any;
    expect(row.enabled).toBe(0);
    expect(row.decided_by).toBe("u_owner");
    db.close();
  });

  it("P4 against COPIES of data.db and test.db — the originals are byte-unchanged", () => {
    for (const src of ["data.db", "test.db"]) {
      const abs = join(ROOT, src);
      if (!existsSync(abs)) {
        expect(existsSync(abs)).toBe(false);
        continue;
      }
      const before = sha(abs);
      const db = copyDb(src, `w167_copy_${src}`);
      let ok = true;
      try {
        db.prepare(statements()[0]).run();
      } catch {
        /* The rules table may be absent on a given snapshot — stated, not skipped. */
        ok = false;
      }
      if (ok) {
        const row = db
          .prepare(
            `SELECT enabled FROM comms_audience_rules WHERE rule_key = 'partner_own_lp_peers'`,
          )
          .get() as any;
        expect(row.enabled).toBe(1);
      }
      db.close();
      expect(sha(abs)).toBe(before);
    }
  });

  it("P5 `readRules().length` still equals `AUDIENCE_RULE_KEYS.length` — wave33 pins hold", () => {
    /* The `wave33_msg01` pins compare the two, so a seventh key without a seventh
       row would break them. `ensureWave167OwnLpPeersRule` is what keeps them
       equal on an already-healed database; this asserts the result. */
    const rules = readRules();
    expect(rules.length).toBe(AUDIENCE_RULE_KEYS.length);
    expect(rules.length).toBe(7);
    const keys = rules.map((r) => r.ruleKey).sort();
    expect(keys).toEqual([...AUDIENCE_RULE_KEYS].sort());
  });
});

/** The body of a named top-level function, BRACE-BALANCED.
 *
 *  Written because slicing on a newline-brace picks up the first closing brace at
 *  column zero, which for a function containing a nested block is the wrong one
 *  and quietly truncates the very text a fence assertion is drawn from. Throws
 *  rather than returning an empty string, so a renamed function fails loudly
 *  instead of turning every `not.toContain` in the caller into a vacuous pass. */
export function functionBody(strippedSrc: string, name: string): string {
  const at = strippedSrc.indexOf(`function ${name}`);
  if (at === -1) throw new Error(`functionBody: no function named ${name}`);
  const open = strippedSrc.indexOf("{", at);
  if (open === -1) throw new Error(`functionBody: no body for ${name}`);
  let depth = 0;
  for (let i = open; i < strippedSrc.length; i += 1) {
    const ch = strippedSrc[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return strippedSrc.slice(open, i + 1);
    }
  }
  throw new Error(`functionBody: unbalanced braces for ${name}`);
}

/* ── the comment stripper, and its own proof ────────────────────────────────
   A builder in this session shipped a conclusion drawn from a stripper that had
   desynced on an apostrophe inside JSX prose, so a file explained only in a
   comment passed its fence. This stripper is therefore (a) state-machine based
   over block comments, line comments AND all three string forms, and (b) never
   trusted: every caller above asserts that a KNOWN comment sentence is ABSENT
   from the stripped text before drawing any conclusion from it. */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      out += " ";
      continue;
    }
    if (c === "/" && d === "/") {
      const end = src.indexOf("\n", i + 2);
      i = end === -1 ? n : end;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i += 1;
          break;
        }
        /* An unterminated single/double quote must not swallow the rest of the
           file — that is precisely the desync mode that produced a false pass. */
        if (quote !== "`" && src[i] === "\n") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

describe("WAVE 167 · S — the stripper is proved before it is used", () => {
  it("S1 it removes block, line and JSX-prose comments and keeps string literals", () => {
    const sample = [
      "/* a block comment mentioning captable_commits */",
      "const a = \"captable_commits\"; // a line comment mentioning company_members",
      "/* an apostrophe in prose: the partner's own LPs — this is the desync case */",
      "const b = `template with captable_commits`;",
      "const c = 'single with company_members';",
    ].join("\n");
    const s = stripComments(sample);
    expect(s).not.toContain("a block comment");
    expect(s).not.toContain("a line comment");
    expect(s).not.toContain("desync case");
    /* The apostrophe did NOT swallow the following lines. */
    expect(s).toContain("`template with captable_commits`");
    expect(s).toContain("'single with company_members'");
    expect(s).toContain("\"captable_commits\"");
  });

  it("S2 an unterminated quote does not swallow the remainder of the file", () => {
    const sample = "const bad = 'unterminated\nconst good = \"kept\";\n";
    const s = stripComments(sample);
    expect(s).toContain("kept");
  });
});

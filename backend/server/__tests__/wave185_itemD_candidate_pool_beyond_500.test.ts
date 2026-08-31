/**
 * WAVE 185 · ITEM D · R156.5 (Q7) — THE PROOF THAT WAS MISSING:
 * `candidateIds.add(p)` IS LOAD-BEARING, AND THE FIXTURES NEVER REACHED IT.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAVE 185 COULD NOT PROVE. Reverting `candidateIds.add(p)` from the
 * `cap_table_peer` branch of `GET /api/comms/users` (`server/commsStore.ts`
 * :3459-3461) broke NO test — the Item A suite and the wave-167/168 suites all
 * stayed green. An unproven change on a confidentiality path is not shippable,
 * so this file either proves the line or condemns it.
 *
 * WHY EVERY EXISTING FIXTURE MISSES IT. `candidateIds` is seeded at
 * `commsStore.ts:3408-3409` as `Object.keys(COMMS_USERS)` UNION
 * `listDurableCommsUserIds(500)`, and that helper is
 * `SELECT id FROM users … ORDER BY id ASC LIMIT 500`
 * (`server/lib/commsUserDirectory.ts:344-359`). Every fixture in this repository
 * seeds a couple of dozen users, so the 500-row window has ALWAYS contained every
 * seeded user. Inside that window `candidateIds` already holds the peer, and
 * whether the branch adds them again is unobservable. That is precisely why the
 * revert was silent — not because the line is dead.
 *
 * WHAT THE LINE ACTUALLY DOES, AND WHAT IT DOES NOT DO. The render loop is
 * `commsStore.ts:3543-3545`:
 *     for (const id of Array.from(candidateIds)) {
 *       const isSelf = id === viewerId;
 *       if (!isSelf && !isAdmin && !peers.has(id)) continue;
 * So `candidateIds` membership is a WORK LIST, not permission — `peers.has(id)`
 * is the gate, and it is untouched by this wave. Adding an id to `candidateIds`
 * therefore widens NOTHING (asserted in group N below, not merely argued).
 * Omitting it, however, means an entitled peer outside the 500-row window is
 * never iterated at all: they land in `peers` and are never considered. A silent
 * drop of a legitimately entitled peer, with nothing logged.
 *
 * THE FIXTURE THIS FILE BUILDS. 620 filler users whose ids sort BEFORE the cast
 * (`u_0w185d_…` — the digit `0` precedes any letter under SQLite's default BINARY
 * collation), so the 500-row window is saturated by fillers and every member of
 * the cast is provably OUTSIDE it (group V asserts exactly that, twice). The
 * entitled peers are then reached over the real HTTP route with the real
 * middleware, the real audience rules and the real privacy resolution.
 *
 * THE TWO SIBLING BRANCHES. `chapter_peer` (`commsStore.ts:3463-3465`) and
 * `follow_peer` (`:3466-3468`) called only `peers.add(p)` and carried the
 * IDENTICAL latent silent drop, while `partner_engaged_company_people`,
 * `partner_team_peers` and `partner_own_lp_peers` all already did both. D-2 and
 * D-3 are their proofs, each with its own >500 fixture.
 *
 * REVERT PROOF. `build_log/wave185/adversarial/` records this file run three
 * times with each of the three `candidateIds.add(p)` calls removed in turn; each
 * revert turns its own test RED and leaves the other two green.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { registerCommsRoutes } from "../commsStore";
import { applyCommsDelegatedContextSchema } from "../lib/applyCommsDelegatedContextSchema";
import {
  listDurableCommsUserIds,
  durableCapTablePeerIds,
  durableChapterPeerIds,
  durableFollowPeerIds,
  durableCommsUserExists,
} from "../lib/commsUserDirectory";

/* ── the cast ────────────────────────────────────────────────────────────────
   Every id begins `u_zw185d_`, which sorts AFTER all 620 `u_0w185d_` fillers and
   after every pre-existing `u_a…`/`u_ext…` id in the tree, so the whole cast is
   outside the 500-row candidate window by construction. */
const VIEWER = "u_zw185d_viewer"; // an ordinary investor
const CAPTABLE_PEER = "u_zw185d_captable_peer"; // entitled via captable_commits
const CHAPTER_PEER = "u_zw185d_chapter_peer"; // entitled via chapter_memberships
const FOLLOW_FOUNDER = "u_zw185d_follow_founder"; // entitled via company_followers
const STRANGER = "u_zw185d_stranger"; // entitled via NOTHING — the fence

const SHARED_CO = "co_w185d_shared";
const FOLLOWED_CO = "co_w185d_followed";
const OTHER_CO = "co_w185d_other";
const CHAPTER = "chap_w185d";

const FILLERS = 620; // > 500, so the window can never reach the cast
const now = () => new Date().toISOString();
let seq = 940000;

/** THROWS. A swallowed fixture error is a vacuous green, and a vacuous green on a
 *  confidentiality surface is worse than a red. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w185d fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string, role: string, name: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at, anonymized_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL, NULL)`,
    id,
    `${id}@w185d.test.invalid`,
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

/** A committed, non-deleted ledger row on the SACRED `captable_commits` table.
 *  `amount` and `shares` are TEXT columns and are written as string literals: no
 *  `Number()`, `parseInt` or `parseFloat` touches a money value anywhere here. */
function seedCommit(companyId: string, investorId: string): void {
  seq += 1;
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '1', 'USD', '1', 'committed', '', ?, NULL)`,
    `ccm_w185d_${companyId}_${investorId}`,
    seq,
    now(),
    `inv_w185d_${seq}`,
    `rnd_w185d_${companyId}`,
    companyId,
    investorId,
    `hash_w185d_${seq}`,
  );
}

let app: Express;

const asUser = (r: request.Test, id: string, role = "investor") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);
const usersFor = (as: string, role = "investor") =>
  asUser(request(app).get("/api/comms/users"), as, role);
const idsOf = (body: unknown): string[] =>
  (body as Array<{ id: string }>).map((u) => u.id);

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);

  /* 620 filler users. Their only job is to saturate the 500-row window, which is
     the live condition every existing fixture is too small to reproduce. */
  for (let i = 0; i < FILLERS; i += 1) {
    seedUser(`u_0w185d_f${String(i).padStart(5, "0")}`, "investor", `W185D Filler ${i}`);
  }

  for (const [id, role] of [
    [VIEWER, "investor"],
    [CAPTABLE_PEER, "investor"],
    [CHAPTER_PEER, "investor"],
    [FOLLOW_FOUNDER, "founder"],
    [STRANGER, "investor"],
  ] as Array<[string, string]>) {
    seedUser(id, role, `W185D ${id}`);
  }

  seedCompany(SHARED_CO, "W185D Shared Operating Co");
  seedCompany(FOLLOWED_CO, "W185D Followed Co");
  seedCompany(OTHER_CO, "W185D Unrelated Co");

  /* ENTITLEMENT 1 — cap table. SHARED_CO is deliberately NOT registered in `spv`,
     so `notSpvBackedSql` does not exclude it and these two are genuine cap-table
     counterparties under the owner's 2026-06-25 policy. */
  seedCommit(SHARED_CO, VIEWER);
  seedCommit(SHARED_CO, CAPTABLE_PEER);

  /* THE FENCE — STRANGER holds a company the viewer has no position in. */
  seedCommit(OTHER_CO, STRANGER);

  /* ENTITLEMENT 2 — chapter. Chapter-scoped rows are tenanted
     `tenant_chap_<chapterId>`, not `tenant_platform`. */
  for (const uid of [VIEWER, CHAPTER_PEER]) {
    run(
      `INSERT OR REPLACE INTO chapter_memberships
         (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, 'member', 'active', ?, ?, ?, NULL)`,
      `chm_w185d_${uid}`,
      `tenant_chap_${CHAPTER}`,
      CHAPTER,
      uid,
      now(),
      now(),
      now(),
    );
  }

  /* ENTITLEMENT 3 — follow. The viewer follows FOLLOWED_CO; FOLLOW_FOUNDER is an
     active founder of it. Both directions of the D1 follow relation are the rule;
     this fixture exercises the follower→founder direction. */
  run(
    `INSERT OR REPLACE INTO company_followers (id, tenant_id, user_id, company_id, created_at, updated_at, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, NULL)`,
    `cf_w185d_${VIEWER}`,
    VIEWER,
    FOLLOWED_CO,
    now(),
    now(),
  );
  run(
    `INSERT OR REPLACE INTO company_members
       (id, company_id, user_id, role, tenant_id, is_active, joined_at, deleted_at)
     VALUES (?, ?, ?, 'founder', 'tenant_platform', 1, ?, NULL)`,
    `cm_w185d_${FOLLOW_FOUNDER}`,
    FOLLOWED_CO,
    FOLLOW_FOUNDER,
    now(),
  );
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP V — ANTI-VACUITY. Without these, every assertion below could pass for a
   reason that has nothing to do with the 500-row window, and this whole file
   would be the same untested green that wave 185 already reported.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · D · anti-vacuity — the cast really is OUTSIDE the 500-row window", () => {
  it("V-0 the candidate window is exactly 500 rows and is saturated by fillers", () => {
    const window = listDurableCommsUserIds(500);
    expect(window).toHaveLength(500);
    /* Every id in the window is a filler, which is only true because 620 > 500. */
    expect(window.every((id) => id.startsWith("u_0w185d_f"))).toBe(true);
  });

  it("V-1 NONE of the entitled peers is in the candidate window", () => {
    const window = new Set(listDurableCommsUserIds(500));
    for (const id of [VIEWER, CAPTABLE_PEER, CHAPTER_PEER, FOLLOW_FOUNDER, STRANGER]) {
      expect(window.has(id)).toBe(false);
    }
  });

  it("V-2 they ARE nonetheless real, resolvable durable users", () => {
    /* So a failure below is a candidate-set failure, not a missing-user failure:
       `commsUserRef` resolves by id and is not capped at 500. */
    for (const id of [CAPTABLE_PEER, CHAPTER_PEER, FOLLOW_FOUNDER, STRANGER]) {
      expect(durableCommsUserExists(id)).toBe(true);
    }
  });

  it("V-3 the three peer RESOLVERS each already return the entitled peer", () => {
    /* The resolvers were never the defect — which is exactly why reverting
       `candidateIds.add(p)` broke no resolver test. The defect is downstream. */
    expect(durableCapTablePeerIds(VIEWER)).toContain(CAPTABLE_PEER);
    expect(durableChapterPeerIds(VIEWER)).toContain(CHAPTER_PEER);
    expect(durableFollowPeerIds(VIEWER)).toContain(FOLLOW_FOUNDER);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP D — THE PROOF. Each of these three FAILS when its branch's
   `candidateIds.add(p)` is removed, and passes with it present.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · D · an entitled peer beyond row 500 is REACHABLE", () => {
  it("D-1 cap_table_peer — the peer is rendered by GET /api/comms/users", async () => {
    const res = await usersFor(VIEWER);
    expect(res.status).toBe(200);
    /* THE LINE UNDER PROOF: commsStore.ts:3460 `candidateIds.add(p)`. Without it
       the peer is in `peers` and never iterated, so this id is absent. */
    expect(idsOf(res.body)).toContain(CAPTABLE_PEER);
  });

  it("D-2 chapter_peer — the SIBLING branch, same latent drop, same fix", async () => {
    const res = await usersFor(VIEWER);
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toContain(CHAPTER_PEER);
  });

  it("D-3 follow_peer — the second SIBLING branch", async () => {
    const res = await usersFor(VIEWER);
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toContain(FOLLOW_FOUNDER);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP N — THE FENCE. `candidateIds` membership is a WORK LIST, not permission.
   These assert that, rather than taking the code comment's word for it.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 185 · D · the candidate set is a WORK LIST, not permission", () => {
  it("N-1 620 filler users are ALL in the candidate set and NONE is reachable", async () => {
    const res = await usersFor(VIEWER);
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    /* The window is 500 fillers, so if candidate membership were permission this
       response would carry 500 strangers. It carries none of them. */
    expect(ids.filter((id) => id.startsWith("u_0w185d_f"))).toEqual([]);
  });

  it("N-2 a cap-table holder of a company the viewer does NOT hold stays unreachable", async () => {
    const res = await usersFor(VIEWER);
    expect(idsOf(res.body)).not.toContain(STRANGER);
    /* And symmetrically: adding the viewer's peers to `candidateIds` gave the
       stranger nothing either. */
    const back = await usersFor(STRANGER);
    expect(idsOf(back.body)).not.toContain(VIEWER);
    expect(idsOf(back.body)).not.toContain(CAPTABLE_PEER);
  });

  it("N-3 the viewer's own three entitlements do not leak to each other", async () => {
    /* The chapter peer shares a chapter with the VIEWER and nothing at all with
       the cap-table peer. Widening the viewer's candidate set must not make the
       viewer's relationships transitive. */
    const res = await usersFor(CHAPTER_PEER);
    const ids = idsOf(res.body);
    expect(ids).toContain(VIEWER);
    expect(ids).not.toContain(CAPTABLE_PEER);
    expect(ids).not.toContain(STRANGER);
  });

  it("N-4 an unauthenticated caller still receives NOTHING", async () => {
    const res = await request(app).get("/api/comms/users");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

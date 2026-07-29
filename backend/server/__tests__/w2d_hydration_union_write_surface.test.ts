/**
 * server/__tests__/w2d_hydration_union_write_surface.test.ts
 *
 * STAGE D BLOCKER FIX — B4a (hydration must never SHRINK a participant list)
 * and B4b (a company's followers feed is READ-only for followers).
 *
 *   B4a  `ensureAnchoredChannel` rebuilt anchored channels with
 *        `participants.length ? participants : existing.participantUserIds` —
 *        the re-derived set REPLACED the persisted one. Any persisted
 *        participant that is not re-derivable from durable rows (a Stage-C
 *        backfilled round investor, a seeded or legacy member) was SILENTLY
 *        DROPPED at every restart. That is an access removal nobody requested
 *        and nobody can see. Fixed by a de-duplicated, persisted-first UNION.
 *
 *   B4b  D5 made `followers__<companyId>` exist on live for the first time.
 *        Following is open self-service, so ANY authenticated investor could
 *        follow a company and then POST into that channel (200), fanning an
 *        unmoderated message into the founder's and every follower's inbox.
 *        Now only the company's ACTIVE founders may write; the READ path is
 *        untouched.
 *
 * Ids are NON-seed (`u_w2dfix_*`) so no assertion can be satisfied by demo-seed
 * state. Anti-vacuity pre-image and observed pre-fix failure modes are recorded
 * in /home/user/workspace/work/_W2D_BLOCKER_FIX_RESULT.md; tests labelled
 * REGRESSION GUARD also pass pre-fix and are not counted as evidence.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { resolveDisplayName } from "../lib/userPrivacyResolver";
import {
  registerCommsRoutes,
  restorePostFromDb,
  hydrateCommsStore,
  _commsTest,
} from "../commsStore";

/* ------------------------------------------------------------------ actors */

const FOUNDER = "u_w2dfix_founder";   // active company_members row on CO
const FOLLOWER = "u_w2dfix_follower"; // durable company_followers row on CO
const GHOST = "u_w2dfix_ghost";       // PERSISTED channel participant, NOT re-derivable
const HOLDER = "u_w2dfix_holder";     // committed captable_commits row on CO
const STRANGER = "u_w2dfix_stranger"; // nothing at all

const CO = "co_w2dfix";
const CO_NAME = "Hydration Union Co";
const HQ = "Toronto, CA";
const RND = "rnd_w2dfix";
const BODY = "hydration union body";

let app: Express;

const now = (): string => new Date().toISOString();

/** THROWS on SQL failure — a fixture that silently fails would fake every green. */
function run(sql: string, ...args: unknown[]): void {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w2dfix fixture] ${(err as Error).message}\nSQL: ${sql}`);
  }
}

const MINTED_POSTS = new Set<string>();
const POST_RESTORE_HINTS: Record<string, Record<string, unknown>> = {};

function seedUser(id: string, name: string, role = "investor"): void {
  run(
    `INSERT OR REPLACE INTO users
       (id, tenant_id, email, name, role, is_demo, deleted_at, display_name, location)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL, NULL, NULL)`,
    id, `${id}@w2dfix.example`, name, role,
  );
}

function seedCompany(id: string, name: string, hq: string): void {
  run(
    `INSERT OR REPLACE INTO companies
       (id, tenant_id, name, hq, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, 0, NULL)`,
    id, name, hq,
  );
}

function seedFounderMembership(user: string, companyId: string, rowId: string, active = 1): void {
  run(
    `INSERT OR REPLACE INTO company_members
       (id, company_id, user_id, role, tenant_id, is_active, joined_at, deleted_at)
     VALUES (?, ?, ?, 'founder', 'tenant_platform', ?, ?, NULL)`,
    rowId, companyId, user, active, now(),
  );
}

function seedFollowRow(user: string, companyId: string): void {
  run(
    `INSERT OR REPLACE INTO company_followers
       (id, tenant_id, user_id, company_id, created_at, updated_at, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, NULL)`,
    `cf_w2dfix_${user}_${companyId}`, user, companyId, now(), now(),
  );
}

function seedCommit(rowId: string, investor: string, companyId: string): void {
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, deleted_at)
     VALUES (?, 'tenant_platform', 1, ?, ?, ?, ?, ?, '1000', 'USD', '10', 'committed', 'p', ?, NULL)`,
    rowId, now(), `inv_${rowId}`, RND, companyId, investor, `h_${rowId}`,
  );
}

/** A PERSISTED channel row, as a restart would find it (the pre-image of hydration). */
function seedPersistedChannel(
  id: string,
  kind: string,
  participants: string[],
  anchors: { companyId?: string | null; roundId?: string | null } = {},
): void {
  run(
    `INSERT OR REPLACE INTO comms_channels
       (id, kind, participant_user_ids_json, created_at, metadata_json, deleted_at, company_id, round_id, chapter_id)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    id,
    kind,
    JSON.stringify(participants),
    now(),
    JSON.stringify({ title: `${kind} ${id}`, ...(anchors.companyId ? { companyId: anchors.companyId } : {}) }),
    anchors.companyId ?? null,
    anchors.roundId ?? null,
  );
}

function seedPost(
  id: string,
  opts: { author?: string; authorKind?: "user" | "company"; visibility?: string; companyId?: string | null } = {},
): void {
  const author = opts.author ?? FOUNDER;
  MINTED_POSTS.add(id);
  run(
    `INSERT OR REPLACE INTO network_posts
       (id, tenant_id, author_user_id, audience, body, content_json, likes, comments,
        created_at, updated_at, deleted_at, scope, company_id, chapter_id)
     VALUES (?, 'tenant_platform', ?, 'all', ?, ?, 0, 0, ?, ?, NULL, 'network', ?, NULL)`,
    id, author, BODY, JSON.stringify({ companyId: opts.companyId ?? null }),
    now(), now(), opts.companyId ?? null,
  );
  restorePostFromDb({
    id,
    authorUserId: author,
    body: BODY,
    createdAt: now(),
    ...(opts.authorKind ? { authorKind: opts.authorKind } : {}),
    ...(opts.visibility ? { visibility: opts.visibility } : {}),
    ...(opts.companyId !== undefined ? { companyId: opts.companyId } : {}),
  } as any);
}

/** SIMULATED RESTART — in-memory maps cleared, then hydrated from the DB only. */
async function simulateRestart(): Promise<void> {
  _commsTest.channels.clear();
  _commsTest.messages.clear();
  _commsTest.posts.clear();
  await hydrateCommsStore();
  for (const id of MINTED_POSTS) {
    const row = rawDb()
      .prepare(
        `SELECT id, author_user_id, body, created_at, company_id FROM network_posts
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as any;
    if (!row) continue;
    restorePostFromDb({
      id: row.id,
      authorUserId: row.author_user_id,
      body: row.body,
      createdAt: row.created_at,
      ...(POST_RESTORE_HINTS[id] ?? {}),
      ...(row.company_id ? { companyId: row.company_id } : {}),
    } as any);
  }
}

function wipe(): void {
  for (const id of MINTED_POSTS) {
    const ch = _commsTest.posts.get(id)?.channelId;
    _commsTest.posts.delete(id);
    if (ch) _commsTest.channels.delete(ch);
    run("DELETE FROM network_posts WHERE id = ?", id);
  }
  MINTED_POSTS.clear();
  for (const k of Object.keys(POST_RESTORE_HINTS)) delete POST_RESTORE_HINTS[k];
  _commsTest.channels.delete(`captable__${CO}`);
  _commsTest.channels.delete(`followers__${CO}`);
  _commsTest.channels.delete(`softcircle__${RND}`);
  _commsTest.messages.clear();
  run("DELETE FROM comms_messages WHERE channel_id LIKE '%w2dfix%'");
  run("DELETE FROM comms_channels WHERE id LIKE '%w2dfix%'");
  run("DELETE FROM company_members WHERE id LIKE 'cm_w2dfix%'");
  run("DELETE FROM captable_commits WHERE id LIKE 'ct_w2dfix%'");
  run("DELETE FROM company_followers WHERE user_id LIKE 'u_w2dfix%'");
  run("DELETE FROM companies WHERE id LIKE 'co_w2dfix%'");
  run("DELETE FROM users WHERE id LIKE 'u_w2dfix%'");
}

function seedWorld(): void {
  seedUser(FOUNDER, "Fix Founder", "founder");
  seedUser(FOLLOWER, "Fix Follower");
  seedUser(GHOST, "Fix Ghost");
  seedUser(HOLDER, "Fix Holder");
  seedUser(STRANGER, "Fix Stranger");
  seedCompany(CO, CO_NAME, HQ);
  seedFounderMembership(FOUNDER, CO, "cm_w2dfix_1");
  seedFollowRow(FOLLOWER, CO);
  seedCommit("ct_w2dfix_1", HOLDER, CO);
}

/* ----------------------------------------------------------------- helpers */

const asUser = (r: request.Test, id: string, role = "investor") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);

const detail = (postId: string, as: string, role = "investor") =>
  asUser(request(app).get(`/api/comms/posts/${postId}`), as, role);

const sendMessage = (channelId: string, as: string, role = "investor") =>
  asUser(request(app).post(`/api/comms/channels/${channelId}/messages`), as, role).send({
    body: "attempted broadcast",
  });

const readChannel = (channelId: string, as: string, role = "investor") =>
  asUser(request(app).get(`/api/comms/channels/${channelId}`), as, role);

const participantsOf = (channelId: string): string[] =>
  _commsTest.channels.get(channelId)?.participantUserIds ?? [];

const persistedParticipantsOf = (channelId: string): string[] => {
  const row = rawDb()
    .prepare(`SELECT participant_user_ids_json FROM comms_channels WHERE id = ?`)
    .get(channelId) as { participant_user_ids_json?: string } | undefined;
  return row?.participant_user_ids_json ? JSON.parse(row.participant_user_ids_json) : [];
};

/** Materialise `followers__CO` through the real read path after a restart. */
async function rebuildFollowersChannel(postId = "post_w2dfix_cf"): Promise<void> {
  POST_RESTORE_HINTS[postId] = { authorKind: "company" };
  seedPost(postId, { author: FOUNDER, authorKind: "company", companyId: CO });
  await simulateRestart();
  await detail(postId, FOUNDER, "founder");
}

beforeAll(() => {
  getDb();
  /* The SACRED privacy resolver creates `profilestore_user_privacy` lazily;
     touch it once so the THROWING fixture helper is never its first caller. */
  resolveDisplayName("u_w2dfix_bootstrap", "u_w2dfix_bootstrap", "message", { legalName: "x" });
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);
});

beforeEach(() => {
  wipe();
  seedWorld();
});
afterEach(() => {
  wipe();
});

/* ======================================================================== */
/* B4a — HYDRATION IS A UNION, NEVER A REPLACEMENT                          */
/* ======================================================================== */

describe("B4a — a restart never shrinks an anchored channel's participants", () => {
  it("KEEPS a persisted participant that no durable row can re-derive", async () => {
    seedPersistedChannel(`followers__${CO}`, "company_followers", [GHOST, FOUNDER], { companyId: CO });
    await rebuildFollowersChannel();
    const p = participantsOf(`followers__${CO}`);
    expect(p).toContain(GHOST);     // the silent drop
    expect(p).toContain(FOUNDER);
    expect(p).toContain(FOLLOWER);  // and the re-derived set is still merged in
  });

  it("that kept participant KEEPS ACCESS after the restart (the user-visible harm)", async () => {
    seedPersistedChannel(`followers__${CO}`, "company_followers", [GHOST, FOUNDER], { companyId: CO });
    await rebuildFollowersChannel("post_w2dfix_cf_access");
    const r = await detail("post_w2dfix_cf_access", GHOST);
    expect(r.status).toBe(200);
    expect(r.body.post.body).toBe(BODY);
  });

  it("the same holds for a cap_table channel", async () => {
    seedPersistedChannel(`captable__${CO}`, "cap_table", [GHOST, FOUNDER], { companyId: CO });
    POST_RESTORE_HINTS["post_w2dfix_ct"] = { visibility: "cap_table" };
    seedPost("post_w2dfix_ct", { author: FOUNDER, visibility: "cap_table", companyId: CO });
    await simulateRestart();
    expect((await detail("post_w2dfix_ct", FOUNDER, "founder")).status).toBe(200);
    const p = participantsOf(`captable__${CO}`);
    expect(p).toContain(GHOST);
    expect(p).toContain(HOLDER);
    expect((await detail("post_w2dfix_ct", GHOST)).status).toBe(200);
  });

  it("the union is DE-DUPLICATED and persisted-first, so the order is stable across restarts", async () => {
    seedPersistedChannel(`followers__${CO}`, "company_followers", [GHOST, FOLLOWER, GHOST], { companyId: CO });
    await rebuildFollowersChannel("post_w2dfix_cf_order");
    const first = participantsOf(`followers__${CO}`);
    expect(first[0]).toBe(GHOST);
    expect(first.filter((u) => u === GHOST).length).toBe(1);
    expect(new Set(first).size).toBe(first.length);
    await simulateRestart();
    await detail("post_w2dfix_cf_order", FOUNDER, "founder");
    expect(participantsOf(`followers__${CO}`)).toEqual(first);
  });

  it("the merged list is PERSISTED, so it cannot decay over repeated restarts", async () => {
    seedPersistedChannel(`followers__${CO}`, "company_followers", [GHOST], { companyId: CO });
    await rebuildFollowersChannel("post_w2dfix_cf_persist");
    for (let i = 0; i < 3; i++) {
      await simulateRestart();
      await detail("post_w2dfix_cf_persist", FOUNDER, "founder");
    }
    expect(persistedParticipantsOf(`followers__${CO}`)).toContain(GHOST);
    expect(participantsOf(`followers__${CO}`)).toContain(GHOST);
  });

  it("REGRESSION GUARD: a STRANGER is still denied after the union merge", async () => {
    seedPersistedChannel(`followers__${CO}`, "company_followers", [GHOST], { companyId: CO });
    await rebuildFollowersChannel("post_w2dfix_cf_stranger");
    expect((await detail("post_w2dfix_cf_stranger", STRANGER)).status).toBe(403);
    expect(participantsOf(`followers__${CO}`)).not.toContain(STRANGER);
  });

  it("REGRESSION GUARD: a channel with no derivable participants and no persisted row is still not materialised", async () => {
    seedCompany("co_w2dfix_empty", "Empty Co", "Nowhere");
    POST_RESTORE_HINTS["post_w2dfix_empty"] = { visibility: "cap_table" };
    seedPost("post_w2dfix_empty", { author: FOUNDER, visibility: "cap_table", companyId: "co_w2dfix_empty" });
    await simulateRestart();
    expect((await detail("post_w2dfix_empty", HOLDER)).status).toBe(403);
    expect(_commsTest.channels.get("captable__co_w2dfix_empty")).toBeUndefined();
  });
});

/* ======================================================================== */
/* SOFT-CIRCLE STAYS OFF (strengthened: the channel now really exists)      */
/* ======================================================================== */

describe("soft_circle channels are never derived or widened by hydration", () => {
  it("REGRESSION GUARD (passes pre-fix, de-vacuified): a PERSISTED soft_circle channel is hydrated verbatim", async () => {
    seedPersistedChannel(`softcircle__${RND}`, "soft_circle", [FOUNDER], { roundId: RND });
    seedCommit("ct_w2dfix_sc", HOLDER, CO); // a round participant that must NOT be derived in
    await simulateRestart();
    const p = participantsOf(`softcircle__${RND}`);
    expect(p).toEqual([FOUNDER]);
    expect(p).not.toContain(HOLDER);
  });

  it("REGRESSION GUARD (passes pre-fix): a soft_circle channel is NEVER created from rows", async () => {
    await simulateRestart();
    expect(_commsTest.channels.get(`softcircle__${RND}`)).toBeUndefined();
    const row = rawDb()
      .prepare(`SELECT id FROM comms_channels WHERE id = ?`)
      .get(`softcircle__${RND}`);
    expect(row).toBeUndefined();
  });
});

/* ======================================================================== */
/* B4b — THE FOLLOWERS FEED IS READ-ONLY FOR FOLLOWERS                      */
/* ======================================================================== */

describe("B4b — only a company's active founders may write to its followers channel", () => {
  it("DENIES a follower's message (open self-service follow was a write grant)", async () => {
    await rebuildFollowersChannel("post_w2dfix_write_follower");
    expect(participantsOf(`followers__${CO}`)).toContain(FOLLOWER);
    const r = await sendMessage(`followers__${CO}`, FOLLOWER);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("followers_channel_read_only");
    const n = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM comms_messages WHERE channel_id = ?`)
      .get(`followers__${CO}`) as { n: number };
    expect(n.n).toBe(0);
  });

  it("DENIES a merely-persisted participant too (participation is not write authority)", async () => {
    seedPersistedChannel(`followers__${CO}`, "company_followers", [GHOST, FOUNDER], { companyId: CO });
    await rebuildFollowersChannel("post_w2dfix_write_ghost");
    expect(participantsOf(`followers__${CO}`)).toContain(GHOST);
    const r = await sendMessage(`followers__${CO}`, GHOST);
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("followers_channel_read_only");
  });

  it("REGRESSION GUARD (passes pre-fix): ALLOWS the company's active founder to broadcast", async () => {
    await rebuildFollowersChannel("post_w2dfix_write_founder");
    const r = await sendMessage(`followers__${CO}`, FOUNDER, "founder");
    expect(r.status).toBe(200);
    expect(r.body.body).toBe("attempted broadcast");
  });

  it("FAILS CLOSED when the company has no active founder row", async () => {
    seedFounderMembership(FOUNDER, CO, "cm_w2dfix_1", 0); // deactivated founder
    seedPersistedChannel(`followers__${CO}`, "company_followers", [FOUNDER, FOLLOWER], { companyId: CO });
    await simulateRestart();
    const r = await sendMessage(`followers__${CO}`, FOUNDER, "founder");
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("followers_channel_read_only");
  });

  it("the READ path is untouched — a denied writer can still read the channel", async () => {
    await rebuildFollowersChannel("post_w2dfix_read_after_deny");
    expect((await sendMessage(`followers__${CO}`, FOLLOWER)).status).toBe(403);
    const r = await readChannel(`followers__${CO}`, FOLLOWER);
    expect(r.status).toBe(200);
    expect((await detail("post_w2dfix_read_after_deny", FOLLOWER)).status).toBe(200);
  });

  it("REGRESSION GUARD: a non-participant is still denied with the plain membership 403", async () => {
    await rebuildFollowersChannel("post_w2dfix_write_stranger");
    const r = await sendMessage(`followers__${CO}`, STRANGER);
    expect(r.status).toBe(403);
    expect(r.body.error).toBeUndefined(); // the pre-existing membership denial, not the new one
  });

  it("REGRESSION GUARD: cap_table channel writes are unaffected by the new guard", async () => {
    seedPersistedChannel(`captable__${CO}`, "cap_table", [FOUNDER, HOLDER], { companyId: CO });
    await simulateRestart();
    const r = await sendMessage(`captable__${CO}`, HOLDER);
    expect(r.status).toBe(200);
  });
});

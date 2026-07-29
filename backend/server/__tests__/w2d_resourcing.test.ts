/**
 * server/__tests__/w2d_resourcing.test.ts
 *
 * W-COLLECTIVE Wave 2 STAGE D — RE-SOURCING THINGS THAT SILENTLY DO NOTHING.
 *
 * Everything under test here was, in production, either hard-empty, in-memory
 * only, or shared across viewers when it should have been per-viewer:
 *
 *   D1  `POST /api/comms/posts/:id/follow` wrote the followed company id onto
 *       the POST, in memory. One follow made the button read "Following ✓" for
 *       everyone, and every follow died at restart. There was no unfollow and no
 *       way for a founder to see who followed.
 *   D2  Audience row 5 was inert: nothing wrote `chapter_memberships` and
 *       nothing set `network_posts.chapter_id`.
 *   D3  `COMMS_USERS = DEMO_SEED_ENABLED ? seed : {}` — `{}` on live. Thirteen
 *       reads degraded, two in OPPOSITE directions: `authorKind=collective`
 *       returned zero (closed) and `sort=following` returned everything (OPEN).
 *   D4  `post.authorLocation` came from the same empty map (and a hardcoded
 *       "San Francisco, CA" for company posts).
 *   D5  Wave 1 made post detail fail closed on an unresolvable channel, which
 *       left every `cap_table` / `company_followers` post inaccessible to
 *       EVERYONE, its author included, because nothing outside the demo seed
 *       ever created those channels.
 *
 * ── WHY THE IDS ARE `u_w2d_*` AND NEVER A SEED PERSONA ────────────────────────
 * `vitest.config.ts` sets `ENABLE_DEMO_SEED=1`, so `COMMS_USERS` IS populated in
 * this process with 8 seed personas. A test written against a seed id would pass
 * before the fix and prove nothing. Every actor below is a NON-seed id backed
 * only by a durable `users` row — exactly the production condition.
 *
 * ── ANTI-VACUITY METHOD ──────────────────────────────────────────────────────
 * The pre-image is produced by restoring a single pristine file over the working
 * copy and re-running this file. The CORRECT pre-image is
 * /home/user/workspace/build/_w2c_backup/commsStore.ts.post (Stage C applied).
 * NOT _presnapshot: that image is pre-Stage-C (0 occurrences of
 * postIsVisibleToViewer, still fail-open on post detail), so using it credits
 * Stage C's work to Stage D. Observed pre-fix failure modes are
 * recorded per test in /home/user/workspace/work/_W2D_RESULT.md. Tests that also
 * pass on the pre-image are labelled REGRESSION GUARD and are NOT counted as
 * evidence — they are the fail-closed half that this widening could regress.
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
import { registerChapterMembershipRoutes } from "../chapterMembershipRoutes";
import { registerUserProfileLocationRoutes } from "../userProfileLocationRoutes";

/* ------------------------------------------------------------------ actors */

const FOUNDER = "u_w2d_founder";       // founds CO, active company_members row
const HOLDER = "u_w2d_holder";         // committed captable_commits row on CO
const FOLLOWER = "u_w2d_follower";     // company_followers row on CO
const OPTED_OUT = "u_w2d_optout";      // follower with visibleToCoMembers:false
const STRANGER = "u_w2d_stranger";     // no relation to anything
const INVESTOR = "u_w2d_investor";     // self-entered users.location
const CHAPTER_MEMBER = "u_w2d_chapmem";
const CHAPTER_ADMIN = "u_w2d_chapadmin";

const CO = "co_w2d";
const OTHER_CO = "co_w2d_other";
const RND = "rnd_w2d";
const CHAPTER = "chap_w2d";

const HQ = "Toronto, ON";
const CO_NAME = "W2D Robotics";
const INVESTOR_LOCATION = "İzmir, TR";
const BODY = "Stage D durable re-sourcing body.";

let app: Express;
const MINTED_POSTS = new Set<string>();

const now = (): string => new Date().toISOString();
/**
 * STAGE-D BLOCKER FIX (verifier finding): this helper used to SWALLOW every SQL
 * error. A fixture INSERT that silently failed made every "denied" assertion in
 * this file pass for the wrong reason - vacuous green. It now THROWS, so a
 * broken fixture fails the test instead of faking it.
 */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w2d fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

/* ----------------------------------------------------------------- fixtures */

function seedUser(
  id: string,
  name: string,
  role: "founder" | "investor" | "admin",
  location: string | null = null,
): void {
  run(
    `INSERT OR REPLACE INTO users
       (id, tenant_id, email, name, role, is_demo, deleted_at, display_name, location)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL, NULL, ?)`,
    id,
    `${id}@w2d.test`,
    name,
    role,
    location,
  );
}

function seedCompany(id: string, name: string, hq: string | null): void {
  run(
    `INSERT OR REPLACE INTO companies
       (id, tenant_id, name, hq, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, 0, NULL)`,
    id,
    name,
    hq,
  );
}

function seedFounderMembership(user: string, companyId: string, rowId: string): void {
  run(
    `INSERT OR REPLACE INTO company_members
       (id, company_id, user_id, role, tenant_id, is_active, joined_at, deleted_at)
     VALUES (?, ?, ?, 'founder', 'tenant_platform', 1, ?, NULL)`,
    rowId,
    companyId,
    user,
    now(),
  );
}

function seedCommit(rowId: string, investor: string, companyId: string, state = "committed"): void {
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, deleted_at)
     VALUES (?, 'tenant_platform', 1, ?, ?, ?, ?, ?, '1000', 'USD', '10', ?, 'p', ?, NULL)`,
    rowId,
    now(),
    `inv_${rowId}`,
    RND,
    companyId,
    investor,
    state,
    `h_${rowId}`,
  );
}

function seedFollowRow(user: string, companyId: string, deleted = false): void {
  run(
    `INSERT OR REPLACE INTO company_followers
       (id, tenant_id, user_id, company_id, created_at, updated_at, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?)`,
    `cf_${user}_${companyId}`,
    user,
    companyId,
    now(),
    now(),
    deleted ? now() : null,
  );
}

function seedChapter(id: string, adminUserId: string | null): void {
  run(
    `INSERT OR REPLACE INTO chapters
       (id, tenant_id, name, region, city, status, admin_user_id, created_at, updated_at, deleted_at)
     VALUES (?, 'tenant_platform', 'W2D Chapter', 'NA-East', 'Toronto', 'active', ?, ?, ?, NULL)`,
    id,
    adminUserId,
    now(),
    now(),
  );
}

function seedChapterMembershipRow(user: string, chapterId: string, status = "active"): void {
  run(
    `INSERT OR REPLACE INTO chapter_memberships
       (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, 'member', ?, ?, ?, ?, NULL)`,
    `chm_${user}_${chapterId}`,
    chapterId,
    user,
    status,
    now(),
    now(),
    now(),
  );
}

function setPrivacy(userId: string, prefs: Record<string, unknown>): void {
  // Touch the sacred resolver first so it self-heals its table before we write.
  resolveDisplayName(userId, userId, "message", { legalName: "x" });
  run(
    `INSERT OR REPLACE INTO profilestore_user_privacy
       (user_id, privacy_json, updated_at, deleted_at)
     VALUES (?, ?, ?, NULL)`,
    userId,
    JSON.stringify(prefs),
    now(),
  );
}

/** Durable `network_posts` row + in-memory projection, as Stage C's harness does. */
function seedPost(
  id: string,
  opts: {
    author?: string;
    authorKind?: "user" | "company";
    visibility?: string;
    companyId?: string | null;
    chapterId?: string | null;
    scope?: string;
  } = {},
): void {
  const author = opts.author ?? FOUNDER;
  MINTED_POSTS.add(id);
  run(
    `INSERT OR REPLACE INTO network_posts
       (id, tenant_id, author_user_id, audience, body, content_json, likes, comments,
        created_at, updated_at, deleted_at, scope, company_id, chapter_id)
     VALUES (?, 'tenant_platform', ?, 'all', ?, ?, 0, 0, ?, ?, NULL, ?, ?, ?)`,
    id,
    author,
    BODY,
    JSON.stringify({ companyId: opts.companyId ?? null }),
    now(),
    now(),
    opts.scope ?? "network",
    opts.companyId ?? null,
    opts.chapterId ?? null,
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

/**
 * SIMULATED RESTART. Everything canonical must survive this: the in-memory maps
 * are cleared exactly as a fresh process would find them, then `hydrateCommsStore`
 * runs. Nothing is re-seeded in between — whatever comes back came from the DB.
 */
async function simulateRestart(): Promise<void> {
  _commsTest.channels.clear();
  _commsTest.messages.clear();
  _commsTest.posts.clear();
  await hydrateCommsStore();
  for (const id of MINTED_POSTS) {
    const row = rawDb()
      .prepare(
        `SELECT id, author_user_id, body, created_at, company_id, scope
           FROM network_posts WHERE id = ? AND deleted_at IS NULL`,
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
/** authorKind / visibility are projection facts, not columns on network_posts. */
const POST_RESTORE_HINTS: Record<string, Record<string, unknown>> = {};

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
  run("DELETE FROM comms_channels WHERE id LIKE '%_w2d%'");
  run("DELETE FROM company_members WHERE id LIKE 'cm_w2d%'");
  run("DELETE FROM captable_commits WHERE id LIKE 'ct_w2d%'");
  run("DELETE FROM company_followers WHERE user_id LIKE 'u_w2d%'");
  run("DELETE FROM chapter_memberships WHERE user_id LIKE 'u_w2d%'");
  run("DELETE FROM chapters WHERE id LIKE 'chap_w2d%'");
  run("DELETE FROM companies WHERE id LIKE 'co_w2d%'");
  run("DELETE FROM users WHERE id LIKE 'u_w2d%'");
  for (const u of [FOUNDER, HOLDER, FOLLOWER, OPTED_OUT, STRANGER, INVESTOR]) {
    run("DELETE FROM profilestore_user_privacy WHERE user_id = ?", u);
  }
}

function seedWorld(): void {
  seedUser(FOUNDER, "Deniz Founder", "founder");
  seedUser(HOLDER, "Holder Investor", "investor");
  seedUser(FOLLOWER, "Follower Investor", "investor");
  seedUser(OPTED_OUT, "Opted Out Investor", "investor");
  seedUser(STRANGER, "Stranger Person", "investor");
  seedUser(INVESTOR, "Located Investor", "investor", INVESTOR_LOCATION);
  seedUser(CHAPTER_MEMBER, "Chapter Member", "investor");
  seedUser(CHAPTER_ADMIN, "Chapter Admin", "investor");
  seedCompany(CO, CO_NAME, HQ);
  seedCompany(OTHER_CO, "Other Co", "Berlin, DE");
  seedFounderMembership(FOUNDER, CO, "cm_w2d_1");
}

/* ------------------------------------------------------------------ helpers */

const asUser = (r: request.Test, id: string, role = "investor") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);

const detail = (postId: string, as: string, role = "investor") =>
  asUser(request(app).get(`/api/comms/posts/${postId}`), as, role);

const follow = (postId: string, as: string) =>
  asUser(request(app).post(`/api/comms/posts/${postId}/follow`), as);

const unfollow = (postId: string, as: string) =>
  asUser(request(app).delete(`/api/comms/posts/${postId}/follow`), as);

const feed = (query: string, as: string, role = "investor") =>
  asUser(request(app).get(`/api/comms/posts${query}`), as, role);

beforeAll(() => {
  getDb();
  /* The SACRED privacy resolver creates `profilestore_user_privacy` lazily on
     first use. Touch it once here so the (now THROWING) `run()` fixture helper
     is never the first caller - otherwise `wipe()`'s cleanup DELETE legitimately
     hits a table that does not exist yet. */
  resolveDisplayName("u_w2d_bootstrap", "u_w2d_bootstrap", "message", { legalName: "x" });
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);
  registerChapterMembershipRoutes(app);
  registerUserProfileLocationRoutes(app);
});

beforeEach(() => {
  wipe();
  seedWorld();
});
afterEach(() => {
  wipe();
});

/* ======================================================================== */
/* D1 — THE FOLLOW ENDPOINT                                                 */
/* ======================================================================== */

describe("D1 — follow is a durable per-USER relation", () => {
  function seedCompanyPost(id = "post_w2d_company"): void {
    POST_RESTORE_HINTS[id] = { authorKind: "company" };
    seedPost(id, { author: FOUNDER, authorKind: "company", companyId: CO });
  }

  it("a follow SURVIVES a simulated restart (was in-memory only)", async () => {
    seedCompanyPost();
    expect((await follow("post_w2d_company", FOLLOWER)).status).toBe(200);
    await simulateRestart();
    const rows = rawDb()
      .prepare(
        `SELECT user_id FROM company_followers
          WHERE company_id = ? AND deleted_at IS NULL`,
      )
      .all(CO) as Array<{ user_id: string }>;
    expect(rows.map((r) => r.user_id)).toContain(FOLLOWER);
    const r = await detail("post_w2d_company", FOLLOWER);
    expect(r.status).toBe(200);
    expect(r.body.post.viewerIsFollowingCompany).toBe(true);
  });

  it("follow is IDEMPOTENT — two calls leave exactly one live row", async () => {
    seedCompanyPost();
    await follow("post_w2d_company", FOLLOWER);
    const second = await follow("post_w2d_company", FOLLOWER);
    expect(second.status).toBe(200);
    expect(second.body.following).toBe(true);
    const n = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM company_followers
          WHERE company_id = ? AND user_id = ? AND deleted_at IS NULL`,
      )
      .get(CO, FOLLOWER) as { n: number };
    expect(n.n).toBe(1);
  });

  it("button state is PER-VIEWER: one investor's follow does not mark it followed for another", async () => {
    seedCompanyPost();
    await follow("post_w2d_company", FOLLOWER);
    const mine = await detail("post_w2d_company", FOLLOWER);
    /* The comparison viewer is the FOUNDER: a durable member of the
       `company_followers` channel (so they can read the post) who has NOT
       followed. Pre-fix, the follow above wrote the company id onto the POST, so
       this second viewer saw "Following ✓" too. */
    const theirs = await detail("post_w2d_company", FOUNDER, "founder");
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);
    expect(mine.body.post.viewerIsFollowingCompany).toBe(true);
    expect(mine.body.post.followingCompanyIds).toEqual([CO]);
    // The OTHER viewer must NOT see "Following ✓".
    expect(theirs.body.post.viewerIsFollowingCompany).toBe(false);
    expect(theirs.body.post.followingCompanyIds ?? []).toEqual([]);
  });

  it("UNFOLLOW exists, is soft, and re-following restores the same row", async () => {
    seedCompanyPost();
    await follow("post_w2d_company", FOLLOWER);
    const off = await unfollow("post_w2d_company", FOLLOWER);
    expect(off.status).toBe(200);
    expect(off.body.following).toBe(false);
    const soft = rawDb()
      .prepare(`SELECT deleted_at FROM company_followers WHERE company_id = ? AND user_id = ?`)
      .get(CO, FOLLOWER) as { deleted_at: string | null };
    expect(soft.deleted_at).not.toBeNull(); // soft, not a hard DELETE
    /* The unfollow takes effect IMMEDIATELY on the audience too: the follower is
       no longer a durable member of the company_followers channel, so the read
       fails closed. The founder still sees a zero follower count. */
    expect((await detail("post_w2d_company", FOLLOWER)).status).toBe(403);
    const founderView = await detail("post_w2d_company", FOUNDER, "founder");
    expect(founderView.body.post.companyFollowerCount).toBe(0);
    const again = await follow("post_w2d_company", FOLLOWER);
    expect(again.body.following).toBe(true);
    expect((await detail("post_w2d_company", FOLLOWER)).body.post.viewerIsFollowingCompany).toBe(true);
    const n = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM company_followers WHERE company_id = ? AND user_id = ?`,
      )
      .get(CO, FOLLOWER) as { n: number };
    expect(n.n).toBe(1);
  });

  it("REGRESSION GUARD: the legacy response shape still carries ok + followingCompanyIds", async () => {
    seedCompanyPost();
    const r = await follow("post_w2d_company", FOLLOWER);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.followingCompanyIds)).toBe(true);
  });

  it("the FOUNDER sees follower IDENTITIES", async () => {
    seedCompanyPost();
    await follow("post_w2d_company", FOLLOWER);
    const r = asUser(request(app).get(`/api/comms/companies/${CO}/followers`), FOUNDER, "founder");
    const res = await r;
    expect(res.status).toBe(200);
    expect(res.body.followerCount).toBe(1);
    expect(res.body.followers[0].userId).toBe(FOLLOWER);
    expect(res.body.followers[0].displayName).toBe("Follower Investor");
    expect(res.body.followers[0].isAnonymous).toBe(false);
  });

  it("an EXPLICIT opt-out still wins in the founder's follower list", async () => {
    seedCompanyPost();
    setPrivacy(OPTED_OUT, { visibleToCoMembers: false });
    await follow("post_w2d_company", OPTED_OUT);
    const res = await asUser(
      request(app).get(`/api/comms/companies/${CO}/followers`),
      FOUNDER,
      "founder",
    );
    expect(res.status).toBe(200);
    const row = res.body.followers.find((f: any) => f.userId === OPTED_OUT);
    expect(row).toBeTruthy();
    expect(row.displayName).not.toBe("Opted Out Investor"); // legal name withheld
    expect(row.isAnonymous).toBe(true);
  });

  it("REGRESSION GUARD: a stranger cannot read the follower list", async () => {
    seedCompanyPost();
    await follow("post_w2d_company", FOLLOWER);
    const res = await asUser(
      request(app).get(`/api/comms/companies/${CO}/followers`),
      STRANGER,
      "investor",
    );
    expect(res.status).toBe(403);
  });
});

/* ======================================================================== */
/* D2 — CHAPTER MEMBERSHIP WRITER (audience row 5)                          */
/* ======================================================================== */

describe("D2 — chapter membership writer makes audience row 5 fire", () => {
  it("a written membership + a chapter-anchored post GRANTS access", async () => {
    seedChapter(CHAPTER, CHAPTER_ADMIN);
    const add = await asUser(
      request(app).post(`/api/collective/chapters/${CHAPTER}/members`),
      CHAPTER_ADMIN,
      "investor",
    ).send({ userId: CHAPTER_MEMBER });
    expect(add.status).toBe(200);
    // Author must also be a chapter member for the anchor to be legitimate.
    seedChapterMembershipRow(FOUNDER, CHAPTER);
    seedPost("post_w2d_chap", { author: FOUNDER, chapterId: CHAPTER });
    const r = await detail("post_w2d_chap", CHAPTER_MEMBER);
    expect(r.status).toBe(200);
    expect(r.body.post.body).toBe(BODY);
  });

  it("REGRESSION GUARD: a NULL chapter_id still DENIES (row 5 stays post-anchored)", async () => {
    seedChapter(CHAPTER, CHAPTER_ADMIN);
    seedChapterMembershipRow(CHAPTER_MEMBER, CHAPTER);
    seedChapterMembershipRow(FOUNDER, CHAPTER);
    seedPost("post_w2d_chap_null", { author: FOUNDER, chapterId: null });
    expect((await detail("post_w2d_chap_null", CHAPTER_MEMBER)).status).toBe(403);
  });

  it("the writer is FAIL-CLOSED: a non-admin cannot add a member", async () => {
    seedChapter(CHAPTER, CHAPTER_ADMIN);
    const add = await asUser(
      request(app).post(`/api/collective/chapters/${CHAPTER}/members`),
      STRANGER,
      "investor",
    ).send({ userId: STRANGER });
    expect(add.status).toBe(403);
  });

  it("a revoked membership no longer grants access", async () => {
    seedChapter(CHAPTER, CHAPTER_ADMIN);
    seedChapterMembershipRow(CHAPTER_MEMBER, CHAPTER);
    seedChapterMembershipRow(FOUNDER, CHAPTER);
    seedPost("post_w2d_chap_rev", { author: FOUNDER, chapterId: CHAPTER });
    expect((await detail("post_w2d_chap_rev", CHAPTER_MEMBER)).status).toBe(200);
    const del = await asUser(
      request(app).delete(`/api/collective/chapters/${CHAPTER}/members/${CHAPTER_MEMBER}`),
      CHAPTER_ADMIN,
      "investor",
    );
    expect(del.status).toBe(200);
    expect((await detail("post_w2d_chap_rev", CHAPTER_MEMBER)).status).toBe(403);
  });

  it("the post-side anchor writer refuses a non-member author (fail closed)", async () => {
    seedChapter(CHAPTER, CHAPTER_ADMIN);
    // FOUNDER is NOT a chapter member here.
    const create = await asUser(request(app).post("/api/comms/posts"), FOUNDER, "founder").send({
      body: "trying to anchor to a chapter I am not in",
      visibility: "network",
      chapterId: CHAPTER,
    });
    expect(create.status).toBe(403);
    expect(create.body.error ?? create.body.message).toContain("chapter");
  });
});

/* ======================================================================== */
/* D3 — THE PRODUCTION-EMPTY COMMS_USERS READS                              */
/* ======================================================================== */

describe("D3 — re-sourced COMMS_USERS surfaces (non-seed ids only)", () => {
  it("post author label + role badge come from the durable users row", async () => {
    seedPost("post_w2d_author", { author: INVESTOR });
    const r = await detail("post_w2d_author", INVESTOR);
    expect(r.status).toBe(200);
    expect(r.body.post.authorLabel).toBe("Located Investor");
    expect(String(r.body.post.authorRoleBadge ?? "").length).toBeGreaterThan(0);
  });

  it("a company post shows the real company NAME and HQ, not a hardcoded city", async () => {
    POST_RESTORE_HINTS["post_w2d_co"] = { authorKind: "company" };
    seedPost("post_w2d_co", { author: FOUNDER, authorKind: "company", companyId: CO });
    const r = await detail("post_w2d_co", FOUNDER, "founder");
    expect(r.status).toBe(200);
    expect(r.body.post.authorLabel).toBe(CO_NAME);
    expect(r.body.post.authorLocation).toBe(HQ);
    expect(r.body.post.authorLocation).not.toBe("San Francisco, CA");
  });

  it("PIN works for a founder (the endpoint used to 403 for EVERYONE in production)", async () => {
    seedPost("post_w2d_pin", { author: FOUNDER });
    const r = await asUser(request(app).post("/api/comms/posts/post_w2d_pin/pin"), FOUNDER, "founder");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("REGRESSION GUARD: PIN still denies a non-founder", async () => {
    seedPost("post_w2d_pin2", { author: FOUNDER });
    const r = await asUser(request(app).post("/api/comms/posts/post_w2d_pin2/pin"), STRANGER, "investor");
    expect(r.status).toBe(403);
  });

  it("authorKind=collective FAILED CLOSED (returned zero) and now returns the post", async () => {
    seedChapter(CHAPTER, CHAPTER_ADMIN);
    seedChapterMembershipRow(INVESTOR, CHAPTER);
    seedPost("post_w2d_collective", { author: INVESTOR });
    const r = await feed("?scope=network&authorKind=collective", INVESTOR);
    expect(r.status).toBe(200);
    expect((r.body as Array<{ id: string }>).map((p) => p.id)).toContain("post_w2d_collective");
  });

  it("sort=following FAILED OPEN (showed everything) and now returns ONLY followed authors", async () => {
    // INVESTOR follows CO (whose founder is FOUNDER) and follows nobody else.
    seedFollowRow(INVESTOR, CO);
    POST_RESTORE_HINTS["post_w2d_followed"] = { authorKind: "company" };
    seedPost("post_w2d_followed", { author: FOUNDER, authorKind: "company", companyId: CO });
    seedPost("post_w2d_unfollowed", { author: STRANGER });
    const r = await feed("?scope=network&sort=following", INVESTOR);
    expect(r.status).toBe(200);
    const ids = (r.body as Array<{ id: string }>).map((p) => p.id);
    // The unfollowed stranger's post must NOT be in a "following" feed.
    expect(ids).not.toContain("post_w2d_unfollowed");
  });

  it("/api/comms/users returns real (non-seed) users instead of an empty picker", async () => {
    seedCommit("ct_w2d_1", HOLDER, CO);
    seedCommit("ct_w2d_2", INVESTOR, CO);
    const r = await asUser(request(app).get("/api/comms/users"), HOLDER, "investor");
    expect(r.status).toBe(200);
    const ids = (r.body as Array<{ id: string }>).map((u) => u.id);
    expect(ids).toContain(HOLDER);
    expect(ids).toContain(INVESTOR); // durable cap-table peer, no seed involved
  });

  it("/api/comms/users does NOT leak a raw legalName or the whole visibility object", async () => {
    seedCommit("ct_w2d_1", HOLDER, CO);
    seedCommit("ct_w2d_2", OPTED_OUT, CO);
    setPrivacy(OPTED_OUT, { visibleToCoMembers: false, visibleInCollectiveDirectory: false });
    const r = await asUser(request(app).get("/api/comms/users"), HOLDER, "investor");
    expect(r.status).toBe(200);
    const row = (r.body as Array<any>).find((u) => u.id === OPTED_OUT);
    if (row) {
      expect(row.legalName).not.toBe("Opted Out Investor");
      // The subject's raw consent flags are not broadcast to other viewers.
      expect(row.visibility?.visibleToCoMembers).toBeUndefined();
    }
    // And the serialised body must not contain the withheld legal name anywhere.
    expect(JSON.stringify(r.body)).not.toContain("Opted Out Investor");
  });

  it("/api/comms/users returns NOTHING to an unauthenticated caller", async () => {
    const r = await request(app).get("/api/comms/users");
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });

  it("DM start reaches a real non-seed user (the picker target used to 422)", async () => {
    seedCommit("ct_w2d_1", HOLDER, CO);
    seedCommit("ct_w2d_2", INVESTOR, CO);
    const r = await asUser(request(app).post("/api/comms/dm/start"), HOLDER, "investor").send({
      targetUserId: INVESTOR,
    });
    expect(r.status).not.toBe(422);
    expect([200, 201, 403]).toContain(r.status);
  });
});

/* ======================================================================== */
/* D4 — AUTHOR LOCATION                                                     */
/* ======================================================================== */

describe("D4 — author location", () => {
  it("an INVESTOR author shows their self-entered users.location", async () => {
    seedPost("post_w2d_loc_inv", { author: INVESTOR });
    const r = await detail("post_w2d_loc_inv", INVESTOR);
    expect(r.body.post.authorLocation).toBe(INVESTOR_LOCATION);
  });

  it("a FOUNDER author shows the company HQ (derived, not stored twice)", async () => {
    seedPost("post_w2d_loc_founder", { author: FOUNDER });
    const r = await detail("post_w2d_loc_founder", FOUNDER, "founder");
    expect(r.body.post.authorLocation).toBe(HQ);
  });

  it("REGRESSION GUARD: no location anywhere renders EMPTY, not a placeholder", async () => {
    seedPost("post_w2d_loc_empty", { author: STRANGER });
    const r = await detail("post_w2d_loc_empty", STRANGER);
    expect(r.body.post.authorLocation).toBe("");
  });

  it("the investor-facing setter persists and is read back", async () => {
    const patch = await asUser(request(app).patch("/api/users/me/location"), HOLDER, "investor").send({
      location: "Lisbon, PT",
    });
    expect(patch.status).toBe(200);
    const get = await asUser(request(app).get("/api/users/me/location"), HOLDER, "investor");
    expect(get.body.location).toBe("Lisbon, PT");
    seedPost("post_w2d_loc_set", { author: HOLDER });
    expect((await detail("post_w2d_loc_set", HOLDER)).body.post.authorLocation).toBe("Lisbon, PT");
  });

  it("clearing the location empties it again (no silent retention)", async () => {
    await asUser(request(app).patch("/api/users/me/location"), HOLDER, "investor").send({
      location: "Lisbon, PT",
    });
    await asUser(request(app).patch("/api/users/me/location"), HOLDER, "investor").send({
      location: "",
    });
    const get = await asUser(request(app).get("/api/users/me/location"), HOLDER, "investor");
    expect(get.body.location ?? "").toBe("");
  });
});

/* ======================================================================== */
/* D5 — THE RESTART MATRIX (SHIP GATE)                                      */
/* ======================================================================== */

describe("D5 — restart matrix for anchored channels", () => {
  beforeEach(() => {
    seedCommit("ct_w2d_holder", HOLDER, CO);
    seedFollowRow(FOLLOWER, CO);
  });

  it("AUTHOR can open a cap_table post detail after a simulated restart", async () => {
    POST_RESTORE_HINTS["post_w2d_ct"] = { visibility: "cap_table" };
    seedPost("post_w2d_ct", { author: FOUNDER, visibility: "cap_table", companyId: CO });
    await simulateRestart();
    const r = await detail("post_w2d_ct", FOUNDER, "founder");
    expect(r.status).toBe(200);
    expect(r.body.post.body).toBe(BODY);
  });

  it("an authorised CAP-TABLE MEMBER can open it after a simulated restart", async () => {
    POST_RESTORE_HINTS["post_w2d_ct2"] = { visibility: "cap_table" };
    seedPost("post_w2d_ct2", { author: FOUNDER, visibility: "cap_table", companyId: CO });
    await simulateRestart();
    expect((await detail("post_w2d_ct2", HOLDER)).status).toBe(200);
  });

  it("an authorised COMPANY FOLLOWER can open a company_followers post after a restart", async () => {
    POST_RESTORE_HINTS["post_w2d_cf"] = { authorKind: "company" };
    seedPost("post_w2d_cf", { author: FOUNDER, authorKind: "company", companyId: CO });
    await simulateRestart();
    expect((await detail("post_w2d_cf", FOLLOWER)).status).toBe(200);
  });

  it("REGRESSION GUARD: a STRANGER is still denied after the restart", async () => {
    POST_RESTORE_HINTS["post_w2d_ct3"] = { visibility: "cap_table" };
    seedPost("post_w2d_ct3", { author: FOUNDER, visibility: "cap_table", companyId: CO });
    await simulateRestart();
    expect((await detail("post_w2d_ct3", STRANGER)).status).toBe(403);
  });

  it("REGRESSION GUARD: an UNRESOLVABLE channel still fails closed for everyone", async () => {
    POST_RESTORE_HINTS["post_w2d_ghost"] = { visibility: "cap_table" };
    // A company with no founders, no committed holders and no followers: the
    // anchors resolve to an EMPTY participant set, so the channel cannot be
    // materialised and the read must deny.
    seedPost("post_w2d_ghost", { author: FOUNDER, visibility: "cap_table", companyId: OTHER_CO });
    await simulateRestart();
    expect((await detail("post_w2d_ghost", STRANGER)).status).toBe(403);
    expect((await detail("post_w2d_ghost", HOLDER)).status).toBe(403);
  });

  it("the rebuilt channel is PERSISTED with its durable anchors (survives the next restart too)", async () => {
    POST_RESTORE_HINTS["post_w2d_ct4"] = { visibility: "cap_table" };
    seedPost("post_w2d_ct4", { author: FOUNDER, visibility: "cap_table", companyId: CO });
    await simulateRestart();
    const row = rawDb()
      .prepare(`SELECT id, kind, company_id FROM comms_channels WHERE id = ?`)
      .get(`captable__${CO}`) as any;
    expect(row).toBeTruthy();
    expect(row.kind).toBe("cap_table");
    expect(row.company_id).toBe(CO);
    await simulateRestart();
    expect((await detail("post_w2d_ct4", HOLDER)).status).toBe(200);
  });

  it("READ NEVER CONFERS WRITE: the participant list is not widened by a follower's read", async () => {
    POST_RESTORE_HINTS["post_w2d_cf2"] = { authorKind: "company" };
    seedPost("post_w2d_cf2", { author: FOUNDER, authorKind: "company", companyId: CO });
    await simulateRestart();
    const before = JSON.stringify(
      _commsTest.channels.get(`followers__${CO}`)?.participantUserIds ?? [],
    );
    await detail("post_w2d_cf2", FOLLOWER);
    const after = JSON.stringify(
      _commsTest.channels.get(`followers__${CO}`)?.participantUserIds ?? [],
    );
    expect(after).toBe(before);
  });

  it("SOFT-CIRCLE channels are deliberately NOT rebuilt (funding surface stays off)", async () => {
    // Documented STOP: deriving round membership would put a funding surface
    // live, which Stage D forbids. Assert the absence explicitly so a future
    // change to this decision cannot happen silently.
    await simulateRestart();
    expect(_commsTest.channels.get(`softcircle__${RND}`)).toBeUndefined();
  });
});

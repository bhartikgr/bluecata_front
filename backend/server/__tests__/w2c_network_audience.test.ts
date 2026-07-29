/**
 * server/__tests__/w2c_network_audience.test.ts
 *
 * W-COLLECTIVE Wave 2 STAGE C — relationship-scoped audience for NETWORK posts
 * + the social identity policy that has to land with it.
 *
 * WHAT IS UNDER TEST
 *   1. `server/lib/networkPostAudience.ts` — the six-row relationship predicate,
 *      exercised END-TO-END through the two post READ endpoints (never called
 *      directly), so the composition is tested with the predicate.
 *   2. The composition in `server/commsStore.ts`: participant gate **OR**
 *      predicate, for `kind === "network"` ONLY. `cap_table` and
 *      `company_followers` keep the participant gate alone.
 *   3. READ NEVER CONFERS WRITE — `channel.participantUserIds` is byte-identical
 *      after a feed GET and a detail GET by a relationship-qualified
 *      non-participant, and that viewer still cannot mutate the post.
 *   4. The C4 identity policy — network / company-follower bylines, comment
 *      author labels and reaction history resolve in the `collectiveDirectory`
 *      context (explicit opt-in), and reaction history is suppressed entirely
 *      for non-participants.
 *
 * ANTI-VACUITY METHOD. `server/lib/networkPostAudience.ts` is NEW, so the
 * pre-image is `server/commsStore.ts` with the Stage C edits reverted and the
 * new module left in place (kept in /home/user/workspace/build/_w2c_backup).
 * Every audience test then fails with a REAL assertion error (`expected 403 to
 * be 200`, and the feed body missing the post) rather than an import error, and
 * every identity test fails with the author's legal/screen name appearing where
 * "Private Investor" is required. Tests that also pass on the pre-image are
 * labelled REGRESSION GUARD and are not counted as evidence. Observed pre-fix
 * failure modes are recorded per-test in /home/user/workspace/work/_W2C_RESULT.md.
 *
 * MEASURED: 16 of the 33 tests FAIL on the pre-image and PASS after — those are
 * the evidence. The other 17 pass both ways and are REGRESSION GUARDS, whether
 * or not their title says so; they are every negative/denial case (non-committed
 * ledger row, `declined` soft circle, unfollow, wrong company, NULL chapter
 * anchor, wrong chapter, inactive/deleted chapter membership, stranger,
 * other-tenant stranger, missing durable row, soft-deleted row, the three
 * cap_table-isolation cases, the durable-author case, and self-view). They
 * guard the fail-closed half of the change, which the widening could regress,
 * but they are NOT counted as proof that the widening works.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { resolveDisplayName } from "../lib/userPrivacyResolver";
import { registerCommsRoutes, restorePostFromDb, _commsTest } from "../commsStore";

/* ---------------------------------------------------------------- fixtures */

const AUTHOR = "u_w2c_author";
const SELF_POST_AUTHOR = "u_w2c_self";
const CAP_CO_MEMBER = "u_w2c_capco";
const SOFT_CIRCLER = "u_w2c_soft";
const DECLINED = "u_w2c_declined";
const FOLLOWER = "u_w2c_follower";
const CHAPTER_PEER = "u_w2c_chapter";
const OTHER_CHAPTER_PEER = "u_w2c_otherchapter";
const STRANGER = "u_w2c_stranger";
const OTHER_TENANT_STRANGER = "u_w2c_othertenant";

const CO = "co_w2c";               // the company the AUTHOR founds
const CAP_CO = "co_w2c_captable";  // a company where AUTHOR + CAP_CO_MEMBER both hold
const RND = "rnd_w2c";
const CHAPTER = "chap_w2c";
const OTHER_CHAPTER = "chap_w2c_other";

const SECRET = "We just closed our bridge at a $61M post — details inside.";
const SCREEN_NAME = "Ayla Demirkan";

let app: Express;
const MINTED = new Set<string>();

function now(): string {
  return new Date().toISOString();
}

/**
 * Seed a post BOTH durably (`network_posts` — the only thing the predicate
 * reads) and in-memory (`restorePostFromDb`, which also rebuilds the author's
 * single-participant `kind:"network"` channel). The two halves are deliberately
 * separate: the predicate must never be satisfiable from the in-memory map.
 */
function seedPost(
  id: string,
  opts: {
    author?: string;
    chapterId?: string | null;
    companyId?: string | null;
    contentCompanyId?: string | null;
    visibility?: string;
    authorKind?: string;
  } = {},
): void {
  const author = opts.author ?? AUTHOR;
  MINTED.add(id);
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO network_posts
         (id, tenant_id, author_user_id, audience, body, content_json, likes, comments,
          created_at, updated_at, deleted_at, scope, company_id, chapter_id)
       VALUES (?, 'tenant_platform', ?, 'all', ?, ?, 0, 0, ?, ?, NULL, 'network', ?, ?)`,
    )
    .run(
      id,
      author,
      SECRET,
      JSON.stringify({ companyId: opts.contentCompanyId ?? null }),
      now(),
      now(),
      opts.companyId ?? null,
      opts.chapterId ?? null,
    );
  restorePostFromDb({
    id,
    authorUserId: author,
    body: SECRET,
    createdAt: now(),
    ...(opts.visibility ? { visibility: opts.visibility } : {}),
    ...(opts.authorKind ? { authorKind: opts.authorKind } : {}),
    ...(opts.companyId !== undefined ? { companyId: opts.companyId } : {}),
  } as any);
}

function channelIdOf(postId: string): string | undefined {
  return _commsTest.posts.get(postId)?.channelId;
}

/** AUTHOR founds CO, which owns round RND. */
function seedFoundedCompany(): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO company_members
         (id, company_id, user_id, role, tenant_id, is_active, joined_at, deleted_at)
       VALUES ('cm_w2c', ?, ?, 'founder', 'tenant_platform', 1, ?, NULL)`,
    )
    .run(CO, AUTHOR, now());
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO rounds
         (id, tenant_id, company_id, name, type, state, target_amount, raised_amount,
          currency, created_at, updated_at, deleted_at)
       VALUES (?, 'tenant_platform', ?, 'Seed', 'seed', 'open', 1000000, 0, 'USD', ?, ?, NULL)`,
    )
    .run(RND, CO, now(), now());
}

function seedSoftCircle(investor: string, status: string, rowId = "sc_w2c"): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO soft_circles
         (id, tenant_id, round_id, company_id, investor_user_id, investor_name, amount,
          amount_minor, currency, status, collective_visible, created_at, updated_at, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, ?, 'Investor', 50000, 0, 'USD', ?, 1, ?, ?, NULL)`,
    )
    .run(rowId, RND, CO, investor, status, now(), now());
}

/** A committed cap-table ledger row, so two investors share a cap table. */
function seedCapTableCommit(rowId: string, investor: string, state = "committed"): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO captable_commits
         (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
          amount, currency, shares, state, prev_hash, hash, deleted_at)
       VALUES (?, 'tenant_platform', 1, ?, ?, ?, ?, ?, '1000', 'USD', '10', ?, 'p', ?, NULL)`,
    )
    .run(rowId, now(), `inv_${rowId}`, RND, CAP_CO, investor, state, `h_${rowId}`);
}

function seedFollow(user: string, companyId: string, deleted = false): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO company_followers
         (id, tenant_id, user_id, company_id, created_at, updated_at, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?)`,
    )
    .run(`cf_${user}_${companyId}`, user, companyId, now(), now(), deleted ? now() : null);
}

function seedChapterMembership(
  user: string,
  chapterId: string,
  status = "active",
  deleted = false,
): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO chapter_memberships
         (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, 'member', ?, ?, ?, ?, ?)`,
    )
    .run(
      `chm_${user}_${chapterId}`,
      chapterId,
      user,
      status,
      now(),
      now(),
      now(),
      deleted ? now() : null,
    );
}

function setPrivacy(userId: string, prefs: Record<string, unknown>): void {
  // Touch the resolver first so it self-heals its table before we write.
  resolveDisplayName(userId, userId, "message", { legalName: SCREEN_NAME });
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO profilestore_user_privacy
         (user_id, privacy_json, updated_at, deleted_at)
       VALUES (?, ?, ?, NULL)`,
    )
    .run(userId, JSON.stringify(prefs), now());
}

function wipe(): void {
  for (const id of MINTED) {
    const ch = channelIdOf(id);
    _commsTest.posts.delete(id);
    if (ch) _commsTest.channels.delete(ch);
    try { rawDb().prepare("DELETE FROM network_posts WHERE id = ?").run(id); } catch { /* noop */ }
  }
  MINTED.clear();
  const del = (sql: string, ...args: unknown[]) => {
    try { rawDb().prepare(sql).run(...args); } catch { /* table may not exist */ }
  };
  del("DELETE FROM company_members WHERE id = 'cm_w2c'");
  del("DELETE FROM rounds WHERE id = ?", RND);
  del("DELETE FROM soft_circles WHERE id LIKE 'sc_w2c%'");
  del("DELETE FROM captable_commits WHERE id LIKE 'ct_w2c%'");
  del("DELETE FROM company_followers WHERE id LIKE 'cf_u_w2c%'");
  del("DELETE FROM chapter_memberships WHERE id LIKE 'chm_u_w2c%'");
  for (const u of [AUTHOR, CAP_CO_MEMBER, FOLLOWER, CHAPTER_PEER, STRANGER]) {
    del("DELETE FROM profilestore_user_privacy WHERE user_id = ?", u);
  }
}

/* ------------------------------------------------------------------ helpers */

function getDetail(postId: string, as: string) {
  return request(app).get(`/api/comms/posts/${postId}`).set("x-user-id", as);
}
function getFeed(as: string) {
  return request(app).get("/api/comms/posts?scope=network").set("x-user-id", as);
}
async function feedIds(as: string): Promise<string[]> {
  const r = await getFeed(as);
  expect(r.status).toBe(200);
  return (r.body as Array<{ id: string }>).map((p) => p.id);
}

beforeAll(() => {
  getDb();
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);
});

beforeEach(() => { wipe(); });
afterEach(() => { wipe(); });

/* ============================== ROW 1 — SELF ============================== */

describe("row 1 — self", () => {
  it("REGRESSION GUARD: the author reads their own network post (participant gate already allows this)", async () => {
    seedPost("post_w2c_self", { author: SELF_POST_AUTHOR });
    const r = await getDetail("post_w2c_self", SELF_POST_AUTHOR);
    expect(r.status).toBe(200);
    expect(r.body.post.body).toBe(SECRET);
  });

  it("self is proven from the DURABLE author column, not the in-memory post", async () => {
    // Durable author = SELF_POST_AUTHOR; the in-memory row is rewritten to
    // claim STRANGER wrote it. The predicate must ignore the in-memory claim.
    seedPost("post_w2c_self_durable", { author: SELF_POST_AUTHOR });
    const p = _commsTest.posts.get("post_w2c_self_durable")!;
    (p as any).authorUserId = STRANGER;
    // STRANGER is not the durable author and has no relationship → denied.
    expect((await getDetail("post_w2c_self_durable", STRANGER)).status).toBe(403);
  });
});

/* ================== ROW 2 — CAP-TABLE CO-MEMBER (SACRED) ================== */

describe("row 2 — cap-table co-member", () => {
  it("a committed co-holder on a shared cap table SEES the author's network post", async () => {
    seedCapTableCommit("ct_w2c_a", AUTHOR);
    seedCapTableCommit("ct_w2c_b", CAP_CO_MEMBER);
    seedPost("post_w2c_cap");
    expect((await getDetail("post_w2c_cap", CAP_CO_MEMBER)).status).toBe(200);
    expect(await feedIds(CAP_CO_MEMBER)).toContain("post_w2c_cap");
  });

  it("a NON-committed ledger row does not qualify (state must be `committed`)", async () => {
    seedCapTableCommit("ct_w2c_a", AUTHOR);
    seedCapTableCommit("ct_w2c_b", CAP_CO_MEMBER, "pending");
    seedPost("post_w2c_cap_pending");
    expect((await getDetail("post_w2c_cap_pending", CAP_CO_MEMBER)).status).toBe(403);
  });
});

/* ================= ROW 3 — SOFT-CIRCLE COUNTERPARTY ====================== */

describe("row 3 — soft-circle counterparty (single source: dmCoMembership)", () => {
  for (const status of ["intent", "confirmed", "wired", "committed"]) {
    it(`a "${status}" soft-circle on the author's round SEES the post`, async () => {
      seedFoundedCompany();
      seedSoftCircle(SOFT_CIRCLER, status);
      seedPost("post_w2c_soft");
      expect((await getDetail("post_w2c_soft", SOFT_CIRCLER)).status).toBe(200);
    });
  }

  it("`declined` is EXCLUDED — a declined investor never sees the post", async () => {
    seedFoundedCompany();
    seedSoftCircle(DECLINED, "declined", "sc_w2c_declined");
    seedPost("post_w2c_declined");
    expect((await getDetail("post_w2c_declined", DECLINED)).status).toBe(403);
    expect(await feedIds(DECLINED)).not.toContain("post_w2c_declined");
  });
});

/* ================== ROW 4 — FOLLOWER OF AUTHOR'S COMPANY ================= */

describe("row 4 — company follower (migration 0116)", () => {
  it("a live follow of a company the author founds SEES the post", async () => {
    seedFoundedCompany();
    seedFollow(FOLLOWER, CO);
    seedPost("post_w2c_follow");
    expect((await getDetail("post_w2c_follow", FOLLOWER)).status).toBe(200);
    expect(await feedIds(FOLLOWER)).toContain("post_w2c_follow");
  });

  it("a follow of the company named on the POST row also qualifies", async () => {
    seedFollow(FOLLOWER, "co_w2c_onpost");
    seedPost("post_w2c_follow_anchor", { companyId: "co_w2c_onpost" });
    expect((await getDetail("post_w2c_follow_anchor", FOLLOWER)).status).toBe(200);
  });

  it("an UNFOLLOW (deleted_at set) revokes visibility", async () => {
    seedFoundedCompany();
    seedFollow(FOLLOWER, CO, true);
    seedPost("post_w2c_unfollow");
    expect((await getDetail("post_w2c_unfollow", FOLLOWER)).status).toBe(403);
  });

  it("following a DIFFERENT company does not qualify", async () => {
    seedFoundedCompany();
    seedFollow(FOLLOWER, "co_w2c_unrelated");
    seedPost("post_w2c_follow_other");
    expect((await getDetail("post_w2c_follow_other", FOLLOWER)).status).toBe(403);
  });
});

/* ==================== ROW 5 — SHARED ACTIVE CHAPTER ====================== */

describe("row 5 — shared ACTIVE chapter, POST-ANCHORED", () => {
  it("both sides active in the SAME chapter with the post anchor set → visible", async () => {
    seedChapterMembership(AUTHOR, CHAPTER);
    seedChapterMembership(CHAPTER_PEER, CHAPTER);
    seedPost("post_w2c_chapter", { chapterId: CHAPTER });
    expect((await getDetail("post_w2c_chapter", CHAPTER_PEER)).status).toBe(200);
    expect(await feedIds(CHAPTER_PEER)).toContain("post_w2c_chapter");
  });

  it("NULL chapter_id → row 5 is FALSE even though both share a chapter (no broadcast)", async () => {
    // This is the anchor. Without it, one default chapter = platform-wide feed.
    seedChapterMembership(AUTHOR, CHAPTER);
    seedChapterMembership(CHAPTER_PEER, CHAPTER);
    seedPost("post_w2c_chapter_null", { chapterId: null });
    expect((await getDetail("post_w2c_chapter_null", CHAPTER_PEER)).status).toBe(403);
    expect(await feedIds(CHAPTER_PEER)).not.toContain("post_w2c_chapter_null");
  });

  it("a viewer in a DIFFERENT chapter → FALSE", async () => {
    seedChapterMembership(AUTHOR, CHAPTER);
    seedChapterMembership(OTHER_CHAPTER_PEER, OTHER_CHAPTER);
    seedPost("post_w2c_chapter_other", { chapterId: CHAPTER });
    expect((await getDetail("post_w2c_chapter_other", OTHER_CHAPTER_PEER)).status).toBe(403);
  });

  it("a NON-active (pending/revoked) or soft-deleted membership on EITHER side → FALSE", async () => {
    for (const [aStatus, vStatus, deleted] of [
      ["pending", "active", false],
      ["active", "revoked", false],
      ["active", "active", true],
    ] as Array<[string, string, boolean]>) {
      wipe();
      seedChapterMembership(AUTHOR, CHAPTER, aStatus, deleted);
      seedChapterMembership(CHAPTER_PEER, CHAPTER, vStatus);
      seedPost("post_w2c_chapter_inactive", { chapterId: CHAPTER });
      expect((await getDetail("post_w2c_chapter_inactive", CHAPTER_PEER)).status).toBe(403);
    }
  });
});

/* ======================= ROW 6 — EVERYTHING ELSE ========================= */

describe("row 6 — anything else is FALSE", () => {
  it("REGRESSION GUARD: a stranger with no relationship is denied", async () => {
    seedPost("post_w2c_stranger");
    expect((await getDetail("post_w2c_stranger", STRANGER)).status).toBe(403);
    expect(await feedIds(STRANGER)).not.toContain("post_w2c_stranger");
  });

  it("REGRESSION GUARD: a stranger in ANOTHER TENANT is denied", async () => {
    // Cross-tenant denial is structural: every one of the five relationship
    // rows requires a durable row naming BOTH users, and a foreign-tenant user
    // has none. Seeding the author's full relationship set proves the denial is
    // not an accident of an empty database.
    seedFoundedCompany();
    seedCapTableCommit("ct_w2c_a", AUTHOR);
    seedChapterMembership(AUTHOR, CHAPTER);
    rawDb()
      .prepare(
        `INSERT OR REPLACE INTO chapter_memberships
           (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at, deleted_at)
         VALUES ('chm_u_w2c_othertenant', 'tenant_other', ?, ?, 'member', 'active', ?, ?, ?, NULL)`,
      )
      .run(OTHER_CHAPTER, OTHER_TENANT_STRANGER, now(), now(), now());
    seedPost("post_w2c_tenant", { chapterId: CHAPTER });
    expect((await getDetail("post_w2c_tenant", OTHER_TENANT_STRANGER)).status).toBe(403);
  });

  it("a post with NO resolvable durable row is denied to a would-be relationship viewer", async () => {
    seedFoundedCompany();
    seedFollow(FOLLOWER, CO);
    seedPost("post_w2c_nodurable");
    rawDb().prepare("DELETE FROM network_posts WHERE id = 'post_w2c_nodurable'").run();
    expect((await getDetail("post_w2c_nodurable", FOLLOWER)).status).toBe(403);
  });

  it("a SOFT-DELETED durable row is denied", async () => {
    seedFoundedCompany();
    seedFollow(FOLLOWER, CO);
    seedPost("post_w2c_softdel");
    rawDb()
      .prepare("UPDATE network_posts SET deleted_at = ? WHERE id = 'post_w2c_softdel'")
      .run(now());
    expect((await getDetail("post_w2c_softdel", FOLLOWER)).status).toBe(403);
  });

  it("a DB error fails CLOSED", async () => {
    seedFoundedCompany();
    seedFollow(FOLLOWER, CO);
    seedPost("post_w2c_dberr");
    // Make the predicate's only table unreadable for the duration of one read.
    rawDb().prepare("ALTER TABLE network_posts RENAME TO network_posts_w2c_hidden").run();
    try {
      expect((await getDetail("post_w2c_dberr", FOLLOWER)).status).toBe(403);
    } finally {
      rawDb().prepare("ALTER TABLE network_posts_w2c_hidden RENAME TO network_posts").run();
    }
    // …and the same viewer is admitted again once the table is back, proving the
    // 403 above came from the error and not from a broken fixture.
    expect((await getDetail("post_w2c_dberr", FOLLOWER)).status).toBe(200);
  });
});

/* ============ C2 — THE PREDICATE IS NEVER APPLIED TO cap_table =========== */

describe("C2 — cap_table and company_followers keep the participant gate ONLY", () => {
  it("a cap_table post is NOT visible to a FOLLOWER who is not on the cap table", async () => {
    seedFoundedCompany();
    seedFollow(FOLLOWER, CO);
    seedPost("post_w2c_ct_follow", { visibility: "cap_table", companyId: CO });
    const ch = channelIdOf("post_w2c_ct_follow");
    if (ch && _commsTest.channels.has(ch)) {
      // If the cap-table channel exists it must not list the follower.
      expect(_commsTest.channels.get(ch)!.participantUserIds).not.toContain(FOLLOWER);
    }
    expect((await getDetail("post_w2c_ct_follow", FOLLOWER)).status).toBe(403);
    expect(await feedIds(FOLLOWER)).not.toContain("post_w2c_ct_follow");
  });

  it("a cap_table post is NOT visible to a CO-CHAPTER member off the cap table", async () => {
    seedChapterMembership(AUTHOR, CHAPTER);
    seedChapterMembership(CHAPTER_PEER, CHAPTER);
    seedPost("post_w2c_ct_chapter", {
      visibility: "cap_table",
      companyId: CO,
      chapterId: CHAPTER,
    });
    expect((await getDetail("post_w2c_ct_chapter", CHAPTER_PEER)).status).toBe(403);
  });

  it("a cap_table post is NOT visible to a soft-circle counterparty", async () => {
    seedFoundedCompany();
    seedSoftCircle(SOFT_CIRCLER, "committed");
    seedPost("post_w2c_ct_soft", { visibility: "cap_table", companyId: CO });
    expect((await getDetail("post_w2c_ct_soft", SOFT_CIRCLER)).status).toBe(403);
  });
});

/* =================== C3 — READ MUST NEVER CONFER WRITE ================== */

describe("C3 — read never confers write", () => {
  it("participantUserIds is BYTE-IDENTICAL after a feed GET and a detail GET", async () => {
    seedFoundedCompany();
    seedFollow(FOLLOWER, CO);
    seedPost("post_w2c_nowrite");
    const ch = _commsTest.channels.get(channelIdOf("post_w2c_nowrite")!)!;
    const before = JSON.stringify(ch.participantUserIds);

    expect(await feedIds(FOLLOWER)).toContain("post_w2c_nowrite");
    expect(JSON.stringify(ch.participantUserIds)).toBe(before);

    expect((await getDetail("post_w2c_nowrite", FOLLOWER)).status).toBe(200);
    expect(JSON.stringify(ch.participantUserIds)).toBe(before);

    // Both again, to catch an accumulate-on-second-read bug.
    await feedIds(FOLLOWER);
    await getDetail("post_w2c_nowrite", FOLLOWER);
    expect(JSON.stringify(ch.participantUserIds)).toBe(before);
    expect(ch.participantUserIds).not.toContain(FOLLOWER);
  });

  it("the SAME relationship viewer still cannot mutate the post (like / comment / unlike)", async () => {
    seedFoundedCompany();
    seedFollow(FOLLOWER, CO);
    seedPost("post_w2c_nomutate");
    // Read first — if a read conferred write, these would then succeed.
    await feedIds(FOLLOWER);
    expect((await getDetail("post_w2c_nomutate", FOLLOWER)).status).toBe(200);

    const like = await request(app)
      .post("/api/comms/posts/post_w2c_nomutate/like")
      .set("x-user-id", FOLLOWER)
      .send({});
    expect(like.status).toBe(403);

    const comment = await request(app)
      .post("/api/comms/posts/post_w2c_nomutate/comments")
      .set("x-user-id", FOLLOWER)
      .send({ body: "let me in" });
    expect(comment.status).toBe(403);

    const unlike = await request(app)
      .delete("/api/comms/posts/post_w2c_nomutate/like")
      .set("x-user-id", FOLLOWER);
    expect(unlike.status).toBe(403);

    const p = _commsTest.posts.get("post_w2c_nomutate")!;
    expect(p.likedByUserIds).not.toContain(FOLLOWER);
    expect(p.comments.length).toBe(0);
  });
});

/* =================== C4 — SOCIAL IDENTITY POLICY ======================== */

describe("C4 — a network byline requires the collectiveDirectory opt-in", () => {
  it("a cap-table co-member who SEES the post still does NOT learn the author's name", async () => {
    // The author allows co-members (default) but has NOT opted into social
    // presence. Pre-Stage-C the byline resolved in the "message" context, where
    // co-membership alone unmasked the name.
    setPrivacy(AUTHOR, { screenName: SCREEN_NAME, visibleToCoMembers: true });
    seedCapTableCommit("ct_w2c_a", AUTHOR);
    seedCapTableCommit("ct_w2c_b", CAP_CO_MEMBER);
    seedPost("post_w2c_byline");
    const r = await getDetail("post_w2c_byline", CAP_CO_MEMBER);
    expect(r.status).toBe(200);
    expect(r.body.post.authorLabel).toBe("Private Investor");
    expect(r.body.post.isAnonymous).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(SCREEN_NAME);
  });

  it("…and the FEED byline agrees with the detail byline", async () => {
    setPrivacy(AUTHOR, { screenName: SCREEN_NAME, visibleToCoMembers: true });
    seedCapTableCommit("ct_w2c_a", AUTHOR);
    seedCapTableCommit("ct_w2c_b", CAP_CO_MEMBER);
    seedPost("post_w2c_byline_feed");
    const r = await getFeed(CAP_CO_MEMBER);
    const mine = (r.body as any[]).find((p) => p.id === "post_w2c_byline_feed");
    expect(mine).toBeTruthy();
    expect(mine.authorLabel).toBe("Private Investor");
    expect(JSON.stringify(r.body)).not.toContain(SCREEN_NAME);
  });

  it("WITH the explicit opt-in the author's chosen name IS shown", async () => {
    setPrivacy(AUTHOR, {
      screenName: SCREEN_NAME,
      visibleToCoMembers: true,
      visibleInCollectiveDirectory: true,
    });
    seedCapTableCommit("ct_w2c_a", AUTHOR);
    seedCapTableCommit("ct_w2c_b", CAP_CO_MEMBER);
    seedPost("post_w2c_byline_optin");
    const r = await getDetail("post_w2c_byline_optin", CAP_CO_MEMBER);
    expect(r.status).toBe(200);
    expect(r.body.post.authorLabel).toBe(SCREEN_NAME);
    expect(r.body.post.isAnonymous).toBe(false);
  });

  it("a COMMENT author label is masked without the social opt-in", async () => {
    setPrivacy(CAP_CO_MEMBER, { screenName: "Commenter Legal Name", visibleToCoMembers: true });
    seedCapTableCommit("ct_w2c_a", AUTHOR);
    seedCapTableCommit("ct_w2c_b", CAP_CO_MEMBER);
    seedPost("post_w2c_comment");
    // The COMMENT is written by a channel participant (the author) on behalf of
    // nobody else; we inject a comment authored by CAP_CO_MEMBER directly so the
    // label resolution is what is under test, not the comment write path.
    _commsTest.posts.get("post_w2c_comment")!.comments.push({
      id: "c_w2c_1",
      userId: CAP_CO_MEMBER,
      body: "congrats",
      createdAt: now(),
    } as any);
    const r = await getDetail("post_w2c_comment", AUTHOR);
    expect(r.status).toBe(200);
    expect(r.body.comments[0].authorLabel).toBe("Private Investor");
    expect(JSON.stringify(r.body)).not.toContain("Commenter Legal Name");
  });

  it("REACTION HISTORY is suppressed entirely for a non-participant viewer", async () => {
    setPrivacy(CAP_CO_MEMBER, { screenName: "Reactor Legal Name", visibleToCoMembers: true });
    seedFoundedCompany();
    seedFollow(FOLLOWER, CO);
    seedPost("post_w2c_reactions");
    _commsTest.posts.get("post_w2c_reactions")!.likedByUserIds.push(CAP_CO_MEMBER);

    const nonParticipant = await getDetail("post_w2c_reactions", FOLLOWER);
    expect(nonParticipant.status).toBe(200);
    // The FIELD is still present (no silent drop) — it is empty.
    expect(Array.isArray(nonParticipant.body.reactionHistory)).toBe(true);
    expect(nonParticipant.body.reactionHistory).toEqual([]);
    // No NAME or label for any reactor reaches a non-participant.
    expect(JSON.stringify(nonParticipant.body)).not.toContain("Reactor Legal Name");
    /* DISCLOSED PRE-EXISTING SURFACE, deliberately NOT narrowed here.
       `projectPost` spreads the raw Post, so `likedByUserIds` still carries the
       opaque reactor user ids to any viewer who can see the post. Those are
       ids, not identities — no resolver output, no name, no email — and the
       client uses the array to render its own like state, so removing it would
       be a silent capability drop outside Stage C's mandate. Recorded as
       residual risk in _W2C_RESULT.md. */
    expect(nonParticipant.body.post.likedByUserIds).toContain(CAP_CO_MEMBER);

    // A participant (the author) still gets the list, socially masked.
    const participant = await getDetail("post_w2c_reactions", AUTHOR);
    expect(participant.body.reactionHistory.length).toBe(1);
    expect(participant.body.reactionHistory[0].label).toBe("Private Investor");
    expect(JSON.stringify(participant.body)).not.toContain("Reactor Legal Name");
  });

  it("REGRESSION GUARD: a viewer never sees THEMSELVES masked", async () => {
    setPrivacy(AUTHOR, { screenName: SCREEN_NAME, visibleInCollectiveDirectory: false });
    seedPost("post_w2c_selfname");
    const r = await getDetail("post_w2c_selfname", AUTHOR);
    expect(r.status).toBe(200);
    expect(r.body.post.authorLabel).not.toBe("Private Investor");
  });
});

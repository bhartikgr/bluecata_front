/**
 * server/__tests__/wcoll_w1_post_detail_fail_closed.test.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.7 as corrected by v5 §B2. The restore path
 * rebuilds the author's network channel, and the detail read FAILS CLOSED.
 *
 * CONTEXT. `restorePostFromDb` (commsStore.ts:2555) re-inserts a post into the
 * in-memory `posts` map on boot for every `network_posts` row. It computed a
 * `channelId` but never created the channel. `GET /api/comms/posts/:id` then read
 *
 *     const ch = channels.get(p.channelId);
 *     if (ch && !visible) return 403;      // ← PRISTINE
 *
 * so an UNRESOLVABLE channel skipped the authorisation check entirely and the
 * post was returned to any authenticated caller. On this platform a
 * `visibility:"cap_table"` post carries round and ownership detail, so "I cannot
 * determine the audience" leaked exactly the posts that most needed protecting.
 *
 * The fix has two halves and this suite pins both, because either one alone is
 * wrong:
 *
 *   1. RESTORE — the author's `kind:"network"` channel is reconstructed, so the
 *      ordinary post-restart case resolves and the author does NOT lose access.
 *      Only the network channel: a `cap_table` / `company_followers` channel's
 *      participant list IS the authorisation decision and cannot be derived from
 *      a post row. Synthesising one would either leak the post or wrongly admit
 *      members.
 *   2. READ — `if (!ch || !visible) return 403`.
 *
 * DELIBERATE NARROWING, DISCLOSED. Half (2) is a genuine narrowing: a post whose
 * channel cannot be rebuilt from its own durable source is now DENIED where it
 * was previously served. That is the sanctioned behaviour — the alternative is
 * continuing to serve cap-table posts to strangers — and it is recorded in
 * _WAVE1_RESULT.md. Half (1) exists so the narrowing does not cost the author
 * access to their own post.
 *
 * ANTI-VACUITY. On the PRISTINE tree
 * (/home/user/workspace/build/_presnapshot) every `expect(403)` below returns
 * `200` instead, and the restored network channel does not exist at all
 * (`expected false to be true`). The 404/401 tests and the author-can-still-read
 * test pass on pristine and are labelled REGRESSION GUARD.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb } from "../db/connection";
import { registerCommsRoutes, restorePostFromDb, _commsTest } from "../commsStore";

const AUTHOR = "u_wcoll_pd_author";
const STRANGER = "u_wcoll_pd_stranger";
const COMPANY = "co_wcoll_pd";
const SECRET = "Round closes Friday at a $42M pre — 3 investors still deciding.";

let app: Express;

/** Every post id this suite mints, so `beforeEach` can clean up precisely. */
const MINTED = new Set<string>();

function restore(
  id: string,
  row: Partial<Parameters<typeof restorePostFromDb>[0]> = {},
): void {
  MINTED.add(id);
  restorePostFromDb({
    id,
    authorUserId: AUTHOR,
    body: SECRET,
    createdAt: new Date().toISOString(),
    ...row,
  });
}

/** The channelId the restore path chose for a post, read back from the map. */
function channelIdOf(postId: string): string | undefined {
  return _commsTest.posts.get(postId)?.channelId;
}

function get(postId: string, as: string | null) {
  const r = request(app).get(`/api/comms/posts/${postId}`);
  if (as) r.set("x-user-id", as);
  return r;
}

beforeAll(() => {
  getDb();
  app = express();
  app.use(express.json());
  // `defaultIdentity: false` so an anonymous request stays anonymous and the
  // production 401 path is exercised verbatim.
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);
});

beforeEach(() => {
  for (const id of MINTED) {
    const ch = channelIdOf(id);
    _commsTest.posts.delete(id);
    if (ch) _commsTest.channels.delete(ch);
  }
  MINTED.clear();
});

describe("v5 §B2 — an unresolvable channel DENIES, it does not serve to everyone", () => {
  it("a cap_table post whose channel cannot be rebuilt is 403 for a STRANGER", async () => {
    restore("post_pd_captable", { visibility: "cap_table", companyId: COMPANY });
    // Precondition: this is genuinely the unresolvable state, not a stale channel.
    expect(_commsTest.channels.has(channelIdOf("post_pd_captable")!)).toBe(false);

    const r = await get("post_pd_captable", STRANGER);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain("$42M");
  });

  it("…and 403 for the AUTHOR too — a cap-table roster is never guessed", async () => {
    // Admitting the author would mean synthesising a participant list, which is
    // exactly the inference v5 §B2 refuses to make. The post is not lost: the
    // cap_table channel is rebuilt from its own durable source, not from here.
    restore("post_pd_captable_author", { visibility: "cap_table", companyId: COMPANY });
    const r = await get("post_pd_captable_author", AUTHOR);
    expect(r.status).toBe(403);
  });

  it("a company_followers post whose channel cannot be rebuilt is 403", async () => {
    restore("post_pd_followers", { authorKind: "company", companyId: COMPANY });
    expect(_commsTest.channels.has(channelIdOf("post_pd_followers")!)).toBe(false);
    for (const who of [AUTHOR, STRANGER]) {
      const r = await get("post_pd_followers", who);
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.body)).not.toContain("$42M");
    }
  });

  it("a post whose channel is DELETED after restore is denied, not served", async () => {
    // The same unresolvable state reached a second way, so the guarantee is
    // about the read and not about one restore branch.
    restore("post_pd_vanished", { visibility: "connections" });
    const ch = channelIdOf("post_pd_vanished")!;
    expect(_commsTest.channels.has(ch)).toBe(true);
    _commsTest.channels.delete(ch);

    for (const who of [AUTHOR, STRANGER]) {
      expect((await get("post_pd_vanished", who)).status).toBe(403);
    }
  });

  it("the denial body carries no post content and no channel id", async () => {
    restore("post_pd_nobody", { visibility: "cap_table", companyId: COMPANY });
    const r = await get("post_pd_nobody", STRANGER);
    const body = JSON.stringify(r.body);
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain(COMPANY);
    expect(r.body.post).toBeUndefined();
    expect(r.body.comments).toBeUndefined();
  });
});

describe("v4 §1.7 — the author's network channel IS rebuilt (no access lost)", () => {
  it("restoring a network post creates the author's `kind:\"network\"` channel", () => {
    restore("post_pd_network");
    const ch = _commsTest.channels.get(channelIdOf("post_pd_network")!);
    expect(ch).toBeTruthy();
    expect(ch!.kind).toBe("network");
    expect(ch!.participantUserIds).toEqual([AUTHOR]);
    expect(ch!.metadata?.ownerUserId).toBe(AUTHOR);
  });

  it("REGRESSION GUARD: and the author can still read their own restored post", async () => {
    restore("post_pd_network_read");
    const r = await get("post_pd_network_read", AUTHOR);
    expect(r.status).toBe(200);
    expect(r.body.post.body).toBe(SECRET);
  });

  it("but a stranger CANNOT — the rebuilt channel authorises, it does not open up", async () => {
    restore("post_pd_network_stranger");
    const r = await get("post_pd_network_stranger", STRANGER);
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain("$42M");
  });

  it("only the NETWORK branch reconstructs — cap_table/company_followers do not", () => {
    restore("post_pd_nb_captable", { visibility: "cap_table", companyId: COMPANY });
    restore("post_pd_nb_followers", { authorKind: "company", companyId: COMPANY });
    restore("post_pd_nb_network", { visibility: "connections" });

    expect(_commsTest.channels.has(channelIdOf("post_pd_nb_captable")!)).toBe(false);
    expect(_commsTest.channels.has(channelIdOf("post_pd_nb_followers")!)).toBe(false);
    expect(_commsTest.channels.has(channelIdOf("post_pd_nb_network")!)).toBe(true);
  });

  it("each author gets their OWN channel — one is never reused for another", () => {
    restore("post_pd_two_a", { authorUserId: AUTHOR });
    restore("post_pd_two_b", { authorUserId: STRANGER });
    const chA = channelIdOf("post_pd_two_a")!;
    const chB = channelIdOf("post_pd_two_b")!;
    expect(chA).not.toBe(chB);
    expect(_commsTest.channels.get(chA)!.participantUserIds).toEqual([AUTHOR]);
    expect(_commsTest.channels.get(chB)!.participantUserIds).toEqual([STRANGER]);
  });

  it("restoring twice is idempotent and never widens the participant list", () => {
    restore("post_pd_idem");
    const ch = channelIdOf("post_pd_idem")!;
    _commsTest.channels.get(ch)!.participantUserIds.push("u_wcoll_pd_added_by_a_join");

    restore("post_pd_idem"); // a second boot pass over the same row

    expect(_commsTest.channels.get(ch)!.participantUserIds).toEqual([
      AUTHOR,
      "u_wcoll_pd_added_by_a_join",
    ]);
    expect(_commsTest.posts.get("post_pd_idem")!.body).toBe(SECRET);
  });

  it("an EXISTING channel is never overwritten by the restore path", () => {
    restore("post_pd_existing_probe");
    const ch = channelIdOf("post_pd_existing_probe")!;
    _commsTest.posts.delete("post_pd_existing_probe");
    _commsTest.channels.set(ch, {
      ..._commsTest.channels.get(ch)!,
      participantUserIds: [AUTHOR, STRANGER],
    });

    restore("post_pd_existing_probe2");

    expect(_commsTest.channels.get(ch)!.participantUserIds).toEqual([AUTHOR, STRANGER]);
  });
});

describe("v4 §1.7 — an orphaned row is still dropped, and the read is still authed", () => {
  it("REGRESSION GUARD: a cap_table row with no companyId is not restored at all", async () => {
    restore("post_pd_orphan", { visibility: "cap_table", companyId: null });
    expect(_commsTest.posts.has("post_pd_orphan")).toBe(false);
    expect((await get("post_pd_orphan", AUTHOR)).status).toBe(404);
  });

  it("REGRESSION GUARD: a company-authored row with no companyId is not restored", () => {
    restore("post_pd_orphan_co", { authorKind: "company", companyId: null });
    expect(_commsTest.posts.has("post_pd_orphan_co")).toBe(false);
  });

  it("REGRESSION GUARD: an anonymous caller is 401, never 403-with-a-hint", async () => {
    restore("post_pd_anon");
    expect((await get("post_pd_anon", null)).status).toBe(401);
  });

  it("REGRESSION GUARD: an unknown post id is 404 for everyone", async () => {
    expect((await get("post_pd_does_not_exist", STRANGER)).status).toBe(404);
  });
});

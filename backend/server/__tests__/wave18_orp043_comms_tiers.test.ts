/**
 * WAVE 18 — ORP-043 (DEF-043): the Tier 1/2/3 comms surface, server side.
 *
 * The backlog framed this item as "wire orphaned features". The citations are
 * accurate (co-investor groups, cross-cohort DM start/mute, comms search and
 * high-value-advocates all had zero client callers), but wiring them AS THEY
 * STOOD would have shipped four authorisation defects into the UI:
 *
 *  D1. ACTOR IDENTITY CAME FROM THE REQUEST BODY. `actorId`, `authorUserId`,
 *      `requesterId`, `fromUserId`, `muterId`, `endorserUserId`, `founderUserId`
 *      and the privacy-preference `userId` were all read from `req.body`. The
 *      caller was authenticated by the global /api guard; the ACTOR was whatever
 *      the caller typed. The QA route in the same file already had the correct
 *      pattern (Patch v9 / P0-3), so this is that precedent applied everywhere.
 *  D2. GROUP LISTING WAS COMPANY-WIDE, NOT VIEWER-SCOPED. Any authenticated user
 *      could enumerate the participant lists of rooms they are not in. The
 *      participant list IS the sensitive fact.
 *  D3. POSTING INTO A GROUP DID NOT CHECK MEMBERSHIP.
 *  D4. `GET /api/founder/crm/high-value-advocates` returned the PLATFORM-WIDE
 *      advocate set and named no company at all.
 *
 * Both poles are asserted for every one of them: the spoof is refused AND the
 * legitimate action still succeeds. A refusal-only suite would pass against a
 * route that refuses everything, which is the same defect in the other
 * direction.
 *
 * NOTE ON IDENTITY IN TESTS. `resolvePersonaId` accepts `x-user-id` only under
 * VITEST, so a bare app plus a header is a real session for these routes. Where a
 * route needs `isAdmin`, the context is injected by middleware — asserting admin
 * behaviour through the production auth stack would test the auth stack, not this
 * route. The no-identity pole is asserted on an app with NO header at all, which
 * for these routes (they do not call `requireAuth`) is the genuine 401 path.
 *
 * NO MONEY IS RENDERED OR RETURNED BY ANY ROUTE IN THIS FILE. The tier engines
 * carry messages, opt-ins and endorsements — no amounts, so there is no
 * minor-unit conversion here to get wrong. Recorded explicitly so the absence of
 * a JPY/KWD money fixture in this suite is a stated fact, not an oversight; the
 * mandatory multi-exponent fixtures live in the suite for the surface that DOES
 * carry money (`wave18_orp040_investor_silo.test.ts`).
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import {
  registerCommsTiersRoutes,
  resolveTierActor,
  __resetCommsTiers,
} from "../commsTiersStore";

const CO = "co_w18_orp043";
const ROUND = "rnd_w18_orp043";

/** A bare app: no userContext middleware, so identity comes only from x-user-id. */
function sessionApp(): express.Express {
  const app = express();
  app.use(express.json());
  registerCommsTiersRoutes(app);
  return app;
}

/** An app with an injected context — used only for the admin pole. */
function ctxApp(ctx: Record<string, unknown>): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userContext?: unknown }).userContext = ctx;
    next();
  });
  registerCommsTiersRoutes(app);
  return app;
}

describe("WAVE 18 ORP-043 — resolveTierActor (the identity primitive)", () => {
  function reqOf(headers: Record<string, string> = {}): express.Request {
    return { headers, query: {}, cookies: {} } as unknown as express.Request;
  }

  it("prefers the session over a body value", () => {
    const r = resolveTierActor(reqOf({ "x-user-id": "u_session" }), "u_session", "actorId");
    expect(r).toEqual({ ok: true, actorId: "u_session", source: "session" });
  });

  it("REFUSES 400 when the body names someone other than the session", () => {
    const r = resolveTierActor(reqOf({ "x-user-id": "u_session" }), "u_victim", "authorUserId");
    expect(r).toEqual({ ok: false, status: 400, error: "authorUserId_must_match_session" });
  });

  it("uses the session when the body names nobody", () => {
    const r = resolveTierActor(reqOf({ "x-user-id": "u_session" }), undefined, "actorId");
    expect(r).toEqual({ ok: true, actorId: "u_session", source: "session" });
  });

  it("falls back to the body ONLY when no identity is resolvable (legacy harness shape)", () => {
    const r = resolveTierActor(reqOf(), "u_legacy", "actorId");
    expect(r).toEqual({ ok: true, actorId: "u_legacy", source: "body" });
  });

  it("REFUSES 401 when there is neither a session nor a body value", () => {
    const r = resolveTierActor(reqOf(), undefined, "actorId");
    expect(r).toEqual({ ok: false, status: 401, error: "missing_identity" });
  });

  it("treats a blank/whitespace body value as absent, not as a user id", () => {
    /* Without this, `actorId: "   "` would have been persisted into the hash
       chain as an actor, and `actorId: ""` would have silently become the old
       "u_unknown" placeholder. */
    expect(resolveTierActor(reqOf(), "   ", "actorId")).toEqual({
      ok: false, status: 401, error: "missing_identity",
    });
    expect(resolveTierActor(reqOf({ "x-user-id": "u_a" }), "   ", "actorId")).toEqual({
      ok: true, actorId: "u_a", source: "session",
    });
  });
});

describe("WAVE 18 ORP-043 — Tier 1 co-investor groups", () => {
  beforeEach(() => __resetCommsTiers());

  async function makeGroup(app: express.Express, who: string, participants: string[]) {
    const res = await request(app)
      .post("/api/comms/co-investor-groups")
      .set("x-user-id", who)
      .send({ companyId: CO, participants });
    return res;
  }

  it("records the SESSION as the creator and adds the creator to the room", async () => {
    const app = sessionApp();
    const res = await makeGroup(app, "u_alice", ["u_bob"]);
    expect(res.status).toBe(200);
    expect(res.body.participants).toContain("u_alice");
    expect(res.body.participants).toContain("u_bob");
  });

  it("REFUSES a body actorId that names someone else (was: silently trusted)", async () => {
    const app = sessionApp();
    const res = await request(app)
      .post("/api/comms/co-investor-groups")
      .set("x-user-id", "u_alice")
      .send({ companyId: CO, participants: ["u_bob"], actorId: "u_carol" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("actorId_must_match_session");
  });

  it("REFUSES 401 with no identity at all — and the same call succeeds with one", async () => {
    const app = sessionApp();
    const anon = await request(app)
      .post("/api/comms/co-investor-groups")
      .send({ companyId: CO, participants: ["u_bob"] });
    expect(anon.status).toBe(401);
    expect(anon.body.error).toBe("missing_identity");
    const authed = await makeGroup(app, "u_alice", ["u_bob"]);
    expect(authed.status).toBe(200);
  });

  it("lists ONLY the viewer's own rooms — a non-participant sees an empty list, not other people's rooms", async () => {
    const app = sessionApp();
    const mine = await makeGroup(app, "u_alice", ["u_bob"]);
    expect(mine.status).toBe(200);

    /* POSITIVE POLE — a participant sees it. */
    for (const who of ["u_alice", "u_bob"]) {
      const seen = await request(app).get(`/api/comms/co-investor-groups/${CO}`).set("x-user-id", who);
      expect(seen.status).toBe(200);
      expect(seen.body.viewerUserId).toBe(who);
      expect((seen.body.groups as Array<{ id: string }>).map((g) => g.id)).toContain(mine.body.id);
    }

    /* NEGATIVE POLE — an outsider on the same company sees nothing. */
    const outsider = await request(app)
      .get(`/api/comms/co-investor-groups/${CO}`)
      .set("x-user-id", "u_outsider");
    expect(outsider.status).toBe(200);
    expect(outsider.body.groups).toEqual([]);
    /* And the participant list — the sensitive fact — is nowhere in the body. */
    expect(JSON.stringify(outsider.body)).not.toContain("u_bob");
  });

  it("a non-participant CANNOT post into the room, and a participant can", async () => {
    const app = sessionApp();
    const g = await makeGroup(app, "u_alice", ["u_bob"]);
    const outsider = await request(app)
      .post(`/api/comms/co-investor-groups/${g.body.id}/messages`)
      .set("x-user-id", "u_outsider")
      .send({ body: "let me in" });
    expect(outsider.status).toBe(403);
    expect(outsider.body.error).toBe("not_a_participant");

    const member = await request(app)
      .post(`/api/comms/co-investor-groups/${g.body.id}/messages`)
      .set("x-user-id", "u_bob")
      .send({ body: "hello" });
    expect(member.status).toBe(200);
    /* The stored author is the session, not anything the body could have said. */
    expect(member.body.authorUserId).toBe("u_bob");
  });

  it("REFUSES a spoofed authorUserId even from a legitimate participant", async () => {
    const app = sessionApp();
    const g = await makeGroup(app, "u_alice", ["u_bob"]);
    const res = await request(app)
      .post(`/api/comms/co-investor-groups/${g.body.id}/messages`)
      .set("x-user-id", "u_bob")
      .send({ body: "signed as alice", authorUserId: "u_alice" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("authorUserId_must_match_session");
  });

  it("posting into a group that does not exist is 404, not a 500 from the store throw", async () => {
    /* `postCoInvestorGroupMessage` THROWS on an unknown group; unguarded that
       surfaced as an unhandled 500. */
    const app = sessionApp();
    const res = await request(app)
      .post("/api/comms/co-investor-groups/cig_nope/messages")
      .set("x-user-id", "u_alice")
      .send({ body: "hi" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("group_not_found");
  });

  it("intro requests are membership-gated and requester-bound", async () => {
    const app = sessionApp();
    const g = await makeGroup(app, "u_alice", ["u_bob"]);
    const outsider = await request(app)
      .post(`/api/comms/co-investor-groups/${g.body.id}/intro`)
      .set("x-user-id", "u_outsider")
      .send({ targetId: "u_bob" });
    expect(outsider.status).toBe(403);

    const spoof = await request(app)
      .post(`/api/comms/co-investor-groups/${g.body.id}/intro`)
      .set("x-user-id", "u_alice")
      .send({ targetId: "u_bob", requesterId: "u_bob" });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error).toBe("requesterId_must_match_session");

    const ok = await request(app)
      .post(`/api/comms/co-investor-groups/${g.body.id}/intro`)
      .set("x-user-id", "u_alice")
      .send({ targetId: "u_bob" });
    expect(ok.status).toBe(200);
  });
});

describe("WAVE 18 ORP-043 — Tier 2 privacy preferences and IOI pulse", () => {
  beforeEach(() => __resetCommsTiers());

  it("an investor CANNOT opt another investor in to cross-cohort DMs", async () => {
    const app = sessionApp();
    const spoof = await request(app)
      .post(`/api/comms/soft-circle/${ROUND}/peer`)
      .set("x-user-id", "u_alice")
      .send({ userId: "u_victim", optedIn: true, crossCohortDmOptedIn: true });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error).toBe("userId_must_match_session");

    /* And the victim's preference was NOT written — the read-back is the sink. */
    const peers = await request(app)
      .get(`/api/comms/soft-circle/${ROUND}/peer`)
      .set("x-user-id", "u_alice");
    expect(peers.status).toBe(200);
    expect(JSON.stringify(peers.body)).not.toContain("u_victim");
  });

  it("an investor CAN set their own preference, and it reads back", async () => {
    const app = sessionApp();
    const mine = await request(app)
      .post(`/api/comms/soft-circle/${ROUND}/peer`)
      .set("x-user-id", "u_alice")
      .send({ optedIn: true, crossCohortDmOptedIn: true });
    expect(mine.status).toBe(200);
    expect(mine.body.userId).toBe("u_alice");
    const peers = await request(app)
      .get(`/api/comms/soft-circle/${ROUND}/peer`)
      .set("x-user-id", "u_alice");
    expect((peers.body.peers as Array<{ userId: string }>).map((p) => p.userId)).toContain("u_alice");
  });

  it("an IOI pulse is recorded against the session, never a body userId", async () => {
    const app = sessionApp();
    const spoof = await request(app)
      .patch(`/api/rounds/${ROUND}/ioi-pulse`)
      .set("x-user-id", "u_alice")
      .send({ userId: "u_victim", pulse: "pass" });
    expect(spoof.status).toBe(400);

    const ok = await request(app)
      .patch(`/api/rounds/${ROUND}/ioi-pulse`)
      .set("x-user-id", "u_alice")
      .send({ pulse: "leaning_yes" });
    expect(ok.status).toBe(200);
    expect(ok.body.userId).toBe("u_alice");

    /* An invalid pulse is still refused — the identity change did not eat the
       existing validation. */
    const bad = await request(app)
      .patch(`/api/rounds/${ROUND}/ioi-pulse`)
      .set("x-user-id", "u_alice")
      .send({ pulse: "definitely_maybe" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("missing_or_invalid_pulse");
  });
});

describe("WAVE 18 ORP-043 — Tier 3 cross-cohort DM, mute, endorsements", () => {
  beforeEach(() => __resetCommsTiers());

  async function optIn(app: express.Express, who: string) {
    return request(app)
      .post(`/api/comms/soft-circle/${ROUND}/peer`)
      .set("x-user-id", who)
      .send({ optedIn: true, crossCohortDmOptedIn: true });
  }

  it("the recipient's opt-out is a RENDERED refusal, not a silent drop", async () => {
    const app = sessionApp();
    const res = await request(app)
      .post("/api/comms/cross-cohort/dm/start")
      .set("x-user-id", "u_alice")
      .send({ roundId: ROUND, toUserId: "u_softcircler", body: "hi" });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("soft_circler_opted_out");
  });

  it("an opted-in recipient receives it, and the sender is the SESSION", async () => {
    const app = sessionApp();
    expect((await optIn(app, "u_softcircler")).status).toBe(200);
    const res = await request(app)
      .post("/api/comms/cross-cohort/dm/start")
      .set("x-user-id", "u_alice")
      .send({ roundId: ROUND, toUserId: "u_softcircler", body: "hi" });
    expect(res.status).toBe(200);
    expect(res.body.fromUserId).toBe("u_alice");
  });

  it("A MUTE CANNOT BE WALKED PAST BY SPOOFING THE SENDER — the whole point of D1", async () => {
    const app = sessionApp();
    await optIn(app, "u_softcircler");
    /* The recipient mutes alice. */
    const muted = await request(app)
      .post("/api/comms/cross-cohort/mute")
      .set("x-user-id", "u_softcircler")
      .send({ roundId: ROUND, mutedId: "u_alice" });
    expect(muted.status).toBe(200);

    /* Alice is now blocked … */
    const blocked = await request(app)
      .post("/api/comms/cross-cohort/dm/start")
      .set("x-user-id", "u_alice")
      .send({ roundId: ROUND, toUserId: "u_softcircler", body: "hi again" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("muted_by_recipient");

    /* … and borrowing an un-muted investor's id no longer helps her. Before the
       fix this request succeeded and was attributed to u_carol. */
    const borrowed = await request(app)
      .post("/api/comms/cross-cohort/dm/start")
      .set("x-user-id", "u_alice")
      .send({ roundId: ROUND, toUserId: "u_softcircler", body: "hi again", fromUserId: "u_carol" });
    expect(borrowed.status).toBe(400);
    expect(borrowed.body.error).toBe("fromUserId_must_match_session");

    /* POSITIVE POLE: u_carol herself is not muted and still gets through, so the
       mute is a per-sender fact and not a blanket shutdown. */
    const carol = await request(app)
      .post("/api/comms/cross-cohort/dm/start")
      .set("x-user-id", "u_carol")
      .send({ roundId: ROUND, toUserId: "u_softcircler", body: "hello" });
    expect(carol.status).toBe(200);
    expect(carol.body.fromUserId).toBe("u_carol");
  });

  it("a mute cannot be placed on another investor's behalf", async () => {
    const app = sessionApp();
    const spoof = await request(app)
      .post("/api/comms/cross-cohort/mute")
      .set("x-user-id", "u_alice")
      .send({ roundId: ROUND, muterId: "u_victim", mutedId: "u_carol" });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error).toBe("muterId_must_match_session");
  });

  it("the hard cap still holds after the identity change (3 unsolicited DMs per soft-circler per round)", async () => {
    const app = sessionApp();
    await optIn(app, "u_softcircler");
    const statuses: number[] = [];
    for (const sender of ["u_s1", "u_s2", "u_s3", "u_s4"]) {
      const r = await request(app)
        .post("/api/comms/cross-cohort/dm/start")
        .set("x-user-id", sender)
        .send({ roundId: ROUND, toUserId: "u_softcircler", body: "hi" });
      statuses.push(r.status);
    }
    /* The cap is COMBINED across senders, so the fourth distinct sender is the
       one refused — spoofing used to be the way around exactly this. */
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses[3]).toBe(429);
  });

  it("an endorsement is attributed to the session, and removal is founder-bound", async () => {
    const app = sessionApp();
    const spoof = await request(app)
      .post(`/api/rounds/${ROUND}/endorsements`)
      .set("x-user-id", "u_alice")
      .send({ companyId: CO, endorserUserId: "u_carol", chip: "team_quality", text: "great", disclaimerAck: true });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error).toBe("endorserUserId_must_match_session");

    const made = await request(app)
      .post(`/api/rounds/${ROUND}/endorsements`)
      .set("x-user-id", "u_alice")
      .send({ companyId: CO, chip: "team_quality", text: "great", disclaimerAck: true });
    expect(made.status).toBe(200);
    expect(made.body.endorserUserId).toBe("u_alice");

    /* The mandatory disclaimer (Top-5 guard #2) is untouched by the change. */
    const noAck = await request(app)
      .post(`/api/rounds/${ROUND}/endorsements`)
      .set("x-user-id", "u_alice")
      .send({ companyId: CO, chip: "team_quality", text: "great", disclaimerAck: false });
    expect(noAck.status).toBe(400);
    expect(noAck.body.error).toBe("disclaimer_required");

    const spoofRemove = await request(app)
      .delete(`/api/rounds/${ROUND}/endorsements/${made.body.id}`)
      .set("x-user-id", "u_alice")
      .send({ founderUserId: "u_founder" });
    expect(spoofRemove.status).toBe(400);
    expect(spoofRemove.body.error).toBe("founderUserId_must_match_session");
  });
});

describe("WAVE 18 ORP-043 — high-value advocates are company-scoped", () => {
  beforeEach(() => __resetCommsTiers());

  it("REFUSES 400 without a companyId (it used to answer the whole platform)", async () => {
    const res = await request(sessionApp())
      .get("/api/founder/crm/high-value-advocates")
      .set("x-user-id", "u_alice");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("companyId required");
  });

  it("REFUSES 403 for a caller who is not on that company's cap table", async () => {
    const res = await request(sessionApp())
      .get(`/api/founder/crm/high-value-advocates?companyId=${CO}`)
      .set("x-user-id", "u_outsider");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("NOT_ON_CAP_TABLE");
  });

  it("REFUSES 401 with no identity", async () => {
    const res = await request(sessionApp()).get(`/api/founder/crm/high-value-advocates?companyId=${CO}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("missing_identity");
  });

  it("an admin reads ONE company's advocates — never another company's", async () => {
    const app = ctxApp({ userId: "u_admin", isAdmin: true, isAuthed: true });
    const other = "co_w18_orp043_other";
    /* Two endorsements, two different companies, two different endorsers. */
    const a = await request(app)
      .post(`/api/rounds/${ROUND}/endorsements`)
      .send({ companyId: CO, chip: "team_quality", text: "x", disclaimerAck: true });
    expect(a.status).toBe(200);
    expect(a.body.endorserUserId).toBe("u_admin");

    const appB = ctxApp({ userId: "u_other_endorser", isAdmin: true, isAuthed: true });
    const b = await request(appB)
      .post(`/api/rounds/${ROUND}/endorsements`)
      .send({ companyId: other, chip: "team_quality", text: "y", disclaimerAck: true });
    expect(b.status).toBe(200);

    const scoped = await request(app).get(`/api/founder/crm/high-value-advocates?companyId=${CO}`);
    expect(scoped.status).toBe(200);
    expect(scoped.body.companyId).toBe(CO);
    expect(scoped.body.advocates).toEqual(["u_admin"]);
    /* THE LEAK POLE: the other company's endorser must not appear. */
    expect(scoped.body.advocates).not.toContain("u_other_endorser");

    /* The advisory framing is preserved verbatim — it is a compliance string. */
    expect(scoped.body.label).toBe("For informational purposes only");
    expect(scoped.body.note).toMatch(/NOT a cap-table-engine input/);

    /* And the other company's list is its own, proving the filter is on companyId
       and not simply "everything except the caller". */
    const otherList = await request(appB).get(
      `/api/founder/crm/high-value-advocates?companyId=${other}`,
    );
    expect(otherList.body.advocates).toEqual(["u_other_endorser"]);
  });

  it("a removed endorsement drops the advocate from the company list", async () => {
    const app = ctxApp({ userId: "u_admin", isAdmin: true, isAuthed: true });
    const made = await request(app)
      .post(`/api/rounds/${ROUND}/endorsements`)
      .send({ companyId: CO, chip: "team_quality", text: "x", disclaimerAck: true });
    expect(made.status).toBe(200);
    const before = await request(app).get(`/api/founder/crm/high-value-advocates?companyId=${CO}`);
    expect(before.body.advocates).toEqual(["u_admin"]);

    const removed = await request(app)
      .delete(`/api/rounds/${ROUND}/endorsements/${made.body.id}`)
      .send({});
    expect(removed.status).toBe(200);

    const after = await request(app).get(`/api/founder/crm/high-value-advocates?companyId=${CO}`);
    expect(after.body.advocates).toEqual([]);
  });
});

describe("WAVE 18 ORP-043 — the SECOND path the fence found (Q&A + diligence)", () => {
  beforeEach(() => __resetCommsTiers());

  it("a Q&A answer cannot be signed as another user, and a legitimate one lands", async () => {
    const app = sessionApp();
    const q = await request(app)
      .post(`/api/rounds/${ROUND}/qa`)
      .set("x-user-id", "u_alice")
      .send({ body: "what is the runway?" });
    expect(q.status).toBe(200);

    const spoof = await request(app)
      .post(`/api/rounds/${ROUND}/qa/${q.body.id}/answers`)
      .set("x-user-id", "u_alice")
      .send({ body: "18 months", authorUserId: "u_founder" });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error).toBe("authorUserId_must_match_session");

    const ok = await request(app)
      .post(`/api/rounds/${ROUND}/qa/${q.body.id}/answers`)
      .set("x-user-id", "u_founder")
      .send({ body: "18 months" });
    expect(ok.status).toBe(200);
    expect(ok.body.authorUserId).toBe("u_founder");
  });

  it("archiving a Q&A thread is bound to the session", async () => {
    const app = sessionApp();
    const q = await request(app)
      .post(`/api/rounds/${ROUND}/qa`)
      .set("x-user-id", "u_alice")
      .send({ body: "q?" });
    const spoof = await request(app)
      .post(`/api/rounds/${ROUND}/qa/${q.body.id}/archive`)
      .set("x-user-id", "u_alice")
      .send({ founderUserId: "u_founder" });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error).toBe("founderUserId_must_match_session");
    const anon = await request(app).post(`/api/rounds/${ROUND}/qa/${q.body.id}/archive`).send({});
    expect(anon.status).toBe(401);
  });

  it("volunteering for diligence cannot be done in someone else's name", async () => {
    const app = sessionApp();
    const spoof = await request(app)
      .post(`/api/rounds/${ROUND}/diligence-volunteers`)
      .set("x-user-id", "u_alice")
      .send({ volunteerUserId: "u_victim", softCirclerUserId: "u_sc" });
    expect(spoof.status).toBe(400);
    expect(spoof.body.error).toBe("volunteerUserId_must_match_session");

    const ok = await request(app)
      .post(`/api/rounds/${ROUND}/diligence-volunteers`)
      .set("x-user-id", "u_alice")
      .send({ softCirclerUserId: "u_sc" });
    expect(ok.status).toBe(200);
    expect(ok.body.volunteerUserId).toBe("u_alice");

    /* The other required field is still required. */
    const missing = await request(app)
      .post(`/api/rounds/${ROUND}/diligence-volunteers`)
      .set("x-user-id", "u_alice")
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("missing_fields");
  });
});

describe("WAVE 18 ORP-043 — source fence: no body-supplied actor survives", () => {
  it("no tier route reads an actor field straight out of req.body into a store call", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../commsTiersStore.ts", import.meta.url), "utf-8");
    /* Comment-stripped, so a fence that only matches prose cannot pass. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");

    /* The old shapes, verbatim: an actor threaded from the body INTO THE ENGINE
       CALL. Deliberately matched at the store call rather than at the
       destructure — the destructure is still there (the body value is read so a
       MISMATCH can be reported as a 400 instead of silently overridden), so a
       fence on the destructure would have banned the fix as well as the defect.
       The first draft of this fence did exactly that and reported a false
       positive on an already-hardened route; this is the corrected shape. */
    const banned = [
      "actorId: String(actorId",
      "postCoInvestorGroupMessage({ groupId: req.params.id, authorUserId,",
      "requestCoInvestorIntro({ groupId: req.params.id, requesterId,",
      "startCrossCohortDm({ roundId, fromUserId,",
      "muteCrossCohort({ roundId, muterId,",
      "createEndorsement({ roundId: req.params.roundId, companyId, endorserUserId,",
      "removeEndorsement({ id: req.params.id, founderUserId })",
      "postQaAnswer({ questionId: req.params.qid, authorUserId,",
      "archiveQaThread({ questionId: req.params.qid, founderUserId })",
      "createDiligenceVolunteer({ roundId: req.params.roundId, volunteerUserId,",
      "setSoftCirclePeerOptIn({ roundId: req.params.roundId, userId,",
      "setIoiPulse({ roundId: req.params.roundId, userId,",
      "postQaQuestion({ roundId: req.params.roundId, askerUserId, body })",
    ];
    for (const b of banned) {
      expect(code.includes(b), `body-supplied actor still threaded: ${b}`).toBe(false);
    }

    /* POSITIVE POLE — the fence is proven to FIRE on a fixture that contains one,
       so a passing run means something. */
    const fixture = 'const r = startCrossCohortDm({ roundId, fromUserId, toUserId, body });';
    expect(banned.some((b) => fixture.includes(b))).toBe(true);

    /* And every mutation route must route through resolveTierActor. Counted, not
       merely "present once": ten call sites, one per actor-bearing route. */
    const calls = code.match(/resolveTierActor\(req/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(14);
  });
});

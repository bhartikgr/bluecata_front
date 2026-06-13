/**
 * v18 Phase C — Ask-an-Expert (Q&A + reputation + notifications).
 *
 * Coverage:
 *   - POST a question (asker reputation +1)
 *   - POST an answer (responder reputation +5; asker cannot answer own)
 *   - Vote up / down / toggle off / replace; voter cannot vote own answer
 *   - Accept best (+15); re-accept reverts previous best (-15 from prev,
 *     +15 to new); idempotent re-accept of the SAME answer is a no-op.
 *   - Reputation arithmetic across a full scenario (questions × answers ×
 *     votes × best-answer accept) matches the formula exactly.
 *   - Flag changes status to 'flagged' on both questions and answers.
 *   - Cross-chapter isolation — a chap_nyc member can't read chap_keiretsu_canada
 *     questions and vice versa.
 *   - Cross-tenant rejection — tenant scoping is enforced by the store.
 *   - Concurrent-vote race: two writers, one wins, the other gets 409.
 *   - view_count atomically increments per detail GET (skipped when viewer
 *     is the asker).
 *   - Hash chain integrity across question + answer mutation sequences.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { and, eq } from "drizzle-orm";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { hydrateMultiCompanyStore } from "../multiCompanyStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { __setRuntimePersona } from "../lib/userContext";
import {
  chapterMemberships as chapterMembershipsTable,
  expertQuestions as questionsTable,
  expertAnswers as answersTable,
  expertVotes as votesTable,
  expertReputation as reputationTable,
} from "@shared/schema";
import {
  _internal as expertInternal,
  getReputationFor,
  getQuestionById,
  getAnswerById,
} from "../expertQAStore";

const CHAPTER_ID = "chap_keiretsu_canada";
const TENANT_ID = "tenant_chap_chap_keiretsu_canada";
const FOREIGN_CHAPTER_ID = "chap_nyc";
const FOREIGN_TENANT_ID = "tenant_chap_chap_nyc";

const MAYA = "u_maya_chen";        // member, asker
const AISHA = "u_aisha_patel";     // chapter admin
const DANIEL = "u_daniel_okafor";  // member, responder

let app: Express;
let server: http.Server;
let port: number;

/* --------------------------------------------------------------- */
/* HTTP helper                                                      */
/* --------------------------------------------------------------- */

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let body: any = null;
          try {
            body = JSON.parse(buf);
          } catch {
            body = { raw: buf };
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

/* --------------------------------------------------------------- */
/* Helpers                                                          */
/* --------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

function clearExpertTables(): void {
  const db: any = getDb();
  // CROSS-TENANT (admin/test) — full wipe between tests.
  db.delete(votesTable).run();
  db.delete(answersTable).run();
  db.delete(questionsTable).run();
  db.delete(reputationTable).run();
}

/**
 * Spin up a fresh runtime persona so requireAuth() flips isAuthed=true for
 * synthetic test users. Idempotent.
 */
function registerTestPersona(userId: string, email: string, name: string): void {
  __setRuntimePersona({
    userId,
    email,
    name,
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });
}

function ensureChapterMembership(
  userId: string,
  chapterId: string,
  tenantId: string,
  role: "member" | "admin" = "member",
): void {
  const db: any = getDb();
  // CROSS-TENANT (admin/test) — seat the user as an active chapter member.
  const existing = db
    .select({ id: chapterMembershipsTable.id })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq(chapterMembershipsTable.userId, userId),
        eq(chapterMembershipsTable.chapterId, chapterId),
      ),
    )
    .all() as any[];
  if (existing.length > 0) return;
  db.insert(chapterMembershipsTable)
    .values({
      id: `chmem_${userId}_${chapterId}_${Math.random().toString(36).slice(2, 8)}`,
      tenantId,
      chapterId,
      userId,
      role,
      status: "active",
      joinedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } as any)
    .run();
}

/* --------------------------------------------------------------- */
/* Lifecycle                                                        */
/* --------------------------------------------------------------- */

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";

  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  for (const uid of [MAYA, AISHA, DANIEL]) {
    collectiveMembershipStore.activate(uid, "u_admin_test");
  }

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 30_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

beforeEach(() => {
  clearExpertTables();
});

/* --------------------------------------------------------------- */
/* Tests                                                            */
/* --------------------------------------------------------------- */

describe("v18C Ask-an-Expert — questions & basic flow", () => {
  it("POST /api/collective/questions creates a question and bumps reputation +1", async () => {
    const res = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: {
        title: "How do I structure a SAFE for an early hire?",
        body: "We're trying to figure out the cap table impact of a SAFE conversion at our seed.",
        tags: ["fundraising", "safe", "hiring"],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.question.askerUserId).toBe(MAYA);
    expect(res.body.question.tags).toEqual(["fundraising", "safe", "hiring"]);
    expect(res.body.question.status).toBe("open");
    expect(res.body.question.currHash).toMatch(/^[0-9a-f]{64}$/);

    const rep = getReputationFor(MAYA, CHAPTER_ID);
    expect(rep).not.toBeNull();
    expect(rep!.questionsAsked).toBe(1);
    expect(rep!.score).toBe(1);
  });

  it("POST .../answers creates an answer (+5 reputation) and the question flips to 'answered'", async () => {
    const qRes = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "Body", tags: ["t1"] },
    });
    const qid = qRes.body.question.id;

    const aRes = await call("POST", `/api/collective/questions/${qid}/answers`, {
      userId: DANIEL,
      body: { body: "Here's how I'd approach it." },
    });
    expect(aRes.status).toBe(201);
    expect(aRes.body.answer.responderUserId).toBe(DANIEL);

    const q = getQuestionById(qid);
    expect(q?.status).toBe("answered");

    const rep = getReputationFor(DANIEL, CHAPTER_ID);
    expect(rep?.answersGiven).toBe(1);
    expect(rep?.score).toBe(5);
  });

  it("asker cannot answer own question (403 cannot_answer_own_question)", async () => {
    const qRes = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const aRes = await call(
      "POST",
      `/api/collective/questions/${qRes.body.question.id}/answers`,
      { userId: MAYA, body: { body: "Self-answer attempt" } },
    );
    expect(aRes.status).toBe(403);
    expect(aRes.body.error).toBe("cannot_answer_own_question");
  });

  it("non-asker / non-admin cannot edit a question", async () => {
    const qRes = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const editRes = await call("PATCH", `/api/collective/questions/${qRes.body.question.id}`, {
      userId: DANIEL,
      body: { title: "Hacked title" },
    });
    expect(editRes.status).toBe(403);
    expect(editRes.body.error).toBe("not_question_asker");
  });
});

describe("v18C Ask-an-Expert — voting", () => {
  async function setupQA() {
    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const a = await call("POST", `/api/collective/questions/${q.body.question.id}/answers`, {
      userId: DANIEL,
      body: { body: "Answer body" },
    });
    return { qid: q.body.question.id, aid: a.body.answer.id };
  }

  it("upvote creates a vote, increments upvote_count, gives +2 reputation to responder", async () => {
    const { aid } = await setupQA();
    const v = await call("POST", `/api/collective/answers/${aid}/vote`, {
      userId: AISHA,
      body: { vote_type: "up" },
    });
    expect(v.status).toBe(200);
    expect(v.body.outcome).toBe("created");
    expect(v.body.answer.upvoteCount).toBe(1);

    const rep = getReputationFor(DANIEL, CHAPTER_ID);
    // +5 for the answer + (+2 × 1) upvote received = 7
    expect(rep?.score).toBe(7);
  });

  it("re-cast same vote_type toggles off (removed)", async () => {
    const { aid } = await setupQA();
    await call("POST", `/api/collective/answers/${aid}/vote`, {
      userId: AISHA,
      body: { vote_type: "up" },
    });
    const v2 = await call("POST", `/api/collective/answers/${aid}/vote`, {
      userId: AISHA,
      body: { vote_type: "up" },
    });
    expect(v2.body.outcome).toBe("removed");
    expect(v2.body.answer.upvoteCount).toBe(0);
    const rep = getReputationFor(DANIEL, CHAPTER_ID);
    expect(rep?.score).toBe(5); // back to just the answer reward
  });

  it("opposite vote_type replaces the existing vote", async () => {
    const { aid } = await setupQA();
    await call("POST", `/api/collective/answers/${aid}/vote`, {
      userId: AISHA,
      body: { vote_type: "up" },
    });
    const v2 = await call("POST", `/api/collective/answers/${aid}/vote`, {
      userId: AISHA,
      body: { vote_type: "down" },
    });
    expect(v2.body.outcome).toBe("replaced");
    expect(v2.body.answer.upvoteCount).toBe(-1);
    const rep = getReputationFor(DANIEL, CHAPTER_ID);
    // +5 (answer) + (-2 × 1) = 3
    expect(rep?.score).toBe(3);
  });

  it("voter cannot vote on own answer", async () => {
    const { aid } = await setupQA();
    const v = await call("POST", `/api/collective/answers/${aid}/vote`, {
      userId: DANIEL,
      body: { vote_type: "up" },
    });
    expect(v.status).toBe(403);
    expect(v.body.error).toBe("cannot_vote_on_own_answer");
  });

  it("concurrent-vote race: only one vote row ever exists per (answer, voter)", async () => {
    const { aid } = await setupQA();
    // Issue two concurrent upvote requests by the same voter (AISHA).
    // The UNIQUE(answer_id, voter_user_id) constraint guarantees that only
    // one row ends up in the votes ledger; the second insert collides and
    // is surfaced as a 409 or it goes through the toggle path. Either way,
    // exactly one row should exist at the end.
    const [r1, r2] = await Promise.all([
      call("POST", `/api/collective/answers/${aid}/vote`, {
        userId: AISHA,
        body: { vote_type: "up" },
      }),
      call("POST", `/api/collective/answers/${aid}/vote`, {
        userId: AISHA,
        body: { vote_type: "up" },
      }),
    ]);
    // At least one must succeed; the other can either succeed-then-toggle
    // off, or fail with 409 / be a same-vote toggle. Final state should
    // therefore be a single vote row OR zero (if the second was a toggle).
    const db: any = getDb();
    const rows = db
      .select()
      .from(votesTable)
      .where(eq(votesTable.answerId, aid))
      .all() as any[];
    expect(rows.length).toBeLessThanOrEqual(1);
    // Both responses are 200 (since toggle-off is a valid outcome) OR one
    // is 409. Status codes are always in [200, 409].
    expect([200, 409]).toContain(r1.status);
    expect([200, 409]).toContain(r2.status);
  });
});

describe("v18C Ask-an-Expert — accept-best", () => {
  it("asker accepts best → +15 reputation; re-accepting another reverts -15 and gives +15", async () => {
    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const a1 = await call(
      "POST",
      `/api/collective/questions/${q.body.question.id}/answers`,
      { userId: DANIEL, body: { body: "answer 1" } },
    );
    const a2 = await call(
      "POST",
      `/api/collective/questions/${q.body.question.id}/answers`,
      { userId: AISHA, body: { body: "answer 2" } },
    );

    // Accept Daniel's answer first.
    const accept1 = await call(
      "POST",
      `/api/collective/answers/${a1.body.answer.id}/accept-best`,
      { userId: MAYA, body: {} },
    );
    expect(accept1.status).toBe(200);
    expect(accept1.body.answer.isBestAnswer).toBe(true);
    expect(accept1.body.question.bestAnswerId).toBe(a1.body.answer.id);
    // Daniel: +5 (answer) + +15 (best) = 20
    expect(getReputationFor(DANIEL, CHAPTER_ID)?.score).toBe(20);
    // Aisha: +5 (her own answer)
    expect(getReputationFor(AISHA, CHAPTER_ID)?.score).toBe(5);

    // Now re-accept Aisha's answer — Daniel loses 15, Aisha gains 15.
    const accept2 = await call(
      "POST",
      `/api/collective/answers/${a2.body.answer.id}/accept-best`,
      { userId: MAYA, body: {} },
    );
    expect(accept2.status).toBe(200);
    expect(accept2.body.answer.isBestAnswer).toBe(true);
    expect(accept2.body.previousBest?.id).toBe(a1.body.answer.id);
    expect(accept2.body.previousBest?.isBestAnswer).toBe(false);
    // Daniel back to 5; Aisha up to 20.
    expect(getReputationFor(DANIEL, CHAPTER_ID)?.score).toBe(5);
    expect(getReputationFor(AISHA, CHAPTER_ID)?.score).toBe(20);
  });

  it("re-accepting the same best answer is idempotent (200, no rep change)", async () => {
    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const a = await call(
      "POST",
      `/api/collective/questions/${q.body.question.id}/answers`,
      { userId: DANIEL, body: { body: "answer" } },
    );
    await call(
      "POST",
      `/api/collective/answers/${a.body.answer.id}/accept-best`,
      { userId: MAYA, body: {} },
    );
    const repBefore = getReputationFor(DANIEL, CHAPTER_ID)?.score;
    const replay = await call(
      "POST",
      `/api/collective/answers/${a.body.answer.id}/accept-best`,
      { userId: MAYA, body: {} },
    );
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(getReputationFor(DANIEL, CHAPTER_ID)?.score).toBe(repBefore);
  });

  it("non-asker cannot accept best (403)", async () => {
    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const a = await call(
      "POST",
      `/api/collective/questions/${q.body.question.id}/answers`,
      { userId: DANIEL, body: { body: "answer" } },
    );
    const res = await call(
      "POST",
      `/api/collective/answers/${a.body.answer.id}/accept-best`,
      { userId: AISHA, body: {} },
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_question_asker");
  });
});

describe("v18C Ask-an-Expert — full reputation scenario", () => {
  it("computes reputation correctly across questions × answers × votes × best", async () => {
    // Maya asks 2 questions (+1 each)            → Maya score = 2
    // Daniel answers both (+5 each)              → Daniel = 10
    // Aisha answers q1 (+5)                      → Aisha = 5
    // Aisha upvotes Daniel's q1 (+2)             → Daniel = 12
    // Aisha downvotes Daniel's q2 (-2)           → Daniel = 10
    // Daniel upvotes Aisha's q1 (+2)             → Aisha = 7
    // Maya accepts Daniel's q1 as best (+15)     → Daniel = 25
    // Maya accepts Aisha's q1 as best —          → Aisha = 22 (5 answer + 2 upvote + 15 best)
    //   reverts Daniel's prior best              → Daniel = 10 (12 - 15 + 0… wait: 5+5+2-2+0=10)
    // Net at end: Maya=2, Daniel=10, Aisha=22.

    const q1 = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "Q1", body: "B", tags: [] },
    });
    const q2 = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "Q2", body: "B", tags: [] },
    });

    const d_a1 = await call(
      "POST",
      `/api/collective/questions/${q1.body.question.id}/answers`,
      { userId: DANIEL, body: { body: "d on q1" } },
    );
    const d_a2 = await call(
      "POST",
      `/api/collective/questions/${q2.body.question.id}/answers`,
      { userId: DANIEL, body: { body: "d on q2" } },
    );
    const a_a1 = await call(
      "POST",
      `/api/collective/questions/${q1.body.question.id}/answers`,
      { userId: AISHA, body: { body: "a on q1" } },
    );

    // Aisha upvotes Daniel's q1 answer.
    await call("POST", `/api/collective/answers/${d_a1.body.answer.id}/vote`, {
      userId: AISHA,
      body: { vote_type: "up" },
    });
    // Aisha downvotes Daniel's q2 answer.
    await call("POST", `/api/collective/answers/${d_a2.body.answer.id}/vote`, {
      userId: AISHA,
      body: { vote_type: "down" },
    });
    // Daniel upvotes Aisha's q1 answer.
    await call("POST", `/api/collective/answers/${a_a1.body.answer.id}/vote`, {
      userId: DANIEL,
      body: { vote_type: "up" },
    });

    // Maya accepts Daniel's q1 answer (best).
    await call(
      "POST",
      `/api/collective/answers/${d_a1.body.answer.id}/accept-best`,
      { userId: MAYA, body: {} },
    );

    // Snapshot AFTER first best: Daniel = 5+5+2-2+15 = 25, Aisha = 5+2 = 7.
    expect(getReputationFor(DANIEL, CHAPTER_ID)?.score).toBe(25);
    expect(getReputationFor(AISHA, CHAPTER_ID)?.score).toBe(7);
    expect(getReputationFor(MAYA, CHAPTER_ID)?.score).toBe(2);

    // Now re-accept Aisha's q1 → revert Daniel's q1 best.
    await call(
      "POST",
      `/api/collective/answers/${a_a1.body.answer.id}/accept-best`,
      { userId: MAYA, body: {} },
    );

    // Daniel = 5+5+2-2 = 10. Aisha = 5+2+15 = 22.
    expect(getReputationFor(DANIEL, CHAPTER_ID)?.score).toBe(10);
    expect(getReputationFor(AISHA, CHAPTER_ID)?.score).toBe(22);
    expect(getReputationFor(MAYA, CHAPTER_ID)?.score).toBe(2);
  });
});

describe("v18C Ask-an-Expert — flagging", () => {
  it("flag a question → status flagged + reason persisted", async () => {
    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const f = await call(
      "POST",
      `/api/collective/questions/${q.body.question.id}/flag`,
      { userId: AISHA, body: { reason: "Off-topic / spam" } },
    );
    expect(f.status).toBe(200);
    expect(f.body.question.status).toBe("flagged");
    expect(f.body.question.flagReason).toBe("Off-topic / spam");
  });

  it("flag an answer → status flagged + reason persisted", async () => {
    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const a = await call(
      "POST",
      `/api/collective/questions/${q.body.question.id}/answers`,
      { userId: DANIEL, body: { body: "answer" } },
    );
    const f = await call(
      "POST",
      `/api/collective/answers/${a.body.answer.id}/flag`,
      { userId: AISHA, body: { reason: "Inaccurate" } },
    );
    expect(f.status).toBe(200);
    expect(f.body.answer.status).toBe("flagged");
    expect(f.body.answer.flagReason).toBe("Inaccurate");
  });
});

describe("v18C Ask-an-Expert — view_count + hash chain", () => {
  it("view_count atomically increments per non-asker GET; skipped for the asker", async () => {
    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const qid = q.body.question.id;

    // Asker's own GET — no increment.
    const r0 = await call("GET", `/api/collective/questions/${qid}`, {
      userId: MAYA,
    });
    expect(r0.status).toBe(200);
    expect(r0.body.question.viewCount).toBe(0);

    // Three GETs by Daniel — view_count goes to 3.
    for (let i = 0; i < 3; i++) {
      await call("GET", `/api/collective/questions/${qid}`, { userId: DANIEL });
    }
    const r1 = await call("GET", `/api/collective/questions/${qid}`, {
      userId: AISHA,
    });
    expect(r1.body.question.viewCount).toBeGreaterThanOrEqual(4);
  });

  it("question hash chain extends on every transition (create → answer → close)", async () => {
    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const qid = q.body.question.id;
    const h0 = q.body.question.currHash;

    // First answer flips status to 'answered' AND extends the q chain.
    await call("POST", `/api/collective/questions/${qid}/answers`, {
      userId: DANIEL,
      body: { body: "answer" },
    });
    const q1 = getQuestionById(qid)!;
    expect(q1.prevHash).toBe(h0);
    expect(q1.currHash).not.toBe(h0);

    // Close further extends.
    await call("POST", `/api/collective/questions/${qid}/close`, {
      userId: MAYA,
      body: {},
    });
    const q2 = getQuestionById(qid)!;
    expect(q2.prevHash).toBe(q1.currHash);
    expect(q2.currHash).not.toBe(q1.currHash);
    expect(q2.status).toBe("closed");
  });

  it("answer hash chain extends on every vote (denormalized upvote_count tracks the chain)", async () => {
    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const a = await call(
      "POST",
      `/api/collective/questions/${q.body.question.id}/answers`,
      { userId: DANIEL, body: { body: "answer" } },
    );
    const aid = a.body.answer.id;
    const h0 = a.body.answer.currHash;

    await call("POST", `/api/collective/answers/${aid}/vote`, {
      userId: AISHA,
      body: { vote_type: "up" },
    });
    const a1 = getAnswerById(aid)!;
    expect(a1.prevHash).toBe(h0);
    expect(a1.currHash).not.toBe(h0);
    expect(a1.upvoteCount).toBe(1);
  });
});

describe("v18C Ask-an-Expert — chapter + tenant isolation", () => {
  it("a chap_nyc-only member cannot read chap_keiretsu_canada questions", async () => {
    const FOREIGNER = "u_foreign_nyc_member";
    registerTestPersona(FOREIGNER, "foreigner1@example.com", "Foreign NYC");
    ensureChapterMembership(FOREIGNER, FOREIGN_CHAPTER_ID, FOREIGN_TENANT_ID);
    // Make them an active Collective member so requireCollectiveMember passes.
    collectiveMembershipStore.activate(FOREIGNER, "u_admin_test");

    const q = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "Keiretsu Q", body: "B", tags: [] },
    });
    expect(q.status).toBe(201);

    const res = await call(
      "GET",
      `/api/collective/questions/${q.body.question.id}`,
      { userId: FOREIGNER },
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_chapter_member");
  });

  it("listing questions in chap_nyc returns no chap_keiretsu_canada rows (cross-chapter isolation)", async () => {
    const FOREIGNER = "u_foreign_nyc_member_2";
    registerTestPersona(FOREIGNER, "foreigner2@example.com", "Foreign NYC 2");
    ensureChapterMembership(FOREIGNER, FOREIGN_CHAPTER_ID, FOREIGN_TENANT_ID);
    collectiveMembershipStore.activate(FOREIGNER, "u_admin_test");

    await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "Keiretsu only", body: "B", tags: [] },
    });

    const res = await call(
      "GET",
      `/api/collective/questions?chapter_id=${FOREIGN_CHAPTER_ID}`,
      { userId: FOREIGNER },
    );
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([]);
  });

  it("posting into chap_nyc by a non-member 403s (cross-tenant rejection)", async () => {
    const res = await call("POST", "/api/collective/questions", {
      userId: MAYA, // Maya is keiretsu only
      body: { title: "Trying chap_nyc", body: "B", tags: [], chapter_id: FOREIGN_CHAPTER_ID },
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_chapter_member");
  });
});

describe("v18C Ask-an-Expert — reputation read endpoint", () => {
  it("GET /api/collective/reputation/:userId returns a zeroed row when no contributions yet", async () => {
    const res = await call("GET", `/api/collective/reputation/${DANIEL}`, {
      userId: AISHA,
    });
    expect(res.status).toBe(200);
    expect(res.body.reputation.score).toBe(0);
    expect(res.body.reputation.questionsAsked).toBe(0);
  });

  it("GET .../reputation returns the live row after activity", async () => {
    await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { title: "T", body: "B", tags: [] },
    });
    const res = await call("GET", `/api/collective/reputation/${MAYA}`, {
      userId: AISHA,
    });
    expect(res.status).toBe(200);
    expect(res.body.reputation.score).toBe(1);
    expect(res.body.reputation.questionsAsked).toBe(1);
  });
});

describe("v18C Ask-an-Expert — milestones helper", () => {
  it("milestonesCrossed returns the right thresholds and high-water mark", () => {
    expect(
      expertInternal.milestonesCrossed({
        oldScore: 0,
        newScore: 50,
        lastNotified: 0,
      }),
    ).toEqual({ toNotify: [50], newHighWater: 50 });

    expect(
      expertInternal.milestonesCrossed({
        oldScore: 49,
        newScore: 250,
        lastNotified: 0,
      }),
    ).toEqual({ toNotify: [50, 200], newHighWater: 200 });

    expect(
      expertInternal.milestonesCrossed({
        oldScore: 200,
        newScore: 250,
        lastNotified: 200,
      }),
    ).toEqual({ toNotify: [], newHighWater: 200 });

    expect(
      expertInternal.milestonesCrossed({
        oldScore: 0,
        newScore: 1000,
        lastNotified: 0,
      }),
    ).toEqual({ toNotify: [50, 200, 500], newHighWater: 500 });
  });

  it("computeHash is deterministic and depends on the prev_hash", () => {
    const h1 = expertInternal.computeHash(null, { a: 1 });
    const h2 = expertInternal.computeHash(null, { a: 1 });
    const h3 = expertInternal.computeHash("prev", { a: 1 });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});

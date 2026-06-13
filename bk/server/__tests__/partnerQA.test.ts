/**
 * CP Phase C — partnerQA.test.ts (CP-022/023/024/026/027)
 *
 * Verifies Partner team members can participate in Collective Q&A even
 * without chapter membership, and that their authored rows carry the
 * "partner" role decoration for the UI badge.
 *
 *   - Partner CAN POST /api/collective/questions
 *   - Partner CAN POST /api/collective/questions/:id/answers
 *   - The question DTO returned to readers includes `askerUserRole = "partner"`
 *     when the asker is a partner team member.
 *   - The answer DTO includes `responderUserRole = "partner"` when the
 *     responder is a partner team member.
 *   - Non-partner, non-chapter user gets 403 (gate is still real).
 *   - Partner reputation row is per-chapter (CP-027).
 *
 * Lifecycle mirrors expertQA.test.ts. The partner team is seeded by
 * seedTestPartnerSandbox(); chapter membership is granted to MAYA only,
 * so MAYA is the "chapter-only" asker. AVI_MANAGING is the partner.
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
  getReputationFor,
} from "../expertQAStore";
import {
  seedTestPartnerSandbox,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";

const CHAPTER_ID = "chap_keiretsu_canada";
const TENANT_ID = "tenant_chap_chap_keiretsu_canada";

const MAYA = "u_maya_chen";                         // chapter member, asker
const PARTNER = TEST_PARTNER_USERS.managing.userId; // u_avi_managing — partner team
const NON_MEMBER = "u_partnerqa_no_membership";     // neither

let app: Express;
let server: http.Server;
let port: number;

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

function nowIso(): string {
  return new Date().toISOString();
}

function ensureChapterMembership(
  userId: string,
  chapterId: string,
  tenantId: string,
  role: "member" | "admin" = "member",
): void {
  const db: any = getDb();
  const existing = db
    .select({ id: (chapterMembershipsTable as any).id })
    .from(chapterMembershipsTable)
    .where(
      and(
        eq((chapterMembershipsTable as any).userId, userId),
        eq((chapterMembershipsTable as any).chapterId, chapterId),
      ),
    )
    .all() as any[];
  if (existing.length > 0) return;
  db.insert(chapterMembershipsTable)
    .values({
      id: `chmem_partnerqa_${userId}_${chapterId}_${Math.random().toString(36).slice(2, 8)}`,
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

function clearExpertTables(): void {
  const db: any = getDb();
  db.delete(votesTable).run();
  db.delete(answersTable).run();
  db.delete(questionsTable).run();
  db.delete(reputationTable).run();
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  await hydrateMultiCompanyStore();
  seedTestPartnerSandbox({ force: true });

  collectiveMembershipStore.activate(MAYA, "u_admin_test");
  ensureChapterMembership(MAYA, CHAPTER_ID, TENANT_ID, "member");

  // NON_MEMBER persona only — no chapter membership, no partner team row.
  __setRuntimePersona({
    userId: NON_MEMBER,
    email: "no-membership@capavate.example",
    name: "No Membership",
    isFounder: false,
    isInvestor: true,
    isAdmin: false,
    hasInvitations: false,
  });

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

describe("CP-022/023/024 — partner Q&A participation", () => {
  it("partner team member CAN create a question without chapter membership", async () => {
    const r = await call("POST", "/api/collective/questions", {
      userId: PARTNER,
      body: {
        chapter_id: CHAPTER_ID,
        title: "How should a partner think about preferred return splits?",
        body: "Partner asking a chapter question — should be allowed.",
        tags: ["partner", "fundraising"],
      },
    });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.question.askerUserId).toBe(PARTNER);
  });

  it("partner team member CAN answer another user's question", async () => {
    // MAYA (chapter member) asks
    const qRes = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: {
        chapter_id: CHAPTER_ID,
        title: "What's the most efficient SAFE conversion mechanic?",
        body: "Looking for partner input.",
        tags: ["safe"],
      },
    });
    expect(qRes.status).toBe(201);
    const qid = qRes.body.question.id;

    // PARTNER answers
    const aRes = await call(
      "POST",
      `/api/collective/questions/${qid}/answers`,
      {
        userId: PARTNER,
        body: { body: "From a partner's POV, the cleanest structure is..." },
      },
    );
    expect(aRes.status).toBe(201);
    expect(aRes.body.answer.responderUserId).toBe(PARTNER);
  });

  it("a non-partner, non-chapter user is REJECTED (403)", async () => {
    const r = await call("POST", "/api/collective/questions", {
      userId: NON_MEMBER,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Should not be allowed",
        body: "non-member attempt",
        tags: [],
      },
    });
    // Could be 401/403 depending on which guard fires first; both are correct.
    expect([401, 403]).toContain(r.status);
  });
});

describe("CP-022/024 — partner badge decoration", () => {
  it("GET /api/collective/questions decorates askerUserRole='partner' for partner-authored question", async () => {
    const post = await call("POST", "/api/collective/questions", {
      userId: PARTNER,
      body: {
        chapter_id: CHAPTER_ID,
        title: "Partner question — decoration check",
        body: "asker is a partner",
        tags: [],
      },
    });
    expect(post.status).toBe(201);

    const list = await call("GET", `/api/collective/questions?chapter_id=${CHAPTER_ID}`, {
      userId: MAYA,
    });
    expect(list.status).toBe(200);
    const found = list.body.questions.find((q: any) => q.id === post.body.question.id);
    expect(found).toBeDefined();
    expect(found.askerUserRole).toBe("partner");
  });

  it("GET /api/collective/questions/:id decorates responderUserRole='partner' for partner-authored answers", async () => {
    // MAYA asks
    const qRes = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { chapter_id: CHAPTER_ID, title: "T", body: "B", tags: [] },
    });
    expect(qRes.status).toBe(201);
    const qid = qRes.body.question.id;

    // PARTNER answers
    const aRes = await call(
      "POST",
      `/api/collective/questions/${qid}/answers`,
      { userId: PARTNER, body: { body: "Partner answer" } },
    );
    expect(aRes.status).toBe(201);

    // MAYA reads detail
    const detail = await call("GET", `/api/collective/questions/${qid}`, {
      userId: MAYA,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.question.askerUserRole).toBe(null); // MAYA is not a partner
    expect(detail.body.answers.length).toBe(1);
    expect(detail.body.answers[0].responderUserRole).toBe("partner");
  });

  it("chapter-member-only asker gets askerUserRole=null", async () => {
    const post = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { chapter_id: CHAPTER_ID, title: "T2", body: "B2", tags: [] },
    });
    expect(post.status).toBe(201);
    const list = await call("GET", `/api/collective/questions?chapter_id=${CHAPTER_ID}`, {
      userId: MAYA,
    });
    const found = list.body.questions.find((q: any) => q.id === post.body.question.id);
    expect(found.askerUserRole).toBeNull();
  });
});

describe("CP-026/027 — partner reputation is per-chapter", () => {
  it("partner accrues reputation in the chapter where they answered, not globally", async () => {
    const qRes = await call("POST", "/api/collective/questions", {
      userId: MAYA,
      body: { chapter_id: CHAPTER_ID, title: "T", body: "B", tags: [] },
    });
    const qid = qRes.body.question.id;

    const aRes = await call(
      "POST",
      `/api/collective/questions/${qid}/answers`,
      { userId: PARTNER, body: { body: "Partner answer" } },
    );
    expect(aRes.status).toBe(201);

    const rep = getReputationFor(PARTNER, CHAPTER_ID);
    expect(rep).not.toBeNull();
    expect(rep!.answersGiven).toBe(1);
    expect(rep!.score).toBe(5); // +5 per answer
  });
});

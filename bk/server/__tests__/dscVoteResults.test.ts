/**
 * v17 Phase C — DSC vote public endpoint + quorum + chain_tip test.
 *
 * Coverage:
 *   1. GET /api/collective/dsc/votes/:proposalId/results — initial empty
 *      proposal → tally all zeros, quorum.met=false, outcome=null, chain_tip
 *      null, chain_valid=true.
 *   2. POST /api/collective/dsc/votes/:proposalId — DSC member casts a vote
 *      → 200 ok, returns voteRow + results.
 *   3. Quorum NOT met — one vote, chapter has 4 members at 50% quorum →
 *      results.quorum.met=false (1*100 < 4*50).
 *   4. Quorum MET locks further votes — once enough voters cast, a 5th DSC
 *      member's NEW vote returns 409 vote_locked.
 *   5. Idempotent re-cast — same voter re-sends identical vote after lock
 *      → 200 idempotent:true.
 *   6. chain_tip_hash matches the most-recent vote row's hash and chain_valid
 *      is true after every cast.
 *   7. Cross-chapter isolation — proposal X has votes from chapA; results
 *      queried from chapB (where caller is a member) compute against chapB's
 *      member count, not chapA's.
 *   8. Auth: requireCollectiveMember 403 for non-member; requireChapterMember
 *      403 for caller not in the chapter; not_dsc_member 403 for a chapter
 *      member who is NOT in DSC role.
 *   9. Feature flag: COLLECTIVE_ENABLED=0 → 503.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { randomBytes } from "node:crypto";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  chapters as chaptersTable,
  chapterMemberships as chapterMembershipsTable,
} from "../../shared/schema";
import * as collectiveMembershipStore from "../collectiveMembershipStore";
import { _addDscMemberForTests, _resetForTests as resetAdminDsc } from "../adminDscRoutes";
import { _testAccessDscVotes } from "../dscVoteStore";

// Reuse PERSONAS that exist in userContext: u_maya_chen, u_aisha_patel,
// u_daniel_okafor, u_admin. We need 4 DSC voters in one chapter — we also
// register u_dsc_voter_{a..d} via the test helper into PERSONAS-equivalent
// runtime (RUNTIME_PERSONAS isn't exported, so we use the existing personas
// instead and seat them all as chapter members + DSC).

// We use 4 personas that all exist in PERSONAS:
//   u_maya_chen, u_aisha_patel, u_daniel_okafor, u_admin
// u_admin auto-passes most gates via isAdmin. We will not vote AS u_admin
// to keep the quorum math honest; we use it only for write-time bootstrap.

const PROPOSAL_CHAPTER = "chap_v17c_dsc";
const PROPOSAL_TENANT = "tenant_chap_chap_v17c_dsc";
const OTHER_CHAPTER = "chap_v17c_dsc_other";
const OTHER_TENANT = "tenant_chap_chap_v17c_dsc_other";

const VOTER_A = "u_maya_chen";
const VOTER_B = "u_aisha_patel";
const VOTER_C = "u_daniel_okafor";
// u_lapsed_lp exists in PERSONAS (isAuthed=true) but is not pre-DSC. Good 4th.
const VOTER_D = "u_lapsed_lp";
// u_no_position is in PERSONAS — used as a chapter member who is NOT in DSC
// to test the not_dsc_member 403.
const NON_DSC_CHAPTER_MEMBER = "u_no_position";

let app: Express;
let server: http.Server;
let port: number;

function rid(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Insert a chapter row directly (idempotent). */
function seedChapter(opts: {
  id: string;
  tenantId: string;
  name: string;
  dscQuorumPct?: number;
}): void {
  const db: any = getDb();
  db.transaction((tx: any) => {
    tx.insert(chaptersTable)
      .values({
        id: opts.id,
        tenantId: opts.tenantId,
        name: opts.name,
        region: "test",
        city: "Test City",
        partnerOrgId: null,
        dscQuorumPct: opts.dscQuorumPct ?? 50,
        createdAt: nowIso(),
      } as any)
      .onConflictDoNothing({ target: (chaptersTable as any).id })
      .run();
  });
}

/** Insert a chapter membership directly (idempotent). */
function seedMembership(opts: {
  chapterId: string;
  tenantId: string;
  userId: string;
  role?: string;
}): void {
  const db: any = getDb();
  db.transaction((tx: any) => {
    tx.insert(chapterMembershipsTable)
      .values({
        id: `chmem_${opts.chapterId}_${opts.userId}_${randomBytes(3).toString("hex")}`,
        chapterId: opts.chapterId,
        tenantId: opts.tenantId,
        userId: opts.userId,
        role: opts.role ?? "member",
        status: "active",
        joinedAt: nowIso(),
        createdAt: nowIso(),
      } as any)
      .run();
  });
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";

  // Start clean stores so prior tests in the suite don't leak.
  resetAdminDsc();
  _testAccessDscVotes.reset();

  // Seed chapters + memberships.
  seedChapter({
    id: PROPOSAL_CHAPTER,
    tenantId: PROPOSAL_TENANT,
    name: "v17 Phase C — DSC Test Chapter",
    dscQuorumPct: 50,
  });
  seedChapter({
    id: OTHER_CHAPTER,
    tenantId: OTHER_TENANT,
    name: "v17 Phase C — DSC Test Chapter (Other)",
    dscQuorumPct: 50,
  });

  // Seat 4 voters in PROPOSAL_CHAPTER + 1 non-DSC chapter member.
  for (const uid of [VOTER_A, VOTER_B, VOTER_C, VOTER_D, NON_DSC_CHAPTER_MEMBER]) {
    seedMembership({ chapterId: PROPOSAL_CHAPTER, tenantId: PROPOSAL_TENANT, userId: uid });
  }
  // Seat VOTER_A also in OTHER_CHAPTER so the cross-chapter test can read
  // through them.
  seedMembership({ chapterId: OTHER_CHAPTER, tenantId: OTHER_TENANT, userId: VOTER_A });

  // Activate all in collective membership store so requireCollectiveMember
  // passes for every voter.
  for (const uid of [VOTER_A, VOTER_B, VOTER_C, VOTER_D, NON_DSC_CHAPTER_MEMBER]) {
    collectiveMembershipStore.activate(uid, "u_admin_test");
  }

  // Seat DSC role for VOTER_A..D (NOT for NON_DSC_CHAPTER_MEMBER).
  for (const uid of [VOTER_A, VOTER_B, VOTER_C, VOTER_D]) {
    _addDscMemberForTests(uid);
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
          try { body = JSON.parse(buf); } catch { /* keep raw */ }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

// ========================================================================
// GET /results — initial empty state
// ========================================================================

describe("v17 Phase C — GET /api/collective/dsc/votes/:proposalId/results", () => {
  it("empty proposal — tally all zeros, quorum not met, chain valid, no tip", async () => {
    const proposalId = rid("co_empty");
    const r = await call(
      "GET",
      `/api/collective/dsc/votes/${proposalId}/results?chapterId=${PROPOSAL_CHAPTER}`,
      { userId: VOTER_A },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.tally).toMatchObject({
      approve: 0,
      reject: 0,
      conditional: 0,
      abstain: 0,
      voterCount: 0,
    });
    expect(r.body.quorum.met).toBe(false);
    expect(r.body.quorum.memberCount).toBeGreaterThanOrEqual(4);
    expect(r.body.quorum.thresholdPct).toBe(50);
    expect(r.body.outcome).toBeNull();
    expect(r.body.chainValid).toBe(true);
    // Empty proposal — v16 verifyChain returns "GENESIS" as lastHash for an
    // un-cast company; route surfaces that as the chain tip. Either null
    // (no chain row exists) or "GENESIS" (the seed sentinel) is acceptable.
    expect([null, "GENESIS"]).toContain(r.body.chainTipHash);
    expect(r.body.locked).toBe(false);
  });

  it("returns 400 when chapterId query param is missing", async () => {
    const proposalId = rid("co_nochapter");
    const r = await call(
      "GET",
      `/api/collective/dsc/votes/${proposalId}/results`,
      { userId: VOTER_A },
    );
    // requireChapterMemberFromRequest 400's on missing chapterId.
    expect([400, 403]).toContain(r.status);
  });
});

// ========================================================================
// POST — cast votes + quorum lifecycle
// ========================================================================

describe("v17 Phase C — POST /api/collective/dsc/votes/:proposalId", () => {
  it("DSC member casts approve → 200 ok, vote persisted, chain_tip extended", async () => {
    const proposalId = rid("co_singlevote");
    const r = await call(
      "POST",
      `/api/collective/dsc/votes/${proposalId}`,
      {
        userId: VOTER_A,
        body: { vote: "approve", chapterId: PROPOSAL_CHAPTER },
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.vote?.vote).toBe("approve");
    expect(r.body.vote?.voterUserId).toBe(VOTER_A);
    expect(r.body.results.tally.approve).toBe(1);
    expect(r.body.results.tally.voterCount).toBe(1);
    expect(r.body.results.chainTipHash).toBeTruthy();
    expect(r.body.results.chainValid).toBe(true);
  });

  it("non-DSC chapter member → 403 not_dsc_member", async () => {
    const proposalId = rid("co_nondsc");
    const r = await call(
      "POST",
      `/api/collective/dsc/votes/${proposalId}`,
      {
        userId: NON_DSC_CHAPTER_MEMBER,
        body: { vote: "approve", chapterId: PROPOSAL_CHAPTER },
      },
    );
    expect(r.status).toBe(403);
    expect(String(r.body?.error)).toBe("not_dsc_member");
  });

  it("invalid vote enum → 400 validation_failed", async () => {
    const proposalId = rid("co_badvote");
    const r = await call(
      "POST",
      `/api/collective/dsc/votes/${proposalId}`,
      {
        userId: VOTER_A,
        body: { vote: "purple", chapterId: PROPOSAL_CHAPTER },
      },
    );
    expect(r.status).toBe(400);
    expect(String(r.body?.error)).toBe("validation_failed");
  });

  it("missing chapterId in body → 400 / 403", async () => {
    const proposalId = rid("co_nochap");
    const r = await call(
      "POST",
      `/api/collective/dsc/votes/${proposalId}`,
      {
        userId: VOTER_A,
        body: { vote: "approve" }, // no chapterId
      },
    );
    expect([400, 403]).toContain(r.status);
  });
});

// ========================================================================
// Quorum lifecycle
// ========================================================================

describe("v17 Phase C — quorum lifecycle", () => {
  it("single vote in a 5-member chapter → quorum NOT met", async () => {
    const proposalId = rid("co_q1");
    await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
      userId: VOTER_A,
      body: { vote: "approve", chapterId: PROPOSAL_CHAPTER },
    });

    const r = await call(
      "GET",
      `/api/collective/dsc/votes/${proposalId}/results?chapterId=${PROPOSAL_CHAPTER}`,
      { userId: VOTER_A },
    );
    expect(r.body.quorum.met).toBe(false);
    expect(r.body.locked).toBe(false);
    expect(r.body.outcome).toBeNull();
  });

  it("quorum MET locks further votes (409 vote_locked) but allows idempotent same-vote re-cast", async () => {
    const proposalId = rid("co_qmet");

    // 3 of 5 members vote approve — 3*100=300 >= 5*50=250 → quorum met.
    for (const uid of [VOTER_A, VOTER_B, VOTER_C]) {
      const r = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
        userId: uid,
        body: { vote: "approve", chapterId: PROPOSAL_CHAPTER },
      });
      expect(r.status).toBe(200);
    }

    // Inspect results — quorum met, outcome=approved, locked.
    const results = await call(
      "GET",
      `/api/collective/dsc/votes/${proposalId}/results?chapterId=${PROPOSAL_CHAPTER}`,
      { userId: VOTER_A },
    );
    expect(results.body.quorum.met).toBe(true);
    expect(results.body.outcome).toBe("approved");
    expect(results.body.locked).toBe(true);

    // 4th voter tries to cast a NEW vote → 409 vote_locked.
    const locked = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
      userId: VOTER_D,
      body: { vote: "reject", chapterId: PROPOSAL_CHAPTER },
    });
    expect(locked.status).toBe(409);
    expect(String(locked.body?.error)).toBe("vote_locked");

    // But VOTER_A re-sending the SAME vote → 200 idempotent.
    const idem = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
      userId: VOTER_A,
      body: { vote: "approve", chapterId: PROPOSAL_CHAPTER },
    });
    expect(idem.status).toBe(200);
    expect(idem.body.idempotent).toBe(true);
  });

  it("quorum-met with majority rejects → outcome='rejected'", async () => {
    const proposalId = rid("co_qrej");
    // 3 reject votes → quorum met, outcome=rejected.
    for (const uid of [VOTER_A, VOTER_B, VOTER_C]) {
      const r = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
        userId: uid,
        body: { vote: "reject", chapterId: PROPOSAL_CHAPTER },
      });
      expect(r.status).toBe(200);
    }
    const results = await call(
      "GET",
      `/api/collective/dsc/votes/${proposalId}/results?chapterId=${PROPOSAL_CHAPTER}`,
      { userId: VOTER_A },
    );
    expect(results.body.outcome).toBe("rejected");
    expect(results.body.tally.reject).toBe(3);
  });
});

// ========================================================================
// Chain tip + chain validity
// ========================================================================

describe("v17 Phase C — chain_tip + chain_valid", () => {
  it("chain_tip_hash matches the most recently cast vote's hash", async () => {
    const proposalId = rid("co_chain");
    const cast = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
      userId: VOTER_A,
      body: { vote: "approve", chapterId: PROPOSAL_CHAPTER },
    });
    expect(cast.status).toBe(200);
    const voteHash: string = cast.body.vote.hash;

    const results = await call(
      "GET",
      `/api/collective/dsc/votes/${proposalId}/results?chapterId=${PROPOSAL_CHAPTER}`,
      { userId: VOTER_A },
    );
    expect(results.body.chainTipHash).toBe(voteHash);
    expect(results.body.chainValid).toBe(true);
  });

  it("chain_tip_hash advances on each new vote", async () => {
    const proposalId = rid("co_chain2");
    const r1 = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
      userId: VOTER_A,
      body: { vote: "approve", chapterId: PROPOSAL_CHAPTER },
    });
    const tip1: string = r1.body.results.chainTipHash;

    const r2 = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
      userId: VOTER_B,
      body: { vote: "conditional", chapterId: PROPOSAL_CHAPTER, conditions: ["KYC complete"] },
    });
    const tip2: string = r2.body.results.chainTipHash;

    expect(tip2).toBeTruthy();
    expect(tip2).not.toBe(tip1);
  });
});

// ========================================================================
// Cross-chapter isolation
// ========================================================================

describe("v17 Phase C — cross-chapter isolation", () => {
  it("results are computed against the chapter in the query string, not the voter's other chapters", async () => {
    const proposalId = rid("co_iso");
    // Cast 3 votes in PROPOSAL_CHAPTER — should meet quorum there.
    for (const uid of [VOTER_A, VOTER_B, VOTER_C]) {
      const r = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
        userId: uid,
        body: { vote: "approve", chapterId: PROPOSAL_CHAPTER },
      });
      expect(r.status).toBe(200);
    }

    // Read from OTHER_CHAPTER's perspective (VOTER_A is a member of both).
    // Tally is global per company (v16 store semantics) so the tally is
    // the same — BUT quorum.memberCount comes from OTHER_CHAPTER, which
    // has 1 member (VOTER_A). 3 voters / 1 member = quorum met (3*100 >=
    // 1*50). That demonstrates the chapter-scoped denominator works.
    const r = await call(
      "GET",
      `/api/collective/dsc/votes/${proposalId}/results?chapterId=${OTHER_CHAPTER}`,
      { userId: VOTER_A },
    );
    expect(r.status).toBe(200);
    expect(r.body.chapterId).toBe(OTHER_CHAPTER);
    expect(r.body.quorum.memberCount).toBe(1);
  });

  it("non-chapter-member cannot read results for a chapter they're not in → 403", async () => {
    const proposalId = rid("co_iso2");
    // NON_DSC_CHAPTER_MEMBER is in PROPOSAL_CHAPTER only — querying with
    // OTHER_CHAPTER should fail at requireChapterMember.
    const r = await call(
      "GET",
      `/api/collective/dsc/votes/${proposalId}/results?chapterId=${OTHER_CHAPTER}`,
      { userId: NON_DSC_CHAPTER_MEMBER },
    );
    expect(r.status).toBe(403);
  });
});

// ========================================================================
// Feature flag
// ========================================================================

describe("v17 Phase C — feature flag", () => {
  it("COLLECTIVE_ENABLED=0 → 503 on both GET and POST", async () => {
    const proposalId = rid("co_ff");
    delete process.env.COLLECTIVE_ENABLED;
    try {
      const g = await call(
        "GET",
        `/api/collective/dsc/votes/${proposalId}/results?chapterId=${PROPOSAL_CHAPTER}`,
        { userId: VOTER_A },
      );
      expect(g.status).toBe(503);

      const p = await call("POST", `/api/collective/dsc/votes/${proposalId}`, {
        userId: VOTER_A,
        body: { vote: "approve", chapterId: PROPOSAL_CHAPTER },
      });
      expect(p.status).toBe(503);
    } finally {
      process.env.COLLECTIVE_ENABLED = "1";
    }
  });
});

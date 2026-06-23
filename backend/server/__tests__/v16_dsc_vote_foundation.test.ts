/**
 * v16 Addendum B — dscVoteStore foundation.
 *
 * Data layer ONLY. There is NO public POST /api/dsc/votes route in v16.
 * v17 will layer screening/scheduling/UI on top behind its own flag.
 *
 * Acceptance gates #14, #16, #17:
 *   - shared/schema.ts contains the `dscVotes` sqliteTable.
 *   - recordVote() persists via getDb().transaction((tx)=>{...}) — no `()`.
 *   - Hash chain: every row.prevHash === prior row.hash (per company).
 *   - tallyForCompany() correctly counts approve/reject/conditional/abstain
 *     and computes quorum vs collectiveMembershipStore.listActive().length.
 *   - Re-vote by the same user supersedes the prior row in the same tx.
 *   - verifyChain() returns valid for an unbroken chain.
 *   - Cross-tenant scoping: filtering by a different tenantId returns [].
 *   - Restart simulation: reset mirror + hydrateDscVoteStore() recovers all
 *     active votes and rebuilds the tally.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  recordVote,
  getVotesForCompany,
  tallyForCompany,
  verifyChain,
  hydrateDscVoteStore,
  _testAccessDscVotes,
} from "../dscVoteStore";
import * as collectiveMembershipStore from "../collectiveMembershipStore";

beforeAll(() => {
  // Seed 4 DSC members so quorum thresholds are non-trivial.
  for (const uid of ["u_dsc_a", "u_dsc_b", "u_dsc_c", "u_dsc_d"]) {
    collectiveMembershipStore.activate(uid, "u_admin");
  }
});

afterEach(() => {
  _testAccessDscVotes.reset();
});

describe("v16 Addendum B — dscVotes schema lives in shared/schema.ts", () => {
  it("schema file declares dscVotes table", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "shared", "schema.ts"),
      "utf8",
    );
    expect(src).toMatch(/dscVotes/);
  });
});

describe("v16 Addendum B — recordVote() + hash chain", () => {
  it("first vote per company starts the chain at prevHash=GENESIS", () => {
    const row = recordVote({
      companyId: "co_chain_test_1",
      voterUserId: "u_dsc_a",
      vote: "approve",
    });
    expect(row.prevHash).toBe("GENESIS");
    expect(row.hash).toBeTruthy();
    expect(row.hash.length).toBeGreaterThanOrEqual(16);
    expect(row.supersededAt).toBeNull();
  });

  it("subsequent votes chain via prevHash === prior.hash (same company)", () => {
    const a = recordVote({
      companyId: "co_chain_test_2",
      voterUserId: "u_dsc_a",
      vote: "approve",
    });
    const b = recordVote({
      companyId: "co_chain_test_2",
      voterUserId: "u_dsc_b",
      vote: "reject",
    });
    const c = recordVote({
      companyId: "co_chain_test_2",
      voterUserId: "u_dsc_c",
      vote: "conditional",
      conditions: ["needs_term_sheet_review"],
    });
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    expect(verifyChain("co_chain_test_2")).toEqual({ valid: true, lastHash: c.hash });
  });

  it("re-voting by the same user supersedes the prior row", () => {
    recordVote({ companyId: "co_super", voterUserId: "u_dsc_a", vote: "abstain" });
    recordVote({ companyId: "co_super", voterUserId: "u_dsc_a", vote: "approve" });
    const all = getVotesForCompany("co_super");
    expect(all.length).toBe(2);
    const active = getVotesForCompany("co_super", { activeOnly: true });
    expect(active.length).toBe(1);
    expect(active[0].voterUserId).toBe("u_dsc_a");
    expect(active[0].vote).toBe("approve");
    // Prior row is marked superseded.
    const prior = all.find((v) => v.vote === "abstain");
    expect(prior?.supersededAt).not.toBeNull();
  });

  it("rejects invalid vote enum values", () => {
    expect(() => recordVote({
      companyId: "co_x",
      voterUserId: "u_dsc_a",
      vote: "yes" as any,
    })).toThrow();
  });

  it("rejects missing companyId / voterUserId", () => {
    expect(() => recordVote({ companyId: "", voterUserId: "u_dsc_a", vote: "approve" })).toThrow();
    expect(() => recordVote({ companyId: "co_x", voterUserId: "", vote: "approve" })).toThrow();
  });
});

describe("v16 Addendum B — tallyForCompany() + quorum", () => {
  it("counts active votes by enum and reports voterCount", () => {
    recordVote({ companyId: "co_tally", voterUserId: "u_dsc_a", vote: "approve" });
    recordVote({ companyId: "co_tally", voterUserId: "u_dsc_b", vote: "approve" });
    recordVote({ companyId: "co_tally", voterUserId: "u_dsc_c", vote: "reject" });
    const t = tallyForCompany("co_tally");
    expect(t.approve).toBe(2);
    expect(t.reject).toBe(1);
    expect(t.conditional).toBe(0);
    expect(t.abstain).toBe(0);
    expect(t.voterCount).toBe(3);
    expect(t.dscMemberCount).toBeGreaterThanOrEqual(4);
  });

  it("quorum requires ≥50% of active DSC members", () => {
    // Only 1 voter out of ≥4 members → no quorum.
    recordVote({ companyId: "co_quorum_no", voterUserId: "u_dsc_a", vote: "approve" });
    expect(tallyForCompany("co_quorum_no").quorumReached).toBe(false);

    // ≥2 distinct voters with ≥4 active members → 50% reached.
    recordVote({ companyId: "co_quorum_yes", voterUserId: "u_dsc_a", vote: "approve" });
    recordVote({ companyId: "co_quorum_yes", voterUserId: "u_dsc_b", vote: "approve" });
    expect(tallyForCompany("co_quorum_yes").quorumReached).toBe(true);
  });

  it("re-vote does not double-count toward voterCount", () => {
    recordVote({ companyId: "co_revote_count", voterUserId: "u_dsc_a", vote: "approve" });
    recordVote({ companyId: "co_revote_count", voterUserId: "u_dsc_a", vote: "reject" });
    const t = tallyForCompany("co_revote_count");
    expect(t.voterCount).toBe(1);
    expect(t.approve).toBe(0);
    expect(t.reject).toBe(1);
  });
});

describe("v16 Addendum B — getVotesForCompany() cross-tenant scoping", () => {
  it("returns [] for a tenant that owns no votes for the company", () => {
    recordVote({ companyId: "co_tenant_iso", voterUserId: "u_dsc_a", vote: "approve" });
    const wrong = getVotesForCompany("co_tenant_iso", { tenantId: "tenant_co_someone_else" });
    expect(wrong).toEqual([]);
  });
});

describe("v16 Addendum B — hydrateDscVoteStore() restart simulation", () => {
  it("recovers all votes from DB after mirror reset", async () => {
    recordVote({ companyId: "co_hydrate", voterUserId: "u_dsc_a", vote: "approve" });
    recordVote({ companyId: "co_hydrate", voterUserId: "u_dsc_b", vote: "approve" });
    recordVote({ companyId: "co_hydrate", voterUserId: "u_dsc_c", vote: "reject" });
    // Snapshot tally + chain.
    const beforeTally = tallyForCompany("co_hydrate");
    const beforeChain = verifyChain("co_hydrate");
    expect(beforeChain.valid).toBe(true);

    // Simulate process restart: clear mirror and re-hydrate from DB.
    _testAccessDscVotes.reset();
    await hydrateDscVoteStore();

    const afterTally = tallyForCompany("co_hydrate");
    const afterChain = verifyChain("co_hydrate");
    expect(afterTally.approve).toBe(beforeTally.approve);
    expect(afterTally.reject).toBe(beforeTally.reject);
    expect(afterTally.voterCount).toBe(beforeTally.voterCount);
    expect(afterChain.valid).toBe(true);
  });
});

describe("v16 Addendum B — NO public route registered", () => {
  it("there is no /api/dsc/votes POST route in the codebase", () => {
    // Search all server route files for an explicit registration.
    const serverDir = path.resolve(__dirname, "..");
    const files = fs.readdirSync(serverDir).filter((f) => f.endsWith(".ts"));
    let found = false;
    for (const f of files) {
      const content = fs.readFileSync(path.join(serverDir, f), "utf8");
      // Look for app.post or router.post wiring the votes endpoint.
      if (/(app|router)\.post\(\s*["'`]\/api\/dsc\/votes/.test(content)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(false);
  });
});

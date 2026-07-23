/**
 * W-MFCRM — money-path integrity (store-level, deterministic).
 *
 * Two guarantees under test:
 *  1. softCircleGraduate routes the money event through the SACRED single
 *     `commitFunded` ledger — there is NO parallel money path. We assert a
 *     ledger entry is appended and the hash-chain still verifies.
 *  2. createSpvOnBehalf is TRANSACTIONAL (§3.3): on success the SPV row is
 *     durable AND a collective-push row is queued (atomic sync tx); on a
 *     GATE-3 denial NOTHING is written (no orphan SPV, no orphan push).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore } from "../managedFounderStore";
import { clearLedger, getLedger, verifyChain } from "../captableCommitStore";

const ACTOR = "u_test_actor";
const future = () => new Date(Date.now() + 86400000).toISOString();

function classify(pid: string, extra: Record<string, boolean> = {}) {
  managedFounderStore.setCapabilityProfile(pid, {
    classified: true, sourcesCapital: true, delegatedAgency: true, spvWriteAuthority: true,
    collectiveFronting: true, ...extra,
  }, ACTOR);
}

beforeAll(() => applyMfcrmSchema());

describe("MONEY PATH 1 — soft-circle graduation flows through the sacred commitFunded ledger", () => {
  beforeEach(() => clearLedger());

  it("appends exactly ONE ledger entry and the chain verifies", () => {
    const pid = "p_money_grad";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_grad" }, ACTOR);
    const out = managedFounderStore.softCircleGraduate(pid, {
      companyId: "co_grad", engagementId: e.id,
      invitationId: "inv_grad", roundId: "rnd_grad", investorId: "u_inv_grad",
      amount: "250000", shares: "12500", currency: "USD",
    }, ACTOR);
    expect(out.ok).toBe(true);
    // The ONLY money entry point — one sacred ledger row, chain intact.
    const ledger = getLedger();
    expect(ledger.length).toBe(1);
    expect(ledger[0].invitationId).toBe("inv_grad");
    expect(ledger[0].amount).toBe("250000");
    expect(ledger[0].shares).toBe("12500");
    expect(verifyChain().ok).toBe(true);
  });

  it("a ledger rejection surfaces {ok:false} and writes NO ledger entry (fail-closed)", () => {
    const pid = "p_money_grad_bad";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_grad_bad" }, ACTOR);
    const out = managedFounderStore.softCircleGraduate(pid, {
      companyId: "co_grad_bad", engagementId: e.id,
      invitationId: "inv_bad", roundId: "rnd_bad", investorId: "u_inv_bad",
      amount: "not-a-number", shares: "12500",
    }, ACTOR);
    expect(out.ok).toBe(false);
    expect(getLedger().length).toBe(0);
  });
});

describe("MONEY PATH 2 — SPV-on-behalf is transactional (durable SPV + queued push, no orphan)", () => {
  it("POSITIVE: a durable SPV row AND a queued collective-push are written together", () => {
    const pid = "p_money_spv";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, {
      companyId: "co_spv", mode: "A", authorityArtifactRef: "art://spv", authorityExpiresAt: future(),
    }, ACTOR);
    const out = managedFounderStore.createSpvOnBehalf(pid, {
      companyId: "co_spv", engagementId: e.id, name: "SPV Money", jurisdiction: "delaware", carryBasis: "per_deployment",
    }, ACTOR);
    expect(out.spvId).toBeTruthy();
    expect(out.onBehalfId).toBeTruthy();
    expect(out.pushId).toBeTruthy();

    const rows = managedFounderStore.listSpvOnBehalf(pid, "co_spv");
    expect(rows.length).toBe(1);
    expect(rows[0].spv_id).toBe(out.spvId);
    expect(rows[0].curr_hash).toBeTruthy(); // hash-chain tip present

    const pushes = managedFounderStore.listCollectivePush(pid).filter((p: any) => p.id === out.pushId);
    expect(pushes.length).toBe(1);
    expect(pushes[0].status).toBe("queued"); // async push runs OUTSIDE the tx
  });

  it("NEGATIVE: a GATE-3 denial (Mode B) writes NO on-behalf row and NO push (no orphan)", () => {
    const pid = "p_money_spv_denied";
    classify(pid); // all global toggles ON — still denied without per-engagement Mode A
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_spv_denied" }, ACTOR); // Mode B
    const beforePushes = managedFounderStore.listCollectivePush(pid).length;
    expect(() => managedFounderStore.createSpvOnBehalf(pid, {
      companyId: "co_spv_denied", engagementId: e.id, name: "SPV Denied", jurisdiction: "delaware", carryBasis: "per_deployment",
    }, ACTOR)).toThrowError(/ENGAGEMENT_MODE_NOT_A/);
    expect(managedFounderStore.listSpvOnBehalf(pid, "co_spv_denied").length).toBe(0);
    expect(managedFounderStore.listCollectivePush(pid).length).toBe(beforePushes);
  });

  it("the hash-chain links successive on-behalf rows (prev_hash → curr_hash)", () => {
    const pid = "p_money_spv_chain";
    classify(pid);
    const e1 = managedFounderStore.createEngagement(pid, { companyId: "co_chain1", mode: "A", authorityArtifactRef: "art://c1", authorityExpiresAt: future() }, ACTOR);
    const e2 = managedFounderStore.createEngagement(pid, { companyId: "co_chain2", mode: "A", authorityArtifactRef: "art://c2", authorityExpiresAt: future() }, ACTOR);
    managedFounderStore.createSpvOnBehalf(pid, { companyId: "co_chain1", engagementId: e1.id, name: "SPV C1", jurisdiction: "delaware", carryBasis: "per_deployment" }, ACTOR);
    managedFounderStore.createSpvOnBehalf(pid, { companyId: "co_chain2", engagementId: e2.id, name: "SPV C2", jurisdiction: "delaware", carryBasis: "per_deployment" }, ACTOR);
    const rows = managedFounderStore.listSpvOnBehalf(pid); // newest-first
    expect(rows.length).toBe(2);
    // The newest row's prev_hash is the older row's curr_hash (single per-partner chain).
    expect(rows[0].prev_hash).toBe(rows[1].curr_hash);
    expect(rows[1].prev_hash).toBe("GENESIS");
  });
});

/**
 * Sprint 16 — Track C: All 6 new hash chains register & verify clean.
 * Sprint 14 had 5 chains (dscFeedback, introRequests, milestoneBroadcast, payment, transactionPrep).
 * Sprint 16 adds 6: co_investor_group, soft_circle_peer, endorsements,
 *                   cross_cohort_dm, round_qa, diligence_volunteers.
 * Total = 11.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { listChains, getChain } from "../../lib/hashChain";
import {
  __resetCommsTiers,
  coInvestorGroupChain,
  softCirclePeerChain,
  endorsementChain,
  crossCohortDmChain,
  roundQaChain,
  diligenceVolunteerChain,
  createCoInvestorGroup,
  postCoInvestorGroupMessage,
  setSoftCirclePeerOptIn,
  setIoiPulse,
  createEndorsement,
  postQaQuestion,
  createDiligenceVolunteer,
  startCrossCohortDm,
} from "../../commsTiersStore";

describe("Sprint 16 — 6 new hash chains", () => {
  beforeEach(() => __resetCommsTiers());

  it("registers all 6 chains in the global registry", () => {
    const names = listChains();
    expect(names).toContain("co_investor_group");
    expect(names).toContain("soft_circle_peer");
    expect(names).toContain("endorsements");
    expect(names).toContain("cross_cohort_dm");
    expect(names).toContain("round_qa");
    expect(names).toContain("diligence_volunteers");
  });

  it("all 6 chains verify clean after activity", () => {
    const grp = createCoInvestorGroup({ companyId: "c1", participants: ["u_a", "u_b"], actorId: "u_a" });
    postCoInvestorGroupMessage({ groupId: grp.id, authorUserId: "u_a", body: "hi" });
    setSoftCirclePeerOptIn({ roundId: "r1", userId: "u_sc", optedIn: true, crossCohortDmOptedIn: true });
    setIoiPulse({ roundId: "r1", userId: "u_sc", pulse: "leaning_yes" });
    createEndorsement({ roundId: "r1", companyId: "c1", endorserUserId: "u_a", chip: "team_quality", text: "ok", disclaimerAck: true });
    startCrossCohortDm({ roundId: "r1", fromUserId: "u_a", toUserId: "u_sc", body: "hi" });
    postQaQuestion({ roundId: "r1", askerUserId: "u_a", body: "?" });
    createDiligenceVolunteer({ roundId: "r1", volunteerUserId: "u_v", softCirclerUserId: "u_sc" });

    for (const name of [
      "co_investor_group", "soft_circle_peer", "endorsements",
      "cross_cohort_dm", "round_qa", "diligence_volunteers",
    ]) {
      const c = getChain(name);
      expect(c, `chain ${name} not found`).toBeTruthy();
      const v = c!.verify();
      expect(v.ok, `chain ${name} broken`).toBe(true);
    }
  });

  it("each chain head changes after appending an entry", () => {
    const before = {
      cig: coInvestorGroupChain.head,
      scp: softCirclePeerChain.head,
      end: endorsementChain.head,
      xdm: crossCohortDmChain.head,
      qa: roundQaChain.head,
      dv: diligenceVolunteerChain.head,
    };
    const grp = createCoInvestorGroup({ companyId: "c1", participants: ["u_a", "u_b"], actorId: "u_a" });
    postCoInvestorGroupMessage({ groupId: grp.id, authorUserId: "u_a", body: "x" });
    setSoftCirclePeerOptIn({ roundId: "r1", userId: "u_sc", optedIn: true, crossCohortDmOptedIn: true });
    createEndorsement({ roundId: "r1", companyId: "c1", endorserUserId: "u_a", chip: "team_quality", text: "ok", disclaimerAck: true });
    startCrossCohortDm({ roundId: "r1", fromUserId: "u_a", toUserId: "u_sc", body: "hi" });
    postQaQuestion({ roundId: "r1", askerUserId: "u_a", body: "?" });
    createDiligenceVolunteer({ roundId: "r1", volunteerUserId: "u_v", softCirclerUserId: "u_sc" });

    expect(coInvestorGroupChain.head).not.toEqual(before.cig);
    expect(softCirclePeerChain.head).not.toEqual(before.scp);
    expect(endorsementChain.head).not.toEqual(before.end);
    expect(crossCohortDmChain.head).not.toEqual(before.xdm);
    expect(roundQaChain.head).not.toEqual(before.qa);
    expect(diligenceVolunteerChain.head).not.toEqual(before.dv);
  });
});

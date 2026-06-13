/**
 * Sprint 16 — Track C Tier 3: Endorsements + cross-cohort DM + Q&A + diligence.
 * Validates abuse guards, hard caps, privacy, founder-only mutations.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetCommsTiers,
  __getTelemetry,
  createEndorsement,
  removeEndorsement,
  ENDORSEMENT_CHIPS,
  ENDORSEMENT_DISCLAIMER,
  startCrossCohortDm,
  muteCrossCohort,
  setSoftCirclePeerOptIn,
  postQaQuestion,
  postQaAnswer,
  archiveQaThread,
  createDiligenceVolunteer,
  requestDiligenceSlot,
  getCommunitySignalsForFounder,
  isHighValueAdvocate,
  CROSS_COHORT_DM_HARD_CAP,
} from "../../commsTiersStore";

describe("Sprint 16 C3 — Endorsements", () => {
  beforeEach(() => __resetCommsTiers());

  it("exports exactly 5 fixed chips", () => {
    expect(ENDORSEMENT_CHIPS).toHaveLength(5);
    expect(ENDORSEMENT_CHIPS).toEqual([
      "founder_execution", "market_traction", "team_quality",
      "product_strength", "existing_portfolio_fit",
    ]);
  });

  it("exports the mandatory disclaimer string", () => {
    expect(ENDORSEMENT_DISCLAIMER).toMatch(/personal opinion/i);
    expect(ENDORSEMENT_DISCLAIMER).toMatch(/Capavate does not verify/);
  });

  it("rejects when disclaimer not acked", () => {
    const r = createEndorsement({ roundId: "r1", companyId: "c1", endorserUserId: "u_a", chip: "founder_execution", text: "great", disclaimerAck: false });
    expect("error" in r && r.error).toBe("disclaimer_required");
  });

  it("rejects when text > 300 chars", () => {
    const r = createEndorsement({ roundId: "r1", companyId: "c1", endorserUserId: "u_a", chip: "team_quality", text: "x".repeat(301), disclaimerAck: true });
    expect("error" in r && r.error).toBe("text_too_long");
  });

  it("rejects when chip is not in the fixed set", () => {
    const r = createEndorsement({ roundId: "r1", companyId: "c1", endorserUserId: "u_a", chip: "made_up_chip" as any, text: "x", disclaimerAck: true });
    expect("error" in r && r.error).toBe("invalid_chip");
  });

  it("creates and marks endorser as high-value advocate", () => {
    const r = createEndorsement({ roundId: "r1", companyId: "c1", endorserUserId: "u_a", chip: "market_traction", text: "ok", disclaimerAck: true });
    expect("id" in r).toBe(true);
    expect(isHighValueAdvocate("u_a")).toBe(true);
  });

  it("founder can remove an endorsement", () => {
    const e = createEndorsement({ roundId: "r1", companyId: "c1", endorserUserId: "u_a", chip: "team_quality", text: "ok", disclaimerAck: true }) as { id: string };
    const out = removeEndorsement({ id: e.id, founderUserId: "u_founder" });
    expect(out.ok).toBe(true);
    // Idempotency: removing again returns already_removed
    const out2 = removeEndorsement({ id: e.id, founderUserId: "u_founder" });
    expect(out2.ok).toBe(false);
    expect(out2.reason).toBe("already_removed");
  });
});

describe("Sprint 16 C3 — Cross-cohort DM hard cap + privacy", () => {
  beforeEach(() => __resetCommsTiers());

  it("blocks DM when soft-circler has not opted in (default opt-OUT)", () => {
    setSoftCirclePeerOptIn({ roundId: "r1", userId: "u_sc", optedIn: true /* peer share, not DM */ });
    const r = startCrossCohortDm({ roundId: "r1", fromUserId: "u_ct", toUserId: "u_sc", body: "hi" });
    expect("error" in r && r.error).toBe("soft_circler_opted_out");
  });

  it("respects the COMBINED hard cap of 3 across all senders", () => {
    setSoftCirclePeerOptIn({ roundId: "r1", userId: "u_sc", optedIn: true, crossCohortDmOptedIn: true });
    expect(CROSS_COHORT_DM_HARD_CAP).toBe(3);
    const r1 = startCrossCohortDm({ roundId: "r1", fromUserId: "u_ct1", toUserId: "u_sc", body: "1" });
    const r2 = startCrossCohortDm({ roundId: "r1", fromUserId: "u_ct2", toUserId: "u_sc", body: "2" });
    const r3 = startCrossCohortDm({ roundId: "r1", fromUserId: "u_ct3", toUserId: "u_sc", body: "3" });
    const r4 = startCrossCohortDm({ roundId: "r1", fromUserId: "u_ct4", toUserId: "u_sc", body: "4" });
    expect("id" in r1 && "id" in r2 && "id" in r3).toBe(true);
    expect("error" in r4 && r4.error).toBe("rate_limit_combined_cap_reached");
    expect(__getTelemetry().some(e => e.kind === "cross_cohort.dm.rate_limit_hit")).toBe(true);
  });

  it("respects mute by recipient", () => {
    setSoftCirclePeerOptIn({ roundId: "r1", userId: "u_sc", optedIn: true, crossCohortDmOptedIn: true });
    muteCrossCohort({ roundId: "r1", muterId: "u_sc", mutedId: "u_ct" });
    const r = startCrossCohortDm({ roundId: "r1", fromUserId: "u_ct", toUserId: "u_sc", body: "hi" });
    expect("error" in r && r.error).toBe("muted_by_recipient");
  });
});

describe("Sprint 16 C3 — Round Q&A", () => {
  beforeEach(() => __resetCommsTiers());

  it("posts question and answer; appends to chain", () => {
    const q = postQaQuestion({ roundId: "r1", askerUserId: "u_a", body: "What's the runway?" });
    expect(q.status).toBe("open");
    const a = postQaAnswer({ questionId: q.id, authorUserId: "u_founder", body: "18 months" });
    expect("id" in a).toBe(true);
  });

  it("founder can archive and further answers are blocked", () => {
    const q = postQaQuestion({ roundId: "r1", askerUserId: "u_a", body: "test" });
    const out = archiveQaThread({ questionId: q.id, founderUserId: "u_founder" });
    expect(out.ok).toBe(true);
    const a = postQaAnswer({ questionId: q.id, authorUserId: "u_founder", body: "late" });
    expect("error" in a && a.error).toBe("question_archived");
    expect(__getTelemetry().some(e => e.kind === "round.qa.archived")).toBe(true);
  });
});

describe("Sprint 16 C3 — Diligence volunteer", () => {
  beforeEach(() => __resetCommsTiers());

  it("creates volunteer offer and slot request", () => {
    const v = createDiligenceVolunteer({ roundId: "r1", volunteerUserId: "u_v", softCirclerUserId: "u_sc" });
    expect(v.status).toBe("created");
    const out = requestDiligenceSlot({ id: v.id });
    expect(out.ok).toBe(true);
    expect(__getTelemetry().some(e => e.kind === "diligence.slot.requested")).toBe(true);
  });
});

describe("Sprint 16 C3 — Founder community-signals (aggregate-only privacy)", () => {
  beforeEach(() => __resetCommsTiers());

  it("returns ONLY counts (no per-investor content) and audit-logs the view", () => {
    setSoftCirclePeerOptIn({ roundId: "r1", userId: "u_sc", optedIn: true, crossCohortDmOptedIn: true });
    createEndorsement({ roundId: "r1", companyId: "c1", endorserUserId: "u_a", chip: "team_quality", text: "good", disclaimerAck: true });
    postQaQuestion({ roundId: "r1", askerUserId: "u_b", body: "?" });

    const sig = getCommunitySignalsForFounder({ roundId: "r1", founderUserId: "u_founder", companyId: "c1" });
    expect(sig.endorsementCount).toBe(1);
    expect(sig.qaQuestionCount).toBe(1);
    expect(sig.privacy).toBe("aggregate_only_no_per_investor_content");
    expect(sig.auditLogged).toBe(true);
    // The result MUST NOT contain an array of endorser identities, message bodies, etc.
    expect(JSON.stringify(sig)).not.toMatch(/u_a\b/);
    expect(__getTelemetry().some(e => e.kind === "founder.community_signals.viewed")).toBe(true);
  });
});

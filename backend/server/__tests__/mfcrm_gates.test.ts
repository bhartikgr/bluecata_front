/**
 * W-MFCRM — the SIX capability gates (§5.1), one POSITIVE + one NEGATIVE each,
 * plus the D-9 case: an ACTIVE Mode-B engagement with ALL global capability
 * toggles ON is STILL denied createSpvOnBehalf until the engagement is Mode A
 * with a valid non-expired authority artifact. Store-level (deterministic).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore, GateError } from "../managedFounderStore";

const ACTOR = "u_test_actor";
const future = () => new Date(Date.now() + 86400000).toISOString();
const past = () => new Date(Date.now() - 86400000).toISOString();

/** A fully-capable, classified profile for `pid`. */
function classify(pid: string, extra: Record<string, boolean> = {}) {
  managedFounderStore.setCapabilityProfile(pid, {
    classified: true, sourcesCapital: true, delegatedAgency: true, spvWriteAuthority: true,
    collectiveFronting: true, ...extra,
  }, ACTOR);
}

beforeAll(() => applyMfcrmSchema());

describe("GATE 1 — engagement create requires a classified profile", () => {
  it("NEGATIVE: unclassified partner is denied", () => {
    const pid = "p_gate1_unclassified";
    expect(() => managedFounderStore.createEngagement(pid, { companyId: "co_g1" }, ACTOR))
      .toThrowError(/CAPABILITY_UNCLASSIFIED/);
  });
  it("POSITIVE: classified partner may create (Mode B)", () => {
    const pid = "p_gate1_classified";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_g1b" }, ACTOR);
    expect(e.status).toBe("ACTIVE");
    expect(e.mode).toBe("B");
  });
});

describe("GATE 6 — Mode-A entry requires delegated_agency + valid artifact", () => {
  it("NEGATIVE: Mode A without an artifact is denied", () => {
    const pid = "p_gate6_noartifact";
    classify(pid);
    expect(() => managedFounderStore.createEngagement(pid, { companyId: "co_g6", mode: "A" }, ACTOR))
      .toThrowError(/AUTHORITY_ARTIFACT_REQUIRED/);
  });
  it("NEGATIVE: Mode A without delegated_agency is denied", () => {
    const pid = "p_gate6_nodeleg";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, delegatedAgency: false }, ACTOR);
    expect(() => managedFounderStore.createEngagement(pid, { companyId: "co_g6b", mode: "A", authorityArtifactRef: "art://x", authorityExpiresAt: future() }, ACTOR))
      .toThrowError(/DELEGATED_AGENCY_REQUIRED/);
  });
  it("POSITIVE: Mode A with delegated_agency + valid artifact is allowed", () => {
    const pid = "p_gate6_ok";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_g6c", mode: "A", authorityArtifactRef: "art://ok", authorityExpiresAt: future() }, ACTOR);
    expect(e.mode).toBe("A");
    expect(e.trialExpiresAt).toBeTruthy(); // 90d Mode-A trial
  });
});

describe("GATE 2 — attribution stamp: sources_capital selects first-touch vs firm-of-record", () => {
  it("POSITIVE: sources_capital=true stamps investor first-touch (+ tail)", () => {
    const pid = "p_gate2_capital";
    classify(pid);
    const out = managedFounderStore.stampAttribution(pid, { companyId: "co_g2" }, ACTOR);
    expect(out.attributionType).toBe("first_touch");
    const { tail } = managedFounderStore.readAttribution(pid, "co_g2");
    expect(tail.length).toBe(1);
  });
  it("NEGATIVE: sources_capital=false can NEVER stamp first-touch (firm-of-record only)", () => {
    const pid = "p_gate2_service";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: false }, ACTOR);
    expect(() => managedFounderStore.assertSourcesCapital(pid)).toThrowError(/SOURCES_CAPITAL_REQUIRED/);
    const out = managedFounderStore.stampAttribution(pid, { companyId: "co_g2b" }, ACTOR);
    expect(out.attributionType).toBe("firm_of_record");
  });
});

describe("GATE 3 / D-9 — delegated-write-on-behalf binds ACTIVE + Mode-A + artifact", () => {
  it("D-9 NEGATIVE: ACTIVE Mode-B + ALL global toggles ON is STILL denied SPV-on-behalf", () => {
    const pid = "p_gate3_d9";
    classify(pid); // sources/delegated/spvWrite/collective all TRUE
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_d9" }, ACTOR); // Mode B
    expect(e.mode).toBe("B");
    expect(() => managedFounderStore.createSpvOnBehalf(pid, { companyId: "co_d9", engagementId: e.id, name: "SPV D9", jurisdiction: "delaware", carryBasis: "per_deployment" }, ACTOR))
      .toThrowError(/ENGAGEMENT_MODE_NOT_A/);
  });
  it("D-9 POSITIVE: after switching to Mode A with a valid artifact, SPV-on-behalf is allowed", () => {
    const pid = "p_gate3_d9ok";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_d9ok" }, ACTOR);
    managedFounderStore.setMode(pid, e.id, "A", { authorityArtifactRef: "art://d9", authorityExpiresAt: future() }, ACTOR);
    const out = managedFounderStore.createSpvOnBehalf(pid, { companyId: "co_d9ok", engagementId: e.id, name: "SPV D9 OK", jurisdiction: "delaware", carryBasis: "per_deployment" }, ACTOR);
    expect(out.spvId).toBeTruthy();
    expect(out.pushId).toBeTruthy(); // collective push queued
  });
  it("NEGATIVE: an expired artifact is denied even in Mode A", () => {
    const pid = "p_gate3_expired";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_exp", mode: "A", authorityArtifactRef: "art://exp", authorityExpiresAt: past() }, ACTOR);
    expect(() => managedFounderStore.createSpvOnBehalf(pid, { companyId: "co_exp", engagementId: e.id, name: "SPV EXP", jurisdiction: "delaware", carryBasis: "per_deployment" }, ACTOR))
      .toThrowError(/AUTHORITY_ARTIFACT_EXPIRED/);
  });
  it("NEGATIVE: spv_write_authority=false is denied", () => {
    const pid = "p_gate3_nospv";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, delegatedAgency: true, spvWriteAuthority: false }, ACTOR);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_nospv", mode: "A", authorityArtifactRef: "art://n", authorityExpiresAt: future() }, ACTOR);
    expect(() => managedFounderStore.createSpvOnBehalf(pid, { companyId: "co_nospv", engagementId: e.id, name: "SPV N", jurisdiction: "delaware", carryBasis: "per_deployment" }, ACTOR))
      .toThrowError(/SPV_WRITE_AUTHORITY_REQUIRED/);
  });
});

describe("GATE 4 — collective push requires collective_fronting AND ACTIVE", () => {
  it("POSITIVE: collective_fronting + ACTIVE passes", () => {
    const pid = "p_gate4_ok";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_g4" }, ACTOR);
    expect(() => managedFounderStore.assertCollectivePush(pid, e)).not.toThrow();
  });
  it("NEGATIVE: collective_fronting=false is denied", () => {
    const pid = "p_gate4_no";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, collectiveFronting: false }, ACTOR);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_g4b" }, ACTOR);
    expect(() => managedFounderStore.assertCollectivePush(pid, e)).toThrowError(/COLLECTIVE_FRONTING_REQUIRED/);
  });
});

describe("GATE 5 — graduation requires ACTIVE AND (sources_capital OR delegated_agency)", () => {
  it("POSITIVE: ACTIVE + capital passes the gate assertion", () => {
    const pid = "p_gate5_ok";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_g5" }, ACTOR);
    expect(() => managedFounderStore.assertGraduation(pid, e)).not.toThrow();
  });
  it("NEGATIVE: a LAPSED engagement is denied", () => {
    const pid = "p_gate5_lapsed";
    classify(pid);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_g5b", mode: "A", authorityArtifactRef: "art://l", authorityExpiresAt: future(), trialDays: 90 }, ACTOR);
    // Force-expire the trial via override to the past, then sweep.
    managedFounderStore.overrideTrial(pid, e.id, past(), ACTOR);
    managedFounderStore.expireStaleTrials(pid);
    const lapsed = managedFounderStore.getEngagement(pid, e.id)!;
    expect(lapsed.status).toBe("LAPSED");
    expect(() => managedFounderStore.assertGraduation(pid, lapsed)).toThrowError(/ENGAGEMENT_NOT_ACTIVE/);
  });
  it("NEGATIVE: neither sources_capital nor delegated_agency is denied", () => {
    const pid = "p_gate5_nocap";
    managedFounderStore.setCapabilityProfile(pid, { classified: true, sourcesCapital: false, delegatedAgency: false }, ACTOR);
    const e = managedFounderStore.createEngagement(pid, { companyId: "co_g5c" }, ACTOR);
    expect(() => managedFounderStore.assertGraduation(pid, e)).toThrowError(/GRADUATION_CAPABILITY_REQUIRED/);
  });
});

describe("GateError typing", () => {
  it("gate failures are GateError instances carrying a stable .code", () => {
    const pid = "p_gate_err";
    try {
      managedFounderStore.createEngagement(pid, { companyId: "co_err" }, ACTOR);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(GateError);
      expect((e as GateError).code).toBe("CAPABILITY_UNCLASSIFIED");
    }
  });
});

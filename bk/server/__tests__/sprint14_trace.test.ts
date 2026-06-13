/**
 * Sprint 14 D7 — Universal trace coverage tests.
 *
 * Asserts that every store mutation we've wired produces a SyncEnvelope with
 * a non-empty trace[]. Uses a spy at the trace level + emitSync output.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { withTrace, currentTrace, computeDefHash, __clearTraceStack, singleStepTrace } from "../lib/trace";
import { emitSync, getRecentEvents, clearEvents } from "../sprint10Telemetry";
import { createIntroRequest, updateIntroRequest, __clearIntroRequests } from "../introRequestStore";
import { createChannel, archiveChannel, __clearTransactionPrep } from "../transactionPrepStore";
import { createBroadcast, __clearBroadcasts } from "../milestoneBroadcastStore";
import { ingestDscScores, __clearDscFeedback } from "../dscFeedbackStore";
import { chargeOrIdempotent, __clearPayments } from "../paymentStore";

beforeEach(() => {
  __clearTraceStack();
  clearEvents();
  __clearIntroRequests();
  __clearTransactionPrep();
  __clearBroadcasts();
  __clearDscFeedback();
  __clearPayments();
});

describe("D7 trace stack + helpers", () => {
  it("computeDefHash is stable per (formulaId, version)", () => {
    expect(computeDefHash("foo", "1.0.0")).toBe(computeDefHash("foo", "1.0.0"));
    expect(computeDefHash("foo", "1.0.0")).not.toBe(computeDefHash("foo", "1.0.1"));
  });

  it("withTrace pushes a single frame and pops on exit", () => {
    expect(currentTrace()).toBeUndefined();
    const out = withTrace("test", "1.0.0", "US", () => {
      const t = currentTrace();
      expect(t?.length).toBe(1);
      expect(t?.[0].formulaId).toBe("test");
      return 42;
    });
    expect(out).toBe(42);
    expect(currentTrace()).toBeUndefined();
  });

  it("withTrace nests correctly", () => {
    withTrace("outer", "1.0.0", "US", () => {
      withTrace("inner", "1.0.0", "EU", () => {
        const t = currentTrace();
        expect(t?.length).toBe(2);
        expect(t?.[0].formulaId).toBe("outer");
        expect(t?.[1].formulaId).toBe("inner");
        expect(t?.[1].region).toBe("EU");
      });
    });
  });

  it("singleStepTrace returns one step", () => {
    const t = singleStepTrace("x", "1", "US");
    expect(t).toHaveLength(1);
    expect(t[0].formulaId).toBe("x");
  });
});

describe("D7 envelope.trace[] is non-empty for store mutations", () => {
  it("emitSync without active trace synthesizes a single-step trace", () => {
    emitSync({ eventType: "test_evt", aggregateId: "x", aggregateKind: "company", payload: {} });
    const events = getRecentEvents();
    expect(events[events.length - 1].trace).toBeDefined();
    expect(events[events.length - 1].trace!.length).toBeGreaterThanOrEqual(1);
  });

  it("createIntroRequest has trace[]", () => {
    createIntroRequest({
      requesterCompanyId: "co_x",
      targetEntity: { kind: "acquirer", name: "BigCo", sector: "fintech" },
      askText: "warm intro please",
    }, "u_founder_demo");
    const last = getRecentEvents().at(-1)!;
    expect(last.eventType).toBe("crm_intro_requested");
    expect(last.trace?.length).toBeGreaterThanOrEqual(1);
    expect(last.trace?.[0].formulaId).toBe("crm.intro_request.create");
  });

  it("updateIntroRequest has trace[]", () => {
    const r = createIntroRequest({
      requesterCompanyId: "co_x",
      targetEntity: { kind: "investor", name: "Co-Inv" },
      askText: "ask",
    }, "u_a");
    clearEvents();
    updateIntroRequest(r.id, { status: "accepted" }, "u_recipient");
    const last = getRecentEvents().at(-1)!;
    expect(last.eventType).toBe("crm_intro_accepted");
    expect(last.trace?.[0].formulaId).toBe("crm.intro_request.accepted");
  });

  it("createChannel + archiveChannel have trace[]", () => {
    const ch = createChannel({ companyId: "co_x", founderUserId: "u_f" });
    expect(getRecentEvents().at(-1)?.trace?.length).toBeGreaterThanOrEqual(1);
    clearEvents();
    archiveChannel(ch.id, "not_pursuing", "u_f");
    expect(getRecentEvents().at(-1)?.eventType).toBe("transaction_prep_channel_archived");
    expect(getRecentEvents().at(-1)?.trace?.length).toBeGreaterThanOrEqual(1);
  });

  it("createBroadcast has trace[]", () => {
    createBroadcast({ companyId: "co_x", segmentKind: "all", body: "Closed Series A!" }, "u_f");
    const last = getRecentEvents().at(-1)!;
    expect(last.eventType).toBe("cap_table_broadcast_sent");
    expect(last.trace?.[0].formulaId).toBe("comms.milestone_broadcast");
  });

  it("ingestDscScores has trace[]", () => {
    ingestDscScores({
      companyId: "co_x",
      tier: "featured",
      dimensions: { team: 90, ip: 80, market: 70, finance: 60, ops: 50, ga: 40 },
      narrative: "strong team",
    });
    const last = getRecentEvents().at(-1)!;
    expect(last.eventType).toBe("dsc.review_received");
    expect(last.trace?.[0].formulaId).toBe("comms.dsc.feedback_relay");
  });

  it("chargeOrIdempotent has trace[]", () => {
    chargeOrIdempotent({
      intentId: "int_1", kind: "collective_membership", amountCents: 120000,
      currency: "USD", customerId: "u_x", description: "Annual", forceState: "demo",
    });
    const last = getRecentEvents().at(-1)!;
    expect(last.eventType).toBe("payment_charged");
    expect(last.trace?.[0].formulaId).toBe("payment.collective_membership");
  });
});

describe("D7 sample of 5 mutations — all envelopes carry non-empty trace[]", () => {
  it("validates 5 different mutation types", () => {
    createIntroRequest({ requesterCompanyId: "co_a", targetEntity: { kind: "acquirer", name: "X" }, askText: "a" }, "u_a");
    createChannel({ companyId: "co_a", founderUserId: "u_a" });
    createBroadcast({ companyId: "co_a", segmentKind: "by_stage", segmentValue: "early", body: "hello" }, "u_a");
    ingestDscScores({ companyId: "co_a", tier: "qualified", dimensions: { a: 50 }, narrative: "ok" });
    chargeOrIdempotent({ intentId: "i1", kind: "founder_subscription", amountCents: 24900, currency: "USD", customerId: "u_a", description: "Pro", forceState: "demo" });

    const events = getRecentEvents();
    const sampleTypes = ["crm_intro_requested", "transaction_prep_channel_created", "cap_table_broadcast_sent", "dsc.review_received", "payment_charged"];
    for (const t of sampleTypes) {
      const e = events.find((x) => x.eventType === t);
      expect(e, `event ${t} missing`).toBeDefined();
      expect(e!.trace, `trace missing for ${t}`).toBeDefined();
      expect(e!.trace!.length).toBeGreaterThanOrEqual(1);
    }
  });
});

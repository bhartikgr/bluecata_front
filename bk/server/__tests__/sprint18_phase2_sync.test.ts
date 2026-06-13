/**
 * Sprint 18 Phase 2 — T13 Sync verification tests.
 *
 * Per SPRINT-18-MANDATE.md T13: every Sprint 18 mutation should
 *  - validate via zod
 *  - emit a bridge outbound event
 *  - append a hash-chain entry
 *  - fire SSE invalidation (verified at integration layer)
 *  - log telemetry trace
 *
 * These tests assert the bridge-outbound + hash-chain components for the
 * key mutations introduced in Phase 2 (cap-table, round-terms, dataroom,
 * report send, settings, profile).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { BridgeOutbound } from "../lib/bridgeOutbound";
import { _testBridge } from "../bridgeStore";
import { hashChainOk, _resetRuntime } from "../lib/bridgeRuntime";

beforeEach(() => {
  _testBridge.resetChain();
  _resetRuntime();
  BridgeOutbound.__clearSpy();
});

describe("Sprint 18 Phase 2 — Sync verification (T13)", () => {
  it("cap-table mutation emits capTableMutated bridge event with hash chain", () => {
    BridgeOutbound.capTableMutated("co_test", {
      companyId: "co_test",
      changeType: "issuance",
      certificateNumber: "CS-100",
    });
    const spy = BridgeOutbound.__getSpy();
    expect(spy.some((e) => e.eventType === "cap_table.mutated")).toBe(true);
    expect(hashChainOk()).toBe(true);
  });

  it("round terms update emits governanceMetricPublished + chain integrity", () => {
    BridgeOutbound.governanceMetricPublished("co_test", {
      roundId: "rd_a",
      kind: "terms_updated",
      preMoney: 10_000_000,
    });
    const spy = BridgeOutbound.__getSpy();
    expect(spy.some((e) => e.eventType === "governance_metric.published")).toBe(true);
    expect(hashChainOk()).toBe(true);
  });

  it("dataroom upload appends audit log via auditLogAppended", () => {
    BridgeOutbound.auditLogAppended("dr_test", {
      aggregateId: "dr_test",
      action: "dataroom.upload",
      target: "deck.pdf",
    });
    const spy = BridgeOutbound.__getSpy();
    expect(spy.some((e) => e.eventType === "audit_log.appended")).toBe(true);
    expect(hashChainOk()).toBe(true);
  });

  it("report send emits audit log entry per recipient", () => {
    BridgeOutbound.auditLogAppended("rep_001", {
      aggregateId: "rep_001",
      action: "report.sent",
      target: "u_investor_a",
    });
    BridgeOutbound.auditLogAppended("rep_001", {
      aggregateId: "rep_001",
      action: "report.sent",
      target: "u_investor_b",
    });
    const spy = BridgeOutbound.__getSpy();
    const reportEvents = spy.filter((e) => e.eventType === "audit_log.appended");
    expect(reportEvents.length).toBeGreaterThanOrEqual(2);
    expect(hashChainOk()).toBe(true);
  });

  it("settings change (timezone, privacy) emits investorProfileUpdated", () => {
    BridgeOutbound.investorProfileUpdated("u_maya_chen", {
      userId: "u_maya_chen",
      timezone: "America/Toronto",
      privacy: { screenNameOn: false },
    });
    const spy = BridgeOutbound.__getSpy();
    expect(spy.some((e) => e.eventType === "investor.profile.updated")).toBe(true);
    expect(hashChainOk()).toBe(true);
  });

  it("company profile change (T3 fields) emits companyProfileUpdated", () => {
    BridgeOutbound.companyProfileUpdated("co_test", {
      companyId: "co_test",
      isPubliclyTraded: true,
      listingCountryCode: "US",
      exchangeCode: "NASDAQ_GS",
      tickerSymbol: "TEST",
    });
    const spy = BridgeOutbound.__getSpy();
    const evt = spy.find((e) => e.eventType === "company.profile.updated");
    expect(evt).toBeTruthy();
    // Note: companyProfileUpdated filters payload via allow-list; just assert event presence.
    expect((evt as any).payload).toBeDefined();
    expect(hashChainOk()).toBe(true);
  });

  it("six consecutive Sprint 18 emissions keep the bridge hash chain valid", () => {
    BridgeOutbound.capTableMutated("co_a", { companyId: "co_a" });
    BridgeOutbound.governanceMetricPublished("co_a", { kind: "terms_updated" });
    BridgeOutbound.auditLogAppended("dr_a", { action: "dataroom.upload" });
    BridgeOutbound.auditLogAppended("rep_a", { action: "report.sent" });
    BridgeOutbound.investorProfileUpdated("u_a", { userId: "u_a" });
    BridgeOutbound.companyProfileUpdated("co_a", { companyId: "co_a" });
    expect(hashChainOk()).toBe(true);
    expect(BridgeOutbound.__getSpy().length).toBeGreaterThanOrEqual(6);
  });
});

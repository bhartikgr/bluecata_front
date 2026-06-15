/**
 * v23.5 — founderCollectiveApplyStore C-009 helper unit tests.
 *
 * Tests the 4 new exported functions:
 *   - listApplications(filter?)
 *   - getApplicationById(id)
 *   - setApplicationStatus(id, status, reviewedBy?)
 *   - getLatestApplicationByFounder(founderId)
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  clearFounderCollectiveStore,
  listApplications,
  getApplicationById,
  setApplicationStatus,
  getLatestApplicationByFounder,
} from "../founderCollectiveApplyStore";

// Internal test store: we'll populate via the exported helpers directly.
// To insert test data we call the private applications array via clearStore
// then check via the helpers.

// We need a way to add applications. Since POST route is the only way,
// we'll use an express server for the setup and call the helpers directly.
// For simplicity we manipulate via the in-memory array through clear+push.
// But since the array is private, we'll test through the public route in
// the integration test. Here we do unit-level tests by importing and checking
// the filter logic.

describe("founderCollectiveApplyStore C-009 helpers (unit)", () => {
  beforeEach(() => {
    clearFounderCollectiveStore();
  });

  it("listApplications() returns empty array when store is clear", () => {
    const apps = listApplications();
    expect(apps).toEqual([]);
  });

  it("listApplications({ status }) returns empty array when store is clear", () => {
    const apps = listApplications({ status: "submitted" });
    expect(apps).toEqual([]);
  });

  it("getApplicationById returns null for unknown id", () => {
    const app1 = getApplicationById("capp_nonexistent");
    expect(app1).toBeNull();
  });

  it("setApplicationStatus returns null for unknown id", () => {
    const result = setApplicationStatus("capp_nonexistent", "rejected");
    expect(result).toBeNull();
  });

  it("getLatestApplicationByFounder returns null when no apps", () => {
    const app1 = getLatestApplicationByFounder("u_maya_chen");
    expect(app1).toBeNull();
  });
});

describe("founderCollectiveApplyStore helpers (integration via server)", () => {
  // Integration tests are in v25_C009_admin_collective_bridge.test.ts
  // and v25_C006_C014_mine_endpoints.test.ts.
  // This file just covers the pure unit cases above + source-level checks.
  it("listApplications is exported", () => {
    expect(typeof listApplications).toBe("function");
  });

  it("getApplicationById is exported", () => {
    expect(typeof getApplicationById).toBe("function");
  });

  it("setApplicationStatus is exported", () => {
    expect(typeof setApplicationStatus).toBe("function");
  });

  it("getLatestApplicationByFounder is exported", () => {
    expect(typeof getLatestApplicationByFounder).toBe("function");
  });
});

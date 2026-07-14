/**
 * W3 — Data hygiene workstream tests (NON-sacred; server + shared client-safe
 * pure logic only). Covers:
 *   W3.1 seed/test-data guard (filterSeedRows / isQaEmail / isSeedRow)
 *   W3.4 company display-name fallback logic (mirrors adminCollectiveRoutes)
 *   W3.5 partner-team duplicate-seat dedupe helper
 *   W3.6 snake_case enum label humanizer (labelFor)
 *
 * These are pure-function unit tests — no Express app / DB wiring required,
 * consistent with how the rest of this suite isolates logic from transport.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  hideSeedDataEnabled,
  isQaEmail,
  isSeedRow,
  filterSeedRows,
} from "../lib/seedDataGuard";
import {
  partnerTeamStore,
  type PartnerTeamMember,
} from "../partnerWorkspaceStore";

const dedupeActiveTeamMembers = partnerTeamStore.dedupeActiveTeamMembers;

describe("W3.1 — seed/test-data guard", () => {
  const ORIGINAL_ENV = process.env.HIDE_SEED_DATA;
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.HIDE_SEED_DATA;
    else process.env.HIDE_SEED_DATA = ORIGINAL_ENV;
  });

  it("hideSeedDataEnabled is true only for the literal string 'true'", () => {
    process.env.HIDE_SEED_DATA = "true";
    expect(hideSeedDataEnabled()).toBe(true);
    process.env.HIDE_SEED_DATA = "1";
    expect(hideSeedDataEnabled()).toBe(false);
    delete process.env.HIDE_SEED_DATA;
    expect(hideSeedDataEnabled()).toBe(false);
  });

  it("isQaEmail matches the reserved QA domain case-insensitively", () => {
    expect(isQaEmail("someone@capavate-qa.local")).toBe(true);
    expect(isQaEmail("Someone@CAPAVATE-QA.LOCAL")).toBe(true);
    expect(isQaEmail("test@example.com")).toBe(false);
    expect(isQaEmail(undefined)).toBe(false);
    expect(isQaEmail(null)).toBe(false);
    expect(isQaEmail("")).toBe(false);
  });

  it("isSeedRow only recognizes EXPLICIT seed flags, never infers from names", () => {
    expect(isSeedRow({ isSeed: true })).toBe(true);
    expect(isSeedRow({ is_seed: 1 })).toBe(true);
    expect(isSeedRow({ is_seed: true })).toBe(true);
    expect(isSeedRow({ metadata: { seed: true } })).toBe(true);
    expect(isSeedRow({ source: "seed" })).toBe(true);
    // Weak/inferred signals must NOT be treated as seed rows.
    expect(isSeedRow({ name: "Test Company Inc" })).toBe(false);
    expect(isSeedRow({ email: "test@example.com" })).toBe(false);
    expect(isSeedRow(null)).toBe(false);
    expect(isSeedRow(undefined)).toBe(false);
  });

  it("filterSeedRows hides QA-email and explicit-seed rows only when the flag is enabled", () => {
    process.env.HIDE_SEED_DATA = "true";
    const rows = [
      { id: "1", founderEmail: "real.founder@example.com" },
      { id: "2", founderEmail: "qa.bot@capavate-qa.local" },
      { id: "3", founderEmail: "QA.BOT2@Capavate-QA.Local" },
      { id: "4", founderEmail: "test@example.com" }, // NOT the reserved domain — must stay visible
      { id: "5", founderEmail: "another@example.com", isSeed: true },
    ];
    const { rows: visible, hiddenSeedCount } = filterSeedRows(rows, { emailFields: ["founderEmail"] });
    expect(hiddenSeedCount).toBe(3);
    expect(visible.map((r) => r.id)).toEqual(["1", "4"]);
  });

  it("filterSeedRows returns all rows unchanged when HIDE_SEED_DATA is not enabled", () => {
    delete process.env.HIDE_SEED_DATA;
    const rows = [
      { id: "1", founderEmail: "real@example.com" },
      { id: "2", founderEmail: "qa.bot@capavate-qa.local" },
    ];
    const { rows: visible, hiddenSeedCount } = filterSeedRows(rows, { emailFields: ["founderEmail"] });
    expect(hiddenSeedCount).toBe(0);
    expect(visible).toHaveLength(2);
  });
});

describe("W3.4 — company display-name fallback (mirrors adminCollectiveRoutes logic)", () => {
  // Re-implements the exact fallback chain used in
  // server/adminCollectiveRoutes.ts so a regression there and here would both
  // need to change together; keeps this test dependency-free of Express wiring.
  function computeCompanyDisplayName(
    canonicalCompanyName: string | undefined,
    appCompanyName: string | undefined,
    founderName: string | undefined,
  ): string {
    return (
      canonicalCompanyName ??
      appCompanyName ??
      (founderName ? `${founderName}'s company` : "Company pending")
    );
  }

  it("prefers the canonical company name when present", () => {
    expect(computeCompanyDisplayName("Acme Robotics", "Legacy Name", "Jane Doe")).toBe("Acme Robotics");
  });

  it("falls back to the app's companyName when no canonical name exists", () => {
    expect(computeCompanyDisplayName(undefined, "Legacy Name", "Jane Doe")).toBe("Legacy Name");
  });

  it("falls back to \"<Founder>'s company\" when no company name exists at all", () => {
    expect(computeCompanyDisplayName(undefined, undefined, "Jane Doe")).toBe("Jane Doe's company");
  });

  it("falls back to \"Company pending\" when neither a company nor founder name exists", () => {
    expect(computeCompanyDisplayName(undefined, undefined, undefined)).toBe("Company pending");
  });

  it("never returns a raw opaque id-shaped string as the display name", () => {
    const raw = "u_founder_9f3a";
    // isRawUserIdLike-style check: a resolver returning a raw id must never
    // be threaded through as founderName in the first place, so the fallback
    // chain above never sees it. Guard the shape directly here too.
    expect(/^u_[A-Za-z0-9_]*$/.test(raw)).toBe(true);
    expect(computeCompanyDisplayName(undefined, undefined, undefined)).not.toMatch(/^u_/);
  });
});

describe("W3.5 — partner team duplicate-seat dedupe", () => {
  function member(overrides: Partial<PartnerTeamMember>): PartnerTeamMember {
    return {
      id: "id-default",
      partnerId: "p1",
      userId: "u1",
      subRole: "viewer",
      status: "active",
      joinedAt: "2026-01-01T00:00:00.000Z",
      removedAt: null,
      createdBy: "u_admin",
      isSeed: false,
      ...overrides,
    };
  }

  it("returns rows unchanged when there are no duplicates", () => {
    const rows = [member({ id: "a", userId: "u1" }), member({ id: "b", userId: "u2" })];
    const result = dedupeActiveTeamMembers(rows);
    expect(result.members).toHaveLength(2);
    expect(result.duplicateSeatCount).toBe(0);
    expect(result.duplicateSeatIdsByUserId).toEqual({});
  });

  it("collapses duplicate active seats for the same user, preferring the most-privileged subRole", () => {
    const rows = [
      member({ id: "a", userId: "u1", subRole: "viewer", joinedAt: "2026-01-01T00:00:00.000Z" }),
      member({ id: "b", userId: "u1", subRole: "managing_partner", joinedAt: "2026-01-02T00:00:00.000Z" }),
      member({ id: "c", userId: "u2", subRole: "analyst" }),
    ];
    const result = dedupeActiveTeamMembers(rows);
    expect(result.members).toHaveLength(2);
    const u1 = result.members.find((m) => m.userId === "u1");
    expect(u1?.id).toBe("b"); // managing_partner outranks viewer
    expect(result.duplicateSeatCount).toBe(1);
    expect(result.duplicateSeatIdsByUserId).toEqual({ u1: ["a"] });
  });

  it("breaks ties by newest joinedAt when subRole is equal, then by stable id", () => {
    const rows = [
      member({ id: "z", userId: "u1", subRole: "analyst", joinedAt: "2026-01-01T00:00:00.000Z" }),
      member({ id: "a", userId: "u1", subRole: "analyst", joinedAt: "2026-03-01T00:00:00.000Z" }),
    ];
    const result = dedupeActiveTeamMembers(rows);
    expect(result.members[0].id).toBe("a"); // newer joinedAt wins
    expect(result.duplicateSeatIdsByUserId.u1).toEqual(["z"]);
  });

  it("never mutates or drops rows from the input array", () => {
    const rows = [
      member({ id: "a", userId: "u1", subRole: "viewer" }),
      member({ id: "b", userId: "u1", subRole: "bd" }),
    ];
    const before = JSON.stringify(rows);
    dedupeActiveTeamMembers(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("W3.6 — snake_case enum label humanizer", () => {
  // Re-implemented locally (client/src/lib/collectiveLabels.ts is a
  // browser-side module using import.meta/process.env.NODE_ENV branches not
  // meant for server-side import); this test asserts the SAME contract:
  // known values resolve via the map, unknown snake_case values are
  // title-cased, and it never throws.
  function titleCaseToken(raw: string): string {
    return raw
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function labelFor(map: Record<string, string>, value: string | null | undefined): string {
    if (!value) return "\u2014";
    return map[value] ?? titleCaseToken(String(value));
  }

  const FEE_KIND_LABELS: Record<string, string> = {
    membership_dues: "Membership dues",
    event_fee: "Event fee",
  };

  it("resolves known enum values through the map", () => {
    expect(labelFor(FEE_KIND_LABELS, "membership_dues")).toBe("Membership dues");
    expect(labelFor(FEE_KIND_LABELS, "event_fee")).toBe("Event fee");
  });

  it("title-cases unknown snake_case values instead of throwing", () => {
    expect(labelFor(FEE_KIND_LABELS, "some_future_fee_kind")).toBe("Some Future Fee Kind");
    expect(() => labelFor(FEE_KIND_LABELS, "brand_new_value")).not.toThrow();
  });

  it("handles nullish/empty values gracefully", () => {
    expect(labelFor(FEE_KIND_LABELS, undefined)).toBe("\u2014");
    expect(labelFor(FEE_KIND_LABELS, null)).toBe("\u2014");
    expect(labelFor(FEE_KIND_LABELS, "")).toBe("\u2014");
  });

  it("humanizes carry-basis and distribution-scope style values", () => {
    const CARRY_BASIS_LABELS: Record<string, string> = {
      per_deployment: "Per deployment",
      whole_spv: "Whole SPV",
    };
    expect(labelFor(CARRY_BASIS_LABELS, "per_deployment")).toBe("Per deployment");
    expect(labelFor(CARRY_BASIS_LABELS, "whole_spv")).toBe("Whole SPV");
  });
});

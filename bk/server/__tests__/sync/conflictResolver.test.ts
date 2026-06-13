/**
 * Sprint 13 — Conflict resolver: every SOT rule.
 */
import { describe, it, expect } from "vitest";
import { resolveConflicts, type FieldPolicy } from "@shared/schemas/sync";
import { resolveForEntity } from "../../lib/syncConflictResolver";

describe("Sprint 13 — Conflict resolver SOT rules", () => {
  it("sot=capavate: local always wins", () => {
    const policies: Record<string, FieldPolicy> = { x: { sot: "capavate" } };
    const r = resolveConflicts({
      local: { x: "L" },
      remote: { x: "R" },
      policies,
    });
    expect(r.merged.x).toBe("L");
    expect(r.conflicts[0].chose).toBe("local");
  });

  it("sot=collective: remote wins", () => {
    const policies: Record<string, FieldPolicy> = { x: { sot: "collective" } };
    const r = resolveConflicts({
      local: { x: "L" },
      remote: { x: "R" },
      policies,
    });
    expect(r.merged.x).toBe("R");
    expect(r.conflicts[0].chose).toBe("remote");
  });

  it("sot=derived: remote rejected", () => {
    const policies: Record<string, FieldPolicy> = { x: { sot: "derived", derived: true } };
    const r = resolveConflicts({
      local: { x: 100 },
      remote: { x: 200 },
      policies,
    });
    expect(r.merged.x).toBe(100);
    expect(r.conflicts[0].chose).toBe("rejected_derived");
  });

  it("sot=shared with LWW: remote newer wins", () => {
    const policies: Record<string, FieldPolicy> = { x: { sot: "shared" } };
    const r = resolveConflicts({
      local: { x: "L" },
      remote: { x: "R" },
      localUpdatedAt: "2026-05-01T00:00:00Z",
      remoteUpdatedAt: "2026-05-09T00:00:00Z",
      policies,
    });
    expect(r.merged.x).toBe("R");
  });

  it("sot=shared with LWW: local newer wins", () => {
    const policies: Record<string, FieldPolicy> = { x: { sot: "shared" } };
    const r = resolveConflicts({
      local: { x: "L" },
      remote: { x: "R" },
      localUpdatedAt: "2026-06-01T00:00:00Z",
      remoteUpdatedAt: "2026-05-01T00:00:00Z",
      policies,
    });
    expect(r.merged.x).toBe("L");
  });

  it("missing local + remote provided: takes remote", () => {
    const policies: Record<string, FieldPolicy> = { x: { sot: "shared" } };
    const r = resolveConflicts({
      local: {} as Record<string, unknown>,
      remote: { x: "R" },
      policies,
    });
    expect(r.merged.x).toBe("R");
  });

  it("resolveForEntity company: ma score from collective overrides local", () => {
    const localUpdatedAt = "2026-05-01T00:00:00Z";
    const remoteUpdatedAt = "2026-05-09T00:00:00Z";
    const r = resolveForEntity(
      "company",
      { id: "co_x", compositeScore: 50 } as Record<string, unknown>,
      { compositeScore: 90 } as Record<string, unknown>,
      localUpdatedAt,
      remoteUpdatedAt,
    );
    expect(r.merged.compositeScore).toBe(90);
  });

  it("resolveForEntity company: jurisdiction is capavate-owned and NOT overridden", () => {
    const r = resolveForEntity(
      "company",
      { id: "co_x", jurisdiction: "US/DE" } as Record<string, unknown>,
      { jurisdiction: "UK" } as Record<string, unknown>,
    );
    expect(r.merged.jurisdiction).toBe("US/DE");
  });

  it("resolveForEntity investor: collectiveMemberTier flips to remote", () => {
    const r = resolveForEntity(
      "investor",
      { id: "u_x", collectiveMemberTier: "individual" } as Record<string, unknown>,
      { collectiveMemberTier: "plus" } as Record<string, unknown>,
    );
    expect(r.merged.collectiveMemberTier).toBe("plus");
  });
});

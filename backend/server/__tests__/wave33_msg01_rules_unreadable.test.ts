/**
 * server/__tests__/wave33_msg01_rules_unreadable.test.ts
 *
 * WAVE 33 · CP-MSG-01 — the ONE branch the main harness structurally cannot
 * reach: `readRules()` when the database itself is unreadable.
 *
 * WHY A SEPARATE FILE
 *   `commsAudienceRules` imports `rawDb` STATICALLY (deliberately — a lazily
 *   required dependency inside a policy reader is a reader that silently
 *   disappears on the runtime where it was not tested). Replacing that binding
 *   therefore requires `vi.doMock` + a dynamic import BEFORE the module is
 *   first evaluated, which cannot coexist in one file with the main harness's
 *   real-database fixtures.
 *
 * WHAT IT PROVES
 *   Invariant 1 of that module: when the rules table cannot be read AT ALL, the
 *   reader returns the four PRE-EXISTING sources as ENABLED — it does not
 *   return `[]`. Returning `[]` would silently empty every recipient picker on
 *   the platform the moment a read failed, with no error surfaced anywhere.
 *   That is a deliberate exception to fail-closed and it is exactly the shape
 *   the mutation run (M5) showed was untested.
 *
 *   BOTH POLES are asserted: the four legacy rules come back ON, and the two
 *   partner rules — which the owner has NOT ruled on — do NOT appear at all. A
 *   fallback that turned the undecided rules on would answer a commercial
 *   question by way of an error handler.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const THROWN = "w33msg simulated unreadable database";

beforeEach(() => {
  vi.resetModules();
});

describe("CP-MSG-01 — an UNREADABLE rules table falls back, it does not empty", () => {
  it("U0 SANITY POLE — the mock really is what the module under test receives", async () => {
    /* Without this the whole file could be green because the mock never
       applied and the real database answered normally — a test that passes
       while testing nothing, which is the failure this build keeps finding. */
    vi.doMock("../db/connection", () => ({
      rawDb: () => {
        throw new Error(THROWN);
      },
      getDb: () => {
        throw new Error(THROWN);
      },
    }));
    const { rawDb } = await import("../db/connection");
    expect(() => rawDb()).toThrowError(THROWN);
  });

  it("U1 readRules() returns the FOUR legacy sources, ENABLED, when the read throws", async () => {
    vi.doMock("../db/connection", () => ({
      rawDb: () => {
        throw new Error(THROWN);
      },
      getDb: () => {
        throw new Error(THROWN);
      },
    }));
    const { readRules } = await import("../lib/commsAudienceRules");
    const rules = readRules();

    expect(rules.length).toBe(4);
    expect(rules.map((r) => r.ruleKey).sort()).toEqual([
      "cap_table_peer",
      "channel_participant",
      "chapter_peer",
      "follow_peer",
    ]);
    for (const r of rules) {
      expect({ key: r.ruleKey, enabled: r.enabled }).toEqual({ key: r.ruleKey, enabled: true });
    }
  });

  it("U2 POLE — the two UNDECIDED partner rules are NOT turned on by the fallback", async () => {
    vi.doMock("../db/connection", () => ({
      rawDb: () => {
        throw new Error(THROWN);
      },
      getDb: () => {
        throw new Error(THROWN);
      },
    }));
    const { readRules, isAudienceRuleEnabled } = await import("../lib/commsAudienceRules");
    const keys = readRules().map((r) => r.ruleKey);
    expect(keys).not.toContain("partner_engaged_company_people");
    expect(keys).not.toContain("partner_team_peers");
    expect(isAudienceRuleEnabled("partner_engaged_company_people", "partner")).toBe(false);
    expect(isAudienceRuleEnabled("partner_team_peers", "partner")).toBe(false);
  });

  it("U3 the four legacy sources evaluate as ENABLED through the public predicate too", async () => {
    /* `isAudienceRuleEnabled` is what the picker actually calls. Asserting only
       on `readRules()` would leave the path the handler uses unproven. */
    vi.doMock("../db/connection", () => ({
      rawDb: () => {
        throw new Error(THROWN);
      },
      getDb: () => {
        throw new Error(THROWN);
      },
    }));
    const { isAudienceRuleEnabled } = await import("../lib/commsAudienceRules");
    for (const k of ["channel_participant", "cap_table_peer", "chapter_peer", "follow_peer"]) {
      expect({ k, on: isAudienceRuleEnabled(k, "investor") }).toEqual({ k, on: true });
    }
    // An unknown key is still OFF — the fallback is a fixed list, not "yes".
    expect(isAudienceRuleEnabled("rule_that_does_not_exist", "investor")).toBe(false);
  });

  it("U4 nothing throws out of the module — a broken read is handled, not propagated", async () => {
    vi.doMock("../db/connection", () => ({
      rawDb: () => {
        throw new Error(THROWN);
      },
      getDb: () => {
        throw new Error(THROWN);
      },
    }));
    const mod = await import("../lib/commsAudienceRules");
    expect(() => mod.readRules()).not.toThrow();
    expect(() => mod.pendingOwnerDecisions("partner")).not.toThrow();
    // The decision sink fails CLOSED and says so, rather than reporting success.
    const r = mod.setAudienceRuleEnabled("partner_team_peers", true, "u_owner");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("write_failed");
  });
});

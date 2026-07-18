/**
 * W-INVEST BUG C — founder dashboard showed "No active round" when a round IS
 * active. Root cause: the FE checked only 2 states (soft_circle_open,
 * signing_open) while the backend truth set has 5. The canonical predicate now
 * lives in shared/schema.ts and is consumed by BOTH the FE and the server, so
 * they can never drift.
 */
import { describe, it, expect } from "vitest";
import {
  ACTIVE_LIVE_ROUND_STATES_LIST,
  isActiveLiveRoundState,
} from "../../shared/schema";
import { ACTIVE_LIVE_ROUND_STATES } from "../roundsStore";

describe("W-INVEST BUG C — canonical active-round predicate", () => {
  it("declares exactly the 5 active/live states", () => {
    expect([...ACTIVE_LIVE_ROUND_STATES_LIST].sort()).toEqual(
      ["active", "live", "open", "signing_open", "soft_circle_open"].sort(),
    );
  });

  it("server ACTIVE_LIVE_ROUND_STATES is built from the shared list (no drift)", () => {
    expect([...ACTIVE_LIVE_ROUND_STATES].sort()).toEqual(
      [...ACTIVE_LIVE_ROUND_STATES_LIST].sort(),
    );
  });

  it("isActiveLiveRoundState returns true for each of the 5 active states", () => {
    for (const s of ACTIVE_LIVE_ROUND_STATES_LIST) {
      expect(isActiveLiveRoundState(s), s).toBe(true);
    }
  });

  it("returns false for draft/closed/terms_set and nullish", () => {
    for (const s of ["draft", "closed", "terms_set", "funded", "", null, undefined]) {
      expect(isActiveLiveRoundState(s as any), String(s)).toBe(false);
    }
  });

  it("is case-insensitive", () => {
    expect(isActiveLiveRoundState("SOFT_CIRCLE_OPEN")).toBe(true);
    expect(isActiveLiveRoundState("Open")).toBe(true);
  });
});

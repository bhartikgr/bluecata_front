/**
 * WAVE 225 · ITEM A — THE PROVENANCE GATE ITSELF.
 *
 * The HTTP proof (`w225_comp_provenance_http.test.ts`) pins what an investor
 * receives. This file pins that the gate is a GATE and not a blanket refusal —
 * the distinction that decides whether wave 226 can ever ship a real comparable.
 *
 * A gate that refuses everything is indistinguishable, from the outside, from a
 * gate that refuses correctly, and today it happens to refuse all nine rows. So
 * the ADMIT pole is asserted explicitly here with a synthetic candidate that
 * carries a source and a real source date. That candidate is a test input, not a
 * comparable: it names no company and asserts nothing about the world.
 *
 * Ruling R193.2. Owner instruction: "Or gate on real provenance".
 */
import { describe, it, expect } from "vitest";

import {
  COMPS_PROVENANCE_STATUS_VERIFIED,
  COMPS_PROVENANCE_STATUS_NONE_HELD,
  isRealIsoDate,
  hasVerifiedProvenance,
  verifiedComps,
  compsProvenanceVerdict,
  compsProvenanceStatement,
} from "../lib/wave225CompProvenance";
import { PUBLIC_MARKET_COMPS } from "../lib/maPublicComps";
import { LOOKS_HUMAN_MAX_LENGTH } from "../../shared/refusalHeadlineGate";

/**
 * The client's gate, restated here as the client actually implements it at
 * `client/src/lib/queryClient.ts:60-64`: non-empty, STRICTLY under 240
 * characters, and containing a lower-case letter. `shared/refusalHeadlineGate.ts`
 * exports the bound but not the predicate, so the predicate is spelled out
 * rather than approximated — note `<`, not `<=`: 240 exactly is DISCARDED and
 * replaced by a generic "something went wrong", which is a silent refusal.
 */
function passesLooksHumanGate(s: string): boolean {
  return s.length > 0 && s.length < LOOKS_HUMAN_MAX_LENGTH && /[a-z]/.test(s);
}

describe("wave 225 · isRealIsoDate — a real calendar date, not a well-shaped string", () => {
  it("accepts a real date", () => {
    expect(isRealIsoDate("2025-02-28")).toBe(true);
  });

  it("rejects 2025-02-30 — correctly shaped and does not exist", () => {
    // This is the case a bare /^\d{4}-\d{2}-\d{2}$/ regex admits. A source date
    // that cannot have happened is not provenance.
    expect(isRealIsoDate("2025-02-30")).toBe(false);
  });

  it("rejects month 13 and day 00", () => {
    expect(isRealIsoDate("2025-13-01")).toBe(false);
    expect(isRealIsoDate("2025-01-00")).toBe(false);
  });

  it("rejects undefined, empty and whitespace-only", () => {
    expect(isRealIsoDate(undefined)).toBe(false);
    expect(isRealIsoDate("")).toBe(false);
    expect(isRealIsoDate("   ")).toBe(false);
  });

  it("rejects a non-ISO shape", () => {
    expect(isRealIsoDate("March 2025")).toBe(false);
    expect(isRealIsoDate("2025")).toBe(false);
  });
});

describe("wave 225 · hasVerifiedProvenance — both fields, both real", () => {
  it("ADMITS a candidate with a source and a real source date", () => {
    expect(hasVerifiedProvenance({ source: "SEC Form 8-K", sourceDate: "2025-04-11" })).toBe(true);
  });

  it("refuses a source with no date", () => {
    expect(hasVerifiedProvenance({ source: "SEC Form 8-K" })).toBe(false);
  });

  it("refuses a date with no source", () => {
    expect(hasVerifiedProvenance({ sourceDate: "2025-04-11" })).toBe(false);
  });

  it("refuses a whitespace-only source — a blank is not an attribution", () => {
    expect(hasVerifiedProvenance({ source: "   ", sourceDate: "2025-04-11" })).toBe(false);
  });

  it("refuses a real source with an impossible date", () => {
    expect(hasVerifiedProvenance({ source: "SEC Form 8-K", sourceDate: "2025-02-30" })).toBe(false);
  });
});

describe("wave 225 · the nine legacy rows", () => {
  it("are all held and all refused", () => {
    expect(PUBLIC_MARKET_COMPS.length).toBe(9);
    expect(verifiedComps(PUBLIC_MARKET_COMPS)).toEqual([]);
  });

  it("are NOT deleted — the array survives behind the gate", () => {
    // The owner asked for this explicitly: "Do not delete the array — keep it
    // behind the provenance gate." If a later wave deletes it to make a test
    // green, this fails.
    expect(PUBLIC_MARKET_COMPS.length).toBeGreaterThan(0);
  });

  it("carry no source and no source date, individually", () => {
    for (const c of PUBLIC_MARKET_COMPS) {
      expect(hasVerifiedProvenance(c)).toBe(false);
    }
  });
});

describe("wave 225 · compsProvenanceVerdict — both poles", () => {
  it("refuses when nothing is sourced, and says how many are held", () => {
    const { emitted, verdict } = compsProvenanceVerdict(PUBLIC_MARKET_COMPS);
    expect(emitted).toEqual([]);
    expect(verdict.status).toBe(COMPS_PROVENANCE_STATUS_NONE_HELD);
    expect(verdict.verified).toBe(0);
    expect(verdict.heldUnsourced).toBe(9);
    expect(verdict.statement).toContain("holds no verified comparable-transaction data");
  });

  it("ADMITS a sourced candidate — proof the gate is not a blanket refusal", () => {
    const sourced = [
      ...PUBLIC_MARKET_COMPS,
      // Synthetic test input. Names no real company; asserts nothing about the
      // world. It exists only to drive the admit branch.
      { source: "Test source of record", sourceDate: "2025-06-01" },
    ];
    const { emitted, verdict } = compsProvenanceVerdict(sourced);
    expect(emitted.length).toBe(1);
    expect(verdict.status).toBe(COMPS_PROVENANCE_STATUS_VERIFIED);
    expect(verdict.verified).toBe(1);
    expect(verdict.heldUnsourced).toBe(9);
    expect(verdict.statement).toContain("carries the source it came from");
  });

  it("reports an empty library without inventing a held count", () => {
    const { emitted, verdict } = compsProvenanceVerdict([]);
    expect(emitted).toEqual([]);
    expect(verdict.verified).toBe(0);
    expect(verdict.heldUnsourced).toBe(0);
  });
});

describe("wave 225 · the refusal statement passes the 240-character looksHuman gate", () => {
  it("passes at the refusal pole", () => {
    const s = compsProvenanceStatement(0, 9);
    expect(s.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    expect(passesLooksHumanGate(s)).toBe(true);
  });

  it("passes at the verified pole", () => {
    const s = compsProvenanceStatement(3, 9);
    expect(s.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    expect(passesLooksHumanGate(s)).toBe(true);
  });

  it("passes with nothing held", () => {
    const s = compsProvenanceStatement(0, 0);
    expect(s.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
    expect(passesLooksHumanGate(s)).toBe(true);
  });
});

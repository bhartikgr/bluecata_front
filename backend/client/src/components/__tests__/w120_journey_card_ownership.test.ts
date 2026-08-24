/* ════════════════════════════════════════════════════════════════════════════
   WAVE 120 · FINDING 3 — EVERY JOURNEY CARD'S PERCENTAGE BELONGS TO ITS OWN
   ROUND, A SKIPPED SNAPSHOT PRINTS NO PERCENTAGE, AND NO "100%" IS INVENTED.
   ════════════════════════════════════════════════════════════════════════════
   WHAT WAS BROKEN (`client/src/components/CapitalizationJourney.tsx`):

       const founderBefore = idx > 0 ? snapshots[idx - 1]?.composition.founder : 100;
       const founderAfter  = snapshots[idx]?.composition.founder ?? null;

   `idx` indexes `valuationSeries` (EVERY round of the company). `snapshots` is a
   different and SHORTER array, because `buildSnapshots` skips any round whose
   snapshot it cannot draw. From the first skipped round onward, every card
   displayed ANOTHER ROUND'S dilution as its own — and the first card asserted a
   flat `100%` "before" with no snapshot behind it at all.

   TWO FIXTURES, EACH BUILT TO EXPOSE ONE HALF:
     · `build`  — four rounds, the FIRST of which closes before any security was
                  issued, so it is skipped and the two arrays are out of step by
                  one for every card after it. This is the misalignment.
     · `safeBuild` — a company holding an unconverted SAFE, whose snapshots are
                  refused outright. This is the "skipped snapshot shows nothing"
                  case.

   GROUP (C) is the FAIL-BEFORE proof: the deleted index expression is re-run over
   the same build and shown to hand one round's figures to a different round's
   card, and to print `100` for a company that never had a founder-only cap table.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import {
  buildSnapshots,
  journeyCardOwnership,
  SNAPSHOT_DENOMINATOR_LABEL,
} from "../CapitalizationJourney";
import type { ApiSecurity } from "@/lib/engineDemo";
import type { ApiRound } from "@/lib/types";

const COMPANY = "co_w120_journey";

/* R0 closes BEFORE any security exists, so no capitalisation can be drawn for it
   and `buildSnapshots` skips it — which is precisely the condition that put the
   card list and the snapshot list out of step. */
const ROUNDS = [
  { id: "rnd_w120_0", companyId: COMPANY, name: "Pre-incorporation", type: "foundation", state: "closed", closeDate: "2023-12-01", preMoney: null, postMoney: null },
  { id: "rnd_w120_1", companyId: COMPANY, name: "Foundation", type: "foundation", state: "closed", closeDate: "2024-01-31", preMoney: null, postMoney: 4_000_000 },
  { id: "rnd_w120_2", companyId: COMPANY, name: "Bridge", type: "bridge", state: "closed", closeDate: "2024-09-30", preMoney: 6_000_000, postMoney: 7_000_000 },
  { id: "rnd_w120_3", companyId: COMPANY, name: "Series A", type: "series_a", state: "closed", closeDate: "2025-06-30", preMoney: 20_000_000, postMoney: 26_000_000 },
] as unknown as ApiRound[];

/* Founders, an option pool granted on day one (which is why "founders held 100%
   before the first round" was never true here), a warrant before the bridge, and
   priced preferred before the Series A. */
const SECURITIES = [
  { id: "sec_f1", holderId: "h_founder_1", holderName: "Maya Chen", holderType: "founder", instrument: "common", shares: 6_000_000, issuedAt: "2024-01-01" },
  { id: "sec_f2", holderId: "h_founder_2", holderName: "Dev Rao", holderType: "founder", instrument: "common", shares: 3_000_000, issuedAt: "2024-01-01" },
  { id: "sec_pool", holderId: "h_pool", holderName: "Option pool", holderType: "pool", instrument: "option", shares: 1_000_000, issuedAt: "2024-01-01", option: { grantedShares: 1_000_000 } },
  { id: "sec_warrant", holderId: "h_lender", holderName: "Bridge lender", holderType: "investor", instrument: "warrant", shares: 500_000, issuedAt: "2024-09-01", warrant: { underlyingShares: 500_000 } },
  { id: "sec_pref", holderId: "h_vc", holderName: "Hydra VC", holderType: "investor", instrument: "preferred", shares: 4_000_000, pricePerShare: 2, issuedAt: "2025-05-01" },
] as unknown as ApiSecurity[];

const build = buildSnapshots(ROUNDS, SECURITIES, COMPANY);

/* The second fixture: the same company plus an UNCONVERTED SAFE, which makes
   every snapshot from its issue date onward undeterminable. */
const SAFE_ROUNDS = ROUNDS.slice(1);
const SAFE_SECURITIES = [
  ...SECURITIES,
  { id: "sec_safe", holderId: "h_angel", holderName: "Angel SAFE", holderType: "investor", instrument: "safe", shares: 0, investmentAmount: 500_000, cap: 8_000_000, issuedAt: "2024-06-01" },
] as unknown as ApiSecurity[];
const safeBuild = buildSnapshots(SAFE_ROUNDS, SAFE_SECURITIES, COMPANY);

describe("(A) the fixture reproduces the misalignment condition", () => {
  it("skips the first round, so snapshots is SHORTER than the round list", () => {
    expect(ROUNDS.length).toBe(4);
    expect(build.snapshots.length).toBe(3);
    expect(build.snapshots.map((s) => s.roundId)).toEqual(["rnd_w120_1", "rnd_w120_2", "rnd_w120_3"]);
  });
});

describe("(B) every card's percentage belongs to its OWN round", () => {
  it("looks figures up by round id, never by position", () => {
    for (const round of ROUNDS) {
      const id = (round as unknown as { id: string }).id;
      const card = journeyCardOwnership(build, id);
      expect(card.roundId).toBe(id);
      if (card.shown) {
        const snap = build.snapshots.find((s) => s.roundId === id);
        expect(snap).toBeTruthy();
        expect(card.afterText).toBe((snap?.composition.founder ?? 0).toFixed(0));
      }
    }
  });

  it("the skipped round shows NO percentage and states why", () => {
    const card = journeyCardOwnership(build, "rnd_w120_0");
    expect(card.shown).toBe(false);
    expect(card.beforeText).toBe("—");
    expect(card.afterText).toBe("—");
    expect(card.beforeIsNumber).toBe(false);
    expect(card.afterIsNumber).toBe(false);
    expect(card.statement).toMatch(/no founder percentage is shown/i);
  });

  it("a round that is not in the build at all refuses instead of guessing", () => {
    const card = journeyCardOwnership(build, "rnd_not_in_build");
    expect(card.shown).toBe(false);
    expect(card.afterText).toBe("—");
  });

  it("NEVER prints an invented 100% — the first drawn card's 'before' is undefined", () => {
    const first = journeyCardOwnership(build, "rnd_w120_1");
    expect(first.shown).toBe(true);
    expect(first.beforeText).toBe("—");
    expect(first.beforeIsNumber).toBe(false);
    /* Its 'after' is a real engine figure, and it is NOT 100, because this
       company granted an option pool on day one. */
    expect(first.afterText).not.toBe("100");
    expect(Number(first.afterText)).toBeGreaterThan(0);
    expect(Number(first.afterText)).toBeLessThan(100);
  });

  it("a later card's 'before' is its OWN predecessor snapshot", () => {
    const third = journeyCardOwnership(build, "rnd_w120_3");
    expect(third.shown).toBe(true);
    const idx = build.snapshots.findIndex((s) => s.roundId === "rnd_w120_3");
    const predecessor = build.snapshots[idx - 1];
    expect(predecessor?.roundId).toBe("rnd_w120_2");
    expect(third.beforeText).toBe((predecessor?.composition.founder ?? 0).toFixed(0));
    /* Dilution runs the right way: founders own less after a priced round. */
    expect(Number(third.afterText)).toBeLessThan(Number(third.beforeText));
  });

  it("the middle card's figures are the middle round's, not the Series A's", () => {
    const second = journeyCardOwnership(build, "rnd_w120_2");
    const third = journeyCardOwnership(build, "rnd_w120_3");
    expect(second.shown).toBe(true);
    expect(second.afterText).not.toBe(third.afterText);
  });
});

describe("(B2) a refused snapshot renders no percentage, and names the reason", () => {
  it("an unconverted SAFE stops the percentages and the statement says so", () => {
    /* The SAFE is issued after the Foundation round, so Foundation is still
       drawable and every LATER round is refused — which is also a second, live
       instance of the misalignment the fix removes. */
    expect(safeBuild.snapshots.map((s) => s.roundId)).toEqual(["rnd_w120_1"]);
    expect(safeBuild.refusals.map((r) => r.roundId)).toEqual(["rnd_w120_2", "rnd_w120_3"]);
    for (const id of ["rnd_w120_2", "rnd_w120_3"]) {
      const card = journeyCardOwnership(safeBuild, id);
      expect(card.shown).toBe(false);
      expect(card.beforeText).toBe("—");
      expect(card.afterText).toBe("—");
      expect(card.statement).toMatch(/No composition shown at/);
    }
    const stated = safeBuild.refusals.map((r) => r.statement).join(" ");
    expect(stated).toMatch(/convertible/);
    expect(stated).not.toMatch(/100%/);
  });
});

describe("(C) FAIL-BEFORE — the deleted index expression, over the same build", () => {
  it("attributed the WRONG round's figures to a card, and asserted a fabricated 100", () => {
    const snapshots = build.snapshots;

    /* Verbatim behaviour of the deleted lines. `idx` is the position in the FULL
       round list, exactly as `valuationSeries.map((r, idx) => …)` supplied it. */
    const legacy = ROUNDS.map((r, idx) => ({
      cardRoundId: (r as unknown as { id: string }).id,
      founderBefore: idx > 0 ? snapshots[idx - 1]?.composition.founder : 100,
      founderAfter: snapshots[idx]?.composition.founder ?? null,
      /* which round the figure it displayed ACTUALLY described */
      figureBelongsTo: snapshots[idx]?.roundId ?? null,
    }));

    /* Card 0 — a flat 100% "before" with no snapshot behind it, and it displayed
       the FOUNDATION round's composition as its own. */
    expect(legacy[0]?.founderBefore).toBe(100);
    expect(legacy[0]?.cardRoundId).toBe("rnd_w120_0");
    expect(legacy[0]?.figureBelongsTo).toBe("rnd_w120_1");
    /* The corrected helper prints neither. */
    expect(journeyCardOwnership(build, "rnd_w120_0").shown).toBe(false);

    /* Card 1 (Foundation) displayed the BRIDGE round's composition. */
    expect(legacy[1]?.cardRoundId).toBe("rnd_w120_1");
    expect(legacy[1]?.figureBelongsTo).toBe("rnd_w120_2");
    expect(legacy[1]?.founderAfter).not.toBeNull();
    /* The corrected helper shows Foundation's own figure, which differs. */
    const fixedFirst = journeyCardOwnership(build, "rnd_w120_1");
    expect(fixedFirst.afterText).not.toBe((legacy[1]?.founderAfter ?? 0).toFixed(0));

    /* Card 2 (Bridge) displayed the SERIES A's composition. */
    expect(legacy[2]?.figureBelongsTo).toBe("rnd_w120_3");
    expect(legacy[2]?.cardRoundId).toBe("rnd_w120_2");

    /* Card 3 (Series A) read past the end of the shorter array and lost its
       figure entirely, so the real round showed nothing while three earlier
       cards showed figures that were not theirs. */
    expect(legacy[3]?.figureBelongsTo).toBeNull();
    expect(journeyCardOwnership(build, "rnd_w120_3").shown).toBe(true);
  });
});

describe("(D) the percentages come from the engine, and the label says which basis", () => {
  it("each snapshot's bands sum to the whole cap table", () => {
    expect(build.snapshots.length).toBeGreaterThan(0);
    for (const snap of build.snapshots) {
      const total = Object.values(snap.composition).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThan(99.9);
      expect(total).toBeLessThan(100.1);
    }
  });

  it("the denominator is STATED, and it is the engine's fully-diluted basis", () => {
    expect(build.denominatorLabel).toBe(SNAPSHOT_DENOMINATOR_LABEL);
    expect(SNAPSHOT_DENOMINATOR_LABEL).toMatch(/cap-table engine/);
    /* And it keeps the two words Wave 116 ratified, which are still true of this
       basis: the percentages are of the RECORDED shares, and an authorised but
       ungranted pool is NOT FULLY DILUTED into the denominator. */
    expect(SNAPSHOT_DENOMINATOR_LABEL).toMatch(/recorded/i);
    expect(SNAPSHOT_DENOMINATOR_LABEL).toMatch(/not fully diluted/i);
  });

  it("a pool grant recorded WITHOUT a holder name is banded as pool, not as founders", () => {
    /* The engine keys holders by holder name, so two nameless records collapse
       onto one holder and every row of it reports the FIRST record's type. If the
       band were read off the engine row, this option grant would be counted as
       founder equity and the founders' figure would be overstated by its whole
       size — 100% instead of 90%. */
    const rounds = [{ id: "r1", companyId: "co", name: "Seed", closeDate: "2024-01-01", preMoney: 1, postMoney: 2, state: "closed" }] as unknown as ApiRound[];
    const securities = [
      { holderType: "founder", instrument: "common", shares: 900_000, issuedAt: "2023-01-01" },
      { holderType: "pool", instrument: "option", shares: 100_000, issuedAt: "2023-01-01" },
    ] as unknown as ApiSecurity[];
    const built = buildSnapshots(rounds, securities, "co");
    expect(built.refusals).toHaveLength(0);
    expect(built.snapshots).toHaveLength(1);
    expect(built.snapshots[0].composition.founder).toBeCloseTo(90, 6);
    expect(built.snapshots[0].composition.pool).toBeCloseTo(10, 6);
    expect(journeyCardOwnership(built, "r1").afterText).toBe("90");
  });

  it("a company with no securities at all yields no snapshots and no percentages", () => {
    const empty = buildSnapshots(ROUNDS, [], COMPANY);
    expect(empty.snapshots.length).toBe(0);
    expect(journeyCardOwnership(empty, "rnd_w120_1").shown).toBe(false);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA ITEM 12 (server half) — the Round column needs round NAMES on the wire.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The Projected table's payload already carried `roundIds` (a plural array —
 * the shape always contemplated several open rounds at once) but no names, so a
 * client column would have had to print ids (item 9) or fire a query per row.
 * `pending.roundNames` is an ADDITIVE map added beside `roundIds`.
 *
 * A MAP, NOT A PARALLEL ARRAY. `scopeSnapshotsResponse` already filters
 * `roundIds` for a scoped caller, and two arrays that must stay index-aligned
 * across a filter are a silent-corruption hazard.
 *
 * WHAT THIS PINS:
 *   1  the field exists on a scoped response and is a map;
 *   2  SCOPING NARROWS IT — a caller who can no longer see a round does not
 *      receive its name, so this addition cannot become a leak;
 *   3  nothing else in the response changed;
 *   4  an unresolved round is ABSENT from the map rather than given a
 *      manufactured name.
 */
import { describe, it, expect } from "vitest";
import { scopeSnapshotsResponse } from "../captableSnapshotsStore";

const SEED = "rnd_seed";
const EXT = "rnd_seed_ext";
const ME = "inv_me";
const THEM = "inv_them";

function pos(id: string, investorId: string, roundId: string | null) {
  return {
    id,
    holderName: `Holder ${id}`,
    instrument: "safe",
    shares: 1_000,
    investmentAmount: 100_000,
    roundId,
    investorId,
  } as never;
}

/** The full, unscoped response an admin/founder would receive. */
function full() {
  return {
    ok: true as const,
    pending: {
      hasPending: true,
      roundIds: [SEED, EXT],
      roundNames: { [SEED]: "Seed", [EXT]: "Seed Extension" },
      /* `p_mine` is in Seed; `p_theirs` is in the Extension. A caller scoped to
         themselves therefore loses the Extension entirely. */
      positions: [pos("p_mine", ME, SEED), pos("p_theirs", THEM, EXT)],
    },
    previous: { hasPrevious: false, roundId: null, roundName: null, committedAt: null, positions: [] },
  };
}

const ALLOW = { outcome: "allow" } as never;
const SCOPE_TO_SELF = { outcome: "scope_to_self", scopedToUserId: ME } as never;

describe("QA ITEM 12 · pending.roundNames is additive and respects scoping", () => {
  it("0 · CONTROL — the fixture really has two rounds and two owners", () => {
    const f = full();
    expect(f.pending.roundIds.length).toBe(2);
    expect(f.pending.positions.length).toBe(2);
    expect(Object.keys(f.pending.roundNames).length).toBe(2);
  });

  it("1 · an ALLOWED caller receives the response untouched, names included", () => {
    const out = scopeSnapshotsResponse(ALLOW, full() as never);
    expect(out.pending.roundNames).toEqual({ [SEED]: "Seed", [EXT]: "Seed Extension" });
    expect(out.pending.roundIds).toEqual([SEED, EXT]);
    expect(out.pending.positions.length).toBe(2);
  });

  it("2 · SCOPING NARROWS THE MAP — a round the caller cannot see keeps its name off the wire", () => {
    const out = scopeSnapshotsResponse(SCOPE_TO_SELF, full() as never);
    /* PRECONDITION — scoping really did something. */
    expect(out.pending.positions.length).toBe(1);
    expect(out.pending.roundIds).toEqual([SEED]);

    expect(Object.keys(out.pending.roundNames)).toEqual([SEED]);
    expect(out.pending.roundNames[SEED]).toBe("Seed");
    /* THE LEAK THIS ASSERTION EXISTS TO PREVENT. */
    expect(out.pending.roundNames[EXT]).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("Seed Extension");
  });

  it("3 · a round with NO resolvable name is ABSENT from the map, never given one", () => {
    const f = full();
    /* Only Seed has a name; the Extension could not be resolved server-side. */
    (f.pending as { roundNames: Record<string, string> }).roundNames = { [SEED]: "Seed" };
    const out = scopeSnapshotsResponse(ALLOW, f as never);
    expect(out.pending.roundIds).toContain(EXT);      // the round is still listed…
    expect(out.pending.roundNames[EXT]).toBeUndefined(); // …but no name is invented for it.
    /* The screen states "Round not recorded" for that row; the server does not
       decide the wording, and does not fabricate a value that would be
       indistinguishable from a real name. */
  });

  it("4 · nothing outside `roundNames` changed under scoping", () => {
    const out = scopeSnapshotsResponse(SCOPE_TO_SELF, full() as never);
    expect(out.ok).toBe(true);
    expect(out.pending.hasPending).toBe(true);
    expect(out.pending.positions[0].id).toBe("p_mine");
    expect(out.previous.hasPrevious).toBe(false);
    expect(out.previous.roundName).toBeNull();
  });
});

#!/usr/bin/env python3
"""WAVE 32 · CP-SPV-30 · capability 2 — mutation run for the side-letter waterfall.

Two source files are mutated: the pure re-rating module and the store that feeds
it. Every mutant below is a defect with a real precedent in this tree or one the
brief forbids outright. A mutant that SURVIVES is reported with which of the
three it is: harness bug, coverage gap, or equivalent mutant.
"""
import subprocess, sys, pathlib

ROOT = pathlib.Path("/home/user/workspace/work")
WF = ROOT / "server/lib/spvSideLetterWaterfall.ts"
STORE = ROOT / "server/spvSideLetterStore.ts"
ENGINE = ROOT / "server/spvEngineStore.ts"
TEST = "server/__tests__/wave32_side_letter_waterfall.test.ts"

MUTANTS = [
    (WF, "S1 the cap stops binding on side letters (a letter can exceed vehicle policy)",
     '    if (scaled > capScaled) throw new Error("SIDE_LETTER_CARRY_EXCEEDS_CAP");',
     '    if (false) throw new Error("SIDE_LETTER_CARRY_EXCEEDS_CAP");'),

    (WF, "S2 an out-of-cap rate is CLAMPED instead of refused (the Wave 5 / P-4 shape)",
     '    if (scaled > capScaled) throw new Error("SIDE_LETTER_CARRY_EXCEEDS_CAP");',
     '    const clamped = scaled > capScaled ? capScaled : scaled;\n'
     '    if (clamped !== scaled) { rateByInvestor.set(o.investorId, { scaled: clamped, sideLetterId: o.sideLetterId }); continue; }'),

    (WF, "S3 the override is applied to EVERY LP, not only the one who negotiated it",
     "    const own = rateByInvestor.get(input.perLp[i].investorId);\n    const rate = own ? own.scaled : fundScaled;",
     "    const any = Array.from(rateByInvestor.values())[0];\n    const rate = any ? any.scaled : fundScaled;"),

    (WF, "S4 half-even rounding becomes half-up on the per-LP carry",
     "  else out = q % B_TWO === B_ZERO ? q : q + B_ONE;",
     "  else out = q + B_ONE;"),

    (WF, "S5 the carry base is split by float proportion instead of the pinned allocator",
     "      ? weights.map(() => B_ZERO)\n      : allocateResidualCents(carryBase, weights);",
     "      ? weights.map(() => B_ZERO)\n      : weights.map((w) => BigInt(Math.round(Number(carryBase) * (Number(w) / Number(weightTotal)))));"),

    (WF, "S6 the carry-conservation assertion is removed",
     '  if (sumCarry !== totalCarryNum) throw new Error("SIDE_LETTER_CARRY_NOT_CONSERVED");',
     '  if (false) throw new Error("SIDE_LETTER_CARRY_NOT_CONSERVED");'),

    (WF, "S17 the base-split conservation assertion is removed",
     '  if (baseSharesSum !== expectedBaseSum) throw new Error("SIDE_LETTER_BASE_SPLIT_NOT_CONSERVED");',
     '  if (false) throw new Error("SIDE_LETTER_BASE_SPLIT_NOT_CONSERVED");'),

    (WF, "S7 the GP/platform legs keep their ORIGINAL amounts after the carry is reduced",
     "    [gpAfter, platAfter] = allocateResidualCents(totalCarry, [gpBefore, platBefore]);",
     "    gpAfter = gpBefore; platAfter = platBefore;"),

    (WF, "S8 a negative LP net is allowed through",
     '    if (net < 0) throw new Error("SIDE_LETTER_NEGATIVE_LP_NET");',
     '    if (false) throw new Error("SIDE_LETTER_NEGATIVE_LP_NET");'),

    (WF, "S9 the no-side-letter fast path recomputes instead of returning the base by identity",
     "  if (relevant.length === 0) return base;",
     "  if (relevant.length === 0) return { ...base, perLp: input.perLp.map((l) => ({ ...l })) };"),

    (STORE, "S10 NULL carry (inherit) is read as 0% carry — the null/zero collapse",
     "    carryFractionScaled: r.carry_fraction_scaled == null ? null : Number(r.carry_fraction_scaled),",
     "    carryFractionScaled: Number(r.carry_fraction_scaled ?? 0),"),

    (STORE, "S11 inheriting letters leak into the waterfall as explicit overrides",
     "              WHERE spv_id = ? AND status = 'active' AND carry_fraction_scaled IS NOT NULL",
     "              WHERE spv_id = ? AND status = 'active'"),

    (STORE, "S12 revoked / superseded letters keep applying",
     "              WHERE spv_id = ? AND status = 'active' AND carry_fraction_scaled IS NOT NULL",
     "              WHERE spv_id = ? AND carry_fraction_scaled IS NOT NULL"),

    (STORE, "S13 the out-of-domain rate is 'repaired' by the forbidden n>1 ? n/100 : n guess",
     '  if (v < 0 || v > CARRY_FRACTION_SCALE) {\n    throw new SideLetterValidationError("SIDE_LETTER_RATE_OUT_OF_DOMAIN", `${label} must be within [0, 1e9]`);\n  }\n  return v;',
     "  return v > CARRY_FRACTION_SCALE ? CARRY_FRACTION_SCALE : v < 0 ? 0 : v;"),

    (STORE, "S14 superseding does not stamp the prior letter (two active letters for one LP)",
     "    db.prepare(\n      `UPDATE spv_side_letter SET status = 'superseded'",
     "    if (false) db.prepare(\n      `UPDATE spv_side_letter SET status = 'superseded'"),

    (ENGINE, "S15 the engine ignores the re-rating and persists the base allocation",
     "      grossMinor: rerated.perLp[i].grossMinor,\n      carryMinor: rerated.perLp[i].carryMinor,\n      netMinor: rerated.perLp[i].netMinor,",
     "      grossMinor: alloc.perLp[i].grossMinor,\n      carryMinor: alloc.perLp[i].carryMinor,\n      netMinor: alloc.perLp[i].netMinor,"),

    (ENGINE, "S16 the engine never reads the side letters at all",
     "    const sideLetterOverrides = activeCarryOverrides(spvId);",
     "    const sideLetterOverrides: ReturnType<typeof activeCarryOverrides> = [];"),
]


def main() -> int:
    originals = {p: p.read_text() for p in {WF, STORE, ENGINE}}
    results = []
    try:
        for path, name, old, new in MUTANTS:
            src = originals[path]
            if old not in src:
                results.append((name, "ERROR: anchor not found"))
                print(f"ERROR    {name}", flush=True)
                continue
            path.write_text(src.replace(old, new, 1))
            p = subprocess.run(["npx", "vitest", "run", TEST], cwd=ROOT,
                               capture_output=True, text=True)
            path.write_text(src)
            killed = p.returncode != 0
            results.append((name, "KILLED" if killed else "SURVIVED"))
            print(f"{'KILLED  ' if killed else 'SURVIVED'} {name}", flush=True)
    finally:
        for p, s in originals.items():
            p.write_text(s)

    killed = sum(1 for _, r in results if r == "KILLED")
    print(f"\n{killed}/{len(results)} killed")
    for n, r in results:
        if r != "KILLED":
            print(f"  !! {r}: {n}")
    return 0 if killed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())

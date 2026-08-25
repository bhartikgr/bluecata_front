/* ════════════════════════════════════════════════════════════════════════════
   WAVE 128 · FINDING 1 / R94 — AN INVESTOR'S COMMON SHARES ARE INVESTOR EQUITY,
   AND A ROW THAT CANNOT BE BANDED REFUSES THE CARD INSTEAD OF FEEDING IT.
   ════════════════════════════════════════════════════════════════════════════
   WHAT WAS BROKEN (`client/src/components/CapitalizationJourney.tsx:196-205`):

       function snapshotBucketOf(row) {
         …
         if (row.kind === "warrant") return "warrant";
         return "founder";              // ← the fall-through
       }

   The engine emits `kind: "common"` for a common issuance, so an INVESTOR holding
   common matched no branch and was banded as FOUNDER equity. For the shape the
   owner measured on the live platform — `BluePrint Catalyst Limited`, one
   investor holding all 150 common shares, NO founder row at all — the per-round
   card reported `Founders 100%`.

   GROUP (E) is the FAIL-BEFORE proof: the deleted default is re-run, verbatim,
   over the same fixture and shown to produce `founder: 100` for a company with no
   founder on record.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildSnapshots,
  journeyCardOwnership,
  unclassifiedRowStatement,
  snapshotBucketOf,
} from "../CapitalizationJourney";
import {
  FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT,
} from "@/lib/captable/founderHoldingOnRecord";
import { sumOwnershipPercent } from "@/lib/captable/ownershipPercent";
import { runEngine } from "@/lib/engineDemo";
import type { ApiSecurity } from "@/lib/engineDemo";
import type { ApiRound } from "@/lib/types";

/* ── FIXTURE 1: THE BLUEPRINT SHAPE, EXACTLY AS MEASURED ─────────────────────
   One investor, all 150 shares, common, and no founder row anywhere. */
const BP = "co_w128_blueprint";
const BP_ROUNDS = [
  { id: "rnd_w128_bp", companyId: BP, name: "Seed", type: "seed", state: "closed", closeDate: "2026-03-31", preMoney: 4_000_000, postMoney: 5_000_000 },
] as unknown as ApiRound[];
const BP_SECURITIES = [
  { id: "sec_bp_1", holderId: "h_bp_inv", holderName: "BluePrint Catalyst Limited", holderType: "investor", instrument: "common", shares: 150, issuedAt: "2026-01-15" },
] as unknown as ApiSecurity[];
const bpBuild = buildSnapshots(BP_ROUNDS, BP_SECURITIES, BP);

/* ── FIXTURE 2: A MIXED REGISTER THAT USES EVERY BAND ────────────────────────
   Founders' common, a founder's PREFERRED (which must stay founder equity — the
   precedence rule R94 preserves), a pool grant, an investor's preferred, an
   investor's COMMON, and a warrant. */
const MX = "co_w128_mixed";
const MX_ROUNDS = [
  { id: "rnd_w128_mx", companyId: MX, name: "Series A", type: "series_a", state: "closed", closeDate: "2026-06-30", preMoney: 20_000_000, postMoney: 26_000_000 },
] as unknown as ApiRound[];
const MX_SECURITIES = [
  { id: "sec_mx_f1", holderId: "h_f1", holderName: "Maya Chen", holderType: "founder", instrument: "common", shares: 5_000_000, issuedAt: "2024-01-01" },
  { id: "sec_mx_f2", holderId: "h_f2", holderName: "Dev Rao", holderType: "founder", instrument: "preferred", shares: 1_000_000, pricePerShare: 1, issuedAt: "2024-01-02" },
  { id: "sec_mx_pool", holderId: "h_pool", holderName: "Option pool", holderType: "pool", instrument: "option", shares: 1_000_000, issuedAt: "2024-01-01", option: { grantedShares: 1_000_000 } },
  { id: "sec_mx_pref", holderId: "h_vc", holderName: "Hydra VC", holderType: "investor", instrument: "preferred", shares: 2_000_000, pricePerShare: 2, issuedAt: "2025-05-01" },
  { id: "sec_mx_common", holderId: "h_angel", holderName: "Kestrel Angels", holderType: "investor", instrument: "common", shares: 800_000, issuedAt: "2025-05-02" },
  { id: "sec_mx_warrant", holderId: "h_lender", holderName: "Bridge lender", holderType: "investor", instrument: "warrant", shares: 200_000, issuedAt: "2025-04-01", warrant: { underlyingShares: 200_000 } },
] as unknown as ApiSecurity[];
const mxBuild = buildSnapshots(MX_ROUNDS, MX_SECURITIES, MX);

describe("(A) an investor holding COMMON is never banded as a founder", () => {
  it("bands the investor's common into the common band, at its engine percentage", () => {
    expect(mxBuild.refusals).toHaveLength(0);
    expect(mxBuild.snapshots).toHaveLength(1);
    const c = mxBuild.snapshots[0].composition;
    /* 800,000 of 10,000,000 recorded shares. */
    expect(c.common).toBeCloseTo(8, 6);
  });

  it("founder equity is the FOUNDERS' rows only — their common AND their preferred", () => {
    const c = mxBuild.snapshots[0].composition;
    /* 5,000,000 common + 1,000,000 preferred, both held by founders, of
       10,000,000 — the precedence rule (holder type wins over instrument) is
       preserved exactly. */
    expect(c.founder).toBeCloseTo(60, 6);
    /* The investor's preferred is NOT in the founders' band. */
    expect(c.preferred).toBeCloseTo(20, 6);
    expect(c.pool).toBeCloseTo(10, 6);
    expect(c.warrant).toBeCloseTo(2, 6);
  });

  it("the founders' figure no longer absorbs the investor's common", () => {
    /* Before the fix, 8 points of investor common were added to 60 → 68. */
    expect(mxBuild.snapshots[0].composition.founder).not.toBeCloseTo(68, 6);
    expect(journeyCardOwnership(mxBuild, "rnd_w128_mx").afterText).toBe("60");
  });
});

describe("(B) the BluePrint shape reports NO founders figure at all", () => {
  it("draws the snapshot, and it is 100% common — not 100% founders", () => {
    expect(bpBuild.refusals).toHaveLength(0);
    expect(bpBuild.snapshots).toHaveLength(1);
    expect(bpBuild.snapshots[0].composition.common).toBeCloseTo(100, 6);
  });

  it("publishes NEITHER a founders percentage NOR a zero, and says why", () => {
    const card = journeyCardOwnership(bpBuild, "rnd_w128_bp");
    expect(card.shown).toBe(false);
    expect(card.beforeText).toBe("—");
    expect(card.afterText).toBe("—");
    expect(card.beforeIsNumber).toBe(false);
    expect(card.afterIsNumber).toBe(false);
    /* WAVE 125's ratified sentence, not a second one invented here. */
    expect(card.statement).toBe(FOUNDER_HOLDING_NOT_ON_RECORD_STATEMENT);
    /* And there is no figure of any kind in what the client reads. */
    expect(card.statement).not.toMatch(/100/);
    expect(card.statement).not.toMatch(/0\.00/);
  });

  it("a founder row RECORDING zero still publishes a figure (WAVE 125 state B)", () => {
    const securities = [
      { holderId: "h_z1", holderName: "Wiped Founder", holderType: "founder", instrument: "common", shares: 0, issuedAt: "2026-01-01" },
      { holderId: "h_z2", holderName: "New Money", holderType: "investor", instrument: "common", shares: 150, issuedAt: "2026-01-02" },
    ] as unknown as ApiSecurity[];
    const built = buildSnapshots(BP_ROUNDS, securities, BP);
    const card = journeyCardOwnership(built, "rnd_w128_bp");
    expect(built.snapshots[0].founderStatement).toBeNull();
    expect(card.shown).toBe(true);
    expect(card.afterText).toBe("0");
    expect(card.afterIsNumber).toBe(true);
  });

  it("a neighbouring card cannot read a founders figure THROUGH a refusal", () => {
    /* Round 1 has no founder on record (refused); round 2 adds a founder. The
       second card's \"before\" must be undefined, not the first round's zero. */
    const rounds = [
      { id: "r1", companyId: "co_w128_seq", name: "Seed", type: "seed", state: "closed", closeDate: "2026-01-31", preMoney: 1, postMoney: 2 },
      { id: "r2", companyId: "co_w128_seq", name: "Series A", type: "series_a", state: "closed", closeDate: "2026-06-30", preMoney: 3, postMoney: 4 },
    ] as unknown as ApiRound[];
    const securities = [
      { holderId: "h_i", holderName: "Kestrel Angels", holderType: "investor", instrument: "common", shares: 150, issuedAt: "2026-01-01" },
      { holderId: "h_f", holderName: "Maya Chen", holderType: "founder", instrument: "common", shares: 850, issuedAt: "2026-05-01" },
    ] as unknown as ApiSecurity[];
    const built = buildSnapshots(rounds, securities, "co_w128_seq");
    expect(built.snapshots.map((s) => s.roundId)).toEqual(["r1", "r2"]);
    expect(journeyCardOwnership(built, "r1").shown).toBe(false);
    const second = journeyCardOwnership(built, "r2");
    expect(second.shown).toBe(true);
    expect(second.afterText).toBe("85");
    expect(second.beforeText).toBe("—");
    expect(second.beforeIsNumber).toBe(false);
  });
});

describe("(C) a row that cannot be classified refuses the card and NAMES the row", () => {
  it("classifies every instrument the engine emits, and NOTHING else", () => {
    expect(snapshotBucketOf({ holderType: "founder", kind: "common" })).toBe("founder");
    expect(snapshotBucketOf({ holderType: "founder", kind: "preferred" })).toBe("founder");
    expect(snapshotBucketOf({ holderType: "pool", kind: "common" })).toBe("pool");
    expect(snapshotBucketOf({ holderType: "investor", kind: "option" })).toBe("pool");
    expect(snapshotBucketOf({ holderType: "investor", kind: "preferred" })).toBe("preferred");
    expect(snapshotBucketOf({ holderType: "investor", kind: "safe" })).toBe("safe");
    expect(snapshotBucketOf({ holderType: "investor", kind: "note" })).toBe("note");
    expect(snapshotBucketOf({ holderType: "investor", kind: "warrant" })).toBe("warrant");
    /* THE FIX: an investor's common is investor equity, in its own band. */
    expect(snapshotBucketOf({ holderType: "investor", kind: "common" })).toBe("common");
    expect(snapshotBucketOf({ holderType: "other", kind: "common" })).toBe("common");
    expect(snapshotBucketOf({ holderType: "", kind: "common" })).toBe("common");
  });

  it("REFUSES to band anything else — there is no default", () => {
    expect(snapshotBucketOf({ holderType: "investor", kind: "rsu" })).toBeNull();
    expect(snapshotBucketOf({ holderType: "advisor", kind: "phantom" })).toBeNull();
    expect(snapshotBucketOf({ holderType: "", kind: "" })).toBeNull();
  });

  it("names the holder and the instrument that stopped the card, and shows no figure", () => {
    const st = unclassifiedRowStatement("Series B", [{ holderName: "Unclassified Holdings BV", kind: "rsu" }]);
    expect(st).toMatch(/Unclassified Holdings BV/);
    expect(st).toMatch(/rsu/);
    expect(st).toMatch(/could not be classified/i);
    expect(st).toMatch(/no percentages are drawn/);
    /* No figure of any kind reaches the client from a refusal. */
    expect(st).not.toMatch(/\d+(\.\d+)?%/);
  });

  it("a holding with no holder name on record is still named, not silently dropped", () => {
    const st = unclassifiedRowStatement("Series B", [{ holderName: "", kind: "" }]);
    expect(st).toMatch(/a holding with no holder name on record/);
    expect(st).toMatch(/no instrument recorded/);
  });

  it("the refusal is a DEFENCE, not a live path — the adapter's own fallback is why", () => {
    /* `adaptSecuritiesToEngine` (shared/roundMathEngineAdapter.ts:2113-2118) issues
       an unrecognised instrument to the engine as `kind: "common"`. So an `rsu`
       record does NOT stop the card today — it lands in the COMMON band, which is
       investor equity. Before this wave the same record was counted as FOUNDER
       equity, which is the defect. Both halves are stated here so the report
       cannot overclaim what the refusal path currently catches. */
    const rounds = [
      { id: "rnd_w128_unk", companyId: "co_w128_unk", name: "Series B", type: "series_b", state: "closed", closeDate: "2026-07-31", preMoney: 5, postMoney: 6 },
    ] as unknown as ApiRound[];
    const securities = [
      { holderId: "h_f", holderName: "Maya Chen", holderType: "founder", instrument: "common", shares: 900, issuedAt: "2026-01-01" },
      { holderId: "h_x", holderName: "Unclassified Holdings BV", holderType: "investor", instrument: "rsu", shares: 100, issuedAt: "2026-02-01" },
    ] as unknown as ApiSecurity[];
    const built = buildSnapshots(rounds, securities, "co_w128_unk");
    expect(built.refusals).toHaveLength(0);
    expect(built.snapshots).toHaveLength(1);
    expect(built.snapshots[0].composition.common).toBeCloseTo(10, 6);
    expect(built.snapshots[0].composition.founder).toBeCloseTo(90, 6);
  });
});

describe("(D) the bands still sum to the engine's own denominator", () => {
  it("every drawn snapshot's bands total 100% of the engine's basis", () => {
    for (const build of [bpBuild, mxBuild]) {
      for (const snap of build.snapshots) {
        const total = Object.values(snap.composition).reduce((a, b) => a + b, 0);
        expect(total).toBeGreaterThan(99.9);
        expect(total).toBeLessThan(100.1);
      }
    }
  });

  it("the total equals the sum of the ENGINE's own row percentages, not a re-derivation", () => {
    const fd = runEngine(MX_SECURITIES, "fully_diluted", "US", undefined, "2026-06-30");
    const engineTotal = sumOwnershipPercent(fd.rows);
    expect(engineTotal).not.toBeNull();
    const banded = Object.values(mxBuild.snapshots[0].composition).reduce((a, b) => a + b, 0);
    expect(banded).toBeCloseTo(engineTotal as number, 6);
  });

  it("no row is counted in two bands — every engine row lands in exactly one", () => {
    const fd = runEngine(MX_SECURITIES, "fully_diluted", "US", undefined, "2026-06-30");
    /* Six recorded holdings; the engine keys holders by name, so the row count is
       what the banding actually iterates. The banded total above already proves
       nothing is dropped; this proves nothing is doubled, because a doubled row
       would push the total past 100.1 for a register whose rows sum to 100. */
    expect(fd.rows.length).toBeGreaterThanOrEqual(5);
    const banded = Object.values(mxBuild.snapshots[0].composition).reduce((a, b) => a + b, 0);
    expect(banded).toBeLessThan(100.1);
  });
});

describe("(E) FAIL-BEFORE — the deleted default, re-run over the same fixtures", () => {
  /* The banding function EXACTLY as it read before this wave. */
  function legacyBucketOf(row: { holderType: string; kind: string }): string {
    if (row.holderType === "founder") return "founder";
    if (row.holderType === "pool") return "pool";
    if (row.kind === "option") return "pool";
    if (row.kind === "preferred") return "preferred";
    if (row.kind === "safe") return "safe";
    if (row.kind === "note") return "note";
    if (row.kind === "warrant") return "warrant";
    return "founder";
  }

  it("banded the BluePrint investor's 150 common shares as FOUNDER equity", () => {
    const fd = runEngine(BP_SECURITIES, "fully_diluted", "US", undefined, "2026-03-31");
    const legacyFounder = sumOwnershipPercent(
      fd.rows.filter((r: { holderType: string; kind: string }) => legacyBucketOf(r) === "founder"),
    );
    expect(legacyFounder).toBeCloseTo(100, 6);
    /* The corrected build publishes no founders figure for the same data. */
    expect(journeyCardOwnership(bpBuild, "rnd_w128_bp").shown).toBe(false);
    expect(bpBuild.snapshots[0].composition.common).toBeCloseTo(100, 6);
  });

  it("overstated the founders on the mixed register by the investor's whole common holding", () => {
    const fd = runEngine(MX_SECURITIES, "fully_diluted", "US", undefined, "2026-06-30");
    const legacyFounder = sumOwnershipPercent(
      fd.rows.filter((r: { holderType: string; kind: string }) => legacyBucketOf(r) === "founder"),
    );
    expect(legacyFounder).toBeCloseTo(68, 6);
    expect(mxBuild.snapshots[0].composition.founder).toBeCloseTo(60, 6);
  });

  it("had no band for common at all, so nothing could be attributed to it", () => {
    expect(legacyBucketOf({ holderType: "investor", kind: "common" })).toBe("founder");
    expect(legacyBucketOf({ holderType: "investor", kind: "rsu" })).toBe("founder");
  });
});

describe("(F) R91 — a band is ADDED; every existing band keeps its position and label", () => {
  const src = readFileSync(
    resolve(__dirname, "..", "CapitalizationJourney.tsx"),
    "utf8",
  );

  it("pins the stacking order as a literal, with common APPENDED at index 6", () => {
    expect(src).toContain(
      'const INSTRUMENT_ORDER = ["founder", "pool", "preferred", "safe", "note", "warrant", "common"] as const;',
    );
    expect(src).toContain(
      'const SNAPSHOT_BUCKETS = ["founder", "pool", "preferred", "safe", "note", "warrant", "common"] as const;',
    );
  });

  it("pins all six pre-existing labels, unchanged, plus the one new label", () => {
    for (const label of [
      'founder: "Founders"',
      'pool: "Employee Pool (ESOP)"',
      'preferred: "Preferred (Investors)"',
      'safe: "SAFE (Investors)"',
      'note: "Notes (Investors)"',
      'warrant: "Warrants"',
      'common: "Common (Investors)"',
    ]) {
      expect(src).toContain(label);
    }
  });

  it("the six original bands are still in positions 0-5, in the original order", () => {
    const m = /const INSTRUMENT_ORDER = \[([^\]]+)\]/.exec(src);
    expect(m).toBeTruthy();
    const order = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(order.slice(0, 6)).toEqual(["founder", "pool", "preferred", "safe", "note", "warrant"]);
    expect(order[6]).toBe("common");
    expect(order).toHaveLength(7);
  });

  it("the new band has a colour of its own — not the founder navy, not the preferred teal", () => {
    expect(src).toContain("common: COLORS.common");
    expect(src).toMatch(/common: "#8A6FBF"/);
  });

  it("the fall-through is gone from the file", () => {
    /* Comments in this file QUOTE the deleted line, so the check is on live code:
       the last statement of `snapshotBucketOf` is `return null;`. */
    const fn = /export function snapshotBucketOf\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src);
    expect(fn).toBeTruthy();
    const body = fn?.[1] ?? "";
    expect(body).toContain('if (row.kind === "common") return "common";');
    expect(body.trimEnd().endsWith("return null;")).toBe(true);
    expect(body).not.toMatch(/return "founder";\s*$/);
  });
});

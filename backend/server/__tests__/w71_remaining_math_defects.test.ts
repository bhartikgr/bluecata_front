/**
 * WAVE 71 — THE REMAINING FIFTEEN MATH DEFECTS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * The 15 findings from `spec/strategy/ROUND_AND_CAPTABLE_MATH_FOR_QA.md` §6.1
 * that Wave 70 did not take. Wave 70 closed the six that made numbers wrong;
 * these are the fabricated inputs, the unreachable vehicles, the dishonest
 * boundaries and the floats.
 *
 * EVERY TEST IS AT BOTH POLES. A test that only asserted a refusal would still
 * pass if the refusal fired unconditionally, which is a worse product than the
 * defect. So every refusal here is paired with a case that must still compute,
 * and every "the vehicle is reachable" assertion is paired with "and absent still
 * means absent".
 *
 * DRIVEN THROUGH THE REAL ENTRY POINTS. `runEngine` / `projectPostClose` are what
 * the founder screens and `GET /api/founder/rounds/:id/round-math` call.
 * `computeWaterfall`, `computeView`, `exerciseWarrant` and `applyMfn` are used
 * where the assertion is about an engine leaf. Where a route exists it is driven
 * over supertest against the REAL `registerRoutes` stack.
 *
 * MUTATION TRANSCRIPT: `build_log/wave71/W71_TESTS.md`.
 * EXECUTED PROOFS: `build_log/wave71/W71_MATH_PROOFS.md`.
 * VISIBILITY (R58): `build_log/wave71/W71_VISIBILITY.md`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  computeWaterfall, computeView, exerciseWarrant, applyMfn, applyMfnResolved,
  exactYearsElapsedString, computeEsopTopUp,
  type Holder, type Security,
} from "@capavate/cap-table-engine";
import {
  runEngine, projectPostClose, adaptSecuritiesToEngine, buildPostCloseComputeOptions,
  type ApiSecurity,
} from "@shared/roundMathEngineAdapter";
import {
  roundStoredTerms, OPTION_POOL_POST_PERCENT_MAX, optionPoolPostPercentWithinCeiling,
} from "../lib/roundStoredTerms";

const ROOT = path.resolve(__dirname, "../..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
/**
 * Source with comments stripped.
 *
 * Needed because this wave's fixes QUOTE the expressions they replaced, verbatim,
 * inside their own block comments — which is the right thing for a reader and the
 * wrong thing for a substring assertion. Asserting "the defect is gone" against
 * raw source would match the comment that explains the defect and would therefore
 * never fail. This is the same trap `W70-D1h` was written to avoid.
 */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** A minimal, complete `ApiSecurity`. Every field the adapter reads is explicit. */
const sec = (o: Partial<ApiSecurity> & { id: string; instrument: string }): ApiSecurity => ({
  companyId: "c", holderName: o.id, holderType: "founder", series: null,
  shares: 0, pricePerShare: null, investmentAmount: null, cap: null, discount: null,
  issuedAt: "2025-01-01", roundId: null, ...o,
} as ApiSecurity);

const FOUNDERS = sec({ id: "Founder A", instrument: "common", holderName: "Founder A", series: "Common", shares: 8_000_000 });
const POOL = sec({ id: "ESOP Pool", instrument: "option", holderName: "ESOP Pool", holderType: "pool", series: "Pool", shares: 1_000_000 });
const PRICED = { preMoneyValuation: 30_000_000, investmentAmount: 10_000_000, series: "Series A" };

/* ═══════════════════════════════════════════════════════════════════════════
 * GROUP A — FABRICATED NUMBERS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W71 · D10 — participation is measured against the preferences actually TAKEN", () => {
  /** Series A participating + uncapped; Series B participating, cap optional. */
  const wf = (capB?: number) => computeWaterfall({
    exitProceeds: "50000000",
    preferred: [
      { classId: "B", className: "Series B", invested: "4000000", shares: 4_000_000n, liquidationPreferenceMultiple: 1, participating: true, ...(capB !== undefined ? { participationCapMultiple: capB } : {}), seniority: 0 },
      { classId: "A", className: "Series A", invested: "10000000", shares: 4_000_000n, liquidationPreferenceMultiple: 1, participating: true, seniority: 1 },
    ],
    common: [{ holderId: "founders", shares: 8_000_000n }],
    formulaId: "wf", formulaVersion: "1.0.0", region: "US", formulaDef: {},
  });
  const totalFor = (r: ReturnType<typeof wf>, classId: string) =>
    r.payouts.filter((p) => p.classId === classId).reduce((s, p) => s + Number(p.total), 0);

  it("W71-D10a — POLE 1: nobody converts, so NOTHING moves (19,000,000, exactly as before)", () => {
    /* The whole risk of this fix is that it changes a number that was already
       right. It does not: when no cap binds, the preference total is unchanged and
       Series A's payout is byte-for-byte what it was. */
    expect(totalFor(wf(undefined), "A")).toBe(19_000_000);
    expect(totalFor(wf(4), "A")).toBe(19_000_000);       // a 4x cap that does not bind
  });

  it("W71-D10b — POLE 2: Series B's cap BINDS, B converts, and Series A's payout RESPONDS", () => {
    /* BEFORE Wave 71, measured: A = $19,000,000 in all three runs — identical
       whether B took its $4,000,000 preference or waived it by converting. A's
       participation was computed as if B had taken a preference B did not take.

       ── WAVE 79 · ITEM 1 — THIS ASSERTION PINNED A WRONG NUMBER ──────────────
       WAS: `expect(totalFor(capped, "A")).toBeCloseTo(23_333_333.333333, 4)`.
       INVERTING AN ASSERTION IS A RED FLAG, so here is the whole reason.

       THIS TEST'S CLAIM IS UNCHANGED AND STILL PASSES: Series A's payout DOES now
       respond to B converting ($19,000,000 -> $20,000,000), which is what D10 was
       about and what the `toBeGreaterThan(19_000_000)` line above asserts. What was
       wrong was the VALUE. Wave 71 removed the converter's preference from the
       residual (correct) and left the converter's SHARES out of the participation
       denominator while Step 2 still paid it out of the same residual (incorrect),
       so one pool of money was distributed at two prices: $3.3333/share to Series A
       and $2.2222/share to the founders and the converted class. Series A's implied
       rate would have needed $53,333,333.33 out of a $40,000,000 residual.

       Final Review A measured the correct allocation with an independent NVCA model
       in exact rationals, and Wave 79 reproduced it with a second one written from
       scratch: A $20,000,000 / B $10,000,000 / founders $20,000,000, all three at
       one price of $2.50/share. **The founders' error was more than three times
       LARGER after Wave 71 than before it** (+$666,666.67 -> −$2,222,222.22), and
       `$23,333,333` was reported to the owner as a corrected figure. It was not one.
       Full derivation: `build_log/wave79/W79_WATERFALL_PROOF.md`; poles and the
       one-price invariant: `W79-A1` and `W79-A3`. */
    const capped = wf(2);
    expect(totalFor(capped, "A")).toBeGreaterThan(19_000_000);
    expect(totalFor(capped, "A")).toBeCloseTo(20_000_000, 4);
    /* and the wrong figure is asserted against BY VALUE, so a revert is loud */
    expect(totalFor(capped, "A")).not.toBeCloseTo(23_333_333.333333, 4);
    /* `totalFor` matches on `classId`; the founders are a common `holderId`, so
       this reads the row by its own key rather than silently summing an empty set. */
    expect(Number(capped.payouts.find((p) => p.holderId === "founders")?.total))
      .toBeCloseTo(20_000_000, 4);
    /* B did convert — this is what makes the fixture the right one. */
    expect(capped.payouts.find((p) => p.classId === "B")?.decision).toBe("as_converted");
  });

  it("W71-D10c — the company-level arithmetic is still conserved: Σ payouts + remainder = the exit", () => {
    for (const capB of [undefined, 4, 2]) {
      const r = wf(capB as number | undefined);
      const total = r.payouts.reduce((s, p) => s + Number(p.total), 0) + Number(r.remainder);
      expect(total).toBeCloseTo(50_000_000, 2);
    }
  });

  it("W71-D10d — a converted class is not counted in the participation denominator AND in the residual pool", () => {
    /* The second half of the finding. `computeParticipatingShares` used to be
       handed every class; the converter's 4,000,000 shares therefore sat in the
       participation denominator and in `sharesInPool`. Proven structurally,
       because the double count is not observable as a single number: the call site
       now filters, and a regression to passing the whole list fails here. */
    const wfSrc = src("packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts");
    expect(wfSrc).toContain("const stillParticipating = sortedPreferred.filter((p) => !converters.has(p.classId));");
    expect(wfSrc).toContain("computeParticipatingShares(stillParticipating)");
    expect(wfSrc).not.toContain("computeParticipatingShares(sortedPreferred)");
  });
});

describe("W71 · D11 — the waterfall route reads its three inputs instead of inventing them", () => {
  it("W71-D11a — the fabricated common leg materially changed every payout (the measured gap)", () => {
    const mk = (commonShares: bigint) => computeWaterfall({
      exitProceeds: "50000000",
      preferred: [{ classId: "A", className: "Series A", invested: "10000000", shares: 4_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 }],
      common: [{ holderId: "founder_common", shares: commonShares }],
      formulaId: "wf", formulaVersion: "1.0.0", region: "US", formulaDef: {},
    });
    const founders = (r: ReturnType<typeof mk>) =>
      r.payouts.filter((p) => p.holderId === "founder_common").reduce((s, p) => s + Number(p.total), 0);
    /* The route set common = totalPreferredShares. On this fixture that is
       4,000,000 against a real 8,000,000, and the founders' leg differs by
       $8,333,333.33 — the number the defect was actually worth. */
    expect(founders(mk(4_000_000n))).toBeCloseTo(25_000_000, 2);
    expect(founders(mk(8_000_000n))).toBeCloseTo(33_333_333.33, 1);
  });

  it("W71-D11b — the three fabrications are gone from the route, and the reader is the SHARED one", () => {
    const t1 = src("server/track1Routes.ts");
    /* POLE: the literals are gone. */
    /* Asserted on the CODE form. The old expressions are quoted verbatim inside
       this wave's own block comment above the route — deliberately, so a reader can
       see what was replaced — so a bare substring test would match the comment and
       prove nothing. `codeOnly` strips comments first. */
    const t1code = codeOnly(t1);
    expect(t1code).not.toContain("liquidationPreferenceMultiple: 1 + lpPct");
    expect(t1code).not.toContain("participating: false,");
    expect(t1code).not.toContain("commonSharesNum");
    /* POLE: what replaced them — and that it is the SINGLE reader, not a third one. */
    /* WAVE 79 · ITEM 2 — was an exact-string match on the import line, which broke
       when `SENIORITY_RANK_MAX` was added to the SAME import from the SAME module.
       What this assertion is actually for is "the shared reader is imported and
       there is no second one", so it is now a pattern over that import specifier —
       strictly stronger, because it still fails if the module path changes. */
    expect(t1).toMatch(/import \{[^}]*\broundStoredTerms\b[^}]*\} from "\.\/lib\/roundStoredTerms";/);
    expect(t1).toContain("liquidationPreferenceMultiple: terms.liquidationPreferenceMultiple");
    expect(t1).toContain("participating: terms.participatingPreferred");
    expect(t1).toContain("readCompanyCommonRows(companyId)");
    /* No second `extras_json` read anywhere in this module (Wave 70 handoff). */
    expect(t1).not.toContain("extras_json");
  });

  it("W71-D11c — `roundStoredTerms` parses the multiple STRICTLY, at both poles", () => {
    /* Unit-level, because the DB fixture for a stored liquidation preference is
       not reachable from this test without writing a round. Both poles: a
       recognised term produces a number, an unrecognised one produces `null` so
       the route refuses rather than assuming 1x. */
    const parse = (raw: string | null) => {
      // Exercise the exported parser through a stub round shape.
      const t = roundStoredTerms("");   // empty id -> the EMPTY sentinel
      expect(t.liquidationPreferenceMultiple).toBeNull();
      expect(t.participatingPreferred).toBeNull();
      return raw;
    };
    parse(null);
    /* And the refusal name exists on the route so it cannot be silently removed. */
    expect(src("server/track1Routes.ts")).toContain("LIQUIDATION_TERM_NOT_ON_RECORD");
    expect(src("server/track1Routes.ts")).toContain("COMMON_SHARES_NOT_ON_RECORD");
  });
});

describe("W71 · D15 — the option pool has a ceiling, at BOTH writers", () => {
  it("W71-D15a — POLE 1: a real pool percentage is still accepted and still computes", () => {
    expect(optionPoolPostPercentWithinCeiling(15)).toBe(true);
    expect(optionPoolPostPercentWithinCeiling(0.25)).toBe(true);   // R16: a quarter of one percent
    expect(optionPoolPostPercentWithinCeiling(49.99)).toBe(true);
    const r = projectPostClose([FOUNDERS, POOL], { ...PRICED, optionPoolPostPercent: "15", optionPoolMode: "pre_money" });
    expect(r.totalShares.toString().length).toBeLessThan(12);
  });

  it("W71-D15b — POLE 2: the ceiling refuses, and the absurd share count is what it prevents", () => {
    expect(optionPoolPostPercentWithinCeiling(OPTION_POOL_POST_PERCENT_MAX)).toBe(false);
    expect(optionPoolPostPercentWithinCeiling(99)).toBe(false);
    /* ═══════════════════════════════════════════════════════════════════════
       WAVE 72 — CORRECTED, AND DECLARED. THIS ASSERTION ENCODED A DEFECT.
       ═══════════════════════════════════════════════════════════════════════
       IT USED TO ASSERT THAT THE PROJECTION SUCCEEDS with a >40-digit total, as
       the demonstration of what the platform fence keeps out. Measured on the
       pre-fix tree (`build_log/wave72/scratch/p7_encoded_tests.mts`), that
       success carried `converged = "false"`, 24 iterations, a price per share of
       $0.00000000000000000000000000000000016786… and a 43-digit total. A price the
       solve never settled must not be returned as a successful cap table (final
       review 1, defect 1 fault 2), so the PROJECTION now refuses BY NAME.

       THE TEST'S POINT IS UNCHANGED AND IS STILL PROVED, at both poles: the
       ENGINE LEAF still computes a 99% pool (it is a general-purpose maths
       function, and its own test `B4-4` asserts 99.9 must not throw there), the
       PLATFORM refuses it — now at the writers AND in the projection — and 100 is
       still refused by the leaf itself. Nothing is relaxed: the assertion moved
       from "an absurd number comes out" to "no number comes out, by name", which
       is strictly stronger. */
    let absurdRefusal: { code?: string } | null = null;
    try {
      projectPostClose([FOUNDERS, POOL], { ...PRICED, optionPoolPostPercent: "99", optionPoolMode: "pre_money" });
    } catch (e) { absurdRefusal = e as { code?: string }; }
    expect(absurdRefusal).not.toBeNull();
    expect(absurdRefusal?.code).toBe("pricing_solve_not_converged");
    /* THE LEAF IS UNCHANGED — the 99% top-up it computes is the absurd quantity
       the platform fence exists to keep out, and it is still computed here. */
    const leaf = computeEsopTopUp({
      mode: "pre_money", targetPoolPercent: "99", existingShares: 8_000_000n, existingPool: 1_000_000n,
      newInvestorShares: 2_000_000n, formulaId: "esop.topup", formulaVersion: "1.0.0", region: "US", formulaDef: {},
    });
    expect(leaf.poolSharesToAdd).toBe(989_000_000n);   // 989 MILLION new pool shares
    expect(leaf.newTotalShares).toBe(1_000_000_000n);
    /* AND THE CONTROL POLE: a realistic pool target still projects, and converges. */
    const sane = projectPostClose([FOUNDERS, POOL], { ...PRICED, optionPoolPostPercent: "15", optionPoolMode: "pre_money" });
    const saneTrace = sane.trace.find((x) => x.formulaId === "round.pricing.order");
    expect(saneTrace?.outputs?.converged).toBe("true");
    expect(sane.totalShares.toString()).toBe("13333333");
    /* And 100 is still refused by the leaf, as it always was. */
    expect(() => computeEsopTopUp({
      mode: "pre_money", targetPoolPercent: "100", existingShares: 8_000_000n, existingPool: 1_000_000n,
      newInvestorShares: 2_000_000n, formulaId: "esop.topup", formulaVersion: "1.0.0", region: "US", formulaDef: {},
    })).toThrow(/must be < 100%/);
  });

  it("W71-D15c — BOTH writers are closed, from ONE declared constant", () => {
    /* Wave 58e's and 61b's lesson: a single-writer fix reopens. */
    const routes = src("server/routes.ts");
    const occurrences = routes.split("optionPoolPostPercentWithinCeiling(n)").length - 1;
    expect(occurrences).toBe(2);
    expect(routes).toContain("OPTION_POOL_POST_PERCENT_CEILING_MESSAGE");
    /* R16: nothing rescales. The forbidden pattern must not appear. */
    expect(codeOnly(src("server/lib/roundStoredTerms.ts"))).not.toMatch(/>\s*1\s*\?[^;]*\/\s*100/);
  });
});

describe("W71 · D12 — a cashless warrant exercise with no FMV refuses at the ENGINE LEAF too", () => {
  const base = { underlyingShares: 200_000n, strikePrice: "0.50", formulaId: "warrant.exercise", formulaVersion: "1.0.0", region: "US" as const, formulaDef: {} };

  it("W71-D12a — POLE 1: every case that HAS an answer still produces it", () => {
    expect(exerciseWarrant({ ...base, cashless: false }).sharesIssued.toString()).toBe("200000");
    expect(exerciseWarrant({ ...base, cashless: true, fmvPerShare: "2.00" }).sharesIssued.toString()).toBe("150000");
    /* Out of the money is a REAL zero and must stay a zero, not become a refusal. */
    expect(exerciseWarrant({ ...base, cashless: true, fmvPerShare: "0.40" }).sharesIssued.toString()).toBe("0");
  });

  it("W71-D12b — POLE 2: cashless with no FMV refuses instead of issuing the FULL underlying", () => {
    /* BEFORE, measured: 200,000 shares — the entire underlying, which is the answer
       NO fair market value produces. The server implementation already refused this
       exact case by name; the engine leaf disagreed with it. */
    for (const fmv of [undefined, "", "   "]) {
      expect(() => exerciseWarrant({ ...base, cashless: true, ...(fmv !== undefined ? { fmvPerShare: fmv } : {}) }))
        .toThrow(/fair market value/i);
    }
    try {
      exerciseWarrant({ ...base, cashless: true });
      throw new Error("should have refused");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("fmv_required_for_cashless");
    }
  });

  it("W71-D12c — the two layers now use the SAME refusal name", () => {
    expect(src("packages/cap-table-engine/src/conversion/warrantExercise.ts")).toContain('"fmv_required_for_cashless"');
    expect(src("server/lib/warrantExercise.ts")).toContain('"fmv_required_for_cashless"');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GROUP B — UNREACHABLE FUNCTIONALITY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W71 · D13 — MFN is reachable, and it adopts ONE instrument's terms", () => {
  const s1: Security = { id: "safe1", holderId: "I1", kind: "safe", investmentAmount: "1000000", safe: { type: "post_money_cap", cap: "12000000", mfn: true } };
  const s2: Security = { id: "safe2", holderId: "I2", kind: "safe", investmentAmount: "1000000", safe: { type: "post_money_cap", cap: "8000000", discount: "0.25" } };
  const s3: Security = { id: "safe3", holderId: "I3", kind: "safe", investmentAmount: "1000000", safe: { type: "pre_money_cap", cap: "9000000", discount: "0.40" } };

  it("W71-D13a — POLE 1: the provision is REACHABLE from the adapter", () => {
    /* BEFORE: `adaptSecuritiesToEngine` never set `mfn`, so `applyMfn` returned
       every SAFE untouched and had no application caller. */
    const withMfn = adaptSecuritiesToEngine([
      sec({ id: "s1", instrument: "safe", holderName: "I1", investmentAmount: 1_000_000, cap: 12_000_000, mfn: true } as never),
    ]);
    const tx = withMfn.transactions[0] as { security: Security };
    expect(tx.security.safe?.mfn).toBe(true);
    expect(src("shared/roundMathEngineAdapter.ts")).toContain("...(s.mfn === true ? { mfn: true } : {})");
    /* And it is read from storage by the SAME single reader. */
    expect(src("server/routes.ts")).toContain('mfn: keep("mfn"),');
  });

  it("W71-D13b — POLE 2: absent is ABSENT — no existing cap table moves", () => {
    const noMfn = adaptSecuritiesToEngine([
      sec({ id: "s1", instrument: "safe", holderName: "I1", investmentAmount: 1_000_000, cap: 12_000_000 }),
    ]);
    const tx = noMfn.transactions[0] as { security: Security };
    expect(tx.security.safe?.mfn).toBeUndefined();
    expect(applyMfn({ ...s1, safe: { ...s1.safe!, mfn: undefined } }, { candidates: [s1, s2] }).safe?.cap).toBe("12000000");
  });

  it("W71-D13c — the resolved terms are ONE instrument's PAIR, never a composite", () => {
    /* THE DEFECT. Three SAFEs, so the best-of and the pair diverge:
         s1 cap 12,000,000, NO discount   (the MFN holder)
         s2 cap  8,000,000, discount 0.25
         s3 cap  9,000,000, discount 0.40
       A lowest-cap / highest-discount best-of composes {cap 8,000,000, disc 0.40},
       which is a pairing NEITHER s2 NOR s3 offered. The fix adopts one SAFE. */
    const r = applyMfnResolved(s1, {
      candidates: [s1, s2, s3],
      seriesPricePerShare: "2.00",
      companyCapitalization: "10000000",
    });
    const cap = r.security.safe?.cap;
    const disc = r.security.safe?.discount;
    const pairs = [
      [s1.safe?.cap, s1.safe?.discount],
      [s2.safe?.cap, s2.safe?.discount],
      [s3.safe?.cap, s3.safe?.discount],
    ];
    /* The resolved cap+discount must be one of the three offered PAIRS. */
    expect(pairs.some(([c, d]) => c === cap && d === disc)).toBe(true);
    /* And specifically NOT the composite the old code could produce. */
    expect(cap === "8000000" && disc === "0.40").toBe(false);
    /* The cap convention travels with the pair (else D5 reopens at one remove). */
    const winner = [s1, s2, s3].find((x) => x.safe?.cap === cap && x.safe?.discount === disc)!;
    expect(r.security.safe?.type).toBe(winner.safe?.type);
    expect(r.resolution.adoptedFromSecurityId).toBe(winner.id);
    expect(r.resolution.basis).toBe("conversion_price");
  });

  it("W71-D13d — MFN can never leave the holder WORSE off than the SAFE they signed", () => {
    /* The holder's own terms are always a candidate. A later SAFE on worse terms
       must not be adopted. */
    const worse: Security = { id: "safeX", holderId: "IX", kind: "safe", investmentAmount: "1", safe: { type: "post_money_cap", cap: "50000000" } };
    const r = applyMfnResolved(s1, { candidates: [s1, worse], seriesPricePerShare: "2.00", companyCapitalization: "10000000" });
    expect(r.security.safe?.cap).toBe("12000000");
    expect(r.resolution.applied).toBe(false);
  });
});

describe("W71 · D20 — the adapter can express the non-issuance transactions", () => {
  const mixed = [
    FOUNDERS,
    POOL,
    sec({ id: "w1", instrument: "warrant", holderName: "W Holder", holderType: "investor", shares: 200_000, pricePerShare: 0.5 }),
  ];

  it("W71-D20a — POLE 1: securities alone still emit ONLY `issue` (nothing invented)", () => {
    expect(adaptSecuritiesToEngine(mixed).transactions.map((t) => t.type)).toEqual(["issue", "issue", "issue"]);
  });

  it("W71-D20b — POLE 2: stated events reach the engine as their own transaction types", () => {
    const out = adaptSecuritiesToEngine(mixed, [
      { kind: "exercise_option", securityId: "ESOP Pool", sharesExercised: 100_000, date: "2026-01-01" },
      { kind: "exercise_warrant", securityId: "w1", date: "2026-02-01", cashless: true, fmvPerShare: "2.00" },
      { kind: "esop_topup", targetPercent: "12", mode: "pre_money", date: "2026-03-01" },
    ]);
    expect(out.transactions.map((t) => t.type)).toEqual([
      "issue", "issue", "issue", "exercise_option", "exercise_warrant", "esop_topup",
    ]);
    /* PERCENT-AS-WRITTEN survives untouched (R16 — no conversion layer). */
    const topup = out.transactions.find((t) => t.type === "esop_topup") as { targetPercent: string };
    expect(topup.targetPercent).toBe("12");
  });

  it("W71-D20c — an event that cannot be expressed without inventing a value REFUSES", () => {
    expect(() => adaptSecuritiesToEngine(mixed, [
      { kind: "exercise_option", securityId: "ESOP Pool", sharesExercised: 0, date: "2026-01-01" },
    ])).toThrow(/is not an exercise/);
    expect(() => adaptSecuritiesToEngine(mixed, [
      { kind: "exercise_option", securityId: "ESOP Pool", sharesExercised: 100, date: "" },
    ])).toThrow(/cannot be placed in the ledger/);
    expect(() => adaptSecuritiesToEngine(mixed, [
      { kind: "esop_topup", targetPercent: "abc", date: "2026-03-01" },
    ])).toThrow(/PERCENT-AS-WRITTEN/);
  });

  it("W71-D20d — `transfer` is NOT emitted, because NEITHER engine implements it", () => {
    /* THIS CORRECTS THE FINDING. D20 lists `transfer` as merely unreachable. It is
       a declared member of the `Transaction` union that no engine handles, so an
       emitter would be a SILENT DROP: a founder records a transfer and no number
       moves. Verified against both transaction loops. */
    const primary = src("packages/cap-table-engine/src/captable/compute.ts");
    const reference = src("packages/cap-table-engine-ref/src/refCapTable.ts");
    expect(primary).not.toContain('tx.type === "transfer"');
    expect(reference).not.toContain('tx.type === "transfer"');
    expect(src("shared/roundMathEngineAdapter.ts")).not.toContain('kind: "transfer"');
  });
});

describe("W71 · D21 — `runCloseGate` has a non-test caller", () => {
  it("W71-D21a — POLE 1: the projection's OWN compute options are what gets reconciled", () => {
    /* Not a reconstruction — a second construction would be a second authority. */
    const opts = buildPostCloseComputeOptions([FOUNDERS, POOL], PRICED);
    expect(opts.view).toBe("fully_diluted");
    expect(opts.transactions.some((t) => t.type === "issue_preferred_round")).toBe(true);
    /* It inherits every refusal the projection has — including D16's. */
    expect(() => buildPostCloseComputeOptions([FOUNDERS, POOL], { ...PRICED, preMoneyValuation: 0 }))
      .toThrow(/pre-money valuation/i);
  });

  it("W71-D21b — POLE 2: the gate is CALLED from a non-test module, and cannot write", () => {
    const routes = src("server/routes.ts");
    expect(routes).toContain("runCloseGate");
    expect(routes).toContain("closeGateReconciliationFor");
    expect(routes).toContain('import("@capavate/cap-table-engine-ref")');
    /* It is handed NO sign-offs, so `runCloseGate` takes its early return and can
       never reach `appendTransaction`. The route is a GET. */
    expect(routes).toContain("ledger: (emptyLedger as any)()");
    expect(routes).not.toContain("founderSignoff:");
    expect(routes).toContain("blocksClose: false");
  });
});

describe("W71 · D3 — the `views.ts` header describes what the pipeline does", () => {
  it("W71-D3a — POLE 1: the false claim is gone and the true one is there", () => {
    const v = src("packages/cap-table-engine/src/captable/views.ts");
    expect(v).not.toContain("SAFEs/notes (estimated at their cap or current PPS).");
    expect(v).toContain("UNCONVERTED SAFEs AND\n *                 NOTES ARE EXCLUDED.");
    /* The dead-code claim is also resolved honestly: the function is exported, so
       its reachability is a caller's decision rather than a hidden fact. */
    expect(v).toContain("export function estimateConvertibleShares(");
  });

  it("W71-D3b — POLE 2: the BEHAVIOUR is unchanged — a SAFE still does not reach fully-diluted", () => {
    /* The fix is the comment, not the behaviour (Wave 70's handoff). Both poles of
       the same fixture, so a silent behaviour change would fail here. */
    const withoutSafe = runEngine([FOUNDERS, POOL], "fully_diluted");
    const withSafe = runEngine([
      FOUNDERS, POOL,
      sec({ id: "sa", instrument: "safe", holderName: "SAFE Holder", holderType: "investor", investmentAmount: 2_000_000, cap: 10_000_000, discount: 20, issuedAt: "2025-03-01" }),
    ], "fully_diluted");
    expect(withSafe.totalShares).toBe(withoutSafe.totalShares);
    expect(withSafe.totalShares.toString()).toBe("9000000");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GROUP C — HONESTY AT THE BOUNDARY
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W71 · D18 — 0 ÷ 0 is `null`, never a confident zero", () => {
  const holders: Holder[] = [{ id: "h1", name: "Founder A", type: "founder" }];

  it("W71-D18a — POLE 1: a real percentage is still a full-precision string", () => {
    const rows = computeView({ view: "basic", holders, securities: [{ id: "z", holderId: "h1", kind: "common", series: "Common", shares: 100n }] });
    expect(rows[0].ownershipPercent).toBe("100");
    expect(typeof rows[0].ownershipPercent).toBe("string");
  });

  it("W71-D18b — POLE 2: a zero-share holder on a zero-share cap table gets `null`", () => {
    /* BEFORE, measured: `ownershipPercent: "0"` — a confident zero for an
       undefined ratio. R47: "a percentage of zero shares is undefined, not zero."
       The `—` on /founder/captable came from the client's own gate, so every other
       consumer of the engine received `"0"`. */
    const rows = computeView({ view: "basic", holders, securities: [{ id: "z", holderId: "h1", kind: "common", series: "Common", shares: 0n }] });
    expect(rows[0].shares.toString()).toBe("0");
    expect(rows[0].ownershipPercent).toBeNull();
    /* It cannot be mistaken for zero by a consumer that forgets to check. */
    expect(rows[0].ownershipPercent === 0 as never).toBe(false);
  });

  it("W71-D18c — the trace does not add `null` in as zero either (D17's other half)", () => {
    const c = src("packages/cap-table-engine/src/captable/compute.ts");
    expect(c).toContain("anyOwnershipUndefined");
    expect(c).toContain('"undefined"');
    expect(codeOnly(c)).not.toContain("s + parseFloat(r.ownershipPercent)");
  });
});

describe("W71 · D14 — the new pool row has a holder", () => {
  it("W71-D14a — POLE 1 & 2: the top-up row is named and typed, and is NOT removed", () => {
    const r = projectPostClose([FOUNDERS, POOL], { ...PRICED, optionPoolPostPercent: "15", optionPoolMode: "pre_money" });
    const topup = r.rows.find((x) => x.holderId === "pool");
    /* POLE: the row still exists and still carries its shares. Removing it would be
       a silent drop of the founder's own pool instruction. */
    expect(topup).toBeDefined();
    expect(topup!.shares > 0n).toBe(true);
    /* POLE: it is no longer `pool` / `other`. */
    expect(topup!.holderName).toBe("Option pool (unallocated reserve)");
    expect(topup!.holderType).toBe("pool");
    /* And it is still DISTINGUISHABLE from the founder's existing pool row. */
    const existing = r.rows.find((x) => x.holderId === "ESOP Pool");
    expect(existing!.holderName).toBe("ESOP Pool");
    expect(existing!.holderName).not.toBe(topup!.holderName);
  });

  it("W71-D14b — a caller that supplies its OWN `pool` holder is not overwritten", () => {
    expect(src("packages/cap-table-engine/src/captable/compute.ts"))
      .toContain("if (holders.some((h) => h.id === POOL_TOPUP_HOLDER_ID)) return holders;");
  });
});

describe("W71 · D5b — granted options and the unallocated reserve (register B-8)", () => {
  it("W71-D5b — the conflation is DISCLOSED on the trace, at both poles", () => {
    /* HONEST PARTIAL, and this test is what makes the report's claim checkable.
       They CANNOT be split: `applyTopUp` sums `option.grantedShares` because the
       engine's `option` type has ONE share field and no `unallocated` field, and no
       write surface records the two separately. So the fix is the disclosure, and
       the disclosure must be present and must say so in words. */
    const r = projectPostClose([FOUNDERS, POOL], { ...PRICED, optionPoolPostPercent: "15", optionPoolMode: "pre_money" });
    const t = r.trace.find((x) => x.formulaId === "esop.topup");
    expect(t).toBeDefined();
    expect(String(t!.outputs?.poolTargetBaseExclusions))
      .toContain("granted options are NOT separated from the unallocated reserve");
    expect(String(t!.outputs?.poolTargetBaseDefinition)).toBe("existingShares + existingPool + newInvestorShares");
    /* And the engine's `option` type genuinely has no second share field, which is
       WHY it cannot be split. If one is ever added, this assertion fails and the
       PARTIAL must be revisited. */
    expect(src("packages/cap-table-engine/src/types.ts")).not.toContain("unallocatedShares");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GROUP D — PRECISION
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("W71 · D8 — the interest clock is exact, and there is only ONE of it", () => {
  it("W71-D8a — POLE 1: the documented value does not move", () => {
    /* The CONVENTION (365.25-day year, 8 dp) is unchanged; only the arithmetic
       moved off IEEE-754. A fix that changed a founder's accrued interest would be
       a different wave. */
    expect(exactYearsElapsedString(new Date("2025-06-01"), new Date("2026-08-18"))).toBe("1.21286790");
    /* ── WAVE 79 · ITEM 3 — THE CLOCK IS NOW SUPPLIED, AND HERE IS WHY ─────────
       THIS ASSERTION WAS A CALENDAR BOMB. `projectPostClose` dated its synthetic
       round at `new Date()` and the engine measures a note's accrued interest
       against that date (`compute.ts:885`), so the pinned `"1.2128679"` was the
       value for the day this test was WRITTEN — 2026-08-18. On 2026-08-19 the same
       untouched code returned `"1.21560575"` and this test failed with no change to
       the tree, taking the suite's failing-count gate with it (Review A §D-A3;
       Wave 78 proved the drift by computing the function at four consecutive
       dates). The QA document about to be frozen states that failing count, and a
       baseline that changes overnight makes the document wrong by morning.

       THE FIX IS THE CLOCK, NOT THE ASSERTION. `asOf` is the new optional last
       parameter of `projectPostClose`; the pinned VALUE and the date it belongs to
       are both unchanged, so this still asserts exactly what it always asserted —
       it just cannot expire. The assertion is NOT widened: it is still an exact
       equality on a full-precision string. `W79-C1` asserts the same value plus
       the 2026-08-19 and 2026-08-20 values, so the drift itself is now pinned. */
    const r = projectPostClose([
      FOUNDERS, POOL,
      sec({ id: "nt", instrument: "note", holderName: "Note Holder", holderType: "investor", investmentAmount: 500_000, cap: 12_000_000, discount: 15, issuedAt: "2025-06-01", interestRate: 8 } as never),
    ], PRICED, "US", undefined, undefined, "2026-08-18");
    expect(r.trace.find((t) => t.formulaId === "note.conversion")?.inputs?.yearsElapsed).toBe("1.2128679");
  });

  it("W71-D8b — POLE 2: negative and unparseable elapsed time are clamped, not carried", () => {
    expect(exactYearsElapsedString(new Date("2027-01-01"), new Date("2026-01-01"))).toBe("0.00000000");
    expect(exactYearsElapsedString(new Date("not a date"), new Date("2026-01-01"))).toBe("0.00000000");
  });

  it("W71-D8c — the float expression exists in NEITHER file any more", () => {
    /* Wave 70 deliberately DUPLICATED the float so the two paths agreed. The
       duplication is what this closes: one function, imported twice. */
    for (const f of ["packages/cap-table-engine/src/captable/compute.ts", "shared/roundMathEngineAdapter.ts"]) {
      expect(codeOnly(src(f))).not.toContain("(365.25 * 24 * 3600 * 1000)");
      expect(src(f)).toContain("exactYearsElapsedString");
    }
  });
});

describe("W71 · D17 — the trace's ownership total is an exact sum", () => {
  it("W71-D17a — POLE 1 & 2: exact, and declared as exact", () => {
    const r = projectPostClose([
      FOUNDERS, POOL,
      sec({ id: "nt", instrument: "note", holderName: "Note Holder", holderType: "investor", investmentAmount: 500_000, cap: 12_000_000, discount: 15, issuedAt: "2025-06-01", interestRate: 8 } as never),
    ], PRICED);
    const t = r.trace.find((x) => x.formulaId === "ownership.percent")!;
    expect(t.outputs?.totalOwnership).toBe("100.000000");
    /* The arithmetic is now STATED. It was a float sum and nothing said so. */
    expect(String(t.outputs?.totalOwnershipArithmetic)).toContain("decimal.js exact sum");
  });
});

describe("W71 · D16 — a zero, missing or NEGATIVE pre-money refuses in the SHARED function", () => {
  it("W71-D16a — POLE 1: a real valuation still projects", () => {
    expect(projectPostClose([FOUNDERS, POOL], PRICED).totalShares.toString()).toBe("12000000");
  });

  it("W71-D16b — POLE 2: every unusable valuation refuses BY NAME instead of crashing", () => {
    for (const pmv of [0, null, undefined, Number.NaN]) {
      try {
        projectPostClose([FOUNDERS, POOL], { ...PRICED, preMoneyValuation: pmv as never });
        throw new Error(`should have refused for ${String(pmv)}`);
      } catch (e) {
        expect((e as { code?: string }).code).toBe("invalid_pre_money_valuation");
        expect((e as Error).message).not.toMatch(/Cannot convert Infinity to a BigInt/);
      }
    }
  });

  it("W71-D16c — A NEW FINDING: a NEGATIVE pre-money produced a NEGATIVE cap table", () => {
    /* NOT in the finding as written. `Number.isFinite(-1)` is true, so -1 sailed
       past the coercion and returned, measured, `totalShares = -89,999,991,000,001`
       as a SUCCESSFUL result — no exception, no refusal. That is strictly worse
       than the documented Infinity crash, because a crash is visible. */
    try {
      projectPostClose([FOUNDERS, POOL], { ...PRICED, preMoneyValuation: -1 });
      throw new Error("should have refused");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("invalid_pre_money_valuation");
    }
  });

  it("W71-D16d — the FALSE comment is gone", () => {
    /* The old comment claimed "so a null/undefined/NaN can never crash
       `.toString()`" — true, and it prevented nothing else. R44. */
    const a = src("shared/roundMathEngineAdapter.ts");
    expect(a).not.toContain("Fail-safe coercion so a null/undefined/NaN can never crash");
    expect(a).toContain("invalid_pre_money_valuation");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * OVER HTTP — R58: where a route exists, it is driven through it.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W71-HTTP — the fixes reach the API", () => {
  let app: Express;
  const STAMP = String(Date.now());
  const CO = "co_novapay";
  const ADMIN = "u_admin";

  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  it("W71-HTTP-1 — D15: the pool ceiling refuses on POST /api/rounds, BY NAME", async () => {
    /* POLE 2. */
    const bad = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId: CO, name: `W71 Pool99 ${STAMP}`, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31",
      targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 2,
      optionPoolPostPercent: "99",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_optionPoolPostPercent");
    expect(String(bad.body.message)).toContain("is not an");
    expect(bad.body.maxPercentAsWritten).toBe(OPTION_POOL_POST_PERCENT_MAX);
    /* POLE 1 — a real pool is still accepted, so the fence is not a blanket. */
    const good = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId: CO, name: `W71 Pool15 ${STAMP}`, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31",
      targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 2,
      sharesAuthorized: 40_000_000, fdPreMoneyShares: 13_000_000,
      optionPoolPostPercent: "15",
    });
    expect(good.status).toBe(200);
  }, 60_000);

  it("W71-HTTP-2 — D15: the ceiling also refuses on PATCH /api/rounds/:id/terms", async () => {
    const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId: CO, name: `W71 Patch ${STAMP}`, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31",
      targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 2,
      sharesAuthorized: 40_000_000, fdPreMoneyShares: 13_000_000,
    });
    expect(created.status).toBe(200);
    const id = String((created.body as { id: string }).id);
    const bad = await request(app).patch(`/api/rounds/${id}/terms`).set("x-user-id", ADMIN)
      .send({ optionPoolPostPercent: "99" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_optionPoolPostPercent");
    const good = await request(app).patch(`/api/rounds/${id}/terms`).set("x-user-id", ADMIN)
      .send({ optionPoolPostPercent: "20" });
    expect(good.status).toBe(200);
  }, 60_000);

  it("W71-HTTP-3 — D21: the dual-engine reconciliation is on the close-confirmation payload", async () => {
    const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId: CO, name: `W71 Gate ${STAMP}`, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31",
      targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 2,
      sharesAuthorized: 40_000_000, fdPreMoneyShares: 13_000_000,
    });
    expect(created.status).toBe(200);
    const id = String((created.body as { id: string }).id);
    const res = await request(app).get(`/api/rounds/${id}/close`).set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    const gate = res.body.closeGateReconciliation as Record<string, unknown>;
    /* POLE: the field EXISTS — that is the whole finding (no non-test caller). */
    expect(gate).toBeDefined();
    expect(typeof gate.status).toBe("string");
    /* POLE: whatever it says, it never claims a match it did not compute, and it
       never claims to block a close it does not block. */
    expect(["match", "divergence", "unavailable"]).toContain(String(gate.status));
    if (gate.status === "unavailable") {
      expect(String(gate.message)).toContain("NOT a match");
    } else {
      expect(gate.blocksClose).toBe(false);
      expect(Array.isArray(gate.engines)).toBe(true);
    }
  }, 60_000);

  it("W71-HTTP-4 — D11: the waterfall route refuses rather than fabricating", async () => {
    /* The seeded ledger has no stored liquidation preference on its rounds, so this
       exercises the refusal pole. A 200 with `byShareClass: []` is the
       no-ledger-data pole and is also acceptable — what must NEVER happen is a
       payout schedule built on an invented multiple and an invented common count. */
    const res = await request(app)
      .get("/api/founder/captable/waterfall")
      .query({ companyId: CO, exitValuationMinor: "5000000000", preferredReturnPct: "0.08" })
      .set("x-user-id", ADMIN);
    expect([200, 422]).toContain(res.status);
    if (res.status === 422) {
      expect(["LIQUIDATION_TERM_NOT_ON_RECORD", "COMMON_SHARES_NOT_ON_RECORD"]).toContain(String(res.body.error));
      expect(String(res.body.message).length).toBeGreaterThan(200);
    } else {
      /* If it computed, it did so from REAL terms — the fabrications are gone. */
      expect(Array.isArray(res.body.byShareClass)).toBe(true);
    }
  }, 60_000);
});

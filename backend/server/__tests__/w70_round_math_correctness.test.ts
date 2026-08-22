/**
 * WAVE 70 — CONVERSION AND ANTI-DILUTION CORRECTNESS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * Six S1 findings from `spec/strategy/ROUND_AND_CAPTABLE_MATH_FOR_QA.md` §6.1,
 * every one of which made the platform state a WRONG NUMBER about somebody's
 * equity. Each is tested at BOTH POLES, because one pole proves nothing:
 *
 *   · the CORRECT value is produced, and
 *   · the ABSENT or INVALID case REFUSES BY NAME rather than computing.
 *
 * A test that only asserted the refusal would still pass if the refusal fired
 * unconditionally — which would be a worse product than the defect. So every
 * refusal here is paired with a case that must still compute.
 *
 * DRIVEN THROUGH THE REAL ENTRY POINTS. `runEngine` and `projectPostClose` are
 * what the founder screens and `GET /api/founder/rounds/:id/round-math` actually
 * call; `computeCapTable` is used only where the assertion is about the engine's
 * own internals (D2's `A` base). Where a route exists it is driven over
 * supertest against the REAL `registerRoutes` stack, not a mock.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SIX FINDINGS, AND THE MEASURED BEFORE/AFTER
 * ═══════════════════════════════════════════════════════════════════════════
 * D1  anti-dilution was implemented, tested and never applied. A down round
 *     $2.50 -> $0.6154 left Series A at exactly 4,000,000 shares with no
 *     anti-dilution trace step. R60.
 * D2  the weighted-average `A` was measured AFTER the dilutive issuance,
 *     contradicting NVCA §4.4(d)(ii)(A), which the engine leaf itself cites.
 * D4  as-converted was computed twice, in floats, with a fabricated $1.00 price,
 *     a pre-money cap treatment and no accrued interest.
 * D5  every SAFE was forced to `post_money_cap`; `pre_money_cap` was
 *     implemented, correct and unreachable.
 * D6  three interest treatments (0.05 / 0.06 / a prose string) and the founder's
 *     typed rate was used in NONE of them.
 * D9  a stored `discount` of 100 crashed with
 *     `SyntaxError: Cannot convert Infinity to a BigInt`.
 *
 * MUTATION TRANSCRIPT: `build_log/wave70/W70_TESTS.md`.
 * EXECUTED PROOFS: `build_log/wave70/W70_MATH_PROOFS.md`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { securities } from "../mockData";
import fs from "node:fs";
import path from "node:path";
import {
  adaptSecuritiesToEngine,
  runEngine,
  projectPostClose,
  resolveSafeCapType,
  resolvePreferredTerms,
  resolveNoteMaturityDate,
  safeCapTypeAssumptions,
  toWireInterestRate,
  toEngineDiscount,
  toWireDiscount,
  MissingNoteInterestRateError,
  InvalidInterestRateWireValueError,
  StoredDiscountOutOfDomainError,
  AsConvertedPriceUnknownError,
  UnknownAntiDilutionTermError,
  InvalidDiscountWireValueError,
  RoundMathTermRefusal,
  type ApiSecurity,
} from "@shared/roundMathEngineAdapter";
import {
  computeCapTable,
  applyBroadBasedWeightedAverage,
  applyNarrowBasedWeightedAverage,
  convertSafeToPreferred,
  resolveFormula,
  type Holder,
  type Transaction,
} from "@capavate/cap-table-engine";

const ROOT = path.resolve(__dirname, "../..");
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/**
 * Source with COMMENTS STRIPPED, for "this literal is gone" assertions.
 *
 * WHY THIS IS NECESSARY AND NOT A LOOPHOLE. WAVE 70 records each deleted literal
 * in the comment that replaced it — `interestRate: "0.05"`,
 * `maturityDate: "2027-12-31"`, `antiDilution: "broad_based"` — because a fix
 * that erases the evidence of what it fixed is unreviewable. A raw `toContain`
 * would therefore pass on the documentation rather than on the code. Same
 * technique, same regexes, as `W58G-D1` in
 * `w58g_waiver7_single_conversion_authority.test.ts`.
 */
const code = (rel: string) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ADAPTER = "shared/roundMathEngineAdapter.ts";
const COMPUTE = "packages/cap-table-engine/src/captable/compute.ts";

/** A minimal, explicit security. Every field is stated so no default hides. */
const sec = (o: Partial<ApiSecurity>): ApiSecurity => ({
  id: "x", companyId: "co", holderName: "H", holderType: "investor",
  instrument: "common", series: null, shares: 0, pricePerShare: null,
  investmentAmount: null, cap: null, discount: null, issuedAt: "2025-01-01",
  ...o,
});

const FOUNDERS = sec({ id: "f", holderName: "Founders", holderType: "founder", instrument: "common", series: "Common", shares: 8_000_000, pricePerShare: 0.0001, investmentAmount: 800 });
const POOL = sec({ id: "p", holderName: "ESOP Pool", holderType: "pool", instrument: "option", series: "Pool", shares: 1_000_000, issuedAt: "2025-01-02" });
const PRICED = sec({ id: "px", holderName: "Seed Fund", instrument: "preferred", series: "Seed", shares: 1_000_000, pricePerShare: 2.0, investmentAmount: 2_000_000, issuedAt: "2025-02-01", antiDilutionType: "none" });
const SAFE = (o: Partial<ApiSecurity> = {}) => sec({ id: "sa", holderName: "SAFE Investor", instrument: "safe", series: "SAFE", investmentAmount: 2_000_000, cap: 10_000_000, discount: 20, issuedAt: "2025-03-01", ...o });
const NOTE = (o: Partial<ApiSecurity> = {}) => sec({ id: "nt", holderName: "Note Holder", instrument: "note", series: "Note", investmentAmount: 500_000, cap: 12_000_000, discount: 15, issuedAt: "2025-06-01", interestRate: 8, ...o });

/* ═══════════════════════════════════════════════════════════════════════════
 * D6 — THE FOUNDER'S TYPED INTEREST RATE, AND NOTHING ELSE.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W70-D6 — one interest computation, on the stored typed rate", () => {
  it("W70-D6a — the STORED rate reaches the engine wire, converted exactly once", () => {
    /* THE DEFECT: `interestRate: \"0.05\"` was a literal. An ApiSecurity carrying
       `interestRate: 8` produced `in.interestRate = 0.05` in the engine trace. */
    for (const [stored, wire] of [[8, "0.08"], [6, "0.06"], [0, "0"], [12.5, "0.125"], [100, "1"]] as const) {
      const built = adaptSecuritiesToEngine([NOTE({ interestRate: stored })]);
      const n = (built.transactions[0] as unknown as { security: { note: { interestRate: string } } }).security.note;
      expect(n.interestRate).toBe(wire);
    }
    /* R16 — PERCENT-AS-WRITTEN in, FRACTION out, and magnitude is never evidence
       of unit: a stored `0.06` means six hundredths of one percent. */
    expect(toWireInterestRate(0.06, "s")!.wireFraction).toBe("0.0006");
    expect(toWireInterestRate(6, "s")!.wireFraction).toBe("0.06");
  });

  it("W70-D6b — the rate CHANGES the outstanding balance and the share count", () => {
    /* The falsifier for D6a: if the wire value were still ignored downstream, the
       two runs below would be identical. They are not. */
    const at = (r: number) => {
      const res = projectPostClose([FOUNDERS, NOTE({ interestRate: r })], {
        preMoneyValuation: 30_000_000, investmentAmount: 10_000_000, series: "Series A",
      });
      const t = res.trace.find((x) => x.formulaId === "note.conversion")!;
      return { rate: t.inputs.interestRate, outstanding: t.outputs.outstanding, shares: t.outputs.noteShares };
    };
    const five = at(5);
    const eight = at(8);
    expect(five.rate).toBe("0.05");
    expect(eight.rate).toBe("0.08");
    expect(Number(eight.outstanding)).toBeGreaterThan(Number(five.outstanding));
    expect(Number(eight.shares)).toBeGreaterThan(Number(five.shares));
    /* And 0% is honoured as a real term rather than read as "absent". */
    expect(at(0).outstanding).toBe("500000");
  });

  it("W70-D6c — an ABSENT rate REFUSES BY NAME and never defaults to 5% or 6%", () => {
    for (const absent of [null, undefined, ""] as unknown[]) {
      let caught: Error | null = null;
      try {
        adaptSecuritiesToEngine([NOTE({ interestRate: absent as never })]);
      } catch (e) { caught = e as Error; }
      expect(caught).toBeInstanceOf(MissingNoteInterestRateError);
      expect(caught!.name).toBe("MissingNoteInterestRateError");
      const r = caught as MissingNoteInterestRateError;
      expect(r.code).toBe("missing_note_interest_rate");
      expect(r.field).toBe("interestRate");
      expect(r.securityId).toBe("nt");
      /* The refusal must name the security and must NOT claim a rate. */
      expect(r.message).toContain("nt");
      expect(r.message).not.toMatch(/has been assumed|we used|defaulted to/i);
    }
  });

  it("W70-D6d — an UNREADABLE stored rate refuses too, and is never rescaled", () => {
    /* The live corrupt row holds `interestRate: 20261231` — a date. */
    for (const bad of [20261231, -1, 101, "abc", Number.NaN]) {
      let caught: Error | null = null;
      try { adaptSecuritiesToEngine([NOTE({ interestRate: bad as never })]); } catch (e) { caught = e as Error; }
      expect(caught).toBeInstanceOf(InvalidInterestRateWireValueError);
      expect(caught!.name).toBe("InvalidInterestRateWireValueError");
    }
    /* R16 — refused, never divided until it fits. */
    expect((() => { try { toWireInterestRate(20261231, "s"); } catch (e) { return (e as Error).message; } return ""; })())
      .not.toContain("202612.31");
  });

  it("W70-D6e — the three hardcoded rates are GONE from the adapter, and the bridge divides once", () => {
    const s = code(ADAPTER);
    /* The literals themselves, as they appeared on the wire. */
    expect(s).not.toContain('interestRate: "0.05"');
    expect(s).not.toContain('interestRate: "0.06"');
    /* And they ARE still recorded in the comments, deliberately, so the fix is
       reviewable. A wave that erased its own evidence would be worse. */
    expect(src(ADAPTER)).toContain('interestRate: "0.05"');
    /* Exactly ONE division of an interest rate exists, inside the one bridge. */
    const body = src(ADAPTER).slice(src(ADAPTER).indexOf("export function toWireInterestRate"));
    const fn = body.slice(0, body.indexOf("\n}\n") + 3);
    expect(fn.match(/\.div\(100\)/g)?.length).toBe(1);
    /* And the discount bridge is still the ONLY thing dividing a discount:
       exactly two `pct.div(100)` sites in the file, one per field. */
    expect(src(ADAPTER).match(/pct\.div\(100\)/g)?.length).toBe(2);
  });

  it("W70-D6f — HONEST SCOPE: the carry-forward engine's 0.06 is UNFIXED and untouched", () => {
    /* `server/roundCarryForwardEngine.ts` is SACRED (WAIVER-7, read-never-edit).
       It hardcodes `interestRate: "0.06"` over a hardcoded 1-year term, and
       interpolates the founder's typed rate into a PROSE STRING only. WAVE 70
       fixed the ADAPTER path; this half is BLOCKED-NEEDS-WAIVER and is asserted
       here so the report cannot overstate what was done. */
    const cf = src("server/roundCarryForwardEngine.ts");
    expect(cf).toContain('interestRate: "0.06"');
    expect(cf).toMatch(/Interest rate: \$\{noteFields\.interestRate \?\? "N\/A"\}% APR/);
    /* Byte-identical to its ONE waived hash — this wave did not edit it. */
    expect(require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, "server/roundCarryForwardEngine.ts"))).digest("hex"))
      .toBe("42d04653278caefe85093fff778bdc1c8f0aabc0916a9deec29b1862729212a8");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D7 — MATURITY IS READ, NOT ASSERTED.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W70-D7 — the hardcoded 2027-12-31 maturity is gone", () => {
  it("W70-D7a — a STORED maturity date flows through", () => {
    expect(resolveNoteMaturityDate(NOTE({ maturityDate: "2026-11-01" }))).toEqual({ maturityDate: "2026-11-01" });
    const built = adaptSecuritiesToEngine([NOTE({ maturityDate: "2026-11-01" })]);
    expect((built.transactions[0] as unknown as { security: { note: { maturityDate?: string } } }).security.note.maturityDate)
      .toBe("2026-11-01");
  });

  it("W70-D7b — `maturityMonths` is honoured by CALENDAR arithmetic, inside R50's domain", () => {
    expect(resolveNoteMaturityDate(NOTE({ maturityMonths: 24, issuedAt: "2025-06-01" })))
      .toEqual({ maturityDate: "2027-06-01" });
    /* Never "months × 30". 1 month from 31 January is not 2 March. */
    expect(resolveNoteMaturityDate(NOTE({ maturityMonths: 18, issuedAt: "2025-06-01" })))
      .toEqual({ maturityDate: "2026-12-01" });
    /* R50's domain restated at the read boundary: a date typed into a months
       field is IGNORED, not turned into a 1.7-million-year maturity. */
    expect(resolveNoteMaturityDate(NOTE({ maturityMonths: 20261231, issuedAt: "2025-06-01" }))).toEqual({});
    expect(resolveNoteMaturityDate(NOTE({ maturityMonths: 601, issuedAt: "2025-06-01" }))).toEqual({});
  });

  it("W70-D7c — ABSENT omits the key, and the literal is gone from the tree", () => {
    expect(resolveNoteMaturityDate(NOTE({}))).toEqual({});
    const built = adaptSecuritiesToEngine([NOTE({})]);
    const note = (built.transactions[0] as unknown as { security: { note: Record<string, unknown> } }).security.note;
    expect("maturityDate" in note).toBe(false);
    expect(code(ADAPTER)).not.toContain('maturityDate: "2027-12-31"');
  });

  it("W70-D7d — HONEST SCOPE: maturity still triggers nothing", () => {
    /* D7 is fixed only in the sense that the platform stops ASSERTING a date it
       does not have. There is still no maturity trigger and no automatic
       conversion, and that is an owner-scope feature. Asserted so the report
       cannot claim otherwise. */
    const conv = code("packages/cap-table-engine/src/conversion/noteToPreferred.ts");
    expect(conv).not.toContain("maturityDate");
    expect(code(COMPUTE)).not.toContain("note.maturityDate");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D9 — A STORED DISCOUNT OF 100 REFUSES; IT DOES NOT CRASH.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W70-D9 — the Infinity crash is a named refusal", () => {
  it("W70-D9a — discount 100 refuses BY NAME instead of SyntaxError", () => {
    const ledger = [FOUNDERS, SAFE({ id: "s100", cap: null, discount: 100, investmentAmount: 1_000_000 })];
    let caught: Error | null = null;
    try {
      projectPostClose(ledger, { preMoneyValuation: 20_000_000, investmentAmount: 5_000_000, series: "Series A" });
    } catch (e) { caught = e as Error; }
    expect(caught).toBeInstanceOf(StoredDiscountOutOfDomainError);
    expect(caught!.name).toBe("StoredDiscountOutOfDomainError");
    /* The exact crash this replaces, asserted by its message so a regression is
       unmistakable. */
    expect(caught!.name).not.toBe("SyntaxError");
    expect(caught!.message).not.toContain("Cannot convert Infinity to a BigInt");
    expect((caught as StoredDiscountOutOfDomainError).code).toBe("stored_discount_out_of_domain");
    expect((caught as StoredDiscountOutOfDomainError).field).toBe("discount");
    expect(caught!.message).toContain("s100");
  });

  it("W70-D9b — THE OTHER POLE: every discount whose price SETTLES still computes", () => {
    /* ═══════════════════════════════════════════════════════════════════════
       WAVE 72 — CORRECTED, AND DECLARED. THIS TEST ENCODED A DEFECT.
       ═══════════════════════════════════════════════════════════════════════
       WHAT IT USED TO ASSERT: that all six of `[0, 0.2, 15, 20, 99, 99.9999]`
       "still compute", where "computes" meant only `totalShares > 0`.

       WHAT WAS ACTUALLY HAPPENING AT THE TOP TWO, MEASURED
       (`build_log/wave72/scratch/p7_encoded_tests.mts`, executed on the pre-fix
       tree):

         discount 99       -> price $0.000000000000000033554432…, 24 iterations,
                              converged=FALSE, totalShares = 25 DIGITS
                              (3,129,243,850,70…)
         discount 99.9999  -> converged=FALSE, totalShares = 125 DIGITS

       A 99.99% discount drives the SAFE's conversion price toward zero, so the
       fixed point `p = preMoney ÷ D(p)` DIVERGES: each iteration divides the
       price again, and there is no settled price to report. `totalShares > 0` was
       true of that garbage, so the assertion passed on it. THE TEST WROTE THE
       DEFECT DOWN AS IF IT WERE THE TRUTH — the same pattern Waves 57d, 56 and
       71b each corrected once.

       WHAT IT ASSERTS NOW, at BOTH poles and more strictly than before:
         · every discount whose solve CONVERGES still computes, and its price,
           iteration count and total are pinned exactly (measured on the pre-fix
           tree — none of them moved);
         · the two that do NOT converge REFUSE BY NAME, which is Wave 72's
           `pricing_solve_not_converged`.
       NOTHING IS RELAXED: six inputs went in, six come out, and four of them now
       carry exact numbers where they previously carried `> 0`. */
    const CONVERGING: Array<[number, string, string, string]> = [
      /* discount, price per share, iterations, total shares */
      [0,    "2.37500017812501335937600195320014649",   "6", "10526315"],
      [0.2,  "2.3747497607439616050458682916287696184", "6", "10527425"],
      [15,   "2.3529414532872297984976233526615709014", "6", "10624998"],
      [20,   "2.3437500915527379512788262218291492902", "7", "10666666"],
    ];
    for (const [d, pps, iters, total] of CONVERGING) {
      const ledger = [FOUNDERS, SAFE({ id: "sok", cap: null, discount: d, investmentAmount: 1_000_000 })];
      const r = projectPostClose(ledger, { preMoneyValuation: 20_000_000, investmentAmount: 5_000_000, series: "Series A" });
      const t = r.trace.find((x) => x.formulaId === "round.pricing.order");
      expect(r.totalShares > BigInt(0)).toBe(true);
      expect(r.totalShares.toString(), `discount ${d} total`).toBe(total);
      expect(String(t?.outputs?.pricePerShare).startsWith(pps.slice(0, 30)), `discount ${d} price`).toBe(true);
      expect(t?.outputs?.iterations, `discount ${d} iterations`).toBe(iters);
      expect(t?.outputs?.converged, `discount ${d} converged`).toBe("true");
    }
    /* THE DIVERGENT PAIR — a named refusal instead of a 25- and a 125-digit
       share count. The stored discount is still INSIDE [0,100) and is still
       accepted by the wire guard; what cannot be produced is a settled price. */
    for (const d of [99, 99.9999]) {
      const ledger = [FOUNDERS, SAFE({ id: "sok", cap: null, discount: d, investmentAmount: 1_000_000 })];
      let caught: Error | null = null;
      try {
        projectPostClose(ledger, { preMoneyValuation: 20_000_000, investmentAmount: 5_000_000, series: "Series A" });
      } catch (e) { caught = e as Error; }
      expect(caught, `discount ${d} should refuse`).not.toBeNull();
      expect((caught as unknown as { code?: string }).code, `discount ${d}`).toBe("pricing_solve_not_converged");
      expect(toEngineDiscount(d, "sok")).toBeDefined();   // the discount itself is still admissible
    }
    expect(toEngineDiscount(20, "s")).toBe("0.2");
    expect(toEngineDiscount(null, "s")).toBeUndefined();
  });

  it("W70-D9c — the WIRE guard is neither weakened, bypassed nor duplicated (R34)", () => {
    /* `toWireDiscount` runs FIRST inside `toEngineDiscount`, so the pre-existing
       arbiter still owns `20260707` and still names the stored value. */
    expect(() => toEngineDiscount(20260707, "s")).toThrow(InvalidDiscountWireValueError);
    expect(toWireDiscount(100, "s")!.wireFraction).toBe("1"); // the documented asymmetry SURVIVES
    const s = src(ADAPTER);
    const gate = s.slice(s.indexOf("export function toEngineDiscount"));
    const fn = gate.slice(0, gate.indexOf("\n}\n"));
    expect(fn).toContain("toWireDiscount(rawStoredPercent, securityId)");
    expect(fn.indexOf("toWireDiscount")).toBeLessThan(fn.indexOf("validateDiscountPercentAsWritten"));
    expect(fn).not.toMatch(/\/\s*100/); // no second division
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D5 — BOTH SAFE CAP CONVENTIONS ARE REACHABLE.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W70-D5 — the stored SAFE cap convention, not a literal", () => {
  it("W70-D5a — pre-money and post-money give DIFFERENT, correct answers through the platform", () => {
    const at = (t: string | null) => {
      const r = projectPostClose([FOUNDERS, POOL, PRICED, SAFE({ safeCapType: t as never })], {
        preMoneyValuation: 30_000_000, investmentAmount: 10_000_000, series: "Series A",
      });
      const st = r.trace.find((x) => x.formulaId.startsWith("safe."))!;
      return { formulaId: st.formulaId, cap: st.inputs.companyCapitalization, price: st.outputs.conversionPrice, shares: st.outputs.safeShares };
    };
    const post = at("post_money_cap");
    const pre = at("pre_money_cap");
    expect(post.formulaId).toBe("safe.postmoney.conversion");
    expect(pre.formulaId).toBe("safe.premoney.conversion");
    /* The whole point of D5: the two conventions are NOT the same number. §11
       request 5 of the document sent to Shadie asks her to check exactly this. */
    expect(post.shares).not.toBe(pre.shares);
    expect(Number(post.price)).toBeLessThan(Number(pre.price));
    expect(Number(post.shares)).toBeGreaterThan(Number(pre.shares));
  });

  it("W70-D5b — ABSENT is an assumption that is STATED, not a silent choice", () => {
    const absent = resolveSafeCapType(SAFE({}));
    expect(absent.capType).toBe("post_money_cap"); // YC v1.2, the market standard
    expect(absent.assumed).toBe(true);
    expect(absent.assumption).toContain("POST-MONEY");
    expect(absent.assumption).toContain("YC SAFE v1.2");
    /* The notice disappears when the data improves — a permanent banner is noise. */
    const stored = resolveSafeCapType(SAFE({ safeCapType: "pre_money_cap" }));
    expect(stored.assumed).toBe(false);
    expect(stored.assumption).toBeNull();
    expect(safeCapTypeAssumptions([FOUNDERS, SAFE({})]).length).toBe(1);
    expect(safeCapTypeAssumptions([FOUNDERS, SAFE({ safeCapType: "post_money_cap" })]).length).toBe(0);
    /* An UNCAPPED SAFE has no cap arithmetic, so it raises no assumption at all. */
    expect(safeCapTypeAssumptions([FOUNDERS, SAFE({ cap: null })]).length).toBe(0);
  });

  it("W70-D5c — an UNREADABLE stored convention refuses rather than falling back", () => {
    let caught: Error | null = null;
    try { resolveSafeCapType(SAFE({ safeCapType: "postmoney" as never })); } catch (e) { caught = e as Error; }
    expect(caught).toBeInstanceOf(RoundMathTermRefusal);
    expect((caught as RoundMathTermRefusal).code).toBe("invalid_safe_cap_type");
  });

  it("W70-D5d — the literal is gone, and `safeType` can now be STORED (no migration)", () => {
    expect(code(ADAPTER)).not.toContain('type: "post_money_cap",');
    /* The persistence half: without this the fix would be read-only. */
    const store = src("server/roundsStore.ts");
    const block = store.slice(store.indexOf("UPDATE_EXTRAS_WHITELIST"));
    expect(block).toContain('"safeType"');
    /* NO NEW MIGRATION. Asserted, because the brief forbids one outright. */
    const migrations = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(migrations.length).toBe(173);
    expect(migrations[migrations.length - 1]).toBe("0192_wave68_term_domain_fences.sql");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D4 — ONE AS-CONVERTED COMPUTATION, AND NO FABRICATED PRICE.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W70-D4 — as-converted is computed once, by the engine", () => {
  it("W70-D4a — the preview's SAFE count now EQUALS the engine's own conversion", () => {
    /* THE DEFECT: two implementations disagreeing by 250,000 shares on a
       $2,000,000 SAFE. This asserts they are now the same computation, by
       recomputing the same instrument through the engine leaf directly.
       companyCap = 8,000,000 + 1,000,000 + 1,000,000 = 10,000,000
       effectiveCap = 10,000,000 − 2,000,000 = 8,000,000
       rebased = 10,000,000 × 10,000,000 ÷ 8,000,000 = 12,500,000 */
    const ac = runEngine([FOUNDERS, POOL, PRICED, SAFE({})], "as_converted");
    const f = resolveFormula("safe.postmoney.conversion", "US");
    const direct = convertSafeToPreferred({
      purchaseAmount: "2000000", capType: "post_money_cap", cap: "10000000", discount: "0.2",
      seriesPricePerShare: "2", companyCapitalization: "12500000",
      formulaId: f.id, formulaVersion: f.version, region: "US", formulaDef: f.definition,
    });
    expect(ac.rows.find((r) => r.holderName === "SAFE Investor")!.shares.toString())
      .toBe(direct.safeShares.toString());
    expect(direct.conversionPrice).toBe("0.8");
  });

  it("W70-D4b — a note's ACCRUED INTEREST is now inside the preview", () => {
    /* It was omitted entirely: `investmentAmount` only. */
    const withRate = (r: number) =>
      runEngine([FOUNDERS, POOL, PRICED, NOTE({ interestRate: r })], "as_converted")
        .rows.find((x) => x.holderName === "Note Holder")!.shares;
    expect(Number(withRate(8))).toBeGreaterThan(Number(withRate(0)));
  });

  it("W70-D4c — NO PRICED ROUND: the $1.00 fabrication REFUSES BY NAME", () => {
    let caught: Error | null = null;
    try { runEngine([FOUNDERS, POOL, SAFE({}), NOTE({})], "as_converted"); } catch (e) { caught = e as Error; }
    expect(caught).toBeInstanceOf(AsConvertedPriceUnknownError);
    expect(caught!.name).toBe("AsConvertedPriceUnknownError");
    expect((caught as AsConvertedPriceUnknownError).code).toBe("as_converted_price_unknown");
    expect(caught!.message).toContain("sa");
    expect(caught!.message).toContain("nt");
    /* The literal is gone from the source. */
    const s = code(ADAPTER);
    expect(s).not.toContain("preferred[preferred.length - 1].pricePerShare ?? 1");
    expect(s).not.toContain("function safeConvertedShares");
    /* And so is the float arithmetic that went with it. */
    expect(s).not.toContain("Math.min(...candidates.filter((c) => c > 0))");
  });

  it("W70-D4d — THE OTHER POLE: no convertibles means no refusal", () => {
    /* A refusal that fired on every cap table would be a regression dressed as a
       safeguard. With nothing to convert, As-Converted is Fully-Diluted, which is
       the truth, and it still renders. */
    const noConv = [FOUNDERS, POOL];
    const ac = runEngine(noConv, "as_converted");
    const fd = runEngine(noConv, "fully_diluted");
    expect(ac.totalShares.toString()).toBe(fd.totalShares.toString());
    expect(ac.rows.length).toBe(2);
    /* A convertible with no money in it is not something to convert either. */
    expect(() => runEngine([FOUNDERS, SAFE({ investmentAmount: 0 })], "as_converted")).not.toThrow();
  });

  it("W70-D4e — the screen states what the preview assumes (R58: this one IS visible)", () => {
    const ct = src("client/src/pages/founder/CapTable.tsx");
    /* The three material things "ILLUSTRATIVE" did not disclose. */
    expect(ct).toContain("SAME conversion the engine performs at close");
    expect(ct).toContain("same accrued interest on notes");
    expect(ct).toContain("POST-MONEY (YC SAFE v1.2, the market standard)");
    expect(ct).toContain("Capavate REFUSES to compute this ");
    /* Still driven by the SELECTED view, not a hardcoded paragraph (R21). */
    expect(ct).toContain("DENOMINATOR_DEFINITION[view].authority");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D2 — `A` IS MEASURED IMMEDIATELY BEFORE THE DILUTIVE ISSUANCE (NVCA).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W70-D2 — the weighted-average base is pre-issuance", () => {
  const holders: Holder[] = [
    { id: "f", name: "Founders", type: "founder" },
    { id: "a", name: "A Fund", type: "investor" },
  ];
  const fixture = (flavour: "broad_based" | "narrow_based"): Transaction[] => [
    { type: "issue", date: "2025-01-01", security: { id: "c", holderId: "f", kind: "common", series: "Common", shares: BigInt(8_000_000) } },
    { type: "issue", date: "2025-01-02", security: { id: "p", holderId: "f", kind: "option", series: "Pool", option: { grantedShares: BigInt(1_000_000), exercisePrice: "0.01", vestingMonths: 0, cliffMonths: 0 } } },
    { type: "issue", date: "2025-06-01", security: { id: "a1", holderId: "a", kind: "preferred", series: "Series A", shares: BigInt(4_000_000), pricePerShare: "2.5", preferred: { liquidationPreferenceMultiple: 1, seniority: 1, antiDilution: flavour, originalIssuePrice: "2.5" } } },
    { type: "issue_preferred_round", date: "2026-01-01", round: { id: "B", series: "Series B", preMoneyValuation: "8000000", investmentAmount: "4000000" } },
  ];

  it("W70-D2a — BROAD: `A` is 13,000,000, the pre-issuance count, not 19,500,000", () => {
    const r = computeCapTable({ companyId: "co", asOf: "2026-01-01", view: "fully_diluted", formulaRegion: "US", holders, transactions: fixture("broad_based") });
    const step = r.trace.find((t) => t.formulaId === "antiDilution.broadBased")!;
    /* 8,000,000 common + 1,000,000 options + 4,000,000 preferred = 13,000,000.
       The new round issues C = 6,500,000; the OLD base was A + C = 19,500,000. */
    expect(step.inputs.A).toBe("13000000");
    expect(step.inputs.C).toBe("6500000");
    expect(Number(step.inputs.A)).toBeLessThan(13_000_000 + Number(step.inputs.C));
  });

  it("W70-D2b — NARROW: `A` is 12,000,000 — common + preferred only, pre-issuance", () => {
    const r = computeCapTable({ companyId: "co", asOf: "2026-01-01", view: "fully_diluted", formulaRegion: "US", holders, transactions: fixture("narrow_based") });
    const step = r.trace.find((t) => t.formulaId === "antiDilution.narrowBased")!;
    expect(step.inputs.A_narrow).toBe("12000000");
    expect(step.inputs.C).toBe("6500000");
  });

  it("W70-D2c — the correction is worth 413,556 shares to the protected holder", () => {
    /* Measured through the engine leaf on both bases, so the DIRECTION of the
       defect is on the record: the post-issuance base UNDER-compensates. */
    const common = {
      originalConversionPrice: "2.5",
      newIssuePrice: "0.61538461538461538461538461538461538462",
      moneyRaised: "4000000", sharesIssuedInRound: BigInt(6_500_000),
      protectedShares: BigInt(4_000_000),
      formulaId: "x", formulaVersion: "1", region: "US" as const, formulaDef: {},
    };
    const pre = applyBroadBasedWeightedAverage({ ...common, outstandingBroadBased: BigInt(13_000_000) });
    const post = applyBroadBasedWeightedAverage({ ...common, outstandingBroadBased: BigInt(19_500_000) });
    expect(pre.newShares.toString()).toBe("5342465");
    expect(post.newShares.toString()).toBe("4928909");
    expect(Number(pre.newShares) - Number(post.newShares)).toBe(413_556);
    const preN = applyNarrowBasedWeightedAverage({ ...common, outstandingNarrowBased: BigInt(12_000_000) });
    const postN = applyNarrowBasedWeightedAverage({ ...common, outstandingNarrowBased: BigInt(18_500_000) });
    expect(Number(preN.newShares) - Number(postN.newShares)).toBe(466_052);
    /* And the PIPELINE agrees with the pre-issuance leaf, which is the fix. */
    const piped = computeCapTable({ companyId: "co", asOf: "2026-01-01", view: "fully_diluted", formulaRegion: "US", holders, transactions: fixture("broad_based") });
    expect(piped.rows.find((x) => x.holderName === "A Fund")!.shares.toString()).toBe("5342465");
  });

  it("W70-D2d — the authority is CITED in the code, as R29 requires", () => {
    const s = src(COMPUTE);
    expect(s).toContain("NVCA Model Certificate of Incorporation");
    expect(s).toContain("§4.4(d)(ii)(A)");
    expect(s).toContain("https://nvca.org/model-legal-documents/");
    expect(s).toContain("immediately prior");
    /* The base really is taken from the pre-issuance ledger, not `ledger`. */
    expect(s).toContain("const preIssuanceLedger = ledger;");
    expect(s).toContain("const broadBaseShares = preIssuanceLedger.reduce");
    expect(s).toContain("const narrowBaseShares = preIssuanceLedger");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D1 — ANTI-DILUTION IS APPLIED TO THE INVESTORS IT PROTECTS (R60).
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W70-D1 — anti-dilution reaches the existing preferred class", () => {
  const CLASS_A = (ad: string | null) => sec({
    id: "a1", holderName: "Series A Fund", instrument: "preferred", series: "Series A",
    shares: 4_000_000, pricePerShare: 2.5, investmentAmount: 10_000_000,
    issuedAt: "2025-06-01", antiDilutionType: ad as never,
  });
  const LEDGER = (ad: string | null) => [FOUNDERS, POOL, CLASS_A(ad)];
  const DOWN = { preMoneyValuation: 8_000_000, investmentAmount: 4_000_000, series: "Series B" };
  const UP = { preMoneyValuation: 60_000_000, investmentAmount: 20_000_000, series: "Series B" };

  it("W70-D1a — a STORED method now moves the protected holder's share count", () => {
    /* BEFORE: exactly 4,000,000 shares and NO anti-dilution trace step, for every
       method, because `adaptSecuritiesToEngine` never set the field. */
    const at = (ad: string) => {
      const r = projectPostClose(LEDGER(ad), DOWN);
      return {
        shares: r.rows.find((x) => x.holderName === "Series A Fund")!.shares.toString(),
        step: r.trace.find((t) => t.formulaId.startsWith("antiDilution."))?.formulaId ?? null,
      };
    };
    expect(at("broad_based")).toEqual({ shares: "5342465", step: "antiDilution.broadBased" });
    expect(at("narrow_based")).toEqual({ shares: "5441176", step: "antiDilution.narrowBased" });
    expect(at("full_ratchet")).toEqual({ shares: "16250000", step: "antiDilution.fullRatchet" });
    /* Every one of them is strictly more than the unprotected 4,000,000. */
    for (const ad of ["broad_based", "narrow_based", "full_ratchet"]) {
      expect(Number(at(ad).shares)).toBeGreaterThan(4_000_000);
    }
    /* `applyNarrowBasedWeightedAverage` had NO application caller at all. It
       does now, and this is the assertion that says so. */
    expect(at("narrow_based").step).toBe("antiDilution.narrowBased");
  });

  it("W70-D1b — a stored `none` is a TERM ON RECORD: no adjustment, no refusal", () => {
    const r = projectPostClose(LEDGER("none"), DOWN);
    expect(r.rows.find((x) => x.holderName === "Series A Fund")!.shares.toString()).toBe("4000000");
    expect(r.trace.find((t) => t.formulaId.startsWith("antiDilution."))).toBeUndefined();
    expect(resolvePreferredTerms(CLASS_A("none")).antiDilutionUnknown).toBe(false);
  });

  it("W70-D1c — an ABSENT method on a DOWN round REFUSES BY NAME (R60 §4)", () => {
    let caught: Error | null = null;
    try { projectPostClose(LEDGER(null), DOWN); } catch (e) { caught = e as Error; }
    expect(caught).toBeInstanceOf(UnknownAntiDilutionTermError);
    expect(caught!.name).toBe("UnknownAntiDilutionTermError");
    const r = caught as UnknownAntiDilutionTermError;
    expect(r.code).toBe("unknown_anti_dilution_term");
    expect(r.field).toBe("antiDilutionType");
    expect(r.securityId).toBe("a1");
    expect(r.originalIssuePrice).toBe("2.5");
    expect(Number(r.newIssuePrice)).toBeLessThan(2.5);
    expect(r.message).toContain("DOWN ROUND");
    /* It must NOT quietly state the unprotected count anywhere. */
    expect(r.message).not.toContain("4,000,000");
  });

  it("W70-D1d — THE OTHER POLE: an ABSENT method on an UP round does NOT refuse", () => {
    /* A refusal on every projection would be unusable. Anti-dilution only bites
       when a later round prices BELOW the class's original issue price. */
    const r = projectPostClose(LEDGER(null), UP);
    expect(r.rows.find((x) => x.holderName === "Series A Fund")!.shares.toString()).toBe("4000000");
    const pps = r.trace.find((t) => t.formulaId === "round.pricing.order")!.outputs.pricePerShare;
    expect(Number(pps)).toBeGreaterThan(2.5);
    /* And a FLAT round is not a down round either. */
    expect(() => projectPostClose(LEDGER(null), { preMoneyValuation: 32_500_000, investmentAmount: 1_000_000, series: "Series B" })).not.toThrow();
    /* A ledger with no preferred at all is untouched. */
    expect(() => projectPostClose([FOUNDERS, POOL], DOWN)).not.toThrow();
  });

  it("W70-D1e — the two hardcoded round terms at `:1090` are DELETED", () => {
    const s = code(ADAPTER);
    /* R60 named this line as the defect: `antiDilution: "broad_based"` set on the
       NEW round being issued, which protects nobody. */
    expect(s).not.toContain('antiDilution: "broad_based"');
    expect(s).not.toContain("participating: false,");
    /* And both are now read from the caller's stored terms. */
    expect(s).toContain("...(round.antiDilutionType ? { antiDilution: round.antiDilutionType } : {})");
    /* The route that reads them from the database. */
    expect(src("server/roundMathRoutes.ts")).toContain("round.antiDilutionType");
    /* Storage exists already — NO MIGRATION (the brief's hard constraint). */
    const store = src("server/roundsStore.ts");
    expect(store.slice(store.indexOf("UPDATE_EXTRAS_WHITELIST"))).toContain('"antiDilutionType"');
  });

  it("W70-D1f — an UNREADABLE stored method refuses rather than defaulting", () => {
    let caught: Error | null = null;
    try { resolvePreferredTerms(CLASS_A("ratchet-ish")); } catch (e) { caught = e as Error; }
    expect(caught).toBeInstanceOf(RoundMathTermRefusal);
    expect((caught as RoundMathTermRefusal).code).toBe("invalid_anti_dilution_type");
  });

  it("W70-D1g — the adapter REPORTS which classes are unprotected", () => {
    expect(adaptSecuritiesToEngine(LEDGER(null)).unknownAntiDilutionClasses).toEqual([
      { securityId: "a1", series: "Series A", originalIssuePrice: "2.5" },
    ]);
    expect(adaptSecuritiesToEngine(LEDGER("broad_based")).unknownAntiDilutionClasses).toEqual([]);
  });

  it("W70-D1h — HONEST SCOPE on R60 §6: `participating` is read, not refused", () => {
    /* The hardcoded `participating: false` is gone from the adapter, and a stored
       term is honoured. It is NOT refused on absence, because on THIS path it
       reaches no arithmetic — the cap-table engine never reads
       `Security.preferred.participating`. The surface that DOES read a
       participation flag is `GET /api/founder/captable/waterfall`, which
       hardcoded it at `server/track1Routes.ts` — that was finding D11.

       ── UPDATED BY WAVE 71 · D11, AS WAVE 70'S OWN HANDOFF REQUIRED ──────────
       The last assertion of this test used to read
           expect(src("server/track1Routes.ts")).toContain("participating: false");
       i.e. it PINNED the defect, deliberately, so that Wave 70's report could not
       claim R60 §6 was fully closed. Wave 70's handoff said in terms: "`participating:
       false` is still hardcoded at `server/track1Routes.ts:190` and test `W70-D1h`
       asserts that it is — Wave 71 must update `W70-D1h` when it fixes D11."
       D11 is now fixed: the waterfall route reads the term through the SAME single
       reader (`roundStoredTerms`) and REFUSES BY NAME when it is not on record. The
       pin is therefore inverted rather than deleted — it now asserts the defect is
       GONE and that the replacement is the shared reader, so a regression to a
       hardcoded literal fails this test. */
    expect(resolvePreferredTerms(CLASS_A("none")).participating).toBeUndefined();
    expect(resolvePreferredTerms({ ...CLASS_A("none"), participatingPreferred: true }).participating).toBe(true);
    expect(resolvePreferredTerms({ ...CLASS_A("none"), participatingPreferred: false }).participating).toBe(false);
    expect(code(COMPUTE)).not.toContain("preferred.participating");
    const track1 = src("server/track1Routes.ts");
    expect(track1).not.toContain("participating: false,");
    expect(track1).toContain("participating: terms.participatingPreferred");
    expect(track1).toContain("liquidationPreferenceMultiple: terms.liquidationPreferenceMultiple");
    expect(track1).toContain("LIQUIDATION_TERM_NOT_ON_RECORD");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * OVER HTTP — R58: WHERE A ROUTE EXISTS, THE REFUSAL IS DRIVEN THROUGH IT.
 * ═══════════════════════════════════════════════════════════════════════════
 * `GET /api/founder/rounds/:id/round-math` is the ONE HTTP surface that reaches
 * this arithmetic. It is driven against the REAL `registerRoutes` Express stack
 * over supertest, and the seed is left exactly as it was found.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. It proves the refusals leave the engine
 * and arrive at the API with a machine-readable name. It does NOT prove a founder
 * sees them on a screen — that is stated separately and honestly in
 * `build_log/wave70/WAVE70_REPORT.md` under "visible to a user vs API-only".
 */
describe("W70-HTTP — the refusals reach the API by name", () => {
  let app: Express;
  const STAMP = String(Date.now());
  /** The seeded company whose ledger carries a SAFE, a note, a warrant and a
   *  preferred class — i.e. every instrument these six findings touch. */
  const CO = "co_novapay";
  const ADMIN = "u_admin";
  /** An UP round, deliberately: the D1 refusal must not pre-empt D6 and D9. */
  let upRoundId = "";
  /** A DOWN round on the same ledger, for the R60 §4 refusal. */
  let downRoundId = "";

  const mkRound = async (name: string, pre: number, target: number, pps: number) => {
    const res = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
      companyId: CO, name, type: "seed", instrument: "preferred",
      openDate: "2026-01-01", closeDate: "2026-12-31",
      targetAmount: target, preMoney: pre, pricePerShare: pps,
      sharesAuthorized: 40_000_000, fdPreMoneyShares: 13_000_000,
    });
    expect(res.status).toBe(200);
    return String((res.body as { id: string }).id);
  };

  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
    upRoundId = await mkRound(`W70 Up ${STAMP}`, 120_000_000, 30_000_000, 8);
    downRoundId = await mkRound(`W70 Down ${STAMP}`, 8_000_000, 4_000_000, 0.6154);
  }, 90_000);

  const roundMath = (id: string) =>
    request(app).get(`/api/founder/rounds/${id}/round-math`).set("x-user-id", ADMIN);

  it("W70-HTTP-a — BASELINE POLE: an UP round on the seeded ledger answers 200", async () => {
    /* Without this the refusals below prove nothing: a route that 422s
       unconditionally is not a safeguard, it is an outage. The seed's note
       (`sec_8`) carries `interestRate: 6`, so the D6 refusal must NOT fire. */
    const res = await roundMath(upRoundId);
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it("W70-HTTP-b — a note with NO stored interest rate 422s with `missing_note_interest_rate`", async () => {
    const base = securities.find((s) => s.id === "sec_8") as { interestRate: number | null } | undefined;
    expect(base, "seed anchor sec_8 (the Bridge Note) is missing — re-derive this test").toBeDefined();
    const original = base!.interestRate;
    base!.interestRate = null;
    let status = -1;
    let body: Record<string, unknown> = {};
    try {
      const res = await roundMath(upRoundId);
      status = res.status;
      body = res.body as Record<string, unknown>;
    } finally {
      base!.interestRate = original;
    }
    /* The seed is left exactly as it was found. */
    expect((securities.find((s) => s.id === "sec_8") as { interestRate: number | null }).interestRate).toBe(original);

    expect(status).toBe(422);
    expect(body.error).toBe("ROUND_MATH_TERM_REFUSED");
    expect(body.refusal).toBe("missing_note_interest_rate");
    expect(body.refusalName).toBe("MissingNoteInterestRateError");
    expect(body.field).toBe("interestRate");
    expect(body.securityId).toBe("sec_8");
    /* And it did NOT answer with a number computed at a rate nobody agreed. */
    expect(String(body.message)).not.toMatch(/has been assumed|defaulted to/i);
  });

  it("W70-HTTP-c — a legacy stored `discount: 100` 422s instead of 500ing", async () => {
    /* D9's reachability: migration 0192 validates CHANGES, not STATE (R41), so a
       pre-fence `100` survives on a legacy row and is never re-validated. Before
       this wave it produced `SyntaxError: Cannot convert Infinity to a BigInt`
       and surfaced as a 500 with a blank Projection. */
    const base = securities.find((s) => s.id === "sec_4") as { discount: number | null } | undefined;
    expect(base, "seed anchor sec_4 (a SAFE) is missing — re-derive this test").toBeDefined();
    const original = base!.discount;
    base!.discount = 100;
    let status = -1;
    let body: Record<string, unknown> = {};
    try {
      const res = await roundMath(upRoundId);
      status = res.status;
      body = res.body as Record<string, unknown>;
    } finally {
      base!.discount = original;
    }
    expect((securities.find((s) => s.id === "sec_4") as { discount: number | null }).discount).toBe(original);

    expect(status).toBe(422);
    expect(status).not.toBe(500);
    expect(body.refusal).toBe("stored_discount_out_of_domain");
    expect(body.refusalName).toBe("StoredDiscountOutOfDomainError");
    expect(String(body.message)).not.toContain("Cannot convert Infinity to a BigInt");
  });

  it("W70-HTTP-d — R60 §4 OVER HTTP: a DOWN round on an unprotected class 422s", async () => {
    /* THE HEADLINE FINDING, end to end on the SEEDED ledger. `sec_5` is NovaPay's
       Series Seed Preferred at $1.00; the round below prices beneath it and no
       anti-dilution method is on record for that class, so the platform refuses
       instead of showing the investor's unprotected share count as final. */
    const res = await roundMath(downRoundId);
    expect(res.status).toBe(422);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe("ROUND_MATH_TERM_REFUSED");
    expect(body.refusal).toBe("unknown_anti_dilution_term");
    expect(body.refusalName).toBe("UnknownAntiDilutionTermError");
    expect(body.field).toBe("antiDilutionType");
    expect(String(body.message)).toContain("DOWN ROUND");
    /* WAVE 85 — STALE COPY PIN, RE-POINTED. Wave 83 removed the ruling citation from
       this founder-visible refusal. Both strings, verbatim:
         OLD: "one nobody negotiated is the defect this refusal exists to prevent (owner ruling R60). Record the "
         NEW: "one nobody negotiated is the defect this refusal exists to prevent. Record the "
       THE REFUSAL REMAINS FULLY IDENTIFIABLE TO A CALLER — four machine-readable
       identifiers are asserted above and all four still pass: `error`, `refusal`
       ("unknown_anti_dilution_term"), `refusalName` ("UnknownAntiDilutionTermError")
       and `field`. "owner ruling R60" was provenance, never the identifier. What is
       asserted instead is the SUBSTANCE the refusal must state: that no method is on
       record and that the platform therefore declines to state a share count. */
    expect(String(body.message)).toContain("no anti-dilution method on record for this class");
    expect(String(body.message)).toContain("it will not state a share count");
  });

  it("W70-HTTP-e — CLOSING POLE: the up round still answers 200 after every fixture is restored", async () => {
    /* A wave whose safeguards left the good path broken would be a regression
       dressed as a safety check. This is the assertion that would catch it. */
    const res = await roundMath(upRoundId);
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });
});

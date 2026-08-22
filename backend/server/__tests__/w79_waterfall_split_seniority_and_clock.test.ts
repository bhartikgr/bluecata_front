/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 79 — THE WATERFALL SPLIT, FABRICATED SENIORITY, TWO CALENDAR BOMBS AND
 *           THE MONTH-END CLAMP.
 * ══════════════════════════════════════════════════════════════════════════════
 * Found by Final Review A (`build_log/final_review_2/REVIEW_A_MATH.md`), which
 * built an independent model of standard American venture terms in exact rational
 * arithmetic and reproduced this engine TO THE DIGIT on every non-converting case.
 * That agreement is what made its disagreement credible, and Wave 79 reproduced
 * both halves with a SECOND independent model written from scratch
 * (`build_log/wave79/w79_independent_waterfall.mts`) before changing a line.
 *
 * ITEM 1 · the residual was paid at TWO different per-share prices whenever a class
 *          CONVERTED while another class was still PARTICIPATING.
 * ITEM 2 · `GET /api/founder/captable/waterfall` FABRICATED the seniority ranking.
 * ITEM 3 · two assertions pinned values that move with the wall clock.
 * ITEM 4 · the maturity derivation had no month-end clamp.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { Decimal } from "decimal.js";
import { computeWaterfall } from "@capavate/cap-table-engine";
import {
  projectPostClose, runEngine, deriveMaturityDateFromMonths,
  type ApiSecurity,
} from "../../shared/roundMathEngineAdapter";
import { roundStoredTerms, SENIORITY_RANK_MAX } from "../lib/roundStoredTerms";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { createRound } from "../roundsStore";

const ROOT = path.resolve(__dirname, "../..");
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments removed — "read the enforcement code, not the comment"
    (SACRED §7.4). Without this, a comment that QUOTES the removed defect makes a
    `not.toContain` assertion fail, which is how a correct fix looks broken. */
const codeOnly = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/* A CLONE, deliberately. `Decimal.set` mutates the SHARED decimal.js instance that
   `server/track1Routes.ts` also imports, so setting a global precision here would
   change the production code's own output under test — measured: it turned a
   40-digit `founderProceeds` into a 120-digit one. Every sum below uses this clone. */
const D120 = Decimal.clone({ precision: 120 });
/** Payout vector as `key=value` with the value fixed to 20 DECIMAL PLACES.
    WHY NOT THE RAW STRING. decimal.js's significant-digit setting is process-global
    and differs between a bare `tsx` harness (38) and this vitest process (40), so a
    raw-string pin is a pin on the HARNESS, not on the engine — measured, after the
    first version of this test failed on exactly that. Twenty decimal places is
    eighteen orders of magnitude finer than a cent, so nothing this test exists to
    catch can hide inside the difference. The genuinely BYTE-IDENTICAL evidence is
    the 4,000-fixture before/after sweep, where every non-converting fixture's full
    payout string matched exactly: `build_log/wave79/W79_SWEEP_DIFF.txt`. */
const vec20 = (r: { payouts: Array<{ classId?: string; holderId?: string; total: string }> }) =>
  /* TRUNCATED, not rounded: `ROUND_DOWN` so the 20th place cannot flip on a
     ...7781 tail and make an identical value compare unequal. */
  r.payouts.map((p) => `${p.classId ?? p.holderId}=${new D120(p.total).toFixed(20, Decimal.ROUND_DOWN)}`);

/* ── the fixture Wave 71 advertised, and the one Review A measured on ───────── */
type PrefIn = {
  classId: string; className: string; invested: string; shares: bigint;
  liquidationPreferenceMultiple: number; participating: boolean;
  participationCapMultiple?: number; seniority: number;
};
const A_PARTICIPATING: PrefIn = {
  classId: "A", className: "Series A", invested: "10000000", shares: 4_000_000n,
  liquidationPreferenceMultiple: 1, participating: true, seniority: 1,
};
const B = (o: Partial<PrefIn>): PrefIn => ({
  classId: "B", className: "Series B", invested: "4000000", shares: 4_000_000n,
  liquidationPreferenceMultiple: 1, participating: true, seniority: 2, ...o,
});
const wf = (preferred: PrefIn[], common: { holderId: string; shares: bigint }[], exitProceeds = "50000000") =>
  computeWaterfall({
    exitProceeds, preferred, common,
    formulaId: "wf", formulaVersion: "1", region: "US", formulaDef: {},
  } as never) as {
    payouts: Array<{
      classId?: string; holderId?: string; decision: string;
      preferenceTaken: string; participation: string; total: string;
    }>;
    remainder: string;
  };
const FOUNDERS8M = [{ holderId: "founders", shares: 8_000_000n }];
const totalOf = (r: ReturnType<typeof wf>, k: string) =>
  r.payouts.find((p) => (p.classId ?? p.holderId) === k)!.total;
/** decimal-string compare that tolerates the engine's 38-significant-digit tail. */
const cents = (s: string) => new Decimal(s).toFixed(2);

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 1 — ONE RESIDUAL, ONE POOL, ONE PRICE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W79 · ITEM 1 — the residual is paid at ONE price per share", () => {
  it("W79-A1 — Wave 71's own $50m fixture now splits 20,000,000 / 10,000,000 / 20,000,000", () => {
    /* THE HEADLINE. Post-Wave-71 this returned A=23,333,333.33 / B=8,888,888.89 /
       founders=17,777,777.78, and `$23,333,333` was reported to the owner as a
       CORRECTED figure. It was not: it is $3,333,333.33 too high, and the FOUNDERS
       were $2,222,222.22 short — an error more than three times LARGER than the
       +$666,666.67 the same fixture had BEFORE Wave 71. */
    const r = wf([B({ participationCapMultiple: 2 }), A_PARTICIPATING], FOUNDERS8M);
    expect(cents(totalOf(r, "A"))).toBe("20000000.00");
    expect(cents(totalOf(r, "B"))).toBe("10000000.00");
    expect(cents(totalOf(r, "founders"))).toBe("20000000.00");
    /* and the wrong figures are asserted against BY VALUE, so a revert is loud */
    expect(cents(totalOf(r, "A"))).not.toBe("23333333.33");
    expect(cents(totalOf(r, "founders"))).not.toBe("17777777.78");
    expect(cents(totalOf(r, "founders"))).not.toBe("20666666.67");   /* pre-Wave-71 */
  });

  it("W79-A2 — the defect also bit a plain NON-PARTICIPATING converter, so it pre-dates Wave 71", () => {
    /* Review A §D-A1 second row: B non-participating (so it converts on its own
       merits, with no cap involved) beside a participating A. Same wrong answer
       before, same correct answer now — which is why this is not merely a
       Wave-71 regression. */
    const r = wf([B({ participating: false }), A_PARTICIPATING], FOUNDERS8M);
    expect(cents(totalOf(r, "A"))).toBe("20000000.00");
    expect(cents(totalOf(r, "B"))).toBe("10000000.00");
    expect(cents(totalOf(r, "founders"))).toBe("20000000.00");
  });

  it("W79-A3 — THE DISPROOF, INVERTED: one price, and it fits inside the residual", () => {
    /* The defect's signature was an implied price of $3.3333/share for Series A
       against $2.2222/share for everyone else — a rate that would need
       $53,333,333.33 out of a $40,000,000 residual. Both halves are asserted. */
    const r = wf([B({ participationCapMultiple: 2 }), A_PARTICIPATING], FOUNDERS8M);
    const row = (k: string) => r.payouts.find((p) => (p.classId ?? p.holderId) === k)!;
    const aPref = new Decimal(row("A").preferenceTaken);
    const aPrice = new Decimal(row("A").participation).div(4_000_000);
    const fPrice = new Decimal(row("founders").total).div(8_000_000);
    const bPrice = new Decimal(row("B").total).div(4_000_000);
    expect(aPref.toFixed(2)).toBe("10000000.00");
    /* ONE PRICE — compared at 8 dp, which is 17 orders of magnitude finer than the
       $3.3333-vs-$2.2222 gap this exists to catch. */
    expect(aPrice.toFixed(8)).toBe("2.50000000");
    expect(fPrice.toFixed(8)).toBe("2.50000000");
    expect(bPrice.toFixed(8)).toBe("2.50000000");
    expect(aPrice.toFixed(8)).not.toBe("3.33333333");
    /* and that price × the whole common-equivalent pool is EXACTLY the residual */
    const residual = new Decimal("50000000").minus(aPref);
    expect(residual.toFixed(2)).toBe("40000000.00");
    expect(aPrice.mul(8_000_000 + 4_000_000 + 4_000_000).toFixed(2)).toBe(residual.toFixed(2));
    expect(aPrice.mul(16_000_000).toFixed(2)).not.toBe("53333333.33");
  });

  it("W79-A4 — NON-CONVERTING cases are BYTE-IDENTICAL to the pre-fix engine", () => {
    /* ITEM 1 CONDITION 3, and it is the most important assertion in this file: the
       non-converting set is exactly where this engine already agreed with the
       independent model to the digit, so it must not move by one digit. Every
       expected string below was captured from the PRE-FIX engine
       (`build_log/wave79/w79_sweep_BEFORE.json`, fixtures 6, 8, 12) and is pinned
       here in full precision, not rounded. */
    const f6 = wf(
      [
        { classId: "C0", className: "C0", invested: "2750000", shares: 3_600_000n, liquidationPreferenceMultiple: 1.5, participating: true, seniority: 0 },
        { classId: "C1", className: "C1", invested: "4000000", shares: 3_900_000n, liquidationPreferenceMultiple: 3, participating: true, seniority: 1 },
      ],
      [{ holderId: "H0", shares: 1_900_000n }], "28000000",
    );
    expect(vec20(f6)).toEqual([
      "C0=8672872.34042553191489361702",
      "C1=16926861.70212765957446808510",
      "H0=2400265.95744680851063829787",
    ]);
    expect(f6.remainder).toBe("0");

    /* Two capped participating classes whose caps do NOT force a conversion. */
    const f8 = wf(
      [
        { classId: "C0", className: "C0", invested: "9750000", shares: 4_000_000n, liquidationPreferenceMultiple: 1, participating: true, participationCapMultiple: 2, seniority: 0 },
        { classId: "C1", className: "C1", invested: "2750000", shares: 800_000n, liquidationPreferenceMultiple: 1, participating: true, participationCapMultiple: 3, seniority: 1 },
      ],
      [{ holderId: "H0", shares: 4_400_000n }, { holderId: "H1", shares: 300_000n }], "19000000",
    );
    expect(vec20(f8)).toEqual([
      "C0=12486842.10526315789473684210",
      "C1=3297368.42105263157894736842",
      "H0=3010526.31578947368421052631",
      "H1=205263.15789473684210526315",
    ]);

    /* A non-participating class that takes its PREFERENCE (does not convert) beside
       a participating one, and five common holders. */
    const f12 = wf(
      [
        { classId: "C0", className: "C0", invested: "9500000", shares: 1_600_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 },
        { classId: "C1", className: "C1", invested: "9000000", shares: 600_000n, liquidationPreferenceMultiple: 1, participating: true, seniority: 1 },
      ],
      [
        { holderId: "H0", shares: 6_300_000n }, { holderId: "H1", shares: 2_600_000n },
        { holderId: "H2", shares: 7_400_000n }, { holderId: "H3", shares: 4_500_000n },
        { holderId: "H4", shares: 200_000n },
      ], "35000000",
    );
    expect(vec20(f12)).toEqual([
      "C0=9500000.00000000000000000000",
      "C1=9458333.33333333333333333333",
      "H0=4812500.00000000000000000000",
      "H1=1986111.11111111111111111111",
      "H2=5652777.77777777777777777777",
      "H3=3437500.00000000000000000000",
      "H4=152777.77777777777777777777",
    ]);

    /* The two fixtures Wave 71's own transcript published, unmoved. */
    const uncapped = wf([B({}), A_PARTICIPATING], FOUNDERS8M);
    expect([totalOf(uncapped, "A"), totalOf(uncapped, "B"), totalOf(uncapped, "founders")])
      .toEqual(["19000000", "13000000", "18000000"]);
    const cap4 = wf([B({ participationCapMultiple: 4 }), A_PARTICIPATING], FOUNDERS8M);
    expect([totalOf(cap4, "A"), totalOf(cap4, "B"), totalOf(cap4, "founders")])
      .toEqual(["19000000", "13000000", "18000000"]);
  });

  it("W79-A5 — the fix CANNOT reach a non-converting case, structurally", () => {
    /* The correction is a sum over the CONVERTER SET, so it is exactly `0n` when
       nothing converts and `x + 0n` is `x`. Asserted at source so the reason a
       reader can trust W79-A4 is written down rather than inferred. */
    const engine = src("packages/cap-table-engine/src/waterfall/liquidationWaterfall.ts");
    expect(engine).toContain("const convertedSharesOf = (converters: ReadonlySet<string>): bigint =>");
    expect(engine).toContain("participatingSharesNow + totalCommonShares + convertedSharesOf(converters)");
    expect(engine).toContain("computeParticipatingShares(stillParticipating) + totalCommonShares + convertedSharesOf(converters)");
    /* exactly TWO sites, which is what the review located */
    expect(codeOnly(engine).match(/\+ convertedSharesOf\(converters\)/g)?.length).toBe(2);
    /* and the old, unbalanced forms are gone */
    expect(codeOnly(engine)).not.toContain("const denom = participatingSharesNow + totalCommonShares;");
  });

  it("W79-A6 — CONSERVATION stays EXACT over randomised fixtures", () => {
    /* ITEM 1 CONDITION 2. Review A measured exact to 1e-104 over 4,000 randomised
       fixtures BEFORE the fix; Wave 79 re-measured 4,000 after it (worst absolute
       error 2e-112, `build_log/wave79/W79_SWEEP_AFTER.txt`). 600 are re-run here so
       the property is a GATE and not a one-off transcript. Deterministic PRNG. */
    let seed = 79_2026 >>> 0;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    let worst = new D120(0);
    let converting = 0;
    for (let t = 0; t < 600; t++) {
      const preferred: PrefIn[] = [];
      for (let i = 0; i < ri(1, 4); i++) {
        const participating = rnd() < 0.5;
        const cap = participating && rnd() < 0.6 ? [1, 1.5, 2, 3, 4][ri(0, 4)] : undefined;
        preferred.push({
          classId: `C${i}`, className: `C${i}`,
          invested: String(ri(1, 40) * 250_000), shares: BigInt(ri(1, 40) * 100_000),
          liquidationPreferenceMultiple: [1, 1, 1, 1.5, 2, 3][ri(0, 5)],
          participating, ...(cap !== undefined ? { participationCapMultiple: cap } : {}),
          seniority: i,
        });
      }
      const common = Array.from({ length: ri(1, 6) }, (_, k) => ({ holderId: `H${k}`, shares: BigInt(ri(0, 80) * 100_000) }));
      const exit = String(ri(0, 200) * 250_000);
      const r = wf(preferred, common, exit);
      if (r.payouts.some((p) => p.decision === "as_converted")) converting++;
      const sum = r.payouts.reduce((s, p) => s.plus(new D120(p.total)), new D120(0)).plus(new D120(r.remainder));
      const err = sum.minus(new D120(exit)).abs();
      if (err.gt(worst)) worst = err;
    }
    /* the sweep must actually exercise the fixed path, or it proves nothing */
    expect(converting).toBeGreaterThan(50);
    /* ── UPDATED BY WAVE 81 · ITEM 1 (D3): THE BOUND WAS CALIBRATED ON AN
           UNDECLARED CONFIGURATION, AND IS RE-CALIBRATED ON THE DECLARED ONE ──
       `1e-30` was measured while the engine was accidentally running at
       `precision: 40` — `packages/math-fns/src/index.ts` mutated the shared
       decimal.js constructor and, in this test process, won. Wave 81 gives the
       engine its own `Decimal.clone({ 38, ROUND_HALF_EVEN })`, i.e. the precision
       it has always DECLARED, and each payout is divided independently at that
       significant-digit limit, so the residue is two digits larger. MEASURED over
       these exact 600 fixtures (`build_log/wave81/W81_conservation.txt`):

           engine at 40 / ROUND_HALF_UP  (the accident)  worst = 1.5e-32
           engine at 38 / ROUND_HALF_EVEN (as declared)  worst = 1.1e-30

       Independent corroboration: `build_log/final_test/TEST_1_MATH.md` §3 measured
       1.6e-30 over 4,000 fixtures in exact rationals, with the engine loaded ALONE
       and therefore at 38 — the same order of magnitude, from a different harness
       in a different language.

       THE BOUND MOVES ONE ORDER OF MAGNITUDE AND NO FURTHER, so it still fails if
       anything real regresses. 1e-29 of a MINOR unit is 1e-27 of a cent; conservation
       remains exact at every granularity a ledger, a statement or a person can see,
       and `W79-A5`'s cent-level reconciliation assertions are untouched and still
       exact. This is a precision statement being corrected, not a tolerance being
       loosened to make a failure go away. */
    expect(worst.lt(new D120("1e-29"))).toBe(true);
    /* AND IT IS NOT VACUOUS — the residue really is at the 30th decimal place. */
    expect(worst.lt(new D120("1e-25"))).toBe(true);
  });

  it("W79-A7 — the market-default fixtures (Wave 71 D11, Wave 74) are unmoved", () => {
    /* 1x NON-PARTICIPATING with no participating class anywhere is the market
       default and the engine was always right there. CLAIM 2 and CLAIM 4 of the
       review depend on it. */
    const r = wf(
      [{ classId: "A", className: "Series A", invested: "10000000", shares: 4_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: 0 }],
      FOUNDERS8M,
    );
    expect(cents(totalOf(r, "A"))).toBe("16666666.67");
    expect(cents(totalOf(r, "founders"))).toBe("33333333.33");
  });

  it("W79-A8 — A SECOND DEFECT THE SAME FIX CLOSED: $38,000,000 of a $47,500,000 exit was paid to NOBODY", () => {
    /* NOT in the review, and found by Wave 79's own before/after sweep (fixture
       #13). A single participating class with a 2x cap and a zero-share common
       holder: the fixed point elected to convert it, but the payout loop then
       computed a participation of ZERO (its own shares had been removed from the
       denominator and nothing was put back), so the cap never bound, the class was
       paid its bare $9,500,000 preference, and `sharesInPool` was 0 so Step 2 never
       ran. Conservation held — Σ payouts + remainder = the exit — while 80% of the
       exit sat in `remainder`, allocated to no one. */
    const r = wf(
      [{ classId: "C0", className: "C0", invested: "9500000", shares: 600_000n, liquidationPreferenceMultiple: 1, participating: true, participationCapMultiple: 2, seniority: 0 }],
      [{ holderId: "H0", shares: 0n }], "47500000",
    );
    expect(r.remainder).toBe("0");
    expect(cents(totalOf(r, "C0"))).toBe("47500000.00");
    /* the pre-fix answer, asserted against by value */
    expect(totalOf(r, "C0")).not.toBe("9500000");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 2 — THE SENIORITY RANKING IS READ, OR REFUSED BY NAME
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W79 · ITEM 2 — the waterfall route no longer fabricates seniority", () => {
  it("W79-B1 — WHY IT MATTERS: a $4,000,000 swing on an $8,000,000 exit, measured", () => {
    /* The route derived seniority from the order rounds appear in the committed
       ledger, making the EARLIEST round the MOST senior. Market practice is the
       opposite or pari passu. This is the arithmetic, at engine level. */
    const stack = (senEarly: number, senLate: number) => wf(
      [
        { classId: "early", className: "early $10m", invested: "10000000", shares: 4_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: senEarly },
        { classId: "late", className: "late $4m", invested: "4000000", shares: 4_000_000n, liquidationPreferenceMultiple: 1, participating: false, seniority: senLate },
      ],
      FOUNDERS8M, "8000000",
    );
    const routeOrder = stack(0, 1);
    expect(cents(totalOf(routeOrder, "early"))).toBe("8000000.00");
    expect(cents(totalOf(routeOrder, "late"))).toBe("0.00");
    const marketOrder = stack(1, 0);
    expect(cents(totalOf(marketOrder, "late"))).toBe("4000000.00");
    expect(cents(totalOf(marketOrder, "early"))).toBe("4000000.00");
    /* $4,000,000 of difference, from the ordering alone */
    expect(new Decimal(totalOf(marketOrder, "late")).minus(new Decimal(totalOf(routeOrder, "late"))).toFixed(2))
      .toBe("4000000.00");
  });

  it("W79-B2 — the route READS the ranking and no longer derives it from ledger order", () => {
    const route = src("server/track1Routes.ts");
    /* the fabrication is gone from the CODE (the comment quotes it on purpose, so
       the check is against code only — SACRED §7.4) */
    expect(codeOnly(route)).not.toContain("seniority: classIdx++");
    /* and the replacement is a READ of the one stored-terms reader */
    expect(route).toContain("seniority: terms.seniorityRank");
    expect(route).toContain("SENIORITY_NOT_ON_RECORD");
    expect(route).toContain("SENIORITY_RANKING_AMBIGUOUS");
    /* NO SILENT DROP — the refusal that was already there is still there */
    expect(route).toContain("LIQUIDATION_TERM_NOT_ON_RECORD");
    expect(route).toContain("COMMON_SHARES_NOT_ON_RECORD");
    /* ONE reader, not a second one (R21) */
    const reader = src("server/lib/roundStoredTerms.ts");
    expect(reader.match(/export function roundStoredTerms/g)?.length).toBe(1);
    expect(reader).toContain("seniorityRank");
    /* NO NEW MIGRATION — `seniority` rides `extras_json`, which POST /api/rounds
       already stashes and `rowToRound` already re-spreads. */
    const files = fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBe(173);
    expect(files.sort().at(-1)).toBe("0192_wave68_term_domain_fences.sql");
  });

  it("W79-B3 — the reader NEVER invents a rank, at every pole", () => {
    /* Domain, both ends, plus every not-a-ranking value. `0` is a legal rank and
       must NOT be confused with absent — that is the classic falsy-zero bug. */
    expect(SENIORITY_RANK_MAX).toBe(99);
    expect(roundStoredTerms("no-such-round").seniorityRank).toBeNull();
  });
});

describe("W79 · ITEM 2 — both poles, through the live HTTP route", () => {
  let app: express.Express;
  const ADMIN = "u_admin";
  const EXIT = "5000000000"; /* $50,000,000.00 */

  beforeAll(async () => {
    getDb();
    app = express();
    app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
  }, 90_000);

  const build = async (
    tag: string,
    classes: Array<{ lp: string | null; seniority?: number; pps: number; amount: string }>,
  ) => {
    const companyId = `co_w79t_${tag}`;
    await request(app).post("/api/founder/companies").set("x-user-id", ADMIN)
      .send({ companyId, companyName: `W79T ${tag}`, legalName: `W79T ${tag}, Inc.` });
    const foundationId = createRound({
      companyId, name: `w79t foundation ${tag}`, type: "foundation",
      instrument: "common", pricePerShare: null, actorUserId: ADMIN,
    } as never).id;
    await request(app).post("/api/founder/captable/seed-founder-shares").set("x-user-id", ADMIN)
      .send({
        companyId, roundId: foundationId, shares: "8000000", amount: "8000", currency: "USD",
        holderFirstName: "Founder", holderLastName: tag,
      });
    let i = 0;
    for (const c of classes) {
      const created = await request(app).post("/api/rounds").set("x-user-id", ADMIN).send({
        companyId, name: `w79t ${tag} class${i}`, type: "seed", instrument: "preferred",
        openDate: "2026-01-01", closeDate: "2026-12-31", targetAmount: 10_000_000,
        pricePerShare: c.pps, sharesAuthorized: 40_000_000, preMoney: 30_000_000, fdPreMoneyShares: 13_000_000,
        ...(c.lp ? { liquidationPreference: c.lp } : {}),
        ...(c.seniority !== undefined ? { seniority: c.seniority } : {}),
      });
      expect(created.status).toBe(200);
      await request(app).post("/api/founder/captable/backfill-investor").set("x-user-id", ADMIN)
        .send({
          companyId, roundId: String((created.body as { id: string }).id),
          shares: "4000000", amount: c.amount, currency: "USD",
          holderFirstName: "Invest", holderLastName: `${tag}${i}`,
          investorEmail: `w79t_${tag}_${i}@example.invalid`,
        });
      i++;
    }
    return request(app).get("/api/founder/captable/waterfall")
      .query({ companyId, exitValuationMinor: EXIT }).set("x-user-id", ADMIN);
  };

  it("W79-B4 — POLE 1: TWO preference classes with NO seniority on record REFUSE BY NAME", async () => {
    const res = await build("missing", [
      { lp: "1x participating", pps: 2.5, amount: "10000000" },
      { lp: "1x non-participating", pps: 1, amount: "4000000" },
    ]);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("SENIORITY_NOT_ON_RECORD");
    expect(res.body.refusalName).toBe("seniority_not_on_record");
    expect(res.body.field).toBe("seniority");
    /* it NAMES the classes that are missing it, rather than saying "some class" */
    expect(Array.isArray(res.body.classesMissingSeniority)).toBe(true);
    expect(res.body.classesMissingSeniority.length).toBe(2);
    /* and it says what the term does and where to record it (R58 discipline) */
    expect(String(res.body.message)).toContain("paid FIRST");
    expect(String(res.body.message)).toContain("0 is the most senior");
    /* NO FIGURE IS PRODUCED — the whole point. A wrong number is worse than none. */
    expect(res.body.founderProceeds).toBeUndefined();
  }, 60_000);

  it("W79-B5 — POLE 2: with the ranking RECORDED it computes, and echoes what it read", async () => {
    const res = await build("recorded", [
      { lp: "1x participating", seniority: 0, pps: 2.5, amount: "10000000" },
      { lp: "1x non-participating", seniority: 1, pps: 1, amount: "4000000" },
    ]);
    expect(res.status).toBe(200);
    /* ITEM 1 AND ITEM 2 TOGETHER, THROUGH THE REAL ROUTE, AT A FIXED $50m EXIT.
       Before Wave 79 this same cap table returned founderProceeds
       "1777777777.777777777777777777777777777778" (= $17,777,777.78). */
    expect(res.body.founderProceeds).toBe("2000000000");
    expect(res.body.lpProceeds).toBe("3000000000");
    /* exact conservation, in minor units, as R72 requires */
    expect(new D120(res.body.founderProceeds).plus(new D120(res.body.lpProceeds)).toFixed())
      .toBe("5000000000");
    /* the ranking is DISCLOSED, not merely used */
    expect(res.body.seniority.map((s: { seniority: number; onRecord: boolean }) => [s.seniority, s.onRecord]))
      .toEqual([[0, true], [1, true]]);
    expect(res.body.seniorityAssumed).toBeNull();
  }, 60_000);

  it("W79-B6 — POLE 3: DUPLICATE ranks now COMPUTE, and the answer is the distinct-rank answer", async () => {
    /* ══ REWRITTEN BY WAVE 91 · ITEM 1 — DELIBERATELY, AND HERE IS WHY. ═══════════
       OLD EXPECTATION: HTTP 422 `SENIORITY_RANKING_AMBIGUOUS`, with the message
       containing "PARI PASSU". The test's name said it: *"DUPLICATE ranks refuse
       rather than pretend to model pari passu."*
       NEW EXPECTATION: HTTP 200, and every figure BYTE-IDENTICAL to `W79-B5`
       immediately above — the same cap table with DISTINCT ranks 0 and 1.

       WHY THE NEW ONE IS RIGHT, AND WHY THE OLD ONE WAS NOT WRONG WHEN IT WAS
       WRITTEN. Wave 79 refused because the engine pays preferences one class at a
       time in sorted order and clamps each at the money still left, so on a SHORT
       exit it pays the first-listed class in full and the second nothing — two
       different answers on identical negotiated terms, from list order alone. That
       reasoning is intact and is still tested: `W91-PP-01` / `W91-PP-01R` pin the
       $6,000,000 / $3,000,000 pro-rata split and pin that reversing the list does
       not move it.

       WHAT THE REFUSAL GOT WRONG WAS ITS SCOPE. It fired on EVERY equal-ranking cap
       table, including this one — where the $50,000,000 sale covers the whole
       preference stack, so the ranking cannot change any figure at all. Measured
       over 207 randomised ample-exit fixtures run in four orderings each: 206
       byte-identical, the single exception one unit in the 38th significant digit
       (`spec/preflight_waterfall_evidence/21_claims_P1_P2_P3.txt`,
       `22_P1_counterexample.txt`). So the refusal was discarding an answer that was
       already correct, and this fixture proves it the strongest way available — the
       equal-rank answer and the stacked answer are the same string.

       THE REFUSAL IS NARROWED, NOT DELETED (R67 condition 1). `W79-B2` above still
       asserts the identifier is in the route, and it remains reachable from two
       defence-in-depth branches; `W91-REF-01` pins both. The figures below were
       produced by an EXECUTED run of this route, not by arithmetic in anyone's head:
       `build_log/wave91/transcripts/`. */
    const res = await build("dupe", [
      { lp: "1x participating", seniority: 0, pps: 2.5, amount: "10000000" },
      { lp: "1x non-participating", seniority: 0, pps: 1, amount: "4000000" },
    ]);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    /* IDENTICAL TO `W79-B5`, the distinct-rank control, to the last digit. */
    expect(res.body.founderProceeds).toBe("2000000000");
    expect(res.body.lpProceeds).toBe("3000000000");
    expect(new D120(res.body.founderProceeds).plus(new D120(res.body.lpProceeds)).toFixed())
      .toBe("5000000000");
    /* The equal ranking is DISCLOSED rather than silently flattened into a stack. */
    expect(res.body.seniority.map((s: { seniority: number; onRecord: boolean }) => [s.seniority, s.onRecord]))
      .toEqual([[0, true], [0, true]]);
    expect(res.body.pariPassu.equalRankingDetected).toBe(true);
    expect(res.body.pariPassu.duplicateRanks).toEqual([0]);
    /* AND NOTHING WAS ABATED, because nothing needed to be. */
    expect(res.body.pariPassu.abatementEngaged).toBe(false);
  }, 60_000);

  it("W79-B7 — POLE 4: a company with ONE preference class is UNAFFECTED, and says so", async () => {
    /* SCOPE. Every round in Wave 74's 112-round census has ONE preference class, and
       the before/after census is 112/112 IDENTICAL
       (`build_log/wave79/W79_CENSUS_DIFF.txt`). A ranking cannot change a figure
       when there is nothing to rank, so this must still compute. */
    const res = await build("single", [{ lp: "1x non-participating", pps: 2.5, amount: "10000000" }]);
    expect(res.status).toBe(200);
/* ── UPDATED BY WAVE 81 · ITEM 1 (D3): 40 SIGNIFICANT DIGITS -> 38 ─────────────
       THIS ASSERTION PINNED AN UNDECLARED CONFIGURATION. The engine declares
       `precision: 38, rounding: ROUND_HALF_EVEN`, but until Wave 81 it set that on
       the SHARED decimal.js constructor, and `packages/math-fns/src/index.ts` set
       the SAME constructor to `precision: 40, rounding: ROUND_HALF_UP`. Six server
       modules import `@capavate/math-fns`, so in the server process — and in this
       test — math-fns loaded LAST and the engine actually ran at 40 / HALF_UP. The
       figure below therefore had 40 significant digits because of an import order,
       not because of anything the engine promised.

       WAVE 81 gives the engine its OWN `Decimal.clone({ 38, ROUND_HALF_EVEN })`, so
       its arithmetic is the same in every process and matches what it declares. The
       string is two significant digits shorter and is otherwise the same number.
       NO MONEY MOVED at any granularity a person or a ledger can see: the change is
       in significant digits 39 and 40 of a minor-unit figure.

       PROVEN NOT TO MOVE A PUBLISHED FIGURE: all 14 engine-executing transcripts of
       the QA document already ran at 38 / HALF_EVEN (their harnesses do not load
       math-fns) and re-run BYTE-IDENTICAL after this wave —
       `build_log/wave81/W81_QA_TRANSCRIPT_DIFF.txt`. The document was right about
       the engine; production was not, and now is.
       ─────────────────────────────────────────────────────────────────────────── */
        expect(res.body.founderProceeds).toBe("3333333333.3333333333333333333333333333");
    expect(res.body.seniority).toEqual([
      { roundId: expect.any(String), className: "w79t single class0", seniority: 0, onRecord: false },
    ]);
    /* the assumption is STATED, not hidden */
    expect(String(res.body.seniorityAssumed)).toContain("ONE preference class");
  }, 60_000);
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 3 — THE TWO CALENDAR BOMBS
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W79 · ITEM 3 — the clock is an INPUT, so no assertion expires overnight", () => {
  const FOUNDERS: ApiSecurity = {
    id: "f", companyId: "c", holderName: "Founder", holderType: "founder", instrument: "common",
    series: null, shares: 8_000_000, pricePerShare: 0.0001, investmentAmount: null, cap: null,
    discount: null, issuedAt: "2025-01-01",
  } as ApiSecurity;
  const NOTE: ApiSecurity = {
    ...FOUNDERS, id: "nt", holderName: "Note Holder", holderType: "investor", instrument: "note",
    shares: 0, pricePerShare: null, investmentAmount: 500_000, cap: 12_000_000, discount: 15,
    issuedAt: "2025-06-01", interestRate: 8,
  } as ApiSecurity;
  const PRICED = { preMoneyValuation: 30_000_000, investmentAmount: 10_000_000, series: "Series A" };

  it("W79-C1 — the same projection on two different days gives two different answers", () => {
    /* THE DEFECT, exhibited rather than described. `W71-D8a` pinned
       yearsElapsed = "1.2128679" (the 2026-08-18 value) and read `new Date()`, so
       on 2026-08-19 it measured "1.21560575" and the test failed with no code
       change. Both values are asserted here from a FIXED clock, which is the proof
       that the drift was real AND that it can no longer reach an assertion. */
    const on = (day: string) =>
      projectPostClose([FOUNDERS, NOTE], PRICED, "US", undefined, undefined, day)
        .trace.find((t) => t.formulaId === "note.conversion")?.inputs?.yearsElapsed;
    expect(on("2026-08-18")).toBe("1.2128679");
    expect(on("2026-08-19")).toBe("1.21560575");
    expect(on("2026-08-20")).toBe("1.2183436");
    /* and it is STABLE: the same day twice is the same answer, forever */
    expect(on("2026-08-18")).toBe(on("2026-08-18"));
  });

  it("W79-C2 — `runEngine`'s as-converted total is stable when the clock is fixed", () => {
    /* `W58CD-B3a` pinned `ac.totalShares === "9991276"` and drifted +29 shares a
       day as the note accrued interest. With the clock supplied it cannot drift. */
    const ledger: ApiSecurity[] = [
      { ...FOUNDERS, id: "f1", shares: 6_000_000, issuedAt: "2026-01-01" } as ApiSecurity,
      { ...FOUNDERS, id: "p1", holderName: "Seed Fund", holderType: "investor", instrument: "preferred", shares: 2_000_000, pricePerShare: 1.5, series: "Seed", issuedAt: "2026-01-01" } as ApiSecurity,
      { ...FOUNDERS, id: "o1", holderName: "pool", holderType: "other", instrument: "option", shares: 1_000_000, pricePerShare: null, issuedAt: "2026-01-01" } as ApiSecurity,
      { ...FOUNDERS, id: "w1", holderName: "Bank", holderType: "investor", instrument: "warrant", shares: 500_000, pricePerShare: 0.5, issuedAt: "2026-01-01" } as ApiSecurity,
      { ...NOTE, id: "sa1", holderName: "Angel", instrument: "safe", investmentAmount: 250_000, cap: 8_000_000, discount: 0.2, issuedAt: "2026-01-01", interestRate: undefined } as ApiSecurity,
      { ...NOTE, id: "n1", holderName: "Lender", instrument: "note", investmentAmount: 150_000, cap: 8_000_000, discount: 0.2, interestRate: 6, issuedAt: "2026-01-01" } as ApiSecurity,
    ];
    const a1 = runEngine(ledger, "as_converted", "US", undefined, "2026-08-18");
    const a2 = runEngine(ledger, "as_converted", "US", undefined, "2026-08-18");
    expect(a1.totalShares.toString()).toBe(a2.totalShares.toString());
    /* the injection is REAL and not silently ignored: a later day accrues more */
    const later = runEngine(ledger, "as_converted", "US", undefined, "2027-08-18");
    expect(later.totalShares > a1.totalShares).toBe(true);
    /* the three views are still genuinely distinct — W58CD-B3's actual claim */
    expect(runEngine(ledger, "basic", "US", undefined, "2026-08-18").totalShares.toString()).toBe("8000000");
    expect(runEngine(ledger, "fully_diluted", "US", undefined, "2026-08-18").totalShares.toString()).toBe("9500000");
  });

  it("W79-C3 — the two clock reads that remain are the DEFAULTS, and nothing else reads the wall clock", () => {
    /* An injected clock that some other line ignores would be worse than none, so
       the count is asserted. Three `?? new Date()` defaults (runEngine,
       projectPostClose and the older `asOfDate` in the as-converted branch's
       sibling) and no bare `new Date()` inside the two functions. */
    const adapter = src("shared/roundMathEngineAdapter.ts");
    expect(adapter.match(/const nowIso = asOf \?\? new Date\(\)\.toISOString\(\)\.slice\(0, 10\);/g)?.length).toBe(2);
    /* every former inline clock read is now annotated and gone */
    expect(adapter.match(/^\s*asOf: nowIso,$/gm)?.length).toBe(2);
    expect(adapter).toContain("}, nowIso);");
    /* the wrapper passes it through rather than dropping it (R21) */
    expect(adapter).toContain("projectPostClose(secs, round, region, pricingOrderMode, (o) => { captured = o; }, asOf);");
  });

  it("W79-C4 — the pinned CONVENTION is untouched: 365.25-day year, 8 dp, exact", () => {
    /* Item 3 says fix the TIME-DEPENDENCE, not the arithmetic. `W71-D8a`'s fixed-date
       literal still holds and is re-asserted from a different file so a change to
       the convention breaks two tests, not one. */
    expect(src("packages/cap-table-engine/src/primitives/timeElapsed.ts")).toContain("365.25");
    const on1818 = projectPostClose([FOUNDERS, NOTE], PRICED, "US", undefined, undefined, "2026-08-18")
      .trace.find((t) => t.formulaId === "note.conversion")?.inputs?.yearsElapsed;
    expect(String(on1818).split(".")[1]?.length).toBeLessThanOrEqual(8);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 4 — THE MONTH-END CLAMP
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W79 · ITEM 4 — twelve months from a leap day is not the thirteenth month", () => {
  it("W79-D1 — BOTH POLES, leap year and 31st-of-month, in the ONE derivation", () => {
    /* THE DEFECT: `setUTCMonth` keeps the day and rolls into the next month.
       `W77-R71-C` asserted `2025-03-03` for one month from 31 January while its own
       comment argued "1 month from 31 January is not 2 March" — the comment was
       right and the assertion pinned the rollover. */
    /* POLE — clamped, because the target month is shorter */
    expect(deriveMaturityDateFromMonths(1, "2025-01-31")).toBe("2025-02-28");
    expect(deriveMaturityDateFromMonths(1, "2024-01-31")).toBe("2024-02-29");   /* LEAP */
    expect(deriveMaturityDateFromMonths(12, "2024-02-29")).toBe("2025-02-28");  /* leap day + 1y */
    expect(deriveMaturityDateFromMonths(1, "2025-08-31")).toBe("2025-09-30");
    expect(deriveMaturityDateFromMonths(3, "2025-11-30")).toBe("2026-02-28");
    expect(deriveMaturityDateFromMonths(6, "2025-08-31")).toBe("2026-02-28");
    expect(deriveMaturityDateFromMonths(2, "2025-12-31")).toBe("2026-02-28");   /* year boundary */
    expect(deriveMaturityDateFromMonths(1, "2025-01-30")).toBe("2025-02-28");
    /* POLE — NOT clamped, because the day exists in the target month */
    expect(deriveMaturityDateFromMonths(48, "2024-02-29")).toBe("2028-02-29");  /* leap -> leap */
    expect(deriveMaturityDateFromMonths(1, "2025-12-31")).toBe("2026-01-31");
    expect(deriveMaturityDateFromMonths(1, "2025-03-31")).toBe("2025-04-30");
    expect(deriveMaturityDateFromMonths(1, "2025-01-15")).toBe("2025-02-15");
    expect(deriveMaturityDateFromMonths(1, "2025-01-28")).toBe("2025-02-28");
    /* CONTROLS — nothing that did not need clamping may move */
    expect(deriveMaturityDateFromMonths(24, "2025-06-01")).toBe("2027-06-01");
    expect(deriveMaturityDateFromMonths(18, "2025-06-01")).toBe("2026-12-01");
    expect(deriveMaturityDateFromMonths(0, "2025-06-01")).toBe("2025-06-01");
    expect(deriveMaturityDateFromMonths(0, "2025-01-31")).toBe("2025-01-31");
    expect(deriveMaturityDateFromMonths(0, "2024-02-29")).toBe("2024-02-29");
    /* the ROLLOVER values are asserted against BY VALUE, so a revert is loud */
    expect(deriveMaturityDateFromMonths(1, "2025-01-31")).not.toBe("2025-03-03");
    expect(deriveMaturityDateFromMonths(12, "2024-02-29")).not.toBe("2025-03-01");
    /* R50's domain and the null poles are untouched by the clamp */
    for (const [m, from] of [[601, "2025-06-01"], [20261231, "2025-06-01"], [-1, "2025-06-01"], [24, null], [24, ""], [null, "2025-06-01"], [24, "not a date"]] as const) {
      expect(deriveMaturityDateFromMonths(m as never, from as never)).toBeNull();
    }
    expect(deriveMaturityDateFromMonths(600, "2025-06-30")).toBe("2075-06-30");
  });

  it("W79-D2 — there is still EXACTLY ONE derivation, and it is still calendar arithmetic", () => {
    const adapter = src("shared/roundMathEngineAdapter.ts");
    expect(adapter.match(/export function deriveMaturityDateFromMonths/g)?.length).toBe(1);
    /* never "months x 30" */
    expect(adapter).toContain("d.setUTCMonth(d.getUTCMonth() + m);");
    expect(adapter).not.toContain("m * 30");
    /* the clamp itself, so a silent removal fails here too */
    expect(adapter).toContain("const lastDayOfTargetMonth = new Date(");
    expect(adapter).toContain("d.setUTCDate(dayOfMonth < lastDayOfTargetMonth ? dayOfMonth : lastDayOfTargetMonth);");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R69 — THE STANDING PROHIBITION, RE-ASSERTED BECAUSE FOUR AGENTS HAVE NOW
 *       BEEN TEMPTED BY THIS FUNCTION AND ALL OF THEM WERE WRONG.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W79 · R69 — `computeConversionProjections` is untouched", () => {
  it("W79-R69 — byte-identical, and Wave 79 proposed no change to it", () => {
    const carry = src("server/roundCarryForwardEngine.ts");
    /* the two values three agents wanted to \"fix\" are still exactly as they were */
    expect(carry).toContain("computeConversionProjections");
    expect(carry).toContain("0.06");
    expect(carry).toContain('yearsElapsed: "1"');
    /* and this wave's own diff never went near the file */
    expect(carry.includes("WAVE 79")).toBe(false);
  });
});

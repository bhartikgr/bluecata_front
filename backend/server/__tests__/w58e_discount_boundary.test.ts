/**
 * WAVE 58e — THE DISCOUNT UNIT BOUNDARY (D1), THE CORRUPTION GUARD (D2) AND THE
 * INVESTOR-GRADE DISCLOSURE (D3), PROVED THROUGH HTTP ROUTES AND BY EXECUTING THE
 * SHARED MODULES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * PROVED HERE
 *   · `POST /api/rounds` and `PATCH /api/rounds/:id/terms` STORE a discount of
 *     `20` percent-as-written and READ it back as `20` — no conversion at storage.
 *   · Both routes now REFUSE `20260707` and `20261231` BY NAME (the live corrupt
 *     values, R31-a), with HTTP status and error code asserted.
 *   · The adapter converts `20` to the engine wire fraction `0.2` and the engine
 *     prices the conversion at exactly $0.80 on a $1.00 round.
 *   · `InvalidDiscountWireValueError` SURVIVES and is still the arbiter: it is
 *     unchanged, still refuses `20` as a WIRE value, and still refuses the corrupt
 *     row after conversion.
 *   · Cap-and-discount takes the LOWER price, executed both ways round.
 *
 * NOT PROVED HERE
 *   · No browser is opened. That a founder's CLICK produces these payloads is
 *     asserted against the JSX source, not a rendered DOM — the same gap 58b and
 *     58cd recorded. It is listed as UNVERIFIED in `WAVE58E_REPORT.md`.
 *   · Nothing is proved on the LIVE server. The live evidence this wave builds on
 *     was verified on 2026-08-15 and is cited, not re-derived.
 *   · The ORIGIN of the live corruption is NOT established. What is established is
 *     that an identical write was possible through `PATCH .../terms` before this
 *     wave and is refused after it. See `W58E_CORRUPTION.md`.
 *
 * MUTATION TRANSCRIPTS: `build_log/wave58e/W58E_NEW_TESTS.md`. Every test names the
 * single source edit that turns it red, with the recorded output.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import {
  toWireDiscount,
  readDiscountFraction,
  InvalidDiscountWireValueError,
  adaptSecuritiesToEngine,
  runEngine,
  ledgerFullyDilutedPreMoneyShares,
  tryLedgerFullyDilutedPreMoneyShares,
  validateDiscountPercentAsWritten,
  validateInterestRatePercentAsWritten,
  describeDiscount,
  DISCOUNT_STORAGE_UNIT,
  DISCOUNT_WIRE_UNIT,
  DISCOUNT_STORED_PERCENT_MAX,
  DISCOUNT_MARKET_NORM_MIN,
  DISCOUNT_MARKET_NORM_MAX,
  type ApiSecurity,
} from "@shared/roundMathEngineAdapter";

let app: Express;
const STAMP = String(Date.now());
const CO = `co_w58e_${STAMP}`;
const ADMIN = "u_admin";

/* Source reads are anchored to THIS FILE, never to `process.cwd()` —
   `W58B_REVIEW_1_MATH.md` §5 recorded ten checks failing in an independent rerun
   purely because they resolved sources from the launch directory. */
const ROOT = path.resolve(__dirname, "..", "..");
const src = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const sec = (o: Partial<ApiSecurity>): ApiSecurity =>
  ({
    id: "s1", companyId: CO, holderName: "H", holderType: "investor", instrument: "common",
    series: null, shares: 0, pricePerShare: null, investmentAmount: null, cap: null,
    discount: null, issuedAt: "2026-01-01", ...o,
  }) as ApiSecurity;

async function createRound(payload: Record<string, unknown>) {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send({ openDate: "2026-01-01", closeDate: "2026-12-31", ...payload });
  return { status: res.status, body: res.body as Record<string, any> };
}

async function patchTerms(roundId: string, body: Record<string, unknown>) {
  const res = await request(app)
    .patch(`/api/rounds/${roundId}/terms`)
    .set("x-user-id", ADMIN)
    .send(body);
  return { status: res.status, body: res.body as Record<string, any> };
}

async function getRound(roundId: string) {
  const res = await request(app).get(`/api/rounds/${roundId}`).set("x-user-id", ADMIN);
  expect(res.status).toBe(200);
  return res.body as Record<string, any>;
}

let noteRoundId = "";

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 90_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * D1 — THE UNIT BOUNDARY
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58E-D1 — the discount crosses the storage/engine boundary exactly once", () => {
  it("W58E-D1a — the two units are DECLARED, not inferred, and the schema says percent", () => {
    /* R16 forbids reading a unit off a magnitude. The only defensible basis for a
       conversion is a DECLARED unit on each side, so both are named in code. */
    expect(DISCOUNT_STORAGE_UNIT).toBe("percent_as_written");
    expect(DISCOUNT_WIRE_UNIT).toBe("fraction_0_to_1");
    const schema = src("shared/schema.ts");
    expect(schema).toContain('discount: real("discount"),       // SAFE/Note discount %');
    expect(schema).toContain('discountPct: text("discount_pct"),           // Decimal-as-string (e.g. "20" = 20%)');
    /* And the engine's formula direction, quoted from the engine itself: × (1 − d),
       NOT × d. There is no Discount/Discount-Rate inversion to fix. */
    const views = src("packages/cap-table-engine/src/captable/views.ts");
    expect(views).toContain("const discountPrice = pps.mul(D(1).minus(discount));");
    expect(views).not.toContain("pps.mul(discount)");
  });

  it("W58E-D1b — 20 (stored percent) becomes 0.2 (wire fraction), exactly, and the stored value is preserved", () => {
    const w = toWireDiscount(20, "s1");
    expect(w).toBeDefined();
    expect(w!.wireFraction).toBe("0.2");     // exact decimal string, not a float artefact
    expect(w!.asNumber).toBe(0.2);
    expect(w!.storedPercent).toBe("20");
    /* A spread of values, all converted unconditionally. */
    expect(toWireDiscount(15, "s")!.wireFraction).toBe("0.15");
    expect(toWireDiscount(12.5, "s")!.wireFraction).toBe("0.125");
    expect(toWireDiscount("20", "s")!.wireFraction).toBe("0.2");
    expect(toWireDiscount(0, "s")!.wireFraction).toBe("0");
    expect(toWireDiscount(100, "s")!.wireFraction).toBe("1");
    /* ABSENT IS NOT ZERO. */
    expect(toWireDiscount(null, "s")).toBeUndefined();
    expect(toWireDiscount(undefined, "s")).toBeUndefined();
    expect(toWireDiscount("", "s")).toBeUndefined();
  });

  it("W58E-D1c — the conversion NEVER sniffs the magnitude: 0.2 becomes 0.002, not 0.2", () => {
    /* This is the whole difference between this wave and the heuristic R16 forbids.
       `discount > 1 ? discount/100 : discount` would leave 0.2 alone; a DECLARED
       unit converts it, and the screens print what it will mean. */
    expect(toWireDiscount(0.2, "s")!.wireFraction).toBe("0.002");
    expect(toWireDiscount(1, "s")!.wireFraction).toBe("0.01");
    expect(toWireDiscount(0.5, "s")!.wireFraction).toBe("0.005");
    /* And the forbidden heuristic is not present in executable code. */
    const adapter = src("shared/roundMathEngineAdapter.ts");
    const executable = adapter
      .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
      .replace(/^\s*\/\/.*$/gm, "");      // line comments
    expect(executable).not.toMatch(/discount\s*>\s*1\s*\?/);
    expect(executable).not.toMatch(/>\s*1\s*\?[^:]*\/\s*100/);
    expect(executable).toContain("readDiscountFraction");
  });

  it("W58E-D1d — THE GUARD SURVIVES: readDiscountFraction is unchanged and still refuses percent-scale wire values", () => {
    /* The single most important assertion in this wave. `InvalidDiscountWireValueError`
       is a SAFETY NET: without it a percent-as-written value reaching `× (1 − d)`
       prices a $1.00 round at −$19.00. Waves 58c/58d were right to refuse to
       "fix" it. */
    expect(readDiscountFraction(0.2, "s")).toBe(0.2);
    expect(readDiscountFraction(1, "s")).toBe(1);
    expect(() => readDiscountFraction(20, "s")).toThrow(InvalidDiscountWireValueError);
    expect(() => readDiscountFraction(100, "s")).toThrow(InvalidDiscountWireValueError);
    expect(() => readDiscountFraction(-0.1, "s")).toThrow(InvalidDiscountWireValueError);
    /* Its message still states the contract in both directions. */
    try {
      readDiscountFraction(20, "sX");
      throw new Error("did not throw");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain("INVALID_DISCOUNT_FRACTION");
      expect(m).toContain("FRACTIONAL on the wire");
      expect(m).toContain("rejected rather than rescaled");
    }
  });

  it("W58E-D1e — the corrupt live value 20260707 is REFUSED, not converted, AFTER the conversion runs", () => {
    /* 20260707 / 100 = 202607.07, which is outside [0,1], so the surviving guard
       rejects it. The refusal names the STORED value, which is the number on the
       founder's screen and in the row. */
    expect(() => toWireDiscount(20260707, "corrupt")).toThrow(InvalidDiscountWireValueError);
    try {
      toWireDiscount(20260707, "corrupt");
    } catch (e) {
      expect((e as Error).message).toContain("20260707");
      expect((e as Error).name).toBe("InvalidDiscountWireValueError");
    }
    for (const bad of [-5, 100.0001, 1e9, "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => toWireDiscount(bad, "s")).toThrow(InvalidDiscountWireValueError);
    }
  });

  it("W58E-D1f — the ENGINE PAYLOAD carries the fraction on both SAFE and note, and refuses the corrupt row", () => {
    /* WAVE 70 · D6 — `interestRate: 6` ADDED TO THE NOTE FIXTURE, and the
       assertion below is UNCHANGED. This test is about the DISCOUNT boundary and
       it still proves exactly that. What changed underneath it is that a
       convertible note with NO interest rate on record now REFUSES
       (`MissingNoteInterestRateError`) instead of being silently priced at a
       hardcoded 5% APR: the founder's typed rate previously reached no
       arithmetic anywhere in the tree. A fixture that omitted the rate was
       relying on that hardcoded default, so it is completed rather than the
       refusal being weakened. The refusal itself is asserted at both poles in
       `server/__tests__/w70_round_math_correctness.test.ts` (W70-D6c/W70-D6d). */
    const built = adaptSecuritiesToEngine([
      sec({ id: "safe20", instrument: "safe", investmentAmount: 100_000, cap: 5_000_000, discount: 20 }),
      sec({ id: "note20", instrument: "note", investmentAmount: 100_000, cap: 5_000_000, discount: 20, interestRate: 6 }),
    ]);
    const wire = (built.transactions as Array<Record<string, any>>).map(
      (t) => t.security.safe?.discount ?? t.security.note?.discount,
    );
    expect(wire).toEqual(["0.2", "0.2"]);
    /* THE REGRESSION POLE, DELIBERATELY UNCHANGED. WAVE 70 layers a STATE-domain
       check ([0,100), which catches a legacy stored `100`) on top of the WIRE
       guard, and the ORDER matters: `toWireDiscount` still runs FIRST, so
       `20260707` still raises `InvalidDiscountWireValueError` and not the new
       class. If that order were ever reversed this assertion fails, which is
       precisely what it is for. The note still carries no rate here on purpose —
       the discount refusal must fire BEFORE the interest-rate refusal, because it
       is the more specific corruption. */
    expect(() =>
      adaptSecuritiesToEngine([sec({ instrument: "note", investmentAmount: 1000, discount: 20260707 })]),
    ).toThrow(InvalidDiscountWireValueError);
  });

  it("W58E-D1g — END TO END: a SAFE with discount 20 on a $1.00 round converts at EXACTLY $0.80", () => {
    /* One priced position sets the estimated round price at exactly $1.00 so the
       conversion price is directly readable from the share count. Independently
       recomputed with exact decimals in `build_log/wave58e/w58e_exact_math.py`. */
    const ledger: ApiSecurity[] = [
      sec({ id: "p1", holderName: "Seed Fund", instrument: "preferred", shares: 1_000_000, pricePerShare: 1.0, issuedAt: "2026-02-01" }),
      sec({ id: "sa1", holderName: "Angel", instrument: "safe", investmentAmount: 100_000, cap: null, discount: 20, issuedAt: "2026-03-01" }),
    ];
    const ac = runEngine(ledger, "as_converted");
    const angel = ac.rows.find((r) => r.holderName === "Angel");
    expect(angel).toBeDefined();
    /* $100,000 / $0.80 = 125,000 shares. At $1.00 undiscounted it would be 100,000. */
    expect(angel!.shares.toString()).toBe("125000");
    expect(100_000 / Number(angel!.shares)).toBeCloseTo(0.8, 10);
    /* THE FALSIFIER: with no discount the same money buys 100,000 shares, so the
       125,000 above is caused by the discount and not by the fixture. */
    const noDisc = runEngine(
      ledger.map((s) => (s.instrument === "safe" ? { ...s, discount: null } : s)),
      "as_converted",
    );
    expect(noDisc.rows.find((r) => r.holderName === "Angel")!.shares.toString()).toBe("100000");
  });

  it("W58E-D1h — a stored 20 no longer takes the render-scope ledger read to a refusal; the corrupt row still does", () => {
    const ok = tryLedgerFullyDilutedPreMoneyShares([
      sec({ instrument: "safe", investmentAmount: 100_000, cap: 5_000_000, discount: 20 }),
    ]);
    expect(ok.ok).toBe(true);
    const bad = tryLedgerFullyDilutedPreMoneyShares([
      sec({ instrument: "note", investmentAmount: 100_000, discount: 20260707 }),
    ]);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.code).toBe("ledger_unreadable");
    expect(bad.detail).toContain("20260707");
    /* Still no rescaling claim anywhere in the founder-facing copy. */
    expect(bad.reason).toMatch(/will not guess/i);
    expect(bad.reason).not.toMatch(/has been assumed|interpreted as 20%/i);
    /* The THROWING form is untouched — the server calls it inside its handler try. */
    expect(() =>
      ledgerFullyDilutedPreMoneyShares([sec({ instrument: "note", investmentAmount: 1, discount: 20260707 })]),
    ).toThrow(InvalidDiscountWireValueError);
  });

  it("W58E-D1i — CAP AND DISCOUNT: the LOWER implied price governs, proved in both directions", () => {
    const base = (cap: number | null) => [
      sec({ id: "p1", holderName: "Seed Fund", instrument: "preferred", shares: 1_000_000, pricePerShare: 1.0, issuedAt: "2026-02-01" }),
      sec({ id: "sa1", holderName: "Angel", instrument: "safe", investmentAmount: 100_000, cap, discount: 20, issuedAt: "2026-03-01" }),
    ];
    /* cap $5m over 1,000,000 FD shares implies $5.00 — far above the $0.80
       discounted price, so the DISCOUNT governs. */
    const discountGoverns = runEngine(base(5_000_000), "as_converted");
    expect(discountGoverns.rows.find((r) => r.holderName === "Angel")!.shares.toString()).toBe("125000");
    /* ═══════════════════════════════════════════════════════════════════════
       WAVE 70 · D4 — 200,000 WAS THE DEFECT. THE CORRECT NUMBER IS 250,000.
       ═══════════════════════════════════════════════════════════════════════
       WHAT THIS ASSERTION WAS ACTUALLY PINNING. The As-Converted preview had its
       own private conversion (`safeConvertedShares`) which applied the cap on a
       PRE-MONEY basis — `cap ÷ fdShares` = $500,000 ÷ 1,000,000 = $0.50 —
       while the SAME instrument converting at close went through
       `compute.ts:576-606`, which re-bases the denominator so a POST-MONEY cap
       includes the SAFE's own shares. Two implementations of one rule, and this
       line pinned the wrong one.

       THE CORRECT ARITHMETIC, and it is checkable by hand from the definition.
       A post-money SAFE at a $500,000 post-money cap owns
       $100,000 ÷ $500,000 = 20% of the post-money company. With 1,000,000
       existing shares:
           effectiveCap = 500,000 − 100,000 = 400,000
           rebased      = 1,000,000 × 500,000 ÷ 400,000 = 1,250,000
           capPrice     = 500,000 ÷ 1,250,000 = $0.40
           shares       = 100,000 ÷ 0.40      = 250,000
           check        = 250,000 ÷ (1,000,000 + 250,000) = 20.00%   ✓
       The old 200,000 gives 200,000 ÷ 1,200,000 = 16.67% — the exact defect the
       engine's own v25.20 Lane 2 NC1 fix corrected AT CLOSE and which this
       preview had kept.

       AUTHORITY: YC post-money SAFE user guide, "Company Capitalization" —
       https://www.ycombinator.com/documents ·
       https://www.ycombinator.com/blog/announcing-the-post-money-safe

       THE OTHER POLE ABOVE IS UNCHANGED AT 125,000, which is what makes this a
       correction and not a re-baselining: the discount-governs case does not
       move, because re-basing only touches the cap candidate. */
    const capGoverns = runEngine(base(500_000), "as_converted");
    expect(capGoverns.rows.find((r) => r.holderName === "Angel")!.shares.toString()).toBe("250000");
    /* And the post-money definition itself, asserted rather than implied. */
    expect(
      Number(capGoverns.rows.find((r) => r.holderName === "Angel")!.shares) /
        Number(capGoverns.totalShares),
    ).toBeCloseTo(0.2, 10);
    /* And the rule is the engine's, quoted: it keeps the smallest candidate price. */
    const views = src("packages/cap-table-engine/src/captable/views.ts");
    expect(views).toContain("for (const c of candidates) if (c.lt(chosen)) chosen = c;");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D2 — THE CORRUPTION GUARD, THROUGH THE HTTP WRITERS
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58E-D2 — neither HTTP writer can store a date in a term field any more", () => {
  it("W58E-D2a — POST /api/rounds STORES discount 20 percent-as-written and reads it back as 20", async () => {
    const r = await createRound({
      companyId: CO, name: `W58E Note ${STAMP}`, type: "preseed", instrument: "convertible_note",
      targetAmount: 600_000, valuationCap: 9_000_000, discount: 20, interestRate: 6, maturityMonths: 24,
    });
    expect(r.status).toBe(200);
    noteRoundId = String(r.body.id);
    const back = await getRound(noteRoundId);
    /* NO CONVERSION AT STORAGE (R30 / R16). The API returns exactly what live
       returns on its clean records: 20. */
    expect(Number(back.discount)).toBe(20);
    expect(Number(back.interestRate)).toBe(6);
    /* 20% is inside the 10–20% market norm, so there is nothing to warn about. */
    expect(r.body.termWarnings).toBeUndefined();
  });

  it("W58E-D2b — POST /api/rounds REFUSES the live corrupt values BY NAME", async () => {
    const bad = await createRound({
      companyId: CO, name: `W58E Corrupt ${STAMP}`, type: "preseed", instrument: "convertible_note",
      targetAmount: 600_000, valuationCap: 9_000_000, discount: 20260707, interestRate: 20261231, maturityMonths: 24,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_discount");
    expect(String(bad.body.message)).toContain("less than 100");
    expect(String(bad.body.message)).toContain("20260707");
    /* And the interest-rate half, isolated. */
    const badRate = await createRound({
      companyId: CO, name: `W58E Corrupt2 ${STAMP}`, type: "preseed", instrument: "convertible_note",
      targetAmount: 600_000, valuationCap: 9_000_000, discount: 20, interestRate: 20261231, maturityMonths: 24,
    });
    expect(badRate.status).toBe(400);
    expect(badRate.body.error).toBe("invalid_interestRate");
    expect(String(badRate.body.message)).toContain("20261231");
  });

  it("W58E-D2c — PATCH /api/rounds/:id/terms REFUSES 20260707 and does NOT persist it", async () => {
    expect(noteRoundId).not.toBe("");
    const before = await getRound(noteRoundId);
    const bad = await patchTerms(noteRoundId, { discount: 20260707 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_discount");
    const after = await getRound(noteRoundId);
    /* THE VALUE DID NOT MOVE. A refusal that still writes is not a refusal. */
    expect(Number(after.discount)).toBe(Number(before.discount));
    const badRate = await patchTerms(noteRoundId, { interestRate: 20261231 });
    expect(badRate.status).toBe(400);
    expect(badRate.body.error).toBe("invalid_interestRate");
    expect(Number((await getRound(noteRoundId)).interestRate)).toBe(Number(before.interestRate));
  });

  it("W58E-D2c2 — the stored value is UNCHANGED after an attempted corrupt patch, asserted on its own", async () => {
    /* SEPARATE FROM D2c ON PURPOSE. `expect` throws, so once D2c's status assertion
       fails nothing after it runs — and the assertion that actually matters is that
       the DATABASE did not move. This test asserts ONLY that, so mutation M2
       (reinstating the pre-58e `numericTerm` line) reports the PERSISTENCE of
       20260707 rather than only the 200. */
    const before = Number((await getRound(noteRoundId)).discount);
    await patchTerms(noteRoundId, { discount: 20260707 });
    expect(Number((await getRound(noteRoundId)).discount)).toBe(before);
    await patchTerms(noteRoundId, { interestRate: 20261231 });
    expect(Number((await getRound(noteRoundId)).interestRate)).not.toBe(20261231);
  });

  it("W58E-D2d — a LEGAL edit still lands, so the guard is not a block on ordinary work", async () => {
    const ok = await patchTerms(noteRoundId, { discount: 15, interestRate: 8 });
    expect(ok.status).toBe(200);
    const back = await getRound(noteRoundId);
    expect(Number(back.discount)).toBe(15);
    expect(Number(back.interestRate)).toBe(8);
    expect(ok.body.termWarnings).toBeUndefined(); // 15% is inside the norm
  });

  it("W58E-D2e — outside the 10–20% market norm the value is STORED and WARNED, never blocked (R30.5)", async () => {
    const warned = await patchTerms(noteRoundId, { discount: 35 });
    expect(warned.status).toBe(200);
    expect(Array.isArray(warned.body.termWarnings)).toBe(true);
    expect(String(warned.body.termWarnings[0])).toContain("market norm");
    expect(String(warned.body.termWarnings[0])).toContain("not a rejection");
    /* STORED AS WRITTEN. A warning that changes the value is a rescale. */
    expect(Number((await getRound(noteRoundId)).discount)).toBe(35);
    /* And the same on the way in. */
    const created = await createRound({
      companyId: CO, name: `W58E Warn ${STAMP}`, type: "preseed", instrument: "safe_post",
      targetAmount: 500_000, valuationCap: 5_000_000, discount: 40,
    });
    expect(created.status).toBe(200);
    expect(String(created.body.termWarnings?.[0] ?? "")).toContain("market norm");
    expect(Number((await getRound(String(created.body.id))).discount)).toBe(40);
    /* restore a sane value for any later reader of this round */
    await patchTerms(noteRoundId, { discount: 20 });
  });

  it("W58E-D2f — `0.2` is ACCEPTED as two tenths of one percent and NEVER rescaled to 20", async () => {
    /* R16: magnitude is not evidence of unit. The platform must not guess, and it
       must not refuse a legitimate small discount either. The screens print what it
       will mean; the route stores what was sent. */
    const r = await patchTerms(noteRoundId, { discount: 0.2 });
    expect(r.status).toBe(200);
    expect(Number((await getRound(noteRoundId)).discount)).toBe(0.2);
    expect(String(r.body.termWarnings?.[0] ?? "")).toContain("decimal slip");
    await patchTerms(noteRoundId, { discount: 20 });
  });

  it("W58E-D2g — ABSENT is untouched: a patch without the field does not reset it to zero", async () => {
    const before = Number((await getRound(noteRoundId)).discount);
    const r = await patchTerms(noteRoundId, { termsSummary: `untouched ${STAMP}` });
    expect(r.status).toBe(200);
    expect(Number((await getRound(noteRoundId)).discount)).toBe(before);
  });

  it("W58E-D2h — ONE rule, not two: both writers call the SAME shared validator", () => {
    const routes = src("server/routes.ts");
    /* WAVE 61b · R50 — UPDATED, NOT WEAKENED. This was one `toContain` over the
       exact three-line import block. Wave 61b adds five SIBLING validators to the
       same import (R50: `maturityMonths`, `expiryYears`, `strikePrice`,
       `valuationCap`, `fdPreMoneyShares`), so the contiguous string no longer
       matches. The ASSERTION IS THE SAME CLAIM — both names are imported from the
       one shared module — and it is now made per name plus the module path, which
       is stricter about the names and looser only about their adjacency. */
    expect(routes).toContain("validateDiscountPercentAsWritten,");
    expect(routes).toContain("validateInterestRatePercentAsWritten,");
    expect(routes).toContain('} from "@shared/roundMathEngineAdapter"');
    /* The old sentence that let a date through is no longer applied to these two
       fields. `numericTerm` still exists for the others and is untouched. */
    expect(routes).not.toContain('if (numericTerm("discount")) return;');
    expect(routes).not.toContain('if (numericTerm("interestRate")) return;');
    /* WAVE 61b · R50 — `valuationCap` was the witness that `numericTerm` survived
       for the unfenced fields. The owner has since bounded it (R50), so the
       witness moves to a field R50 explicitly leaves unbounded. SAME CLAIM: the
       helper still exists and is still applied. */
    expect(routes).toContain('if (numericTerm("targetAmount")) return;');
    expect(routes).not.toContain('if (numericTerm("valuationCap")) return;');
    /* And the range itself is declared once. */
    expect(DISCOUNT_STORED_PERCENT_MAX).toBe(100);
    expect(DISCOUNT_MARKET_NORM_MIN).toBe(10);
    expect(DISCOUNT_MARKET_NORM_MAX).toBe(20);
  });

  it("W58E-D2i — the range rule itself, executed across the boundary values", () => {
    for (const good of [0, 0.2, 10, 15, 20, 20.5, 99.9999, "20"]) {
      expect(validateDiscountPercentAsWritten(good).ok).toBe(true);
    }
    for (const bad of [-0.0001, 100, 100.5, 20260707, "abc", Number.NaN]) {
      const v = validateDiscountPercentAsWritten(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toBe("invalid_discount");
    }
    /* Blank is not an error and not a zero. */
    const blank = validateDiscountPercentAsWritten("");
    expect(blank.ok).toBe(true);
    if (blank.ok) expect(blank.percent).toBe("");
    /* Interest rate: [0,100]. */
    for (const good of [0, 4, 6, 8, 100]) expect(validateInterestRatePercentAsWritten(good).ok).toBe(true);
    for (const bad of [-1, 100.01, 20261231]) {
      const v = validateInterestRatePercentAsWritten(bad);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toBe("invalid_interestRate");
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * D3 — THE DISCLOSURE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58E-D3 — both forms, the price, the arithmetic, and the glossary", () => {
  it("W58E-D3a — describeDiscount states BOTH forms and the exact conversion price", () => {
    const d = describeDiscount(20, "1.00")!;
    expect(d.discountPercent).toBe("20");
    expect(d.discountRatePercent).toBe("80");        // the YC SAFE form's term
    expect(d.wireFraction).toBe("0.2");
    expect(d.bothForms).toContain("20% discount");
    expect(d.bothForms).toContain("pays 80% of the round price");
    expect(d.bothForms).toContain("Discount Rate of 80%");
    expect(d.conversionArithmetic).toBe("$1 × (1 − 0.2) = $0.8");
    expect(d.conversionPrice).toBe("0.8");
    expect(d.marketNormNote).toBeNull();             // 20% is the modal market value
    expect(d.refusal).toBeNull();
    /* The complement is computed, not tabulated. */
    expect(describeDiscount(15, "2.00")!.discountRatePercent).toBe("85");
    expect(describeDiscount(15, "2.00")!.conversionPrice).toBe("1.7");
    expect(describeDiscount("0.2", "1.00")!.discountRatePercent).toBe("99.8");
    expect(describeDiscount("0.2", "1.00")!.conversionPrice).toBe("0.998");
  });

  it("W58E-D3b — with no round price it refuses to invent one, and says so by absence", () => {
    const d = describeDiscount(20, null)!;
    expect(d.bothForms).toContain("Discount Rate of 80%");
    expect(d.conversionArithmetic).toBeNull();
    expect(d.conversionPrice).toBeNull();
    /* Absent input is absent output — never a fabricated 0. */
    expect(describeDiscount(null)).toBeNull();
    expect(describeDiscount("")).toBeNull();
  });

  it("W58E-D3c — an out-of-range stored value produces a REFUSAL, not a number", () => {
    const d = describeDiscount(20260707, "1.00")!;
    expect(d.refusal).not.toBeNull();
    expect(String(d.refusal)).toContain("less than 100");
    expect(d.conversionPrice).toBeNull();
    expect(d.bothForms).toBe("");
  });

  it("W58E-D3d — all three founder surfaces carry the relabel, the disclosure and the arithmetic", () => {
    const wizard = src("client/src/pages/founder/RoundNew.tsx");
    const edit = src("client/src/pages/founder/Rounds.tsx");
    const detail = src("client/src/pages/founder/RoundDetail.tsx");
    /* R30.1 — never a bare "Discount". */
    for (const s of [wizard, edit]) {
      expect(s).toContain("Discount (% off the round price)");
      expect(s).not.toContain("<Label>Discount (%)</Label>");
    }
    expect(detail).toContain('"Discount (% off the round price)"');
    /* R30.2/R30.3 — both forms and the arithmetic, from the SHARED function so the
       three surfaces cannot drift into three different sentences. */
    for (const s of [wizard, edit, detail]) expect(s).toContain("describeDiscount");
    expect(wizard).toContain('data-testid="disc-both-forms"');
    expect(wizard).toContain('data-testid="disc-conversion"');
    expect(wizard).toContain('data-testid="disc-lower-of"');
    expect(wizard).toContain('data-testid="disc-market-norm"');
    expect(edit).toContain('data-testid="edit-disc-both-forms"');
    expect(edit).toContain('data-testid="edit-disc-conversion"');
    /* R30.5 — validated on BOTH input surfaces, refusing by name, save blocked. */
    expect(wizard).toContain("validateDiscountPercentAsWritten(form.discount)");
    expect(wizard).toContain('data-testid="err-discount"');
    expect(edit).toContain("validateDiscountPercentAsWritten(discount)");
    expect(edit).toContain("validateInterestRatePercentAsWritten(interestRate)");
    expect(edit).toContain('data-testid="edit-discount-invalid"');
    expect(edit).toContain('data-testid="edit-save-blocked-term-range"');
    expect(edit).toContain("editPriceContradicted || editTermsOutOfRange");
    /* The authorities are named in the code, per R29. */
    const adapter = src("shared/roundMathEngineAdapter.ts");
    expect(adapter).toContain("wyrick.com/news-insights/safe-financing-valuation-cap-vs-discount-variants");
    expect(adapter).toContain("dlapiper.com/en/insights/publications/2022/08/safe-faqs");
    expect(adapter).toContain("fundersclub.com/learn/safe-primer");
  });

  it("W58E-D3e — the glossary now defines DISCOUNT RATE, keeps DISCOUNT, and cross-references both", async () => {
    const { ENTRIES } = await import("../../client/src/components/Glossary");
    const terms = ENTRIES.map((e) => e.term);
    expect(terms).toContain("Discount");           // R30.4 — the existing entry is KEPT
    expect(terms).toContain("Discount Rate");      // R30.4 — the missing, more dangerous one
    const rate = ENTRIES.find((e) => e.term === "Discount Rate")!;
    expect(rate.definition).toMatch(/complement|after the discount/i);
    expect(rate.definition).toContain("80%");
    expect(String(rate.technicalDefinition)).toContain("quadrupling the intended discount");
    expect(String(rate.technicalDefinition)).toContain("Wyrick");
    const disc = ENTRIES.find((e) => e.term === "Discount")!;
    expect(String(disc.technicalDefinition)).toContain("Discount Rate");
    expect(String(disc.technicalDefinition)).toContain("LOWER");
    /* Searchable under the lower-case phrase that returned 0 of 56 on live. */
    const hay = (e: typeof rate) =>
      [e.term, ...(e.alt ?? []), e.definition, e.technicalDefinition ?? "", e.example ?? ""].join(" ").toLowerCase();
    expect(ENTRIES.filter((e) => hay(e).includes("discount rate")).length).toBeGreaterThanOrEqual(2);
  });
});

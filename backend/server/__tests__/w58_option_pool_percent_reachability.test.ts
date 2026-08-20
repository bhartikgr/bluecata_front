/**
 * WAVE 58 — THE OPTION POOL AS A PERCENTAGE, PROVED THROUGH HTTP ROUTES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AND WHY IT IS A ROUTE TEST
 * ═══════════════════════════════════════════════════════════════════════════
 * Wave 58 was RECOMMENDED on a claim that turned out to be false: that the
 * option-pool denominator defect was reachable in the priced-round path. The
 * live walkthrough of v26.17.0 refuted it — `compute.ts:457-458` is gated on
 * `optionPoolPostPercent`, and the only writer of that field was a hand-crafted
 * query parameter on a route we had added ourselves the wave before. The client
 * never sent it. No user action could reach the arithmetic.
 *
 * So the deliverable of this wave is REACHABILITY, and the only acceptable proof
 * is a route. Every headline assertion below goes through `registerRoutes` and
 * supertest. Nothing here calls `computeEsopTopUp`, `computeCapTable` or the
 * adapter directly for its claim; the engine-level arithmetic has its own file
 * (`packages/cap-table-engine/test/rounding/w58-esop-denominator.test.ts`).
 *
 * THE CLAIM, in one sentence: a PERCENTAGE stored on a round by the ordinary
 * round-creation route makes the round-math route return a DERIVED POOL SHARE
 * COUNT, a LOWER PRICE PER SHARE and DIFFERENT OWNERSHIP PERCENTAGES, with NO
 * query parameter anywhere.
 *
 * MUTATION TRANSCRIPTS are in `build_log/wave58/W58_NEW_TESTS.md`; each test
 * names the single edit that turns it red.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";

let app: Express;
const STAMP = String(Date.now());
const CO = `co_w58_${STAMP}`;
const ADMIN = "u_admin";

/** Every round in this file is created through the PRODUCTION route. */
async function createRound(payload: Record<string, unknown>): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send({ openDate: "2026-01-01", closeDate: "2026-12-31", ...payload });
  if (res.status !== 200) {
    throw new Error(`createRound failed ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.id as string;
}

async function roundMath(roundId: string, query = ""): Promise<Record<string, any>> {
  const res = await request(app)
    .get(`/api/founder/rounds/${roundId}/round-math${query}`)
    .set("x-user-id", ADMIN);
  expect(res.status).toBe(200);
  return res.body as Record<string, any>;
}

const PRICED_BASE = {
  companyId: CO,
  type: "seed",
  state: "active",
  targetAmount: 10_000_000,
  preMoney: 30_000_000,
  currency: "USD",
  instrument: "preferred",
  /* Server-mandatory for a priced round. The engine still DERIVES the price from
     pre-money and the denominator (`projectPostClose` is not handed this value),
     which is precisely why the pool can move it. */
  pricePerShare: 3,
  sharesAuthorized: "3333333",
  /* ══════════════════════════════════════════════════════════════════
     WAVE 58b · DEFECT 3 — THIS FIXTURE VALUE WAS `"10000000"` AND WAS WRONG.
     ══════════════════════════════════════════════════════════════════
     THE BURDEN, DISCHARGED BEFORE TOUCHING IT. This file's own `beforeAll` seeds
     exactly 8,000,000 founder common shares through
     `POST /api/founder/captable/seed-founder-shares`, and nothing else. It then
     declared a fully-diluted pre-money count of 10,000,000 on every round — a
     figure two million shares larger than the cap table it had just created, with
     no instrument accounting for the difference. Independent review named this
     fixture as the demonstration of the defect, verbatim
     (`build_log/wave58/W58_REVIEW_1_MATH.md`):
       "The W58 fixture itself demonstrates the mismatch: the request carries
        fdPreMoneyShares=10,000,000, but company securities contain only 8,000,000
        founder shares."
     Under Wave 58 the two numbers were used by different surfaces and neither
     noticed. Wave 58b resolves them through one function
     (`shared/roundMathEngineAdapter.ts::resolveFdPreMoneyBase`) which REFUSES BY
     NAME when they disagree, so this fixture now correctly declares what it
     actually seeded. NO EXPECTED VALUE IN THIS FILE WAS CHANGED to accommodate it;
     the divergent case is asserted deliberately in
     `server/__tests__/w58b_pool_placement_reachability.test.ts` (W58B-4). */
  fdPreMoneyShares: "8000000",
};

let foundationRoundId = "";
/** Identical priced rounds; only the pool field differs. */
let noPoolRoundId = "";
let poolPercentRoundId = "";
let postMoneyPlacementRoundId = "";
let legacyShareCountRoundId = "";

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);

  foundationRoundId = await createRound({
    companyId: CO, name: `W58 Foundation ${STAMP}`, type: "foundation", state: "closed",
    targetAmount: 1000, currency: "USD",
  });

  /* 8,000,000 founder common, through the sacred money core's own seed route. */
  const seed = await request(app)
    .post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({ companyId: CO, roundId: foundationRoundId, shares: "8000000", amount: "800" });
  expect([200, 201]).toContain(seed.status);

  noPoolRoundId = await createRound({ ...PRICED_BASE, name: `W58 No pool ${STAMP}` });
  poolPercentRoundId = await createRound({
    ...PRICED_BASE,
    name: `W58 Pool 15pc ${STAMP}`,
    /* PERCENT-AS-WRITTEN (R16 / OR-1): 15 means 15%. */
    optionPoolPostPercent: "15",
    optionPoolMode: "pre_money",
  });
  postMoneyPlacementRoundId = await createRound({
    ...PRICED_BASE,
    name: `W58 Pool postmoney ${STAMP}`,
    optionPoolPostPercent: "15",
    optionPoolMode: "post_money",
  });
  /* BACKWARD COMPATIBILITY FIXTURE: a round carrying only the OLD stored key,
     `poolSize`, as a SHARE COUNT — exactly what every pre-Wave-58 round holds. */
  legacyShareCountRoundId = await createRound({
    ...PRICED_BASE,
    name: `W58 Legacy poolSize ${STAMP}`,
    poolSize: 1_000_000,
  });
}, 60_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — THE PERCENTAGE SURVIVES THE ROUND-CREATION ROUTE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58-1 — a percentage typed into the wizard is PERSISTED by POST /api/rounds", () => {
  it("W58-1a — the round reads back its own percentage and placement, unconverted", async () => {
    const res = await request(app)
      .get(`/api/rounds/${poolPercentRoundId}`)
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    /* PERCENT-AS-WRITTEN: the string that went in is the string that comes back.
       Not 0.15, not 1500 — R16 forbids a conversion at any layer, including this
       one. No migration was written: `extras_json` already carried it. */
    expect(String(body.optionPoolPostPercent)).toBe("15");
    expect(String(body.optionPoolMode)).toBe("pre_money");
  });

  it("W58-1b — the placement is stored as chosen and is NOT coerced to pre-money", async () => {
    const res = await request(app)
      .get(`/api/rounds/${postMoneyPlacementRoundId}`)
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(String((res.body as Record<string, unknown>).optionPoolMode)).toBe("post_money");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — THE LOAD-BEARING TEST: NO QUERY PARAMETER, AND THE POOL STILL APPLIES
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58-2 — the round-math route reads the ROUND'S OWN percentage, with no query parameter", () => {
  it("W58-2a — applied:true and the source is named as the stored round field", async () => {
    /* THE URL CARRIES NOTHING. This is the whole difference from Wave 52c, whose
       only path to this arithmetic was `?optionPoolPostPercent=25` typed by hand. */
    const body = await roundMath(poolPercentRoundId);
    expect(body.optionPoolTopUp.applied).toBe(true);
    expect(body.optionPoolTopUp.targetPoolPercent).toBe("15");
    expect(body.optionPoolTopUp.unit).toBe("percent_as_written_r16");
    expect(body.optionPoolTopUp.source).toBe("round_stored_option_pool_post_percent");
  });

  it("W58-2b — an identical round WITHOUT the percentage applies no pool at all", async () => {
    const body = await roundMath(noPoolRoundId);
    expect(body.optionPoolTopUp.applied).toBe(false);
    /* The refusal still names the ambiguity of `poolSize` rather than guessing. */
    expect(String(body.optionPoolTopUp.reason)).toContain("ambiguous");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — THE DERIVED SHARE COUNT, THE PRICE AND THE OWNERSHIP ALL MOVE TOGETHER
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58-3 — the percentage moves the derived shares, the price and the ownership", () => {
  it("W58-3a — a DERIVED pool share count appears on the post-close cap table", async () => {
    const withPool = await roundMath(poolPercentRoundId);
    const without = await roundMath(noPoolRoundId);
    const poolRows = (r: Record<string, any>) =>
      (r.postClose?.rows ?? []).filter((x: any) => x.kind === "option");
    const poolShares = (r: Record<string, any>) =>
      poolRows(r).reduce((s: bigint, x: any) => s + BigInt(x.shares), BigInt(0));
    /* The founder typed a PERCENTAGE. What lands on the cap table is a SHARE
       COUNT, derived — which is exactly what R27 asks the product to show. */
    expect(poolShares(withPool) > poolShares(without)).toBe(true);
    expect(poolShares(without)).toBe(BigInt(0));
    expect(poolShares(withPool) > BigInt(0)).toBe(true);

    /* ── THE ROUND-TRIP, WHICH IS THE POINT OF THE DENOMINATOR FIX ────────────
       The founder asked for 15% of post-money fully diluted. The DERIVED share
       count must actually PRODUCE 15% against the post-money total the same
       response reports — and that total must INCLUDE the pool. Before the Wave 58
       denominator fix this identity did not hold: the reported percentage was
       measured against a total that omitted the pool already on the cap table.

       Measured here: pool 2,000,000 of a post-money total 13,333,333 =
       15.0000004%, the residual being the documented round-UP on the top-up
       (§4.3: round up so the target is MET rather than missed). */
    const poolRow = poolRows(withPool)[0];
    expect(Number(poolRow.ownershipPercent)).toBeGreaterThanOrEqual(15);
    expect(Number(poolRow.ownershipPercent)).toBeLessThan(15.001);
    expect(poolRow.denominatorShares).toBe(String(withPool.postClose.totalShares));
    /* And the denominator that percentage is measured against is the FULL total,
       pool included — the exact quantity the pre-Wave-58 engine left out. */
    const summed = (withPool.postClose.rows as any[]).reduce(
      (s: bigint, x) => s + BigInt(x.shares), BigInt(0),
    );
    expect(summed).toBe(BigInt(withPool.postClose.totalShares));
  });

  it("W58-3b — THE PRICE REACTS. A pre-money pool lowers the price per share", async () => {
    const withPool = await roundMath(poolPercentRoundId);
    const without = await roundMath(noPoolRoundId);
    const p = Number(withPool.postClose.pricePerShare);
    const q = Number(without.postClose.pricePerShare);
    expect(Number.isFinite(p) && p > 0).toBe(true);
    expect(Number.isFinite(q) && q > 0).toBe(true);
    /* The pool sits INSIDE the pre-money denominator, so the denominator is
       larger and the price is lower. This is the "option pool shuffle" and it is
       the observable the live walkthrough found did not move at all. */
    expect(p).toBeLessThan(q);
  });

  it("W58-3c — THE OWNERSHIP REACTS. The founder's percentage falls, and it is labelled", async () => {
    const withPool = await roundMath(poolPercentRoundId);
    const without = await roundMath(noPoolRoundId);
    /* The founder block is identified by its SHARE COUNT, 8,000,000, which is
       what the seed route wrote and which neither round changes. It is carried on
       a `preferred` row rather than `common` because that is what
       `seed-founder-shares` creates in this tree — asserted on the count rather
       than on the kind so this test cannot pass for the wrong reason. */
    const founder = (r: Record<string, any>) =>
      (r.postClose?.rows ?? []).filter((x: any) => x.shares === "8000000");
    const founderPct = (r: Record<string, any>) =>
      founder(r).reduce((s: number, x: any) => s + Number(x.ownershipPercent), 0);
    expect(founder(withPool).length).toBe(1);
    expect(founder(without).length).toBe(1);
    /* A pre-money pool is paid for by the existing holders alone, so the founder
       must come out LOWER, not merely different. */
    expect(founderPct(withPool)).toBeLessThan(founderPct(without));
    /* R27 / AC-7: every rendered percentage carries its denominator. */
    for (const row of withPool.postClose.rows) {
      expect(row.denominatorLabel).toBeTruthy();
      expect(row.denominatorShares).toBeTruthy();
      expect(row.ownershipPercentUnit).toBe("percent_as_written_r16");
    }
  });

  it("W58-3d — the post-money total grows by exactly the derived pool plus the extra investor shares", async () => {
    const withPool = await roundMath(poolPercentRoundId);
    const without = await roundMath(noPoolRoundId);
    /* Conservation, stated as an equality rather than an inequality: the whole
       increase in the post-money total is accounted for, line by line, by the
       pool row and the investor row. Nothing appears from nowhere. */
    const byKind = (r: Record<string, any>, kind: string) =>
      (r.postClose.rows as any[])
        .filter((x) => x.kind === kind)
        .reduce((s: bigint, x) => s + BigInt(x.shares), BigInt(0));
    const deltaTotal = BigInt(withPool.postClose.totalShares) - BigInt(without.postClose.totalShares);
    const deltaPool = byKind(withPool, "option") - byKind(without, "option");
    const deltaPref = byKind(withPool, "preferred") - byKind(without, "preferred");
    const deltaCommon = byKind(withPool, "common") - byKind(without, "common");
    expect(deltaCommon).toBe(BigInt(0));
    expect(deltaTotal).toBe(deltaPool + deltaPref);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — PRECEDENCE, R16 UNITS, AND HONEST REFUSAL
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58-4 — precedence, units and refusals", () => {
  it("W58-4a — an explicit query parameter still WINS over the stored value", async () => {
    /* Every Wave 52c caller keeps working: the stored value is the FALLBACK. */
    const overridden = await roundMath(poolPercentRoundId, "?optionPoolPostPercent=25");
    expect(overridden.optionPoolTopUp.targetPoolPercent).toBe("25");
    expect(overridden.optionPoolTopUp.source).toBe("query_parameter");
    const stored = await roundMath(poolPercentRoundId);
    expect(stored.optionPoolTopUp.targetPoolPercent).toBe("15");
    /* A larger pool means a larger denominator means a lower price. */
    expect(Number(overridden.postClose.pricePerShare)).toBeLessThan(
      Number(stored.postClose.pricePerShare),
    );
  });

  it("W58-4b — POST /api/rounds REFUSES a percentage out of R16's [0,100) range, BY NAME", async () => {
    for (const bad of ["100", "150", "-1"]) {
      const res = await request(app)
        .post("/api/rounds")
        .set("x-user-id", ADMIN)
        .send({
          ...PRICED_BASE, openDate: "2026-01-01", closeDate: "2026-12-31",
          name: `W58 bad ${bad} ${STAMP}`, optionPoolPostPercent: bad,
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_optionPoolPostPercent");
      expect(String(res.body.message).length).toBeGreaterThan(20);
    }
  });

  it("W58-4c — a non-numeric percentage is refused, not coerced", async () => {
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", ADMIN)
      .send({
        ...PRICED_BASE, openDate: "2026-01-01", closeDate: "2026-12-31",
        name: `W58 bad abc ${STAMP}`, optionPoolPostPercent: "twenty-five",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_optionPoolPostPercent");
  });

  it("W58-4d — 0.25 is A QUARTER OF ONE PERCENT and is accepted as such (R16)", async () => {
    /* The forbidden behaviour would be a magnitude heuristic that decided 0.25
       "must have meant" 25. R16 is explicit that it must not. */
    const id = await createRound({
      ...PRICED_BASE, name: `W58 quarter percent ${STAMP}`, optionPoolPostPercent: "0.25",
    });
    const body = await roundMath(id);
    expect(body.optionPoolTopUp.applied).toBe(true);
    expect(body.optionPoolTopUp.targetPoolPercent).toBe("0.25");
    /* And it behaves like a QUARTER OF A PERCENT: the price barely moves,
       nothing like the 15% case. */
    const fifteen = await roundMath(poolPercentRoundId);
    const none = await roundMath(noPoolRoundId);
    const drop = Number(none.postClose.pricePerShare) - Number(body.postClose.pricePerShare);
    const bigDrop = Number(none.postClose.pricePerShare) - Number(fifteen.postClose.pricePerShare);
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThan(bigDrop / 10);
  });

  it("W58-4e — an invalid placement is refused BY NAME rather than defaulted", async () => {
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", ADMIN)
      .send({
        ...PRICED_BASE, openDate: "2026-01-01", closeDate: "2026-12-31",
        name: `W58 bad mode ${STAMP}`, optionPoolPostPercent: "15", optionPoolMode: "whenever",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_optionPoolMode");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — PLACEMENT IS APPLIED, NOT MERELY DISCLOSED   (WAVE 58b · DEFECT 1.3)
 *
 * WHY THIS BLOCK'S EXPECTATIONS CHANGED, and the burden discharged before
 * touching them. `W58-5a` previously asserted
 *   expect(body.optionPoolTopUp.placementModelled).toBe("pre_money")
 * for a round whose STORED placement was `post_money` — i.e. it PINNED THE
 * DEFECT. It was a correct test of Wave 58's behaviour, and Wave 58 was right to
 * disclose the gap rather than hide it, but the behaviour it pins has been
 * overruled by the wave brief, verbatim (`spec/WAVE58B_SPEC.md`, DEFECT 1):
 *   "REQUIRED: model post-money properly through all three. … The two modes MUST
 *    produce visibly different numbers in the wizard preview, in the stored
 *    price, and in the engine projection."
 * and by the owner instruction the brief opens with:
 *   "We cannot disable vehicles. … The fix direction is always MODEL IT PROPERLY,
 *    never hide it."
 * A test asserting that the engine models the OTHER convention cannot survive
 * that instruction. NO ARITHMETIC EXPECTATION WAS RELAXED: the replacement is
 * strictly stronger. The both-poles numeric comparison lives in
 * `server/__tests__/w58b_pool_placement_reachability.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58-5 — pre-money vs post-money placement", () => {
  it("W58-5a — a post-money placement is APPLIED, and the pool is not dropped", async () => {
    const body = await roundMath(postMoneyPlacementRoundId);
    expect(body.optionPoolTopUp.applied).toBe(true);
    expect(body.optionPoolTopUp.placementChosen).toBe("post_money");
    /* WAVE 58b · DEFECT 1.3 — what is MODELLED now equals what was CHOSEN. */
    expect(body.optionPoolTopUp.placementModelled).toBe("post_money");
    expect(body.optionPoolTopUp.mode).toBe("post_money");
    /* The authority is stated in the response, and states plainly that
       post-money placement has NO model-form authority. */
    expect(String(body.optionPoolTopUp.placementAuthority)).toContain("NEGOTIATED");
    expect(String(body.optionPoolTopUp.placementAuthority)).toContain("OUTSIDE the pricing denominator");
    /* The fully-diluted definition is named: an unstated definition is the
       commonest source of cap-table disputes. */
    expect(String(body.optionPoolTopUp.fullyDilutedDefinition)).toContain("EXCLUDES");
    /* THE POOL IS NOT DROPPED. Before this wave `compute.ts` applied a pool only
       when the mode was `pre_money`, so a post-money round's projection showed
       no pool row whatsoever. */
    const poolRows = (body.postClose.rows as Array<{ holderName: string }>).filter((r) =>
      /pool/i.test(r.holderName));
    expect(poolRows.length).toBeGreaterThan(0);
  });

  it("W58-5b — a pre-money placement is APPLIED and names the market-default authority", async () => {
    const body = await roundMath(poolPercentRoundId);
    expect(body.optionPoolTopUp.placementChosen).toBe("pre_money");
    expect(body.optionPoolTopUp.placementModelled).toBe("pre_money");
    /* The stale "not modelled" warning is gone because it is no longer true. */
    expect(body.optionPoolTopUp.placementNotModelledWarning).toBeUndefined();
    expect(String(body.optionPoolTopUp.placementAuthority)).toContain("Cooley GO");
    expect(String(body.optionPoolTopUp.placementAuthority)).toContain("INSIDE the pricing denominator");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — BACKWARD COMPATIBILITY: A STORED SHARE COUNT STILL READS CORRECTLY
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58-6 — an existing round carrying a stored poolSize SHARE COUNT", () => {
  it("W58-6a — the stored share count is unchanged and still readable", async () => {
    const res = await request(app)
      .get(`/api/rounds/${legacyShareCountRoundId}`)
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    /* Not migrated, not converted, not deleted, not reinterpreted. */
    expect(Number((res.body as Record<string, unknown>).poolSize)).toBe(1_000_000);
    expect((res.body as Record<string, unknown>).optionPoolPostPercent).toBeUndefined();
  });

  it("W58-6b — it is NOT silently reinterpreted as a percentage", async () => {
    const body = await roundMath(legacyShareCountRoundId);
    /* 1,000,000 read as a percentage would be 1,000,000% — the exact class of
       defect R16 exists to prevent. The route refuses to guess and says why. */
    expect(body.optionPoolTopUp.applied).toBe(false);
    expect(String(body.optionPoolTopUp.reason)).toContain("ambiguous");
  });

  it("W58-6c — and its arithmetic is byte-identical to the no-pool round, so nothing changed for it", async () => {
    const legacy = await roundMath(legacyShareCountRoundId);
    const none = await roundMath(noPoolRoundId);
    expect(legacy.postClose.pricePerShare).toBe(none.postClose.pricePerShare);
    expect(legacy.postClose.totalShares).toBe(none.postClose.totalShares);
  });
});

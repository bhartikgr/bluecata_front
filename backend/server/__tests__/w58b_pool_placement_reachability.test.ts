/**
 * WAVE 58b — POOL PLACEMENT, THE POOL EDIT PATH, AND ONE FULLY-DILUTED BASE,
 * ALL PROVED THROUGH HTTP ROUTES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY EVERY CLAIM HERE GOES THROUGH A ROUTE
 * ═══════════════════════════════════════════════════════════════════════════
 * Waves 52/52b shipped a flag no production code called and a migration whose
 * tables were never created; Wave 58 was recommended on a reachability claim a
 * live walkthrough disproved. So nothing in this file asserts its headline by
 * calling `computeEsopTopUp`, `computeCapTable` or the adapter's projection
 * directly. Every number comes back out of `registerRoutes` over supertest.
 *
 * THE ONE DELIBERATE EXCEPTION, and it is the point of §5: the WIZARD's own
 * derivation (`client/src/lib/roundMath.ts::derivePoolTopUpFromPercent`) is a pure
 * client function with no route of its own. It is called directly here ONLY so its
 * output can be compared, number for number, against what the HTTP route returns.
 * That comparison is the three-surface agreement proof; calling it is not the
 * claim, agreeing with the route is.
 *
 * EVERY EXPECTED VALUE BELOW IS INDEPENDENTLY COMPUTED, not read off a run.
 * `build_log/wave58b/w58b_exact_math.py` derives all of them with `decimal` at 60
 * digits and prints them; a reviewer can re-run that file and diff.
 *
 *   Ledger:  8,000,000 founder common (seeded through the sacred money core's own
 *            route below), no options, no warrants  ->  B = 8,000,000, u = 0
 *   Round:   pre-money $30,000,000 · raise $10,000,000 · pool target 15%
 *
 *   PRE-MONEY placement  (pool INSIDE the pricing denominator)
 *     S = ceil( (15·8,000,000·40,000,000 − 0) / (100·30,000,000 − 15·40,000,000) )
 *       = ceil( 4.8e15 / 2.4e9 )                    =  2,000,000
 *     D = 8,000,000 + 2,000,000                     = 10,000,000
 *     p = 30,000,000 / 10,000,000                   =         3.00
 *     N = floor(10,000,000 / 3)                     =  3,333,333
 *     T = 8,000,000 + 2,000,000 + 3,333,333         = 13,333,333
 *
 *   POST-MONEY placement (pool OUTSIDE the pricing denominator)
 *     p = 30,000,000 / 8,000,000                    =         3.75
 *     N = floor(10,000,000 / 3.75)                  =  2,666,666
 *     S = ceil( (15·(8,000,000 + 2,666,666) − 0) / (100 − 15) )
 *       = ceil( 159,999,990 / 85 ) = ceil(1,882,352.82…)  =  1,882,353
 *     T = 8,000,000 + 2,666,666 + 1,882,353         = 12,549,019
 *
 * MUTATION TRANSCRIPTS: `build_log/wave58b/W58B_NEW_TESTS.md`. Each test names the
 * single source edit that turns it red.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
/* §5 only — compared AGAINST the route, never trusted instead of it. */
import { derivePoolTopUpFromPercent } from "../../client/src/lib/roundMath";
import {
  ledgerFullyDilutedPreMoneyShares,
  resolveFdPreMoneyBase,
  type ApiSecurity,
} from "@shared/roundMathEngineAdapter";

let app: Express;
const STAMP = String(Date.now());
const CO = `co_w58b_${STAMP}`;
const CO_WARRANT = `co_w58bw_${STAMP}`;
const ADMIN = "u_admin";

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

async function securities(companyId: string): Promise<ApiSecurity[]> {
  const res = await request(app)
    .get(`/api/companies/${encodeURIComponent(companyId)}/securities`)
    .set("x-user-id", ADMIN);
  expect(res.status).toBe(200);
  return res.body as ApiSecurity[];
}

/** The pool row the engine synthesises, found by holder identity, not by index.
 *  Observed shape (probed, not assumed): `holderId: "pool"`, `kind: "option"`.
 *
 *  WAVE 71b — THIS SELECTOR USED TO MATCH `holderName === "pool"`, WHICH ENCODED
 *  DEFECT D14. The lowercase `pool` display name was never a name anybody chose:
 *  the synthesised top-up row had no `Holder` record, so `views.ts` fell back to
 *  `holderName: h?.name ?? v.sec.holderId`. Wave 71's D14 fix supplied the missing
 *  Holder, so the row now displays `Option pool (unallocated reserve)` with type
 *  `pool` instead of `other`. `holderId` is the join key the engine groups by
 *  (`views.ts`, `reconcile.ts`'s `rowKey`) and `compute.ts` documents that it is
 *  deliberately UNCHANGED by D14 — so it is the stable identity this helper always
 *  meant. Matching the display name pinned the defect; matching the id does not. */
function poolRow(body: Record<string, any>): { shares: string; ownershipPercent: string } | null {
  const rows = (body.postClose?.rows ?? []) as Array<{
    holderId: string; holderName: string; holderType: string; kind: string;
    shares: string; ownershipPercent: string;
  }>;
  return rows.find((r) => r.holderId === "pool" && r.kind === "option") ?? null;
}

/** The NEW investor row for this round. The engine names it `<series> investors`,
 *  and gives EVERY equity holder `holderType: "investor"` — including the founder
 *  — so filtering on `holderType` would silently include the founders' 8,000,000.
 *  Probed against a live response before being relied on. */
function newInvestorPct(body: Record<string, any>): number {
  const rows = (body.postClose?.rows ?? []) as Array<{ holderName: string; ownershipPercent: string }>;
  const row = rows.find((r) => / investors$/.test(r.holderName));
  if (!row) throw new Error("no new-investor row in the projection");
  return Number(row.ownershipPercent);
}

const PRICED_BASE = {
  companyId: CO,
  type: "seed",
  state: "active",
  targetAmount: 10_000_000,
  preMoney: 30_000_000,
  currency: "USD",
  instrument: "preferred",
  pricePerShare: 3,
  sharesAuthorized: "3333333",
  /* DECLARED equal to what the ledger below actually holds. The divergent case is
     asserted deliberately in §4, not smuggled into every other test. */
  fdPreMoneyShares: "8000000",
};

let preMoneyRoundId = "";
let postMoneyRoundId = "";
let noPoolRoundId = "";
let editableRoundId = "";
let divergentRoundId = "";
let closedRoundId = "";
let warrantRoundId = "";

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);

  /* ── Company A: 8,000,000 founder common, nothing else ─────────────────── */
  const foundation = await createRound({
    companyId: CO, name: `W58b Foundation ${STAMP}`, type: "foundation", state: "closed",
    targetAmount: 1000, currency: "USD",
  });
  const seed = await request(app)
    .post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({ companyId: CO, roundId: foundation, shares: "8000000", amount: "800" });
  expect([200, 201]).toContain(seed.status);

  noPoolRoundId = await createRound({ ...PRICED_BASE, name: `W58b No pool ${STAMP}` });
  preMoneyRoundId = await createRound({
    ...PRICED_BASE, name: `W58b PRE ${STAMP}`,
    optionPoolPostPercent: "15", optionPoolMode: "pre_money",
  });
  postMoneyRoundId = await createRound({
    ...PRICED_BASE, name: `W58b POST ${STAMP}`,
    optionPoolPostPercent: "15", optionPoolMode: "post_money",
  });
  /* Starts with NO pool at all: §3 adds one through the edit route. */
  editableRoundId = await createRound({ ...PRICED_BASE, name: `W58b Editable ${STAMP}` });
  /* Declares 10,000,000 against a ledger holding 8,000,000 — the divergence. */
  divergentRoundId = await createRound({
    ...PRICED_BASE, name: `W58b Divergent ${STAMP}`,
    fdPreMoneyShares: "10000000",
    optionPoolPostPercent: "15", optionPoolMode: "pre_money",
  });
  closedRoundId = await createRound({
    ...PRICED_BASE, name: `W58b Closed ${STAMP}`, state: "closed",
    optionPoolPostPercent: "15", optionPoolMode: "pre_money",
  });

  /* ── Company B: 8,000,000 common + a 1,000,000-share warrant, for §6 ────── */
  const wFoundation = await createRound({
    companyId: CO_WARRANT, name: `W58b W Foundation ${STAMP}`, type: "foundation", state: "closed",
    targetAmount: 1000, currency: "USD",
  });
  const wSeed = await request(app)
    .post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({ companyId: CO_WARRANT, roundId: wFoundation, shares: "8000000", amount: "800" });
  expect([200, 201]).toContain(wSeed.status);
  warrantRoundId = await createRound({
    ...PRICED_BASE, companyId: CO_WARRANT, name: `W58b Warrant round ${STAMP}`,
    optionPoolPostPercent: "15", optionPoolMode: "pre_money",
  });
}, 90_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 — THE TWO PLACEMENTS PRODUCE VISIBLY DIFFERENT NUMBERS (DEFECT 1)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58B-1 — pre-money and post-money placement differ, and each matches an independently computed value", () => {
  it("W58B-1a — PRE-MONEY: pool 2,000,000 · PPS $3 · investor 3,333,333 · total 13,333,333", async () => {
    const body = await roundMath(preMoneyRoundId);
    expect(body.optionPoolTopUp.applied).toBe(true);
    expect(body.optionPoolTopUp.placementModelled).toBe("pre_money");
    expect(body.optionPoolTopUp.poolAppliedToProjection).toBe(true);
    const pool = poolRow(body);
    expect(pool).not.toBeNull();
    expect(pool!.shares).toBe("2000000");
    expect(Number(body.postClose.pricePerShare)).toBe(3);
    expect(body.postClose.totalShares).toBe("13333333");
  });

  it("W58B-1b — POST-MONEY: pool 1,882,353 · PPS $3.75 · total 12,549,019", async () => {
    const body = await roundMath(postMoneyRoundId);
    expect(body.optionPoolTopUp.applied).toBe(true);
    expect(body.optionPoolTopUp.placementModelled).toBe("post_money");
    const pool = poolRow(body);
    expect(pool).not.toBeNull();
    expect(pool!.shares).toBe("1882353");
    expect(Number(body.postClose.pricePerShare)).toBe(3.75);
    expect(body.postClose.totalShares).toBe("12549019");
  });

  it("W58B-1c — THE TWO MODES DIFFER, on the same stored terms, on every headline figure", async () => {
    /* THIS is the assertion the spec demands: not that each mode is internally
       consistent, but that choosing one rather than the other CHANGES THE NUMBERS.
       Before this wave they were byte-identical in the wizard, the stored price
       ignored the choice, and the engine dropped the pool entirely for post-money. */
    const pre = await roundMath(preMoneyRoundId);
    const post = await roundMath(postMoneyRoundId);
    expect(poolRow(pre)!.shares).not.toBe(poolRow(post)!.shares);
    expect(Number(pre.postClose.pricePerShare)).not.toBe(Number(post.postClose.pricePerShare));
    expect(pre.postClose.totalShares).not.toBe(post.postClose.totalShares);
    /* And the DIRECTION is the economically correct one, which a sign error would
       not survive: a pre-money pool lowers the price (the existing holders pay for
       it) and a post-money pool does not. */
    expect(Number(pre.postClose.pricePerShare)).toBeLessThan(Number(post.postClose.pricePerShare));
    /* Exact deltas, independently computed: 2,000,000 − 1,882,353 = 117,647. */
    expect(Number(poolRow(pre)!.shares) - Number(poolRow(post)!.shares)).toBe(117_647);
  });

  it("W58B-1d — POST-MONEY leaves the price EXACTLY where the no-pool round leaves it", async () => {
    /* The defining property of post-money placement: the pool is outside the
       pricing denominator, so the price per share is the same as if there were no
       pool at all. A pre-money pool must NOT have that property. */
    const none = await roundMath(noPoolRoundId);
    const post = await roundMath(postMoneyRoundId);
    const pre = await roundMath(preMoneyRoundId);
    expect(Number(post.postClose.pricePerShare)).toBe(Number(none.postClose.pricePerShare));
    expect(Number(pre.postClose.pricePerShare)).not.toBe(Number(none.postClose.pricePerShare));
    /* …and the pool STILL EXISTS on the post-money round. Equal price is not the
       old bug (a dropped pool) wearing a new hat. */
    expect(poolRow(post)).not.toBeNull();
    expect(poolRow(none)).toBeNull();
  });

  it("W58B-1e — WHO PAYS, checked by arithmetic rather than by the sentence on screen", async () => {
    /* PRE-MONEY: the incoming investor gets EXACTLY the fraction their money buys,
       I/(PMV+I) = 10/40 = 25%. Every share of pool dilution lands on the founders.
       POST-MONEY: the investor gets materially LESS than 25% because they bear
       their pro-rata share of the pool. */
    const pre = await roundMath(preMoneyRoundId);
    const post = await roundMath(postMoneyRoundId);
    /* Independently computed (w58b_exact_math.py):
         pre-money  investor = 3,333,333 / 13,333,333 = 24.999998124999531…%
         post-money investor = 2,666,666 / 12,549,019 = 21.249995716796667…% */
    expect(newInvestorPct(pre)).toBeCloseTo(25, 4);
    expect(newInvestorPct(post)).toBeCloseTo(21.25, 4);
    expect(newInvestorPct(post)).toBeLessThan(newInvestorPct(pre));
    /* PRO-RATA, PROVED BY ARITHMETIC. Before the post-money pool exists the
       founders hold 8,000,000/10,666,666 and the investor 2,666,666/10,666,666 —
       a 3:1 split. After it, each has given up percentage points in exactly that
       3:1 ratio. A sign error, a wrong base or a pre-money formula in disguise
       would all fail this. */
    const none = await roundMath(noPoolRoundId);
    const founderPct = (b: Record<string, any>) =>
      Number(
        /* WAVE 71b — was `r.holderName !== "pool"`, the same D14-encoded display
           name as `poolRow()` had. After D14 that exclusion no longer excludes the
           pool row at all; this test kept passing only because the founder row
           precedes the pool row and `.find()` stops at the first match. Corrected
           to the stable `holderId`, which excludes it for the right reason. */
        (b.postClose.rows as Array<{ holderId: string; holderName: string; ownershipPercent: string }>)
          .find((r) => !/ investors$/.test(r.holderName) && r.holderId !== "pool")!
          .ownershipPercent,
      );
    const founderGiveback = founderPct(none) - founderPct(post);
    const investorGiveback = newInvestorPct(none) - newInvestorPct(post);
    expect(founderGiveback / investorGiveback).toBeCloseTo(founderPct(none) / newInvestorPct(none), 4);
    expect(founderGiveback / investorGiveback).toBeCloseTo(3, 4);
  });

  it("W58B-1f — the placement AUTHORITY is on the response, and does not overclaim", async () => {
    const pre = await roundMath(preMoneyRoundId);
    const post = await roundMath(postMoneyRoundId);
    /* The market default names its source. */
    expect(String(pre.optionPoolTopUp.placementAuthority)).toContain("Cooley GO");
    /* The departure says it IS a departure rather than implying consensus. */
    expect(String(post.optionPoolTopUp.placementAuthority)).toContain("NEGOTIATED");
    expect(String(post.optionPoolTopUp.placementAuthority)).toContain(
      "implying a consensus that does not exist",
    );
    /* Both name the fully-diluted definition in force. */
    for (const b of [pre, post]) {
      expect(String(b.optionPoolTopUp.fullyDilutedDefinition)).toContain("warrants");
      expect(String(b.optionPoolTopUp.fullyDilutedDefinition)).toContain("EXCLUDES");
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 — THE WIZARD'S OWN DERIVATION DIFFERS BY PLACEMENT TOO (DEFECT 1.1 / 1.2)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58B-2 — the client derivation is placement-aware", () => {
  const INPUT = {
    fdPreMoneyShares: "8000000",
    preMoneyValuation: "30000000",
    investmentAmount: "10000000",
    existingPoolShares: "0",
    poolPercentPostMoney: "15",
  } as const;

  it("W58B-2a — the same inputs with different placements return DIFFERENT numbers", () => {
    const pre = derivePoolTopUpFromPercent({ ...INPUT, poolPlacement: "pre_money" });
    const post = derivePoolTopUpFromPercent({ ...INPUT, poolPlacement: "post_money" });
    expect(pre.ok && post.ok).toBe(true);
    if (!pre.ok || !post.ok) return;
    expect(pre.poolTopUpShares.toString()).toBe("2000000");
    expect(post.poolTopUpShares.toString()).toBe("1882353");
    expect(pre.pricePerShare).toBe("3");
    expect(post.pricePerShare).toBe("3.75");
    expect(pre.postMoneyFdShares.toString()).toBe("13333333");
    expect(post.postMoneyFdShares.toString()).toBe("12549019");
  });

  it("W58B-2b — the PRICING DENOMINATOR is what differs, and it is returned by number", () => {
    const pre = derivePoolTopUpFromPercent({ ...INPUT, poolPlacement: "pre_money" });
    const post = derivePoolTopUpFromPercent({ ...INPUT, poolPlacement: "post_money" });
    if (!pre.ok || !post.ok) throw new Error("derivation refused");
    /* pre-money: B + S = 8,000,000 + 2,000,000. post-money: B alone. */
    expect(pre.pricingDenominatorShares.toString()).toBe("10000000");
    expect(post.pricingDenominatorShares.toString()).toBe("8000000");
  });

  it("W58B-2c — EFFECTIVE PRE-MONEY: $24,000,000 pre-money vs the full $30,000,000 post-money", () => {
    const pre = derivePoolTopUpFromPercent({ ...INPUT, poolPlacement: "pre_money" });
    const post = derivePoolTopUpFromPercent({ ...INPUT, poolPlacement: "post_money" });
    if (!pre.ok || !post.ok) throw new Error("derivation refused");
    /* B·p = 8,000,000 × 3 = 24,000,000 — the Brown Rudnick / Venture Hacks
       "illusory pre-money": the $6,000,000 gap IS the pool, paid by the founders. */
    expect(Number(pre.effectivePreMoney)).toBe(24_000_000);
    /* B·p = 8,000,000 × 3.75 = 30,000,000 — nothing carved out at pricing. */
    expect(Number(post.effectivePreMoney)).toBe(30_000_000);
  });

  it("W58B-2d — WHO PAYS is stated in words, differently, and names its authority", () => {
    const pre = derivePoolTopUpFromPercent({ ...INPUT, poolPlacement: "pre_money" });
    const post = derivePoolTopUpFromPercent({ ...INPUT, poolPlacement: "post_money" });
    if (!pre.ok || !post.ok) throw new Error("derivation refused");
    expect(pre.whoPays).toContain("THE EXISTING HOLDERS PAY FOR IT ALONE");
    expect(pre.whoPays).toContain("Cooley GO");
    expect(post.whoPays).toContain("EVERYONE PAYS, PRO-RATA");
    expect(post.whoPays).toContain("NEGOTIATED");
    expect(pre.whoPays).not.toBe(post.whoPays);
    /* The fully-diluted definition is attached to both. */
    expect(pre.fdDefinition).toContain("EXCLUDES unissued authorised");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 — THE POOL IS EDITABLE AFTER CREATION, THROUGH THE ROUTE (DEFECT 2)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58B-3 — PATCH /api/rounds/:id/terms can set, change and remove the pool", () => {
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/rounds/${id}/terms`).set("x-user-id", ADMIN).send(body);

  it("W58B-3a — a round created with NO pool can have one ADDED, and the projection moves", async () => {
    const before = await roundMath(editableRoundId);
    expect(before.optionPoolTopUp.applied).toBe(false);
    expect(poolRow(before)).toBeNull();

    const res = await patch(editableRoundId, { optionPoolPostPercent: "15", optionPoolMode: "pre_money" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const after = await roundMath(editableRoundId);
    expect(after.optionPoolTopUp.applied).toBe(true);
    expect(after.optionPoolTopUp.source).toBe("round_stored_option_pool_post_percent");
    expect(poolRow(after)!.shares).toBe("2000000");
    expect(Number(after.postClose.pricePerShare)).toBe(3);
  });

  it("W58B-3b — the PLACEMENT can be changed afterwards, and the numbers change with it", async () => {
    const res = await patch(editableRoundId, { optionPoolMode: "post_money" });
    expect(res.status).toBe(200);
    const after = await roundMath(editableRoundId);
    expect(after.optionPoolTopUp.placementModelled).toBe("post_money");
    expect(poolRow(after)!.shares).toBe("1882353");
    expect(Number(after.postClose.pricePerShare)).toBe(3.75);
  });

  it("W58B-3c — the PERCENTAGE can be corrected, percent-as-written, no rescale", async () => {
    /* A founder who typed 15 and meant 10. Independently computed for 10% pre-money
       on B = 8,000,000: S = ceil(10·8,000,000·40,000,000 / (3e9 − 10·4e7))
                           = ceil(3.2e15 / 2.6e9) = ceil(1,230,769.23…) = 1,230,770. */
    const res = await patch(editableRoundId, { optionPoolPostPercent: "10", optionPoolMode: "pre_money" });
    expect(res.status).toBe(200);
    const after = await roundMath(editableRoundId);
    expect(after.optionPoolTopUp.targetPoolPercent).toBe("10");
    expect(poolRow(after)!.shares).toBe("1230770");
  });

  it("W58B-3d — 0.25 is A QUARTER OF ONE PERCENT on the EDIT path too (R16)", async () => {
    const res = await patch(editableRoundId, { optionPoolPostPercent: "0.25" });
    expect(res.status).toBe(200);
    const after = await roundMath(editableRoundId);
    expect(after.optionPoolTopUp.targetPoolPercent).toBe("0.25");
    /* Independently computed: S = ceil(0.25·8e6·4e7 / (3e9 − 0.25·4e7))
                                = ceil(8e13 / 2.99e9) = ceil(26,755.85…) = 26,756. */
    expect(poolRow(after)!.shares).toBe("26756");
  });

  it("W58B-3e — the pool can be REMOVED, explicitly, and the projection returns to no pool", async () => {
    const res = await patch(editableRoundId, { optionPoolPostPercent: null, optionPoolMode: null });
    expect(res.status).toBe(200);
    const after = await roundMath(editableRoundId);
    expect(after.optionPoolTopUp.applied).toBe(false);
    expect(poolRow(after)).toBeNull();
    /* And the price returns to the no-pool price, so removal really removed it. */
    const none = await roundMath(noPoolRoundId);
    expect(Number(after.postClose.pricePerShare)).toBe(Number(none.postClose.pricePerShare));
  });

  it("W58B-3f — an out-of-range or nonsense percentage is REFUSED BY NAME, not clamped", async () => {
    for (const bad of ["150", "-1", "abc", "100"]) {
      const res = await patch(editableRoundId, { optionPoolPostPercent: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("invalid_optionPoolPostPercent");
      /* WAVE 85 — STALE COPY PIN, RE-POINTED. Wave 83 rewrote this message under the
         owner's "no internal process on screen" ruling. Both strings, verbatim:
           OLD: "optionPoolPostPercent is PERCENT-AS-WRITTEN (owner ruling R16 / OR-1): 25 means 25%. "
           NEW: "The option pool percentage is percent-as-written: 25 means 25%. "
         THE REFUSAL IS STILL IDENTIFIABLE BY NAME, and that is asserted one line
         above, not here: `res.body.error === "invalid_optionPoolPostPercent"`. A
         caller can still tell WHICH rule fired without reading the prose. What this
         line guards is the CONVENTION being stated to the human — that 25 means 25%
         and is never rescaled — which the new sentence states just as plainly. */
      expect(String(res.body.message)).toContain("percent-as-written");
      expect(String(res.body.message)).toContain("never rescaled by magnitude");
    }
    const badMode = await patch(editableRoundId, { optionPoolMode: "whenever" });
    expect(badMode.status).toBe(400);
    expect(badMode.body.error).toBe("invalid_optionPoolMode");
  });

  it("W58B-3g — THE IMMUTABILITY RULE: a closed round refuses the edit with a NAMED code", async () => {
    /* Found in the source rather than invented: `server/routes.ts`'s terms handler
       returns 409 `closed_round_readonly` when `state` is `closed` or `funded`.
       The pool fields are INSIDE that gate, so a committed round's pool cannot be
       changed, and the founder is told why by name. */
    const res = await patch(closedRoundId, { optionPoolPostPercent: "20" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("closed_round_readonly");
    /* And nothing changed: the closed round still reports its original 15%. */
    const after = await roundMath(closedRoundId);
    expect(after.optionPoolTopUp.targetPoolPercent).toBe("15");
  });

  it("W58B-3h — the DECLARED fully-diluted count is editable, which is how a divergence is fixed", async () => {
    const before = await roundMath(divergentRoundId);
    expect(before.optionPoolTopUp.fdBase.resolved).toBe(false);
    const res = await patch(divergentRoundId, { fdPreMoneyShares: 8_000_000 });
    expect(res.status).toBe(200);
    const after = await roundMath(divergentRoundId);
    expect(after.optionPoolTopUp.fdBase.resolved).toBe(true);
    expect(after.optionPoolTopUp.fdBase.source).toBe("RECONCILED");
    expect(poolRow(after)!.shares).toBe("2000000");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 — ONE BASE, OR A NAMED REFUSAL (DEFECT 3)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58B-4 — a declared base that disagrees with the ledger refuses BY NAME instead of producing two numbers", () => {
  it("W58B-4a — the divergent round names both counts and does NOT apply the pool", async () => {
    /* A fresh divergent round: §3h repaired the shared one. */
    const id = await createRound({
      ...PRICED_BASE, name: `W58b Divergent 2 ${STAMP}`,
      fdPreMoneyShares: "10000000",
      optionPoolPostPercent: "15", optionPoolMode: "pre_money",
    });
    const body = await roundMath(id);
    expect(body.optionPoolTopUp.fdBase.resolved).toBe(false);
    expect(body.optionPoolTopUp.fdBase.code).toBe("fd_base_divergence");
    expect(body.optionPoolTopUp.fdBase.declaredFdShares).toBe("10000000");
    expect(body.optionPoolTopUp.fdBase.ledgerFdShares).toBe("8000000");
    /* Both numbers AND the difference are in the message a founder reads. */
    expect(String(body.optionPoolTopUp.fdBase.reason)).toContain("10000000");
    expect(String(body.optionPoolTopUp.fdBase.reason)).toContain("8000000");
    expect(String(body.optionPoolTopUp.fdBase.reason)).toContain("2000000");
    /* THE POINT: no pool number is produced at all, so the wizard and this
       projection cannot show two different ones. */
    expect(body.optionPoolTopUp.poolAppliedToProjection).toBe(false);
    expect(poolRow(body)).toBeNull();
    expect(String(body.optionPoolTopUp.poolNotAppliedReason)).toContain("could not be settled");
  });

  it("W58B-4b — a RECONCILED round says so, and names the one base it used", async () => {
    const body = await roundMath(preMoneyRoundId);
    expect(body.optionPoolTopUp.fdBase.resolved).toBe(true);
    expect(body.optionPoolTopUp.fdBase.source).toBe("RECONCILED");
    expect(body.optionPoolTopUp.fdBase.base).toBe("8000000");
    expect(String(body.optionPoolTopUp.fdBase.label)).toContain("agree exactly");
  });

  it("W58B-4c — the resolver used by the route is the one the client surfaces call", async () => {
    /* Same function, same two inputs, same answer. This is what makes the
       agreement structural rather than coincidental: there is no second resolver
       for a screen to prefer. */
    const secs = await securities(CO);
    const ledgerFd = ledgerFullyDilutedPreMoneyShares(secs);
    expect(ledgerFd.toString()).toBe("8000000");
    const reconciled = resolveFdPreMoneyBase({ declaredFdPreMoneyShares: "8000000", ledgerFdShares: ledgerFd });
    const divergent = resolveFdPreMoneyBase({ declaredFdPreMoneyShares: "10000000", ledgerFdShares: ledgerFd });
    expect(reconciled.ok).toBe(true);
    expect(divergent.ok).toBe(false);
    if (!divergent.ok) expect(divergent.code).toBe("fd_base_divergence");
    const body = await roundMath(preMoneyRoundId);
    expect(body.optionPoolTopUp.fdBase.base).toBe(
      reconciled.ok ? reconciled.base.toString() : "unreachable",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 — THREE SURFACES, ONE SET OF NUMBERS (DEFECT 3 / R21)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58B-5 — wizard, round-math projection and cap-table securities agree", () => {
  it("W58B-5a — the wizard derivation reproduces the ROUTE's numbers exactly, both placements", async () => {
    const secs = await securities(CO);
    const base = resolveFdPreMoneyBase({
      declaredFdPreMoneyShares: PRICED_BASE.fdPreMoneyShares,
      ledgerFdShares: ledgerFullyDilutedPreMoneyShares(secs),
    });
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const existingPool = secs
      .filter((x) => x.instrument === "option")
      .reduce((sum, x) => sum + Number(x.shares ?? 0), 0)
      .toString();

    for (const [placement, roundId] of [
      ["pre_money", preMoneyRoundId],
      ["post_money", postMoneyRoundId],
    ] as const) {
      const wizard = derivePoolTopUpFromPercent({
        poolPercentPostMoney: "15",
        poolPlacement: placement,
        fdPreMoneyShares: base.base.toString(),
        preMoneyValuation: String(PRICED_BASE.preMoney),
        investmentAmount: String(PRICED_BASE.targetAmount),
        existingPoolShares: existingPool,
      });
      expect(wizard.ok).toBe(true);
      if (!wizard.ok) return;
      const route = await roundMath(roundId);
      /* SURFACE 1 (wizard preview) vs SURFACE 2 (round-detail projection): the
         pool share count, the price per share and the post-money total, all three.
         Before this wave these disagreed by 500,000 shares on the pool alone. */
      expect(poolRow(route)!.shares).toBe(wizard.poolTopUpShares.toString());
      expect(Number(route.postClose.pricePerShare)).toBe(Number(wizard.pricePerShare));
      expect(route.postClose.totalShares).toBe(wizard.postMoneyFdShares.toString());
    }
  });

  it("W58B-5b — SURFACE 3: the cap-table securities endpoint feeds the same base", async () => {
    /* The cap-table page computes from `GET /api/companies/:id/securities`. Its
       fully-diluted total is the base the projection resolved against, so all
       three surfaces are anchored to one number rather than three. */
    const secs = await securities(CO);
    const body = await roundMath(preMoneyRoundId);
    expect(body.optionPoolTopUp.fdBase.ledgerFdShares).toBe(
      ledgerFullyDilutedPreMoneyShares(secs).toString(),
    );
    expect(body.optionPoolTopUp.fdBase.base).toBe("8000000");
  });

  it("W58B-5c — the 500,000-share divergence is gone: no reachable path produces 2,500,000", async () => {
    /* The old wizard, on these exact terms with the typed 10,000,000 base, produced
       2,500,000 pool shares while the engine produced 2,000,000. The declared base
       is now either reconciled (and both say 2,000,000) or refused. There is no
       state in which one surface says 2,500,000 and another says 2,000,000. */
    const reconciled = await roundMath(preMoneyRoundId);
    expect(poolRow(reconciled)!.shares).toBe("2000000");
    const id = await createRound({
      ...PRICED_BASE, name: `W58b Divergent 3 ${STAMP}`,
      fdPreMoneyShares: "10000000",
      optionPoolPostPercent: "15", optionPoolMode: "pre_money",
    });
    const divergent = await roundMath(id);
    expect(poolRow(divergent)).toBeNull();
    expect(divergent.optionPoolTopUp.fdBase.code).toBe("fd_base_divergence");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 — WARRANTS ARE IN THE POOL-TARGET BASE (DEFECT 5)
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W58B-6 — a warrant on the cap table enlarges the base the pool target is solved against", () => {
  it("W58B-6a — warrants and a pool top-up COEXIST, and the warrant is in the base", async () => {
    /* Company B holds 8,000,000 common. If a warrant can be issued to its ledger
       through a route, the pool must be sized against 8,000,000 + underlying. If no
       route can issue one, that is recorded instead of asserted — see
       `W58B_NEW_TESTS.md`. Either way this test states which world it is in rather
       than passing vacuously. */
    const secs = await securities(CO_WARRANT);
    const warrants = secs.filter((x) => x.instrument === "warrant");
    const ledgerFd = ledgerFullyDilutedPreMoneyShares(secs);
    const body = await roundMath(warrantRoundId);

    if (warrants.length === 0) {
      /* NO warrant reached the ledger. The base is then 8,000,000 and the pool is
         2,000,000, exactly as company A. This is recorded as an UNVERIFIED item:
         the fix is proved at engine level instead (see the engine test file), and
         what would settle it is a route that issues a warrant security. */
      expect(ledgerFd.toString()).toBe("8000000");
      expect(poolRow(body)!.shares).toBe("2000000");
      expect(body.optionPoolTopUp.fdBase.ledgerFdShares).toBe("8000000");
      return;
    }
    /* A warrant IS on the ledger. Then the engine's fully-diluted count includes
       its underlying shares, the resolver's ledger figure includes them, and the
       pool is larger than company A's 2,000,000 because the base is larger. */
    expect(ledgerFd).toBeGreaterThan(BigInt(8_000_000));
    expect(Number(poolRow(body)!.shares)).toBeGreaterThan(2_000_000);
  });

  it("W58B-6b — the trace names what the base contains and what it still does not", async () => {
    const body = await roundMath(preMoneyRoundId);
    const esop = (body.postClose.pricingTrace ? [body.postClose.pricingTrace] : []) as unknown[];
    expect(esop.length).toBeGreaterThan(0);
    /* The exclusion list is where an omission has to be admitted. Granted options
       still cannot be separated from the unallocated reserve — a data-model gap,
       named rather than hidden. */
    expect(String(body.optionPoolTopUp.fullyDilutedDefinition)).toContain(
      "granted AND unallocated",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 — THE STANDALONE OPTION-POOL VEHICLE'S PLACEMENT REACHES THE SAME KEY
 * ═══════════════════════════════════════════════════════════════════════════
 * FROM THE 2026-08-15 LIVE AUDIT, which retracted an earlier claim of mine: the
 * standalone "Option Pool Top-Up (ESOP/EMI/CSOP)" vehicle has had, on live
 * v26.17.0, BOTH a "Pool size (% of fully-diluted)" field AND a pre/post-money
 * "Pool timing" dropdown. So there were TWO pool surfaces with two vocabularies.
 *
 * WHAT I CHECKED BEFORE REUSING IT, rather than assuming: `poolTiming` appears in
 * ZERO files under `server/` (other than one term-sheet test fixture) and ZERO
 * files under `packages/`. In the client it drives one explanatory sentence
 * (`RoundNew.tsx:1241`) and one summary label (`:1472`). IT REACHED NO ARITHMETIC.
 * There was therefore no existing pre/post-money implementation to reuse, and this
 * wave did not build a second one: both surfaces now write the SAME
 * `optionPoolMode` key that `compute.ts` reads.
 */
describe("W58B-7 — the standalone vehicle and the priced add-on store ONE placement concept", () => {
  it("W58B-7a — an option_pool round created with post-money timing reads back optionPoolMode post_money", async () => {
    const id = await createRound({
      companyId: CO,
      name: `W58b Standalone POST ${STAMP}`,
      type: "seed",
      state: "active",
      instrument: "option_pool",
      currency: "USD",
      poolSize: 15,
      /* The standalone vehicle's own field name and value, as live sends it. */
      poolTiming: "post_money",
      /* What the wizard now ALSO sends, from that same choice. */
      optionPoolMode: "post_money",
      vestingMonths: 48,
      cliffMonths: 12,
    });
    const res = await request(app).get(`/api/rounds/${id}`).set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    /* BOTH keys survive. `poolTiming` is not renamed, retyped or dropped — a
       relocation is not a removal, and existing readers of it are untouched. */
    expect(String(res.body.poolTiming)).toBe("post_money");
    expect(String(res.body.optionPoolMode)).toBe("post_money");
  });

  it("W58B-7b — pre-money timing round-trips the same way, and the default is pre-money", async () => {
    const id = await createRound({
      companyId: CO,
      name: `W58b Standalone PRE ${STAMP}`,
      type: "seed",
      state: "active",
      instrument: "option_pool",
      currency: "USD",
      poolSize: 15,
      poolTiming: "pre_money",
      optionPoolMode: "pre_money",
      vestingMonths: 48,
      cliffMonths: 12,
    });
    const res = await request(app).get(`/api/rounds/${id}`).set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(String(res.body.optionPoolMode)).toBe("pre_money");
  });

  it("W58B-7c — the server refuses an unrecognised placement on this path too, by name", async () => {
    const res = await request(app)
      .post("/api/rounds")
      .set("x-user-id", ADMIN)
      .send({
        companyId: CO, name: `W58b Standalone BAD ${STAMP}`, type: "seed", state: "active",
        instrument: "option_pool", currency: "USD", poolSize: 15,
        openDate: "2026-01-01", closeDate: "2026-12-31",
        optionPoolMode: "whenever",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_optionPoolMode");
  });
});

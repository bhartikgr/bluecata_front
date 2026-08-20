/**
 * WAVE 52c — B1 AND B2 PROVED THROUGH REAL HTTP ROUTES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE IS A ROUTE TEST AND NOT AN ENGINE TEST
 * ═══════════════════════════════════════════════════════════════════════════
 * Wave 52b proved BOTH poles of the pricing-order flag — inside the engine
 * package, by calling `computeCapTable` with `pricingOrderMode` directly. Three
 * independent reviews then established that no production code called
 * `resolveW52PricingOrder()` at all, so the flag the owner had been told was the
 * rollback mechanism changed NOTHING in production. Wave 52b's proof was true
 * and irrelevant.
 *
 * So every assertion below goes through `registerRoutes` and supertest. Nothing
 * here calls the engine, the adapter or the store directly for its headline
 * claim. The falsification is stated per test in
 * `build_log/wave52c/W52C_NEW_TESTS.md`: reverting the registration in
 * `server/routes.ts` — a one-line deletion — turns every test in this file red,
 * which is exactly the property Wave 52b's tests did not have.
 *
 * B1 the flag is REACHABLE:  flip the `platform_config` row in the DATABASE, and
 *                            the price per share an HTTP route returns changes.
 * B2 the store is REACHABLE: a real commit through
 *                            POST /api/founder/captable/commit-funded writes a
 *                            `round_residual_disposition` row, and migration
 *                            0189's tables exist at runtime because the commit
 *                            path opened the store.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb, rawDb } from "../db/connection";
import {
  W52_PRICING_ORDER_FLAG_KEY,
  ensureW52PricingOrderFlag,
  listResidualDispositions,
  listConversionStatuses,
} from "../lib/roundMathDisclosureStore";
import { updatePlatformConfigValue } from "../lib/platformConfigWriter";
import { WAVE52B_TABLES } from "../lib/applyWave52bRoundMathSchema";

let app: Express;
const STAMP = String(Date.now());
const CO = `co_w52c_${STAMP}`;
const ADMIN = "u_admin";

/** Flip the flag IN THE DATABASE. No env var, no restart, no module reload. */
function setFlagInDb(enabled: boolean): number {
  ensureW52PricingOrderFlag("w52c_test");
  const row = updatePlatformConfigValue({
    key: W52_PRICING_ORDER_FLAG_KEY,
    valueJson: JSON.stringify(enabled),
    changedBy: "w52c_reachability_test",
  });
  return row.version;
}

function tableExists(name: string): boolean {
  const db = rawDb() as unknown as {
    prepare: (s: string) => { get: (...a: unknown[]) => unknown };
  };
  const r = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { name?: string } | undefined;
  return Boolean(r?.name);
}

let foundationRoundId = "";
let pricedRoundId = "";
let safeRoundId = "";

async function createRound(payload: Record<string, unknown>): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    /* openDate + closeDate are mandatory server-side (W3 Shadie 1a). */
    .send({ openDate: "2026-01-01", closeDate: "2026-12-31", ...payload });
  if (res.status !== 200) throw new Error(`createRound failed ${res.status} ${JSON.stringify(res.body)} for ${JSON.stringify(payload)}`);
  expect(res.body.ok).toBe(true);
  return res.body.id as string;
}

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);

  /* A cap table built ENTIRELY through production routes. No fixture is poked
     into an in-memory array: the founder block and the SAFE both arrive through
     the sacred money core, and the round-math route sees them through the same
     W-CAP / W-SAFE bridges the /founder/captable screen is served. */
  foundationRoundId = await createRound({
    companyId: CO, name: "W52c Foundation", type: "foundation", state: "closed",
    targetAmount: 1000, currency: "USD",
  });
  safeRoundId = await createRound({
    companyId: CO, name: "W52c Pre-seed SAFE", type: "preseed", state: "closed",
    targetAmount: 500_000, currency: "USD", instrument: "safe_post",
  });
  pricedRoundId = await createRound({
    companyId: CO, name: "W52c Series Seed", type: "seed", state: "active",
    targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 3, currency: "USD",
    instrument: "preferred",
    /* Both are server-mandatory for a priced round (Shadie finding 1a). */
    sharesAuthorized: "3333333", fdPreMoneyShares: "10000000",
  });

  // Founder block: 8,000,000 common through the real seed route.
  const seed = await request(app)
    .post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({ companyId: CO, roundId: foundationRoundId, shares: "8000000", amount: "800" });
  expect([200, 201]).toContain(seed.status);

  // A SAFE, committed UNPRICED through the real commit route.
  const safe = await request(app)
    .post("/api/founder/captable/commit-funded")
    .set("x-user-id", ADMIN)
    .send({
      invitationId: `inv_w52c_safe_${STAMP}`,
      roundId: safeRoundId,
      companyId: CO,
      investorId: "u_investor_w52c",
      amount: "500000",
      currency: "USD",
      shares: "0",
      instrumentClass: "unpriced",
      principalAmount: "500000",
    });
  expect(safe.status).toBe(200);
}, 60_000);

/* ═══════════════════════════════════════════════════════════════════════════
 * B1 — THE FLAG IS REACHABLE FROM PRODUCTION
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 52c B1 — the pricing-order flag reaches production through an HTTP route", () => {
  it("B1-1 — GET /api/founder/round-math/pricing-order resolves the flag FROM THE DATABASE", async () => {
    setFlagInDb(true);
    const on = await request(app)
      .get("/api/founder/round-math/pricing-order")
      .set("x-user-id", ADMIN);
    expect(on.status).toBe(200);
    expect(on.body.pricingOrder.source).toBe("platform_config");
    expect(on.body.pricingOrder.enabled).toBe(true);
    expect(on.body.pricingOrder.mode).toBe("w52_post_pool_post_conversion");

    setFlagInDb(false);
    const off = await request(app)
      .get("/api/founder/round-math/pricing-order")
      .set("x-user-id", ADMIN);
    expect(off.status).toBe(200);
    expect(off.body.pricingOrder.enabled).toBe(false);
    expect(off.body.pricingOrder.mode).toBe("legacy_pre_w52");
    /* The row version MOVED, so the flip is auditable rather than asserted. */
    expect(off.body.pricingOrder.version).toBeGreaterThan(on.body.pricingOrder.version);
    setFlagInDb(true);
  });

  it("B1-2 — the flag is NOT memoised: two requests in the same process disagree after a flip", async () => {
    setFlagInDb(true);
    const a = await request(app).get("/api/founder/round-math/pricing-order").set("x-user-id", ADMIN);
    setFlagInDb(false);
    const b = await request(app).get("/api/founder/round-math/pricing-order").set("x-user-id", ADMIN);
    expect(a.body.pricingOrder.mode).not.toBe(b.body.pricingOrder.mode);
    setFlagInDb(true);
  });

  it("B1-3 — FLIPPING THE DATABASE ROW CHANGES THE ARITHMETIC THE ROUTE RETURNS", async () => {
    setFlagInDb(true);
    const w52 = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      .set("x-user-id", ADMIN);
    expect(w52.status).toBe(200);
    expect(w52.body.pricingOrder.mode).toBe("w52_post_pool_post_conversion");
    expect(w52.body.projectable).toBe(true);

    setFlagInDb(false);
    const legacy = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      .set("x-user-id", ADMIN);
    expect(legacy.status).toBe(200);
    expect(legacy.body.pricingOrder.mode).toBe("legacy_pre_w52");

    const ppsW52 = w52.body.postClose.pricePerShare as string;
    const ppsLegacy = legacy.body.postClose.pricePerShare as string;
    expect(ppsW52).toBeTruthy();
    expect(ppsLegacy).toBeTruthy();

    /* THE POINT. Two HTTP responses, one database row apart, different price.
       The corrected order prices LOWER because the SAFE's converted shares are
       inside the pricing denominator; the legacy order prices before conversion
       and so overcharges the incoming investor. */
    expect(ppsW52).not.toBe(ppsLegacy);
    expect(Number(ppsW52)).toBeLessThan(Number(ppsLegacy));

    /* And the ownership the route publishes moves with it. */
    const totalW52 = w52.body.postClose.totalShares as string;
    const totalLegacy = legacy.body.postClose.totalShares as string;
    expect(totalW52).not.toBe(totalLegacy);
    expect(BigInt(totalW52) > BigInt(totalLegacy)).toBe(true);

    /* The trace states WHICH order produced the number — no reader has to infer. */
    expect(w52.body.postClose.pricingTrace.outputs.pricingOrderMode).toBe(
      "w52_post_pool_post_conversion",
    );
    expect(legacy.body.postClose.pricingTrace.outputs.pricingOrderMode).toBe("legacy_pre_w52");
    setFlagInDb(true);
  });

  it("B1-4 — every ownership percentage the route returns carries its denominator (B6)", async () => {
    const res = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    const rows = [...res.body.preClose.rows, ...res.body.postClose.rows] as Array<
      Record<string, unknown>
    >;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.ownershipPercent).toBeTruthy();
      expect(r.denominatorLabel).toBe("% of fully-diluted shares");
      expect(r.denominatorKey).toBe("fully_diluted");
      expect(r.ownershipPercentUnit).toBe("percent_as_written_r16");
      expect(String(r.denominatorShares)).toMatch(/^\d+$/);
    }
    /* Both bases are published with their definitions, which is the answer to
       "why is the same founder 40.000% / 48.485% / 51.613%". */
    expect(res.body.denominators.fully_diluted.definition).toContain("unallocated option pool");
    expect(res.body.denominators.issued_outstanding.definition).toContain("EXCLUDED");
  });

  it("B1-5 — the restatement disclosure (B3) is served WITH the arithmetic, and states the rollback when OFF", async () => {
    setFlagInDb(true);
    const on = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      .set("x-user-id", ADMIN);
    expect(on.body.disclosure.headline).toContain("corrected pricing order");
    expect(on.body.disclosure.body).toContain("previous");
    expect(on.body.disclosure.body).toContain("committed ledger rows");

    setFlagInDb(false);
    const off = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      .set("x-user-id", ADMIN);
    expect(off.body.disclosure.body).toContain("ROLLBACK ACTIVE");
    setFlagInDb(true);
  });

  it("B1-6 — the route refuses a percent it cannot read rather than rescaling it (R16)", async () => {
    const bad = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math?optionPoolPostPercent=250`)
      .set("x-user-id", ADMIN);
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe("POOL_PERCENT_OUT_OF_RANGE:250");

    /* PERCENT-AS-WRITTEN: 25 is 25% and is ACCEPTED. Before B4 this threw
       "Pool target must be < 100%" inside the engine, so this request is the
       reachability proof for B4 as well as its unit proof. */
    const ok = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math?optionPoolPostPercent=25`)
      .set("x-user-id", ADMIN);
    expect(ok.status).toBe(200);
    expect(ok.body.optionPoolTopUp.applied).toBe(true);
    expect(ok.body.optionPoolTopUp.targetPoolPercent).toBe("25");
    expect(ok.body.optionPoolTopUp.unit).toBe("percent_as_written_r16");
    /* A pool top-up dilutes, so the price per share must come out LOWER. */
    const noPool = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      .set("x-user-id", ADMIN);
    expect(noPool.body.optionPoolTopUp.applied).toBe(false);
    expect(Number(ok.body.postClose.pricePerShare)).toBeLessThan(
      Number(noPool.body.postClose.pricePerShare),
    );
  });

  it("B1-7 — the route does NOT guess the unit of the round's stored poolSize", async () => {
    const res = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      .set("x-user-id", ADMIN);
    expect(res.body.optionPoolTopUp.applied).toBe(false);
    expect(res.body.optionPoolTopUp.reason).toContain("ambiguous");
  });

  it("B1-8 — an unrelated caller gets 404, never 403 (no round-id enumeration)", async () => {
    const res = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      /* A REAL, authenticated founder of a DIFFERENT company. An unknown id
         would only prove requireAuth works, which is not the claim. */
      .set("x-user-id", "u_maya_chen");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("ROUND_NOT_FOUND");
  });

  it("B1-9 — the rounding policy (B5) is published with the arithmetic, deviations named", async () => {
    const res = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      .set("x-user-id", ADMIN);
    const dirs = res.body.rounding.directions as Record<string, { direction: string }>;
    expect(dirs.investor_shares.direction).toBe("floor");
    expect(dirs.subscription_amount.direction).toBe("ceil");
    expect(dirs.pool_topup_shares.direction).toBe("ceil");
    expect(dirs.safe_company_capitalization.direction).toBe("nearest");
    const devs = res.body.rounding.deviations as Array<{ site: string }>;
    expect(devs.map((d) => d.site).sort()).toEqual([
      "pool_topup_shares",
      "safe_company_capitalization",
    ]);
    /* The per-investor derivation §10 item 7 promised: N shares rounded down,
       $r unapplied. */
    expect(res.body.subscription.shares).toMatch(/^\d+$/);
    expect(typeof res.body.subscription.residualMinor).toBe("number");
    expect(
      res.body.subscription.appliedMinor + res.body.subscription.residualMinor,
    ).toBe(res.body.subscription.committedMinor);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * B2 — THE STORE AND MIGRATION 0189 ARE REACHABLE FROM PRODUCTION
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("WAVE 52c B2 — a real commit writes a residual_disposition row", () => {
  it("B2-1 — migration 0189's tables EXIST AT RUNTIME because the commit path opened the store", () => {
    for (const t of WAVE52B_TABLES) expect(tableExists(t)).toBe(true);
  });

  it("B2-2 — the UNPRICED commit in beforeAll stored a conversion status, fail-closed as `undetermined`", () => {
    const rows = listConversionStatuses(safeRoundId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].conversionStatus).toBe("undetermined");
    expect(rows[0].recordedBy).toBeTruthy();
  });

  it("B2-3 — A REAL COMMIT THROUGH THE PRODUCTION ROUTE WRITES A residual_disposition ROW", async () => {
    const before = listResidualDispositions(pricedRoundId).length;

    /* $1,000,000 at $3.00 → 333,333 shares (ROUNDDOWN), subscription
       $999,999.00 (ROUNDUP of 333,333 × 3 = exactly 999,999.00), residual
       $1.00 = 100 minor units. Recomputed by hand, not read back from code. */
    const res = await request(app)
      .post("/api/founder/captable/commit-funded")
      .set("x-user-id", ADMIN)
      .send({
        invitationId: `inv_w52c_priced_${STAMP}`,
        roundId: pricedRoundId,
        companyId: CO,
        investorId: "u_investor_w52c",
        amount: "1000000",
        currency: "USD",
        shares: "333333",
        residualDisposition: "returned",
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const after = listResidualDispositions(pricedRoundId);
    expect(after.length).toBe(before + 1);
    const row = after[after.length - 1];
    expect(row.residualDisposition).toBe("returned");
    expect(row.investorId).toBe("u_investor_w52c");
    expect(row.currency).toBe("USD");
    /* I-5, exactly zero tolerance: applied + residual == committed. */
    expect(row.appliedMinor + row.residualMinor).toBe(row.committedMinor);
    expect(row.committedMinor).toBe(100_000_000);
    expect(row.appliedMinor).toBe(99_999_900);
    expect(row.residualMinor).toBe(100);
    expect(row.recordedBy).toBeTruthy();
  });

  it("B2-4 — the route reads the stored row back, so it is visible on a screen", async () => {
    const res = await request(app)
      .get(`/api/founder/rounds/${pricedRoundId}/round-math`)
      .set("x-user-id", ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.residualStoreError).toBeNull();
    const stored = res.body.residualDispositions as Array<{ residualDisposition: string }>;
    expect(stored.some((r) => r.residualDisposition === "returned")).toBe(true);
  });

  it("B2-5 — a commit that supplies NO disposition stores NOTHING and does not invent one", async () => {
    const before = listResidualDispositions(pricedRoundId).length;
    const res = await request(app)
      .post("/api/founder/captable/commit-funded")
      .set("x-user-id", ADMIN)
      .send({
        invitationId: `inv_w52c_nodisp_${STAMP}`,
        roundId: pricedRoundId,
        companyId: CO,
        investorId: "u_investor_w52c_2",
        amount: "1000000",
        currency: "USD",
        shares: "333333",
      });
    expect(res.status).toBe(200);
    const after = listResidualDispositions(pricedRoundId);
    /* NOT stored. §11.4.3: the residual's treatment changes the post-money
       identity and has no defensible default, so a missing decision stays
       missing rather than becoming `waived`. */
    expect(after.length).toBe(before);
    expect(after.some((r) => r.investorId === "u_investor_w52c_2")).toBe(false);
  });

  it("B2-6 — the explicit route refuses a disposition outside the enumeration, and the CHECK is not weakened", async () => {
    const bad = await request(app)
      .post(`/api/founder/rounds/${pricedRoundId}/residual-disposition`)
      .set("x-user-id", ADMIN)
      .send({
        investorId: "u_investor_w52c_3",
        residualDisposition: "absorbed_by_company",
        currency: "USD",
        committedMinor: 100,
        appliedMinor: 100,
        residualMinor: 0,
      });
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe("RESIDUAL_DISPOSITION_NOT_ENUMERATED");
    expect(bad.body.allowed).toHaveLength(7);

    /* And an unreconciled triple is refused before it reaches SQL (I-5). */
    const unrec = await request(app)
      .post(`/api/founder/rounds/${pricedRoundId}/residual-disposition`)
      .set("x-user-id", ADMIN)
      .send({
        investorId: "u_investor_w52c_3",
        residualDisposition: "waived",
        currency: "USD",
        committedMinor: 1000,
        appliedMinor: 900,
        residualMinor: 50,
      });
    expect(unrec.status).toBe(422);
    expect(unrec.body.message).toContain("RESIDUAL_UNRECONCILED");
  });

  it("B2-7 — the explicit route stores an enumerated disposition end to end", async () => {
    const res = await request(app)
      .post(`/api/founder/rounds/${pricedRoundId}/residual-disposition`)
      .set("x-user-id", ADMIN)
      .send({
        investorId: "u_investor_w52c_4",
        residualDisposition: "credited_next_close",
        creditedToCloseRef: "second_close",
        currency: "USD",
        committedMinor: 500_000,
        appliedMinor: 499_900,
        residualMinor: 100,
      });
    expect(res.status).toBe(200);
    expect(res.body.row.residualDisposition).toBe("credited_next_close");
    expect(res.body.row.creditedToCloseRef).toBe("second_close");
  });

  it("B2-8 — the commit hook can never fail a money commit", async () => {
    /* A commit against a round that does not exist at all: the hook's round
       lookup returns undefined and every downstream computation is skipped. The
       sacred handler's own outcome is what the caller sees. */
    const res = await request(app)
      .post("/api/founder/captable/commit-funded")
      .set("x-user-id", ADMIN)
      .send({
        invitationId: `inv_w52c_norround_${STAMP}`,
        roundId: `rnd_does_not_exist_${STAMP}`,
        companyId: CO,
        investorId: "u_investor_w52c_5",
        amount: "1000",
        currency: "USD",
        shares: "100",
        residualDisposition: "waived",
      });
    /* Whatever the sacred store decides, the hook did not turn it into a 500. */
    expect(res.status).not.toBe(500);
  });
});

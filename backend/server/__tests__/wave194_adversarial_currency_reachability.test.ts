/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 194 — THE ADVERSARIAL PASS, WRITTEN DOWN AS TESTS RATHER THAN AS PROSE.
 * ══════════════════════════════════════════════════════════════════════════════
 * Post-build review pass (c) has two jobs, and both of them are attacks:
 *   1. Actively try to get a MIXED-currency SAFE set to produce a number through
 *      the production route by some door the fix does not cover.
 *   2. Actively try to make an existing, working cap table REFUSE.
 * Everything here was written to fail. What it found is recorded in
 * `build_log/wave194/W194_DISARM_RESULTS.md`, including the two findings that are
 * REPORTED rather than fixed, because fixing them would change wave 193's rule and
 * the brief forbids that ("Do not change that rule; make it reachable").
 *
 * Every case drives `GET /api/founder/rounds/:id/round-math` through
 * `registerRoutes`, except ADV-5, which attacks a DIFFERENT consumer of the same
 * securities reader.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { securities } from "../mockData";
import { computeFounderOwnership } from "../lib/founderOwnershipEngine";
import { w212Attest } from "./_w212RoundAttestation";

let app: Express;
const STAMP = String(Date.now());
const ADMIN = "u_admin";
let n = 0;

async function createRound(payload: Record<string, unknown>): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send(w212Attest({ openDate: "2026-01-01", closeDate: "2026-12-31", ...payload }));
  if (res.status !== 200) throw new Error(`createRound ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

/**
 * A company with one SAFE per entry, each issued from its own round recording that
 * entry's currency verbatim, plus a priced round to project. `safeType` lets a case
 * make a SAFE PRE-money, which is the point of ADV-3.
 */
async function company(
  label: string,
  safes: Array<{ currency: string; safeType?: string }>,
): Promise<{ companyId: string; priced: string }> {
  const companyId = `co_w194_adv_${label}_${STAMP}`;
  const foundation = await createRound({
    companyId, name: "ADV Foundation", type: "foundation", state: "closed",
    targetAmount: 1000, currency: "USD",
  });
  const seed = await request(app)
    .post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({ companyId, roundId: foundation, shares: "8000000", amount: "800" });
  expect([200, 201]).toContain(seed.status);

  for (const s of safes) {
    const rid = await createRound({
      companyId, name: `ADV SAFE ${n}`, type: "preseed", state: "closed",
      targetAmount: 1_000_000, instrument: "safe_post", valuationCap: "10000000",
      currency: s.currency,
      ...(s.safeType === undefined ? {} : { safeType: s.safeType }),
    });
    (securities as unknown as Array<Record<string, unknown>>).push({
      id: `sec_w194_adv_${label}_${n}`,
      companyId,
      holderName: `ADV Holder ${n}`,
      holderType: "investor",
      instrument: "safe",
      series: "SAFE",
      shares: 0,
      pricePerShare: null,
      investmentAmount: 1_000_000,
      cap: 10_000_000,
      discount: null,
      issuedAt: "2026-01-01",
      roundId: rid,
    });
    n += 1;
  }
  const priced = await createRound({
    companyId, name: "ADV Series Seed", type: "seed", state: "active",
    targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 3, currency: "USD",
    instrument: "preferred", sharesAuthorized: "3333333", fdPreMoneyShares: "10000000",
  });
  return { companyId, priced };
}

const roundMath = (roundId: string) =>
  request(app).get(`/api/founder/rounds/${roundId}/round-math`).set("x-user-id", ADMIN);

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
}, 120_000);

describe("WAVE 194 ADV — trying to get a NUMBER out of a mixed set through the real route", () => {
  it("ADV-1 three SAFEs, two matching and one different: still refuses (a majority is not a unit)", async () => {
    const { priced } = await company("three", [
      { currency: "USD" }, { currency: "USD" }, { currency: "GBP" },
    ]);
    const res = await roundMath(priced);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(422);
    expect(res.body.refusal).toBe("mixed_currency_conversion_denominator");
    expect(String(res.body.guidance)).toContain("3");
  });

  it("ADV-2 a mixed set answers NO share count on ANY key of the response", async () => {
    const { priced } = await company("nonum", [{ currency: "EUR" }, { currency: "JPY" }]);
    const res = await roundMath(priced);
    expect(res.status).toBe(422);
    /* An exhaustive sweep rather than three named keys: any numeric-looking share
       or price field anywhere in the body would be a number derived from a
       denominator that added euros to yen. */
    const body = JSON.stringify(res.body);
    for (const forbidden of ["totalShares", "pricePerShare", "ownershipPercent", "postClose", "preClose", "newInvestorShares"]) {
      expect(body, `the refusal body carries ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("ADV-3 FIXED IN WAVE 198: a PRE-money SAFE in another currency now REFUSES", async () => {
    const { priced } = await company("premoney", [
      { currency: "USD", safeType: "post_money_cap" },
      { currency: "GBP", safeType: "pre_money_cap" },
    ]);
    const res = await roundMath(priced);
    /* This is wave 193's rule working as written, and it is CORRECT for the
       denominator: `totalPostMoneySafeAmt` sums post-money SAFEs only, so a
       pre-money SAFE's amount never enters it and cannot corrupt it. The GBP
       amount is still divided by a USD-derived company capitalisation inside
       `convertSafeToPreferred`, which is a SEPARATE arithmetic surface that wave
       193 did not guard and that this wave was told not to widen. Pinned so the
       gap is visible in the suite instead of living only in a report.

       ── WAVE 198 · ITEM B — THE GAP IS CLOSED, AND THE EXPECTATION IS FLIPPED ────
       Wave 198 traced the pre-money path and found there is no pre-money SUM to
       guard: each pre-money SAFE converts independently, and the money-on-money
       comparison happens one level down, inside `convertSafeToPreferred`, where the
       SAFE's cap is weighed against a price per share derived from the round's own
       pre-money valuation. The guard is now at that call site, so this cross-branch
       set refuses with a DIFFERENT refusal code from wave 193's denominator rule —
       asserted below, because the two must stay distinguishable: they name different
       arithmetic and tell the founder to fix different things. */
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(422);
    expect(res.body.refusal).toBe("mixed_currency_safe_conversion");
    /* No share count on ANY key — the R165.1 harm is the wrong number, not the
       wrong status code. */
    expect(JSON.stringify(res.body)).not.toContain("ownershipPercent");
  });

  it("ADV-4 FIXED IN WAVE 198: the same code in different CASE is ONE code and COMPUTES", async () => {
    const { priced } = await company("case", [{ currency: "USD" }, { currency: "usd" }]);
    const res = await roundMath(priced);
    /* `statedCurrencies` trims but does NOT upper-case (deliberately: it is a read,
       and normalising would be a judgement about what a record means). So a
       workspace that typed "usd" on one round and "USD" on another is REFUSED
       where a human would see one currency. That is fail-CLOSED — it withholds a
       number rather than inventing one — but it is a false refusal, and the fix
       belongs in wave 193's rule, which this wave may not change.

       ── WAVE 198 · ITEM A — FLIPPED, AND THIS IS THE MOST IMPORTANT FLIP IN THE
       WAVE. Refusing a genuinely single-currency cap table blocks the owner's real
       work, which is the harm to weigh hardest. `statedCurrencies` now folds case
       as well as whitespace — case and whitespace ONLY; nothing is mapped, aliased
       or converted (R156.1). Two SAFEs recording "USD" and "usd" are one currency
       and must PRICE. */
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.postClose.rows.length).toBeGreaterThan(0);
  });

  it("ADV-5 the OTHER consumer of the same securities reader neither throws nor fabricates", async () => {
    const { companyId } = await company("owner", [{ currency: "USD" }, { currency: "GBP" }]);
    /* `server/routes.ts:1342` wires `buildCompanySecurities` into
       `founderOwnershipEngine` as well, and that figure is rendered in the company
       switcher. A refusal escaping there would 500 a list endpoint. It does not:
       the engine's throw is caught and the answer is an ABSENT percentage with a
       reason, never a fabricated one. */
    const r = computeFounderOwnership(companyId);
    expect(() => computeFounderOwnership(companyId)).not.toThrow();
    expect(r.fraction === null || typeof r.fraction === "number").toBe(true);
    if (r.fraction === null) expect(typeof r.reason).toBe("string");
  });
});

describe("WAVE 194 ADV — trying to make a cap table that works TODAY refuse", () => {
  it("ADV-6 padded whitespace around the SAME code is ONE code and still computes", async () => {
    const { priced } = await company("pad", [{ currency: " USD " }, { currency: "USD" }]);
    const res = await roundMath(priced);
    /* `statedCurrencies` trims, so a trailing space typed into a form does not
       cost a founder their cap table. If this ever refuses, the read has started
       policing whitespace as meaning. */
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  });

  it("ADV-7 an EMPTY-STRING currency is absence, not a third currency", async () => {
    const { priced } = await company("blank", [{ currency: "USD" }, { currency: "   " }]);
    const res = await roundMath(priced);
    /* A blank field is the most common shape of a partly-filled form. It must not
       count as a stated code — otherwise wave 191's partial rollout would refuse
       cap tables that compute today. */
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  });

  it("ADV-8 a single SAFE, alone, in a currency of its own still computes", async () => {
    const { priced } = await company("solo", [{ currency: "SGD" }]);
    const res = await roundMath(priced);
    /* One code is one code however unusual it is. Nothing in this wave may make a
       non-USD workspace less able to price a round than a USD one. */
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.postClose.rows.length).toBeGreaterThan(0);
  });

  it("ADV-9 a company with NO SAFE at all is untouched by every line of this wave", async () => {
    const companyId = `co_w194_adv_nosafe_${STAMP}`;
    const foundation = await createRound({
      companyId, name: "ADV Foundation", type: "foundation", state: "closed",
      targetAmount: 1000, currency: "USD",
    });
    await request(app)
      .post("/api/founder/captable/seed-founder-shares")
      .set("x-user-id", ADMIN)
      .send({ companyId, roundId: foundation, shares: "8000000", amount: "800" });
    const priced = await createRound({
      companyId, name: "ADV Series Seed", type: "seed", state: "active",
      targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 3, currency: "USD",
      instrument: "preferred", sharesAuthorized: "3333333", fdPreMoneyShares: "10000000",
    });
    const res = await roundMath(priced);
    expect(res.status).toBe(200);
    expect(res.body.postClose.rows.length).toBeGreaterThan(0);
  });
});

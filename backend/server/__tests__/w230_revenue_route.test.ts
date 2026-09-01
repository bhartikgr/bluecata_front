/**
 * WAVE 230 — THE REPORTED ARR FIGURE, DRIVEN OVER THE REAL ROUTE.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `w230_test_data_exclusion.test.ts`.
 *
 * That file proves `wave230RevenueImpact()` — the module that REPORTS the
 * before-and-after figures. It does NOT prove the aggregate that the admin
 * dashboard actually shows, which is computed by the private `computeKpis()`
 * inside `server/adminPlatformStore.ts`. Those are two different code paths, and
 * a wave that filtered one while believing it had filtered the other would ship a
 * dashboard still reporting test revenue while its own report claimed otherwise.
 *
 * So this file drives `GET /api/admin/dashboard/kpis` over real HTTP through the
 * PRODUCTION registrar `registerRoutes(server, app)` — async, two arguments — and
 * asserts on the JSON the admin client receives. Nothing here proves a replica:
 * `computeKpis` is never called directly, and the number asserted is the one that
 * reaches the screen.
 *
 * THE FIXTURE MOVES, AND THE ASSERTION IS AN EXACT DELTA.
 * The test first proves the test subscription's money IS in the published figure,
 * then marks it, then asserts the figure fell BY EXACTLY THAT AMOUNT — not
 * "by something", not "is smaller". A filter that excluded the wrong row, or
 * every row, or no row, fails. The delta form is used rather than an absolute
 * total because the bootstrap may seed subscriptions of its own; the delta is
 * attributable to this wave's change and an absolute total would not be.
 *
 * This file establishes all of its own preconditions and never reads
 * `process.env`.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import http from "node:http";
import request from "supertest";

const TENANT = "t_w230r";
const ACTOR = "u_w230r_admin";
const CO_TEST = "co_w230r_sd_test";
const CO_REAL = "co_w230r_real";

/** $24,000.00 and $11,000.00 in minor units. */
const AMT_TEST = 2_400_000;
const AMT_REAL = 1_100_000;

/* Every export of the real module is replaced, not just the one this route needs:
   a partial mock makes the PRODUCTION registrar fail to load, which would quietly
   push this file onto a replica. */
vi.mock("../lib/authMiddleware", () => {
  const pass = (_req: Request, _res: Response, next: NextFunction) => next();
  return {
    requireAuth: pass,
    requireAdmin: pass,
    requireFounder: pass,
    requireAuthOrThrow: pass,
    requireAuthenticated: pass,
  };
});

import { rawDb } from "../db/connection";
import { registerRoutes } from "../routes";
import { wave230EnsureAllColumns, wave230IsExcluded } from "../lib/wave230TestDataFlags";
import { wave230SetExcluded } from "../lib/wave230TestDataExclusion";

let app: Express;

function seedCompany(id: string, name: string): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO companies (id, tenant_id, name, sector, stage, is_demo)
       VALUES (?, ?, ?, 'Fintech', 'seed', 0)`,
    )
    .run(id, TENANT, name);
}

function seedSubscription(companyId: string, amountMinor: number): void {
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO subscriptions
         (company_id, status, plan, annual_amount_minor, currency, renews_on,
          invoices_count, version, prev_revision_hash, revision_hash,
          updated_at, updated_by)
       VALUES (?, 'active', 'founder_pro', ?, 'USD', '2027-01-01',
          0, 1, '', 'h_w230r_fixture', '2026-08-31T00:00:00.000Z', ?)`,
    )
    .run(companyId, amountMinor, ACTOR);
}

/** The ARR figure exactly as the admin dashboard receives it, in USD minor units. */
async function publishedArrUsdMinor(): Promise<number> {
  const res = await request(app).get("/api/admin/dashboard/kpis");
  expect(res.status, `KPI route did not answer 200: ${res.status} ${res.text?.slice(0, 200)}`).toBe(
    200,
  );
  /* The figure lives at `summary.arrByCurrencyMinor.USD`. The path was not
     assumed — an earlier run of this test asserted the wrong path and the
     assertion below reported the payload's real keys, which is why it names them
     on failure. An assertion that silently read `undefined` would have compared
     undefined to undefined and passed. */
  const v = res.body?.summary?.arrByCurrencyMinor?.USD;
  expect(
    typeof v,
    `summary.arrByCurrencyMinor.USD absent from the KPI payload — the assertion below would prove nothing. Got top-level keys: ${Object.keys(
      res.body ?? {},
    ).join(", ")}; summary keys: ${Object.keys(res.body?.summary ?? {}).join(", ")}`,
  ).toBe("number");
  return v as number;
}

beforeAll(async () => {
  const outcome = wave230EnsureAllColumns();
  expect(outcome["subscriptions"]?.ok, "w230 columns absent — the filter cannot bind").toBe(true);
  seedCompany(CO_TEST, "SD-TEST Wave 230 Route Co");
  seedCompany(CO_REAL, "BluePrint Catalyst Limited");
  seedSubscription(CO_TEST, AMT_TEST);
  seedSubscription(CO_REAL, AMT_REAL);

  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
});

describe("W230 · the ARR the admin dashboard publishes", () => {
  let withTestData = 0;

  it("FIRST: the test subscription's $24,000 IS in the published ARR", async () => {
    withTestData = await publishedArrUsdMinor();
    /* Load-bearing: if the subject were not in the published figure, the delta
       assertion below would pass against a filter that does nothing. */
    expect(
      withTestData,
      "the fixture did not reach the published ARR — nothing below would prove anything",
    ).toBeGreaterThanOrEqual(AMT_TEST + AMT_REAL);
    expect(wave230IsExcluded("subscriptions", CO_TEST)).toBe(false);
  });

  it("THEN: marking it drops the published ARR BY EXACTLY $24,000", async () => {
    const res = wave230SetExcluded({
      table: "subscriptions",
      id: CO_TEST,
      excluded: true,
      reason: "SD-TEST batch (route test)",
      actorId: ACTOR,
      tenantId: TENANT,
    });
    expect(res.ok, `write refused: ${JSON.stringify(res)}`).toBe(true);

    const afterMarking = await publishedArrUsdMinor();
    /* An EXACT delta. "Smaller than before" would also be satisfied by a filter
       that wrongly excluded the real company too. */
    expect(withTestData - afterMarking).toBe(AMT_TEST);
  });

  it("the real company in the SAME tenant is still in the published figure", async () => {
    /* CO_REAL shares TENANT with CO_TEST. Per R230.6 exclusion is per-record;
       a tenant-scoped filter would have removed this money as well, and the
       previous test's exact delta is what catches that. */
    expect(wave230IsExcluded("subscriptions", CO_REAL)).toBe(false);
    const arr = await publishedArrUsdMinor();
    expect(arr).toBeGreaterThanOrEqual(AMT_REAL);
  });

  it("AND UNSETTING RESTORES THE PUBLISHED FIGURE EXACTLY", async () => {
    const res = wave230SetExcluded({
      table: "subscriptions",
      id: CO_TEST,
      excluded: false,
      actorId: ACTOR,
      tenantId: TENANT,
    });
    expect(res.ok, `unset refused: ${JSON.stringify(res)}`).toBe(true);
    const restored = await publishedArrUsdMinor();
    /* Exact equality against the figure captured before anything was marked. This
       is what makes a misclassification a one-click correction. */
    expect(restored).toBe(withTestData);
  });
});

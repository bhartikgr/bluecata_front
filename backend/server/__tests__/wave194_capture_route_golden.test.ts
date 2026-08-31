/**
 * WAVE 194 — THE CAPTURE HARNESS FOR THE PRODUCTION-ROUTE GOLDEN.
 *
 * Not an assertion file. It builds the SAME single-currency company that
 * `wave194_production_path_currency.test.ts` builds, calls the same production
 * route, and writes the response body to
 * `build_log/wave194/ROUTE_GOLDEN_${W194_GOLDEN_MODE}.json`.
 *
 * It exists because this tree has no git, so the only way to obtain the
 * PRE-CHANGE bytes of the production route's response is to run this against the
 * tree with wave 194's runtime changes reverted by `W194_DISARM.py --revert-all`
 * and then restore. The "before" copy is therefore evidence captured from the
 * pre-change code, not an expectation written alongside the change.
 *
 * Run:  W194_GOLDEN_MODE=BEFORE npx vitest run server/__tests__/wave194_capture_route_golden.test.ts
 */
import { it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import fs from "node:fs";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { w212Attest } from "./_w212RoundAttestation";

let app: Express;
const STAMP = String(Date.now());
const ADMIN = "u_admin";
const CO = `co_w194_one_${STAMP}`;
const MODE = process.env.W194_GOLDEN_MODE ?? "AFTER";

async function createRound(payload: Record<string, unknown>): Promise<string> {
  const res = await request(app)
    .post("/api/rounds")
    .set("x-user-id", ADMIN)
    .send(w212Attest({ openDate: "2026-01-01", closeDate: "2026-12-31", ...payload }));
  if (res.status !== 200) throw new Error(`createRound ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

let priced = "";

beforeAll(async () => {
  getDb();
  app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);

  const foundation = await createRound({
    companyId: CO, name: "W194 Foundation", type: "foundation", state: "closed", targetAmount: 1000,
  });
  const seed = await request(app)
    .post("/api/founder/captable/seed-founder-shares")
    .set("x-user-id", ADMIN)
    .send({ companyId: CO, roundId: foundation, shares: "8000000", amount: "800" });
  expect([200, 201]).toContain(seed.status);

  for (let i = 0; i < 2; i += 1) {
    const rid = await createRound({
      companyId: CO, name: `W194 SAFE ${i + 1}`, type: "preseed", state: "closed",
      targetAmount: 1_000_000, instrument: "safe_post", valuationCap: "10000000", currency: "USD",
    });
    const commit = await request(app)
      .post("/api/founder/captable/commit-funded")
      .set("x-user-id", ADMIN)
      .send({
        invitationId: `inv_w194_${CO}_${i}_${STAMP}`,
        roundId: rid, companyId: CO, investorId: `u_inv_w194_${i}`,
        amount: "1000000", currency: "USD", shares: "0",
        instrumentClass: "unpriced", principalAmount: "1000000",
        valuationCap: "10000000",
      });
    expect(commit.status).toBe(200);
  }

  priced = await createRound({
    companyId: CO, name: "W194 Series Seed", type: "seed", state: "active",
    targetAmount: 10_000_000, preMoney: 30_000_000, pricePerShare: 3,
    instrument: "preferred", sharesAuthorized: "3333333", fdPreMoneyShares: "10000000",
  });
}, 120_000);

it(`captures the single-currency round-math response as ${MODE}`, async () => {
  const res = await request(app)
    .get(`/api/founder/rounds/${priced}/round-math`)
    .set("x-user-id", ADMIN);
  expect(res.status).toBe(200);
  const body = JSON.stringify(res.body);
  fs.writeFileSync(`build_log/wave194/ROUTE_GOLDEN_${MODE}.json`, body, "utf8");
  fs.writeFileSync(
    `build_log/wave194/ROUTE_GOLDEN_${MODE}.meta.txt`,
    `mode=${MODE}\nstamp=${STAMP}\ncompany=${CO}\npricedRoundId=${priced}\nchars=${body.length}\n`,
    "utf8",
  );
  // eslint-disable-next-line no-console
  console.log(`[W194] captured ${MODE}: ${body.length} chars`);
});

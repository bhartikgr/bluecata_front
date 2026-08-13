/**
 * server/__tests__/wave3f_item1_atomicity.test.ts
 *
 * WAVE 3F / ITEM 1 — the review's own adversarial reproduction, with the
 * assertions stated as the CORRECT outcome instead of the defective one.
 * Derived byte-for-byte from server/__tests__/w10_atomicity_repro.test.ts
 * (W10 REVIEW A) so the setup is identical and only the expectation moves.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { __authorizeForTest } from "../lib/feeSettlementAuthority";
import { rawDb } from "../db/connection";

const MANAGING = "u_avi_managing";
const ADMIN = "u_admin";
const PARTNER = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

const post = (path: string, user: string, body: unknown) =>
  request(app).post(path).set("x-user-id", user).send(body);
const patch = (path: string, user: string, body: unknown) =>
  request(app).patch(path).set("x-user-id", user).send(body);
const put = (path: string, user: string, body: unknown) =>
  request(app).put(path).set("x-user-id", user).send(body);

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

afterAll(() => {
  rawDb().exec("DROP TRIGGER IF EXISTS w3f_abort_distribution_insert");
});

describe("WAVE 3F / ITEM 1 — distribution + carry collection are ONE transaction", () => {
  it("W3F-1A — a failed distribution insert takes NO money with it", async () => {
    const created = await post("/api/partner/me/spv", MANAGING, {
      name: "W3F atomicity — item 1",
      jurisdiction: "delaware",
      carryBasis: "per_deployment",
      status: "open",
      signoffLegalName: "Avi Managing",
      signoffAccepted: true,
    });
    expect(created.status).toBe(201);
    const spvId = created.body.spv.id as string;

    const fee = await post(`/api/partner/me/spv/${spvId}/fees`, MANAGING, {
      layer: "management",
      feeType: "carry",
      carryPct: 0.2,
    });
    expect(fee.status).toBe(201);

    const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
      investorId: "inv_w3f_atomic",
      commitmentMinor: 100_000,
    });
    expect(sub.status).toBe(201);
    await put("/api/partner/me/compliance/inv_w3f_atomic", MANAGING, {
      kycStatus: "verified",
      accreditationStatus: "self_certified",
    });
    const committed = await patch(
      `/api/partner/me/spv/${spvId}/subscriptions/${sub.body.subscription.id}`,
      MANAGING,
      { to: "committed", subscriptionDocRef: "sig_w3f_atomic" },
    );
    expect(committed.status).toBe(200);

    rawDb().exec(`
      CREATE TRIGGER w3f_abort_distribution_insert
      BEFORE INSERT ON spv_distribution
      BEGIN
        SELECT RAISE(ABORT, 'W3F_FORCED_FINAL_INSERT_FAILURE');
      END
    `);

    expect(() =>
      spvEngineStore.recordDistribution(
        PARTNER,
        spvId,
        { event: "exit", grossProceedsMinor: 200_000, costBasisMinor: 100_000 },
        ADMIN,
        __authorizeForTest({ purpose: "distribution_carry", spvId, outcome: "succeeded" }),
      ),
    ).toThrow("W3F_FORCED_FINAL_INSERT_FAILURE");

    const db = rawDb();
    const distributionCount = db
      .prepare("SELECT COUNT(*) AS n FROM spv_distribution WHERE spv_id = ?")
      .get(spvId).n;
    const obligations = db
      .prepare("SELECT state, amount_minor, distribution_id FROM spv_fee_obligation WHERE spv_id = ?")
      .all(spvId);
    const payments = db
      .prepare("SELECT state, entry_json FROM payment_ledger WHERE intent_id LIKE 'spvfee_%'")
      .all()
      .map((p: any) => ({ state: p.state, ...JSON.parse(p.entry_json) }));

    console.log("W3F_ITEM1", { distributionCount, obligations, payments });
    /* THE FIX. The frozen artifact left distributionCount 0 WITH a `paid`
     * obligation and a `succeeded` payment — money taken, no distribution
     * recorded (W10 REVIEW A, CRITICAL). The whole sequence is now inside ONE
     * outer transaction, so the aborted final insert rolls back the
     * authorization consumption, the obligation and the payment with it. */
    expect(distributionCount).toBe(0);
    expect(obligations.some((o: any) => o.state === "paid" && o.amount_minor > 0)).toBe(false);
    expect(payments.some((p: any) => p.state === "succeeded" && p.amountCents > 0)).toBe(false);
    // And nothing is left half-written: no obligation row at all for this SPV.
    expect(obligations.length).toBe(0);
  });
});

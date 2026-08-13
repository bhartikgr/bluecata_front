import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { __authorizeForTest } from "../lib/feeSettlementAuthority";
import { rawDb } from "../db/connection";
import { chargeEngineSpvDeploymentFee } from "../lib/spvEngineDeploymentFeeHook";

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
  rawDb().exec("DROP TRIGGER IF EXISTS w10_abort_distribution_insert");
});

describe("W10 adversarial reproduction", () => {
  it("commits a paid carry charge even when the distribution insert fails", async () => {
    const created = await post("/api/partner/me/spv", MANAGING, {
      name: "W10 atomicity reproduction",
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
      investorId: "inv_w10_atomic",
      commitmentMinor: 100_000,
    });
    expect(sub.status).toBe(201);
    await put("/api/partner/me/compliance/inv_w10_atomic", MANAGING, {
      kycStatus: "verified",
      accreditationStatus: "self_certified",
    });
    const committed = await patch(
      `/api/partner/me/spv/${spvId}/subscriptions/${sub.body.subscription.id}`,
      MANAGING,
      { to: "committed", subscriptionDocRef: "sig_w10_atomic" },
    );
    expect(committed.status).toBe(200);

    rawDb().exec(`
      CREATE TRIGGER w10_abort_distribution_insert
      BEFORE INSERT ON spv_distribution
      BEGIN
        SELECT RAISE(ABORT, 'W10_FORCED_FINAL_INSERT_FAILURE');
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
    ).toThrow("W10_FORCED_FINAL_INSERT_FAILURE");

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

    console.log("W10_REPRO", { distributionCount, obligations, payments });
    expect(distributionCount).toBe(0);
    expect(obligations.some((o: any) => o.state === "paid" && o.amount_minor > 0)).toBe(true);
    expect(payments.some((p: any) => p.state === "succeeded" && p.amountCents > 0)).toBe(true);
  });

  it("bills the hardcoded catalyst tier when the canonical partner is actually builder", async () => {
    const db = rawDb();
    const columns = new Set(
      db.prepare("PRAGMA table_info(spv)").all().map((r: any) => r.name),
    );
    for (const [name, type] of [
      ["deployment_fee_minor", "INTEGER"],
      ["deployment_fee_currency", "TEXT"],
      ["deployment_fee_payer", "TEXT"],
      ["deployment_fee_paid_at", "TEXT"],
      ["deployment_fee_schedule_id", "TEXT"],
    ]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE spv ADD COLUMN ${name} ${type}`);
    }
    db.prepare(
      `INSERT OR REPLACE INTO partner_fee_schedules
       (id,tier,fee_kind,amount_minor,currency,size_band_min,size_band_max,effective_from,effective_to,created_at,updated_at,created_by)
       VALUES (?,?,?,?,?,0,NULL,'2020-01-01T00:00:00.000Z',NULL,'2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z','w10')`,
    ).run("w10_catalyst_fee", "catalyst", "spv_deployment", 11_100, "USD");
    db.prepare(
      `INSERT OR REPLACE INTO partner_fee_schedules
       (id,tier,fee_kind,amount_minor,currency,size_band_min,size_band_max,effective_from,effective_to,created_at,updated_at,created_by)
       VALUES (?,?,?,?,?,0,NULL,'2020-01-01T00:00:00.000Z',NULL,'2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z','w10')`,
    ).run("w10_builder_fee", "builder", "spv_deployment", 22_200, "USD");

    const created = await post("/api/partner/me/spv", MANAGING, {
      name: "W10 tier reproduction",
      jurisdiction: "delaware",
      carryBasis: "per_deployment",
      status: "open",
      targetRaiseMinor: 100_000,
      signoffLegalName: "Avi Managing",
      signoffAccepted: true,
    });
    expect(created.status).toBe(201);
    const spvId = created.body.spv.id as string;

    const partner = db
      .prepare("SELECT metadata_json FROM contacts WHERE id = ?")
      .get(PARTNER);
    const result = chargeEngineSpvDeploymentFee(spvId, PARTNER);
    const billed = db
      .prepare(
        `SELECT tier_at_funding, commission_minor
           FROM partner_billing_entries
          WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee'`,
      )
      .get(spvId);
    console.log("W10_TIER_REPRO", { canonicalPartnerTier: "builder", durableContact: partner, result, billed });
    expect(billed).toEqual({ tier_at_funding: "catalyst", commission_minor: 11_100 });
  });
});

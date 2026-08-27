/**
 * WAVE 163 · BLOCKER 2 — THE LEGACY OVERBILLING PATH IS CLOSED, AND THE PROOF IS MONEY.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHY IT ASSERTS A LEDGER ROW RATHER THAN A FUNCTION.
 * ═══════════════════════════════════════════════════════════════════════════════
 * Wave 160 corrected the ENGINE deployment-fee basis to confirmed capital only and
 * recorded FINDING W160-F1: a SECOND charge path, the legacy activation path at
 * `server/spvFundStore.ts:1251-1308`, still priced its SIZE BAND on the
 * denormalised column `spvs.committed_minor` — a column that
 * `spvEngineStore.subscribe` inflates with EVERY new subscription at `review`
 * time, because the mirror writes legacy status `"signed"`
 * (`spvFundStore.shadowCommitmentFromLegacyStrict:1417`). A non-binding
 * soft-circle therefore pushed a real partner into a higher fee band and billed
 * real money. R136.3 accepted that as fenced; R137.2 overrules it: *"W160-F1 must
 * be FIXED or PROVEN UNREACHABLE ... A partner being overbilled is not an open
 * item; it is a defect."*
 *
 * THE PATH IS REACHABLE — §1 reaches it through the real store writer and reads
 * the real billing ledger — so it is FIXED, not proved unreachable. Every band
 * assertion below reads `partner_billing_entries.commission_minor`, the row the
 * partner is invoiced from. A test asserting the resolver's return value would
 * prove the function and not the invoice (R137.1's objection to store-level
 * evidence), so the resolver poles in §4 are ADDITIONAL to the money, never
 * instead of it.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT MUST NOT MOVE, AND IS ASSERTED NOT TO.
 * ═══════════════════════════════════════════════════════════════════════════════
 * §1b — `spvs.committed_minor` KEEPS ITS INFLATED VALUE. The fix moved the fee
 *       BASIS, not the mirror, because that column is bound by CP-031
 *       (`committed_minor >= distributed_minor + called_minor`) and read by the
 *       whole legacy ladder. Wave 160's T0.6/T0.6b pin that value and must stay
 *       green.
 * §2  — A PURE-LEGACY VEHICLE IS BILLED EXACTLY AS BEFORE. Legacy signed rows
 *       with no engine counterpart are real signed capital; dropping them would be
 *       the mirror-image defect (silent UNDER-billing).
 * §3  — THE TARGET-RAISE FALLBACK IS RETAINED (R135.9, and the brief's explicit
 *       "Do NOT remove the target-raise fallback").
 *
 * ANTI-VACUITY (R134.7.4 / brief): `spv_subscription` and `spv_commitments` hold
 * zero relevant rows on a fresh test database, so every population below is
 * CONSTRUCTED — committed, soft-circled, founder-confirmed, withdrawn, pure-legacy
 * signed, and a legacy row that mirrors a pre-commitment subscription.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { getDb, rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { spvFundStore } from "../spvFundStore";
import { resolveLegacyActivationFeeBasis } from "../lib/legacySpvActivationFeeBasis";
import { __resetDeploymentFeeBillingLatchForTest } from "../lib/spvEngineDeploymentFeeHook";
import { resolveCanonicalPartnerTier } from "../lib/partnerTierResolver";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";
import { ensureWave50MoneyDefectSchema } from "../lib/applyWave50MoneyDefectSchema";
import { SPV_COMMITTED_SUBSCRIPTION_STATUS } from "@shared/spvCommittedCapital";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";

/* The same band shape wave 160 used, with sentinels unique to THIS file so a
   green assertion can only be explained by the band this fixture seeded. */
const BAND_1_FEE = 13_631; // sizeMinor < BAND_BOUNDARY
const BAND_2_FEE = 76_419; // sizeMinor >= BAND_BOUNDARY
const BAND_BOUNDARY = 500_000; // $5,000.00

const CONFIRMED_MINOR = 100_000; //  $1,000.00 — comfortably band 1
const SOFT_CIRCLE_MINOR = 900_000; // $9,000.00 — on its own, band 2

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}
const post = (p: string, u: string, b?: unknown) => request(app).post(p).set("x-user-id", u).send(b ?? {});
const patch = (p: string, u: string, b?: unknown) => request(app).patch(p).set("x-user-id", u).send(b ?? {});

/** The ledger row the partner is actually invoiced from. */
function billedMinor(spvId: string): number | null {
  const r = db()
    .prepare(
      `SELECT commission_minor FROM partner_billing_entries
        WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee'`,
    )
    .get(spvId) as { commission_minor: number } | undefined;
  return r ? r.commission_minor : null;
}

async function createEngineSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "per_deployment",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    ...extra,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.spv.id as string;
}

/** A subscription at any stage, built through the real writers (wave 160's ladder). */
async function subscribeAt(spvId: string, investorId: string, minor: number, stage: string): Promise<string> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
    investorId,
    commitmentMinor: minor,
    currency: "USD",
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  const subId = sub.body.subscription.id as string;
  expect(sub.body.subscription.status).toBe("review");
  if (stage === "review") return subId;
  if (stage === SPV_COMMITTED_SUBSCRIPTION_STATUS) {
    const p = spvEngineStore.projectLpCommitted(PARTNER, spvId, { investorId, commitmentMinor: minor, currency: "USD" });
    expect(p.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
    return subId;
  }
  const ladder: Record<string, string[]> = {
    soft_circled: ["soft_circled"],
    founder_confirmed: ["soft_circled", "founder_confirmed"],
    withdrawn: ["withdrawn"],
  };
  for (const to of ladder[stage] ?? [stage]) {
    const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to });
    expect(res.status, `advance to ${to}: ${JSON.stringify(res.body)}`).toBe(200);
  }
  return subId;
}

/** The legacy activation charge only fires when the legacy row carries a sourcing
 *  partner (`spvFundStore.ts:1261`). Real deployments set it; a fixture must. */
function setSourcingPartner(spvId: string): void {
  db().prepare(`UPDATE spvs SET sourcing_partner_id = ? WHERE id = ?`).run(PARTNER, spvId);
  const check = db().prepare(`SELECT sourcing_partner_id FROM spvs WHERE id = ?`).get(spvId) as
    | { sourcing_partner_id: string | null }
    | undefined;
  expect(check?.sourcing_partner_id, "without a sourcing partner the legacy charge never runs and every band assertion below would be vacuously null").toBe(PARTNER);
}

/** Drive the REAL legacy writer into 'active' — this is the live charge path. */
function activateLegacy(spvId: string): void {
  const row = spvFundStore.updateSpv({ spvId, actor: MANAGING, patch: { status: "active" } });
  expect(row.status).toBe("active");
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  __resetDeploymentFeeBillingLatchForTest();

  ensureWave152PricingSchema(db());
  ensureWave45PricingSchema(db());
  ensureWave50MoneyDefectSchema(db());

  const tier = resolveCanonicalPartnerTier(PARTNER, db());
  db().prepare(`DELETE FROM partner_fee_schedules WHERE fee_kind = 'spv_deployment' AND tier IS NOT NULL`).run();
  const now = new Date().toISOString();
  const from = "2000-01-01T00:00:00.000Z";
  const ins = db().prepare(
    `INSERT INTO partner_fee_schedules
       (id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max, effective_from, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  ins.run(`w163_band1`, tier, "spv_deployment", BAND_1_FEE, "USD", 0, BAND_BOUNDARY, from, now, now);
  ins.run(`w163_band2`, tier, "spv_deployment", BAND_2_FEE, "USD", BAND_BOUNDARY, null, from, now, now);
});

/* ══════════════════════════════════════════════════════════════════════════
 * §0 — THE FIXTURE IS NOT VACUOUS: THE TWO BANDS REALLY DO BILL DIFFERENTLY
 *      THROUGH THE LEGACY PATH.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W163 §0 — the legacy path can reach both bands", () => {
  it("T163B2.0: a vehicle whose CONFIRMED capital crosses the boundary is billed band 2 by the legacy path", async () => {
    const spvId = await createEngineSpv("W163 legacy band2 by confirmed capital");
    await subscribeAt(spvId, `u_w163_b2_${Date.now()}`, BAND_BOUNDARY + 1, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    setSourcingPartner(spvId);
    activateLegacy(spvId);
    /* If this read BAND_1_FEE the bands would not be wired and every assertion in
       §1 would be green for the wrong reason. */
    expect(billedMinor(spvId), "band 2 must be reachable through the legacy path").toBe(BAND_2_FEE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §1 — THE DEFECT, IN MONEY. A SOFT-CIRCLE NO LONGER SELECTS A HIGHER BAND.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W163 §1 — R137.2 / R134.1: the legacy activation fee is banded on confirmed capital only", () => {
  it("T163B2.1: $1,000.37 committed + $9,000.71 soft-circled is billed BAND 1 — the overbilling path is closed", async () => {
    const spvId = await createEngineSpv("W163 legacy overbilling closed");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w163_com_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w163_soft_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");
    setSourcingPartner(spvId);

    /* The inflated column, measured BEFORE activation so the averted overcharge is
       recorded rather than asserted from the fix's own point of view. */
    const mirror = db().prepare(`SELECT committed_minor FROM spvs WHERE id = ?`).get(spvId) as {
      committed_minor: number | null;
    };
    expect(
      mirror.committed_minor,
      "FINDING W160-F1 must still be reproducible, or this test proves nothing was fixed",
    ).toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR);
    expect(mirror.committed_minor! >= BAND_BOUNDARY, "the inflated column must be band-2 sized").toBe(true);

    activateLegacy(spvId);

    /* THE ASSERTION THIS WHOLE FILE EXISTS FOR. Before wave 163 this read
       BAND_2_FEE — the partner was invoiced 76,419 on $9,000.71 of non-binding
       interest. It must now read BAND_1_FEE. */
    expect(
      billedMinor(spvId),
      "a non-binding soft-circle must NOT select a higher deployment-fee band on the legacy path",
    ).toBe(BAND_1_FEE);
    expect(billedMinor(spvId), "the inflated basis must not reach a fee band").not.toBe(BAND_2_FEE);
  });

  it("T163B2.1b: the mirror column KEEPS its value — the basis moved, not the column (CP-031, wave 160 T0.6)", async () => {
    const spvId = await createEngineSpv("W163 mirror column untouched");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w163_mc_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w163_mc2_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");
    setSourcingPartner(spvId);
    const before = db().prepare(`SELECT committed_minor, called_minor, distributed_minor FROM spvs WHERE id = ?`).get(spvId);
    activateLegacy(spvId);
    const after = db().prepare(`SELECT committed_minor, called_minor, distributed_minor FROM spvs WHERE id = ?`).get(spvId);
    expect(after, "correcting the fee basis must not move a single legacy money column").toEqual(before);
    expect((after as any).committed_minor).toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR);
    /* CP-031, stated rather than assumed. */
    expect((after as any).committed_minor >= (after as any).called_minor + (after as any).distributed_minor).toBe(true);
  });

  it("T163B2.1c: a founder_confirmed stage is interest too — it does not raise the band", async () => {
    const spvId = await createEngineSpv("W163 founder_confirmed is not capital");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w163_fc1_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w163_fc2_${stamp}`, SOFT_CIRCLE_MINOR, "founder_confirmed");
    setSourcingPartner(spvId);
    activateLegacy(spvId);
    expect(billedMinor(spvId), "founder_confirmed is one of two R131.1 conditions; one of two is not a commitment").toBe(
      BAND_1_FEE,
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — A PURE-LEGACY VEHICLE IS BILLED EXACTLY AS BEFORE (no under-billing).
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W163 §2 — legacy signed capital with no engine counterpart still bills", () => {
  it("T163B2.2: a pure-legacy vehicle whose signed commitments cross the boundary is still billed band 2", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER,
      name: "W163 pure legacy vehicle",
      status: "fundraising",
      targetMinor: 10_000,
    });
    spvFundStore.addCommitment({
      spvId: spv.id,
      lpUserId: `u_w163_legacy_a_${Date.now()}`,
      amountMinor: BAND_BOUNDARY + 1,
      status: "signed",
      actor: MANAGING,
    } as any);
    setSourcingPartner(spv.id);
    /* There is no engine subscription for this vehicle at all — the exclusion rule
       must therefore exclude nothing. */
    const engineRows = db().prepare(`SELECT COUNT(*) AS n FROM spv_subscription WHERE spv_id = ?`).get(spv.id) as {
      n: number;
    };
    expect(engineRows.n, "this vehicle must be pure legacy, or the test measures the wrong population").toBe(0);
    activateLegacy(spv.id);
    expect(billedMinor(spv.id), "real signed legacy capital must not be silently dropped from the basis").toBe(BAND_2_FEE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 — THE TARGET-RAISE FALLBACK IS RETAINED (R135.9; brief: do NOT remove it).
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W163 §3 — the target-raise fallback survives", () => {
  it("T163B2.3: a vehicle with NO confirmed capital and NO legacy commitments is banded on target_minor", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER,
      name: "W163 target fallback vehicle",
      status: "fundraising",
      targetMinor: BAND_BOUNDARY + 1,
    });
    setSourcingPartner(spv.id);
    const basis = resolveLegacyActivationFeeBasis(db(), spv.id, null);
    expect(basis.basis, "with no capital at all the fallback must still answer").toBe("target_raise_fallback");
    expect(basis.sizeMinor).toBe(BAND_BOUNDARY + 1);
    activateLegacy(spv.id);
    expect(billedMinor(spv.id), "the fallback must still produce a real invoice").toBe(BAND_2_FEE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §4 — RESOLVER POLES. Additional to the money above, never instead of it.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W163 §4 — the resolver reports which population it used", () => {
  it("T163B2.4: a mirrored pre-commitment row is reported as EXCLUDED, with the averted amount", async () => {
    const spvId = await createEngineSpv("W163 resolver reports exclusion");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w163_rp1_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w163_rp2_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");
    const basis = resolveLegacyActivationFeeBasis(db(), spvId, null);
    expect(basis.sizeMinor).toBe(CONFIRMED_MINOR);
    expect(basis.confirmedCapitalMinor).toBe(CONFIRMED_MINOR);
    expect(basis.excludedPreCommitmentRows).toBe(1);
    expect(basis.excludedPreCommitmentMinor).toBe(SOFT_CIRCLE_MINOR);
    /* The averted overcharge is REPORTED, so a dispute can be answered from the
       record rather than re-derived. */
    expect(basis.legacyMirrorColumnMinor).toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR);
    expect(basis.basis).toBe("confirmed_capital");
  });

  it("T163B2.5: a withdrawn subscription contributes nothing and is not counted as legacy-only", async () => {
    const spvId = await createEngineSpv("W163 withdrawn contributes nothing");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w163_wd1_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w163_wd2_${stamp}`, SOFT_CIRCLE_MINOR, "withdrawn");
    const basis = resolveLegacyActivationFeeBasis(db(), spvId, null);
    expect(basis.sizeMinor).toBe(CONFIRMED_MINOR);
    expect(basis.legacyOnlySignedMinor).toBe(0);
  });

  it("T163B2.6: an unreadable amount is ABSENT, never coerced to zero-or-garbage", () => {
    const spv = spvFundStore.createSpv({
      partnerId: PARTNER,
      name: "W163 unreadable amount",
      status: "fundraising",
      targetMinor: 4_242,
    });
    /* A non-integer minor amount written straight past the store, which is the only
       way this state occurs. It must not become a band. */
    db()
      .prepare(
        `INSERT INTO spv_commitments (id, tenant_id, spv_id, lp_user_id, amount_minor, status, curr_hash, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(`w163_bad_${Date.now()}`, "t_test", spv.id, "u_w163_bad", 1.5, "signed", "", "2026-01-01", "2026-01-01");
    const basis = resolveLegacyActivationFeeBasis(db(), spv.id, null);
    expect(basis.legacyOnlySignedMinor, "a non-integer minor amount is absent, not 1 and not 2").toBe(0);
    expect(basis.basis).toBe("target_raise_fallback");
    expect(basis.sizeMinor).toBe(4_242);
  });
});

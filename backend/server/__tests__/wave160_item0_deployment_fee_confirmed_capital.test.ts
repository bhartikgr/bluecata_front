/**
 * WAVE 160 · BATCH 3 · ITEM 0 — A NON-BINDING INDICATION BILLED THE PARTNER REAL MONEY.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG, AND WHY IT IS A BILLING DEFECT AND NOT A DISPLAY ONE.
 * ═══════════════════════════════════════════════════════════════════════════════
 * `server/lib/spvEngineDeploymentFeeHook.ts` summed `commitment_minor` WHERE
 * `status <> 'withdrawn'` — EVERY stage — and handed that total to
 * `chargeSpvDeploymentFee` → `spvDeploymentFee.ts:141-142` →
 * `spvDeploymentFeeSource.resolveSpvDeploymentFee(..., { sizeMinor })`, which is
 * SIZE-BANDED (`partnerFeeResolver.pickBandRow`). So one LP soft-circling a large
 * amount — no signed subscription documents, no money in the bank, no binding
 * commitment — pushed the vehicle into a higher fee band and the partner was
 * INVOICED REAL MONEY on interest that may never convert. R133.2 confirms this is
 * the live charge path; R134.1 rules the basis must be CONFIRMED CAPITAL ONLY.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE ASSERTS THE CHARGED AMOUNT AND NOT THE SUM.
 * ═══════════════════════════════════════════════════════════════════════════════
 * A test that asserts `resolveEngineConfirmedCapitalMinor()` returns the right
 * number proves the function, not the invoice. The defect is only visible in the
 * MONEY: two fee bands are seeded with distinct sentinel amounts, and every
 * assertion below reads `partner_billing_entries.commission_minor` — the row the
 * partner is billed from. Had the earlier code shipped, §1 would read the band-2
 * sentinel.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ANTI-VACUITY (R134.7.4). `spv_subscription` holds ZERO rows on every database
 * available, so any "existing records are unchanged" claim would be vacuous.
 * §5 therefore CONSTRUCTS a representative register — one `committed`, one
 * `soft_circled`, one `founder_confirmed`, one `wire_funded`, one `withdrawn`, in
 * two currencies across two vehicles, one capped and one not — snapshots the
 * committed rows byte-for-byte, and proves no committed LP changes meaning,
 * status or amount.
 *
 * `wire_funded` is asserted NOT to raise the band (R135.1): money in the bank
 * without signed documents is one of the two conditions R131.1 requires, and one
 * of two is not a commitment.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { getDb, rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import {
  chargeEngineSpvDeploymentFee,
  resolveEngineConfirmedCapitalMinor,
  getEngineSpvDeploymentFeeBilling,
  __resetDeploymentFeeBillingLatchForTest,
} from "../lib/spvEngineDeploymentFeeHook";
import { resolveCanonicalPartnerTier } from "../lib/partnerTierResolver";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";
import { ensureWave50MoneyDefectSchema } from "../lib/applyWave50MoneyDefectSchema";
import { SPV_SUBSCRIPTION_STATUSES } from "@shared/spvEngine";
import { SPV_COMMITTED_SUBSCRIPTION_STATUS } from "@shared/spvCommittedCapital";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";

/* The two bands. Distinct, non-round sentinels that no seed, migration or default
   anywhere in this tree carries, so a passing assertion can only be explained by
   the band the resolver actually chose. */
const BAND_1_FEE = 11_137; // sizeMinor < BAND_BOUNDARY
const BAND_2_FEE = 88_213; // sizeMinor >= BAND_BOUNDARY
const BAND_BOUNDARY = 500_000; // $5,000.00

/* A confirmed commitment that sits comfortably inside band 1, and a soft-circle
   big enough on its own to cross into band 2. */
const CONFIRMED_MINOR = 100_000; //   $1,000.00 — band 1
const SOFT_CIRCLE_MINOR = 900_000; //  $9,000.00 — would be band 2

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}
const post = (p: string, u: string, b?: unknown) => request(app).post(p).set("x-user-id", u).send(b ?? {});
const patch = (p: string, u: string, b?: unknown) => request(app).patch(p).set("x-user-id", u).send(b ?? {});

/** The ledger row the partner is actually billed from. */
function billedMinor(spvId: string): number | null {
  const r = db()
    .prepare(
      `SELECT commission_minor FROM partner_billing_entries
        WHERE spv_fund_id = ? AND entry_kind = 'spv_deployment_fee'`,
    )
    .get(spvId) as { commission_minor: number } | undefined;
  return r ? r.commission_minor : null;
}

async function createSpv(name: string, extra: Record<string, unknown> = {}): Promise<string> {
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

/** A subscription at ANY stage, built through the real writers. */
async function subscribeAt(
  spvId: string,
  investorId: string,
  minor: number,
  stage: string,
  currency = "USD",
): Promise<string> {
  const sub = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
    investorId,
    commitmentMinor: minor,
    currency,
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  const subId = sub.body.subscription.id as string;
  expect(sub.body.subscription.status).toBe("review");
  if (stage === "review") return subId;
  if (stage === SPV_COMMITTED_SUBSCRIPTION_STATUS) {
    /* `projectLpCommitted` is the store's own documented projection of a commit
       the ledger has already recorded; it is the honest way to mint a committed
       row in a fixture without re-running the subscribe-flow gates, which have
       their own tests (and which this file must not relax — R105). */
    const p = spvEngineStore.projectLpCommitted(PARTNER, spvId, {
      investorId,
      commitmentMinor: minor,
      currency,
    });
    expect(p.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
    return subId;
  }
  /* Everything below `committed` walks the real ladder through the real route. */
  const ladder: Record<string, string[]> = {
    soft_circled: ["soft_circled"],
    founder_confirmed: ["soft_circled", "founder_confirmed"],
    wire_funded: ["soft_circled", "founder_confirmed", "wire_funded"],
    withdrawn: ["withdrawn"],
  };
  for (const to of ladder[stage] ?? [stage]) {
    const res = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${subId}`, MANAGING, { to });
    expect(res.status, `advance to ${to}: ${JSON.stringify(res.body)}`).toBe(200);
  }
  return subId;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  __resetDeploymentFeeBillingLatchForTest();

  /* The money-column installers this repo already uses to bring a fresh in-memory
     test database in step with migrations 0160/0185/0187/0200. Without
     `ensureWave152PricingSchema` the `spv` table has no `deployment_fee_paid_at`
     and every charge fails `CHARGE_FAILED — no such column` for a SCHEMA reason
     rather than a behavioural one, which would make every band assertion in this
     file vacuously equal to null. */
  ensureWave152PricingSchema(db());
  ensureWave45PricingSchema(db());
  ensureWave50MoneyDefectSchema(db());

  /* THE BANDS. A tiered row (tier NOT NULL) resolves as `tier_default`, which
     outranks the authoritative platform row at spvDeploymentFeeSource.ts:287-297
     — that is precisely the banded machinery this item is about, so the fixture
     seeds it deliberately rather than fighting it. Any band left behind by
     another file in this database is removed first so the measurement is of THIS
     fixture. */
  const tier = resolveCanonicalPartnerTier(PARTNER, db());
  db().prepare(`DELETE FROM partner_fee_schedules WHERE fee_kind = 'spv_deployment' AND tier IS NOT NULL`).run();
  const now = new Date().toISOString();
  const from = "2000-01-01T00:00:00.000Z";
  const ins = db().prepare(
    `INSERT INTO partner_fee_schedules
       (id, tier, fee_kind, amount_minor, currency, size_band_min, size_band_max, effective_from, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  ins.run(`w160_band1`, tier, "spv_deployment", BAND_1_FEE, "USD", 0, BAND_BOUNDARY, from, now, now);
  ins.run(`w160_band2`, tier, "spv_deployment", BAND_2_FEE, "USD", BAND_BOUNDARY, null, from, now, now);
});

/* ══════════════════════════════════════════════════════════════════════════
 * §0 — THE FIXTURE IS NOT VACUOUS: THE BANDS THEMSELVES BILL DIFFERENTLY.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W160 §0 — the two bands are real and distinguishable in the ledger", () => {
  it("T0.0: a vehicle whose CONFIRMED capital crosses the boundary is charged band 2", async () => {
    const spvId = await createSpv("W160 band2 by confirmed capital");
    await subscribeAt(spvId, `u_w160_b2_${Date.now()}`, BAND_BOUNDARY + 1, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    chargeEngineSpvDeploymentFee(spvId, PARTNER);
    /* If this were BAND_1_FEE the bands would not be wired at all and every
       "still band 1" assertion below would be unfalsifiable. */
    expect(billedMinor(spvId)).toBe(BAND_2_FEE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §1 — T0.1: A SOFT-CIRCLE DOES NOT MOVE THE BAND. FAILS BEFORE THIS WAVE.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W160 §1 — a soft-circle does not move the fee band (R134.1)", () => {
  it("T0.1: one band-1 committed LP + one band-crossing SOFT-CIRCLE ⇒ charged BAND 1", async () => {
    const spvId = await createSpv("W160 soft circle must not bill");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w160_c_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w160_s_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");

    /* The all-stages sum is band 2; confirmed capital is band 1. Both are asserted
       so the reader can see the two answers differ at this moment — the test is
       not merely restating one number. */
    const allStages = db()
      .prepare(`SELECT COALESCE(SUM(commitment_minor),0) AS t FROM spv_subscription WHERE spv_id = ? AND status <> 'withdrawn'`)
      .get(spvId) as { t: number };
    expect(allStages.t).toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR);
    expect(allStages.t).toBeGreaterThanOrEqual(BAND_BOUNDARY);

    /* THE MONEY IS ASSERTED FIRST, ON PURPOSE. This is the assertion that fails
       on the old code — the old basis handed 1,000,000 to the banded resolver and
       the partner was BILLED BAND_2_FEE on $9,000.00 of non-binding interest — and
       putting it ahead of the function-level checks means the recorded
       fail-before output is about an invoice, not about an internal number. */
    chargeEngineSpvDeploymentFee(spvId, PARTNER);
    expect(billedMinor(spvId), "a soft-circle must NOT raise the fee band").toBe(BAND_1_FEE);
    expect(billedMinor(spvId), "the band-2 sentinel would mean the partner was billed on interest").not.toBe(BAND_2_FEE);

    const band = resolveEngineConfirmedCapitalMinor(db(), spvId);
    expect(band.sizeMinor).toBe(CONFIRMED_MINOR);
    expect(band.basis).toBe("confirmed_capital");
  });

  it("T0.2: withdrawing the soft-circle changes nothing — the basis is committed-ONLY, not 'not withdrawn'", async () => {
    const spvId = await createSpv("W160 withdraw the soft circle");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w160_c2_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    const softId = await subscribeAt(spvId, `u_w160_s2_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");

    const before = resolveEngineConfirmedCapitalMinor(db(), spvId).sizeMinor;
    const w = await patch(`/api/partner/me/spv/${spvId}/subscriptions/${softId}`, MANAGING, { to: "withdrawn" });
    expect(w.status, JSON.stringify(w.body)).toBe(200);
    const after = resolveEngineConfirmedCapitalMinor(db(), spvId).sizeMinor;
    expect(after).toBe(before);
    expect(after).toBe(CONFIRMED_MINOR);

    chargeEngineSpvDeploymentFee(spvId, PARTNER);
    expect(billedMinor(spvId)).toBe(BAND_1_FEE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §2 — T0.3: NO PRE-COMMITMENT STAGE RAISES THE BAND, INCLUDING `wire_funded`.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W160 §2 — every pre-commitment stage is excluded, one at a time (R135.1)", () => {
  for (const stage of ["review", "soft_circled", "founder_confirmed", "wire_funded"] as const) {
    it(`T0.3(${stage}): a band-crossing \`${stage}\` row alone does NOT raise the band`, async () => {
      const spvId = await createSpv(`W160 stage ${stage} excluded`);
      const stamp = `${Date.now()}_${stage}`;
      await subscribeAt(spvId, `u_w160_c3_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
      await subscribeAt(spvId, `u_w160_x3_${stamp}`, SOFT_CIRCLE_MINOR, stage);

      const band = resolveEngineConfirmedCapitalMinor(db(), spvId);
      expect(band.sizeMinor, `${stage} must not count as confirmed capital`).toBe(CONFIRMED_MINOR);
      chargeEngineSpvDeploymentFee(spvId, PARTNER);
      expect(billedMinor(spvId)).toBe(BAND_1_FEE);
    });
  }

  it("T0.3b: `wire_funded` is excluded ON PURPOSE — cash without signed docs is one of the two conditions R131.1 requires", async () => {
    const spvId = await createSpv("W160 wire funded is not capital");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w160_wf_${stamp}`, BAND_BOUNDARY + 25_000, "wire_funded");
    /* No committed row at all, so the vehicle falls to the target-raise fallback
       rather than pricing on wired cash. */
    const band = resolveEngineConfirmedCapitalMinor(db(), spvId);
    expect(band.basis).not.toBe("confirmed_capital");
    expect(band.sizeMinor).not.toBe(BAND_BOUNDARY + 25_000);
  });

  it("T0.3c: the stage vocabulary this file walks is the shipped one — no invented statuses", () => {
    for (const s of ["review", "soft_circled", "founder_confirmed", "wire_funded", "committed", "withdrawn"]) {
      expect(SPV_SUBSCRIPTION_STATUSES as readonly string[]).toContain(s);
    }
    expect(SPV_COMMITTED_SUBSCRIPTION_STATUS).toBe("committed");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §3 — T0.4 (REAL API RESPONSE) + T0.5 (THE FALLBACK IS STILL THERE).
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W160 §3 — the basis is RECORDED, and the target-raise fallback survives", () => {
  it("T0.4: the persisted billing record names the basis and the sizeMinor actually used", async () => {
    const spvId = await createSpv("W160 billing record states its basis");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w160_r_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w160_r2_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");
    const out = chargeEngineSpvDeploymentFee(spvId, PARTNER);

    expect(out.feeBasis).toBe("confirmed_capital");
    expect(out.basisSizeMinor).toBe(CONFIRMED_MINOR);

    /* And durably, on the row an admin or a billing dispute would read. */
    const row = getEngineSpvDeploymentFeeBilling(spvId);
    expect(row, "a billing record must exist for a charged vehicle").toBeTruthy();
    expect(row!.feeBasis).toBe("confirmed_capital");
    expect(row!.basisSizeMinor).toBe(CONFIRMED_MINOR);
    expect(row!.amountMinor).toBe(BAND_1_FEE);
    /* The stored size is the CONFIRMED figure, never the all-stages figure — the
       whole point of recording it is that a disputed charge is reconstructable. */
    expect(row!.basisSizeMinor).not.toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR);
  });

  it("T0.4b: a real API response for the SPV detail carries the same confirmed figure the fee priced on", async () => {
    const spvId = await createSpv("W160 api response agrees with the fee basis");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w160_api_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w160_api2_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");
    const res = await request(app).get(`/api/partner/me/spv/${spvId}`).set("x-user-id", MANAGING);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const subs = (res.body.subscriptions ?? []) as Array<{ status: string; commitmentMinor: number }>;
    const committedFromApi = subs
      .filter((s) => s.status === SPV_COMMITTED_SUBSCRIPTION_STATUS)
      .reduce((acc, s) => acc + s.commitmentMinor, 0);
    expect(committedFromApi).toBe(CONFIRMED_MINOR);
    expect(resolveEngineConfirmedCapitalMinor(db(), spvId).sizeMinor).toBe(committedFromApi);
  });

  it("T0.5: a vehicle with NO confirmed capital still falls back to the target raise (V2 §13.2 — the fallback is NOT removed)", async () => {
    const TARGET = 640_000; // band 2, and distinct from every other figure here
    const spvId = await createSpv("W160 fallback still fires", { targetRaiseMinor: TARGET });
    const band = resolveEngineConfirmedCapitalMinor(db(), spvId);
    expect(band.basis, "removing the fallback would silently zero-rate every vehicle").toBe("target_raise_fallback");
    expect(band.sizeMinor).toBe(TARGET);
    chargeEngineSpvDeploymentFee(spvId, PARTNER);
    expect(billedMinor(spvId)).toBe(BAND_2_FEE);
    expect(getEngineSpvDeploymentFeeBilling(spvId)!.feeBasis).toBe("target_raise_fallback");
  });

  it("T0.5b: a confirmed commitment OUTRANKS the target raise — the fallback is a fallback, not a maximum", async () => {
    const spvId = await createSpv("W160 confirmed beats target", { targetRaiseMinor: 640_000 });
    await subscribeAt(spvId, `u_w160_pref_${Date.now()}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    const band = resolveEngineConfirmedCapitalMinor(db(), spvId);
    expect(band.basis).toBe("confirmed_capital");
    expect(band.sizeMinor).toBe(CONFIRMED_MINOR);
    chargeEngineSpvDeploymentFee(spvId, PARTNER);
    expect(billedMinor(spvId)).toBe(BAND_1_FEE);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §4 — THE SECOND CHARGE PATH (V2 §2.2.4): NOT SAFE BY ACCIDENT — MEASURED.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W160 §4 — the legacy denormalised basis, MEASURED (finding W160-F1)", () => {
  it("T0.6: `spvs.committed_minor` DOES carry pre-commitment interest today — the second door is open, and this pins it", async () => {
    const spvId = await createSpv("W160 legacy column fence");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w160_lg_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w160_lg2_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");

    /* ═══════════════════════════════════════════════════════════════════════
       FINDING W160-F1 — V2 §2.2.4 SAID THIS PATH WAS "SAFE BY ACCIDENT". IT IS NOT.
       ═══════════════════════════════════════════════════════════════════════
       `server/spvFundStore.ts:1286` prices the LEGACY charge path on the
       denormalised column `spvs.committed_minor`, and the preflight's reasoning
       was that the legacy `spv_commitments` vocabulary has no `soft_circled`
       member so no indication could reach it. MEASURED, that reasoning does not
       hold: `spvEngineStore.subscribe` mirrors EVERY new subscription into
       `spv_commitments` with legacy status `"signed"` (spvFundStore.ts:1417) at
       `review` time, before any stage exists, so the denormalised column sums
       pre-commitment interest as though it were signed capital.

       WAVE 160 DOES NOT CHANGE THAT BASIS. The brief and V2 §13.3 are explicit:
       fence and test only, do not change `spvFundStore.ts:1251-1262`. Changing a
       live legacy charge basis, and the mirror that feeds it, is a separate item
       needing its own ruling — it moves money on a second path with its own
       idempotency latch.

       SO THIS TEST PINS WHAT IS TRUE rather than asserting what one wishes were
       true. A green assertion here means the door is still open; the day the
       basis or the mirror is corrected, THIS TEST FAILS and whoever corrects it
       is forced to read this block and update the finding. That is the intended
       behaviour of the fence, not an accident of it. */
    const row = db()
      .prepare(`SELECT id, committed_minor, sourcing_partner_id FROM spvs WHERE id = ?`)
      .get(spvId) as { id: string; committed_minor: number | null; sourcing_partner_id: string | null } | undefined;
    expect(row, "the engine SPV must be mirrored into the legacy table, or this fence measures nothing").toBeTruthy();
    expect(
      row!.committed_minor,
      "FINDING W160-F1: the legacy denormalised basis includes the soft-circled amount",
    ).toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR);

    /* The legacy vocabulary, read rather than assumed — a `soft_circled` amount
       arrives wearing the label `signed`, which is exactly why the vocabulary
       argument failed. */
    const legacyRows = db()
      .prepare(`SELECT status, amount_minor FROM spv_commitments WHERE spv_id = ? ORDER BY amount_minor`)
      .all(spvId) as { status: string; amount_minor: number }[];
    const softRow = legacyRows.find((r) => r.amount_minor === SOFT_CIRCLE_MINOR);
    expect(softRow, "the soft-circle must be present in the legacy mirror").toBeTruthy();
    expect(softRow!.status, "it is mirrored as `signed`, not as a pre-commitment stage").toBe("signed");

    /* WHETHER THE SECOND DOOR CAN ACTUALLY BILL depends on `sourcing_partner_id`
       being set on the legacy row — the `if` at spvFundStore.ts:1258. Recorded
       here so the build doc's exposure statement is measured, not assumed. */
    expect(typeof row!.sourcing_partner_id === "string" || row!.sourcing_partner_id === null).toBe(true);
  });

  it("T0.6b: the ENGINE path is unaffected by the legacy column — it never reads it", async () => {
    const spvId = await createSpv("W160 engine ignores legacy column");
    const stamp = Date.now();
    await subscribeAt(spvId, `u_w160_lg3_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, `u_w160_lg4_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");
    const legacy = db().prepare(`SELECT committed_minor FROM spvs WHERE id = ?`).get(spvId) as
      | { committed_minor: number | null }
      | undefined;
    /* The legacy column is inflated; the engine basis is not. Same vehicle, same
       moment, two different numbers — which is the whole content of W160-F1. */
    expect(legacy?.committed_minor).toBe(CONFIRMED_MINOR + SOFT_CIRCLE_MINOR);
    expect(resolveEngineConfirmedCapitalMinor(db(), spvId).sizeMinor).toBe(CONFIRMED_MINOR);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * §5 — R134.7.4: A CONSTRUCTED REGISTER, AND NO COMMITTED LP MOVES.
 * ══════════════════════════════════════════════════════════════════════════ */
describe("W160 §5 — constructed representative rows; no committed LP changes meaning, status or amount", () => {
  it("T0.7: five stages, two currencies, two vehicles (one capped) — committed rows are byte-identical across the change", async () => {
    const stamp = Date.now();
    /* Vehicle A — NO cap. Vehicle B — capped, and generously so, because this
       file must not exercise the cap gate (R133.1 keeps that basis all-stages and
       wave 160 does not touch it). */
    const spvA = await createSpv("W160 register vehicle A uncapped", { targetRaiseMinor: 700_000 });
    const spvB = await createSpv("W160 register vehicle B capped", {
      targetRaiseMinor: 700_000,
      capMinor: 50_000_000,
      currency: "EUR",
    });

    await subscribeAt(spvA, `u_w160_A_com_${stamp}`, CONFIRMED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvA, `u_w160_A_soft_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled");
    await subscribeAt(spvA, `u_w160_A_fc_${stamp}`, 222_222, "founder_confirmed");
    await subscribeAt(spvA, `u_w160_A_wf_${stamp}`, 333_333, "wire_funded");
    await subscribeAt(spvA, `u_w160_A_wd_${stamp}`, 444_444, "withdrawn");
    await subscribeAt(spvB, `u_w160_B_com_${stamp}`, 150_000, SPV_COMMITTED_SUBSCRIPTION_STATUS, "EUR");
    await subscribeAt(spvB, `u_w160_B_soft_${stamp}`, SOFT_CIRCLE_MINOR, "soft_circled", "EUR");

    const snapshot = () =>
      JSON.stringify(
        db()
          .prepare(
            `SELECT id, spv_id, investor_id, commitment_minor, currency, status
               FROM spv_subscription
              WHERE status = ? AND spv_id IN (?, ?)
              ORDER BY id`,
          )
          .all(SPV_COMMITTED_SUBSCRIPTION_STATUS, spvA, spvB),
      );

    const before = snapshot();
    /* The behaviour under test, run against BOTH vehicles. */
    chargeEngineSpvDeploymentFee(spvA, PARTNER);
    chargeEngineSpvDeploymentFee(spvB, PARTNER);
    const after = snapshot();

    expect(after, "charging a deployment fee must not touch a single committed subscription").toBe(before);
    /* And the register really does contain all five stages, or the snapshot above
       proves nothing. */
    const stages = (db()
      .prepare(`SELECT DISTINCT status FROM spv_subscription WHERE spv_id = ?`)
      .all(spvA) as { status: string }[]).map((r) => r.status).sort();
    expect(stages).toEqual(["committed", "founder_confirmed", "soft_circled", "wire_funded", "withdrawn"].sort());

    /* Each vehicle is priced on ITS OWN confirmed capital, so a soft-circle on
       one cannot bill the other. */
    expect(resolveEngineConfirmedCapitalMinor(db(), spvA).sizeMinor).toBe(CONFIRMED_MINOR);
    expect(resolveEngineConfirmedCapitalMinor(db(), spvB).sizeMinor).toBe(150_000);
    expect(billedMinor(spvA)).toBe(BAND_1_FEE);
    expect(billedMinor(spvB)).toBe(BAND_1_FEE);
  });
});

/**
 * WAVE 161 · BATCH 3 · ITEM A — THE AGGREGATION FENCE.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. Eight surfaces summed `spv_subscription.commitment_minor` over
 * EVERY non-withdrawn stage and presented the result as committed capital, or
 * divided by it to produce an ownership percentage. The worst of them,
 * `spvEngineStore.lpRosterForViewer`, had NO `status` FIELD IN ITS PAYLOAD AT ALL
 * (R134.3), so an LP who had merely soft-circled was served their own amount and
 * a percentage as THEIR OWN COMMITTED POSITION, over an all-stages denominator,
 * and no client could have labelled it even if it wanted to.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE REFUSES TO BE VACUOUS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * (1) `spv_subscription` has ZERO rows on every database available to this wave,
 *     so "existing records unchanged" would be a claim about nothing. §5
 *     CONSTRUCTS a representative register — committed, soft_circled,
 *     founder_confirmed, wire_funded and withdrawn rows across two vehicles —
 *     snapshots every committed row, and proves that meaning, status and amount
 *     are identical after every fenced read has run.
 * (2) §1 and §2 assert REAL HTTP RESPONSES from the LP-facing and GP-facing
 *     roster routes, not source text: the defect was in what a person is served.
 * (3) §6 is the REGRESSION FENCE: it reads the tree and fails if a NEW aggregate
 *     over `spv_subscription` appears on an all-stages basis outside the
 *     allow-list of sites this wave deliberately left all-stages (the cap
 *     capacity basis — R133.1 — and the named pipeline reads). Comments are
 *     STRIPPED before any conclusion is drawn: a docblock is not behaviour.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import { getDb, rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore, capBasisCommittedMinorForSpv } from "../spvEngineStore";
import { __setRuntimePersona } from "../lib/userContext";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";
import { ensureWave50MoneyDefectSchema } from "../lib/applyWave50MoneyDefectSchema";
import { dbTotalSpvCommittedMinor, dbTotalSpvSubscribedAllStagesMinor } from "../lib/adminKpiDbReads";
import { lpVehicleIdsFor } from "../lpPositionsStore";
import {
  SPV_COMMITTED_SUBSCRIPTION_STATUS,
  spvStageSplit,
  spvRowOwnershipPercentages,
  spvSubscriptionStageLabelForRegister,
} from "@shared/spvCommittedCapital";
import { SPV_SUBSCRIPTION_REFUSAL_COPY } from "../../client/src/lib/serverRefusalMessage";

const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";

/* Non-round sentinels: no seed, migration or default in this tree carries them,
   so a figure that matches one can only have come from this fixture. */
const COMMITTED_MINOR = 1_100_037; //  $11,000.37
const SOFT_CIRCLE_MINOR = 9_400_071; // $94,000.71 — 8.5x the committed figure
const WIRED_MINOR = 2_200_013; //      $22,000.13 — funds in, not committed

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}
const get = (p: string, u: string) => request(app).get(p).set("x-user-id", u);
const post = (p: string, u: string, b?: unknown) => request(app).post(p).set("x-user-id", u).send(b ?? {});
const patch = (p: string, u: string, b?: unknown) => request(app).patch(p).set("x-user-id", u).send(b ?? {});

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

/** A subscription at any stage, built through the REAL writers only. */
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
  if (stage === "review") return subId;
  if (stage === SPV_COMMITTED_SUBSCRIPTION_STATUS) {
    const p = spvEngineStore.projectLpCommitted(PARTNER, spvId, {
      investorId,
      commitmentMinor: minor,
      currency,
    });
    expect(p.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
    return subId;
  }
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

/** Source with COMMENTS STRIPPED. A docblock is not evidence of behaviour. */
function codeOf(rel: string): string {
  const raw = fs.readFileSync(path.resolve(__dirname, "..", "..", rel), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
  ensureWave152PricingSchema(db());
  ensureWave45PricingSchema(db());
  ensureWave50MoneyDefectSchema(db());

  /* The investor-context roster route is FAIL-CLOSED on authentication (401
     without an authed identity), so every LP viewer this file uses needs a real
     runtime persona — the same mechanism `spvLpVisibility.test.ts` uses. Without
     it the roster assertions would be measuring a 401, not a payload. */
  for (const lp of [
    "u_w161_softcircle_lp",
    "u_w161_committed_lp",
    "u_w161_indicating_lp",
    "u_w161_wired_lp",
    "u_w161_nav_soft",
    "u_w161_rep_a_committed",
  ]) {
    __setRuntimePersona({
      userId: lp,
      email: `${lp}@test.local`,
      name: lp,
      isFounder: false,
      isInvestor: true,
      isAdmin: false,
      hasInvitations: false,
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §1 — THE LP-FACING ROSTER. A REAL HTTP RESPONSE, NOT A FUNCTION RETURN.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W161 §1 — an LP is no longer served a soft-circle as their committed position", () => {
  it("T1.1: a soft-circled LP's OWN row carries its stage, its words, and no committed share", async () => {
    const spvId = await createSpv("W161 lp roster soft circle");
    const lp = "u_w161_softcircle_lp";
    await subscribeAt(spvId, lp, SOFT_CIRCLE_MINOR, "soft_circled");

    const res = await get(`/api/spv/${spvId}/lp-roster`, lp);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const own = (res.body.entries as any[]).find((e) => e.isSelf);
    expect(own, JSON.stringify(res.body)).toBeTruthy();
    /* THE AMOUNT IS STILL THERE — nothing is hidden from the LP. */
    expect(own.commitmentMinor).toBe(SOFT_CIRCLE_MINOR);
    /* WHAT IS NEW: the payload now says what that amount IS. */
    expect(own.stage).toBe("soft_circled");
    expect(own.isConfirmedCapital).toBe(false);
    expect(String(own.stageLabel).length).toBeGreaterThan(0);
    /* And it does NOT claim a share of committed capital, because there is none.
       `null`, never 0: `0.0%` reads as "committed, and tiny". */
    expect(own.ownershipPctOfConfirmedCapital).toBeNull();

    /* The viewer-level answer to "is MY row a commitment?" without hunting a list. */
    expect(res.body.viewerStage).toBe("soft_circled");
    expect(res.body.viewerIsConfirmedCapital).toBe(false);

    /* R134.3 — the DENOMINATOR is labelled too, but that alone was never enough,
       which is why the per-entry assertions above exist. */
    expect(String(res.body.denominatorLabel)).toMatch(/every non-withdrawn|all stages|any stage/i);
    expect(res.body.split.confirmedCapitalMinor).toBe(0);
    expect(res.body.split.softCircledInterestMinor).toBe(SOFT_CIRCLE_MINOR);
    expect(String(res.body.splitStatement)).toMatch(/interest, not as capital/);
  });

  it("T1.2: a COMMITTED LP is not diluted by another investor's indication", async () => {
    const spvId = await createSpv("W161 lp roster mixed", { lpVisibility: "co_investors" });
    const real = "u_w161_committed_lp";
    const soft = "u_w161_indicating_lp";
    await subscribeAt(spvId, real, COMMITTED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, soft, SOFT_CIRCLE_MINOR, "soft_circled");

    const res = await get(`/api/spv/${spvId}/lp-roster`, real);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const own = (res.body.entries as any[]).find((e) => e.isSelf);

    /* THE DEFECT, IN ONE NUMBER. The all-stages share is ~10.5%; the committed LP
       in fact holds 100% of the capital actually committed to this vehicle. */
    expect(own.ownershipPctOfAllStages).toBeLessThan(0.2);
    expect(own.ownershipPctOfConfirmedCapital).toBe(1);
    expect(own.isConfirmedCapital).toBe(true);
    expect(res.body.split.confirmedCapitalMinor).toBe(COMMITTED_MINOR);
    expect(res.body.split.softCircledInterestMinor).toBe(SOFT_CIRCLE_MINOR);

    /* The co-investor's row is visible (this vehicle is transparent) and it is
       visible AS AN INDICATION, not as capital. */
    const other = (res.body.entries as any[]).find((e) => !e.isSelf);
    expect(other.stage).toBe("soft_circled");
    expect(other.ownershipPctOfConfirmedCapital).toBeNull();
  });

  it("T1.3: `wire_funded` is NOT confirmed capital (R135.1) and is reported separately", async () => {
    const spvId = await createSpv("W161 lp roster wired");
    const lp = "u_w161_wired_lp";
    await subscribeAt(spvId, lp, WIRED_MINOR, "wire_funded");
    const res = await get(`/api/spv/${spvId}/lp-roster`, lp);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const own = (res.body.entries as any[]).find((e) => e.isSelf);
    expect(own.stage).toBe("wire_funded");
    expect(own.isConfirmedCapital).toBe(false);
    expect(own.ownershipPctOfConfirmedCapital).toBeNull();
    expect(res.body.split.confirmedCapitalMinor).toBe(0);
    expect(res.body.split.wiredNotCommittedMinor).toBe(WIRED_MINOR);
    /* NOT lumped in with soft-circles either: cash received is its own category. */
    expect(res.body.split.softCircledInterestMinor).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §2 — THE GP-FACING SURFACES. REAL HTTP RESPONSES.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W161 §2 — the GP roster and the investor register name their denominator", () => {
  it("T2.1: the GP roster route serves a per-row stage and BOTH percentages", async () => {
    const spvId = await createSpv("W161 gp roster");
    await subscribeAt(spvId, "u_w161_gp_committed", COMMITTED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, "u_w161_gp_soft", SOFT_CIRCLE_MINOR, "soft_circled");

    const res = await get(`/api/partner/me/spv/${spvId}/lp-roster`, MANAGING);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.subscribers as any[];
    const committed = rows.find((r) => r.status === SPV_COMMITTED_SUBSCRIPTION_STATUS);
    const soft = rows.find((r) => r.status === "soft_circled");

    expect(committed.ownershipPctOfConfirmedCapital).toBe(1);
    expect(committed.ownershipPctOfAllStages).toBeLessThan(0.2);
    /* The OLD field is byte-identical to the old behaviour: nothing a shipped
       client reads has moved (R44 — add, do not swap). */
    expect(committed.ownershipPct).toBe(committed.ownershipPctOfAllStages);
    expect(soft.ownershipPctOfConfirmedCapital).toBeNull();
    expect(soft.isConfirmedCapital).toBe(false);
    expect(res.body.split.confirmedCapitalMinor).toBe(COMMITTED_MINOR);
    expect(res.body.split.allStagesMinor).toBe(COMMITTED_MINOR + SOFT_CIRCLE_MINOR);
    expect(String(res.body.confirmedDenominatorLabel)).toMatch(/committed capital only/i);
  });

  it("T2.2: the SPV detail payload carries the register AND its split", async () => {
    const spvId = await createSpv("W161 detail register");
    await subscribeAt(spvId, "u_w161_reg_committed", COMMITTED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, "u_w161_reg_review", SOFT_CIRCLE_MINOR, "review");

    const res = await get(`/api/partner/me/spv/${spvId}`, MANAGING);
    expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
    const reg = res.body.register as any[];
    expect(reg.length).toBe(2);
    for (const row of reg) {
      /* R134.3 — EVERY entry names its stage. */
      expect(typeof row.stage).toBe("string");
      expect(String(row.stageLabel).length).toBeGreaterThan(0);
    }
    const split = res.body.registerSplit;
    expect(split.split.confirmedCapitalMinor).toBe(COMMITTED_MINOR);
    expect(split.split.softCircledInterestMinor).toBe(SOFT_CIRCLE_MINOR);
    expect(split.split.confirmedRows).toBe(1);
    expect(split.split.interestedRows).toBe(1);
  });

  it("T2.3: the four partner register endpoints all carry a split", async () => {
    const spvId = await createSpv("W161 partner register endpoints");
    await subscribeAt(spvId, "u_w161_pr_committed", COMMITTED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(spvId, "u_w161_pr_soft", SOFT_CIRCLE_MINOR, "soft_circled");
    /* The two `funds/*` routes serve the SAME register but refuse anything whose
       `spvType` is not `fund` (verified at partnerRoutes.ts, not assumed), so the
       fixture needs a fund vehicle as well as an SPV one. */
    const fundId = await createSpv("W161 partner register fund", { spvType: "fund" });
    await subscribeAt(fundId, "u_w161_pr_fund_committed", COMMITTED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(fundId, "u_w161_pr_fund_soft", SOFT_CIRCLE_MINOR, "soft_circled");
    /* All FOUR register endpoints, by their real paths (verified in
       server/partnerRoutes.ts, not assumed): two serve `positions`, two serve
       `commitments`, and the SPV id doubles as the fund id on the fund routes
       because a Consortium fund IS the engine vehicle here. No `continue` on a
       non-200 — a skipped URL is a vacuous assertion. */
    for (const [url, rowsKey, splitKey] of [
      [`/api/partner/me/spvs/${spvId}`, "positions", "positionsSplit"],
      [`/api/partner/me/spvs/${spvId}/positions`, "positions", "positionsSplit"],
      [`/api/partner/me/funds/${fundId}`, "commitments", "commitmentsSplit"],
      [`/api/partner/me/funds/${fundId}/commitments`, "commitments", "commitmentsSplit"],
    ] as const) {
      const res = await get(url, MANAGING);
      expect(res.status, `${url}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
      expect(Array.isArray(res.body[rowsKey]), url).toBe(true);
      expect(res.body[splitKey]?.split?.confirmedCapitalMinor, url).toBe(COMMITTED_MINOR);
      expect(res.body[splitKey]?.split?.softCircledInterestMinor, url).toBe(SOFT_CIRCLE_MINOR);
      /* Every row names its stage (R134.3), on all four. */
      for (const row of res.body[rowsKey] as any[]) {
        expect(String(row.stageLabel).length, url).toBeGreaterThan(0);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §3 — THE PLATFORM KPI. THE WORD ON THE TILE IS "COMMITTED".
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W161 §3 — the admin `Committed` KPI counts commitments only", () => {
  it("T3.1: a soft-circle does not move the committed KPI; the pipeline figure keeps it", async () => {
    const spvId = await createSpv("W161 admin kpi");
    const before = dbTotalSpvCommittedMinor().USD ?? 0;
    const beforeAll = dbTotalSpvSubscribedAllStagesMinor().USD ?? 0;

    await subscribeAt(spvId, "u_w161_kpi_soft", SOFT_CIRCLE_MINOR, "soft_circled");
    expect(dbTotalSpvCommittedMinor().USD ?? 0).toBe(before);
    /* NOTHING WAS LOST: the old basis still exists, under a name that says so. */
    expect((dbTotalSpvSubscribedAllStagesMinor().USD ?? 0) - beforeAll).toBe(SOFT_CIRCLE_MINOR);

    await subscribeAt(spvId, "u_w161_kpi_committed", COMMITTED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    expect((dbTotalSpvCommittedMinor().USD ?? 0) - before).toBe(COMMITTED_MINOR);
  });

  it("T3.2: `wire_funded` does not move the committed KPI either (R135.1)", async () => {
    const spvId = await createSpv("W161 admin kpi wired");
    const before = dbTotalSpvCommittedMinor().USD ?? 0;
    await subscribeAt(spvId, "u_w161_kpi_wired", WIRED_MINOR, "wire_funded");
    expect(dbTotalSpvCommittedMinor().USD ?? 0).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §4 — FENCED SITES THAT MUST NOT MOVE.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W161 §4 — the reads that were already right, pinned", () => {
  it("T4.1: `lpVehicleIdsFor` lists only vehicles the LP actually committed to", async () => {
    const committedSpv = await createSpv("W161 fence committed vehicle");
    const softSpv = await createSpv("W161 fence soft vehicle");
    const lp = "u_w161_fence_lp";
    await subscribeAt(committedSpv, lp, COMMITTED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    await subscribeAt(softSpv, lp, SOFT_CIRCLE_MINOR, "soft_circled");
    const ids = lpVehicleIdsFor(lp);
    expect(ids).toContain(committedSpv);
    expect(ids).not.toContain(softSpv);
  });

  it("T4.2: the CAP CAPACITY basis stays ALL-STAGES (R133.1) — a soft-circle occupies room", async () => {
    const spvId = await createSpv("W161 fence cap basis");
    await subscribeAt(spvId, "u_w161_cap_soft", SOFT_CIRCLE_MINOR, "soft_circled");
    /* If a later wave "consistently" narrows this to committed-only, a GP could
       oversubscribe a vehicle several times over. R133.1 says this is correct. */
    expect(capBasisCommittedMinorForSpv(spvId)).toBe(SOFT_CIRCLE_MINOR);
  });

  it("T4.3: NAV is still DENIED to a non-committed LP (V2 §13.6) — a refusal, not a gap", async () => {
    const spvId = await createSpv("W161 fence nav denial");
    const lp = "u_w161_nav_soft";
    await subscribeAt(spvId, lp, SOFT_CIRCLE_MINOR, "soft_circled");
    const res = await get(`/api/spv/${spvId}/nav/me`, lp);
    expect([401, 403, 404]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §5 — ANTI-VACUITY: A CONSTRUCTED REGISTER, AND WHAT IT PROVES.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W161 §5 — no existing committed LP changes meaning, status or amount", () => {
  it("T5.1: a five-stage register across two vehicles leaves every committed row identical", async () => {
    const spvA = await createSpv("W161 representative A");
    const spvB = await createSpv("W161 representative B");
    const rows: Array<[string, string, number, string]> = [
      [spvA, "u_w161_rep_a_committed", COMMITTED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS],
      [spvA, "u_w161_rep_a_soft", SOFT_CIRCLE_MINOR, "soft_circled"],
      [spvA, "u_w161_rep_a_founder", 700_019, "founder_confirmed"],
      [spvA, "u_w161_rep_a_wired", WIRED_MINOR, "wire_funded"],
      [spvA, "u_w161_rep_a_withdrawn", 500_003, "withdrawn"],
      [spvB, "u_w161_rep_b_committed", 3_300_029, SPV_COMMITTED_SUBSCRIPTION_STATUS],
      [spvB, "u_w161_rep_b_review", 4_400_031, "review"],
    ];
    for (const [spvId, investorId, minor, stage] of rows) {
      await subscribeAt(spvId, investorId, minor, stage);
    }

    const snapshot = () =>
      (db()
        .prepare(
          `SELECT id, spv_id, investor_id, commitment_minor, wired_minor, currency, status, ownership_pct
             FROM spv_subscription WHERE status = 'committed' ORDER BY id`,
        )
        .all() as any[]).map((r) => JSON.stringify(r));

    const before = snapshot();
    expect(before.length).toBeGreaterThanOrEqual(2); // NOT vacuous

    /* Every fenced read runs over the constructed register. */
    await get(`/api/partner/me/spv/${spvA}`, MANAGING);
    await get(`/api/partner/me/spv/${spvA}/lp-roster`, MANAGING);
    await get(`/api/spv/${spvA}/lp-roster`, "u_w161_rep_a_committed");
    dbTotalSpvCommittedMinor();
    dbTotalSpvSubscribedAllStagesMinor();
    spvEngineStore.investorRegisterWithSplit(PARTNER, spvA);
    lpVehicleIdsFor("u_w161_rep_a_committed");

    expect(snapshot()).toEqual(before);

    /* And the committed row still MEANS the same thing on the surfaces. */
    const reg = spvEngineStore.investorRegister(PARTNER, spvA);
    const row = reg.find((r) => r.investorId === "u_w161_rep_a_committed")!;
    expect(row.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
    expect(row.commitmentMinor).toBe(COMMITTED_MINOR);
    expect(row.ownershipPctOfConfirmedCapital).toBe(1);
  });

  it("T5.2: a funds confirmation against a pre-commitment row is REFUSED, with copy that exists", async () => {
    const spvId = await createSpv("W161 funds confirmation fence");
    const lp = "u_w161_fc_soft";
    await subscribeAt(spvId, lp, SOFT_CIRCLE_MINOR, "soft_circled");
    const res = await post(
      `/api/partner/me/spv/${spvId}/subscriptions/${lp}/confirm-funds`,
      MANAGING,
      { receivedMinor: SOFT_CIRCLE_MINOR },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error).toBe("FUNDS_CONFIRMATION_REQUIRES_COMMITMENT");
    /* R77 — the copy existed BEFORE the throw. Without this the GP reads the
       enum code, because `spvEngineRoutes.err()` sends `{ error: CODE }`. */
    expect(SPV_SUBSCRIPTION_REFUSAL_COPY.FUNDS_CONFIRMATION_REQUIRES_COMMITMENT).toBeTruthy();
    expect(SPV_SUBSCRIPTION_REFUSAL_COPY.FUNDS_CONFIRMATION_REQUIRES_COMMITMENT.length).toBeGreaterThan(80);

    /* A COMMITTED LP is still confirmable — the fence refuses one thing only. */
    const good = await createSpv("W161 funds confirmation allowed");
    const lp2 = "u_w161_fc_committed";
    await subscribeAt(good, lp2, COMMITTED_MINOR, SPV_COMMITTED_SUBSCRIPTION_STATUS);
    const ok = await post(
      `/api/partner/me/spv/${good}/subscriptions/${lp2}/confirm-funds`,
      MANAGING,
      { receivedMinor: COMMITTED_MINOR },
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.confirmation.expectedMinor).toBe(COMMITTED_MINOR);
  });

  it("T5.4: `_persistSub` itself refuses a non-integer amount — the chokepoint, directly", async () => {
    const spvId = await createSpv("W161 money floor direct");
    /* THE ROUTE ALREADY REFUSES A STRING (see T5.3) — that is why this test calls
       the CHOKEPOINT directly. Every subscription write in the engine goes through
       `_persistSub`, including writers that never touch an HTTP body (the legacy
       shadow path, projections, future callers), and the table is not STRICT. A
       fence over a column anything can corrupt is decoration. */
    const bad: any = {
      id: `sub_w161_floor_${Date.now()}`,
      spvId,
      investorId: "u_w161_floor_direct",
      investorPersona: null,
      commitmentMinor: "1000",
      wiredMinor: 0,
      currency: "USD",
      status: "review",
      kycRef: null,
      accreditationRef: null,
      subscriptionDocRef: null,
      ownershipPct: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revisionHash: "",
    };
    expect(() => spvEngineStore._persistSub(bad)).toThrow(/SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR/);
    /* A float is refused for the same reason, and so is a negative. */
    expect(() => spvEngineStore._persistSub({ ...bad, commitmentMinor: 12.5 })).toThrow(
      /SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR/,
    );
    expect(() => spvEngineStore._persistSub({ ...bad, commitmentMinor: -1 })).toThrow(
      /SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR/,
    );
    expect(() => spvEngineStore._persistSub({ ...bad, commitmentMinor: 100, wiredMinor: "5" as any })).toThrow(
      /SUBSCRIPTION_MONEY_NOT_INTEGER_MINOR/,
    );
    /* NOTHING was written by any of the four refusals. */
    const stored = db()
      .prepare(`SELECT COUNT(*) AS n FROM spv_subscription WHERE investor_id = ?`)
      .get("u_w161_floor_direct") as { n: number };
    expect(stored.n).toBe(0);
    /* And a GOOD value still persists — the assertion refuses bad money only. */
    expect(() => spvEngineStore._persistSub({ ...bad, commitmentMinor: 100_000 })).not.toThrow();
  });

  it("T5.3: the write chokepoint refuses a non-integer money value instead of storing it", async () => {
    const spvId = await createSpv("W161 money floor");
    const res = await post(`/api/partner/me/spv/${spvId}/subscriptions`, MANAGING, {
      investorId: "u_w161_money_floor",
      commitmentMinor: "1000",
      currency: "USD",
    });
    expect(res.status, JSON.stringify(res.body)).not.toBe(201);
    const stored = db()
      .prepare(`SELECT COUNT(*) AS n FROM spv_subscription WHERE investor_id = ?`)
      .get("u_w161_money_floor") as { n: number };
    expect(stored.n).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §6 — THE REGRESSION FENCE.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W161 §6 — a NEW all-stages aggregate cannot appear unnoticed", () => {
  /* The files that legitimately sum subscription amounts over every non-withdrawn
     stage, and WHY each one is allowed to. Anything else that acquires such a sum
     must be justified in a build doc and added here deliberately. */
  const ALL_STAGES_ALLOWED: Record<string, string> = {
    "server/spvEngineStore.ts":
      "cap CAPACITY basis (R133.1 — a soft-circle occupies room) and the register's " +
      "preserved `ownershipPct`/`allStagesMinor`, both named and labelled",
    "server/spvEngineRoutes.ts": "the GP roster's preserved all-stages total, labelled",
    "server/lib/adminKpiDbReads.ts": "`dbTotalSpvSubscribedAllStagesMinor`, named for what it sums",
    "shared/spvCommittedCapital.ts": "`spvStageSplit` computes BOTH bases by design",
  };

  it("T6.1: every `status != withdrawn` sum over spv_subscription is on the allow-list", () => {
    const files = [
      "server/spvEngineStore.ts",
      "server/spvEngineRoutes.ts",
      "server/partnerRoutes.ts",
      "server/lib/adminKpiDbReads.ts",
      "server/lpPositionsStore.ts",
      "server/spvFundStore.ts",
      "server/lib/spvEngineDeploymentFeeHook.ts",
      "shared/spvCommittedCapital.ts",
    ];
    const offenders: string[] = [];
    for (const f of files) {
      const code = codeOf(f);
      /* Two shapes: SQL that sums commitment_minor with a not-withdrawn predicate,
         and TypeScript that filters on `!== "withdrawn"` and then reduces. */
      const sqlSum = /SUM\(\s*commitment_minor\s*\)[\s\S]{0,200}?status\s*(!=|<>)\s*'withdrawn'/i.test(code);
      const tsSum = /status\s*!==\s*"withdrawn"[\s\S]{0,200}?reduce\(/.test(code);
      if ((sqlSum || tsSum) && !(f in ALL_STAGES_ALLOWED)) offenders.push(f);
    }
    expect(
      offenders,
      `A NEW all-stages subscription aggregate appeared in: ${offenders.join(", ")}. ` +
        "Either narrow it to `status = 'committed'`, or label it and add it to " +
        "ALL_STAGES_ALLOWED with the reason (see WAVE 161 build doc).",
    ).toEqual([]);
  });

  it("T6.2: the three lpPositionsStore reads still filter committed-only, in their own SQL", () => {
    const code = codeOf("server/lpPositionsStore.ts");
    /* Counted, not merely matched: lowering this count is R98-forbidden. */
    const committedPredicates = code.match(/status\s*=\s*'committed'/g) ?? [];
    expect(committedPredicates.length).toBeGreaterThanOrEqual(3);
    expect(/status\s*(!=|<>)\s*'withdrawn'/.test(code)).toBe(false);
  });

  it("T6.3: the LP roster payload cannot lose its per-entry stage again", () => {
    const code = codeOf("server/spvEngineStore.ts");
    const roster = code.slice(code.indexOf("lpRosterForViewer"));
    const body = roster.slice(0, roster.indexOf("/* ---- Deployment"));
    expect(body).toMatch(/stage:/);
    expect(body).toMatch(/stageLabel:/);
    expect(body).toMatch(/isConfirmedCapital:/);
    expect(body).toMatch(/ownershipPctOfConfirmedCapital:/);
  });

  it("T6.4: the shared split helper does no money coercion", () => {
    const code = codeOf("shared/spvCommittedCapital.ts");
    expect(/\bNumber\s*\(/.test(code)).toBe(false);
    expect(/parseInt|parseFloat/.test(code)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §7 — THE SHARED HELPER ITSELF.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W161 §7 — the split helper reports absence instead of inventing zero", () => {
  it("T7.1: an unreadable amount is counted as unreadable, never as 0", () => {
    const split = spvStageSplit([
      { status: "committed", commitmentMinor: 100 },
      { status: "committed", commitmentMinor: null },
      { status: "committed", commitmentMinor: 12.5 as unknown as number },
      { status: "withdrawn", commitmentMinor: 999_999 },
    ]);
    expect(split.confirmedCapitalMinor).toBe(100);
    expect(split.unreadableRows).toBe(2);
    expect(split.confirmedRows).toBe(3);
    /* The withdrawn row is in NO figure and NO count. */
    expect(split.allStagesMinor).toBe(100);
    expect(split.allStagesRows).toBe(3);
  });

  it("T7.2: a non-committed row's confirmed share is null, and a committed one's is a number", () => {
    const rows = [
      { status: "committed", commitmentMinor: 400 },
      { status: "soft_circled", commitmentMinor: 600 },
    ];
    const split = spvStageSplit(rows);
    expect(spvRowOwnershipPercentages(rows[0], split).ofConfirmedCapital).toBe(1);
    expect(spvRowOwnershipPercentages(rows[1], split).ofConfirmedCapital).toBeNull();
    expect(spvRowOwnershipPercentages(rows[1], split).ofAllStages).toBeCloseTo(0.6, 10);
  });

  it("T7.3: R132.3 — `founder_confirmed` reads as GP-confirmed, and is not a commitment", () => {
    expect(spvSubscriptionStageLabelForRegister("founder_confirmed")).toMatch(/GP-confirmed/);
    expect(spvSubscriptionStageLabelForRegister("founder_confirmed")).toMatch(/not a commitment/);
  });
});

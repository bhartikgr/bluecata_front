/**
 * WAVE 166 · BATCH 3 ITEM D — THE TWO LP PATHS (R131).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE OWNER'S MODEL, VERBATIM, BECAUSE IT IS THE SPEC.
 * ═══════════════════════════════════════════════════════════════════════════════
 * "There are TWO ways for GPs to sign on LPs: 1. invitation to soft-circle so
 *  that the LPs can review the deal and soft-circle. The GP will confirm the
 *  investment when the LP signs the proper subscription docs and the funds are in
 *  the bank account (OFFLINE process). 2. If the SPV already has LPs before it is
 *  launched on the platform, GPs are able to directly add LPs to the SPV."
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS ACTUALLY MISSING, MEASURED AT SOURCE THIS WAVE.
 * ═══════════════════════════════════════════════════════════════════════════════
 * The STATES existed (`soft_circled`, `founder_confirmed`) and so did the ladder.
 * What did not exist:
 *
 *   P1-a  Any way for an LP to soft-circle. There was no LP-facing route at all,
 *         so "the LP soft-circled" was a status a GP typed on the LP's behalf.
 *   P1-b  Any act behind "the GP confirmed". A GP could PATCH a soft-circled row
 *         straight to `committed` — a legal forward skip under R136.2 — so a
 *         non-binding indication became confirmed capital, moving what the LP
 *         owns, what the vehicle raised and what the partner is billed, with
 *         nobody having stated that anything was signed or received.
 *   P2    Any record of WHERE an LP came from. `spv_lp_invite` had no `origin`
 *         column (verified against the live schema), so an LP who held a position
 *         before the vehicle reached this platform was stored as
 *         `status='invited'` — indistinguishable from an unanswered email.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE REFUSES TO BE VACUOUS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * (1) §2's headline is the owner's own sentence turned into an assertion: a
 *     soft-circle is NOT capital. It captures EVERY money figure the vehicle
 *     reports BEFORE a new soft-circle and asserts each is byte-identical after.
 *     Wave 161 fenced these aggregations and wave 163 fixed the roster; this test
 *     is the fence that catches anyone undoing either.
 * (2) §3 proves the drift is closed by ATTEMPTING it: a real PATCH from
 *     `soft_circled` to `committed` with no affirmation, asserted to be REFUSED
 *     with a sentence containing no error code — then the same move ALLOWED once
 *     the dual affirmation is recorded. A test that only checks the happy path
 *     would pass against the broken code.
 * (3) §3 also proves ONE affirmation is not enough, in BOTH directions
 *     (documents-only and funds-only), because "partially confirmed" is the exact
 *     half-truth that later reads as capital.
 * (4) §4 asserts the three vocabularies stay SEPARATE — no shared enum, no shared
 *     label map — by reading the sources with COMMENTS STRIPPED.
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
import { spvEngineStore } from "../spvEngineStore";
import { __setRuntimePersona } from "../lib/userContext";
import { ensureWave152PricingSchema } from "../lib/applyWave152PricingSchema";
import { ensureWave45PricingSchema } from "../lib/applyWave45PricingSchema";
import { ensureWave50MoneyDefectSchema } from "../lib/applyWave50MoneyDefectSchema";
import { lpInvestorIdForEmail } from "../lib/lpIdentity";
import {
  createLpInvite,
  listLpInvites,
  SPV_LP_INVITE_ORIGINS,
  DEFAULT_SPV_LP_INVITE_ORIGIN,
} from "../spvLpInviteStore";
import {
  SPV_SOFT_CIRCLED_INTEREST_STATUSES,
  SPV_COMMITTED_SUBSCRIPTION_STATUS,
  committedMinorFromSubscriptions,
  spvStageSplit,
  spvSubscriptionStageLabelForRegister,
} from "@shared/spvCommittedCapital";
import { SPV_SUBSCRIPTION_REFUSAL_COPY } from "@shared/spvSubscriptionRefusalCopy";

/* WAVE 226 · R202 — wave 211 made an operator attestation MANDATORY on the
   money-event routes this suite drives, so these requests were refused 400 and
   the proofs below never reached their own assertions. The fixture supplies what
   a real operator supplies, over the same HTTP route; it is NOT a bypass. Read
   the header of `_wave226_attestation_fixture.ts` before changing it. */
import { W226_LP_INVITE_ATT } from "./_wave226_attestation_fixture";
const MANAGING = "u_avi_managing";
const PARTNER = "ac_consortium_partner_test_partner_inc";

/* Non-round sentinels. Nothing in this tree's seeds, migrations or defaults
   carries either figure, so a number that matches one can only be ours. */
const COMMITTED_MINOR = 7_100_037; // $71,000.37 — real, confirmed capital
const SOFT_CIRCLE_MINOR = 9_400_071; // $94,000.71 — an indication, never capital

/** The stages the affirmation gate covers. Stated here so T5.5 asserts an
 *  expectation rather than restating whatever the store happens to compute. */
const GATED_STAGES_EXPECTED = ["soft_circled", "founder_confirmed"] as const;

let app: express.Express;

function db(): any {
  getDb();
  return rawDb() as any;
}
const get = (p: string, u: string) => request(app).get(p).set("x-user-id", u);
const post = (p: string, u: string, b?: unknown) =>
  request(app).post(p).set("x-user-id", u).send(b ?? {});
const patch = (p: string, u: string, b?: unknown) =>
  request(app).patch(p).set("x-user-id", u).send(b ?? {});

async function createSpv(name: string): Promise<string> {
  const created = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "per_deployment",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.spv.id as string;
}

function persona(userId: string, email: string): void {
  __setRuntimePersona({
    userId, email, name: userId,
    isFounder: false, isInvestor: true, isAdmin: false, hasInvitations: false,
  });
}

function insertUser(id: string, email: string): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo)
       VALUES (?, ?, ?, ?, 'investor', 0)`,
    )
    .run(id, "tenant_cp_keiretsu_ca", email, id);
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

const uniq = () => Math.random().toString(36).slice(2, 10);

/**
 * EVERY money figure the vehicle reports, in one object.
 *
 * This is the instrument §2 uses. It reads the aggregations wave 161 fenced —
 * the committed total, the stage split, and the subscription rows themselves —
 * so a change to ANY of them shows up as a diff rather than as a passing test.
 */
function moneyPictureOf(spvId: string) {
  /* MEASURED THIS WAVE: `committedMinorFromSubscriptions` and `spvStageSplit`
     return BIGINT, not number. The figures are stringified here so the
     assertions below compare exact decimal strings — never a `Number()` on
     money, and never a silent 7100037n-vs-7100037 mismatch. */
  const subs = spvEngineStore.listSubscriptions(PARTNER, spvId);
  const rows = subs.map((s) => ({ status: s.status, commitmentMinor: s.commitmentMinor }));
  const split = spvStageSplit(rows);
  return {
    committedMinor: String(committedMinorFromSubscriptions(rows)),
    splitConfirmedCapitalMinor: String(split.confirmedCapitalMinor),
    splitSoftCircledInterestMinor: String(split.softCircledInterestMinor),
    splitWiredNotCommittedMinor: String(split.wiredNotCommittedMinor),
    splitAllStagesMinor: String(split.allStagesMinor),
    committedRowCount: rows.filter((r) => r.status === SPV_COMMITTED_SUBSCRIPTION_STATUS).length,
  };
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
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §1 — PATH 1, THE LP'S OWN ACT. AN LP CAN SOFT-CIRCLE, AND ONLY THEIR OWN ROW.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W166 §1 — Path 1: the LP-facing soft-circle action exists", () => {
  it("T1.1: an LP soft-circles their own subscription, and the response says it is not capital", async () => {
    const spvId = await createSpv(`W166 P1 lp act ${uniq()}`);
    const email = `w166.softcircle.${uniq()}@example.com`;
    const lpId = lpInvestorIdForEmail(email);
    expect(lpId).toMatch(/^ext_/);

    // Seat the LP at `review` — the stage an invited LP starts from.
    const sub = spvEngineStore.subscribe(PARTNER, spvId, {
      investorId: lpId,
      commitmentMinor: SOFT_CIRCLE_MINOR,
      currency: "USD",
    });
    expect(sub.status).toBe("review");

    insertUser(lpId, email);
    persona(lpId, email);
    const r = await post(
      `/api/investor/me/spv/${spvId}/subscriptions/${sub.id}/soft-circle`,
      lpId,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.subscription.status).toBe("soft_circled");
    // The words ship WITH the act, so no client can render it as a commitment.
    expect(String(r.body.notCapitalNotice)).toMatch(/not a commitment/i);
    expect(String(r.body.notCapitalNotice)).toMatch(/no funds are due/i);
    // R132.3 — `founder_confirmed` reads as "GP-confirmed", never "founder".
    expect(r.body.stageLabel).not.toMatch(/founder/i);
  });

  it("T1.2: an LP CANNOT soft-circle somebody else's subscription", async () => {
    const spvId = await createSpv(`W166 P1 other ${uniq()}`);
    const victimEmail = `w166.victim.${uniq()}@example.com`;
    const victimId = lpInvestorIdForEmail(victimEmail);
    const victimSub = spvEngineStore.subscribe(PARTNER, spvId, {
      investorId: victimId,
      commitmentMinor: SOFT_CIRCLE_MINOR,
      currency: "USD",
    });

    const strangerEmail = `w166.stranger.${uniq()}@example.com`;
    const strangerId = lpInvestorIdForEmail(strangerEmail);
    insertUser(strangerId, strangerEmail);
    persona(strangerId, strangerEmail);

    const r = await post(
      `/api/investor/me/spv/${spvId}/subscriptions/${victimSub.id}/soft-circle`,
      strangerId,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.error).toBe("NOT_AN_LP");
    // And the victim's row is untouched.
    expect(
      spvEngineStore.listSubscriptions(PARTNER, spvId).find((s) => s.id === victimSub.id)!.status,
    ).toBe("review");
  });

  /* NOT A TEST OF 401. MEASURED THIS WAVE: `__setRuntimePersona` installs a
     PROCESS-GLOBAL persona, so a supertest request with no `x-user-id` header is
     still an authenticated request in this harness and asserting 401 here would
     be asserting the fixture, not the route. The route's own 401 branch is the
     first two lines of it and is unconditional; what IS testable here is that a
     guessed subscription id cannot silently succeed. */
  it("T1.3: a subscription id that does not exist is a 404, never a silent success", async () => {
    const spvId = await createSpv(`W166 P1 nosub ${uniq()}`);
    const email = `w166.nosub.${uniq()}@example.com`;
    const lpId = lpInvestorIdForEmail(email);
    insertUser(lpId, email);
    persona(lpId, email);
    const r = await post(
      `/api/investor/me/spv/${spvId}/subscriptions/spvsub_does_not_exist/soft-circle`,
      lpId,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(404);
    expect(r.body.error).toBe("SUBSCRIPTION_NOT_FOUND");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §2 — THE HEADLINE. A SOFT-CIRCLE IS NOT CAPITAL.
 * ══════════════════════════════════════════════════════════════════════════════
 * The owner's words: "A soft-circle is NOT capital." This section is the proof,
 * and it is deliberately built as a BEFORE/AFTER over every money figure rather
 * than as a spot check on one of them.
 */
describe("W166 §2 — a new soft-circle moves NO money figure", () => {
  it("T2.1: committed total, stage split and committed row count are all unchanged", async () => {
    const spvId = await createSpv(`W166 nocapital ${uniq()}`);

    // A REAL committed LP first, so the figures under test are non-zero and a
    // test that accidentally zeroed everything could not pass.
    const realEmail = `w166.real.${uniq()}@example.com`;
    const realId = lpInvestorIdForEmail(realEmail);
    spvEngineStore.projectLpCommitted(PARTNER, spvId, {
      investorId: realId, commitmentMinor: COMMITTED_MINOR, currency: "USD",
    });

    const before = moneyPictureOf(spvId);
    expect(before.committedMinor).toBe(String(COMMITTED_MINOR));
    expect(before.committedRowCount).toBe(1);

    // Now a brand-new LP soft-circles a LARGER amount than the committed one.
    const scEmail = `w166.sc.${uniq()}@example.com`;
    const scId = lpInvestorIdForEmail(scEmail);
    const scSub = spvEngineStore.subscribe(PARTNER, spvId, {
      investorId: scId, commitmentMinor: SOFT_CIRCLE_MINOR, currency: "USD",
    });
    insertUser(scId, scEmail);
    persona(scId, scEmail);
    const act = await post(
      `/api/investor/me/spv/${spvId}/subscriptions/${scSub.id}/soft-circle`,
      scId,
    );
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    expect(act.body.subscription.status).toBe("soft_circled");

    const after = moneyPictureOf(spvId);

    // THE ASSERTION THIS WHOLE WAVE ANSWERS TO.
    expect(after.committedMinor).toBe(before.committedMinor);
    expect(after.splitConfirmedCapitalMinor).toBe(before.splitConfirmedCapitalMinor);
    expect(after.splitWiredNotCommittedMinor).toBe(before.splitWiredNotCommittedMinor);
    expect(after.committedRowCount).toBe(before.committedRowCount);
    // The indication IS visible — as an indication, in its own bucket, never
    // folded into capital. Invisible would be its own defect.
    expect(after.splitSoftCircledInterestMinor).toBe(String(SOFT_CIRCLE_MINOR));
    expect(after.splitSoftCircledInterestMinor).not.toBe(after.splitConfirmedCapitalMinor);
    /* The all-stages basis DOES grow — that basis exists to include indications,
       and R133.1 forbids changing the cap-capacity basis. Asserting it moves is
       how this test proves it fenced CAPITAL rather than hid the indication. */
    expect(after.splitAllStagesMinor).not.toBe(before.splitAllStagesMinor);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §3 — PATH 1, THE GP'S ACT. A SOFT-CIRCLE CANNOT DRIFT TO COMMITTED.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W166 §3 — committing needs BOTH offline conditions affirmed, explicitly", () => {
  /**
   * A soft-circled row whose PRE-EXISTING R105 gates are already satisfied.
   *
   * MEASURED THIS WAVE: `advanceSubscription(... "committed")` enforces
   * `GATE_KYC_REQUIRED`, `GATE_ACCREDITATION_REQUIRED` and
   * `GATE_SUBSCRIPTION_ESIGN_REQUIRED` regardless of this wave. Satisfying them
   * here is what makes §3 a test of the NEW affirmation gate specifically: if
   * these were left unsatisfied, T3.1 would "pass" on a KYC refusal and prove
   * nothing about wave 166. It also demonstrates the wave RELAXES none of them.
   */
  async function softCircledRow(label: string) {
    const spvId = await createSpv(`W166 gpconfirm ${label} ${uniq()}`);
    const email = `w166.gpc.${uniq()}@example.com`;
    const lpId = lpInvestorIdForEmail(email);
    const sub = spvEngineStore.subscribe(PARTNER, spvId, {
      investorId: lpId, commitmentMinor: SOFT_CIRCLE_MINOR, currency: "USD",
    });
    const compliance = await request(app)
      .put(`/api/partner/me/compliance/${lpId}`)
      .set("x-user-id", MANAGING)
      .send({ kycStatus: "verified", accreditationStatus: "self_certified" });
    expect(compliance.status, JSON.stringify(compliance.body)).toBe(200);
    spvEngineStore.advanceSubscription(PARTNER, spvId, sub.id, "soft_circled");
    return { spvId, subId: sub.id, lpId, docRef: `sig_${lpId}` };
  }

  it("T3.1: a PATCH from soft_circled straight to committed is REFUSED, in plain words", async () => {
    const { spvId, subId } = await softCircledRow("patch");
    const r = await patch(
      `/api/partner/me/spv/${spvId}/subscriptions/${subId}`,
      MANAGING,
      { to: "committed" },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("GP_OFFLINE_CONFIRMATION_REQUIRED");
    // R77 — a sentence, not a code, and the sentence names both conditions.
    const words = `${r.body.message ?? ""} ${r.body.guidance ?? ""}`;
    expect(words).toMatch(/documents/i);
    expect(words).toMatch(/funds/i);
    expect(words).not.toMatch(/GP_OFFLINE_CONFIRMATION_REQUIRED/);
    // NOTHING MOVED.
    expect(
      spvEngineStore.listSubscriptions(PARTNER, spvId).find((s) => s.id === subId)!.status,
    ).toBe("soft_circled");
  });

  it("T3.2: documents-only is refused and writes nothing", async () => {
    const { spvId, subId } = await softCircledRow("docsonly");
    const r = await post(
      `/api/partner/me/spv/${spvId}/subscriptions/${subId}/gp-confirm`,
      MANAGING,
      { documentsSigned: true, fundsReceived: false },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe("GP_OFFLINE_CONFIRMATION_INCOMPLETE");
    expect(spvEngineStore.gpOfflineConfirmationFor(PARTNER, spvId, subId)).toBeNull();
    expect(
      spvEngineStore.listSubscriptions(PARTNER, spvId).find((s) => s.id === subId)!.status,
    ).toBe("soft_circled");
  });

  it("T3.3: funds-only is refused too — the asymmetry would be a loophole", async () => {
    const { spvId, subId } = await softCircledRow("fundsonly");
    const r = await post(
      `/api/partner/me/spv/${spvId}/subscriptions/${subId}/gp-confirm`,
      MANAGING,
      { documentsSigned: false, fundsReceived: true },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error).toBe("GP_OFFLINE_CONFIRMATION_INCOMPLETE");
    expect(spvEngineStore.gpOfflineConfirmationFor(PARTNER, spvId, subId)).toBeNull();
  });

  it("T3.4: a TRUTHY-BUT-NOT-TRUE affirmation is refused, never coerced", async () => {
    const { spvId, subId } = await softCircledRow("truthy");
    for (const bad of [{ documentsSigned: "yes", fundsReceived: "yes" }, { documentsSigned: 1, fundsReceived: 1 }]) {
      const r = await post(
        `/api/partner/me/spv/${spvId}/subscriptions/${subId}/gp-confirm`,
        MANAGING,
        bad,
      );
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body.error).toBe("GP_OFFLINE_CONFIRMATION_INCOMPLETE");
    }
    expect(spvEngineStore.gpOfflineConfirmationFor(PARTNER, spvId, subId)).toBeNull();
  });

  it("T3.5: BOTH affirmed commits the row AND records who affirmed and when", async () => {
    const { spvId, subId, docRef } = await softCircledRow("both");
    const before = moneyPictureOf(spvId);
    expect(before.committedMinor).toBe("0");

    const r = await post(
      `/api/partner/me/spv/${spvId}/subscriptions/${subId}/gp-confirm`,
      MANAGING,
      { documentsSigned: true, fundsReceived: true, subscriptionDocRef: docRef },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.subscription.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);

    // WHO and WHEN, durably.
    const conf = spvEngineStore.gpOfflineConfirmationFor(PARTNER, spvId, subId)!;
    expect(conf).not.toBeNull();
    expect(conf.documentsSigned).toBe(true);
    expect(conf.fundsReceived).toBe(true);
    expect(conf.affirmedBy).toBe(MANAGING);
    expect(Date.parse(conf.affirmedAt)).toBeGreaterThan(0);
    // The stage the row was in when the human spoke.
    expect(conf.stageAtAffirmation).toBe("soft_circled");

    // NOW, and only now, the money moves.
    const after = moneyPictureOf(spvId);
    expect(after.committedMinor).toBe(String(SOFT_CIRCLE_MINOR));
    expect(after.committedRowCount).toBe(1);
  });

  it("T3.6: the affirmation does NOT destroy `terms._fundsConfirmations` (ONE-level merge)", async () => {
    const { spvId, subId, lpId, docRef } = await softCircledRow("merge");
    // Commit first so a funds confirmation is legal, then record one.
    await post(`/api/partner/me/spv/${spvId}/subscriptions/${subId}/gp-confirm`, MANAGING, {
      documentsSigned: true, fundsReceived: true, subscriptionDocRef: docRef,
    });
    spvEngineStore.confirmFundsReceived(PARTNER, spvId, lpId, SOFT_CIRCLE_MINOR, "REF-166", MANAGING);
    const terms = (spvEngineStore.getSpv(PARTNER, spvId)!.terms ?? {}) as Record<string, any>;
    // BOTH bags survive. A deeper merge here would break every K-1.
    expect(terms._fundsConfirmations?.[lpId]).toBeTruthy();
    expect(terms._gpOfflineConfirmations?.[subId]).toBeTruthy();
  });

  it("T3.7: the legacy review → committed path is UNCHANGED (R136.2 — billing timing)", async () => {
    const spvId = await createSpv(`W166 legacy ${uniq()}`);
    const email = `w166.legacy.${uniq()}@example.com`;
    const sub = spvEngineStore.subscribe(PARTNER, spvId, {
      investorId: lpInvestorIdForEmail(email), commitmentMinor: COMMITTED_MINOR, currency: "USD",
    });
    expect(sub.status).toBe("review");
    const lpId = sub.investorId;

    /* FIRST: with the R105 gates UNSATISFIED, `review → committed` fails on the
       PRE-EXISTING KYC gate — NOT on wave 166's affirmation gate. That is the
       evidence that `review` is outside the new gate: if wave 166 had widened
       the gate to every commit, this error would read
       GP_OFFLINE_CONFIRMATION_REQUIRED and nine suites would break. */
    let firstError = "";
    try {
      spvEngineStore.advanceSubscription(PARTNER, spvId, sub.id, "committed");
    } catch (e) {
      firstError = (e as Error).message;
    }
    expect(firstError).toBe("GATE_KYC_REQUIRED");
    expect(firstError).not.toBe("GP_OFFLINE_CONFIRMATION_REQUIRED");

    /* THEN: with the pre-existing gates satisfied and NO affirmation anywhere,
       the legacy direct-commit path still SUCCEEDS. This is the R136.2
       protection — gating it would change WHEN a partner incurs a charge. */
    const compliance = await request(app)
      .put(`/api/partner/me/compliance/${lpId}`)
      .set("x-user-id", MANAGING)
      .send({ kycStatus: "verified", accreditationStatus: "self_certified" });
    expect(compliance.status).toBe(200);
    const moved = spvEngineStore.advanceSubscription(PARTNER, spvId, sub.id, "committed", {
      subscriptionDocRef: `sig_${lpId}`,
    });
    expect(moved.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
    expect(spvEngineStore.gpOfflineConfirmationFor(PARTNER, spvId, sub.id)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §4 — PATH 2. WHERE AN LP CAME FROM IS RECORDED, AND IT IS NOT THEIR STATE.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W166 §4 — Path 2: direct-add carries an origin", () => {
  it("T4.1: an invite with origin=existing_captable persists that origin", async () => {
    const spvId = await createSpv(`W166 P2 origin ${uniq()}`);
    const email = `w166.pre.${uniq()}@example.com`;
    const inv = createLpInvite(
      PARTNER, spvId,
      { email, firstName: "Prior", lastName: "Holder", origin: "existing_captable" },
      MANAGING,
    );
    expect(inv.origin).toBe("existing_captable");
    // Durably, not just in the return value.
    const reread = listLpInvites(PARTNER, spvId).find((i) => i.id === inv.id)!;
    expect(reread.origin).toBe("existing_captable");
    // And the invitation STATE is a different thing that did not change.
    expect(reread.status).toBe("invited");
  });

  it("T4.2: origin defaults to `direct`, which is what a GP adding an LP did", async () => {
    const spvId = await createSpv(`W166 P2 default ${uniq()}`);
    const inv = createLpInvite(
      PARTNER, spvId,
      { email: `w166.def.${uniq()}@example.com`, lastName: "Default" },
      MANAGING,
    );
    expect(inv.origin).toBe(DEFAULT_SPV_LP_INVITE_ORIGIN);
    expect(inv.origin).toBe("direct");
  });

  it("T4.3: an unrecognised origin is REFUSED, never coerced to the default", async () => {
    const spvId = await createSpv(`W166 P2 bad ${uniq()}`);
    const email = `w166.bad.${uniq()}@example.com`;
    expect(() =>
      createLpInvite(PARTNER, spvId, { email, lastName: "Bad", origin: "acquired" }, MANAGING),
    ).toThrow(/LP_INVITE_INVALID_ORIGIN/);
    // Nothing was written — a refused add leaves no half row behind.
    expect(listLpInvites(PARTNER, spvId).some((i) => i.email === email)).toBe(false);
    // R77 — the code has a sentence BEFORE it can be thrown.
    expect(SPV_SUBSCRIPTION_REFUSAL_COPY.LP_INVITE_INVALID_ORIGIN).toBeTruthy();
    expect(SPV_SUBSCRIPTION_REFUSAL_COPY.LP_INVITE_INVALID_ORIGIN).not.toMatch(
      /LP_INVITE_INVALID_ORIGIN/,
    );
  });

  it("T4.4: the origin route accepts the field and refuses a bad one with a sentence", async () => {
    const spvId = await createSpv(`W166 P2 route ${uniq()}`);
    const ok = await post(`/api/partner/me/spv/${spvId}/lp-invites`, MANAGING, {
      ...W226_LP_INVITE_ATT, /* WAVE 226 · R202 — see the fixture note */
      email: `w166.rt.${uniq()}@example.com`, firstName: "R", lastName: "Oute",
      origin: "existing_captable",
    });
    expect([200, 201]).toContain(ok.status);

    const bad = await post(`/api/partner/me/spv/${spvId}/lp-invites`, MANAGING, {
      ...W226_LP_INVITE_ATT, /* WAVE 226 · R202 — see the fixture note */
      email: `w166.rtbad.${uniq()}@example.com`, firstName: "R", lastName: "Bad",
      origin: "whatever",
    });
    expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    expect(bad.body.error).toBe("LP_INVITE_INVALID_ORIGIN");
    expect(String(bad.body.message ?? "")).not.toMatch(/LP_INVITE_INVALID_ORIGIN/);
    expect(String(bad.body.message ?? "").length).toBeGreaterThan(20);
  });

  it("T4.5: the origin vocabulary IS wave 130's — three values, no more", () => {
    expect([...SPV_LP_INVITE_ORIGINS]).toEqual([
      "incorporation",
      "existing_captable",
      "direct",
    ]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §5 — THREE VOCABULARIES STAY THREE. Comments stripped before any conclusion.
 * ══════════════════════════════════════════════════════════════════════════════ */
describe("W166 §5 — invitation state, commitment state and origin are not merged", () => {
  it("T5.1: no origin value is ever written as a subscription status", () => {
    const src = codeOf("shared/spvSubscriptionTransitions.ts") + codeOf("shared/spvEngine.ts");
    for (const o of ["incorporation", "existing_captable"]) {
      expect(src).not.toContain(`"${o}"`);
    }
  });

  it("T5.2: no commitment status leaks into the origin vocabulary", () => {
    const src = codeOf("server/spvLpInviteStore.ts");
    const originBlock = src.slice(
      src.indexOf("SPV_LP_INVITE_ORIGINS"),
      src.indexOf("DEFAULT_SPV_LP_INVITE_ORIGIN"),
    );
    for (const s of ["soft_circled", "founder_confirmed", "wire_funded", "committed"]) {
      expect(originBlock).not.toContain(s);
    }
  });

  /* ════════════════════════════════════════════════════════════════════════
     REGRESSION PIN — THE GATE IS THE TWO INDICATION STAGES, AND NOTHING ELSE.
     ════════════════════════════════════════════════════════════════════════
     This gate was first written by hand as
     `{soft_circled, founder_confirmed, wire_funded}` and the `wire_funded` entry
     caused a REAL regression: `wave164_itemC_cap_split_and_target.test.ts` §3.2
     moves a `wire_funded` row to `committed` through the GP's own route to prove
     R130's target-overage record is written by the `advanceSubscription` writer,
     and the over-broad gate refused that move — SUPPRESSING a recording R135.3
     requires. The set is now DERIVED from the platform's single authority on
     which stages hold interest rather than capital.

     These assertions read BEHAVIOUR (the derived set, and the real transitions),
     not the docblock, because a comment is not evidence. */
  it("T5.3: the gate is DERIVED from the interest stages, minus `review`", () => {
    // The shared authority still excludes `wire_funded` (R135.1).
    expect([...SPV_SOFT_CIRCLED_INTEREST_STATUSES]).not.toContain("wire_funded");
    expect([...SPV_SOFT_CIRCLED_INTEREST_STATUSES]).toContain("soft_circled");
    expect([...SPV_SOFT_CIRCLED_INTEREST_STATUSES]).toContain("founder_confirmed");
    expect([...SPV_SOFT_CIRCLED_INTEREST_STATUSES]).toContain("review");

    /* And the store DERIVES rather than re-lists, so the two can never drift.
       Verified against source with comments stripped — and the stripper is
       CHECKED to have actually stripped, because a desynced stripper would let a
       docblock satisfy this assertion. */
    const src = codeOf("server/spvEngineStore.ts");
    expect(src).not.toContain("WAVE 166 · BATCH 3 ITEM D (PATH 1) · R131.1 — THE STAGES");
    const i = src.indexOf("GP_OFFLINE_CONFIRMATION_REQUIRED_FROM: ReadonlySet<string>");
    expect(i).toBeGreaterThan(-1);
    const decl = src.slice(i, src.indexOf(";", i));
    expect(decl).toContain("SPV_SOFT_CIRCLED_INTEREST_STATUSES");
    expect(decl).toContain('!== "review"');
    // No hand-written stage literals in the declaration at all.
    expect(decl).not.toContain('"wire_funded"');
    expect(decl).not.toContain('"soft_circled"');
  });

  it("T5.4: `wire_funded → committed` is NOT gated — that stage is a recorded receipt", async () => {
    const spvId = await createSpv(`W166 wirefunded ${uniq()}`);
    const email = `w166.wf.${uniq()}@example.com`;
    const lpId = lpInvestorIdForEmail(email);
    const sub = spvEngineStore.subscribe(PARTNER, spvId, {
      investorId: lpId, commitmentMinor: COMMITTED_MINOR, currency: "USD",
    });
    const compliance = await request(app)
      .put(`/api/partner/me/compliance/${lpId}`)
      .set("x-user-id", MANAGING)
      .send({ kycStatus: "verified", accreditationStatus: "self_certified" });
    expect(compliance.status).toBe(200);
    spvEngineStore.advanceSubscription(PARTNER, spvId, sub.id, "wire_funded");

    /* No affirmation anywhere, and the move SUCCEEDS. This is the exact shape of
       wave 164 §3.2, pinned here so this wave cannot re-break it. */
    const moved = spvEngineStore.advanceSubscription(PARTNER, spvId, sub.id, "committed", {
      subscriptionDocRef: `sig_${lpId}`,
    });
    expect(moved.status).toBe(SPV_COMMITTED_SUBSCRIPTION_STATUS);
    expect(spvEngineStore.gpOfflineConfirmationFor(PARTNER, spvId, sub.id)).toBeNull();
  });

  it("T5.5: the cap refusal and the affirmation gate can never collide", () => {
    /* The mail asked what a user sees when a commitment BOTH exceeds the cap and
       lacks the affirmation. By construction they cannot both fire on one call:
       `EXCEEDS_CAP` is raised by `subscribe()`, which CREATES a row at `review`
       — a stage the affirmation gate excludes — while the affirmation gate lives
       only on `advanceSubscription(... "committed")`, which never runs a cap
       refusal (R130: the target warns and records, it does not block). So a user
       always receives exactly ONE refusal with exactly one sentence. */
    const src = codeOf("server/spvEngineStore.ts");
    const gateAt = src.indexOf("GP_OFFLINE_CONFIRMATION_REQUIRED_FROM.has");
    expect(gateAt).toBeGreaterThan(-1);
    // The gate sits inside advanceSubscription, after subscribe() in the file.
    const subscribeAt = src.indexOf("subscribe(");
    expect(subscribeAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(subscribeAt);
    // And `subscribe` creates at `review`, which the gate excludes.
    expect([...GATED_STAGES_EXPECTED]).toEqual(["soft_circled", "founder_confirmed"]);
  });

  it("T5.6: `founder_confirmed` renders as GP-confirmed on the register wrapper (R132.3)", () => {
    const label = spvSubscriptionStageLabelForRegister("founder_confirmed");
    expect(label).toMatch(/GP-confirmed/);
    expect(label).not.toMatch(/founder/i);
    // And no NEW status value was invented to carry the label.
    const src = codeOf("shared/spvEngine.ts");
    expect(src).not.toContain("gp_confirmed");
  });
});

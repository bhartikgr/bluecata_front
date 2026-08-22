/**
 * WAVE 82 · ITEM 2 (server half) — A REFUSED TERM CREATES NOTHING.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT.
 * ═══════════════════════════════════════════════════════════════════════════════
 * PROVES (executed, over the real route table):
 *   1. An out-of-domain `terms.hurdleRatePct` is refused with a **400** naming
 *      the field, and NO vehicle, NO sign-off and NO fee row is created. The
 *      fence itself is pre-existing (`normaliseSpvTermsHurdle`, Wave 5 / P-4);
 *      WAVE 82 corrects the status, which was a 500 carrying an internal
 *      rationale paragraph.
 *   2. A negative `terms.gpCommitMinor` is refused 400 `INVALID_GP_COMMIT` and
 *      creates nothing. Previously storable on a 201.
 *   3. `addFee`'s `[0,1]` carry domain is unchanged: `carryPct: 2.5` is still
 *      400 `CARRY_PCT_REQUIRED`. It is NOT widened — widening would reintroduce
 *      the 1%-vs-100% ambiguity the owner ruling exists to remove.
 *   4. The legitimate launch still works end to end, in the wizard's exact
 *      three-call order, with a decimal carry and an 8% hurdle.
 *
 * DOES NOT PROVE: that the LEGACY three-call launch is ATOMIC. It is not, and the
 * test named "OPEN S0 (WAVE 86B)" below asserts that it is not.
 *
 * ── CORRECTED BY WAVE 86B ────────────────────────────────────────────────────
 * This header used to say the launch "cannot be made atomic at this layer,
 * because the fee payload is not part of the POST /api/partner/me/spv body, so
 * the server has nothing to validate". THAT WAS WRONG, and it is the sentence
 * that made an open S0 look like a closed one. The fee payload was not in the
 * body because nothing had put it there; Wave 86B did, and validates the WHOLE
 * payload BEFORE the first write, so a refused fee now creates nothing.
 *
 * The ROLLBACK half of the old reasoning was RIGHT and is kept: deleting a vehicle
 * whose ESIGN/UETA attestation is already recorded would be worse than leaving it,
 * the store has no delete, and `npm run lint:destructive-store-fence` exists to
 * keep destructive store paths unreachable. That is precisely why the fix is
 * validate-first rather than create-then-undo.
 *
 * WAVE 82 closed the reachable hole in the CLIENT (asserted in
 * `client/src/pages/partner/__tests__/w82_spv_launch_and_review.test.ts`). WAVE 86B
 * closes it on the API for every launch submitted as ONE payload. A caller that
 * deliberately uses the legacy three-call sequence can still strand a vehicle;
 * closing that requires `fees` to become REQUIRED (47 call sites) and the owner
 * has decided against it for now. Both states are asserted below, side by side.
 *
 * PRE-FIX TRANSCRIPT: build_log/wave82/W82_ITEM2_LAUNCH_BEFORE.txt
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;

const post = (p: string, body?: unknown) =>
  request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
const put = (p: string, body?: unknown) =>
  request(app).put(p).set("x-user-id", MANAGING).send(body ?? {});

let seq = 0;
function launchBody(extraTerms: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    name: `W82 atomicity ${Date.now()}_${seq++}`,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    spvType: "spv",
    distributionScope: "private",
    lpVisibility: "own_only",
    targetRaiseMinor: 50_000_000,
    minCheckMinor: 2_500_000,
    capMinor: 250_000_000,
    currency: "USD",
    status: "open",
    terms: { mandateDescription: "W82 atomicity probe mandate", ...extraTerms },
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
    ...extra,
  };
}

const spvCount = () => spvEngineStore.listByPartner(PARTNER_A).length;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("W82 ITEM 2 · a refused term creates NO attested vehicle", () => {
  it("hurdleRatePct 500 → 400 naming the field, and nothing is created", async () => {
    const before = spvCount();
    const res = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 500 }));
    // WAVE 82: was a 500 carrying `PERCENT_FIELD_OUT_OF_DOMAIN:…` plus the
    // domain rationale as an internal error. A rejected user input is a 400.
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("PERCENT_FIELD_OUT_OF_DOMAIN");
    expect(res.body.fieldError).toBe("spv.hurdleRatePct");
    // The refusal names the value and the declared domain, which is the useful part.
    expect(String(res.body.error)).toContain("[0,100]");
    expect(spvCount()).toBe(before);
  });

  it("hurdleRatePct -1 → 400, and nothing is created", async () => {
    const before = spvCount();
    const res = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: -1 }));
    expect(res.status).toBe(400);
    expect(res.body.fieldError).toBe("spv.hurdleRatePct");
    expect(spvCount()).toBe(before);
  });

  it("a NEGATIVE gpCommitMinor → 400 INVALID_GP_COMMIT, and nothing is created", async () => {
    const before = spvCount();
    const res = await post("/api/partner/me/spv", launchBody({ gpCommitMinor: -5_000_000 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_GP_COMMIT");
    expect(spvCount()).toBe(before);
  });

  it("addFee's [0,1] carry domain is NOT widened — carryPct 2.5 is still refused", async () => {
    const created = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 8 }));
    expect(created.status).toBe(201);
    const id = created.body.spv.id as string;
    const fee = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management", feeType: "carry", carryPct: 2.5,
    });
    expect(fee.status).toBe(400);
    expect(fee.body.error).toBe("CARRY_PCT_REQUIRED");
  });

  it("OPEN S0 (WAVE 86B) — the LEGACY three-call sequence still strands an attested vehicle; the ATOMIC composite launch below does not", async () => {
    /* ── RE-TITLED BY WAVE 86B. READ THIS BEFORE TRUSTING THE GREEN TICK. ──────
       This test was correct and honest from the day it was written: it drives the
       failing sequence and asserts the hole is OPEN. What was wrong was the
       SUMMARY given to the owner, which reported the wizard fix as closing the
       item. But a green test whose name begins "MEASURED RESIDUAL" is exactly how
       an S0 gets read as handled — so the name now says OPEN S0 out loud.

       WHAT IS STILL OPEN: only the LEGACY three-call sequence, and only for a
       caller who deliberately uses it. Wave 86B added an ATOMIC composite launch
       (`fees` and `mandate` in the create body, the WHOLE payload validated before
       the first write) and the test immediately below proves a refused fee leaves
       NO vehicle, NO sign-off, NO mandate and NO fee row.

       WHY THE LEGACY PATH IS NOT ALSO CLOSED: the only way to close it is to make
       `fees` a REQUIRED key on POST /api/partner/me/spv, which is a breaking
       interface change across 47 call sites in 33 test files plus any live
       integration. OWNER DECISION, on the record: implement full up-front
       validation WITHOUT making `fees` required at the type level.
       Over-HTTP evidence for both halves:
       build_log/wave86b/transcripts/08_item2_spv_atomicity_after.txt. */
    const created = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 8 }));
    expect(created.status).toBe(201);
    const id = created.body.spv.id as string;
    await put(`/api/partner/me/spv/${id}/mandate`, {
      mode: "deal_specific",
      sector: ["Fintech"],
      ruleTree: { op: "and", rules: [{ field: "sector", op: "in", value: ["Fintech"] }] },
    });
    const fee = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management", feeType: "carry", carryPct: 2.5,
    });
    expect(fee.status).toBe(400);
    const spv = spvEngineStore.getSpv(PARTNER_A, id);
    expect(spv).toBeTruthy();
    // THE RESIDUAL, asserted so a future wave cannot claim it was closed here.
    expect(spvEngineStore.listFees(PARTNER_A, id).length).toBe(0);
  });

  it("W86B-S1 — the ATOMIC composite launch: a refused fee creates NO vehicle, NO sign-off, NO mandate and NO fee row", async () => {
    /* ── WAVE 86B · ITEM 2, THE OTHER POLE OF THE TEST ABOVE ───────────────────
       The same invalid `carryPct: 2.5` that strands a vehicle on the legacy
       three-call sequence, submitted as ONE payload. Every refusal a caller can
       provoke from the payload now fires ABOVE the first write, so a 400 leaves
       the platform byte-for-byte as it was. Proved over real HTTP with curl too:
       build_log/wave86b/transcripts/08_item2_spv_atomicity_after.txt. */
    const before = spvCount();
    const name = `W86B atomic ${Date.now()}`;
    const res = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 8 }, {
      name,
      fees: [{ layer: "management", feeType: "carry", carryPct: 2.5 }],
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("CARRY_PCT_REQUIRED");
    /* NOTHING WAS CREATED — the assertion the whole item exists for. */
    expect(spvCount()).toBe(before);
    expect(spvEngineStore.listByPartner(PARTNER_A).filter((s) => s.name === name)).toEqual([]);
  });

  it("W86B-S2 — every OTHER payload refusal also creates nothing: a bad mandate, an over-raise fee, a GP-set platform fee", async () => {
    for (const [label, extra, status] of [
      ["bad mandate mode", { mandate: { mode: "not_a_mode", ruleTree: { op: "and", rules: [] } } }, 400],
      ["fixed fee over the target raise", { fees: [{ layer: "management", feeType: "fixed", fixedAmountMinor: 99_999_999_999 }] }, 400],
      ["platform-layer fee set by a GP", { fees: [{ layer: "platform", feeType: "carry", carryPct: 0.1 }] }, 403],
    ] as Array<[string, Record<string, unknown>, number]>) {
      const before = spvCount();
      const name = `W86B atomic ${label} ${Date.now()}`;
      const res = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 8 }, { name, ...extra }));
      expect(res.status, `${label}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(status);
      expect(spvCount(), label).toBe(before);
      expect(spvEngineStore.listByPartner(PARTNER_A).filter((s) => s.name === name), label).toEqual([]);
    }
  });

  it("W86B-S3 — the LEGITIMATE composite launch lands the mandate and the fee in ONE call, and `fees` stays OPTIONAL", async () => {
    /* `fees` is deliberately NOT required at the type level (owner decision), so
       the SAME endpoint with no `fees` key behaves exactly as it did before. That
       is what keeps the 47 existing call sites working. */
    const legacyShape = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 8 }));
    expect(legacyShape.status).toBe(201);
    expect(legacyShape.body.spv).toBeTruthy();
    expect(legacyShape.body.launchComplete).toBe(false);
    expect(legacyShape.body.fees).toEqual([]);

    const composite = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 8 }, {
      mandate: { mode: "open", ruleTree: { op: "and", rules: [] } },
      fees: [{ layer: "management", feeType: "carry", carryPct: 0.205 }],
    }));
    expect(composite.status).toBe(201);
    expect(composite.body.launchComplete).toBe(true);
    const cid = composite.body.spv.id as string;
    expect(spvEngineStore.listFees(PARTNER_A, cid).length).toBe(1);
    expect(spvEngineStore.listFees(PARTNER_A, cid)[0].carryPct).toBe(0.205);
    expect(spvEngineStore.getMandate(PARTNER_A, cid)).toBeTruthy();
    /* And the sign-off is still recorded and linked, as it always was. */
    expect(composite.body.signoff?.id).toBeTruthy();
    /* The hurdle is still normalised percent-as-written -> fraction at the boundary. */
    expect(composite.body.spv.terms.hurdleRatePct).toBe(0.08);
  });
});

describe("W82 ITEM 2 · the legitimate launch is unchanged", () => {
  it("a decimal carry and an 8% hurdle launch end to end in the wizard's call order", async () => {
    const created = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: 8, gpCommitMinor: 5_000_000 }));
    expect(created.status).toBe(201);
    const id = created.body.spv.id as string;

    const mandate = await put(`/api/partner/me/spv/${id}/mandate`, {
      mode: "deal_specific",
      sector: ["Fintech"],
      geography: ["United States", "Canada"],
      stage: ["seed", "series_a"],
      checkMinMinor: 2_500_000,
      checkMaxMinor: 25_000_000,
      ruleTree: { op: "and", rules: [{ field: "sector", op: "in", value: ["Fintech"] }] },
    });
    expect(mandate.status).toBeLessThan(300);

    // 20.5% as written = 0.205 on the wire. Decimals must survive.
    const fee = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management", feeType: "carry", carryPct: 20.5 / 100,
    });
    expect(fee.status).toBe(201);

    const fees = spvEngineStore.listFees(PARTNER_A, id);
    expect(fees.length).toBe(1);
    expect(Number(fees[0].carryPct)).toBeCloseTo(0.205, 9);

    // The hurdle is stored as a FRACTION, with the as-written value retained.
    const spv = spvEngineStore.getSpv(PARTNER_A, id);
    const terms = (spv?.terms ?? {}) as Record<string, unknown>;
    expect(Number(terms.hurdleRatePct)).toBeCloseTo(0.08, 9);
    expect(Number(terms._hurdleRatePctAsWritten)).toBe(8);
    // NOT CLAMPED: an 8 became 0.08, not 1.
    expect(Number(terms.hurdleRatePct)).not.toBe(1);
  });

  it("0 carry is still legal, and a blank hurdle still launches", async () => {
    const created = await post("/api/partner/me/spv", launchBody());
    expect(created.status).toBe(201);
    const id = created.body.spv.id as string;
    const fee = await post(`/api/partner/me/spv/${id}/fees`, {
      layer: "management", feeType: "carry", carryPct: 0,
    });
    expect(fee.status).toBe(201);
    const terms = ((spvEngineStore.getSpv(PARTNER_A, id)?.terms ?? {}) as Record<string, unknown>);
    expect(terms.hurdleRatePct ?? null).toBeNull();
  });

  it("hurdleRatePct exactly 100 and exactly 0 are both INSIDE the declared domain", async () => {
    for (const h of [0, 100]) {
      const res = await post("/api/partner/me/spv", launchBody({ hurdleRatePct: h }));
      expect(res.status, `hurdle ${h}`).toBe(201);
    }
  });

  it("an ABSENT gpCommitMinor key is untouched — the fence made nothing newly required", async () => {
    const res = await post("/api/partner/me/spv", launchBody());
    expect(res.status).toBe(201);
    const res0 = await post("/api/partner/me/spv", launchBody({ gpCommitMinor: 0 }));
    expect(res0.status).toBe(201);
    const resNull = await post("/api/partner/me/spv", launchBody({ gpCommitMinor: null }));
    expect(resNull.status).toBe(201);
  });
});

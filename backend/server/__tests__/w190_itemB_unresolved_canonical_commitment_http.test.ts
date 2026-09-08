/**
 * WAVE 190 · ITEM B · R152 — A COMMITMENT IS NOT RECORDED AGAINST A VEHICLE THE
 * PLATFORM CANNOT VERIFY IS OPEN.
 *
 * THE DEFECT THIS TEST FENCES. `engineAddCommitment` ran wave 182's
 * closed-vehicle gate and wave 189's attestation gate INSIDE
 * `if (canonical) { … }` with no `else`, then wrote the commitment and returned
 * `201 { ok: true }`. So on every canonical lookup miss — a cross-partner id, a
 * cold or failed hydration, or a legacy-spelled id — both gates were skipped and
 * the write was reported as a success. A gate that fails open and reports success
 * is worse than no gate, because nobody can see it happen.
 *
 * WHY THIS TEST IS AT THE HTTP LAYER (R137). A store-level unit test would have
 * passed against a route that never reached the store, and R137 records a fix
 * that passed every test and never reached the user. Every case below drives the
 * REAL Express route `POST /api/partner/me/spvs/:id/commitments` with supertest —
 * the live registration is `registerSpvLegacyAdapterRoutes`, called from
 * `server/routes.ts:1831` — and asserts the real response status and body.
 *
 * THE FOUR THINGS PROVED, IN THE ORDER THE BRIEF ASKS FOR THEM:
 *   B-a  a commitment whose canonical row cannot be resolved under EITHER id
 *        spelling is REFUSED with 409 and words a general partner can read, and
 *        nothing is written. No ALL-CAPS machine token appears in any field a
 *        person reads.
 *   B-b  a LEGACY-spelled id whose canonical row is filed under the derived
 *        `spv_mig_${sha256(id).slice(0,24)}` spelling now RESOLVES — and the
 *        proof is not that the request succeeded, it is that the GATE RAN: the
 *        same vehicle marked closed answers wave 182's refusal, and marked open
 *        and attested answers 201. A resolver that resolved to the wrong row, or
 *        a route that merely stopped refusing, cannot produce both answers.
 *   B-c  an EXISTING limited partner re-posting an EQUAL-or-LOWER amount is not
 *        wrongly refused. This is the `listSubscriptions(canonical.id)` half of
 *        the fix: subscriptions are filed under the CANONICAL id, so reading them
 *        with the caller's legacy id returns an empty list, an empty list makes an
 *        existing LP look new, and wave 182's rule then refuses a legitimate
 *        equal re-post.
 *   B-d  SETTLEMENT still behaves exactly as wave 182 left it: funds confirmed on
 *        an existing commitment while the vehicle is CLOSED, and — the case only
 *        this wave can create — a legacy commitment transitioned to `funded` on a
 *        vehicle whose canonical row cannot be resolved at all. Blocking new
 *        capacity must never block settling capital already committed.
 *
 * NO STORE-LEVEL SHORTCUT IS USED TO FABRICATE STATE THAT THE PLATFORM'S OWN
 * CODE CREATES. The legacy-only and derived-id fixtures are built with the very
 * functions the boot migration and shadow-persist paths use
 * (`spvFundStore.createSpv` with its own id, `shadowPersistPartnerSpvToEngine`,
 * `shadowCommitmentToEngine`, `recordSignoff`), so the id divergence under test is
 * the real one and not a shape invented by the test.
 *
 * MONEY. Every amount here is an integer minor-unit literal. Nothing in this file
 * calls `Number()`, `parseInt` or `parseFloat`, and no amount is converted.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvLegacyAdapterRoutes } from "../spvLegacyAdapters";
import {
  spvEngineStore,
  shadowPersistPartnerSpvToEngine,
  shadowCommitmentToEngine,
  resolveCanonicalSpvForCommitment,
} from "../spvEngineStore";
import { spvFundStore } from "../spvFundStore";
import { recordSignoff } from "../spvLaunchSignoffStore";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { SPV_CLOSED_TO_NEW_CAPITAL_CODE } from "@shared/spvClosedToNewCapital";
import { SPV_CANONICAL_ROW_UNRESOLVED_CODE } from "@shared/spvCanonicalCommitmentResolution";

/* WAVE 226 · R202 — wave 211 made an operator attestation MANDATORY on the
   money-event routes this suite drives, so these requests were refused 400 and
   the proofs below never reached their own assertions. The fixture supplies what
   a real operator supplies, over the same HTTP route; it is NOT a bypass. Read
   the header of `_wave226_attestation_fixture.ts` before changing it. */
import { W226_LP_COMMIT_ATT } from "./_wave226_attestation_fixture";
const MANAGING = "u_avi_managing";
const PARTNER_ID = "ac_consortium_partner_test_partner_inc";
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}
function patch(p: string, body?: unknown) {
  return request(app).patch(p).set("x-user-id", MANAGING).send(body ?? {});
}

/** The derived canonical id, spelled here INDEPENDENTLY of the implementation.
 *  `server/spvEngineStore.ts`'s `_migId` is module-private; recomputing the
 *  formula from the ruling means a change to that formula breaks this test rather
 *  than silently agreeing with it. */
function derivedCanonicalId(legacyId: string): string {
  return `spv_mig_${createHash("sha256").update(legacyId).digest("hex").slice(0, 24)}`;
}

/** A LEGACY-ONLY vehicle: present in the legacy mirror the commitment route
 *  resolves ownership through, absent from the canonical register both gates read.
 *  This is case B-1/B-3 of the preflight table. */
function legacyOnlyVehicle(name: string): string {
  const row = spvFundStore.createSpv({ partnerId: PARTNER_ID, name, status: "fundraising" });
  expect(spvFundStore.getById(row.id)?.partnerId).toBe(PARTNER_ID);
  return row.id;
}

/** A vehicle whose LEGACY row keeps its own id while its CANONICAL row is filed
 *  under the derived spelling — the one legitimate absence named in the ruling. */
function divergedVehicle(name: string, status: "open" | "closed"): { legacyId: string; canonicalId: string } {
  const legacyId = legacyOnlyVehicle(name);
  shadowPersistPartnerSpvToEngine({
    legacyId,
    partnerId: PARTNER_ID,
    name,
    status,
    jurisdiction: "delaware",
    recordedBy: MANAGING,
  });
  const canonicalId = derivedCanonicalId(legacyId);
  /* The fixture is checked, not assumed: the canonical row must be findable under
     the DERIVED id and must NOT be findable under the legacy id, or the case under
     test has not been created. */
  expect(spvEngineStore.getSpv(PARTNER_ID, canonicalId)?.status).toBe(status);
  expect(spvEngineStore.getSpv(PARTNER_ID, legacyId)).toBeNull();
  return { legacyId, canonicalId };
}

/** Attest a vehicle through the real sign-off store, so wave 189's gate is
 *  satisfied by a durable row rather than by mocking the gate away. */
function attest(spvId: string) {
  recordSignoff({
    partnerId: PARTNER_ID,
    spvId,
    userId: MANAGING,
    signerLegalName: "Avi Managing",
  });
}

/** No machine token, in anything a person reads. `error` deliberately keeps the
 *  code so a support ticket can still be keyed on it, so only the human fields are
 *  screened — exactly as wave 182's suite screens them. */
function expectHumanRefusal(body: Record<string, unknown>) {
  const humanFields = [String(body.message ?? ""), String(body.guidance ?? "")];
  for (const field of humanFields) {
    expect(field.length).toBeGreaterThan(0);
    expect(field).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
  }
  /* The short form must survive `queryClient.ts`'s 240-char `looksHuman` gate,
     or the client replaces it with a generic sentence and the GP is back to being
     refused without being told why. */
  expect(String(body.message ?? "").length).toBeLessThanOrEqual(240);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { headers: Record<string, string> }).headers["x-user-id"] =
      (req.headers["x-user-id"] as string) ?? MANAGING;
    next();
  });
  seedTestPartnerSandbox();
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  /* The LIVE registration, and the only one: `routes.ts:1831`. The dormant
     duplicate in `spvFundStore.ts` is deliberately NOT mounted here, so nothing
     below can be satisfied by the wrong handler. */
  registerSpvLegacyAdapterRoutes(app);
});

/* ══ B-a — UNRESOLVED MEANS REFUSED, IN WORDS, WITH NOTHING WRITTEN ════════ */
describe("W190 B-a — an unresolvable canonical row refuses with 409", () => {
  it("refuses the commitment, names the missing fact, writes nothing, and is not a 500", async () => {
    const legacyId = legacyOnlyVehicle("W190 Ba Legacy Only Vehicle");
    /* The precondition, asserted rather than assumed: BOTH spellings miss. */
    expect(resolveCanonicalSpvForCommitment(PARTNER_ID, legacyId)).toBeNull();
    expect(spvEngineStore.getSpv(PARTNER_ID, derivedCanonicalId(legacyId))).toBeNull();

    const before = spvFundStore.listCommitments(legacyId).length;
    const r = await post(`/api/partner/me/spvs/${legacyId}/commitments`, {
      lp_user_id: "lp_w190_ba",
      amount_minor: 50000_00,
    });

    expect(r.status).toBe(409);
    expect(r.body.error).toBe(SPV_CANONICAL_ROW_UNRESOLVED_CODE);
    /* NOT the old fail-open success, and NOT the catch-all server error. */
    expect(r.status).not.toBe(201);
    expect(r.body.error).not.toBe("COMMITMENT_FAILED");
    expectHumanRefusal(r.body);
    const joined = `${r.body.message} ${r.body.guidance}`.toLowerCase();
    expect(joined).toContain("did not record this commitment");
    expect(joined).toContain("open to new");
    /* And it says settlement is unaffected, because that is the question a GP
       reading this refusal will ask next. */
    expect(joined).toContain("confirming funds");

    /* NOTHING WAS WRITTEN. The old behaviour's whole problem was that it wrote. */
    expect(spvFundStore.listCommitments(legacyId).length).toBe(before);
  });

  it("the refusal reason is reported as a field, so a reader is not left guessing", async () => {
    const legacyId = legacyOnlyVehicle("W190 Ba Reason Field");
    const r = await post(`/api/partner/me/spvs/${legacyId}/commitments`, {
      lp_user_id: "lp_w190_ba2",
      amount_minor: 1000_00,
    });
    expect(r.status).toBe(409);
    expect(r.body.canonicalRowUnresolved?.reason).toBe("unresolved_after_legacy_id_derivation");
  });
});

/* ══ B-b — THE LEGITIMATE ABSENCE RESOLVES, AND IS GENUINELY GATED ════════
   The brief's point exactly: proving the request merely SUCCEEDS proves nothing,
   because a route that skipped the gate would also succeed. So the same diverged
   vehicle is driven in both directions. */
describe("W190 B-b — a legacy-spelled id resolves via the derived id AND is gated", () => {
  it("CLOSED: the gate runs on the derived-id row and answers wave 182's refusal, not the unresolved one", async () => {
    const name = "W190 Bb Diverged Closed";
    const { legacyId, canonicalId } = divergedVehicle(name, "closed");
    attest(canonicalId);

    const r = await post(`/api/partner/me/spvs/${legacyId}/commitments`, {
      lp_user_id: "lp_w190_bb_closed",
      amount_minor: 25000_00,
    });

    expect(r.status).toBe(409);
    /* THE LOAD-BEARING ASSERTION. A closed-to-new-capital refusal can only be
       produced by code that FOUND the canonical row and read its status. If the
       resolver had missed, this would be the unresolved code instead; if the gate
       were skipped, this would be a 201. */
    expect(r.body.error).toBe(SPV_CLOSED_TO_NEW_CAPITAL_CODE);
    expect(r.body.error).not.toBe(SPV_CANONICAL_ROW_UNRESOLVED_CODE);
    expect(r.body.closedToNewLps?.reason).toBe("new_limited_partner");
    expectHumanRefusal(r.body);
    expect(`${r.body.message} ${r.body.guidance}`).toContain(name);
    expect(spvFundStore.listCommitments(legacyId).length).toBe(0);
  });

  it("OPEN and attested: the same divergence now records the commitment", async () => {
    const name = "W190 Bb Diverged Open";
    const { legacyId, canonicalId } = divergedVehicle(name, "open");
    attest(canonicalId);

    const r = await post(`/api/partner/me/spvs/${legacyId}/commitments`, {
      lp_user_id: "lp_w190_bb_open",
      amount_minor: 30000_00,
    });

    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    expect(r.body.commitment?.spvId).toBe(legacyId);
    /* The row lands in the legacy register under the id the caller used — the
       resolver changed which row the GATES read, and nothing about where the
       commitment is written. */
    expect(spvFundStore.listCommitments(legacyId).length).toBe(1);
  });

  it("the resolver itself returns the derived row and never invents one", () => {
    const { legacyId, canonicalId } = divergedVehicle("W190 Bb Resolver Direct", "open");
    const resolved = resolveCanonicalSpvForCommitment(PARTNER_ID, legacyId);
    expect(resolved?.id).toBe(canonicalId);
    /* READ-ONLY: resolving must not back-fill a canonical row under the legacy id. */
    expect(spvEngineStore.getSpv(PARTNER_ID, legacyId)).toBeNull();
    /* And a cross-partner caller still gets nothing — `getSpv` is fail-closed and
       the second spelling must not become a way around it. */
    expect(resolveCanonicalSpvForCommitment("ac_some_other_partner", legacyId)).toBeNull();
  });
});

/* ══ B-c — AN EXISTING LP'S EQUAL-OR-LOWER RE-POST IS NOT REFUSED ═════════
   This is the case `listSubscriptions(args.spvId)` got wrong: the subscription
   exists under the CANONICAL id, so reading it with the caller's legacy id
   returned an empty list and wave 182's rule then read an existing LP as a new
   one and refused a legitimate re-post on a closed vehicle. */
describe("W190 B-c — the subscription list is read under the canonical id", () => {
  it("an existing LP re-posting an EQUAL amount into a closed diverged vehicle is accepted", async () => {
    const name = "W190 Bc Existing Lp Equal";
    const { legacyId, canonicalId } = divergedVehicle(name, "closed");
    attest(canonicalId);
    const LP = "lp_w190_bc_equal";

    /* The LP's subscription is filed under the CANONICAL id, which is exactly how
       a shadow-persisted legacy position lands. */
    const shadow = shadowCommitmentToEngine({
      legacyPositionId: "pos_w190_bc_equal",
      legacySpvId: legacyId,
      partnerId: PARTNER_ID,
      lpUserId: LP,
      amountMinor: 40000_00,
    });
    expect(shadow.ok).toBe(true);
    /* The precondition that makes this test the real one: the subscription is
       invisible under the legacy spelling and visible under the canonical one. */
    expect(spvEngineStore.listSubscriptions(PARTNER_ID, legacyId).length).toBe(0);
    expect(
      spvEngineStore.listSubscriptions(PARTNER_ID, canonicalId).some((s) => s.investorId === LP),
    ).toBe(true);

    const equal = await post(`/api/partner/me/spvs/${legacyId}/commitments`, {
      lp_user_id: LP,
      amount_minor: 40000_00,
    });
    expect(equal.status).toBe(201);

    const lower = await post(`/api/partner/me/spvs/${legacyId}/commitments`, {
      lp_user_id: LP,
      amount_minor: 10000_00,
    });
    expect(lower.status).toBe(201);
  });

  it("but an INCREASE by that same existing LP is still refused, so the fix did not open a hole", async () => {
    const name = "W190 Bc Existing Lp Increase";
    const { legacyId, canonicalId } = divergedVehicle(name, "closed");
    attest(canonicalId);
    const LP = "lp_w190_bc_increase";
    expect(
      shadowCommitmentToEngine({
        legacyPositionId: "pos_w190_bc_increase",
        legacySpvId: legacyId,
        partnerId: PARTNER_ID,
        lpUserId: LP,
        amountMinor: 40000_00,
      }).ok,
    ).toBe(true);

    const increase = await post(`/api/partner/me/spvs/${legacyId}/commitments`, {
      lp_user_id: LP,
      amount_minor: 60000_00,
    });
    expect(increase.status).toBe(409);
    expect(increase.body.error).toBe(SPV_CLOSED_TO_NEW_CAPITAL_CODE);
    expect(increase.body.closedToNewLps?.reason).toBe("increase");
    expectHumanRefusal(increase.body);
  });
});

/* ══ B-d — SETTLEMENT IS UNTOUCHED (WAVE 182'S LESSON) ═══════════════════ */
describe("W190 B-d — settling capital already committed still works", () => {
  it("funds are confirmed on an existing commitment WHILE the vehicle is closed", async () => {
    /* Built through the vehicle's own routes, so this is the same path wave 182
       proved and not a re-implementation of it. */
    const create = await post("/api/partner/me/spv", {
      name: "W190 Bd Settlement While Closed",
      jurisdiction: "delaware",
      currency: "USD", /* WAVE 306 W1 — stated, not defaulted: preserves this fixture's prior behaviour exactly. */
      carryBasis: "whole_spv",
      status: "open",
      signoffLegalName: "Avi Managing",
      signoffAccepted: true,
    });
    expect(create.status).toBe(201);
    const spvId = create.body.spv.id as string;

    const committed = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Settling",
      holderLastName: "Lp",
      investorEmail: "w190-settling@example.com",
      amount: "200000",
      shares: "20",
    });
    expect(committed.status).toBe(201);
    const investorId = spvEngineStore.listSubscriptions(PARTNER_ID, spvId)[0].investorId;

    const closed = await post(`/api/partner/me/spv/${spvId}/close`, {});
    expect(closed.status).toBeLessThan(300);
    expect(spvEngineStore.getSpv(PARTNER_ID, spvId)!.status).toBe("closed");

    /* New capacity is refused … */
    const refusedNew = await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Postclose",
      holderLastName: "Lp",
      investorEmail: "w190-postclose@example.com",
      amount: "50000",
      shares: "5",
    });
    expect(refusedNew.status).toBe(409);

    /* … and settlement of capital already committed is not. */
    const confirm = await post(
      `/api/partner/me/spv/${spvId}/subscriptions/${investorId}/confirm-funds`,
      { receivedMinor: 200000_00, reference: "WIRE-W190-BD" },
    );
    expect(confirm.status).toBeLessThan(300);
  });

  it("a legacy commitment can still be transitioned to funded on a vehicle whose canonical row cannot be resolved", async () => {
    /* THE CASE ONLY WAVE 190 CAN CREATE. If the new refusal had been placed on the
       shared path rather than on the NEW-capacity path, this is the request it
       would have broken: money that has actually arrived, on a vehicle the
       canonical register has no row for, could not be recorded as received. */
    const legacyId = legacyOnlyVehicle("W190 Bd Unresolved Settlement");
    const seeded = spvFundStore.addCommitment({
      spvId: legacyId,
      lpUserId: "lp_w190_bd_settle",
      amountMinor: 75000_00,
      status: "signed",
    });
    expect(resolveCanonicalSpvForCommitment(PARTNER_ID, legacyId)).toBeNull();

    const r = await patch(
      `/api/partner/me/spvs/${legacyId}/commitments/${seeded.id}`,
      { status: "funded" },
    );
    expect(r.status).toBeLessThan(300);
    expect(
      spvFundStore.listCommitments(legacyId).find((c) => c.id === seeded.id)?.status,
    ).toBe("funded");

    /* And a NEW commitment on that very same vehicle is still refused, in the same
       test, so the two rules are shown to coexist rather than one having replaced
       the other. */
    const newCapital = await post(`/api/partner/me/spvs/${legacyId}/commitments`, {
      lp_user_id: "lp_w190_bd_new",
      amount_minor: 10000_00,
    });
    expect(newCapital.status).toBe(409);
    expect(newCapital.body.error).toBe(SPV_CANONICAL_ROW_UNRESOLVED_CODE);
  });
});

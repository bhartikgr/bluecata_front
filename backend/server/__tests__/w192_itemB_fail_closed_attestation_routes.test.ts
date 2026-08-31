/**
 * WAVE 192 · ITEM B · R164.3 — TWO GATES THAT FAILED OPEN.
 *
 * A GATE THAT FAILS OPEN IS WORSE THAN NO GATE, BECAUSE IT REPORTS SUCCESS.
 *
 * ══ DEFECT B1 — `spvIsAttested` FAILED OPEN ON AN UNREADABLE TABLE ══
 * It caught every driver error from its own `SELECT` against
 * `spv_launch_signoffs` and returned `true` — ATTESTED. This was acute rather
 * than theoretical: wave 189's draft-gating enforcement calls this exact
 * function, so an unreadable table would have reported EVERY vehicle attested and
 * let capital attach to an unattested draft, defeating the gate that had just been
 * built. It now throws, and `assertSpvAttestedForNewCapital` converts the throw
 * into a refusal that NAMES what could not be read.
 *
 * ══ DEFECT B2 — THE LEGACY ADAPTER HAD NO 409 BRANCH ══
 * `POST /api/partner/me/spvs/:id/commitments` in `spvLegacyAdapters.ts` — the
 * route `server/routes.ts:1841` ACTUALLY MOUNTS in production — had branches for
 * wave 182's closed-vehicle refusal and wave 190's unresolved-row refusal, but
 * none for wave 189's `isSpvUnattestedDraftError`. So an unattested vehicle
 * answered `500 COMMITMENT_FAILED` there while the canonical routes answered a
 * readable 409. The store gate always held — no capital ever attached — so this
 * was the difference between enforcing and EXPLAINING.
 *
 * ══ A NOTE ON WHICH ROUTE THIS FILE MOUNTS, WHICH MATTERS ══
 * There are TWO implementations of `POST /api/partner/me/spvs/:id/commitments`:
 * one in `spvLegacyAdapters.ts` and a DORMANT duplicate in `spvFundStore.ts`.
 * `server/routes.ts:1834-1841` records that Wave B Stage 2 REPLACED
 * `registerSpvFundRoutes(app)` with `registerSpvLegacyAdapterRoutes(app)`, so
 * production serves the ADAPTER. Wave 189's suite mounts `registerSpvFundRoutes`,
 * which is why its route sweep did not reach the adapter branch that was missing.
 * This file mounts `registerSpvLegacyAdapterRoutes` — the production route — on
 * purpose. Mounting the wrong twin is how a suite "proves" a branch it never
 * executed.
 *
 * ══ THE HARM THIS WAVE COULD HAVE DONE, AND THE TEST THAT FENCES IT ══
 * Failing closed on an unreadable table must NOT trap legitimate SETTLEMENT.
 * Wave 182's rule, restated by the owner in this brief: block new capacity, never
 * block settling commitments that already exist. §B-4 confirms funds on an
 * existing commitment WITH THE TABLE UNREADABLE and requires it to succeed. If
 * that test ever fails, this wave has frozen capital that was already promised,
 * which is worse than the fail-open it replaced.
 *
 * MONEY. Every amount below is an integer minor unit passed straight through to
 * the store. This file performs no arithmetic on money, no conversion, and
 * hardcodes no fee, price or currency rate.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvLegacyAdapterRoutes } from "../spvLegacyAdapters";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore, engineListLegacyCommitments } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { recordSignoff, linkSignoffToSpv } from "../spvLaunchSignoffStore";
import {
  spvIsAttested,
  SpvAttestationUnreadableSignal,
  isSpvAttestationUnreadableError,
} from "../lib/spvAttestationGate";
import { SPV_UNATTESTED_DRAFT_CODE } from "@shared/spvUnattestedDraft";
import {
  SPV_ATTESTATION_UNREADABLE_CODE,
  SPV_ATTESTATION_UNREADABLE_SUBJECT,
  spvAttestationUnreadableHeadline,
  spvAttestationUnreadableSentence,
} from "@shared/spvAttestationUnreadable";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const TABLE = "spv_launch_signoffs";
const HIDDEN = "spv_launch_signoffs_w192_hidden";

let app: express.Express;

function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}
function patch(path: string, user: string, body?: unknown) {
  return request(app).patch(path).set("x-user-id", user).send(body ?? {});
}

async function createAttestedSpv(name: string): Promise<string> {
  const r = await post("/api/partner/me/spv", MANAGING, {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(r.status).toBe(201);
  return r.body.spv.id as string;
}

/** Strip the vehicle's launch sign-off — the state found on live `data.db`. */
function unattest(spvId: string): void {
  rawDb().prepare(`DELETE FROM ${TABLE} WHERE spv_id = ?`).run(spvId);
  expect(spvIsAttested(spvId)).toBe(false);
}

function attest(spvId: string): void {
  const rec = recordSignoff({
    partnerId: PARTNER_A,
    spvId,
    userId: MANAGING,
    signerLegalName: "Avi Managing",
  });
  expect(linkSignoffToSpv(rec.id, spvId)).toBe(true);
  expect(spvIsAttested(spvId)).toBe(true);
}

/* ── MAKING THE TABLE GENUINELY UNREADABLE ───────────────────────────────────
   The table is RENAMED, not dropped, so no row is destroyed and the state is
   perfectly reversible. `SELECT ... FROM spv_launch_signoffs` then raises a real
   `SqliteError: no such table` from the real driver — the exact class of failure
   the old `catch` swallowed into `true`.

   HARD-ABORT DISCIPLINE. Both helpers VERIFY that the mutation applied and throw
   if it did not. A previous harness in this project silently no-op'd its mutation
   and emitted a false verdict; a helper that cannot prove it changed the world
   must fail the test rather than let the test pass on an unchanged world. */
let tableIsHidden = false;

function hideAttestationTable(): void {
  rawDb().exec(`ALTER TABLE ${TABLE} RENAME TO ${HIDDEN}`);
  tableIsHidden = true;
  /* PROOF THE MUTATION APPLIED: the predicate must now THROW. If it returns any
     boolean at all, the rename did not take and every assertion below would be
     meaningless. */
  let threw = false;
  try {
    spvIsAttested("spv_any_id_at_all");
  } catch (err) {
    threw = err instanceof SpvAttestationUnreadableSignal;
  }
  if (!threw) {
    throw new Error(
      "HARD ABORT: hideAttestationTable() did not make the table unreadable — " +
        "spvIsAttested() did not raise the unreadable signal. Every assertion in " +
        "this suite that depends on an unreadable table would be vacuous.",
    );
  }
}

function restoreAttestationTable(): void {
  if (!tableIsHidden) return;
  rawDb().exec(`ALTER TABLE ${HIDDEN} RENAME TO ${TABLE}`);
  tableIsHidden = false;
  /* PROOF THE RESTORE APPLIED: the predicate must answer cleanly again. */
  const ok = spvIsAttested("spv_any_id_at_all");
  if (ok !== false) {
    throw new Error("HARD ABORT: restoreAttestationTable() left the table in a wrong state.");
  }
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  /* THE PRODUCTION ROUTE, not the dormant `spvFundStore` twin — see the header. */
  registerSpvLegacyAdapterRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

afterEach(() => {
  /* Never leave the schema renamed for a sibling test or a sibling file. */
  restoreAttestationTable();
});

/* ════════════════════════════════════════════════════════════════════════════
   B-0 — THE PREDICATE ITSELF NOW FAILS CLOSED.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 B-0 — spvIsAttested no longer reports ATTESTED when it cannot tell", () => {
  it("throws the unreadable signal instead of returning true", () => {
    hideAttestationTable();
    expect(() => spvIsAttested("spv_whatever")).toThrow(SpvAttestationUnreadableSignal);
    /* THE OLD BEHAVIOUR, NAMED SO IT CANNOT COME BACK: it returned `true`. */
    let returnedTrue = false;
    try { returnedTrue = spvIsAttested("spv_whatever") === true; } catch { /* expected */ }
    expect(returnedTrue, "FAIL-OPEN REGRESSION: reported ATTESTED on an unreadable table").toBe(false);
  });

  it("a readable table still answers cleanly for both values", async () => {
    const id = await createAttestedSpv("W192 B0 Readable");
    expect(spvIsAttested(id)).toBe(true);
    unattest(id);
    expect(spvIsAttested(id)).toBe(false);
  });

  it("the refusal NAMES what could not be read, and is prose a GP can read", () => {
    for (const kind of ["limited_partner", "commitment", "fee"] as const) {
      const headline = spvAttestationUnreadableHeadline({ spvName: "Keiretsu NovaPay SPV", kind });
      const sentence = spvAttestationUnreadableSentence({ spvName: "Keiretsu NovaPay SPV", kind });
      for (const s of [headline, sentence]) {
        /* NAMES what could not be read — the owner's explicit requirement. */
        expect(s).toContain(SPV_ATTESTATION_UNREADABLE_SUBJECT);
        /* NEVER an ALL-CAPS underscore code on screen. */
        expect(s).not.toContain(SPV_ATTESTATION_UNREADABLE_CODE);
        expect(s).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
        expect(/[a-z]/.test(s)).toBe(true);
      }
      /* Survives the client's 240-character `looksHuman` gate, including for a
         long vehicle name — otherwise `queryClient.ts` substitutes a generic
         status message and the named subject never reaches the screen. */
      expect(headline.length).toBeLessThan(240);
      const long = spvAttestationUnreadableHeadline({
        spvName: "Keiretsu Forum Canada NovaPay Series B Co-Investment Vehicle 2026-A",
        kind,
      });
      expect(long.length).toBeLessThan(240);
    }
  });

  it("a nameless vehicle is described in words, never as an internal id", () => {
    for (const blank of [null, undefined, "", "   "]) {
      const h = spvAttestationUnreadableHeadline({ spvName: blank, kind: "fee" });
      expect(h).not.toContain("spv_");
      expect(h.length).toBeGreaterThan(40);
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   B-1 — DEFECT B2: THE LEGACY ADAPTER NOW REFUSES READABLY, NOT WITH A 500.
   Route level, not store level (R137).
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 B-1 — the legacy adapter answers an unattested draft with a readable 409", () => {
  it("POST /spvs/:id/commitments — 409, the code in `error`, the words in `message`", async () => {
    const id = await createAttestedSpv("W192 B1 Adapter Unattested");
    unattest(id);
    const r = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, {
      lp_user_id: "inv_w192_b1",
      amount_minor: 500000,
    });
    /* THE DEFECT: this was a 500 carrying `COMMITMENT_FAILED`. */
    expect(r.status, `expected 409, got ${r.status} with ${JSON.stringify(r.body)}`).toBe(409);
    expect(r.status).not.toBe(500);
    expect(r.body.error).toBe(SPV_UNATTESTED_DRAFT_CODE);
    /* Matching wave 189's refusal shape exactly — one refusal cannot be reported
       two ways on two routes. */
    expect(r.body.attestation).toEqual({ required: true, attaching: "commitment" });
    expect(typeof r.body.message).toBe("string");
    expect(r.body.message.length).toBeLessThan(240);
    expect(r.body.message).toContain("unattested draft");
    expect(r.body.message).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
    expect(typeof r.body.guidance).toBe("string");
    expect(r.body.guidance).toContain("no signed launch attestation on record");
    expect(r.body.guidance).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
    /* And the refusal's own claim, verified: nothing was written. */
    expect(engineListLegacyCommitments(id).length).toBe(0);
  });

  it("the canonical route and the adapter report the SAME refusal for the same vehicle", async () => {
    const id = await createAttestedSpv("W192 B1 Two Doors Agree");
    unattest(id);
    const viaCanonical = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
      investorId: "inv_w192_b1_canon",
      commitmentMinor: 250000,
    });
    const viaAdapter = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, {
      lp_user_id: "inv_w192_b1_adapter",
      amount_minor: 250000,
    });
    expect(viaCanonical.status).toBe(409);
    expect(viaAdapter.status).toBe(409);
    expect(viaAdapter.body.error).toBe(viaCanonical.body.error);
    expect(typeof viaAdapter.body.message).toBe("string");
    expect(typeof viaAdapter.body.guidance).toBe("string");
  });

  it("signing the attestation lets the SAME adapter request through", async () => {
    const id = await createAttestedSpv("W192 B1 Sign Then Permit");
    unattest(id);
    const body = { lp_user_id: "inv_w192_b1_permit", amount_minor: 750000 };
    const refused = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, body);
    expect(refused.status).toBe(409);
    attest(id);
    const permitted = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, body);
    expect(permitted.status).toBe(201);
    expect(permitted.body.ok).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   B-2 — DEFECT B1: AN UNREADABLE TABLE REFUSES RATHER THAN PERMITTING,
   ON EVERY NEW-CAPITAL PATH INCLUDING THE LEGACY ADAPTER.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 B-2 — an unreadable attestation table refuses new capital everywhere", () => {
  /** Every assertion the unreadable refusal must satisfy, in one place, so no path
   *  is "covered" by a weaker check than its siblings. */
  function expectUnreadableRefusal(r: { status: number; body: any }, attaching: string) {
    expect(r.status, `expected 409, got ${r.status} with ${JSON.stringify(r.body)}`).toBe(409);
    expect(r.status).not.toBe(201);
    expect(r.body.error).toBe(SPV_ATTESTATION_UNREADABLE_CODE);
    expect(r.body.attestation).toEqual({ required: true, attaching, unreadable: true });
    expect(typeof r.body.message).toBe("string");
    expect(r.body.message.length).toBeLessThan(240);
    /* NAMES what could not be read. */
    expect(r.body.message).toContain(SPV_ATTESTATION_UNREADABLE_SUBJECT);
    expect(r.body.message).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
    expect(typeof r.body.guidance).toBe("string");
    expect(r.body.guidance).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
    /* AND NO FILESYSTEM PATH OR DRIVER TEXT: the driver message is logged for an
       operator, never carried to a general partner's screen. */
    for (const s of [r.body.message, r.body.guidance]) {
      expect(s).not.toContain("/home/");
      expect(s).not.toContain("no such table");
      expect(s).not.toContain(HIDDEN);
      expect(s).not.toContain("SqliteError");
    }
  }

  it("the LEGACY ADAPTER refuses a commitment instead of writing one", async () => {
    const id = await createAttestedSpv("W192 B2 Adapter Unreadable");
    /* NOTE: this vehicle IS attested. Under the OLD fail-open behaviour an
       unreadable table returned `true`, so this request would have SUCCEEDED and
       nothing would have been reported. Under the new behaviour it refuses,
       because the platform cannot confirm the attestation it is relying on. */
    hideAttestationTable();
    const r = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, {
      lp_user_id: "inv_w192_b2_adapter",
      amount_minor: 500000,
    });
    expectUnreadableRefusal(r, "commitment");
    restoreAttestationTable();
    expect(engineListLegacyCommitments(id).length).toBe(0);
  });

  it("the canonical subscription route refuses an LP instead of attaching one", async () => {
    const id = await createAttestedSpv("W192 B2 Subscriptions Unreadable");
    hideAttestationTable();
    const r = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
      investorId: "inv_w192_b2_sub",
      commitmentMinor: 500000,
    });
    expectUnreadableRefusal(r, "limited_partner");
    restoreAttestationTable();
    expect(spvEngineStore.listSubscriptions(PARTNER_A, id).length).toBe(0);
  });

  it("the legacy-named positions route (partnerRoutes responder) refuses too", async () => {
    const id = await createAttestedSpv("W192 B2 Positions Unreadable");
    hideAttestationTable();
    const r = await post(`/api/partner/me/spvs/${id}/positions`, MANAGING, {
      lpContactId: "inv_w192_b2_pos",
      positionAmountMinor: 250000,
      currency: "USD",
    });
    expectUnreadableRefusal(r, "limited_partner");
    restoreAttestationTable();
    expect(spvEngineStore.listSubscriptions(PARTNER_A, id).length).toBe(0);
  });

  it("the fee route refuses a fee instead of attaching one", async () => {
    const id = await createAttestedSpv("W192 B2 Fees Unreadable");
    hideAttestationTable();
    const r = await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management",
      feeType: "carry",
      carryPct: 0.2,
    });
    expectUnreadableRefusal(r, "fee");
    restoreAttestationTable();
  });

  it("the lp-commit route — the sink that reaches the sacred ledger — refuses", async () => {
    const id = await createAttestedSpv("W192 B2 LpCommit Unreadable");
    hideAttestationTable();
    const r = await post(`/api/partner/me/spv/${id}/lp-commit`, MANAGING, {
      holderFirstName: "Wave192",
      holderLastName: "Unreadable",
      investorEmail: "w192.unreadable@example.com",
      amount: "4000.00",
      shares: "400",
    });
    expectUnreadableRefusal(r, "limited_partner");
    restoreAttestationTable();
    expect(spvEngineStore.listSubscriptions(PARTNER_A, id).length).toBe(0);
  });

  it("the type guard distinguishes the unreadable refusal from any other error", () => {
    expect(isSpvAttestationUnreadableError(new Error("something else"))).toBe(false);
    expect(isSpvAttestationUnreadableError(null)).toBe(false);
    expect(isSpvAttestationUnreadableError(undefined)).toBe(false);
    /* And the internal SIGNAL is not the customer-facing error: the signal carries
       no vehicle name and must never be answered directly to a route. */
    expect(isSpvAttestationUnreadableError(new SpvAttestationUnreadableSignal())).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   B-3 — ATTESTED VEHICLES WITH A READABLE TABLE ARE ENTIRELY UNAFFECTED.
   The fix must not be a general slowdown of the platform's normal path.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 B-3 — an attested vehicle takes capital exactly as before", () => {
  it("commitment, subscription and fee all succeed on an attested vehicle", async () => {
    const id = await createAttestedSpv("W192 B3 Attested Unaffected");
    expect(spvIsAttested(id)).toBe(true);

    const commit = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, {
      lp_user_id: "inv_w192_b3",
      amount_minor: 1000000,
    });
    expect(commit.status).toBe(201);

    const sub = await post(`/api/partner/me/spv/${id}/subscriptions`, MANAGING, {
      investorId: "inv_w192_b3_sub",
      commitmentMinor: 1000000,
    });
    expect(sub.status).toBe(201);

    const fee = await post(`/api/partner/me/spv/${id}/fees`, MANAGING, {
      layer: "management",
      feeType: "carry",
      carryPct: 0.2,
    });
    expect(fee.status).toBe(201);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   B-4 — THE WAY THIS WAVE COULD DO HARM: TRAPPING LEGITIMATE SETTLEMENT.
   ════════════════════════════════════════════════════════════════════════════
   WAVE 182'S RULE, RESTATED BY THE OWNER: block new capacity, never block
   settling commitments that already exist. A commitment that has already been
   recorded represents capital a limited partner has already promised; refusing to
   mark it funded does not protect anyone, it strands money mid-flight and forces
   an off-platform reconciliation. So the fail-closed change must be INVISIBLE to
   settlement, even with the attestation table completely unreadable.

   IS THERE ANY LEGITIMATE CASE WHERE AN UNREADABLE TABLE SHOULD PERMIT NEW
   CAPITAL? No — and this suite's structure is the argument. Permitting means
   recording capital against a vehicle nobody has verifiably vouched for, on the
   strength of a read that FAILED. Refusing costs a general partner one retry
   after an operator restores a table. The asymmetry is total, and it only holds
   because settlement is carved out, which is what §B-4 proves.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 B-4 — settling an EXISTING commitment still works with the table unreadable", () => {
  it("PATCH /spvs/:id/commitments/:commitmentId to funded succeeds while the table cannot be read", async () => {
    const id = await createAttestedSpv("W192 B4 Settlement Carve Out");
    /* The commitment is created NORMALLY, while everything is readable — this is
       capital that already exists, which is precisely the case wave 182 protects. */
    const created = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, {
      lp_user_id: "inv_w192_b4",
      amount_minor: 900000,
    });
    expect(created.status).toBe(201);
    const commitmentId = created.body.commitment.id as string;
    expect(typeof commitmentId).toBe("string");

    /* Now the world breaks. */
    hideAttestationTable();

    /* NEW capacity is refused — the gate is genuinely engaged in this state, so a
       pass below cannot be explained by the gate simply being off. */
    const newCapital = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, {
      lp_user_id: "inv_w192_b4_new",
      amount_minor: 100000,
    });
    expect(newCapital.status).toBe(409);
    expect(newCapital.body.error).toBe(SPV_ATTESTATION_UNREADABLE_CODE);

    /* AND SETTLEMENT STILL GOES THROUGH. */
    const signed = await patch(
      `/api/partner/me/spvs/${id}/commitments/${commitmentId}`,
      MANAGING,
      { status: "signed" },
    );
    expect(signed.status, `settlement was TRAPPED: ${JSON.stringify(signed.body)}`).toBe(200);

    const funded = await patch(
      `/api/partner/me/spvs/${id}/commitments/${commitmentId}`,
      MANAGING,
      { status: "funded" },
    );
    expect(funded.status, `settlement was TRAPPED: ${JSON.stringify(funded.body)}`).toBe(200);

    restoreAttestationTable();

    /* The commitment really did settle — asserted from the store, not from the
       response, so a 200 on a no-op could not pass this. */
    const rows = engineListLegacyCommitments(id);
    const row = rows.find((c) => c.id === commitmentId);
    expect(row, "the settled commitment must still be on record").toBeTruthy();
    expect(row!.status).toBe("funded");
  });

  it("settlement also works on an UNATTESTED vehicle whose commitment predates the gate", async () => {
    /* The harder version of the same rule: the vehicle is not merely unverifiable,
       it is genuinely unattested. The commitment still exists and must still be
       settleable, because refusing would strand capital already promised. */
    const id = await createAttestedSpv("W192 B4 Unattested Settlement");
    const created = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, {
      lp_user_id: "inv_w192_b4_unatt",
      amount_minor: 400000,
    });
    expect(created.status).toBe(201);
    const commitmentId = created.body.commitment.id as string;

    unattest(id);

    /* New capacity refused. */
    const blocked = await post(`/api/partner/me/spvs/${id}/commitments`, MANAGING, {
      lp_user_id: "inv_w192_b4_unatt_new",
      amount_minor: 100000,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe(SPV_UNATTESTED_DRAFT_CODE);

    /* Settlement permitted. */
    const signed = await patch(
      `/api/partner/me/spvs/${id}/commitments/${commitmentId}`,
      MANAGING,
      { status: "signed" },
    );
    expect(signed.status, `settlement was TRAPPED: ${JSON.stringify(signed.body)}`).toBe(200);
  });
});

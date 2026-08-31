/**
 * WAVE 112 — the two guards on the convergence itself.
 *
 * 1. SHAPE. `GET /api/partner/me/spvs/:id/detail` is a legacy contract. The
 *    convergence changes where `reconciliation.committedMinor` COMES FROM; it
 *    must not change the response's shape. All six reconciliation keys keep
 *    their names, order and decimal-string type.
 *
 * 2. NOTHING IS SILENTLY DROPPED. A commitment created through the legacy
 *    family's OWN routes (POST /commitments then PATCH to `signed`) has no
 *    engine subscription, so after this wave it is correctly absent from the
 *    canonical committed figure. Absent SILENTLY is the defect being fixed, not
 *    a fix — so the additive `committedFigure` block names both figures and
 *    says they disagree, and the `commitments` array still lists the row.
 *
 * 3. THE INVITATION ID DID NOT MOVE. `lpCommitInvitationId` replaced an inline
 *    template in the commit route. If it produced a different string, every
 *    already-written ledger entry would become unfindable and every LP would
 *    read as `commitmentUnconfirmed`. Pinned against the literal old expression.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerSpvLegacyAdapterRoutes } from "../spvLegacyAdapters";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { lpCommitInvitationId } from "../lib/lpIdentity";

/* WAVE 226 · R202 — wave 211 made an operator attestation MANDATORY on the
   money-event routes this suite drives, so these requests were refused 400 and
   the proofs below never reached their own assertions. The fixture supplies what
   a real operator supplies, over the same HTTP route; it is NOT a bypass. Read
   the header of `_wave226_attestation_fixture.ts` before changing it. */
import { W226_LP_COMMIT_ATT } from "./_wave226_attestation_fixture";
const MANAGING = "u_avi_managing";
let app: express.Express;

function post(p: string, body?: unknown) {
  return request(app).post(p).set("x-user-id", MANAGING).send(body ?? {});
}
function patch(p: string, body?: unknown) {
  return request(app).patch(p).set("x-user-id", MANAGING).send(body ?? {});
}
function get(p: string) {
  return request(app).get(p).set("x-user-id", MANAGING);
}

async function newSpv(name: string): Promise<string> {
  const c = await post("/api/partner/me/spv", {
    name,
    jurisdiction: "delaware",
    carryBasis: "whole_spv",
    status: "open",
    signoffLegalName: "Avi Managing",
    signoffAccepted: true,
  });
  expect(c.status).toBe(201);
  return c.body.spv.id as string;
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerSpvLegacyAdapterRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("W112 — the legacy /detail contract is preserved, not reshaped", () => {
  it("keeps all six reconciliation keys, in order, as decimal strings", async () => {
    const spvId = await newSpv("W112 Shape");
    const d = await get(`/api/partner/me/spvs/${spvId}/detail`);
    expect(d.status).toBe(200);
    expect(Object.keys(d.body.reconciliation)).toEqual([
      "committedMinor",
      "calledMinor",
      "distributedMinor",
      "uncalledMinor",
      "netInvestedMinor",
      "totalBasisMinor",
    ]);
    for (const v of Object.values(d.body.reconciliation)) {
      expect(typeof v).toBe("string");
      expect(String(v)).toMatch(/^-?\d+$/);
    }
    /* And the pre-existing top-level keys are all still there. */
    for (const k of ["spv", "positions", "commitments", "capitalCalls", "distributions"]) {
      expect(d.body).toHaveProperty(k);
    }
  });

  it("uncalledMinor stays consistent with the committedMinor in the SAME response", async () => {
    const spvId = await newSpv("W112 Shape Consistency");
    await post(`/api/partner/me/spv/${spvId}/lp-commit`, {
      ...W226_LP_COMMIT_ATT, /* WAVE 226 · R202 — see the fixture note */
      holderFirstName: "Nia",
      holderLastName: "Fernandes",
      investorEmail: "w112-shape@example.com",
      amount: "40000",
      shares: "4000",
    });
    const d = await get(`/api/partner/me/spvs/${spvId}/detail`);
    const r = d.body.reconciliation;
    /* committed - called === uncalled, computed off the reported figures. */
    expect(BigInt(r.uncalledMinor)).toBe(BigInt(r.committedMinor) - BigInt(r.calledMinor));
    expect(BigInt(r.netInvestedMinor)).toBe(BigInt(r.calledMinor) - BigInt(r.distributedMinor));
    expect(BigInt(r.committedMinor)).toBe(BigInt(4000000));
  });
});

describe("W112 — a legacy-register-only commitment is DISCLOSED, not dropped", () => {
  it("names both figures and reports that they disagree", async () => {
    const spvId = await newSpv("W112 Disclosure");
    /* The legacy family's own write path: create, then advance to `signed`,
       which is what reconcileSpv counts. No engine subscription is created. */
    const add = await post(`/api/partner/me/spvs/${spvId}/commitments`, {
      lp_user_id: "u_lp_w112_legacy_only",
      amount_minor: 3300000,
      currency: "USD",
    });
    expect(add.status).toBe(201);
    const cid = add.body.commitment.id as string;
    const sign = await patch(`/api/partner/me/spvs/${spvId}/commitments/${cid}`, { status: "signed" });
    expect(sign.status).toBe(200);

    const d = await get(`/api/partner/me/spvs/${spvId}/detail`);
    expect(d.status).toBe(200);

    /* The canonical figure is zero: no money gate in the engine would honour
       this row, and the reported committed figure now says so. */
    expect(d.body.reconciliation.committedMinor).toBe("0");
    /* But it is VISIBLE. The disclosure names the legacy register's own figure
       and flags the disagreement, so this is not a silent drop. */
    expect(d.body.committedFigure).toEqual({
      source: "engine_committed_subscriptions",
      canonicalMinor: "0",
      legacyRegisterMinor: "3300000",
      agrees: false,
    });
    /* And the row itself is still listed, exactly as before. */
    expect((d.body.commitments as Array<{ id: string }>).some((c) => c.id === cid)).toBe(true);
  });

  it("reports agreement when the two registers do agree", async () => {
    const spvId = await newSpv("W112 Disclosure Agrees");
    /* subscribe() shadow-writes the legacy register as `signed` AND the
       projection moves the engine subscription to `committed`, so both
       registers land on the same figure. */
    const sub = spvEngineStore.subscribe(
      "ac_consortium_partner_test_partner_inc",
      spvId,
      { investorId: "u_lp_w112_agree", commitmentMinor: 2200000 },
    );
    spvEngineStore.projectLpCommitted("ac_consortium_partner_test_partner_inc", spvId, {
      investorId: sub.investorId,
      commitmentMinor: 2200000,
    });
    const d = await get(`/api/partner/me/spvs/${spvId}/detail`);
    expect(d.body.committedFigure.agrees).toBe(true);
    expect(d.body.committedFigure.canonicalMinor).toBe("2200000");
    expect(d.body.committedFigure.legacyRegisterMinor).toBe("2200000");
    expect(d.body.reconciliation.committedMinor).toBe("2200000");
  });
});

describe("W112 — the shared invitation id reproduces the inline derivation exactly", () => {
  it("matches the literal template the commit route used before this wave", () => {
    const spvId = "spv_abc123";
    const email = "Ozan@Capavate.com";
    /* The pre-wave expression, verbatim: the route lower-cased and trimmed the
       email into `investorEmail` and then hashed THAT. */
    const investorEmail = email.trim().toLowerCase();
    const stableKey = createHash("sha256").update(investorEmail, "utf8").digest("hex").slice(0, 16);
    expect(lpCommitInvitationId(spvId, email)).toBe(`spvlp_${spvId}_${stableKey}`);
    /* Same normal form on both sides, so a differently-cased re-commit finds the
       same ledger entry rather than seating a second holder. */
    expect(lpCommitInvitationId(spvId, "  OZAN@capavate.COM ")).toBe(lpCommitInvitationId(spvId, email));
  });

  it("refuses an unusable input rather than hashing the empty string", () => {
    expect(lpCommitInvitationId("spv_abc123", "")).toBe("");
    expect(lpCommitInvitationId("", "a@b.co")).toBe("");
    expect(lpCommitInvitationId(null, undefined)).toBe("");
  });
});

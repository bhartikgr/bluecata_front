/**
 * WAVE 150 — fund creation requires the SAME recorded legal sign-off as an SPV,
 * and managing partner ONLY (R111 Q11, owner: "Yes.").
 *
 * VERIFIED PRE-STATE (comment-stripped, this working tree):
 *   server/partnerRoutes.ts:1812  POST /api/partner/me/spvs
 *                          :1814  assertSubRole("managing_partner")
 *                          :1842  400 SIGNOFF_LEGAL_NAME_REQUIRED
 *                          :1843  400 SIGNOFF_ATTESTATION_REQUIRED
 *                          :1846  recordSignoff({ spvId: "" }) BEFORE createSpv
 *                          :1856  500 SIGNOFF_PERSIST_FAILED (fail-closed)
 *                          :1879  linkSignoffToSpv(id, spv.id)
 *   server/partnerRoutes.ts:1976  POST /api/partner/me/funds
 *                          :1978  assertSubRole("managing_partner","associate")  ← removed
 *                          (no attestation gate anywhere in the handler)         ← added
 *
 * The sign-off row lands in `spv_launch_signoffs` (migration
 * 0108_1c_spv_launch_signoffs.sql, bootstrapped server/db/connection.ts:1327).
 * Verified DDL: NO CHECK constraint on any subject kind and
 * `spv_id TEXT NOT NULL DEFAULT ''`, so a fund row fits the existing table and
 * NO migration is required by this wave.
 *
 * ANTI-VACUITY: every refusal pin also asserts that NOTHING was created (read
 * back out of the canonical engine, never echoed from the response), the
 * attestation pin compares the PERSISTED bytes against the shared constant the
 * client renders (not a literal retyped here), and both poles of the role rule
 * are asserted (associate refused / managing partner accepted).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox, partnerTeamStore, TEST_PARTNER_ID } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { storeCredential } from "../userCredentialsStore";
import { listSignoffsForSpv } from "../spvLaunchSignoffStore";
import { ATTESTATION_TEXT_V1, ATTESTATION_VERSION } from "@shared/spvAttestation";

const MANAGING = "u_avi_managing";
const ASSOCIATE = "u_w150_associate";
const PARTNER_A = TEST_PARTNER_ID;

let app: express.Express;
function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send((body ?? {}) as object);
}

/** A complete, valid fund body EXCEPT for the sign-off fields. */
function fundBody(name: string, extra: Record<string, unknown> = {}) {
  return {
    fundName: name,
    fundType: "closed_end",
    jurisdiction: "Delaware",
    vintage: 2026,
    currency: "USD",
    status: "raising",
    targetSizeMinor: 1234567,
    ...extra,
  };
}

function fundsNamed(name: string) {
  return spvEngineStore.listByPartner(PARTNER_A).filter((s) => s.name === name);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });
  // The sandbox seeds only managing_partner + viewer; an associate is required
  // to assert the removed-access pole. `requirePartnerAuth` resolves identity
  // through `getUserContext`, so a durable credential is registered too (same
  // pattern as server/__tests__/groupF1_partner_crm_parity.test.ts:84-89).
  partnerTeamStore.add(PARTNER_A, ASSOCIATE, "associate", "u_system_seed", { isSeed: true });
  storeCredential({
    userId: ASSOCIATE,
    email: "w150.associate@test-partner.example",
    name: "Cy Associate",
    password: "test-password-w150",
  });
  spvEngineStore._resetForTest();
});

describe("W150 — a fund cannot be created without the recorded attestation", () => {
  it("refuses with SIGNOFF_ATTESTATION_REQUIRED and creates nothing", async () => {
    const name = "W150 Unattested Fund";
    const r = await post("/api/partner/me/funds", MANAGING, fundBody(name, { signoffLegalName: "Ada Managing Partner" }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SIGNOFF_ATTESTATION_REQUIRED");
    expect(fundsNamed(name)).toHaveLength(0);
  });

  it("refuses with SIGNOFF_LEGAL_NAME_REQUIRED when the typed name is blank", async () => {
    const name = "W150 Unnamed Signer Fund";
    const r = await post(
      "/api/partner/me/funds",
      MANAGING,
      fundBody(name, { signoffLegalName: "   ", signoffAccepted: true }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SIGNOFF_LEGAL_NAME_REQUIRED");
    expect(fundsNamed(name)).toHaveLength(0);
  });

  it("refuses a non-boolean-true acceptance (same contract as the SPV path)", async () => {
    const name = "W150 Stringly Accepted Fund";
    const r = await post(
      "/api/partner/me/funds",
      MANAGING,
      fundBody(name, { signoffLegalName: "Ada Managing Partner", signoffAccepted: "true" }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("SIGNOFF_ATTESTATION_REQUIRED");
    expect(fundsNamed(name)).toHaveLength(0);
  });
});

describe("W150 — the recorded attestation is the text the user was shown", () => {
  it("persists ATTESTATION_TEXT_V1 byte-for-byte and links it to the created fund", async () => {
    const name = "W150 Attested Fund I";
    const r = await post(
      "/api/partner/me/funds",
      MANAGING,
      fundBody(name, { signoffLegalName: "Ada Managing Partner", signoffAccepted: true }),
    );
    expect(r.status).toBe(201);
    const fundId = r.body.fund.id as string;

    // read back from the canonical engine, not echoed from the response
    const canonical = spvEngineStore.getSpv(PARTNER_A, fundId);
    expect(canonical).not.toBeNull();
    expect(canonical!.spvType).toBe("fund");

    const signoffs = listSignoffsForSpv(PARTNER_A, fundId);
    expect(signoffs).toHaveLength(1);
    const s = signoffs[0];
    // BYTE-IDENTICAL to the one shared constant the client renders
    // (client/src/pages/partner/PartnerFunds.tsx imports the same symbol).
    expect(s.attestationText).toBe(ATTESTATION_TEXT_V1);
    expect(s.attestationText.length).toBe(ATTESTATION_TEXT_V1.length);
    expect(s.attestationVersion).toBe(ATTESTATION_VERSION);
    expect(s.signerLegalName).toBe("Ada Managing Partner");
    expect(s.userId).toBe(MANAGING);
    expect(s.partnerId).toBe(PARTNER_A);
    expect(typeof s.signedAt).toBe("string");
    expect(Number.isFinite(Date.parse(s.signedAt))).toBe(true);
    // opposite pole: the sign-off is not a constant blob — a different signer
    // name is recorded differently.
    const r2 = await post(
      "/api/partner/me/funds",
      MANAGING,
      fundBody("W150 Attested Fund II", { signoffLegalName: "Bo Second Partner", signoffAccepted: true }),
    );
    expect(r2.status).toBe(201);
    expect(listSignoffsForSpv(PARTNER_A, r2.body.fund.id as string)[0].signerLegalName).toBe("Bo Second Partner");
  });

  it("the sign-off exists for EVERY fund — no fund is left unauthorised", async () => {
    const funds = spvEngineStore.listByPartner(PARTNER_A).filter((s) => s.spvType === "fund");
    expect(funds.length).toBeGreaterThan(0);
    for (const f of funds) {
      expect(listSignoffsForSpv(PARTNER_A, f.id).length).toBeGreaterThan(0);
    }
  });
});

describe("W150 — fund creation is managing-partner only (deliberate access removal)", () => {
  it("an associate is refused even with a complete, attested body", async () => {
    const name = "W150 Associate Fund";
    const r = await post(
      "/api/partner/me/funds",
      ASSOCIATE,
      fundBody(name, { signoffLegalName: "Cy Associate", signoffAccepted: true }),
    );
    expect(r.status).toBe(403);
    expect(String(r.body.error)).toBe("PARTNER_SUB_ROLE_INSUFFICIENT");
    expect(fundsNamed(name)).toHaveLength(0);
  });

  it("opposite pole: the SAME body from a managing partner is accepted", async () => {
    const name = "W150 Managing Partner Fund";
    const r = await post(
      "/api/partner/me/funds",
      MANAGING,
      fundBody(name, { signoffLegalName: "Cy Associate", signoffAccepted: true }),
    );
    expect(r.status).toBe(201);
    expect(fundsNamed(name)).toHaveLength(1);
  });
});

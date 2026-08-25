/**
 * REVIEW H (adversarial review artifact) — replay the EXACT payload the shipped
 * client constructs (captured by
 * client/src/pages/partner/__tests__/reviewH_client_payload_capture.test.tsx into
 * reviewH_scratch/captured_payloads.json) against the REAL express route, and
 * require 201 plus a real round-trip of the money figure.
 *
 * Nothing here is hardcoded from the wave docs: the body comes off disk.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { listSignoffsForSpv } from "../spvLaunchSignoffStore";
import { ATTESTATION_TEXT_V1 } from "@shared/spvAttestation";

const REPO_ROOT = path.resolve(__dirname, "../..");
const CAPTURED = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "reviewH_scratch/captured_payloads.json"), "utf8"),
) as {
  spv: { url: string; body: Record<string, unknown> };
  fund: { url: string; body: Record<string, unknown> };
};

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;
function post(url: string, user: string, body: unknown) {
  return request(app).post(url).set("x-user-id", user).send(body as object);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("REVIEW H — end to end with the client's real payload", () => {
  it("anti-vacuity: the captured bodies are the client's, not this test's", () => {
    expect(CAPTURED.spv.url).toBe("/api/partner/me/spvs");
    expect(CAPTURED.fund.url).toBe("/api/partner/me/funds");
    // $5,000,000 typed by a human => 500000000 true minor units, no float damage
    expect(CAPTURED.spv.body.targetSizeMinor).toBe(500000000);
    expect(CAPTURED.fund.body.targetSizeMinor).toBe(500000000);
  });

  it("POST /api/partner/me/spvs returns 201 with the client's exact body", async () => {
    const r = await post(CAPTURED.spv.url, MANAGING, CAPTURED.spv.body);
    if (r.status !== 201) console.error("SPV FAILED", r.status, JSON.stringify(r.body));
    expect(r.status).toBe(201);
    const id = r.body.spv.id as string;
    const canonical = spvEngineStore.getSpv(PARTNER_A, id)!;
    expect(canonical.targetRaiseMinor).toBe(500000000);
    expect(canonical.currency).toBe("USD");
    // the vintage the partner saw survives into terms
    expect((canonical.terms as Record<string, unknown>).vintage).toBe(CAPTURED.spv.body.vintage);
    // sign-off recorded, linked, and carrying the SHARED attestation bytes
    const signoffs = listSignoffsForSpv(PARTNER_A, id);
    expect(signoffs.length).toBe(1);
    expect(signoffs[0].attestationText).toBe(ATTESTATION_TEXT_V1);
    expect(signoffs[0].signerLegalName).toBe(CAPTURED.spv.body.signoffLegalName);
  });

  it("POST /api/partner/me/funds returns 201 with the client's exact body", async () => {
    const r = await post(CAPTURED.fund.url, MANAGING, CAPTURED.fund.body);
    if (r.status !== 201) console.error("FUND FAILED", r.status, JSON.stringify(r.body));
    expect(r.status).toBe(201);
    const id = r.body.fund.id as string;
    const canonical = spvEngineStore.getSpv(PARTNER_A, id)!;
    expect(canonical.targetRaiseMinor).toBe(500000000);
    expect(canonical.spvType).toBe("fund");
    expect((canonical.terms as Record<string, unknown>).fundType).toBe("closed_end");
    expect((canonical.terms as Record<string, unknown>).vintage).toBe(CAPTURED.fund.body.vintage);
  });

  it("the sign-off gate is still HARD-REQUIRED and fail-closed BEFORE creation", async () => {
    const before = spvEngineStore.listByPartner(PARTNER_A).length;
    const noName = await post(CAPTURED.spv.url, MANAGING, {
      ...CAPTURED.spv.body,
      spvName: "RH no name",
      signoffLegalName: "   ",
    });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe("SIGNOFF_LEGAL_NAME_REQUIRED");
    const noAccept = await post(CAPTURED.spv.url, MANAGING, {
      ...CAPTURED.spv.body,
      spvName: "RH no accept",
      signoffAccepted: "true",
    });
    expect(noAccept.status).toBe(400);
    expect(noAccept.body.error).toBe("SIGNOFF_ATTESTATION_REQUIRED");
    // nothing was created by either refusal
    expect(spvEngineStore.listByPartner(PARTNER_A).length).toBe(before);
    expect(
      spvEngineStore.listByPartner(PARTNER_A).some((s) => s.name === "RH no name" || s.name === "RH no accept"),
    ).toBe(false);
  });
});

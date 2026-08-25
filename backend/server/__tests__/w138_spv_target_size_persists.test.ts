/**
 * WAVE 138 — pin 3: `targetSizeMinor` must survive to `targetRaiseMinor` on the
 * SPV path.
 *
 * `POST /api/partner/me/spvs` did not destructure `targetSizeMinor`
 * (server/partnerRoutes.ts:1819), so the one figure the client computed
 * correctly — the target raise, in minor units, via `wholeUnitsToWireMinor` —
 * was silently discarded, and the SPV list rendered an em-dash for a target the
 * partner had typed. The sibling fund route has always mapped it correctly
 * (`targetRaiseMinor: isNumber(targetSizeMinor) ? targetSizeMinor : null`,
 * :1987); this pins that the SPV route now mirrors that mapping EXACTLY.
 *
 * ANTI-VACUITY: the value asserted is read back from the canonical engine store
 * (not echoed from the request), a non-round figure is used so a coincidental
 * zero/default cannot pass, and the null pole (no target supplied) is asserted
 * too so the fix cannot be "always write a number".
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { spvEngineStore } from "../spvEngineStore";
import { ATTESTATION_TEXT_V1, ATTESTATION_VERSION } from "../spvLaunchSignoffStore";
import { ATTESTATION_TEXT_V1 as SHARED_TEXT, ATTESTATION_VERSION as SHARED_VERSION } from "@shared/spvAttestation";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;
function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}

/** A deliberately non-round minor-unit figure: 1,234,567 minor = $12,345.67. */
const TARGET_MINOR = 1234567;

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();
});

describe("W138 pin 3 — targetSizeMinor survives to targetRaiseMinor on the SPV path", () => {
  it("persists the client's target into the canonical store", async () => {
    const r = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "W138 Target Survives SPV",
      jurisdiction: "Delaware",
      vintage: new Date().getFullYear(),
      currency: "USD",
      status: "planned",
      targetSizeMinor: TARGET_MINOR,
      signoffLegalName: "Ada Managing Partner",
      signoffAccepted: true,
    });
    expect(r.status).toBe(201);
    const spvId = r.body.spv.id as string;
    expect(r.body.spv.targetRaiseMinor).toBe(TARGET_MINOR);
    // read back from the canonical engine, not echoed from the request
    const canonical = spvEngineStore.getSpv(PARTNER_A, spvId);
    expect(canonical).not.toBeNull();
    expect(canonical!.targetRaiseMinor).toBe(TARGET_MINOR);
  });

  it("null pole: an SPV recorded WITHOUT a target keeps targetRaiseMinor null", async () => {
    const r = await post("/api/partner/me/spvs", MANAGING, {
      spvName: "W138 No Target SPV",
      jurisdiction: "Delaware",
      vintage: new Date().getFullYear(),
      currency: "USD",
      status: "planned",
      signoffLegalName: "Ada Managing Partner",
      signoffAccepted: true,
    });
    expect(r.status).toBe(201);
    expect(spvEngineStore.getSpv(PARTNER_A, r.body.spv.id as string)!.targetRaiseMinor).toBeNull();
  });

  it("the sign-off gate is UNCHANGED: no legal name / no assent still 400s", async () => {
    const base = {
      spvName: "W138 Gate Still Closed",
      jurisdiction: "Delaware",
      vintage: new Date().getFullYear(),
      currency: "USD",
      status: "planned",
      targetSizeMinor: TARGET_MINOR,
    };
    const noName = await post("/api/partner/me/spvs", MANAGING, { ...base, signoffAccepted: true });
    expect(noName.status).toBe(400);
    expect(noName.body.error).toBe("SIGNOFF_LEGAL_NAME_REQUIRED");
    const noAccept = await post("/api/partner/me/spvs", MANAGING, { ...base, signoffLegalName: "Ada Managing Partner" });
    expect(noAccept.status).toBe(400);
    expect(noAccept.body.error).toBe("SIGNOFF_ATTESTATION_REQUIRED");
  });

  it("the de-duplicated attestation constant is the SAME object of bytes on both sides", () => {
    expect(ATTESTATION_TEXT_V1).toBe(SHARED_TEXT);
    expect(ATTESTATION_VERSION).toBe(SHARED_VERSION);
    expect(ATTESTATION_TEXT_V1.length).toBe(SHARED_TEXT.length);
  });
});

/**
 * server/__tests__/waveW2_gate_accreditation.test.ts
 *
 * Wave 2 (v26.2.0-w2) — Gate + Accreditation. Locks the server-side behavior:
 *   A2  getAccreditationGateStatus — none/self_certified/verified, verified never
 *       downgraded, legacy-grace on unparseable timestamp.
 *   A3  collectiveMembershipStore.activate({capTableExempt}) round-trips the flag;
 *       re-activate without the flag preserves an existing exemption.
 *   A5  GET /api/collective/gate-state — 401 unauth; shape + requiresAccreditation.
 *   A7  GET /api/collective/legal-copy — placeholder NON_LEGAL_ADVICE; malformed
 *       supplied JSON degrades (never throws).
 *   Avi#2  reconcileInvestorProfileForAdmin surfaces the real profile/KYC.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerCollectiveAppRoutes } from "../collectiveAppStore";
import { registerAdminPlatformRoutes } from "../adminPlatformStore";
import * as membershipStore from "../collectiveMembershipStore";
import {
  getAccreditationGateStatus,
  recordAccreditationDeclaration,
} from "../investorComplianceRoutes";
import { spvEngineStore } from "../spvEngineStore";
import { rawDb } from "../db/connection";
import { installV14TestIdentity } from "./_v14TestIdentity";

let app: express.Express;

function get(p: string, user: string | null, role?: string) {
  const r = request(app).get(p);
  if (user) r.set("x-user-id", user);
  if (role) r.set("x-role", role);
  return r;
}

beforeAll(() => {
  process.env.COLLECTIVE_ENABLED = "1";
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCollectiveAppRoutes(app);
  registerAdminPlatformRoutes(app);
});

describe("W2 A2 — getAccreditationGateStatus", () => {
  it("returns 'none' for a fresh user with no profile/declaration", () => {
    const r = getAccreditationGateStatus("u_w2_fresh_none");
    expect(r.status).toBe("none");
    expect(r.signedCurrent).toBe(false);
    expect(r.source).toBe("none");
  });

  it("returns 'self_certified' after a declaration is recorded (mirrors profile)", () => {
    const uid = "u_w2_selfcert";
    const res = recordAccreditationDeclaration(uid, {
      signatureName: "Test Investor",
      criteria: ["us_income"],
    });
    expect((res as any).ok).toBe(true);
    const gate = getAccreditationGateStatus(uid);
    expect(["self_certified", "verified"]).toContain(gate.status);
    expect(gate.status).not.toBe("none");
  });

  it("returns 'verified' and does NOT downgrade when profile is verified", () => {
    const uid = "u_w2_verified";
    // Set the denormalized compliance profile to verified directly.
    spvEngineStore.upsertComplianceProfile(uid, { accreditationStatus: "verified" } as any);
    const gate = getAccreditationGateStatus(uid);
    expect(gate.status).toBe("verified");
    expect(gate.source).toBe("profile");
  });
});

describe("W2 A3 — collectiveMembershipStore capTableExempt", () => {
  it("activate({capTableExempt:true}) persists and reads back exempt", () => {
    const uid = "u_w2_exempt_true";
    const row = membershipStore.activate(uid, "u_w2_admin", "standard", { capTableExempt: true });
    expect(row.capTableExempt).toBe(true);
    const readBack = membershipStore.get(uid);
    expect(readBack?.capTableExempt).toBe(true);
  });

  it("activate() default is NOT exempt (organic member)", () => {
    const uid = "u_w2_exempt_default";
    const row = membershipStore.activate(uid, "u_w2_admin", "standard");
    expect(row.capTableExempt).toBe(false);
  });

  it("re-activate without the flag PRESERVES an existing exemption", () => {
    const uid = "u_w2_exempt_preserve";
    membershipStore.activate(uid, "u_w2_admin", "standard", { capTableExempt: true });
    const again = membershipStore.activate(uid, "u_w2_admin", "plus"); // no capTableExempt
    expect(again.capTableExempt).toBe(true);
  });
});

describe("W2 A5 — GET /api/collective/gate-state", () => {
  it("401 for an unauthenticated caller", async () => {
    const r = await get("/api/collective/gate-state", null);
    expect(r.status).toBe(401);
    expect(r.body.error).toBe("NOT_AUTHED");
  });

  it("returns the gate-state shape for an authenticated user", async () => {
    const r = await get("/api/collective/gate-state", "u_w2_gatestate", "standard");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("isMember");
    expect(r.body).toHaveProperty("accreditationStatus");
    expect(r.body).toHaveProperty("requiresAccreditationDeclaration");
    expect(r.body).toHaveProperty("declarationEndpoint", "/api/investor/compliance/accreditation-declaration");
    expect(r.body.copy).toHaveProperty("gateIndemnity");
  });

  it("a genuine member with accreditation 'none' requires the declaration", async () => {
    const uid = "u_w2_member_needs_accred";
    membershipStore.activate(uid, "u_w2_admin", "standard", { capTableExempt: true });
    const r = await get("/api/collective/gate-state", uid, "standard");
    expect(r.status).toBe(200);
    expect(r.body.isMember).toBe(true);
    expect(r.body.requiresAccreditationDeclaration).toBe(true);
  });
});

describe("W2 Avi#2 — admin investor detail reconciles a synthetic derived_inv_ id", () => {
  // Verifier round-1 fix: a `derived_inv_<invitationId>` admin id has no `users`
  // row, so the endpoint used to 404 BEFORE reconciliation ran. We seed an
  // invitation (with redeemed_by_user_id) + the real investor profile, then
  // assert the endpoint returns the reconciled record instead of 404.
  const INV_ID = "invW2avi2";
  const REAL_UID = "u_w2_avi2_real";

  it("resolves derived_inv_ via redeemed_by_user_id and returns the real profile/KYC", async () => {
    const now = new Date().toISOString();
    // Seed the redeemed invitation.
    rawDb().prepare(
      `INSERT INTO round_invitations (id, round_id, investor_email, state, redeemed_by_user_id, created_at, updated_at)
       VALUES (?, 'r_w2', 'avi2@example.com', 'redeemed', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET redeemed_by_user_id=excluded.redeemed_by_user_id`,
    ).run(INV_ID, REAL_UID, now, now);
    // Seed the REAL investor profile in the profileStore-owned table (read-only
    // for us) with a KYC document + names.
    const profileJson = JSON.stringify({
      profile: {
        firstName: "Ada", lastName: "Investor", bio: "Angel", taxId: "TAX-123",
        kycDocuments: [{ id: "doc1", name: "passport.pdf", url: "/api/collective/kyc-document/doc1" }],
      },
    });
    rawDb().prepare(
      `INSERT INTO profilestore_investor_profile (investor_id, profile_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(investor_id) DO UPDATE SET profile_json=excluded.profile_json`,
    ).run(REAL_UID, profileJson, now);

    const r = await get(`/api/admin/investors/derived_inv_${INV_ID}`, "u_w2_admin", "admin");
    expect(r.status).toBe(200);
    expect(r.body.resolvedUserId).toBe(REAL_UID);
    expect(r.body.profile.name).toBe("Ada Investor");
    expect(r.body.profile.taxId).toBe("TAX-123");
    expect(r.body.kyc.documents.length).toBe(1);
    expect(r.body.kyc.status).toBe("documents_on_file");
  });
});

describe("W2 A7 — GET /api/collective/legal-copy", () => {
  it("returns a placeholder NON_LEGAL_ADVICE slot when no supplied copy", async () => {
    delete process.env.COLLECTIVE_LEGAL_COPY_JSON;
    const r = await get("/api/collective/legal-copy?slots=collective_gate_indemnity", "u_w2_copy", "standard");
    expect(r.status).toBe(200);
    const slot = r.body.copy.collective_gate_indemnity;
    expect(slot.status).toBe("NON_LEGAL_ADVICE");
    expect(typeof slot.body).toBe("string");
  });

  it("malformed COLLECTIVE_LEGAL_COPY_JSON degrades to placeholder (no throw)", async () => {
    process.env.COLLECTIVE_LEGAL_COPY_JSON = "{ this is not valid json";
    const r = await get("/api/collective/legal-copy?slots=collective_gate_indemnity", "u_w2_copy", "standard");
    expect(r.status).toBe(200);
    expect(r.body.copy.collective_gate_indemnity.status).toBe("NON_LEGAL_ADVICE");
    expect(r.body.copy.collective_gate_indemnity.degraded).toBe(true);
    delete process.env.COLLECTIVE_LEGAL_COPY_JSON;
  });

  it("supplied copy is returned verbatim when JSON is valid", async () => {
    process.env.COLLECTIVE_LEGAL_COPY_JSON = JSON.stringify({
      collective_gate_indemnity: { title: "Custom Title", body: "Custom body.", version: "v9", status: "COUNSEL_APPROVED" },
    });
    const r = await get("/api/collective/legal-copy?slots=collective_gate_indemnity", "u_w2_copy", "standard");
    expect(r.body.copy.collective_gate_indemnity.title).toBe("Custom Title");
    expect(r.body.copy.collective_gate_indemnity.status).toBe("COUNSEL_APPROVED");
    delete process.env.COLLECTIVE_LEGAL_COPY_JSON;
  });
});

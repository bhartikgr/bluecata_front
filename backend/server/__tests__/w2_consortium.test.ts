/**
 * W2 — Consortium Partner wave: behavior tests on REAL Express routes + the
 * non-sacred stores/middleware the wave introduced. Everything here exercises
 * the actual code paths (supertest against registered routers, or the shared
 * store/resolver functions directly), never a mock of them.
 *
 * Coverage (one describe per brief acceptance bullet):
 *   W2-A  Restored partner CRM read endpoints (auth + cross-partner isolation).
 *   W2-I  requireSignedAgreement WRITE gate: unsigned → 403 AGREEMENT_NOT_SIGNED,
 *         signed → allowed, READS stay open.
 *   W2-I  Application sign-off persists signature + version + timestamp + hash.
 *   W2-H  Partner lp-roster GET now requires partner auth (unauth → 401).
 *   W2-F  Fee > raise guard (FEES_EXCEED_RAISE) fails closed.
 *   W2-G  Display-name resolver never returns a raw "u_..." id (unit + on the
 *         real lp-roster route).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { CONSORTIUM_AGREEMENT_VERSION } from "@shared/consortiumAgreement";

import { registerPartnerRoutes } from "../partnerRoutes";
import { registerSpvEngineRoutes } from "../spvEngineRoutes";
import { registerPartnerSelfServiceRoutes } from "../lib/partnerSelfServiceRoutes";
import { registerPartnerClientCrmRoutes } from "../partnerClientCrmRoutes";
import { registerSpvFundRoutes } from "../spvFundStore";
import { registerPartnerConsortiumRoutes } from "../partnerConsortiumRoutes";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { spvEngineStore } from "../spvEngineStore";
import { submitApplication } from "../consortiumApplyStore";
import { resolveDisplayName } from "../lib/displayNameResolver";
import { PARTNER_CLIENT_STAGES } from "../../shared/crmStages";
import { rawDb } from "../db/connection";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const PARTNER_B = "ac_consortium_partner_w2_iso_b";

const CO_ATTRIBUTED = "co_w2_attributed_alpha";
const CO_OTHER_PARTNER = "co_w2_partner_b_bravo";

let app: express.Express;

/** W2-I — the gate reads the DURABLE contacts column via rawDb(), NOT the
 *  in-memory sandbox shim requirePartnerAuth uses. So we drive the signed state
 *  by writing that exact row directly. */
// Wave A-1 v2 (Gemini review): use the canonical CONSORTIUM_AGREEMENT_VERSION
// so this helper doesn't rot when the version bumps (was hardcoded to the
// CPA-v0.1-DRAFT placeholder; W-V44 FIX F bumped it to CPA-v1.0).
function signPartner(partnerId: string, version = CONSORTIUM_AGREEMENT_VERSION): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO contacts
         (id, kind, legal_name, status, verification, created_at, updated_at,
          created_by, updated_by, version, prev_revision_hash, revision_hash,
          partner_agreement_version, partner_agreement_signed_at)
       VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?, 'u_test', 'u_test',
               1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         partner_agreement_version = excluded.partner_agreement_version,
         partner_agreement_signed_at = excluded.partner_agreement_signed_at`,
    )
    .run(partnerId, "W2 Gate Partner", now, now, "0".repeat(64), "0".repeat(64), version, now);
}

function unsignPartner(partnerId: string): void {
  // No row (or a row with a NULL signed_at) is the fail-closed "unsigned" state.
  rawDb().prepare(`DELETE FROM contacts WHERE id = ?`).run(partnerId);
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvEngineRoutes(app);
  registerPartnerSelfServiceRoutes(app);
  registerPartnerClientCrmRoutes(app);
  registerSpvFundRoutes(app);
  registerPartnerConsortiumRoutes(app);
  seedTestPartnerSandbox({ force: true });
  spvEngineStore._resetForTest();

  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "W2 ISOLATION B",
    displayName: "ISO B",
    email: "w2-iso-b@test.example",
    region: "US",
    regionCode: "US",
    tier: "catalyst",
    partnerType: "angel_network",
  });

  partnerAttributionStore.create(PARTNER_A, CO_ATTRIBUTED, MANAGING);
  partnerAttributionStore.create(PARTNER_B, CO_OTHER_PARTNER, MANAGING);
});

describe("W2-A — restored partner CRM read endpoints", () => {
  it("GET /api/partner/me/clients lists the partner's attributed clients", async () => {
    const r = await request(app).get("/api/partner/me/clients").set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.clients)).toBe(true);
    expect(r.body.clients.some((c: any) => c.companyId === CO_ATTRIBUTED)).toBe(true);
    // Partner B's client never leaks into Partner A's list.
    expect(r.body.clients.some((c: any) => c.companyId === CO_OTHER_PARTNER)).toBe(false);
  });

  it("GET /api/partner/me/clients requires partner auth (unauth → 401/403)", async () => {
    const r = await request(app).get("/api/partner/me/clients");
    expect([401, 403]).toContain(r.status);
  });

  it("GET /api/partner/me/clients/:id 404s for a company attributed to ANOTHER partner (no leak)", async () => {
    const r = await request(app)
      .get(`/api/partner/me/clients/${CO_OTHER_PARTNER}`)
      .set("x-user-id", MANAGING);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/NOT_FOUND_OR_NOT_ATTRIBUTED/);
  });
});

describe("W2-I — requireSignedAgreement WRITE gate", () => {
  it("unsigned partner is BLOCKED on a write route → 403 AGREEMENT_NOT_SIGNED", async () => {
    unsignPartner(PARTNER_A);
    const r = await request(app)
      .post("/api/partner/me/notes")
      .set("x-user-id", MANAGING)
      .send({ title: "unsigned attempt", body: "should be blocked" });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("AGREEMENT_NOT_SIGNED");
    expect(r.body.redirect).toBe("/collective/partner/agreement");
  });

  it("READS stay open for an unsigned partner (gate is write-only)", async () => {
    unsignPartner(PARTNER_A);
    const r = await request(app).get("/api/partner/me/notes").set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.notes)).toBe(true);
  });

  it("once the durable signature exists, the SAME write route succeeds → 201", async () => {
    signPartner(PARTNER_A);
    const r = await request(app)
      .post("/api/partner/me/notes")
      .set("x-user-id", MANAGING)
      .send({ title: "signed note", body: "now allowed" });
    expect(r.status).toBe(201);
    expect(r.body.note.id).toMatch(/^pnote_/);
    unsignPartner(PARTNER_A); // leave the shared state clean for later suites
  });
});

/* W2-I OVERRIDE — the gate must cover EVERY partner write module, not just the
 * two originally wired (partnerRoutes / spvEngineRoutes). One representative
 * write per newly-gated module proves: UNSIGNED → 403 AGREEMENT_NOT_SIGNED, and
 * SIGNED → the request clears the gate (money-movement writes assert past-gate;
 * where a full success is reachable we assert it). The sign/agreement routes
 * MUST stay reachable while unsigned (otherwise a partner can never sign). */
describe("W2-I OVERRIDE — sign gate on every partner write module", () => {
  /** An existing partner row with a NULL signed_at = authenticated but UNSIGNED
   *  (fail-closed), yet reachable by the sign route so a partner CAN sign. */
  function seedUnsignedPartnerRow(partnerId: string): void {
    const now = new Date().toISOString();
    rawDb()
      .prepare(
        `INSERT INTO contacts
           (id, kind, legal_name, status, verification, created_at, updated_at,
            created_by, updated_by, version, prev_revision_hash, revision_hash,
            partner_agreement_version, partner_agreement_signed_at)
         VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?, 'u_test', 'u_test',
                 1, ?, ?, NULL, NULL)
         ON CONFLICT(id) DO UPDATE SET partner_agreement_signed_at = NULL`,
      )
      .run(partnerId, "W2 Unsigned Partner", now, now, "0".repeat(64), "0".repeat(64));
  }

  it("CRM stage PATCH — unsigned → 403, signed → 200", async () => {
    unsignPartner(PARTNER_A);
    const blocked = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_ATTRIBUTED}`)
      .set("x-user-id", MANAGING)
      .send({ stage: PARTNER_CLIENT_STAGES[1] });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("AGREEMENT_NOT_SIGNED");

    signPartner(PARTNER_A);
    const ok = await request(app)
      .patch(`/api/partner/me/client-crm/${CO_ATTRIBUTED}`)
      .set("x-user-id", MANAGING)
      .send({ stage: PARTNER_CLIENT_STAGES[1] });
    expect(ok.status).toBe(200);
    expect(ok.body.stage).toBe(PARTNER_CLIENT_STAGES[1]);
    unsignPartner(PARTNER_A);
  });

  it("SPV fund capital-call — unsigned → 403, signed → clears the gate", async () => {
    unsignPartner(PARTNER_A);
    const blocked = await request(app)
      .post("/api/partner/me/spvs/spv_w2_gate/capital-calls")
      .set("x-user-id", MANAGING)
      .send({ amount_minor: 100000, called_at: new Date().toISOString() });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("AGREEMENT_NOT_SIGNED");

    signPartner(PARTNER_A);
    const past = await request(app)
      .post("/api/partner/me/spvs/spv_w2_gate/capital-calls")
      .set("x-user-id", MANAGING)
      .send({ amount_minor: 100000, called_at: new Date().toISOString() });
    expect(past.body.error).not.toBe("AGREEMENT_NOT_SIGNED"); // past the sign gate
    unsignPartner(PARTNER_A);
  });

  it("SPV fund distribution — unsigned → 403, signed → clears the gate", async () => {
    unsignPartner(PARTNER_A);
    const blocked = await request(app)
      .post("/api/partner/me/spvs/spv_w2_gate/distributions")
      .set("x-user-id", MANAGING)
      .send({ distribution_type: "dividend", total_minor: 100000, distributed_at: new Date().toISOString() });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("AGREEMENT_NOT_SIGNED");

    signPartner(PARTNER_A);
    const past = await request(app)
      .post("/api/partner/me/spvs/spv_w2_gate/distributions")
      .set("x-user-id", MANAGING)
      .send({ distribution_type: "dividend", total_minor: 100000, distributed_at: new Date().toISOString() });
    expect(past.body.error).not.toBe("AGREEMENT_NOT_SIGNED"); // past the sign gate
    unsignPartner(PARTNER_A);
  });

  it("consortium sourcing write — unsigned → 403, signed → clears the gate", async () => {
    unsignPartner(PARTNER_A);
    const blocked = await request(app)
      .post("/api/partner/me/sourced-investors")
      .set("x-user-id", MANAGING)
      .send({ investorName: "W2 Gate LP", amountMinor: 100000 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("AGREEMENT_NOT_SIGNED");

    signPartner(PARTNER_A);
    const past = await request(app)
      .post("/api/partner/me/sourced-investors")
      .set("x-user-id", MANAGING)
      .send({ investorName: "W2 Gate LP", amountMinor: 100000 });
    expect(past.body.error).not.toBe("AGREEMENT_NOT_SIGNED"); // past the sign gate
    unsignPartner(PARTNER_A);
  });

  it("tax-form write — unsigned → 403, signed → ok", async () => {
    unsignPartner(PARTNER_A);
    const blocked = await request(app)
      .post("/api/partner/me/tax-form")
      .set("x-user-id", MANAGING)
      .send({ formType: "W-9", jurisdiction: "US", taxId: "12-3456789" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("AGREEMENT_NOT_SIGNED");

    signPartner(PARTNER_A);
    const ok = await request(app)
      .post("/api/partner/me/tax-form")
      .set("x-user-id", MANAGING)
      .send({ formType: "W-9", jurisdiction: "US", taxId: "12-3456789" });
    expect(ok.body.error).not.toBe("AGREEMENT_NOT_SIGNED"); // past the sign gate
    unsignPartner(PARTNER_A);
  });

  it("ALLOWLIST — the sign route + agreement GET stay reachable while UNSIGNED", async () => {
    seedUnsignedPartnerRow(PARTNER_A);

    // GET terms is never gated (needed to read the agreement before signing).
    const view = await request(app).get("/api/partner/me/agreement").set("x-user-id", MANAGING);
    expect(view.status).toBe(200);
    expect(view.body.signedCurrent).toBe(false);

    // POST sign is never gated — an unsigned partner MUST be able to sign.
    const sign = await request(app)
      .post("/api/partner/me/agreement")
      .set("x-user-id", MANAGING)
      .send({ signatureName: "Avi Managing" });
    expect(sign.status).toBe(200);
    expect(sign.body.ok).toBe(true);
    expect(sign.body.error).not.toBe("AGREEMENT_NOT_SIGNED");

    unsignPartner(PARTNER_A);
  });
});

describe("W2-I — application sign-off persistence", () => {
  const baseInput = {
    organizationName: "Sign-Off Capital",
    contactName: "Dana Signer",
    contactEmail: "dana@signoff.test",
    jurisdiction: "Canada",
    partnerType: "vc",
    aumRange: "10-50M",
    portfolioCompanyCount: 5,
    expectedChapter: "chap_keiretsu_canada",
    introMessage: "Seed-stage SaaS track record.",
    sourceIp: "10.9.9.9",
  };

  it("a typed signature persists name + version + timestamp + integrity hash on the chained row", () => {
    const row = submitApplication({
      ...baseInput,
      agreementSignedName: "Dana Signer",
      agreementVersion: "CPA-v0.1-DRAFT",
    } as any);
    expect(row.agreementSignedName).toBe("Dana Signer");
    expect(row.agreementVersion).toBe("CPA-v0.1-DRAFT");
    expect(row.agreementSignedAt).toBeTruthy();
    expect(row.agreementSignatureHash).toMatch(/^[a-f0-9]{64}$/);
    // The row's own hash chain is still intact alongside the sign-off fields.
    expect(row.currHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("no signature → sign-off fields are null (fail-open apply, gate enforces at first write)", () => {
    const row = submitApplication({
      ...baseInput,
      contactEmail: "unsigned@signoff.test",
    } as any);
    expect(row.agreementSignedName).toBeNull();
    expect(row.agreementSignedAt).toBeNull();
    expect(row.agreementSignatureHash).toBeNull();
    expect(row.currHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("W2-H — partner lp-roster GET requires partner auth", () => {
  it("unauthenticated request to the partner lp-roster is refused (401)", async () => {
    const r = await request(app).get("/api/partner/me/spv/spv_anything/lp-roster");
    expect([401, 403]).toContain(r.status);
  });
});

describe("W2-F — fee > raise guard (fail-closed)", () => {
  it("a fixed fee exceeding the SPV target raise throws FEES_EXCEED_RAISE", () => {
    const spv = spvEngineStore.createSpv(
      PARTNER_A,
      { name: "Tiny Raise SPV", jurisdiction: "delaware", carryBasis: "whole_spv", targetRaiseMinor: 3000 },
      MANAGING,
    );
    expect(() =>
      spvEngineStore.addFee(
        PARTNER_A,
        spv.id,
        { layer: "management", feeType: "fixed", fixedAmountMinor: 3300 },
        MANAGING,
      ),
    ).toThrow(/FEES_EXCEED_RAISE/);
  });

  it("a fixed fee within the target raise is accepted", () => {
    const spv = spvEngineStore.createSpv(
      PARTNER_A,
      { name: "Ok Raise SPV", jurisdiction: "delaware", carryBasis: "whole_spv", targetRaiseMinor: 100000 },
      MANAGING,
    );
    const fee = spvEngineStore.addFee(
      PARTNER_A,
      spv.id,
      { layer: "management", feeType: "fixed", fixedAmountMinor: 5000 },
      MANAGING,
    );
    expect(fee.fixedAmountMinor).toBe(5000);
  });
});

describe("W2-G — display-name resolver never returns a raw \"u_...\" id", () => {
  it("humanises synthetic invite ids instead of surfacing the raw id", () => {
    const r = resolveDisplayName("u_redeemed_1700000000000");
    expect(r.name).toBe("Invited member");
    expect(r.name).not.toMatch(/^u_/);
    expect(r.resolved).toBe(false);
  });

  it("humanises the public applicant id", () => {
    expect(resolveDisplayName("u_public").name).toBe("Public applicant");
  });

  it("an unknown raw user id falls back to a placeholder, never the raw id", () => {
    const r = resolveDisplayName("u_no_such_user_xyz");
    expect(r.name).toBe("Pending member");
    expect(r.name).not.toContain("u_no_such_user_xyz");
  });

  it("on the REAL lp-roster route, a subscriber with a synthetic id renders a humanised name (never raw)", async () => {
    const spv = spvEngineStore.createSpv(
      PARTNER_A,
      { name: "Roster Name SPV", jurisdiction: "delaware", carryBasis: "whole_spv" },
      MANAGING,
    );
    spvEngineStore.subscribe(PARTNER_A, spv.id, { investorId: "u_redeemed_9999", commitmentMinor: 100000 }, MANAGING);
    const r = await request(app)
      .get(`/api/partner/me/spv/${spv.id}/lp-roster`)
      .set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    const sub = r.body.subscribers.find((s: any) => s.investorId === "u_redeemed_9999");
    expect(sub).toBeTruthy();
    expect(sub.name).not.toMatch(/^u_/);
    expect(sub.name).toBe("Invited member");
  });
});

/* W2-I — login-time agreement redirect (Ozan decision). The client shell reads
 * GET /api/partner/me/agreement on partner-shell load and bounces an unsigned
 * managing partner to the sign page BEFORE the workspace. The write-gate remains
 * the fail-closed backstop. These assert the exact signal the client redirects
 * on: a managing partner who has NOT signed the current version is flagged
 * (signedCurrent=false, canSign=true → redirect); once signed they are not. */
describe("W2-I — login-time agreement redirect signal", () => {
  it("an UNSIGNED managing partner is flagged for redirect (signedCurrent=false, canSign=true)", async () => {
    unsignPartner(PARTNER_A);
    const r = await request(app).get("/api/partner/me/agreement").set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.signedCurrent).toBe(false);
    expect(r.body.canSign).toBe(true); // managing partner → the client would redirect
  });

  it("a SIGNED managing partner is NOT flagged for redirect (signedCurrent=true)", async () => {
    signPartner(PARTNER_A);
    const r = await request(app).get("/api/partner/me/agreement").set("x-user-id", MANAGING);
    expect(r.status).toBe(200);
    expect(r.body.signedCurrent).toBe(true); // current-version signature on record → no redirect
    unsignPartner(PARTNER_A); // leave shared state clean
  });
});

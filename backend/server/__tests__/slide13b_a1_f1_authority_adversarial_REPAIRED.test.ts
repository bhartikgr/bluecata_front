import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const smtp = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: smtp.sendMail }) } }));

import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerTeamInviteRedeemRoutes } from "../lib/teamInviteRedeem";
import { registerFounderTeamRoutes } from "../lib/founderTeamStore";
import { seedTestPartnerSandbox, partnerTeamStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { rawDb } from "../db/connection";
import { _testTransport } from "../emailTransport";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as statement } from "../../shared/wave214ThirdPartyAuthorityCopy";

const app = express();
app.use(express.json());

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const ACTOR_A = "u_avi_managing";

const PARTNER_B = "ac_consortium_partner_reviewer_bravo_inc";
const ACTOR_B = "u_maya_chen";

const base = "/api/partner/me/portfolio-companies";
const invitePath = (companyId: string) => `${base}/${companyId}/founder-invitation`;
const authority = { authorityTypedName: "Test Partner", authorityStatementShown: statement };

type RequestBody = Record<string, unknown> | string | undefined;
function post(url: string, body: RequestBody, user = ACTOR_A) {
  return request(app).post(url).set("x-user-id", user).send(body as never);
}
function get(url: string, user = ACTOR_A) {
  return request(app).get(url).set("x-user-id", user);
}
function createCompany(founderEmail = `victim_${Math.random().toString(16).slice(2)}@example.com`, partner = ACTOR_A) {
  return post(base, { companyName: "A1 Review Co", founderEmail, founderName: "Real Founder", ...authority }, partner);
}
const invitationRow = (id: string): any =>
  rawDb().prepare("SELECT * FROM founder_team_invitations WHERE id = ?").get(id);
const ownerRows = (companyId: string): any[] =>
  rawDb()
    .prepare("SELECT id, invited_email, status, accepted_at FROM founder_team_invitations WHERE company_id = ? AND role = 'owner' ORDER BY created_at, id")
    .all(companyId);

function signAgreement(partnerId: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO contacts (id, kind, legal_name, status, verification, created_at, updated_at,
         created_by, updated_by, version, prev_revision_hash, revision_hash,
         partner_agreement_version, partner_agreement_signed_at)
       VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?, 'u_system_seed', 'u_system_seed',
               1, ?, ?, 'CPA-v0.1-DRAFT', ?)
       ON CONFLICT(id) DO UPDATE SET partner_agreement_signed_at = excluded.partner_agreement_signed_at,
         partner_agreement_version = excluded.partner_agreement_version`,
    )
    .run(partnerId, `${partnerId} legal`, now, now, "0".repeat(64), "0".repeat(64), now);
}

beforeAll(() => {
  seedTestPartnerSandbox({ force: true });
  signAgreement(PARTNER_A);
  _registerSeedPartner({
    id: PARTNER_B, legalName: "REVIEWER BRAVO, INC", displayName: "REVIEWER BRAVO",
    email: "ops@bravo.example", region: "US", regionCode: "US", tier: "builder",
    partnerType: "accelerator",
  });
  partnerTeamStore.add(PARTNER_B, ACTOR_B, "managing_partner", "u_system_seed", { isSeed: true });
  signAgreement(PARTNER_B);
  
  registerPartnerPortfolioCompanyRoutes(app);
  registerPartnerRoutes(app);
  registerFounderTeamRoutes(app);
});

beforeEach(() => {
  process.env.SMTP_MODE = "dry_run";
  process.env.APP_URL = "https://app.example.test";
  _testTransport.reset();
  smtp.sendMail.mockReset().mockResolvedValue({ messageId: "smtp-message" });
});

describe("slide13b A1-F1 Authority Adversarial (Repaired)", () => {
  it("A1-F1 Fix: a foreign partner self-grants the relationship with a pipeline row but is still REJECTED (404) for recovery", async () => {
    const created = await createCompany("real.founder@example.com", ACTOR_A);
    const companyId = created.body.companyId;
    const victimInvite = created.body.founderInvite;
    const originalHash = invitationRow(victimInvite.id).token_hash;
    const originalInvCount = ownerRows(companyId).length;

    // Attacker (Partner B) claims it via pipeline
    const claimed = await post("/api/partner/me/pipeline", { dealName: "Borrowed deal", companyId, stage: "invited" }, ACTOR_B);
    expect(claimed.status).toBe(201);
    rawDb().exec(`CREATE TABLE IF NOT EXISTS kv_partnerPipeline (id TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);`);
    rawDb().prepare("INSERT OR REPLACE INTO kv_partnerPipeline (id, payload_json, updated_at, deleted_at) VALUES (?,?,?,NULL)")
      .run(claimed.body.deal.id, JSON.stringify(claimed.body.deal), new Date().toISOString());

    // 1. EXACT 404 NEGATIVE (Status GET)
    const probe = await get(invitePath(companyId), ACTOR_B);
    expect(probe.status).toBe(404);
    expect(probe.body).not.toHaveProperty("founderInvite");
    expect(probe.body).not.toHaveProperty("email");

    // 2. EXACT 404 NEGATIVE (Reissue POST)
    const capture = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: victimInvite.id, 
      founderEmail: "attacker@bravo.example", founderName: "Attacker",
      ...authority, authorityTypedName: "Reviewer Bravo",
    }, ACTOR_B);
    
    expect(capture.status).toBe(404);
    
    // Unchanged hash and inv count
    const rows = ownerRows(companyId);
    expect(rows.length).toBe(originalInvCount);
    const currentLive = rows.find(r => r.status === "pending");
    expect(currentLive.invited_email).toBe("real.founder@example.com");
    expect(invitationRow(currentLive.id).token_hash).toBe(originalHash);
  });

  it("Creator historical positive (NOVA old recovery): exactly 200 GET + 201 reissue, explicit DB/mail update", async () => {
    _testTransport.forceMode("smtp");
    const created = await createCompany("nova.victim@example.com", ACTOR_A);
    const companyId = created.body.companyId;
    const victimInvite = created.body.founderInvite;
    const originalHash = invitationRow(victimInvite.id).token_hash;

    // Manually mutate the origin audit row to the "legacy" format: tenant_id = tenant_co_${companyId.slice(3)}
    const actualTenant = `tenant_co_${companyId}`;
    const legacyTenant = `tenant_co_${companyId.slice(3)}`;
    rawDb().prepare("UPDATE audit_log SET tenant_id = ? WHERE tenant_id = ? AND action = 'company.created'").run(legacyTenant, actualTenant);

    // 1. EXACT 200 POSITIVE (Status GET)
    const probe = await get(invitePath(companyId), ACTOR_A);
    expect(probe.status).toBe(200);
    expect(probe.body.invitation.email).toBe("nova.victim@example.com");

    // 2. EXACT 201 POSITIVE (Reissue POST)
    const capture = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: victimInvite.id, 
      founderEmail: "nova.corrected@example.com", founderName: "Nova Corrected",
      ...authority, authorityTypedName: "Test Partner",
    }, ACTOR_A);
    
    expect(capture.status).toBe(201);
    expect(capture.body.founderInvite.email).toBe("nova.corrected@example.com");

    // Explicit DB changed assertion
    const currentLive = ownerRows(companyId).find(r => r.status === "pending");
    expect(currentLive.invited_email).toBe("nova.corrected@example.com");
    expect(invitationRow(currentLive.id).token_hash).not.toBe(originalHash); // hash must change

    // Mail spy assertion
    expect(smtp.sendMail).toHaveBeenCalled();
  });
});

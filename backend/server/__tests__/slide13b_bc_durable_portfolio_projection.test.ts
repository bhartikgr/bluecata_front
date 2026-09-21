import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import {
  partnerAttributionStore,
  partnerTeamStore,
  seedTestPartnerSandbox,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import { __setRuntimePersona } from "../lib/userContext";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT } from "../../shared/wave214ThirdPartyAuthorityCopy";

const COMPANY_ID = "bc_db_only_portfolio_company";
const ATTRIBUTION_ID = "bc_db_only_portfolio_attribution";
const OTHER_PARTNER_ID = "bc_db_only_foreign_partner";
const OTHER_USER_ID = "u_bc_db_only_foreign_partner";
const FOUNDER_USER_ID = "u_bc_db_only_founder";
const FOUNDER_EMAIL = "private-founder@db-only.example";
let app: express.Express;
const createdCompanyIds: string[] = [];

function stampSignedAgreement(partnerId: string, legalName: string): void {
  const now = new Date().toISOString();
  rawDb().prepare(`
    INSERT INTO contacts
      (id, kind, legal_name, status, verification, created_at, updated_at,
       created_by, updated_by, version, prev_revision_hash, revision_hash,
       partner_agreement_version, partner_agreement_signed_at)
    VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?,
            'u_system_seed', 'u_system_seed', 1, ?, ?, 'CPA-v0.1-DRAFT', ?)
    ON CONFLICT(id) DO UPDATE SET
      partner_agreement_version = excluded.partner_agreement_version,
      partner_agreement_signed_at = excluded.partner_agreement_signed_at
  `).run(partnerId, legalName, now, now, "0".repeat(64), "0".repeat(64), now);
}

beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(process.env.SMTP_MODE).toBe("dry_run");
  const db = rawDb();
  expect(db.prepare("PRAGMA database_list").all().every((row: any) => !row.file)).toBe(true);
  db.exec(`CREATE TABLE IF NOT EXISTS founder_team_invitations (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, invited_by_user_id TEXT NOT NULL,
    invited_email TEXT NOT NULL, invited_name TEXT, role TEXT NOT NULL, status TEXT NOT NULL,
    token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
    accepted_at TEXT, deleted_at TEXT, sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS founder_team_members (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL,
    role TEXT NOT NULL, joined_at TEXT NOT NULL, removed_at TEXT
  );`);

  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerPortfolioCompanyRoutes(app);
  seedTestPartnerSandbox({ force: true });
  stampSignedAgreement(TEST_PARTNER_ID, "Test Partner LLC");
  _registerSeedPartner({
    id: OTHER_PARTNER_ID,
    legalName: "Foreign Partner LLC",
    displayName: "Foreign Partner",
    email: "foreign-db-only@test.local",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });
  partnerTeamStore.add(
    OTHER_PARTNER_ID,
    OTHER_USER_ID,
    "managing_partner",
    "u_system_seed",
    { isSeed: true },
  );
  stampSignedAgreement(OTHER_PARTNER_ID, "Foreign Partner LLC");
  __setRuntimePersona({
    userId: OTHER_USER_ID,
    email: "foreign-db-only@test.local",
    name: "Foreign DB-only Partner",
    isFounder: false,
    isInvestor: false,
    isAdmin: false,
    hasInvitations: false,
  });

  db.prepare(`INSERT INTO companies (id, tenant_id, name, legal_name, sector)
              VALUES (?, ?, ?, ?, ?)`)
    .run(COMPANY_ID, "tenant_bc_db_only", "DB-only Relationship Co", "DB-only Relationship Co Ltd", "Infrastructure");
  db.prepare(`INSERT INTO users (id, tenant_id, email, name, role)
              VALUES (?, ?, ?, ?, 'founder')`)
    .run(FOUNDER_USER_ID, "tenant_bc_founder_identity", FOUNDER_EMAIL, "Private Founder");
  db.prepare(`INSERT INTO company_members
    (id, company_id, user_id, role, tenant_id, is_active)
    VALUES (?, ?, ?, 'founder', ?, 1)`)
    .run("cm_bc_db_only_founder", COMPANY_ID, FOUNDER_USER_ID, "tenant_bc_db_only");
  db.prepare(`INSERT INTO founder_team_members
    (id, company_id, user_id, email, role, joined_at)
    VALUES (?, ?, ?, ?, 'owner', ?)`)
    .run("ftm_bc_db_only_founder", COMPANY_ID, FOUNDER_USER_ID, FOUNDER_EMAIL, new Date().toISOString());
  db.prepare(`INSERT INTO founder_team_invitations
    (id, company_id, invited_by_user_id, invited_email, invited_name, role, status,
     token_hash, expires_at, created_at, accepted_at, sent_at)
    VALUES (?, ?, ?, ?, ?, 'owner', 'accepted', ?, ?, ?, ?, ?)`)
    .run(
      "fti_bc_db_only_founder",
      COMPANY_ID,
      TEST_PARTNER_USERS.managing.userId,
      FOUNDER_EMAIL,
      "Private Founder",
      "hash-not-projected",
      new Date(Date.now() + 86_400_000).toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
  // Deliberately bypass partnerAttributionStore: this simulates a relationship
  // committed by another process after this process hydrated its arrays.
  db.prepare(`INSERT INTO partner_attributions
    (id, partner_id, company_id, attributed_at, attribution_source, revoked_at, updated_at)
    VALUES (?, ?, ?, ?, 'partner_portfolio', NULL, ?)`)
    .run(ATTRIBUTION_ID, TEST_PARTNER_ID, COMPANY_ID, new Date().toISOString(), new Date().toISOString());
});

afterAll(() => {
  const db = rawDb();
  for (const companyId of createdCompanyIds) {
    db.prepare("DELETE FROM partner_attributions WHERE company_id = ?").run(companyId);
    db.prepare("DELETE FROM founder_team_invitations WHERE company_id = ?").run(companyId);
    db.prepare("DELETE FROM company_members WHERE company_id = ?").run(companyId);
    db.prepare("DELETE FROM companies WHERE id = ?").run(companyId);
  }
  db.prepare("DELETE FROM partner_portfolio_company WHERE company_id = ?").run(COMPANY_ID);
  db.prepare("DELETE FROM partner_attributions WHERE company_id = ?").run(COMPANY_ID);
  db.prepare("DELETE FROM founder_team_invitations WHERE company_id = ?").run(COMPANY_ID);
  db.prepare("DELETE FROM founder_team_members WHERE company_id = ?").run(COMPANY_ID);
  db.prepare("DELETE FROM company_members WHERE company_id = ?").run(COMPANY_ID);
  db.prepare("DELETE FROM companies WHERE id = ?").run(COMPANY_ID);
  db.prepare("DELETE FROM users WHERE id = ?").run(FOUNDER_USER_ID);
});

describe("slide13b B durable portfolio relationship projection", () => {
  it("allows one DB-only proof through list, detail and PATCH while denying a foreign partner", async () => {
    expect(partnerAttributionStore.listByPartner(TEST_PARTNER_ID)
      .some((row) => row.companyId === COMPANY_ID)).toBe(false);

    const list = await request(app)
      .get("/api/partner/me/portfolio")
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId);

    expect(list.status).toBe(200);
    const row = list.body.portfolio.find((item: { companyId: string }) => item.companyId === COMPANY_ID);
    expect(row).toMatchObject({
      companyId: COMPANY_ID,
      companyName: "DB-only Relationship Co",
      onboarding: {
        state: "registered",
        origin: "partner_portfolio",
        canViewFounderInvitation: false,
        registeredFounderCount: 1,
      },
    });
    expect(row.onboarding).not.toHaveProperty("ownerInvitation");
    expect(row.onboarding).not.toHaveProperty("registeredFounders");

    const detail = await request(app)
      .get(`/api/partner/me/portfolio/${COMPANY_ID}`)
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      companyId: COMPANY_ID,
      companyName: "DB-only Relationship Co",
      canViewFounderInvitation: false,
      onboarding: {
        state: "registered",
        origin: "partner_portfolio",
        canViewFounderInvitation: false,
        registeredFounderCount: 1,
      },
    });
    expect(detail.body).not.toHaveProperty("invitation");
    expect(detail.body.onboarding).not.toHaveProperty("ownerInvitation");
    expect(detail.body.onboarding).not.toHaveProperty("registeredFounders");
    expect(JSON.stringify(detail.body)).not.toContain(FOUNDER_EMAIL);
    expect(JSON.stringify(detail.body)).not.toContain("Private Founder");

    const invitationStatus = await request(app)
      .get(`/api/partner/me/portfolio-companies/${COMPANY_ID}/founder-invitation`)
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId);
    expect(invitationStatus.status).toBe(404);

    const patched = await request(app)
      .patch(`/api/partner/me/portfolio/${COMPANY_ID}`)
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId)
      .send({ legal: { legalEntityName: "DB-only Relationship Co Ltd" } });
    expect(patched.status).toBe(200);
    expect(patched.body.profile.legal.legalEntityName).toBe("DB-only Relationship Co Ltd");

    const pipelineCreate = await request(app)
      .post("/api/partner/me/pipeline")
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId)
      .send({ dealName: "Weak arbitrary pipeline relationship", companyId: COMPANY_ID });
    expect(pipelineCreate.status).toBe(201);
    const pipelineRead = await request(app)
      .get("/api/partner/me/pipeline")
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId);
    expect(pipelineRead.status).toBe(200);
    const pipelineRow = pipelineRead.body.pipeline.find(
      (item: { id: string }) => item.id === pipelineCreate.body.deal.id,
    );
    expect(pipelineRow.onboarding).toMatchObject({
      state: "registered",
      canViewFounderInvitation: false,
      registeredFounderCount: 1,
    });
    expect(pipelineRow.onboarding).not.toHaveProperty("ownerInvitation");
    expect(pipelineRow.onboarding).not.toHaveProperty("registeredFounders");
    expect(JSON.stringify(pipelineRow)).not.toContain(FOUNDER_EMAIL);

    // The DB-only visibility proof above is complete. Replace it through the
    // normal store solely so the legacy Clients cache can exercise its response
    // serializer without relying on a duplicate-row fallback.
    rawDb().prepare("DELETE FROM partner_attributions WHERE id = ?").run(ATTRIBUTION_ID);
    partnerAttributionStore.create(
      TEST_PARTNER_ID,
      COMPANY_ID,
      TEST_PARTNER_USERS.managing.userId,
      "partner_portfolio",
    );
    const clientsRead = await request(app)
      .get("/api/partner/me/clients")
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId);
    expect(clientsRead.status).toBe(200);
    const clientRow = clientsRead.body.clients.find(
      (item: { companyId: string }) => item.companyId === COMPANY_ID,
    );
    expect(clientRow.onboarding).toMatchObject({
      state: "registered",
      canViewFounderInvitation: false,
      registeredFounderCount: 1,
    });
    expect(clientRow.onboarding).not.toHaveProperty("ownerInvitation");
    expect(clientRow.onboarding).not.toHaveProperty("registeredFounders");
    expect(JSON.stringify(clientRow)).not.toContain(FOUNDER_EMAIL);

    const foreignList = await request(app)
      .get("/api/partner/me/portfolio")
      .set("x-user-id", OTHER_USER_ID);
    expect(foreignList.status).toBe(200);
    expect(foreignList.body.portfolio.some(
      (item: { companyId: string }) => item.companyId === COMPANY_ID,
    )).toBe(false);

    const foreignDetail = await request(app)
      .get(`/api/partner/me/portfolio/${COMPANY_ID}`)
      .set("x-user-id", OTHER_USER_ID);
    expect(foreignDetail.status).toBe(404);

    const foreignInvitationStatus = await request(app)
      .get(`/api/partner/me/portfolio-companies/${COMPANY_ID}/founder-invitation`)
      .set("x-user-id", OTHER_USER_ID);
    expect(foreignInvitationStatus.status).toBe(404);

    const foreignPatch = await request(app)
      .patch(`/api/partner/me/portfolio/${COMPANY_ID}`)
      .set("x-user-id", OTHER_USER_ID)
      .send({ legal: { legalEntityName: "Must Not Save" } });
    expect(foreignPatch.status).toBe(404);

  });

  it("returns founder-invitation metadata only to the exact creator partner", async () => {
    const created = await request(app)
      .post("/api/partner/me/portfolio-companies")
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId)
      .send({
        companyName: "Strong Creator Authority Co",
        founderEmail: "creator-founder@example.test",
        founderName: "Creator Founder",
        sector: "Robotics",
        authorityTypedName: "Test Partner",
        authorityStatementShown: WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT,
      });
    expect(created.status).toBe(201);
    const companyId = String(created.body.companyId);
    createdCompanyIds.push(companyId);

    const list = await request(app)
      .get("/api/partner/me/portfolio")
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId);
    expect(list.status).toBe(200);
    const row = list.body.portfolio.find(
      (item: { companyId: string }) => item.companyId === companyId,
    );
    expect(row).toMatchObject({
      canViewFounderInvitation: true,
      onboarding: {
        state: "pending",
        canViewFounderInvitation: true,
        registeredFounderCount: 0,
        ownerInvitation: {
          email: "creator-founder@example.test",
          invitedName: "Creator Founder",
          status: "pending",
        },
        registeredFounders: [],
      },
    });

    const detail = await request(app)
      .get(`/api/partner/me/portfolio/${companyId}`)
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      canViewFounderInvitation: true,
      invitation: {
        email: "creator-founder@example.test",
        invitedName: "Creator Founder",
        status: "pending",
      },
      onboarding: { canViewFounderInvitation: true },
    });

    const status = await request(app)
      .get(`/api/partner/me/portfolio-companies/${companyId}/founder-invitation`)
      .set("x-user-id", TEST_PARTNER_USERS.managing.userId);
    expect(status.status).toBe(200);
    expect(status.body.invitation).toMatchObject({
      email: "creator-founder@example.test",
      name: "Creator Founder",
      status: "pending",
    });
  });
});

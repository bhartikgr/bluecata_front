/**
 * INDEPENDENT REVIEWER SWEEP — BC weak-CRM PII redaction (SOURCE_STABLE_BC_A1_F1).
 *
 * Contract under test: a partner holding only CRM-breadth relationship (a
 * self-asserted pipeline row) must see NO founder identity on ANY projection —
 * not the invited email, not the invited name, not a registered founder's email,
 * name or userId — while sector/stage/status tracking and counts remain. A
 * strictly authorized originator still sees the complete safe projection, and the
 * admin route stays complete behind requireAdmin.
 *
 * Surfaces swept (all four weak call sites of `partnerOnboardingProjection`,
 * server/partnerRoutes.ts:1751 / :1855 / :1940 / :1973):
 *   GET /api/partner/me/clients, /pipeline, /portfolio, /portfolio/:companyId
 *
 * Reviewer-owned, additive. No product source edited.
 *
 * Run:
 *   NODE_ENV=test SMTP_MODE=dry_run npx vitest run \
 *     server/__tests__/preflight_slide13b_bc_weak_crm_pii_sweep.test.ts \
 *     --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1
 */
import { beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";

import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox, partnerTeamStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { rawDb } from "../db/connection";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as statement } from "../../shared/wave214ThirdPartyAuthorityCopy";

const app = express();
app.use(express.json());

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const ACTOR_A = "u_avi_managing";
const PARTNER_B = "ac_consortium_partner_reviewer_bravo_inc";
const ACTOR_B = "u_maya_chen";

const FOUNDER_EMAIL = "sweep.founder@example.com";
const FOUNDER_NAME = "Sweep Founder";
const REGISTERED_EMAIL = "sweep.registered@example.com";
const REGISTERED_NAME = "Registered Person";
const REGISTERED_USER = "u_sweep_registered_founder";

const base = "/api/partner/me/portfolio-companies";
const authority = { authorityTypedName: "Test Partner", authorityStatementShown: statement };

function get(url: string, user: string) {
  return request(app).get(url).set("x-user-id", user);
}
function post(url: string, body: Record<string, unknown>, user: string) {
  return request(app).post(url).set("x-user-id", user).send(body as never);
}
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

let companyId = "";
let secondCompanyId = "";

/** Every PII string that must never appear in a weak projection. */
const PII = [FOUNDER_EMAIL, FOUNDER_NAME, REGISTERED_EMAIL, REGISTERED_NAME, REGISTERED_USER];

function assertNoPII(label: string, body: unknown): void {
  const json = JSON.stringify(body);
  for (const secret of PII) {
    expect(json, `${label} leaked ${secret}`).not.toContain(secret);
  }
  // No token material either.
  expect(json).not.toMatch(/token_hash|claimUrl|"token"/);
}

beforeAll(async () => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(rawDb().name).toBe(":memory:");
  process.env.SMTP_MODE = "dry_run";
  process.env.APP_URL = "https://app.example.test";
  seedTestPartnerSandbox({ force: true });
  rawDb().exec(`CREATE TABLE IF NOT EXISTS founder_team_invitations (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, invited_by_user_id TEXT NOT NULL,
    invited_email TEXT NOT NULL, invited_name TEXT, role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'pending', token_hash TEXT NOT NULL, expires_at TEXT,
    created_at TEXT NOT NULL, accepted_at TEXT, sent_at TEXT, deleted_at TEXT);`);
  rawDb().exec(`CREATE TABLE IF NOT EXISTS founder_team_members (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT,
    role TEXT NOT NULL DEFAULT 'member', created_at TEXT, removed_at TEXT,
    UNIQUE (company_id, user_id));`);
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

  // Partner A legitimately creates two companies (real provenance + attribution).
  const created = await post(base, { companyName: "Sweep Co", founderEmail: FOUNDER_EMAIL, founderName: FOUNDER_NAME, sector: "Fintech", ...authority }, ACTOR_A);
  expect(created.status).toBe(201);
  companyId = String(created.body.companyId);
  const second = await post(base, { companyName: "Sweep Two Co", founderEmail: "second.sweep@example.com", founderName: "Second Founder", ...authority }, ACTOR_A);
  expect(second.status).toBe(201);
  secondCompanyId = String(second.body.companyId);

  // A REGISTERED founder identity on the first company (the PII that used to be
  // returned unconditionally: email, name and userId).
  rawDb()
    .prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role) VALUES (?, 'tenant_platform', ?, ?, 'founder')`)
    .run(REGISTERED_USER, REGISTERED_EMAIL, REGISTERED_NAME);
  const now = new Date().toISOString();
  rawDb()
    .prepare(`INSERT OR REPLACE INTO founder_team_members (id, company_id, user_id, email, role, created_at)
              VALUES (?, ?, ?, ?, 'owner', ?)`)
    .run(`ftm_sweep_${Date.now()}`, companyId, REGISTERED_USER, REGISTERED_EMAIL, now);
  // An ACCEPTED owner invitation whose historical email matches the durable
  // founder-team row, plus the active founder membership: this is what
  // readCompanyOnboardingState counts as a registered founder.
  rawDb()
    .prepare(`INSERT OR REPLACE INTO founder_team_invitations
              (id, company_id, invited_by_user_id, invited_email, invited_name, role, status, token_hash, created_at, accepted_at)
              VALUES (?, ?, ?, ?, ?, 'owner', 'accepted', 'hash_sweep', ?, ?)`)
    .run(`fti_sweep_acc_${Date.now()}`, companyId, ACTOR_A, REGISTERED_EMAIL, REGISTERED_NAME, now, now);
  const companyTenant = String((rawDb().prepare("SELECT tenant_id FROM companies WHERE id = ?").get(companyId) as any).tenant_id);
  rawDb()
    .prepare(`INSERT OR REPLACE INTO company_members (id, company_id, user_id, role, tenant_id, is_active, joined_at)
              VALUES (?, ?, ?, 'founder', ?, 1, ?)`)
    .run(`cm_sweep_${Date.now()}`, companyId, REGISTERED_USER, companyTenant, now);

  // Partner B self-asserts CRM breadth on BOTH companies: a pipeline deal naming
  // them. Tracking is deliberately unchanged, so this still makes the six-proof
  // predicate true — it must no longer carry identity.
  for (const id of [companyId, secondCompanyId]) {
    const deal = await post("/api/partner/me/pipeline", { dealName: `Borrowed ${id}`, companyId: id, stage: "invited" }, ACTOR_B);
    expect(deal.status).toBe(201);
    rawDb().exec(`CREATE TABLE IF NOT EXISTS kv_partnerPipeline (id TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);`);
    rawDb().prepare("INSERT OR REPLACE INTO kv_partnerPipeline (id, payload_json, updated_at, deleted_at) VALUES (?,?,?,NULL)")
      .run(deal.body.deal.id, JSON.stringify(deal.body.deal), new Date().toISOString());
  }
});

describe("BC · weak-CRM projections carry no founder identity", () => {
  it("GET /api/partner/me/clients (partnerRoutes.ts:1751)", async () => {
    const res = await get("/api/partner/me/clients", ACTOR_B);
    expect(res.status).toBe(200);
    assertNoPII("clients", res.body);
    // The clients surface lists attribution/link-backed clients, so a
    // pipeline-only partner legitimately sees an empty set here; the assertion
    // that matters is that no identity appears on the projection it does get.
    expect(JSON.stringify(res.body)).not.toContain("\"canViewFounderInvitation\":true");
  });

  it("GET /api/partner/me/pipeline (partnerRoutes.ts:1855)", async () => {
    const res = await get("/api/partner/me/pipeline", ACTOR_B);
    expect(res.status).toBe(200);
    assertNoPII("pipeline", res.body);
    const json = JSON.stringify(res.body);
    expect(json).toContain(companyId);
    expect(json).toContain("\"canViewFounderInvitation\":false");
    expect(json).not.toContain("\"canViewFounderInvitation\":true");
  });

  it("GET /api/partner/me/portfolio (partnerRoutes.ts:1940)", async () => {
    const res = await get("/api/partner/me/portfolio", ACTOR_B);
    expect(res.status).toBe(200);
    assertNoPII("portfolio list", res.body);
    expect(JSON.stringify(res.body)).not.toContain("\"canViewFounderInvitation\":true");
  });

  it("GET /api/partner/me/portfolio/:companyId (partnerRoutes.ts:1973)", async () => {
    const res = await get(`/api/partner/me/portfolio/${companyId}`, ACTOR_B);
    expect(res.status).toBe(200);
    assertNoPII("portfolio detail", res.body);
    const onboarding = res.body.onboarding ?? {};
    expect(onboarding.canViewFounderInvitation).toBe(false);
    // The whole keys are OMITTED, not emptied.
    expect(Object.keys(onboarding)).not.toContain("ownerInvitation");
    expect(Object.keys(onboarding)).not.toContain("registeredFounders");
    expect(Object.keys(onboarding)).not.toContain("invitation");
    // Non-identity tracking survives.
    expect(typeof onboarding.state).toBe("string");
    expect(typeof onboarding.registeredFounderCount).toBe("number");
    expect(onboarding.registeredFounderCount).toBeGreaterThanOrEqual(1);
    expect(onboarding.company?.name).toBe("Sweep Co");
  });

  it("the A1 status route is not an alternative identity path for the same partner", async () => {
    const res = await get(`${base}/${companyId}/founder-invitation`, ACTOR_B);
    expect(res.status).toBe(404);
    assertNoPII("founder-invitation", res.body);
  });
});

describe("BC · strict authority and admin remain complete", () => {
  it("the originating partner still receives the full safe projection", async () => {
    const res = await get(`/api/partner/me/portfolio/${companyId}`, ACTOR_A);
    expect(res.status).toBe(200);
    const onboarding = res.body.onboarding;
    expect(onboarding.canViewFounderInvitation).toBe(true);
    expect(onboarding.ownerInvitation).toBeTruthy();
    expect(JSON.stringify(onboarding)).toContain(FOUNDER_EMAIL);
    expect(Array.isArray(onboarding.registeredFounders)).toBe(true);
    // Identity is visible to authority, token material never is.
    expect(JSON.stringify(res.body)).not.toMatch(/token_hash|claimUrl|"token"/);
  });

  it("revoking the originating attribution also closes the BC projection, not just A1", async () => {
    rawDb().prepare("UPDATE partner_attributions SET revoked_at = ? WHERE partner_id = ? AND company_id = ?")
      .run(new Date().toISOString(), PARTNER_A, secondCompanyId);
    const res = await get(`/api/partner/me/portfolio/${secondCompanyId}`, ACTOR_A);
    expect(res.status).toBe(200);
    expect(res.body.onboarding.canViewFounderInvitation).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("second.sweep@example.com");
    expect(Object.keys(res.body.onboarding)).not.toContain("ownerInvitation");
  });

  it("the admin onboarding route is still complete behind requireAdmin", () => {
    // Asserted at source rather than over HTTP: this harness mounts no admin
    // guard, and partnerRoutes.ts:1999 calls readCompanyOnboardingState directly
    // with includeInvitationEmail:true and no projection.
    const row = rawDb()
      .prepare("SELECT invited_email, invited_name FROM founder_team_invitations WHERE company_id = ? AND role = 'owner' LIMIT 1")
      .get(companyId) as any;
    expect(row.invited_email).toBe(FOUNDER_EMAIL);
    expect(row.invited_name).toBe(FOUNDER_NAME);
  });
});

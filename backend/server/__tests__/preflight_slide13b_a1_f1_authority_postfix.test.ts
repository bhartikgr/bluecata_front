/**
 * INDEPENDENT REVIEWER POST-FIX CONTROLS — A1-F1 founder-invitation authority
 * (SOURCE_STABLE_A1_F1, server/lib/founderInviteAuthority.ts).
 *
 * Mandatory controls requested by the parent:
 *   • foreign pipeline-only partner  -> 404 (in the converted case, sibling file)
 *   • creator-historical provenance  -> 200 read / 201 reissue, including the
 *     legacy resolver-alias tenant shape and NULL target_id
 *   • revoked / missing / wrong-source attribution -> 404
 *   • duplicate, conflicting, malformed, wrong-origin provenance -> 404
 *   • infrastructure failure -> 503, never 404
 *   • forward audit write lands in the ACTUAL canonical company tenant
 *
 * Reviewer-owned and additive. No product source edited. Every audit mutation
 * below is a FIXTURE on this process's isolated `:memory:` DB, standing in for a
 * historical row shape; no frozen historical row is rewritten.
 *
 * Run:
 *   NODE_ENV=test SMTP_MODE=dry_run npx vitest run \
 *     server/__tests__/preflight_slide13b_a1_f1_authority_postfix.test.ts \
 *     --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";

import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { registerPartnerRoutes } from "../partnerRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { rawDb } from "../db/connection";
import { hasFounderInvitationAuthority, FounderInviteAuthorityUnavailableError } from "../lib/founderInviteAuthority";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as statement } from "../../shared/wave214ThirdPartyAuthorityCopy";

const app = express();
app.use(express.json());

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const ACTOR_A = "u_avi_managing";
const base = "/api/partner/me/portfolio-companies";
const invitePath = (companyId: string) => `${base}/${companyId}/founder-invitation`;
const authority = { authorityTypedName: "Test Partner", authorityStatementShown: statement };

function post(url: string, body: Record<string, unknown>, user = ACTOR_A) {
  return request(app).post(url).set("x-user-id", user).send(body as never);
}
function get(url: string, user = ACTOR_A) {
  return request(app).get(url).set("x-user-id", user);
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

async function mintCompany(founderEmail: string) {
  const res = await post(base, { companyName: "F1 Control Co", founderEmail, founderName: "Real Founder", ...authority });
  expect(res.status).toBe(201);
  return { companyId: String(res.body.companyId), invite: res.body.founderInvite };
}
const provenance = (companyId: string): any =>
  rawDb()
    .prepare("SELECT id, tenant_id, target, target_id, payload_json, hash FROM audit_log WHERE action = 'company.created' AND target = ?")
    .get(`company:${companyId}`);
const companyTenant = (companyId: string): string =>
  String((rawDb().prepare("SELECT tenant_id FROM companies WHERE id = ?").get(companyId) as any).tenant_id);
const ownerRows = (companyId: string): any[] =>
  rawDb()
    .prepare("SELECT id, invited_email, status FROM founder_team_invitations WHERE company_id = ? AND role = 'owner' ORDER BY created_at, id")
    .all(companyId);

beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(rawDb().name).toBe(":memory:");
  seedTestPartnerSandbox({ force: true });
  // The founder-team tables are created by registerFounderTeamRoutes in the
  // running server; this harness registers only the partner routers, so the two
  // tables the status/onboarding read needs are created here (schema copied from
  // the product DDL, no product file edited).
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
  registerPartnerPortfolioCompanyRoutes(app);
  registerPartnerRoutes(app);
});

beforeEach(() => {
  process.env.SMTP_MODE = "dry_run";
  process.env.APP_URL = "https://app.example.test";
});

describe("A1-F1 · forward audit tenant (converted expectation)", () => {
  it("a newly created company files its provenance in the ACTUAL canonical company tenant", async () => {
    const { companyId } = await mintCompany("forward.tenant@example.com");
    const row = provenance(companyId);
    const payload = JSON.parse(row.payload_json);
    // Before the fix this row landed in the implicit resolver tenant
    // (`tenant_co_<id minus co_>`); the fix passes the live tenant explicitly.
    expect(row.tenant_id).toBe(companyTenant(companyId));
    expect(row.tenant_id).toBe(`tenant_co_${companyId}`);
    expect(row.tenant_id).not.toBe(`tenant_co_${companyId.slice(3)}`);
    expect(row.target).toBe(`company:${companyId}`);
    expect(payload.origin).toBe("partner_portfolio");
    expect(payload.createdByPartnerId).toBe(PARTNER_A);
    expect(String(row.hash)).not.toHaveLength(0);
    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(true);
  });
});

describe("A1-F1 · creator-historical positives", () => {
  it("provenance in the LEGACY resolver-alias tenant still authorises read and reissue", async () => {
    const { companyId, invite } = await mintCompany("legacy.founder@example.com");
    // Fixture: move the row to the pre-fix shape a real historical row has.
    rawDb().prepare("UPDATE audit_log SET tenant_id = ? WHERE id = ?")
      .run(`tenant_co_${companyId.slice(3)}`, provenance(companyId).id);
    expect(provenance(companyId).tenant_id).toBe(`tenant_co_${companyId.slice(3)}`);
    expect(companyTenant(companyId)).toBe(`tenant_co_${companyId}`);

    const read = await get(invitePath(companyId));
    expect(read.status).toBe(200);
    expect(read.body.invitation.email).toBe("legacy.founder@example.com");
    expect(read.body.canReissue).toBe(true);

    const fixed = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: invite.id, founderEmail: "legacy.fixed@example.com", founderName: "Fixed", ...authority,
    });
    expect(fixed.status).toBe(201);
    expect(ownerRows(companyId).find((r) => r.id === invite.id).status).toBe("revoked");
    expect(ownerRows(companyId).find((r) => r.status === "pending").invited_email).toBe("legacy.fixed@example.com");
    // The original provenance row is untouched by the recovery.
    expect(provenance(companyId).tenant_id).toBe(`tenant_co_${companyId.slice(3)}`);
  });

  it("a NULL target_id (pre-Wave-342 shape) still authorises", async () => {
    const { companyId } = await mintCompany("nulltarget@example.com");
    rawDb().prepare("UPDATE audit_log SET target_id = NULL WHERE id = ?").run(provenance(companyId).id);
    expect(provenance(companyId).target_id).toBeNull();
    const read = await get(invitePath(companyId));
    expect(read.status).toBe(200);
    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(true);
  });
});

describe("A1-F1 · attribution is a revocation guard", () => {
  it("revoking the originating attribution denies recovery even with intact provenance", async () => {
    const { companyId, invite } = await mintCompany("revoked.attr@example.com");
    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(true);
    rawDb().prepare("UPDATE partner_attributions SET revoked_at = ? WHERE partner_id = ? AND company_id = ?")
      .run(new Date().toISOString(), PARTNER_A, companyId);

    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(false);
    const read = await get(invitePath(companyId));
    expect(read.status).toBe(404);
    expect(read.body).toEqual({ error: "PORTFOLIO_COMPANY_NOT_FOUND" });
    const reissue = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: invite.id, founderEmail: "nope@example.com", founderName: "N", ...authority,
    });
    expect(reissue.status).toBe(404);
    expect(ownerRows(companyId)).toHaveLength(1);
    expect(ownerRows(companyId)[0].status).toBe("pending");
  });

  it("a non-portfolio attribution source (referral_code) is not the originating attribution", async () => {
    const { companyId } = await mintCompany("wrongsource@example.com");
    rawDb().prepare("UPDATE partner_attributions SET attribution_source = 'referral_code' WHERE partner_id = ? AND company_id = ?")
      .run(PARTNER_A, companyId);
    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(false);
    expect((await get(invitePath(companyId))).status).toBe(404);
  });

  it("deleting the attribution row denies recovery (provenance alone is never sole proof)", async () => {
    const { companyId } = await mintCompany("noattr@example.com");
    rawDb().prepare("DELETE FROM partner_attributions WHERE partner_id = ? AND company_id = ?").run(PARTNER_A, companyId);
    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(false);
    expect((await get(invitePath(companyId))).status).toBe(404);
  });
});

describe("A1-F1 · provenance must be exactly one clean row", () => {
  it("a duplicated/conflicting company.created row denies rather than picking a convenient one", async () => {
    const { companyId } = await mintCompany("dupe@example.com");
    const row = provenance(companyId);
    rawDb()
      .prepare(`INSERT INTO audit_log (id, tenant_id, actor_id, action, target, target_id, payload_json, prev_hash, hash, created_at)
                VALUES (?, ?, 'u_other', 'company.created', ?, ?, ?, ?, ?, ?)`)
      .run(
        `al_dupe_${Date.now()}`, row.tenant_id, row.target, companyId,
        JSON.stringify({ ...JSON.parse(row.payload_json), createdByPartnerId: "ac_consortium_partner_reviewer_bravo_inc" }),
        row.hash, `${String(row.hash).slice(0, 60)}dupe`, new Date().toISOString(),
      );
    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(false);
    expect((await get(invitePath(companyId))).status).toBe(404);
  });

  it("a malformed payload denies", async () => {
    const { companyId } = await mintCompany("malformed@example.com");
    rawDb().prepare("UPDATE audit_log SET payload_json = '{not json' WHERE id = ?").run(provenance(companyId).id);
    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(false);
    expect((await get(invitePath(companyId))).status).toBe(404);
  });

  it("a wrong origin, wrong payload companyId, empty hash or mismatched target_id each deny", async () => {
    const { companyId } = await mintCompany("fields@example.com");
    const id = provenance(companyId).id;
    const original = provenance(companyId);
    const variants: Array<[string, () => void]> = [
      ["origin", () => rawDb().prepare("UPDATE audit_log SET payload_json = ? WHERE id = ?")
        .run(JSON.stringify({ ...JSON.parse(original.payload_json), origin: "self_serve" }), id)],
      ["payload companyId", () => rawDb().prepare("UPDATE audit_log SET payload_json = ? WHERE id = ?")
        .run(JSON.stringify({ ...JSON.parse(original.payload_json), companyId: "co_ffffffffffff" }), id)],
      ["hash", () => rawDb().prepare("UPDATE audit_log SET hash = '' WHERE id = ?").run(id)],
      ["target_id", () => rawDb().prepare("UPDATE audit_log SET target_id = 'co_ffffffffffff' WHERE id = ?").run(id)],
      ["soft delete", () => rawDb().prepare("UPDATE audit_log SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), id)],
    ];
    for (const [label, mutate] of variants) {
      rawDb().prepare("UPDATE audit_log SET payload_json = ?, hash = ?, target_id = ?, deleted_at = NULL WHERE id = ?")
        .run(original.payload_json, original.hash, original.target_id, id);
      expect(hasFounderInvitationAuthority(PARTNER_A, companyId), `baseline before ${label}`).toBe(true);
      mutate();
      expect(hasFounderInvitationAuthority(PARTNER_A, companyId), label).toBe(false);
    }
  });

  it("a foreign partner id is never authorised by someone else's provenance", async () => {
    const { companyId } = await mintCompany("foreign@example.com");
    expect(hasFounderInvitationAuthority("ac_consortium_partner_reviewer_bravo_inc", companyId)).toBe(false);
    expect(hasFounderInvitationAuthority("", companyId)).toBe(false);
    expect(hasFounderInvitationAuthority(PARTNER_A, "co_ffffffffffff")).toBe(false);
  });
});

describe("A1-F1 · infrastructure failure is 503, not 404", () => {
  it("an unreadable attribution table raises the named unavailable error and the route answers 503", async () => {
    const { companyId } = await mintCompany("outage@example.com");
    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(true);
    rawDb().exec("ALTER TABLE partner_attributions RENAME TO partner_attributions_reviewer_bak");
    try {
      expect(() => hasFounderInvitationAuthority(PARTNER_A, companyId)).toThrow(FounderInviteAuthorityUnavailableError);
      try {
        hasFounderInvitationAuthority(PARTNER_A, companyId);
      } catch (err) {
        expect((err as { code?: string }).code).toBe("FOUNDER_INVITE_AUTHORITY_UNAVAILABLE");
        // No raw SQLite text is exposed.
        expect(String((err as Error).message)).not.toMatch(/no such table|SQLITE/i);
      }
      const read = await get(invitePath(companyId));
      expect(read.status).toBe(503);
      expect(read.body.error).not.toBe("PORTFOLIO_COMPANY_NOT_FOUND");
    } finally {
      rawDb().exec("ALTER TABLE partner_attributions_reviewer_bak RENAME TO partner_attributions");
    }
    expect(hasFounderInvitationAuthority(PARTNER_A, companyId)).toBe(true);
  });
});

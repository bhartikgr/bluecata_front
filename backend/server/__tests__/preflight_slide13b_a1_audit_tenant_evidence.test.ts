/**
 * Reviewer-owned EVIDENCE test for the SECURITY ADDENDUM tenant-alias claim.
 *
 * Original question (pre-fix, ANSWERED YES on the pre-A1-F1 tree): the historical
 * `company.created` provenance row lived in the implicit resolver tenant
 * (`tenant_co_<id-without-co_>`) while the company's own canonical tenant is
 * `tenant_co_<companyId>` (the doubled `tenant_co_co_…` form).
 * Now CONVERTED: forward writes must file in the actual canonical tenant, and a
 * separate legacy-shape fixture proves the two-tenant read still covers history.
 *
 * This file only OBSERVES the live handler: it drives the real partner
 * portfolio-company create route over HTTP against an isolated in-memory DB and
 * prints/asserts the actual `audit_log.tenant_id`, `target`, `target_id`,
 * payload provenance fields, and the `companies.tenant_id` of the same company.
 *
 * No product source edited. No mail, no live DB.
 *
 * Run:
 *   NODE_ENV=test SMTP_MODE=dry_run npx vitest run \
 *     server/__tests__/preflight_slide13b_a1_audit_tenant_evidence.test.ts \
 *     --poolOptions.threads.maxThreads=1 --poolOptions.threads.minThreads=1
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT } from "../../shared/wave214ThirdPartyAuthorityCopy";

const app = express();
const ACTOR = "u_avi_managing";
const statement = WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT;

beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  app.use(express.json());
  rawDb().exec(`CREATE TABLE IF NOT EXISTS founder_team_invitations (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL,
    invited_by_user_id TEXT NOT NULL,
    invited_email TEXT NOT NULL,
    invited_name TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'pending',
    token_hash TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    accepted_at TEXT,
    sent_at TEXT,
    deleted_at TEXT
  );`);
  rawDb().exec(`CREATE TABLE IF NOT EXISTS founder_team_members (
    id TEXT PRIMARY KEY NOT NULL,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT,
    removed_at TEXT,
    UNIQUE (company_id, user_id)
  );`);
  registerPartnerRoutes(app);
  registerPartnerPortfolioCompanyRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

describe("company.created provenance row — actual tenant and columns", () => {
  it("historical row uses the implicit resolver tenant, company uses the canonical doubled form", async () => {
    const res = await request(app)
      .post("/api/partner/me/portfolio-companies")
      .set("x-user-id", ACTOR)
      .send({
        companyName: "Tenant Evidence Co",
        founderEmail: `tenant_evidence_${Date.now()}@example.com`,
        founderName: "Evidence Founder",
        authorityTypedName: "Test Partner",
        authorityStatementShown: statement,
      });
    expect(res.status).toBe(201);
    const companyId = String(res.body.companyId);
    expect(companyId.startsWith("co_")).toBe(true);

    const auditRow: any = rawDb()
      .prepare(
        `SELECT tenant_id, actor_id, action, target, target_id, payload_json
           FROM audit_log
          WHERE action = 'company.created' AND target_id = ?`,
      )
      .get(companyId);
    const companyRow: any = rawDb()
      .prepare(`SELECT id, tenant_id FROM companies WHERE id = ?`)
      .get(companyId);

    const payload = JSON.parse(String(auditRow.payload_json));
    const observed = {
      companyId,
      auditTenantId: auditRow.tenant_id,
      companyTenantId: companyRow?.tenant_id ?? null,
      target: auditRow.target,
      targetId: auditRow.target_id,
      origin: payload.origin,
      createdByPartnerId: payload.createdByPartnerId,
    };
    // eslint-disable-next-line no-console
    console.log("[evidence] company.created row:", JSON.stringify(observed, null, 2));

    // 1) Exactly one provenance row for this company.
    const count: any = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'company.created' AND target_id = ?`)
      .get(companyId);
    expect(count.n).toBe(1);

    // 2) Provenance fields are server-set.
    expect(observed.target).toBe(`company:${companyId}`);
    expect(observed.targetId).toBe(companyId);
    expect(observed.origin).toBe("partner_portfolio");
    expect(observed.createdByPartnerId).toBe("ac_consortium_partner_test_partner_inc");

    // 3) CONVERTED FORWARD EXPECTATION (A1-F1 fix, SOURCE_STABLE_A1_F1): the
    //    handler now resolves and passes the live company tenant explicitly, so
    //    the provenance row files in the ACTUAL canonical tenant. Before the fix
    //    this row landed in the implicit resolver form `tenant_co_<id minus co_>`
    //    (observed on the pre-fix tree: audit tenant_co_27fe04630592 vs company
    //    tenant_co_co_27fe04630592).
    const stripped = companyId.replace(/^co_/, "");
    expect(observed.auditTenantId).toBe(`tenant_co_${companyId}`);
    expect(observed.auditTenantId).toBe(observed.companyTenantId);
    expect(observed.auditTenantId).not.toBe(`tenant_co_${stripped}`);

    // 4) HISTORICAL-SHAPE CONTROL: a row in the legacy resolver-alias tenant is
    //    still found by the constrained two-tenant read. Fixture on this
    //    process's :memory: DB — no frozen historical row is rewritten.
    const legacyId = `al_reviewer_legacy_${Date.now()}`;
    rawDb()
      .prepare(`INSERT INTO audit_log (id, tenant_id, actor_id, action, target, target_id, payload_json, prev_hash, hash, created_at)
                VALUES (?, ?, 'u_legacy', 'company.created', ?, NULL, ?, NULL, 'legacyhash', ?)`)
      .run(
        legacyId,
        `tenant_co_${stripped}`,
        `company:${companyId}_legacy`,
        JSON.stringify({ companyId: `${companyId}_legacy`, origin: "partner_portfolio", createdByPartnerId: "ac_consortium_partner_test_partner_inc" }),
        new Date().toISOString(),
      );
    const legacyFound: any[] = rawDb()
      .prepare(
        `SELECT id FROM audit_log
          WHERE action = 'company.created' AND target = ?
            AND tenant_id IN (?, ?)`,
      )
      .all(`company:${companyId}_legacy`, `tenant_co_${companyId}_legacy`, `tenant_co_${stripped}`);
    expect(legacyFound.map((r) => r.id)).toContain(legacyId);

    // 5) The constrained two-tenant read finds the live row, and exactly one.
    const twoTenant: any[] = rawDb()
      .prepare(
        `SELECT id FROM audit_log
          WHERE action = 'company.created'
            AND target_id = ?
            AND target = 'company:' || ?
            AND tenant_id IN (?, ?)
            AND json_extract(payload_json, '$.origin') = 'partner_portfolio'
            AND json_extract(payload_json, '$.createdByPartnerId') = ?`,
      )
      .all(
        companyId,
        companyId,
        `tenant_co_${companyId}`,
        `tenant_co_${stripped}`,
        "ac_consortium_partner_test_partner_inc",
      );
    expect(twoTenant).toHaveLength(1);

    // 6) The same read refuses a foreign partner id (no authority by alias).
    const foreign: any[] = rawDb()
      .prepare(
        `SELECT id FROM audit_log
          WHERE action = 'company.created' AND target_id = ?
            AND tenant_id IN (?, ?)
            AND json_extract(payload_json, '$.createdByPartnerId') = ?`,
      )
      .all(companyId, `tenant_co_${companyId}`, `tenant_co_${stripped}`, "ac_consortium_partner_other_inc");
    expect(foreign).toHaveLength(0);
  });
});

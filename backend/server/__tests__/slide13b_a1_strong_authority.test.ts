import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const smtp = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: smtp.sendMail }) } }));
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerFounderTeamRoutes } from "../lib/founderTeamStore";
import { seedTestPartnerSandbox, partnerTeamStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { rawDb } from "../db/connection";
import { _testTransport } from "../emailTransport";
import { hasFounderInvitationAuthority, FounderInviteAuthorityUnavailableError } from "../lib/founderInviteAuthority";
import { reissueFounderInvitation } from "../lib/portfolioFounderInvitationService";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as statement } from "../../shared/wave214ThirdPartyAuthorityCopy";

const app = express();
app.use(express.json());
const actor = "u_avi_managing", partner = "ac_consortium_partner_test_partner_inc";
const foreignActor = "u_maya_chen", foreignPartner = "ac_a1_f1_attacker";
const authority = { authorityTypedName: "Authorized Partner", authorityStatementShown: statement };
const base = "/api/partner/me/portfolio-companies";
const path = (id: string) => `${base}/${id}/founder-invitation`;
const post = (url: string, body: Record<string, unknown>, user = actor) =>
  request(app).post(url).set("x-user-id", user).send(body);
const create = (extra: Record<string, unknown> = {}) => post(base, {
  companyName: "Authority Test", founderEmail: "private-founder@test.example",
  founderName: "Private Founder", ...authority, ...extra,
});
const reissue = (r: any, user = actor) => post(`${path(r.body.companyId)}/reissue`, {
  ...authority, expectedInvitationId: r.body.founderInvite.id,
  founderEmail: "replacement@test.example", founderName: "Replacement",
}, user);
const get = (id: string, user = actor) => request(app).get(path(id)).set("x-user-id", user);
const audit = (id: string): any => rawDb().prepare("SELECT * FROM audit_log WHERE action='company.created' AND target=?").get(`company:${id}`);
const rows = (id: string) => rawDb().prepare("SELECT * FROM founder_team_invitations WHERE company_id=?").all(id);
function signAgreement(id: string) {
  rawDb().prepare(`INSERT INTO contacts (id,kind,legal_name,status,verification,created_at,updated_at,
    created_by,updated_by,version,prev_revision_hash,revision_hash,partner_agreement_signed_at)
    VALUES (?,'consortium_partner','Authority Partner','active','verified',?,?,?,?,1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET partner_agreement_signed_at=excluded.partner_agreement_signed_at`)
    .run(id, "2026-01-01", "2026-01-01", actor, actor, "0".repeat(64), "0".repeat(64), "2026-01-01");
}
beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(process.env.SMTP_MODE).toBe("dry_run");
  expect(rawDb().name).toBe(":memory:");
  seedTestPartnerSandbox({ force: true });
  signAgreement(partner);
  _registerSeedPartner({ id: foreignPartner, legalName: "Attack Partner", displayName: "Attack Partner",
    email: "ops@attack.test", region: "US", regionCode: "US", tier: "builder", partnerType: "accelerator" });
  partnerTeamStore.add(foreignPartner, foreignActor, "managing_partner", actor, { isSeed: true });
  signAgreement(foreignPartner);
  registerPartnerPortfolioCompanyRoutes(app);
  registerPartnerRoutes(app);
  registerFounderTeamRoutes(app);
}, 120_000);
beforeEach(() => {
  process.env.APP_URL = "https://app.example.test";
  _testTransport.reset();
  smtp.sendMail.mockReset().mockResolvedValue({ messageId: "smtp-f1" });
});
afterEach(() => vi.restoreAllMocks());

describe("A1-F1 strong founder invitation authority", () => {
  it("real foreign pipeline self-assertion permits tracking but no PII/read/reissue or mutation/mail", async () => {
    _testTransport.forceMode("smtp");
    const r = await create();
    expect(r.status).toBe(201);
    const companyId = r.body.companyId;
    const tracking = await post("/api/partner/me/pipeline", {
      dealName: "Self asserted", companyId, stage: "invited",
    }, foreignActor);
    expect(tracking.status).toBe(201);
    // Match production persistence even if the legacy KV schema memo predates
    // this test's DB handle. Payload is exactly the real HTTP-created DTO.
    rawDb().exec(`CREATE TABLE IF NOT EXISTS kv_partnerPipeline
      (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);`);
    rawDb().prepare("INSERT OR REPLACE INTO kv_partnerPipeline VALUES (?,?,?,NULL)")
      .run(tracking.body.deal.id, JSON.stringify(tracking.body.deal), new Date().toISOString());
    const before = rows(companyId), auditBefore = rawDb().prepare("SELECT * FROM audit_log").all();
    const sends = smtp.sendMail.mock.calls.length;
    const read = await get(companyId, foreignActor);
    expect(read.status).toBe(404);
    expect(read.text).not.toMatch(/private-founder|Private Founder|claimUrl|token_hash/);
    expect((await reissue(r, foreignActor)).status).toBe(404);
    expect(rows(companyId)).toEqual(before);
    expect(rawDb().prepare("SELECT * FROM audit_log").all()).toEqual(auditBefore);
    expect(smtp.sendMail).toHaveBeenCalledTimes(sends);
    expect(hasFounderInvitationAuthority(foreignPartner, companyId)).toBe(false);
    expect(hasFounderInvitationAuthority(partner, companyId)).toBe(true);
  });

  it.each(["actual", "historical", "historical_null_target_id"])("creator firm retains recovery for %s provenance without rewriting original", async layout => {
    const r = await create();
    expect(r.status).toBe(201);
    const id = r.body.companyId;
    const canonical: any = rawDb().prepare("SELECT tenant_id FROM companies WHERE id=?").get(id);
    expect(audit(id).tenant_id).toBe(canonical.tenant_id);
    if (layout !== "actual") {
      // Fixture-only reconstruction of the old writer's actual tenant layout.
      rawDb().prepare("UPDATE audit_log SET tenant_id=? WHERE id=?")
        .run(`tenant_co_${id.slice(3)}`, audit(id).id);
      if (layout === "historical_null_target_id") rawDb().prepare("UPDATE audit_log SET target_id=NULL WHERE id=?").run(audit(id).id);
    }
    // Authority is firm-level, not tied to original inviter still being a member.
    rawDb().prepare("UPDATE founder_team_invitations SET invited_by_user_id='former_employee' WHERE id=?")
      .run(r.body.founderInvite.id);
    const original = audit(id);
    expect(hasFounderInvitationAuthority(partner, id)).toBe(true);
    expect((await get(id)).status).toBe(200);
    const next = await reissue(r);
    expect(next.status).toBe(201);
    expect(audit(id)).toEqual(original);
    const recovery: any = rawDb().prepare("SELECT tenant_id FROM audit_log WHERE action='founder_invitation.reissued' AND target=?").get(`company:${id}`);
    expect(recovery.tenant_id).toBe(canonical.tenant_id);
  });

  it.each(["revoked", "missing", "wrong_source"])("origin attribution %s stops recovery despite creation evidence", async state => {
    const r = await create(), id = r.body.companyId;
    if (state === "revoked") rawDb().prepare("UPDATE partner_attributions SET revoked_at=? WHERE company_id=?").run(new Date().toISOString(), id);
    else if (state === "missing") rawDb().prepare("DELETE FROM partner_attributions WHERE company_id=?").run(id);
    else rawDb().prepare("UPDATE partner_attributions SET attribution_source='admin_manual' WHERE company_id=?").run(id);
    const before = rows(id);
    expect((await get(id)).status).toBe(404);
    expect((await reissue(r)).status).toBe(404);
    expect(rows(id)).toEqual(before);
  });

  it.each(["missing", "malformed", "null", "wrong_origin", "wrong_partner", "wrong_company",
    "wrong_target", "wrong_target_id", "wrong_tenant", "empty_hash", "duplicate", "conflict"])(
    "%s provenance is denied, never repaired with CRM relationship", async kind => {
      const r = await create(), id = r.body.companyId, a = audit(id);
      const payload = JSON.parse(a.payload_json);
      if (kind === "missing") rawDb().prepare("DELETE FROM audit_log WHERE id=?").run(a.id);
      else if (kind === "wrong_target") rawDb().prepare("UPDATE audit_log SET target='company:unrelated' WHERE id=?").run(a.id);
      else if (kind === "wrong_target_id") rawDb().prepare("UPDATE audit_log SET target_id='unrelated' WHERE id=?").run(a.id);
      else if (kind === "wrong_tenant") rawDb().prepare("UPDATE audit_log SET tenant_id='tenant_unrelated' WHERE id=?").run(a.id);
      else if (kind === "empty_hash") rawDb().prepare("UPDATE audit_log SET hash='' WHERE id=?").run(a.id);
      else if (kind === "duplicate" || kind === "conflict") {
        if (kind === "conflict") payload.createdByPartnerId = foreignPartner;
        rawDb().prepare(`INSERT INTO audit_log (id,tenant_id,actor_id,action,target,target_id,payload_json,
          prev_hash,hash,created_at,hash_version)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(`${a.id}_conflict`, `tenant_co_${id.slice(3)}`, a.actor_id,
            a.action, a.target, a.target_id, JSON.stringify(payload), a.prev_hash, a.hash, a.created_at, a.hash_version);
      } else {
        if (kind === "wrong_origin") payload.origin = "legacy";
        if (kind === "wrong_partner") payload.createdByPartnerId = foreignPartner;
        if (kind === "wrong_company") payload.companyId = "co_unrelated";
        rawDb().prepare("UPDATE audit_log SET payload_json=? WHERE id=?")
          .run(kind === "malformed" ? "{" : kind === "null" ? "null" : JSON.stringify(payload), a.id);
      }
      const before = rows(id);
      expect((await get(id)).status).toBe(404);
      expect((await reissue(r)).status).toBe(404);
      expect(rows(id)).toEqual(before);
    });

  it("caller-supplied creation provenance is ignored; canonical actor firm and minted company win", async () => {
    const r = await create({ companyId: "co_attacker", createdByPartnerId: foreignPartner, origin: "legacy" });
    expect(r.status).toBe(201);
    expect(r.body.companyId).not.toBe("co_attacker");
    expect(JSON.parse(audit(r.body.companyId).payload_json)).toMatchObject({
      companyId: r.body.companyId, origin: "partner_portfolio", createdByPartnerId: partner,
    });
    expect(hasFounderInvitationAuthority(partner, r.body.companyId)).toBe(true);
    expect(hasFounderInvitationAuthority(foreignPartner, r.body.companyId)).toBe(false);
  });

  it("direct mutation service repeats authority under the transaction and makes no writes", async () => {
    const r = await create(), id = r.body.companyId;
    const before = rows(id);
    expect(() => reissueFounderInvitation({ companyId: id, partnerId: foreignPartner, actorId: foreignActor,
      expectedInvitationId: r.body.founderInvite.id, founderEmail: "attacker@test.example",
      founderName: "Attacker", authority: {} as any })).toThrow("PORTFOLIO_COMPANY_NOT_FOUND");
    rawDb().prepare("UPDATE partner_attributions SET revoked_at=? WHERE company_id=?").run(new Date().toISOString(), id);
    expect(() => reissueFounderInvitation({ companyId: id, partnerId: partner, actorId: actor,
      expectedInvitationId: r.body.founderInvite.id, founderEmail: "attacker@test.example",
      founderName: "Attacker", authority: {} as any })).toThrow("PORTFOLIO_COMPANY_NOT_FOUND");
    expect(rows(id)).toEqual(before);
  });

  it("infrastructure failure is unavailable 503, never false authority or mutation", async () => {
    const r = await create(), id = r.body.companyId, before = rows(id);
    const db = rawDb(), original = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: any) => {
      if (String(sql).includes("SELECT target_id, payload_json, hash, deleted_at")) throw new Error("fixture outage");
      return original(sql);
    });
    expect(() => hasFounderInvitationAuthority(partner, id)).toThrow(FounderInviteAuthorityUnavailableError);
    expect((await get(id)).status).toBe(503);
    expect((await reissue(r)).status).toBe(503);
    expect(rows(id)).toEqual(before);
  });
});

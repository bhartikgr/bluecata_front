import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHash, randomBytes } from "node:crypto";

// Real emailTransport, stub only the SMTP socket boundary: never real mail.
const smtp = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: smtp.sendMail }) } }));
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { seedTestPartnerSandbox, partnerTeamStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import { registerTeamInviteRedeemRoutes } from "../lib/teamInviteRedeem";
import { registerFounderTeamRoutes } from "../lib/founderTeamStore";
import { rawDb } from "../db/connection";
import { getAuditLog } from "../adminPlatformStore";
import { _testTransport, sendMail } from "../emailTransport";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as statement } from "../../shared/wave214ThirdPartyAuthorityCopy";
import { dispatchFounderInvitation, founderClaimUrl } from "../lib/portfolioFounderInvitationService";

const app = express();
app.use(express.json());
const actor = "u_avi_managing";
const partner = "ac_consortium_partner_test_partner_inc";
const authority = { authorityTypedName: "Test Partner", authorityStatementShown: statement };
const base = "/api/partner/me/portfolio-companies";
const path = (companyId: string) => `${base}/${companyId}/founder-invitation`;
function post(url: string, body: Record<string, unknown>, user = actor) { return request(app).post(url).set("x-user-id", user).send(body); }
const create = (extra = {}) => post(base, { companyName: 'Company <script>"&', founderEmail: " Intended@Example.com ",
  founderName: 'Founder <img src=x>"&', sector: "Robotics", ...authority, ...extra });
const reissue = (r: any, extra = {}) => post(`${path(r.body.companyId)}/reissue`, {
  expectedInvitationId: r.body.founderInvite.id, founderEmail: "corrected@example.com", founderName: "Correct Founder",
  ...authority, ...extra,
});
const invitation = (id: string): any => rawDb().prepare("SELECT * FROM founder_team_invitations WHERE id=?").get(id);

beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(rawDb().name).toBe(":memory:");
  seedTestPartnerSandbox({ force: true });
  rawDb().prepare("UPDATE contacts SET partner_agreement_signed_at=? WHERE id=?").run(new Date().toISOString(), partner);
  registerPartnerPortfolioCompanyRoutes(app);
  registerFounderTeamRoutes(app);
  registerTeamInviteRedeemRoutes(app);
});
beforeEach(() => {
  process.env.SMTP_MODE = "dry_run";
  process.env.APP_URL = "https://app.example.test";
  _testTransport.reset();
  smtp.sendMail.mockReset().mockResolvedValue({ messageId: "smtp-message" });
});

describe("slide13b A1 durable invitation delivery and recovery", () => {
  it("uses exact persisted recipient/name across HTTP, audit, invite and real SMTP adapter; escapes HTML", async () => {
    _testTransport.forceMode("smtp");
    const r = await create();
    expect(r.status).toBe(201);
    const i = r.body.founderInvite;
    expect(i).toMatchObject({ email: "intended@example.com", name: 'Founder <img src=x>"&',
      status: "pending", handoff: { mode: "smtp", result: "accepted" } });
    expect(i.claimUrl).toMatch(/^https:\/\/app.example.test\/auth\/redeem\?token=/);
    expect(invitation(i.id)).toMatchObject({ invited_email: i.email, invited_name: i.name, sent_at: expect.any(String) });
    const mail = smtp.sendMail.mock.calls[0][0];
    expect(mail.to).toBe(i.email);
    expect(mail.html).toContain("Founder &lt;img src=x&gt;&quot;&amp;");
    expect(mail.html).not.toContain("<script>");
    const audit: any = rawDb().prepare("SELECT payload_json FROM audit_log WHERE action='company.created' AND target=?").get(`company:${r.body.companyId}`);
    expect(JSON.parse(audit.payload_json)).toMatchObject({ founderEmail: i.email, founderName: i.name, sector: "Robotics" });
    expect(JSON.stringify(r.body)).not.toContain("token_hash");
    // Existing transport's process-local idempotency key is invitation-specific.
    await dispatchFounderInvitation({ invitationId: i.id, companyId: r.body.companyId,
      token: new URL(i.claimUrl).searchParams.get("token")!, actorId: actor });
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
  });
  it("dry-run is simulated and token/hash/credential free on read APIs and audit", async () => {
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.body.founderInvite.handoff).toMatchObject({ mode: "dry_run", result: "simulated" });
    expect(smtp.sendMail).not.toHaveBeenCalled();
    const read = await request(app).get(path(r.body.companyId)).set("x-user-id", actor);
    expect(read.status).toBe(200);
    expect(read.body.invitation.handoff.result).toBe("simulated");
    expect(read.text).not.toMatch(/claimUrl|token_hash|password|token=/);
    const token = new URL(r.body.founderInvite.claimUrl).searchParams.get("token")!;
    const audits = rawDb().prepare("SELECT payload_json FROM audit_log").all();
    expect(JSON.stringify(audits)).not.toContain(token);
    expect(JSON.stringify(audits)).not.toContain(createHash("sha256").update(token).digest("hex"));
  });
  it("SMTP failure preserves company and invite with recoverable explicit outcome and no sent stamp", async () => {
    _testTransport.forceMode("smtp");
    smtp.sendMail.mockRejectedValue(new Error("secret SMTP password"));
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.body.founderInvite.handoff).toMatchObject({ result: "failed", mode: "smtp", error: "MAIL_HANDOFF_FAILED" });
    expect(r.body.founderInvite.claimUrl).toContain("token=");
    expect(invitation(r.body.founderInvite.id).sent_at).toBeNull();
    expect(rawDb().prepare("SELECT id FROM companies WHERE id=? AND deleted_at IS NULL").get(r.body.companyId)).toBeTruthy();
    expect(r.text).not.toContain("secret");
  });
  it("reissue revokes only old status, appends audit and new token; same recipient resend also replaces token", async () => {
    const r = await create();
    const original = invitation(r.body.founderInvite.id);
    const creationAudit = rawDb().prepare("SELECT * FROM audit_log WHERE action='company.created' AND target=?").get(`company:${r.body.companyId}`);
    const corrected = await reissue(r);
    expect(corrected.status).toBe(201);
    const old = invitation(original.id), next = invitation(corrected.body.founderInvite.id);
    expect(old.status).toBe("revoked");
    expect(old.invited_email).toBe(original.invited_email);
    expect(old.token_hash).toBe(original.token_hash);
    expect(next.token_hash).not.toBe(original.token_hash);
    expect(next.invited_email).toBe("corrected@example.com");
    expect(rawDb().prepare("SELECT * FROM audit_log WHERE action='company.created' AND target=?").get(`company:${r.body.companyId}`)).toEqual(creationAudit);
    const oldToken = new URL(r.body.founderInvite.claimUrl).searchParams.get("token")!;
    const oldPreview = await request(app).get("/api/auth/redeem/preview").query({ token: oldToken });
    expect(oldPreview.status).toBe(404);
    expect(oldPreview.body.error).toBe("revoked");
    const row: any = rawDb().prepare("SELECT payload_json FROM audit_log WHERE action='founder_invitation.reissued' AND target=?").get(`company:${r.body.companyId}`);
    expect(JSON.parse(row.payload_json)).toMatchObject({ oldEmail: original.invited_email, newEmail: next.invited_email, authority: { statementText: statement } });
    const resend = await reissue(corrected);
    expect(resend.status).toBe(201);
    expect(invitation(next.id).status).toBe("revoked");
    expect(resend.body.founderInvite.email).toBe(next.invited_email);
    expect(invitation(resend.body.founderInvite.id).token_hash).not.toBe(next.token_hash);
  });
  it("real audit INSERT failure sentinel rolls back both invitation writes and does not pollute audit mirror", async () => {
    const r = await create();
    const rowsBefore = rawDb().prepare("SELECT * FROM founder_team_invitations WHERE company_id=?").all(r.body.companyId);
    const countBefore = rawDb().prepare("SELECT count(*) n FROM audit_log").get();
    const mirrorBefore = getAuditLog().map(a => a.id);
    rawDb().exec(`CREATE TRIGGER a1_fail_audit BEFORE INSERT ON audit_log
      WHEN NEW.action = 'founder_invitation.reissued' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;`);
    try {
      const failed = await reissue(r);
      expect(failed.status).toBe(503);
      expect(failed.body.error).toBe("INVITATION_AUDIT_UNAVAILABLE");
      expect(rawDb().prepare("SELECT * FROM founder_team_invitations WHERE company_id=?").all(r.body.companyId)).toEqual(rowsBefore);
      expect(rawDb().prepare("SELECT count(*) n FROM audit_log").get()).toEqual(countBefore);
      expect(getAuditLog().map(a => a.id)).toEqual(mirrorBefore);
    } finally { rawDb().exec("DROP TRIGGER a1_fail_audit"); }
  });
  it("outer COMMIT failure after successful audit savepoint removes rolled-back audit mirror evidence", async () => {
    const r = await create();
    const before = rawDb().prepare("SELECT * FROM founder_team_invitations WHERE company_id=?").all(r.body.companyId);
    const auditsBefore = rawDb().prepare("SELECT count(*) n FROM audit_log").get();
    const mirrorBefore = getAuditLog().map(a => a.id);
    // Real SQLite deferred constraint: inner audit SAVEPOINT succeeds; only
    // the OUTER COMMIT fails. This proves mirror cleanup, not just sentinel.
    rawDb().exec(`CREATE TABLE a1_commit_parent(id TEXT PRIMARY KEY);
      CREATE TABLE a1_commit_child(parent_id TEXT REFERENCES a1_commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER a1_commit_fail AFTER INSERT ON audit_log
      WHEN NEW.action = 'founder_invitation.reissued'
      BEGIN INSERT INTO a1_commit_child(parent_id) VALUES ('missing'); END;`);
    try {
      const failed = await reissue(r);
      expect(failed.status).toBe(503);
      expect(rawDb().prepare("SELECT * FROM founder_team_invitations WHERE company_id=?").all(r.body.companyId)).toEqual(before);
      expect(rawDb().prepare("SELECT count(*) n FROM audit_log").get()).toEqual(auditsBefore);
      expect(getAuditLog().map(a => a.id)).toEqual(mirrorBefore);
    } finally {
      rawDb().exec("DROP TRIGGER a1_commit_fail; DROP TABLE a1_commit_child; DROP TABLE a1_commit_parent;");
    }
  });
  it("concurrent duplicate expected IDs produce exactly one valid replacement", async () => {
    const r = await create();
    const results = await Promise.all([reissue(r), reissue(r)]);
    expect(results.map(x => x.status).sort()).toEqual([201, 409]);
    const pending: any = rawDb().prepare("SELECT count(*) n FROM founder_team_invitations WHERE company_id=? AND status='pending'").get(r.body.companyId);
    expect(pending.n).toBe(1);
  });
  it("accepted invitation and a claim that wins before replacement are refused", async () => {
    const r = await create();
    rawDb().prepare("UPDATE founder_team_invitations SET status='accepted',accepted_at=? WHERE id=?")
      .run(new Date().toISOString(), r.body.founderInvite.id);
    expect((await reissue(r)).status).toBe(409);
    expect(invitation(r.body.founderInvite.id).status).toBe("accepted");
  });
  it.each(["claim", "replacement"])("real A0 redemption competes with reissue (%s request first), never both valid", async first => {
    const r = await create({ founderEmail: `a1_race_${randomBytes(8).toString("hex")}@test.example` });
    const claim = () => request(app).post("/api/auth/redeem").send({
      token: new URL(r.body.founderInvite.claimUrl).searchParams.get("token"),
      agreedToTerms: true, password: `Isolated-${randomBytes(12).toString("hex")}`,
    });
    const calls = first === "claim" ? [claim(), reissue(r)] : [reissue(r), claim()];
    const results = await Promise.all(calls);
    const claimed = results[first === "claim" ? 0 : 1], replaced = results[first === "claim" ? 1 : 0];
    if (claimed.status === 200) {
      expect(replaced.status).toBe(409);
      expect(invitation(r.body.founderInvite.id).status).toBe("accepted");
      const status = await request(app).get(path(r.body.companyId)).set("x-user-id", actor);
      expect(status.body).toMatchObject({ registrationState: "registered", canReissue: false });
    } else {
      expect(replaced.status).toBe(201);
      expect(claimed.status).toBe(404);
      expect(claimed.body.error).toBe("revoked");
      expect(invitation(r.body.founderInvite.id).status).toBe("revoked");
      expect(invitation(replaced.body.founderInvite.id).status).toBe("pending");
    }
    const active: any = rawDb().prepare(`SELECT count(*) n FROM founder_team_invitations
      WHERE company_id=? AND status IN ('pending','accepted') AND deleted_at IS NULL`).get(r.body.companyId);
    expect(active.n).toBe(1);
  });
  it("SMTP failure after replacement commit retains new pending token and old revocation", async () => {
    const r = await create();
    _testTransport.forceMode("smtp");
    smtp.sendMail.mockRejectedValue(new Error("failed"));
    const next = await reissue(r);
    expect(next.status).toBe(201);
    expect(next.body.founderInvite.handoff.result).toBe("failed");
    expect(invitation(r.body.founderInvite.id).status).toBe("revoked");
    expect(invitation(next.body.founderInvite.id)).toMatchObject({ status: "pending", sent_at: null });
  });
  it("console acceptance is simulated, and transport rate limiting never stamps sent_at", async () => {
    _testTransport.forceMode("console");
    const simulated = await create();
    expect(simulated.body.founderInvite.handoff).toMatchObject({ mode: "console", result: "simulated" });
    _testTransport.reset();
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    try {
      await Promise.all(Array.from({ length: 30 }, () => sendMail({ to: "test@example.com", subject: "test", html: "test" })));
      const limited = await create();
      expect(limited.status).toBe(201);
      expect(limited.body.founderInvite.handoff).toMatchObject({ result: "failed", error: "RATE_LIMITED" });
      expect(limited.body.founderInvite.sentAt).toBeNull();
    } finally { clock.mockRestore(); }
  });
  it("foreign company is 404 and role, agreement, authority gates remain fail-closed", async () => {
    expect((await request(app).get(path("co_foreign_a1")).set("x-user-id", actor)).status).toBe(404);
    expect((await post(`${path("co_foreign_a1")}/reissue`, { ...authority, expectedInvitationId: "x", founderEmail: "x@y.test" })).status).toBe(404);
    const r = await create();
    expect((await reissue(r, { authorityStatementShown: "edited statement" })).status).toBe(400);
    expect((await post(`${path(r.body.companyId)}/reissue`, {}, "u_avi_viewer")).status).toBe(403);
    rawDb().prepare("UPDATE contacts SET partner_agreement_signed_at=NULL WHERE id=?").run(partner);
    try { expect((await reissue(r)).status).toBe(403); }
    finally { rawDb().prepare("UPDATE contacts SET partner_agreement_signed_at=? WHERE id=?").run(new Date().toISOString(), partner); }
  });
  it("another authenticated active partner cannot read or replace an existing foreign invitation", async () => {
    const r = await create();
    const otherPartner = "ac_a1_foreign_partner";
    _registerSeedPartner({ id: otherPartner, legalName: "Other Partner", displayName: "Other Partner",
      email: "other@example.com", region: "US", regionCode: "US", tier: "builder", partnerType: "accelerator" });
    partnerTeamStore.add(otherPartner, "u_aisha_patel", "managing_partner", actor, { isSeed: true });
    // Existing seeded investor persona is legitimately also a partner.
    rawDb().prepare(`INSERT INTO contacts (id, kind, legal_name, status, verification, created_at, updated_at,
      created_by, updated_by, version, prev_revision_hash, revision_hash, partner_agreement_signed_at)
      VALUES (?, 'consortium_partner', 'Other Partner', 'active', 'verified', ?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(otherPartner, "2026-01-01", "2026-01-01", actor, actor, "0".repeat(64), "0".repeat(64), "2026-01-01");
    expect((await request(app).get(path(r.body.companyId)).set("x-user-id", "u_aisha_patel")).status).toBe(404);
    const foreign = await post(`${path(r.body.companyId)}/reissue`, { ...authority,
      founderEmail: "theft@example.com", expectedInvitationId: r.body.founderInvite.id }, "u_aisha_patel");
    expect(foreign.status).toBe(404);
    expect(invitation(r.body.founderInvite.id).status).toBe("pending");
  });
  it("anonymous status and reissue requests are refused with development bypass disabled", async () => {
    const previous = process.env.DISABLE_DEV_BYPASS;
    process.env.DISABLE_DEV_BYPASS = "1";
    try {
      expect((await request(app).get(path("co_private"))).status).toBe(401);
      expect((await request(app).post(`${path("co_private")}/reissue`).send({})).status).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.DISABLE_DEV_BYPASS;
      else process.env.DISABLE_DEV_BYPASS = previous;
    }
  });
  it("newer revoked history does not hide an older actionable pending owner invitation", async () => {
    const r = await create();
    rawDb().prepare(`INSERT INTO founder_team_invitations
      (id,company_id,invited_by_user_id,invited_email,invited_name,role,status,token_hash,expires_at,created_at)
      SELECT id || '_revoked',company_id,invited_by_user_id,'revoked@example.com',invited_name,
        role,'revoked',?,expires_at,? FROM founder_team_invitations WHERE id=?`)
      .run("f".repeat(64), new Date(Date.now() + 60_000).toISOString(), r.body.founderInvite.id);
    const status = await request(app).get(path(r.body.companyId)).set("x-user-id", actor);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ canReissue: true,
      invitation: { id: r.body.founderInvite.id, email: "intended@example.com", status: "pending" } });
    expect((await reissue(r)).status).toBe(201);
  });
  it("trusted origin rejects credentials, non-HTTPS and request-host alternatives", () => {
    for (const origin of ["http://example.test", "https://user:pass@example.test", "https://example.test/path", "javascript:bad"]) {
      process.env.APP_URL = origin;
      expect(() => founderClaimUrl("secret")).toThrow();
    }
  });
});

/**
 * INDEPENDENT REVIEWER TESTS — slide13b A1 (founder invitation delivery and recovery).
 *
 * Scope requested by parent: email recipient, send truthfulness, correction
 * atomicity, tokens, cross-partner guards. Reviewer-owned, additive, adversarial.
 * No product source edited. SMTP socket is mocked; no mail leaves the process.
 *
 * Several cases below are FAIL-BEFORE PROOFS: they assert the CURRENT, defective
 * behaviour so the defect is executable and the builder can invert the assertion
 * once fixed. Each is marked PROOF OF DEFECT.
 *
 * Run:
 *   cd /home/user/workspace/work && NODE_ENV=test npx vitest run \
 *     server/__tests__/preflight_slide13b_a1_invitation_recovery_review.test.ts \
 *     --maxWorkers=1
 */
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
import { dispatchFounderInvitation } from "../lib/portfolioFounderInvitationService";
import { WAVE214_PORTFOLIO_COMPANY_AUTHORITY_STATEMENT as statement } from "../../shared/wave214ThirdPartyAuthorityCopy";

const app = express();
app.use(express.json());

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const ACTOR_A = "u_avi_managing";
const VIEWER_A = "u_avi_viewer";
/** A second, unrelated Consortium Partner — the attacker in the fence tests. */
const PARTNER_B = "ac_consortium_partner_reviewer_bravo_inc";
// A known seeded persona (so getUserContext authenticates it) that belongs to no
// partner team until this fixture adds it to PARTNER_B. Not an admin persona.
const ACTOR_B = "u_maya_chen";

const base = "/api/partner/me/portfolio-companies";
const invitePath = (companyId: string) => `${base}/${companyId}/founder-invitation`;
const authority = { authorityTypedName: "Test Partner", authorityStatementShown: statement };

/* supertest's .send() overloads accept an object, a string or nothing, so the
   helper body is typed the same way instead of `unknown` (TS2345). */
type RequestBody = Record<string, unknown> | string | undefined;
function post(url: string, body: RequestBody, user = ACTOR_A) {
  return request(app).post(url).set("x-user-id", user).send(body as never);
}
function get(url: string, user = ACTOR_A) {
  return request(app).get(url).set("x-user-id", user);
}
function createCompany(founderEmail = `victim_${Math.random().toString(16).slice(2)}@example.com`) {
  return post(base, { companyName: "A1 Review Co", founderEmail, founderName: "Real Founder", ...authority });
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
  expect(process.env.NODE_ENV).toBe("test");
  expect(rawDb().name).toBe(":memory:");
  seedTestPartnerSandbox({ force: true });
  signAgreement(PARTNER_A);
  // Second partner, fully legitimate in its own right: approved, signed, managing
  // sub-role. It simply has no relationship to Partner A's portfolio company.
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
  registerTeamInviteRedeemRoutes(app);
});

beforeEach(() => {
  process.env.SMTP_MODE = "dry_run";
  process.env.APP_URL = "https://app.example.test";
  _testTransport.reset();
  smtp.sendMail.mockReset().mockResolvedValue({ messageId: "smtp-message" });
});

describe("A1 · recipient and token discipline", () => {
  it("the recipient is the PERSISTED invitation address, not the request body", async () => {
    _testTransport.forceMode("smtp");
    const created = await createCompany(" Intended@Example.COM ");
    expect(created.status).toBe(201);
    const invite = created.body.founderInvite;
    expect(invite.email).toBe("intended@example.com");
    expect(invitationRow(invite.id).invited_email).toBe("intended@example.com");
    expect(smtp.sendMail.mock.calls[0][0].to).toBe("intended@example.com");
    // The mail names the account the invitation belongs to — a claimant who is
    // already signed in as someone else must be able to see the mismatch.
    expect(smtp.sendMail.mock.calls[0][0].text).toContain("intended@example.com");
  });

  it("the claim origin comes from configuration only — Host/X-Forwarded-Host cannot move it", async () => {
    const res = await request(app)
      .post(base)
      .set("x-user-id", ACTOR_A)
      .set("X-Forwarded-Host", "evil.example.net")
      .set("X-Forwarded-Proto", "http")
      .send({ companyName: "Origin Co", founderEmail: "origin@example.com", founderName: "F", ...authority });
    expect(res.status).toBe(201);
    expect(res.body.founderInvite.claimUrl).toMatch(/^https:\/\/app\.example\.test\/auth\/redeem\?token=/);
    expect(JSON.stringify(res.body)).not.toContain("evil.example.net");
  });

  it("the status read exposes no token, hash or claim URL, and the audit trail stores no token", async () => {
    const created = await createCompany();
    const invite = created.body.founderInvite;
    const token = new URL(invite.claimUrl).searchParams.get("token")!;
    const status = await get(invitePath(created.body.companyId));
    expect(status.status).toBe(200);
    const body = JSON.stringify(status.body);
    expect(status.body.invitation.claimUrl).toBeUndefined();
    expect(body).not.toContain(token);
    expect(body).not.toContain("token_hash");
    expect(body).not.toContain(invitationRow(invite.id).token_hash);
    const audits = rawDb().prepare("SELECT payload_json FROM audit_log").all() as any[];
    const allAudit = audits.map((a) => a.payload_json ?? "").join("|");
    expect(allAudit).not.toContain(token);
    expect(allAudit).not.toContain(invitationRow(invite.id).token_hash);
  });
});

describe("A1 · correction atomicity", () => {
  it("a correction revokes exactly one row, mints exactly one replacement, and kills the old token", async () => {
    const created = await createCompany("old_owner@example.com");
    const companyId = created.body.companyId;
    const oldInvite = created.body.founderInvite;
    const oldToken = new URL(oldInvite.claimUrl).searchParams.get("token")!;

    const fixed = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: oldInvite.id, founderEmail: "New.Owner@example.com",
      founderName: "New Owner", ...authority,
    });
    expect(fixed.status).toBe(201);
    const rows = ownerRows(companyId);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: oldInvite.id, status: "revoked", accepted_at: null });
    expect(rows[1]).toMatchObject({ invited_email: "new.owner@example.com", status: "pending" });
    expect(fixed.body.founderInvite.id).toBe(rows[1].id);
    // The replaced token must be dead, not merely superseded.
    const preview = await request(app).get(`/api/auth/redeem/preview?token=${oldToken}`);
    expect(preview.status).toBeGreaterThanOrEqual(400);
    expect(String(preview.body?.error ?? "")).toBe("revoked");
    // And the new token must be live.
    const newToken = new URL(fixed.body.founderInvite.claimUrl).searchParams.get("token")!;
    const ok = await request(app).get(`/api/auth/redeem/preview?token=${newToken}`);
    expect(ok.status).toBe(200);
  });

  it("a stale expectedInvitationId cannot replace the current invitation (no lost-update)", async () => {
    const created = await createCompany();
    const companyId = created.body.companyId;
    const first = created.body.founderInvite;
    const r1 = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: first.id, founderEmail: "second@example.com", founderName: "S", ...authority,
    });
    expect(r1.status).toBe(201);
    // Replaying the ORIGINAL expected id must not revoke the newer row.
    const replay = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: first.id, founderEmail: "attacker@example.com", founderName: "A", ...authority,
    });
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe("INVITATION_NOT_PENDING");
    const rows = ownerRows(companyId);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(1);
    expect(rows.find((r) => r.status === "pending").invited_email).toBe("second@example.com");
    expect(rows.some((r) => r.invited_email === "attacker@example.com")).toBe(false);
  });

  it("an accepted owner invitation can never be corrected away (no ownership transfer API)", async () => {
    const created = await createCompany();
    const companyId = created.body.companyId;
    const invite = created.body.founderInvite;
    rawDb()
      .prepare("UPDATE founder_team_invitations SET status='accepted', accepted_at=? WHERE id=?")
      .run(new Date().toISOString(), invite.id);
    const res = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: invite.id, founderEmail: "attacker@example.com", founderName: "A", ...authority,
    });
    expect(res.status).toBe(409);
    expect(ownerRows(companyId).some((r) => r.invited_email === "attacker@example.com")).toBe(false);
    const status = await get(invitePath(companyId));
    expect(status.body.canReissue).toBe(false);
  });

  it("PROOF OF DEFECT (A1-R1): once the only owner invitation is revoked, recovery is terminal", async () => {
    const created = await createCompany();
    const companyId = created.body.companyId;
    const invite = created.body.founderInvite;
    // A legitimate operational action: the partner (or support) revokes the bad
    // invitation first, intending to issue a corrected one afterwards.
    rawDb().prepare("UPDATE founder_team_invitations SET status='revoked' WHERE id=?").run(invite.id);

    const res = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: invite.id, founderEmail: "corrected@example.com", founderName: "C", ...authority,
    });
    // Observed: the route refuses and there is NO route that issues a fresh owner
    // invitation for an existing company. The company is now permanently
    // unclaimable through the partner surface.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("INVITATION_NOT_PENDING");
    const status = await get(invitePath(companyId));
    expect(status.body.invitation.status).toBe("revoked");
    expect(status.body.canReissue).toBe(false);
    expect(ownerRows(companyId).filter((r) => r.status === "pending")).toHaveLength(0);
  });
});

describe("A1 · send truthfulness", () => {
  it("dry-run reports simulated, never accepted, and records the mode durably", async () => {
    const created = await createCompany();
    expect(created.body.founderInvite.handoff).toMatchObject({ mode: "dry_run", result: "simulated" });
    expect(smtp.sendMail).not.toHaveBeenCalled();
    const status = await get(invitePath(created.body.companyId));
    expect(status.body.invitation.handoff).toMatchObject({ mode: "dry_run", result: "simulated" });
  });

  it("a real transport failure is reported as failed, sent_at stays null, and the invitation survives", async () => {
    _testTransport.forceMode("smtp");
    smtp.sendMail.mockRejectedValue(new Error("535 auth failed for user smtp-user@example.com"));
    const created = await createCompany();
    expect(created.status).toBe(201);
    const invite = created.body.founderInvite;
    expect(invite.handoff).toMatchObject({ result: "failed", error: "MAIL_HANDOFF_FAILED" });
    expect(invite.handoff.error).not.toContain("smtp-user");
    expect(JSON.stringify(created.body)).not.toContain("535");
    expect(invitationRow(invite.id)).toMatchObject({ status: "pending", sent_at: null });
    // Claim URL is still returned once, so the delivery failure is recoverable.
    expect(invite.claimUrl).toContain("/auth/redeem?token=");
  });

  it("PROOF OF DEFECT (A1-T1): a failed handoff is cached, so the same invitation can never be re-delivered", async () => {
    _testTransport.forceMode("smtp");
    smtp.sendMail.mockRejectedValue(new Error("connection refused"));
    const created = await createCompany();
    const invite = created.body.founderInvite;
    const token = new URL(invite.claimUrl).searchParams.get("token")!;
    expect(invite.handoff.result).toBe("failed");

    // The transport is healthy again.
    smtp.sendMail.mockReset().mockResolvedValue({ messageId: "smtp-recovered" });
    const retry = await dispatchFounderInvitation({
      invitationId: invite.id, companyId: created.body.companyId, token, actorId: ACTOR_A,
    });
    // Observed: sendMail's idempotency cache stores FAILURES too
    // (server/emailTransport.ts:245 caches both branches), so the retry returns
    // the cached failure and the socket is never touched again.
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(retry.handoff.result).toBe("failed");
    expect(invitationRow(invite.id).sent_at).toBeNull();
  });

  it("PROOF OF DEFECT (A1-T2): a cached success re-reports a fresh delivery that never happened", async () => {
    _testTransport.forceMode("smtp");
    const created = await createCompany();
    const invite = created.body.founderInvite;
    const token = new URL(invite.claimUrl).searchParams.get("token")!;
    expect(invite.handoff).toMatchObject({ mode: "smtp", result: "accepted" });
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    const firstSentAt = invitationRow(invite.id).sent_at;
    expect(firstSentAt).toEqual(expect.any(String));

    await new Promise((r) => setTimeout(r, 5));
    const again = await dispatchFounderInvitation({
      invitationId: invite.id, companyId: created.body.companyId, token, actorId: ACTOR_A,
    });
    // Observed: no second send occurs (correct), but the result is reported as a
    // NEW accepted handoff — sent_at is rewritten to now and a second
    // `founder_invitation.handoff` audit row claims an accepted delivery.
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    expect(again.handoff).toMatchObject({ result: "accepted", statusRecorded: true });
    expect(invitationRow(invite.id).sent_at).not.toBe(firstSentAt);
    const handoffRows = rawDb()
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='founder_invitation.handoff' AND target=?")
      .get(`founder_invitation:${invite.id}`) as any;
    expect(handoffRows.n).toBe(2);
  });

  it("the handoff read is an allowlist — a polluted audit payload cannot widen the response", async () => {
    const created = await createCompany();
    const invite = created.body.founderInvite;
    const companyId = created.body.companyId;
    const tenant = (rawDb().prepare("SELECT tenant_id FROM companies WHERE id=?").get(companyId) as any).tenant_id;
    rawDb()
      .prepare(
        `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, target_id, payload_json, prev_hash, hash, created_at)
         VALUES (?, ?, 'u_x', 'founder_invitation.handoff', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `al_rev_${Math.random().toString(16).slice(2)}`, tenant,
        `founder_invitation:${invite.id}`, invite.id,
        JSON.stringify({ mode: "smtp", result: "accepted", secret: "s3cr3t", smtpPassword: "p", error: "RAW_ERROR" }),
        "0".repeat(64), "f".repeat(64), new Date(Date.now() + 60_000).toISOString(),
      );
    const status = await get(invitePath(companyId));
    const handoff = status.body.invitation.handoff;
    expect(Object.keys(handoff).sort()).toEqual(["mode", "result"]);
    expect(JSON.stringify(status.body)).not.toContain("s3cr3t");
  });
});

describe("A1 · cross-partner and role guards", () => {
  it("a partner with no relationship gets 404 on read and on correction (no existence oracle)", async () => {
    const created = await createCompany("victim@example.com");
    const companyId = created.body.companyId;
    const read = await get(invitePath(companyId), ACTOR_B);
    expect(read.status).toBe(404);
    expect(read.body.error).toBe("PORTFOLIO_COMPANY_NOT_FOUND");
    const write = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: created.body.founderInvite.id,
      founderEmail: "attacker@bravo.example", founderName: "A", ...authority,
    }, ACTOR_B);
    expect(write.status).toBe(404);
    expect(ownerRows(companyId).some((r) => r.invited_email === "attacker@bravo.example")).toBe(false);
    // Unknown company id must answer identically to a foreign one.
    expect((await get(invitePath("co_does_not_exist"), ACTOR_B)).status).toBe(404);
  });

  it("a viewer sub-role may read status but cannot correct it, and canReissue is role-aware", async () => {
    const created = await createCompany();
    const companyId = created.body.companyId;
    const read = await get(invitePath(companyId), VIEWER_A);
    expect(read.status).toBe(200);
    expect(read.body.canReissue).toBe(false);
    const write = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: created.body.founderInvite.id,
      founderEmail: "viewer@example.com", founderName: "V", ...authority,
    }, VIEWER_A);
    expect(write.status).toBe(403);
    expect(ownerRows(companyId).some((r) => r.invited_email === "viewer@example.com")).toBe(false);
  });

  it("the Wave 214 authority confirmation is fail-closed on correction", async () => {
    const created = await createCompany();
    const companyId = created.body.companyId;
    const missing = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: created.body.founderInvite.id,
      founderEmail: "noauth@example.com", founderName: "N",
    });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    const tampered = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: created.body.founderInvite.id,
      founderEmail: "tampered@example.com", founderName: "T",
      authorityTypedName: "Test Partner", authorityStatementShown: `${statement} (edited)`,
    });
    expect(tampered.status).toBeGreaterThanOrEqual(400);
    expect(ownerRows(companyId).some((r) => ["noauth@example.com", "tampered@example.com"].includes(r.invited_email)))
      .toBe(false);
  });

  it("REGRESSION (A1-F1 · CRITICAL, converted): a pipeline row grants a foreign partner nothing — 404 on read and on reissue, nothing mutated", async () => {
    const created = await createCompany("real.founder@example.com");
    const companyId = created.body.companyId;
    const victimInvite = created.body.founderInvite;

    // Partner B has no attribution, no link, no portfolio row. It creates its OWN
    // pipeline deal naming the victim companyId — POST /api/partner/me/pipeline
    // still validates dealName and stage only (partner tracking is deliberately
    // unchanged), so the CRM-breadth predicate still turns true for an arbitrary
    // company. Authority must no longer follow it.
    const claimed = await post("/api/partner/me/pipeline", { dealName: "Borrowed deal", companyId, stage: "invited" }, ACTOR_B);
    expect(claimed.status).toBe(201);
    // Reproduce PRODUCTION durable persistence of the deal row (see A1_F1 spec):
    // storePersistenceShim's module-level `ensuredTables` memo suppresses the
    // CREATE for this handle, so the row is materialised here rather than
    // weakening the assertion. Payload is the store's own DTO, unmodified.
    rawDb().exec(`CREATE TABLE IF NOT EXISTS kv_partnerPipeline (id TEXT PRIMARY KEY NOT NULL, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);`);
    rawDb().prepare("INSERT OR REPLACE INTO kv_partnerPipeline (id, payload_json, updated_at, deleted_at) VALUES (?,?,?,NULL)")
      .run(claimed.body.deal.id, JSON.stringify(claimed.body.deal), new Date().toISOString());
    const auditBefore = rawDb().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number };
    const sendsBefore = smtp.sendMail.mock.calls.length;

    // 1) No third-party identity leak: 404, not 403/409, so no existence oracle.
    const leak = await get(invitePath(companyId), ACTOR_B);
    expect(leak.status).toBe(404);
    expect(leak.body).toEqual({ error: "PORTFOLIO_COMPANY_NOT_FOUND" });
    expect(JSON.stringify(leak.body)).not.toContain("real.founder@example.com");

    // 2) No capture: the reissue path refuses before any write.
    const capture = await post(`${invitePath(companyId)}/reissue`, {
      expectedInvitationId: victimInvite.id,
      founderEmail: "attacker@bravo.example", founderName: "Attacker",
      ...authority, authorityTypedName: "Reviewer Bravo",
    }, ACTOR_B);
    expect(capture.status).toBe(404);
    expect(capture.body).toEqual({ error: "PORTFOLIO_COMPANY_NOT_FOUND" });

    // 3) The genuine invitation is untouched, no replacement row exists, no audit
    //    row was appended and no mail was handed off.
    const rows = ownerRows(companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(victimInvite.id);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].invited_email).toBe("real.founder@example.com");
    expect(invitationRow(victimInvite.id).token_hash).toBe(invitationRow(victimInvite.id).token_hash);
    expect((rawDb().prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n).toBe(auditBefore.n);
    expect(smtp.sendMail.mock.calls.length).toBe(sendsBefore);

    // 4) The legitimate originator is unaffected by the fence.
    const owner = await get(invitePath(companyId), ACTOR_A);
    expect(owner.status).toBe(200);
    expect(owner.body.invitation.email).toBe("real.founder@example.com");
  });

  it("PROOF OF DEFECT (A1-F2): nothing rate-limits corrections, so one company can be used to mail a third party repeatedly", async () => {
    const created = await createCompany();
    const companyId = created.body.companyId;
    let expected = created.body.founderInvite.id;
    const sentTo: string[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await post(`${invitePath(companyId)}/reissue`, {
        expectedInvitationId: expected, founderEmail: "target@example.com", founderName: "T", ...authority,
      });
      expect(res.status).toBe(201);
      expected = res.body.founderInvite.id;
      sentTo.push(res.body.founderInvite.email);
    }
    // Six fresh tokens minted and six handoffs attempted at the same address, with
    // no per-company or per-recipient throttle on the route itself; the only bound
    // is the process-wide 30-token transport bucket shared with all other mail.
    expect(sentTo.filter((e) => e === "target@example.com")).toHaveLength(6);
    expect(ownerRows(companyId).filter((r) => r.status === "revoked")).toHaveLength(6);
  });
});

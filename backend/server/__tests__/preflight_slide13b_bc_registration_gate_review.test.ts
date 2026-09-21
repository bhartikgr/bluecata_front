/**
 * INDEPENDENT REVIEWER TESTS — slide13b Wave B/C registration predicate and the
 * three registration-gated partner write routes.
 *
 * Reviewer-owned, additive, adversarial. No product source, gate, registry or
 * baseline is modified. Fixtures are written straight into the isolated
 * in-memory test DB so each provenance/identity SHAPE is exercised against SQL
 * rather than against any cache or store convenience path.
 *
 * Contract under review (server/lib/companyOnboardingState.ts,
 * server/managedFounderRoutes.ts):
 *   R1 partner-origin company is `registered` ONLY when an ACCEPTED owner
 *      invitation is matched by a live, non-placeholder owner membership whose
 *      users.email, founder_team_members.email and owner team role all agree.
 *   R2 a partner-origin company with only a PENDING owner invitation is
 *      `pending` — never registered, never silently manageable.
 *   R3 a REVOKED owner invitation does not erase partner provenance: the company
 *      must not fall through to the legacy branch and self-promote to
 *      `registered`.
 *   R4 legacy (non-partner) origin with a durable owner membership is
 *      `registered`; a `u_pending_founder_*` placeholder membership is
 *      `indeterminate`, not registered.
 *   R5 multi-role is legitimate: the same human holding an additional
 *      membership/role elsewhere must NOT be excluded from being the registered
 *      founder.
 *   R6 a read failure is an ERROR, never a comfortable empty/unregistered
 *      answer (CompanyOnboardingUnavailableError → 503 at the route).
 *   R7 the three write routes: engagement creation is gated on an attributed
 *      AND registered company; graduation and SPV-on-behalf derive the companyId
 *      from the partner-OWNED engagement and ignore any body-supplied companyId.
 *
 * Run:
 *   cd /home/user/workspace/work && NODE_ENV=test npx vitest run \
 *     server/__tests__/preflight_slide13b_bc_registration_gate_review.test.ts \
 *     --maxWorkers=1
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import { rawDb } from "../db/connection";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerMfcrmRoutes } from "../managedFounderRoutes";
import { applyMfcrmSchema } from "../lib/mfcrmSchema";
import { managedFounderStore } from "../managedFounderStore";
import { seedTestPartnerSandbox, partnerAttributionStore } from "../partnerWorkspaceStore";
import {
  readCompanyOnboardingState,
  requireRegisteredCompany,
  CompanyOnboardingUnavailableError,
} from "../lib/companyOnboardingState";

const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const ACTOR = "u_avi_managing";

let app: express.Express;

function db(): any {
  return rawDb();
}

function hex(n = 4): string {
  return crypto.randomBytes(n).toString("hex");
}

function insertCompany(): { companyId: string; tenantId: string } {
  const companyId = `co_bcrev_${hex()}`;
  const tenantId = `tenant_co_${companyId}`;
  db()
    .prepare(
      `INSERT INTO companies (id, tenant_id, name, legal_name, is_demo)
         VALUES (?, ?, ?, ?, 0)`,
    )
    .run(companyId, tenantId, "BC Review Co", "BC Review Co Ltd");
  return { companyId, tenantId };
}

/** Partner provenance via the audit origin, exactly as the create flow records it. */
function insertPartnerOriginAudit(companyId: string, tenantId: string): void {
  db()
    .prepare(
      `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, target_id, payload_json, prev_hash, hash, created_at)
         VALUES (?, ?, ?, 'company.created', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `al_bcrev_${hex(6)}`,
      tenantId,
      "partner@test.example",
      `company:${companyId}`,
      companyId,
      JSON.stringify({ companyId, origin: "partner_portfolio" }),
      "0".repeat(64),
      "f".repeat(64),
      new Date().toISOString(),
    );
}

function insertOwnerInvitation(
  companyId: string,
  email: string,
  status: "pending" | "accepted" | "revoked",
): string {
  const id = `fti_bcrev_${hex(6)}`;
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO founder_team_invitations
         (id, company_id, invited_by_user_id, invited_email, invited_name, role, status, token_hash, expires_at, created_at, accepted_at)
       VALUES (?, ?, ?, ?, 'BC Owner', 'owner', ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      companyId,
      "u_partner_actor_bcrev",
      email,
      status,
      crypto.randomBytes(16).toString("hex"),
      new Date(Date.now() + 7 * 864e5).toISOString(),
      now,
      status === "accepted" ? now : null,
    );
  return id;
}

/** A durable owner identity: users row + active founder membership + owner team tag. */
function insertOwnerIdentity(
  companyId: string,
  tenantId: string,
  email: string,
  opts: { role?: string; teamRole?: string; teamEmail?: string; userId?: string } = {},
): string {
  const userId = opts.userId ?? `u_bcrev_${hex()}`;
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?, ?, ?, ?, 'founder', 0)`,
    )
    .run(userId, tenantId, email, "BC Owner");
  db()
    .prepare(
      `INSERT INTO company_members (id, company_id, user_id, role, tenant_id, is_active, joined_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(`cm_bcrev_${hex()}`, companyId, userId, opts.role ?? "founder", tenantId, now);
  db()
    .prepare(
      `INSERT INTO founder_team_members (id, company_id, user_id, email, role, joined_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`ftm_bcrev_${hex()}`, companyId, userId, opts.teamEmail ?? email, opts.teamRole ?? "owner", now);
  return userId;
}

function insertPlaceholderMembership(companyId: string, tenantId: string): void {
  db()
    .prepare(
      `INSERT INTO company_members (id, company_id, user_id, role, tenant_id, is_active, joined_at)
         VALUES (?, ?, ?, 'founder', ?, 1, ?)`,
    )
    .run(`cm_bcrev_${hex()}`, companyId, `u_pending_founder_${hex(8)}`, tenantId, new Date().toISOString());
}

/** Registered, partner-attributed company ready for the MFCRM routes. */
function registeredPartnerCompany(): { companyId: string; email: string; userId: string } {
  const { companyId, tenantId } = insertCompany();
  const email = `bcrev_${hex()}@test.example`;
  insertPartnerOriginAudit(companyId, tenantId);
  insertOwnerInvitation(companyId, email, "accepted");
  const userId = insertOwnerIdentity(companyId, tenantId, email);
  partnerAttributionStore.create(PARTNER_A, companyId, ACTOR, "partner_portfolio");
  return { companyId, email, userId };
}

beforeAll(() => {
  // These two tables are created lazily by founderTeamStore.ensureTables() in the
  // full app boot; this bounded harness registers only partner + MFCRM routes, so
  // the fixtures create them with the SAME shape (server/lib/founderTeamStore.ts).
  db().exec(`CREATE TABLE IF NOT EXISTS founder_team_invitations (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, invited_by_user_id TEXT NOT NULL,
    invited_email TEXT NOT NULL, invited_name TEXT, role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'pending', token_hash TEXT NOT NULL, expires_at TEXT,
    created_at TEXT NOT NULL, accepted_at TEXT, deleted_at TEXT, sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS founder_team_members (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, user_id TEXT NOT NULL,
    email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', joined_at TEXT NOT NULL,
    removed_at TEXT
  );`);

  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerMfcrmRoutes(app);
  applyMfcrmSchema();
  seedTestPartnerSandbox({ force: true });
  managedFounderStore.setCapabilityProfile(
    PARTNER_A,
    { classified: true, sourcesCapital: true, delegatedAgency: true, spvWriteAuthority: true, collectiveFronting: true },
    ACTOR,
  );
});

describe("slide13b B/C — registration predicate", () => {
  it("R1: accepted owner invitation matched by a live owner membership is registered", () => {
    const { companyId, email, userId } = registeredPartnerCompany();
    const state = readCompanyOnboardingState(companyId);
    expect(state.state).toBe("registered");
    expect(state.origin).toBe("partner_portfolio");
    expect(state.reason).toBe("accepted_owner_identity_matched");
    expect(state.registeredFounders.map((f) => f.userId)).toContain(userId);
    expect(state.registeredFounders[0]?.email).toBe(email);
    // The invited email must not leak unless explicitly requested.
    expect(state.ownerInvitation?.email).toBeUndefined();
    expect(readCompanyOnboardingState(companyId, { includeInvitationEmail: true }).ownerInvitation?.email)
      .toBe(email);
  });

  it("R1-adversarial: an accepted invitation whose email does NOT match the membership is not registered", () => {
    const { companyId, tenantId } = insertCompany();
    insertPartnerOriginAudit(companyId, tenantId);
    insertOwnerInvitation(companyId, `invited_${hex()}@test.example`, "accepted");
    insertOwnerIdentity(companyId, tenantId, `someone_else_${hex()}@test.example`);
    const state = readCompanyOnboardingState(companyId);
    expect(state.state).not.toBe("registered");
    expect(state.state).toBe("indeterminate");
    expect(state.reason).toBe("owner_identity_not_verified");
    expect(state.registeredFounders).toHaveLength(0);
  });

  it("R1-adversarial: a matching membership whose TEAM role is not owner is not registered", () => {
    const { companyId, tenantId } = insertCompany();
    const email = `bcrev_${hex()}@test.example`;
    insertPartnerOriginAudit(companyId, tenantId);
    insertOwnerInvitation(companyId, email, "accepted");
    insertOwnerIdentity(companyId, tenantId, email, { teamRole: "member" });
    const state = readCompanyOnboardingState(companyId);
    expect(state.state).toBe("indeterminate");
    expect(state.registeredFounders).toHaveLength(0);
  });

  it("R2: partner-origin with only a pending owner invitation is pending, not registered", () => {
    const { companyId, tenantId } = insertCompany();
    insertPartnerOriginAudit(companyId, tenantId);
    insertOwnerInvitation(companyId, `bcrev_${hex()}@test.example`, "pending");
    insertPlaceholderMembership(companyId, tenantId);
    const state = readCompanyOnboardingState(companyId);
    expect(state.state).toBe("pending");
    expect(state.origin).toBe("partner_portfolio");
    expect(state.reason).toBe("owner_invitation_pending");
    expect(state.registeredFounders).toHaveLength(0);
  });

  it("R3: a revoked owner invitation keeps partner provenance and does not self-promote", () => {
    const { companyId, tenantId } = insertCompany();
    insertPartnerOriginAudit(companyId, tenantId);
    insertOwnerInvitation(companyId, `bcrev_${hex()}@test.example`, "revoked");
    const state = readCompanyOnboardingState(companyId);
    expect(state.origin).toBe("partner_portfolio");
    expect(state.state).toBe("indeterminate");
    expect(state.reason).toBe("owner_identity_not_verified");
  });

  it("R3-b: provenance survives on the attribution row alone (no audit origin present)", () => {
    const { companyId } = insertCompany();
    partnerAttributionStore.create(PARTNER_A, companyId, ACTOR, "partner_portfolio");
    const state = readCompanyOnboardingState(companyId);
    expect(state.origin).toBe("partner_portfolio");
    expect(state.state).toBe("indeterminate");
  });

  it("R3-c: an unrelated attribution source does NOT fabricate partner provenance", () => {
    const { companyId, tenantId } = insertCompany();
    partnerAttributionStore.create(PARTNER_A, companyId, ACTOR, "admin_manual");
    const email = `bcrev_${hex()}@test.example`;
    insertOwnerIdentity(companyId, tenantId, email);
    const state = readCompanyOnboardingState(companyId);
    expect(state.origin).toBe("legacy");
    expect(state.state).toBe("registered");
    expect(state.reason).toBe("legacy_persisted_owner_membership");
  });

  it("R4: legacy durable owner membership is registered; a placeholder membership is not", () => {
    const legacy = insertCompany();
    insertOwnerIdentity(legacy.companyId, legacy.tenantId, `bcrev_${hex()}@test.example`);
    const okState = readCompanyOnboardingState(legacy.companyId);
    expect(okState.state).toBe("registered");
    expect(okState.origin).toBe("legacy");

    const ghost = insertCompany();
    insertPlaceholderMembership(ghost.companyId, ghost.tenantId);
    const ghostState = readCompanyOnboardingState(ghost.companyId);
    expect(ghostState.state).toBe("indeterminate");
    expect(ghostState.reason).toBe("legacy_origin_ambiguous");
    expect(ghostState.registeredFounders).toHaveLength(0);
  });

  it("R4-b: a placeholder membership alongside a real matched owner still resolves registered", () => {
    const { companyId, tenantId } = insertCompany();
    const email = `bcrev_${hex()}@test.example`;
    insertPartnerOriginAudit(companyId, tenantId);
    insertOwnerInvitation(companyId, email, "accepted");
    insertOwnerIdentity(companyId, tenantId, email);
    insertPlaceholderMembership(companyId, tenantId); // partner-era ghost row left behind
    const state = readCompanyOnboardingState(companyId);
    expect(state.state).toBe("registered");
    expect(state.registeredFounders).toHaveLength(1);
    expect(state.registeredFounders[0].userId.startsWith("u_pending_founder_")).toBe(false);
  });

  it("R5: multi-role is not an exclusion — a founder who also holds another membership counts", () => {
    const { companyId, tenantId } = insertCompany();
    const email = `bcrev_${hex()}@test.example`;
    insertPartnerOriginAudit(companyId, tenantId);
    insertOwnerInvitation(companyId, email, "accepted");
    const userId = insertOwnerIdentity(companyId, tenantId, email);
    // Same human, second hat: an admin membership in an unrelated company/tenant.
    const other = insertCompany();
    db()
      .prepare(
        `INSERT INTO company_members (id, company_id, user_id, role, tenant_id, is_active, joined_at)
           VALUES (?, ?, ?, 'admin', ?, 1, ?)`,
      )
      .run(`cm_bcrev_${hex()}`, other.companyId, userId, other.tenantId, new Date().toISOString());
    // …and a partner-side attribution actor role for the same identity.
    partnerAttributionStore.create(PARTNER_A, other.companyId, userId, "partner_portfolio");

    const state = readCompanyOnboardingState(companyId);
    expect(state.state).toBe("registered");
    expect(state.registeredFounders.map((f) => f.userId)).toContain(userId);
    // The unrelated company must not inherit registration from the shared human.
    expect(readCompanyOnboardingState(other.companyId).state).not.toBe("registered");
  });

  it("R5-b: co_founder is an accepted owner role, and a removed team tag is not a match", () => {
    const co = insertCompany();
    const email = `bcrev_${hex()}@test.example`;
    insertPartnerOriginAudit(co.companyId, co.tenantId);
    insertOwnerInvitation(co.companyId, email, "accepted");
    insertOwnerIdentity(co.companyId, co.tenantId, email, { role: "co_founder" });
    expect(readCompanyOnboardingState(co.companyId).state).toBe("registered");

    const removed = insertCompany();
    const email2 = `bcrev_${hex()}@test.example`;
    insertPartnerOriginAudit(removed.companyId, removed.tenantId);
    insertOwnerInvitation(removed.companyId, email2, "accepted");
    const uid = insertOwnerIdentity(removed.companyId, removed.tenantId, email2);
    db().prepare(`UPDATE founder_team_members SET removed_at = ? WHERE user_id = ?`)
      .run(new Date().toISOString(), uid);
    const state = readCompanyOnboardingState(removed.companyId);
    expect(state.state).toBe("indeterminate");
    expect(state.registeredFounders).toHaveLength(0);
  });

  it("R6: a read failure raises the unavailable error instead of answering 'not registered'", () => {
    const { companyId, tenantId } = insertCompany();
    const email = `bcrev_${hex()}@test.example`;
    insertPartnerOriginAudit(companyId, tenantId);
    insertOwnerInvitation(companyId, email, "accepted");
    insertOwnerIdentity(companyId, tenantId, email);
    expect(readCompanyOnboardingState(companyId).state).toBe("registered");

    // Break exactly one dependency the predicate needs, then restore it.
    db().exec(`ALTER TABLE founder_team_invitations RENAME TO founder_team_invitations_bcrev_tmp`);
    try {
      let thrown: unknown;
      try {
        readCompanyOnboardingState(companyId);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, "a broken read must not resolve to a state at all").toBeInstanceOf(
        CompanyOnboardingUnavailableError,
      );
      expect((thrown as any).code).toBe("COMPANY_ONBOARDING_UNAVAILABLE");
      // The gate must also refuse, and must not report a registered/empty answer.
      let gateErr: any;
      try {
        requireRegisteredCompany(companyId);
      } catch (e) {
        gateErr = e;
      }
      expect(gateErr).toBeInstanceOf(CompanyOnboardingUnavailableError);
    } finally {
      db().exec(`ALTER TABLE founder_team_invitations_bcrev_tmp RENAME TO founder_team_invitations`);
    }
    expect(readCompanyOnboardingState(companyId).state).toBe("registered");
  });

  it("R6-b: an unknown companyId is reported as unavailable (observed, not silently 'pending')", () => {
    let thrown: unknown;
    try {
      readCompanyOnboardingState(`co_does_not_exist_${hex()}`);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CompanyOnboardingUnavailableError);
    // NOTE for the record: a nonexistent company and a genuine read outage share
    // one error code here, so the route answers 503 for a 404 condition.
  });
});

describe("slide13b B/C — the three registration-gated write routes", () => {
  it("R7-a: engagement creation is refused for an attributed but UNREGISTERED company", async () => {
    const { companyId, tenantId } = insertCompany();
    insertPartnerOriginAudit(companyId, tenantId);
    insertOwnerInvitation(companyId, `bcrev_${hex()}@test.example`, "pending");
    partnerAttributionStore.create(PARTNER_A, companyId, ACTOR, "partner_portfolio");

    const res = await request(app)
      .post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", ACTOR)
      .send({ companyId });
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("COMPANY_NOT_REGISTERED");
    expect(managedFounderStore.listEngagements(PARTNER_A).some((e: any) => e.companyId === companyId)).toBe(false);
  });

  it("R7-b: engagement creation succeeds once the founder is genuinely registered", async () => {
    const { companyId } = registeredPartnerCompany();
    const res = await request(app)
      .post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", ACTOR)
      .send({ companyId });
    expect(res.status).toBe(201);
    expect(res.body?.engagement?.companyId).toBe(companyId);
  });

  it("R7-c: an unattributed company is 404 before any registration answer is given", async () => {
    const { companyId } = insertCompany();
    const res = await request(app)
      .post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", ACTOR)
      .send({ companyId });
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("COMPANY_NOT_FOUND_OR_NOT_ATTRIBUTED");
  });

  it("R7-d: graduate/SPV ignore a body companyId and use the partner-owned engagement's company", async () => {
    // An engagement whose company is NOT registered (pre-gate history: created
    // directly in the store, which the route gate cannot retroactively prevent).
    const stale = insertCompany();
    insertPartnerOriginAudit(stale.companyId, stale.tenantId);
    insertOwnerInvitation(stale.companyId, `bcrev_${hex()}@test.example`, "pending");
    partnerAttributionStore.create(PARTNER_A, stale.companyId, ACTOR, "partner_portfolio");
    const staleEngagement = managedFounderStore.createEngagement(
      PARTNER_A,
      { companyId: stale.companyId, mode: "B", authorityArtifactRef: null, authorityExpiresAt: null, chapterId: null, matterId: null },
      ACTOR,
    );
    // A genuinely registered company the attacker would like the gate to look at.
    const decoy = registeredPartnerCompany();

    const grad = await request(app)
      .post("/api/partner/me/mfcrm/graduate")
      .set("x-user-id", ACTOR)
      .send({ engagementId: staleEngagement.id, companyId: decoy.companyId, invitationId: "x", roundId: "x", investorId: "x", amount: "1000", shares: "10" });
    expect(grad.status).toBe(403);
    expect(grad.body?.error).toBe("COMPANY_NOT_REGISTERED");

    const spv = await request(app)
      .post("/api/partner/me/mfcrm/spv-on-behalf")
      .set("x-user-id", ACTOR)
      .send({ engagementId: staleEngagement.id, companyId: decoy.companyId, name: "Spoof SPV", jurisdiction: "DE", carryBasis: "whole_fund" });
    // Either the signed-agreement gate or the registration gate must refuse; in
    // no case may the decoy company be used.
    expect([403, 409, 422]).toContain(spv.status);
    expect(spv.body?.error).not.toBe(undefined);
    expect(JSON.stringify(spv.body)).not.toContain(decoy.companyId);
  });

  it("R7-e: another partner's engagementId is 404, never a registration verdict", async () => {
    const { companyId } = registeredPartnerCompany();
    const created = await request(app)
      .post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", ACTOR)
      .send({ companyId });
    expect(created.status).toBe(201);
    const engagementId = created.body.engagement.id;

    const res = await request(app)
      .post("/api/partner/me/mfcrm/graduate")
      .set("x-user-id", "u_admin") // not Partner A's managing persona
      .send({ engagementId, invitationId: "x", roundId: "x", investorId: "x", amount: "1000", shares: "10" });
    expect([401, 403, 404]).toContain(res.status);
    expect(String(res.body?.error ?? "")).not.toBe("COMPANY_NOT_REGISTERED");
  });
});

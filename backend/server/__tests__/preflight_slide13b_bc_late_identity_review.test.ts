/**
 * INDEPENDENT REVIEWER TESTS — slide13b B/C late identity change (email drift).
 *
 * Question under review: the accepted-owner predicate currently requires
 *   lower(invite.invited_email) == lower(users.email) == lower(ftm.email)
 * (server/lib/companyOnboardingState.ts:121-129). If a legitimately registered
 * founder later changes their login/profile email, does the company silently
 * DE-REGISTER?
 *
 * Source trace (read-only, independently confirmed):
 *   - `PATCH /api/auth/me` (server/routes.ts:6941) accepts `body.email`, lowercases
 *     it and write-throughs to `users.email` (canonicalPatch.email, ~:7006-7025).
 *     It updates NOTHING else: no `founder_team_members`, no `user_credentials`.
 *   - The ONLY UPDATE against `founder_team_members` in the tree sets `removed_at`
 *     (server/lib/founderTeamStore.ts:334). `ftm.email` is therefore immutable
 *     after creation.
 *   - `ftm.email` is written once, inside the redeem transaction, from the
 *     INVITATION's address (`const email = row.invited_email...` teamInviteRedeem.ts:223,
 *     inserted at :417-421). It is a historical snapshot of the invited address.
 *   - The membership join already binds the immutable persona
 *     (`ftm.user_id = cm.user_id`, companyOnboardingState.ts:78-81).
 *
 * Status at run time: the amendment is ALREADY IN THE TREE
 * (companyOnboardingState.ts sha256 51bdc2a65a803d45ea5b7d89a6681fc507654bb8818ed3aff8a89e1e24e9f501
 * matches on lower(invite.invited_email) == lower(ftm.email) with the persona
 * bound by ftm.user_id = cm.user_id, and no current-email equality). The first
 * test is therefore the REGRESSION for the drift defect; the rest are independent
 * over-admission controls on the new binding, expressed against a locally
 * reimplemented copy of the rule so the two derivations must agree.
 *
 * Reviewer-owned, additive. No product source edited.
 *
 * Run:
 *   cd /home/user/workspace/work && NODE_ENV=test npx vitest run \
 *     server/__tests__/preflight_slide13b_bc_late_identity_review.test.ts --maxWorkers=1
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
import { readCompanyOnboardingState } from "../lib/companyOnboardingState";

const PARTNER = "ac_consortium_partner_test_partner_inc";
const ACTOR = "u_avi_managing";
let app: express.Express;

const db = (): any => rawDb();
const hex = (n = 4) => crypto.randomBytes(n).toString("hex");

function company(): { companyId: string; tenantId: string } {
  const companyId = `co_lateid_${hex()}`;
  const tenantId = `tenant_co_${companyId}`;
  db().prepare(`INSERT INTO companies (id, tenant_id, name, legal_name, is_demo) VALUES (?,?,?,?,0)`)
    .run(companyId, tenantId, "Late Identity Co", "Late Identity Co Ltd");
  db().prepare(
    `INSERT INTO audit_log (id, tenant_id, actor_id, action, target, target_id, payload_json, prev_hash, hash, created_at)
     VALUES (?,?,?, 'company.created', ?, ?, ?, ?, ?, ?)`,
  ).run(`al_lid_${hex(6)}`, tenantId, "partner@test.example", `company:${companyId}`, companyId,
    JSON.stringify({ companyId, origin: "partner_portfolio" }), "0".repeat(64), "f".repeat(64), new Date().toISOString());
  partnerAttributionStore.create(PARTNER, companyId, ACTOR, "partner_portfolio");
  return { companyId, tenantId };
}

function acceptedOwnerInvite(companyId: string, email: string, role = "owner"): string {
  const id = `fti_lid_${hex(6)}`;
  const now = new Date().toISOString();
  db().prepare(
    `INSERT INTO founder_team_invitations
       (id, company_id, invited_by_user_id, invited_email, invited_name, role, status, token_hash, expires_at, created_at, accepted_at)
     VALUES (?,?,?,?, 'Owner', ?, 'accepted', ?, ?, ?, ?)`,
  ).run(id, companyId, "u_partner_actor_lid", email, role, hex(16), new Date(Date.now() + 864e5).toISOString(), now, now);
  return id;
}

/** The claim outcome exactly as teamInviteRedeem writes it: ftm.email = invited email. */
function claimedOwner(companyId: string, tenantId: string, invitedEmail: string,
  opts: { teamRole?: string; ftmUserId?: string } = {}): string {
  const userId = `u_lid_${hex()}`;
  const now = new Date().toISOString();
  db().prepare(`INSERT INTO users (id, tenant_id, email, name, role, is_demo) VALUES (?,?,?,?, 'founder', 0)`)
    .run(userId, tenantId, invitedEmail, "Real Founder");
  db().prepare(
    `INSERT INTO company_members (id, company_id, user_id, role, tenant_id, is_active, joined_at)
     VALUES (?,?,?, 'co_founder', ?, 1, ?)`,
  ).run(`cm_lid_${hex()}`, companyId, userId, tenantId, now);
  db().prepare(
    `INSERT INTO founder_team_members (id, company_id, user_id, email, role, joined_at) VALUES (?,?,?,?,?,?)`,
  ).run(`ftm_lid_${hex()}`, companyId, opts.ftmUserId ?? userId, invitedEmail, opts.teamRole ?? "owner", now);
  return userId;
}

/** Exactly what PATCH /api/auth/me writes (server/routes.ts canonicalPatch). */
function patchAuthMeEmail(userId: string, newEmail: string): void {
  db().prepare("UPDATE users SET email = ? WHERE id = ?").run(newEmail.trim().toLowerCase(), userId);
}

/**
 * The PARENT-APPROVED replacement binding, expressed independently here so it can
 * be evaluated against the same fixtures before any product change:
 *   accepted owner invitation .invited_email == ftm.email   (history, immutable)
 *   AND ftm.user_id == cm.user_id == users.id               (immutable persona)
 *   AND cm active, non-deleted, founder/co_founder, ftm live and owner-role
 * No equality against the CURRENT users.email.
 */
function proposedRegisteredFounders(companyId: string): string[] {
  return db().prepare(`
    SELECT cm.user_id AS user_id
    FROM company_members cm
    JOIN founder_team_members ftm
      ON ftm.company_id = cm.company_id AND ftm.user_id = cm.user_id AND ftm.removed_at IS NULL
    JOIN users u ON u.id = cm.user_id
    JOIN founder_team_invitations fti
      ON fti.company_id = cm.company_id AND lower(fti.role) = 'owner'
     AND lower(fti.status) = 'accepted' AND fti.accepted_at IS NOT NULL AND fti.deleted_at IS NULL
     AND lower(fti.invited_email) = lower(ftm.email)
    WHERE cm.company_id = ? AND cm.is_active = 1 AND cm.deleted_at IS NULL
      AND lower(cm.role) IN ('founder','co_founder')
      AND lower(ftm.role) = 'owner'
      AND cm.user_id NOT LIKE 'u_pending_founder_%'
  `).all(companyId).map((r: any) => String(r.user_id));
}

beforeAll(() => {
  db().exec(`CREATE TABLE IF NOT EXISTS founder_team_invitations (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, invited_by_user_id TEXT NOT NULL,
    invited_email TEXT NOT NULL, invited_name TEXT, role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'pending', token_hash TEXT NOT NULL, expires_at TEXT,
    created_at TEXT NOT NULL, accepted_at TEXT, deleted_at TEXT, sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS founder_team_members (
    id TEXT PRIMARY KEY NOT NULL, company_id TEXT NOT NULL, user_id TEXT NOT NULL,
    email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', joined_at TEXT NOT NULL, removed_at TEXT
  );`);
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerMfcrmRoutes(app);
  applyMfcrmSchema();
  seedTestPartnerSandbox({ force: true });
  managedFounderStore.setCapabilityProfile(PARTNER,
    { classified: true, sourcesCapital: true, delegatedAgency: true, spvWriteAuthority: true, collectiveFronting: true },
    ACTOR);
});

describe("B/C late identity change", () => {
  it("REGRESSION (was the confirmed gap): a self-service email change must NOT de-register a claimed company", async () => {
    const { companyId, tenantId } = company();
    const invited = `founder_${hex()}@example.com`;
    acceptedOwnerInvite(companyId, invited);
    const userId = claimedOwner(companyId, tenantId, invited);

    const before = readCompanyOnboardingState(companyId);
    expect(before.state).toBe("registered");
    expect(before.registeredFounders.map((f) => f.userId)).toEqual([userId]);

    // The founder updates their profile email — the one write PATCH /api/auth/me makes.
    patchAuthMeEmail(userId, `Founder.New_${hex()}@example.com`);
    // Nothing else moved: the historical team row is untouched by every path in the tree.
    const ftm = db().prepare("SELECT email, role FROM founder_team_members WHERE user_id = ?").get(userId);
    expect(ftm.email).toBe(invited);
    expect(ftm.role).toBe("owner");

    const after = readCompanyOnboardingState(companyId);
    expect(after.state).toBe("registered");
    expect(after.reason).toBe("accepted_owner_identity_matched");
    expect(after.registeredFounders.map((f) => f.userId)).toEqual([userId]);
    // The reported founder email is the LIVE canonical one, not the historical
    // invitation address — history binds identity, it does not freeze the profile.
    expect(after.registeredFounders[0].email).not.toBe(invited);

    // And the money route stays open for a client that IS claimed.
    const res = await request(app).post("/api/partner/me/mfcrm/engagements")
      .set("x-user-id", ACTOR).send({ companyId });
    expect(res.status).toBe(201);
    expect(res.body.engagement.companyId).toBe(companyId);
  });

  it("the proposed history binding survives the same email change and names the same founder", () => {
    const { companyId, tenantId } = company();
    const invited = `founder_${hex()}@example.com`;
    acceptedOwnerInvite(companyId, invited);
    const userId = claimedOwner(companyId, tenantId, invited);
    expect(proposedRegisteredFounders(companyId)).toEqual([userId]);
    patchAuthMeEmail(userId, `changed_${hex()}@example.net`);
    expect(proposedRegisteredFounders(companyId)).toEqual([userId]); // unchanged
    // And it agrees with today's predicate whenever no drift has occurred.
    const fresh = company();
    const e2 = `founder_${hex()}@example.com`;
    acceptedOwnerInvite(fresh.companyId, e2);
    const u2 = claimedOwner(fresh.companyId, fresh.tenantId, e2);
    expect(readCompanyOnboardingState(fresh.companyId).registeredFounders.map((f) => f.userId)).toEqual([u2]);
    expect(proposedRegisteredFounders(fresh.companyId)).toEqual([u2]);
  });

  it("the proposed binding does not over-admit: only a PENDING invite, no claim, stays unregistered", () => {
    const { companyId } = company();
    const id = acceptedOwnerInvite(companyId, `pending_${hex()}@example.com`);
    db().prepare("UPDATE founder_team_invitations SET status='pending', accepted_at=NULL WHERE id=?").run(id);
    expect(proposedRegisteredFounders(companyId)).toEqual([]);
    expect(readCompanyOnboardingState(companyId).state).toBe("pending");
  });

  it("the proposed binding is company-scoped: another company's accepted invite cannot register this one", () => {
    const a = company();
    const shared = `shared_${hex()}@example.com`;
    acceptedOwnerInvite(a.companyId, shared);           // accepted owner invite on company A
    const b = company();
    const userId = claimedOwner(b.companyId, b.tenantId, shared); // same address, company B
    expect(proposedRegisteredFounders(b.companyId)).toEqual([]);
    expect(readCompanyOnboardingState(b.companyId).state).toBe("indeterminate");
    expect(proposedRegisteredFounders(a.companyId)).toEqual([]);
    expect(userId).toMatch(/^u_lid_/);
  });

  it("the proposed binding keeps the immutable persona join: a foreign ftm row cannot borrow the invite", () => {
    const { companyId, tenantId } = company();
    const invited = `founder_${hex()}@example.com`;
    acceptedOwnerInvite(companyId, invited);
    // The team row carries the invited address but belongs to a DIFFERENT persona
    // than the membership — ftm.user_id != cm.user_id.
    const userId = claimedOwner(companyId, tenantId, invited, { ftmUserId: `u_other_${hex()}` });
    expect(proposedRegisteredFounders(companyId)).toEqual([]);
    expect(readCompanyOnboardingState(companyId).registeredFounders).toHaveLength(0);
    expect(userId).toMatch(/^u_lid_/);
  });

  it("RESIDUAL (decision needed): a later non-owner invitation overwrites ftm.role/email and de-registers under BOTH rules", () => {
    const { companyId, tenantId } = company();
    const invited = `founder_${hex()}@example.com`;
    acceptedOwnerInvite(companyId, invited);
    const userId = claimedOwner(companyId, tenantId, invited);
    expect(proposedRegisteredFounders(companyId)).toEqual([userId]);

    // teamInviteRedeem's ON CONFLICT(company_id,user_id) DO UPDATE SET role =
    // excluded.role, email = excluded.email (teamInviteRedeem.ts:417-421) means the
    // SAME persona accepting a later 'member' invitation to the same company
    // downgrades the historical owner tag in place.
    const second = `alias_${hex()}@example.com`;
    acceptedOwnerInvite(companyId, second, "member");
    db().prepare("UPDATE founder_team_members SET role='member', email=? WHERE user_id=?").run(second, userId);

    expect(proposedRegisteredFounders(companyId)).toEqual([]);
    expect(readCompanyOnboardingState(companyId).state).toBe("indeterminate");
    // Owner decision: either make that conflict update non-downgrading for
    // role='owner', or bind registration to the accepted owner invitation's
    // redeeming persona rather than to the CURRENT ftm role/email.
  });
});

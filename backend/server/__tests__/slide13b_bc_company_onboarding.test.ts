import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { rawDb } from "../db/connection";
import {
  CompanyOnboardingUnavailableError,
  readCompanyOnboardingState,
} from "../lib/companyOnboardingState";
import { readFounderInvitationStatus } from "../lib/portfolioFounderInvitationService";

const db = rawDb();
let serial = 0;
const now = () => new Date().toISOString();
const id = (kind: string) => `bc_${kind}_${++serial}`;

function company() {
  const companyId = id("co");
  db.prepare("INSERT INTO companies (id,tenant_id,name,legal_name) VALUES (?,?,?,?)")
    .run(companyId, id("tenant"), "BC Company", "BC Company Ltd");
  return companyId;
}
function user(email: string) {
  const userId = id("user");
  db.prepare("INSERT INTO users (id,tenant_id,email,name,role) VALUES (?,?,?,?,?)")
    .run(userId, id("tenant"), email, "BC Founder", "founder");
  return userId;
}
function membership(companyId: string, userId: string) {
  const tenantId = (db.prepare("SELECT tenant_id FROM companies WHERE id=?").get(companyId) as { tenant_id: string }).tenant_id;
  db.prepare("INSERT INTO company_members (id,company_id,user_id,role,tenant_id,is_active) VALUES (?,?,?,'founder',?,1)")
    .run(id("cm"), companyId, userId, tenantId);
}
function invite(companyId: string, email: string, status = "pending") {
  const inviteId = id("invite");
  db.prepare(`INSERT INTO founder_team_invitations
    (id,company_id,invited_by_user_id,invited_email,invited_name,role,status,token_hash,expires_at,created_at,accepted_at)
    VALUES (?,?,?,?,'BC Founder','owner',?,?,?, ?,?)`)
    .run(inviteId, companyId, id("actor"), email, status, id("hash"),
      new Date(Date.now() + 86_400_000).toISOString(), now(), status === "accepted" ? now() : null);
  return inviteId;
}
function partnerOrigin(companyId: string, revoked = false) {
  db.prepare(`INSERT INTO partner_attributions
    (id,partner_id,company_id,attributed_at,attribution_source,revoked_at,updated_at)
    VALUES (?,?,?,?, 'partner_portfolio', ?,?)`)
    .run(id("pa"), id("partner"), companyId, now(), revoked ? now() : null, now());
}
function teamMember(companyId: string, userId: string, email: string) {
  db.prepare(`INSERT INTO founder_team_members
    (id,company_id,user_id,email,role,joined_at) VALUES (?,?,?,?, 'owner',?)`)
    .run(id("ftm"), companyId, userId, email, now());
}

beforeAll(() => {
  expect(process.env.NODE_ENV).toBe("test");
  expect(process.env.SMTP_MODE).toBe("dry_run");
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
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const table of ["founder_team_members", "founder_team_invitations", "company_members", "partner_attributions", "companies", "users"]) {
    db.prepare(`DELETE FROM ${table} WHERE id LIKE 'bc_%'`).run();
  }
});

describe("slide13b B/C company onboarding state", () => {
  it("keeps partner-origin pending, including when provenance is a revoked historical attribution", () => {
    const companyId = company();
    partnerOrigin(companyId, true);
    invite(companyId, "pending@test.example");
    const state = readCompanyOnboardingState(companyId, { includeInvitationEmail: true });
    expect(state.state).toBe("pending");
    expect(state.origin).toBe("partner_portfolio");
    expect(state.ownerInvitation?.email).toBe("pending@test.example");
  });

  it("requires accepted owner invite, live owner membership, user email and team email to match", () => {
    const companyId = company(), email = "owner@test.example", userId = user(email);
    partnerOrigin(companyId);
    invite(companyId, email, "accepted");
    membership(companyId, userId);
    teamMember(companyId, userId, "different@test.example");
    expect(readCompanyOnboardingState(companyId).state).toBe("indeterminate");
    db.prepare("UPDATE founder_team_members SET email=? WHERE company_id=?").run(email, companyId);
    expect(readCompanyOnboardingState(companyId).state).toBe("registered");
    invite(companyId, "second@test.example", "pending");
    expect(readCompanyOnboardingState(companyId).state).toBe("registered");
  });

  it("projects a pending owner invite ahead of a newer revoked history row", () => {
    const companyId = company();
    partnerOrigin(companyId);
    const pendingId = invite(companyId, "pending-primary@test.example", "pending");
    const revokedId = invite(companyId, "revoked-newer@test.example", "revoked");
    db.prepare("UPDATE founder_team_invitations SET created_at=? WHERE id=?")
      .run("2026-01-01T00:00:00.000Z", pendingId);
    db.prepare("UPDATE founder_team_invitations SET created_at=? WHERE id=?")
      .run("2026-02-01T00:00:00.000Z", revokedId);

    const state = readCompanyOnboardingState(companyId, { includeInvitationEmail: true });
    expect(state.state).toBe("pending");
    expect(state.ownerInvitation).toMatchObject({
      id: pendingId,
      status: "pending",
      email: "pending-primary@test.example",
    });
    expect(readFounderInvitationStatus(companyId).invitation).toMatchObject({
      id: pendingId,
      status: "pending",
      email: "pending-primary@test.example",
    });
  });

  it("projects an accepted owner invite ahead of newer terminal history without changing registration", () => {
    const companyId = company();
    const email = "accepted-primary@test.example";
    const userId = user(email);
    partnerOrigin(companyId);
    const acceptedId = invite(companyId, email, "accepted");
    const revokedId = invite(companyId, "revoked-newer@test.example", "revoked");
    db.prepare("UPDATE founder_team_invitations SET created_at=? WHERE id=?")
      .run("2026-01-01T00:00:00.000Z", acceptedId);
    db.prepare("UPDATE founder_team_invitations SET created_at=? WHERE id=?")
      .run("2026-02-01T00:00:00.000Z", revokedId);
    membership(companyId, userId);
    teamMember(companyId, userId, email);

    const state = readCompanyOnboardingState(companyId, { includeInvitationEmail: true });
    expect(state.state).toBe("registered");
    expect(state.ownerInvitation).toMatchObject({
      id: acceptedId,
      status: "accepted",
      email,
    });
    expect(readFounderInvitationStatus(companyId).invitation).toMatchObject({
      id: acceptedId,
      status: "accepted",
      email,
    });
  });

  it("binds accepted historical email to the same live owner user across canonical email changes", () => {
    const companyId = company();
    const historicalEmail = "historical-owner@test.example";
    const userId = user(historicalEmail);
    partnerOrigin(companyId);
    invite(companyId, historicalEmail, "accepted");
    membership(companyId, userId);
    teamMember(companyId, userId, historicalEmail);

    // 1: complete durable identity chain registers.
    expect(readCompanyOnboardingState(companyId).state).toBe("registered");

    // 2: a legitimate canonical user-email change preserves identity continuity
    // and displays the current address, not the historical invitation address.
    db.prepare("UPDATE users SET email=? WHERE id=?").run("current-owner@test.example", userId);
    const afterEmailChange = readCompanyOnboardingState(companyId);
    expect(afterEmailChange.state).toBe("registered");
    expect(afterEmailChange.registeredFounders[0]?.email).toBe("current-owner@test.example");

    // 3: changing the historical founder-team email breaks the accepted proof.
    db.prepare("UPDATE founder_team_members SET email=? WHERE company_id=?")
      .run("unrelated@test.example", companyId);
    expect(readCompanyOnboardingState(companyId).state).toBe("indeterminate");
    db.prepare("UPDATE founder_team_members SET email=? WHERE company_id=?")
      .run(historicalEmail, companyId);

    // 4: an inactive canonical membership is not an owner identity.
    db.prepare("UPDATE company_members SET is_active=0 WHERE company_id=?").run(companyId);
    expect(readCompanyOnboardingState(companyId).state).toBe("indeterminate");
    db.prepare("UPDATE company_members SET is_active=1 WHERE company_id=?").run(companyId);

    // 5: a removed founder-team membership is not an owner identity.
    db.prepare("UPDATE founder_team_members SET removed_at=? WHERE company_id=?").run(now(), companyId);
    expect(readCompanyOnboardingState(companyId).state).toBe("indeterminate");
    db.prepare("UPDATE founder_team_members SET removed_at=NULL WHERE company_id=?").run(companyId);

    // 6: a different active company member cannot borrow the accepted invite.
    const unrelatedUserId = user("unrelated-live@test.example");
    db.prepare("UPDATE company_members SET user_id=? WHERE company_id=?")
      .run(unrelatedUserId, companyId);
    expect(readCompanyOnboardingState(companyId).state).toBe("indeterminate");
  });

  it("registers a legacy real owner without requiring a local password or invite", () => {
    const companyId = company(), email = "sso@test.example", userId = user(email);
    membership(companyId, userId);
    const state = readCompanyOnboardingState(companyId);
    expect(state.state).toBe("registered");
    expect(state.reason).toBe("legacy_persisted_owner_membership");
  });

  it("does not coerce an ambiguous legacy placeholder into registered", () => {
    const companyId = company(), email = "real@test.example", userId = user(email);
    membership(companyId, userId);
    const tenantId = (db.prepare("SELECT tenant_id FROM companies WHERE id=?").get(companyId) as { tenant_id: string }).tenant_id;
    db.prepare("INSERT INTO company_members (id,company_id,user_id,role,tenant_id,is_active) VALUES (?,?,?,'founder',?,1)")
      .run(id("cm"), companyId, `u_pending_founder_${id("placeholder")}`, tenantId);
    expect(readCompanyOnboardingState(companyId).state).toBe("indeterminate");
  });

  it("returns HTTP 503 on a DB read failure rather than false pending/empty", async () => {
    const companyId = company();
    const original = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql: any) => {
      if (String(sql).includes("FROM founder_team_invitations")) throw new Error("fixture failure");
      return original(sql);
    });
    const app = express();
    app.get("/onboarding/:id", (req, res) => {
      try {
        res.json(readCompanyOnboardingState(req.params.id));
      } catch (error) {
        if (error instanceof CompanyOnboardingUnavailableError) {
          return res.status(503).json({ error: error.code });
        }
        throw error;
      }
    });
    const response = await request(app).get(`/onboarding/${companyId}`);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "COMPANY_ONBOARDING_UNAVAILABLE" });
  });
});

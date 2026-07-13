/**
 * Wave B1 (3a) — Add Portfolio Company integration test.
 *
 * Verifies the partner-scoped create path: validation, net-new independent
 * company creation, partner attribution (consortium_links), founder OWNER
 * invitation issuance, and founder-owner isolation (owner id is the pending
 * founder, never the partner).
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";
import { registerPartnerRoutes } from "../partnerRoutes";
import { registerPartnerPortfolioCompanyRoutes } from "../partnerPortfolioCompanyRoutes";
import { seedTestPartnerSandbox } from "../partnerWorkspaceStore";
import { getConsortiumPartnerId } from "../consortiumLinkStore";
import { rawDb } from "../db/connection";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";

let app: express.Express;
function post(path: string, user: string, body?: unknown) {
  return request(app).post(path).set("x-user-id", user).send(body ?? {});
}

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerPartnerPortfolioCompanyRoutes(app);
  seedTestPartnerSandbox({ force: true });
});

describe("Wave B1 (3a) — POST /api/partner/me/portfolio-companies", () => {
  it("requires a company name", async () => {
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
      founderEmail: "founder@acme.com",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("COMPANY_NAME_REQUIRED");
  });

  it("requires a valid founder email", async () => {
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
      companyName: "Acme Robotics",
      founderEmail: "not-an-email",
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("FOUNDER_EMAIL_REQUIRED");
  });

  it("creates a net-new independent company, tags the partner, and issues a founder owner-invite", async () => {
    const r = await post("/api/partner/me/portfolio-companies", MANAGING, {
      companyName: "Acme Robotics",
      founderEmail: "founder@acme.com",
      founderName: "Jane Founder",
      sector: "Robotics",
      stage: "Seed",
    });
    expect(r.status).toBe(201);
    expect(r.body.ok).toBe(true);
    const companyId = r.body.companyId as string;
    expect(companyId).toMatch(/^co_/);

    // Attribution: the company is tagged to the acting partner.
    expect(r.body.attributedPartnerId).toBe(PARTNER_A);
    expect(getConsortiumPartnerId(companyId)).toBe(PARTNER_A);

    // Founder OWNER invitation was issued with a claim link.
    expect(r.body.founderInvite?.email).toBe("founder@acme.com");
    expect(r.body.founderInvite?.claimUrl).toContain("/auth/redeem?token=");

    // The invitation row exists with role 'owner' and pending status.
    const inv = rawDb()
      .prepare(
        `SELECT role, status, invited_email FROM founder_team_invitations
          WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(companyId) as { role: string; status: string; invited_email: string } | undefined;
    expect(inv?.role).toBe("owner");
    expect(inv?.status).toBe("pending");
    expect(inv?.invited_email).toBe("founder@acme.com");

    // Isolation: the company owner is the pending-founder id, NEVER the partner
    // acting user. (The membership row's user_id must not be the partner user.)
    const membership = rawDb()
      .prepare(`SELECT user_id FROM company_members WHERE company_id = ? LIMIT 1`)
      .get(companyId) as { user_id: string } | undefined;
    if (membership) {
      expect(membership.user_id).not.toBe(MANAGING);
      expect(membership.user_id).toMatch(/^u_pending_founder_/);
    }
  });
});

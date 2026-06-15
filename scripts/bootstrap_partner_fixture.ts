#!/usr/bin/env node
/**
 * v25.0 Track 4 — F2: Partner Fixture Bootstrap
 *
 * Programmatic helper for DOM/E2E tests that need a fully provisioned partner
 * admin before they can interact with the /api/partner/* surface.
 *
 * Steps:
 *   1. Submit a consortium partner application (via submitApplication store function)
 *   2. Approve it via the admin review path (reviewApplication store function)
 *   3. Mint / ensure the partner admin user exists and has a password
 *   4. Return the partner admin credentials + partnerId
 *
 * Usage:
 *   npx tsx scripts/bootstrap_partner_fixture.ts
 *
 *   Options:
 *     --email=partner@example.com       Contact email (default: generated)
 *     --password=Pass123!               Password for the partner admin (default: generated)
 *     --org=PartnerOrg                  Organization name (default: generated)
 *     --type=vc|angel|family_office     Partner type (default: vc)
 *     --admin-email=admin@example.com   Admin user email (required for DB approval path)
 *     --chapter=chap_keiretsu_canada    Expected chapter (optional)
 *
 * Output (JSON to stdout):
 *   {
 *     "ok": true,
 *     "partnerAdminEmail": "partner@example.com",
 *     "partnerAdminPassword": "Pass123!",
 *     "partnerAdminUserId": "u_...",
 *     "partnerId": "ac_...",
 *     "applicationId": "cpapp_...",
 *     "tenantId": "tenant_cp_..."
 *   }
 *
 * DOM test usage example:
 *   const fixture = JSON.parse(
 *     execSync("npx tsx scripts/bootstrap_partner_fixture.ts --admin-email=qa.admin@example.com --admin-password=...").toString()
 *   );
 *   // Then: login as fixture.partnerAdminEmail with fixture.partnerAdminPassword
 */

import { randomBytes, createHash } from "node:crypto";
import { getDb, rawDb } from "../server/db/connection";
import { submitApplication } from "../server/consortiumApplyStore";
import { storeCredential } from "../server/userCredentialsStore";
import { appendAdminAudit } from "../server/adminPlatformStore";
import { upsertConsortiumPartner } from "../server/adminContactsStore";
import { partnerTeamStore } from "../server/partnerWorkspaceStore";
import {
  users as usersTable,
  userPrefs as userPrefsTable,
  userCredentials as userCredentialsTable,
} from "../shared/schema";
import { log } from "../server/lib/logger";

// Silence logger for script use — log is a pino instance; set silent level via env
process.env.LOG_LEVEL = "silent";

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) map[m[1]] = m[2];
  }
  return map;
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateEmail(org: string): string {
  const slug = org.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  return `partner.${slug}.${randomBytes(3).toString("hex")}@fixture.example.com`;
}

function generatePassword(): string {
  return `PartnerFix25!${randomBytes(4).toString("hex")}`;
}

// ── Review application via rawDb (bypasses auth middleware) ──────────────────

async function approveApplicationDirect(appId: string, adminUserId: string): Promise<{
  partnerId: string;
  tenantId: string;
  userId: string;
}> {
  const db = rawDb();

  // Get the application
  const app = db.prepare(`SELECT * FROM consortium_applications WHERE id = ?`).get(appId) as any;
  if (!app) throw new Error(`Application ${appId} not found`);

  const partnerId = `ac_${appId}`;
  const tenantId = `tenant_cp_${partnerId}`;
  const now = nowIso();

  // Check if partner org already exists
  const existingPartner = db.prepare(`SELECT id FROM partner_organizations WHERE id = ?`).get(partnerId) as any;

  if (!existingPartner) {
    // Create partner org (schema: id, tenant_id, name, jurisdiction, partner_type, aum_range, primary_chapter_id, website, logo_url, banner_url, status, onboarding_state, created_at, updated_at)
    try {
      db.prepare(`
        INSERT OR IGNORE INTO partner_organizations
          (id, tenant_id, name, jurisdiction, partner_type, aum_range, primary_chapter_id, status, onboarding_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?)
      `).run(
        partnerId,
        tenantId,
        app.organization_name,
        app.jurisdiction || 'CA',
        app.partner_type || 'angel_network',
        app.aum_range || 'undisclosed',
        app.primary_chapter_id || null,
        now,
        now
      );
    } catch (err) {
      throw new Error(`Failed to insert partner_organizations: ${(err as Error).message}`);
    }
  }

  // Create tenant
  try {
    db.prepare(`
      INSERT OR IGNORE INTO tenants (id, kind, name, created_at)
      VALUES (?, 'consortium_partner', ?, ?)
    `).run(tenantId, app.organization_name, now);
  } catch { /* best-effort */ }

  // Check for existing user with the contact email
  let userId: string;
  const existingUser = db.prepare(`SELECT id FROM users WHERE email = ?`).get(app.contact_email) as any;
  if (existingUser) {
    userId = existingUser.id;
  } else {
    userId = newId("u_partner");
    db.prepare(`
      INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
      VALUES (?, ?, ?, ?, 'partner_admin', 0)
    `).run(userId, tenantId, app.contact_email, app.contact_name);
  }

  // Update application to approved
  const hash = createHash("sha256").update(`${appId}:approved:${now}`).digest("hex");
  try {
    db.prepare(`
      UPDATE consortium_applications
      SET status = 'approved',
          provisioned_partner_id = ?,
          reviewed_by_user_id = ?,
          reviewed_at = ?,
          updated_at = ?,
          curr_hash = ?
      WHERE id = ?
    `).run(partnerId, adminUserId, now, now, hash, appId);
  } catch (err) {
    throw new Error(`Failed to update application: ${(err as Error).message}`);
  }

  // Critical: replicate the real /api/admin/consortium/applications/:id/approve path
  // (upsertConsortiumPartner + partnerTeamStore.upsertOwner) so requirePartnerAuth()
  // recognizes this fixture partner the same way it does live-approved ones.
  try {
    const partnerContact = upsertConsortiumPartner(
      {
        legalName: app.organization_name,
        email: app.contact_email,
        website: app.website ?? null,
        partnerType: (app.partner_type as any) ?? null,
        regionCode: null,
        hqCountry: app.jurisdiction ?? null,
        preferredId: partnerId,
      },
      adminUserId,
    );
    partnerTeamStore.upsertOwner(userId, partnerContact.id, "managing_partner");
  } catch (err) {
    throw new Error(`Failed to provision adminContact + partner team: ${(err as Error).message}`);
  }

  return { partnerId, tenantId, userId };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const orgName = args["org"] ?? `FixturePartnerOrg_${randomBytes(3).toString("hex")}`;
  const contactEmail = args["email"] ?? generateEmail(orgName);
  const password = args["password"] ?? generatePassword();
  const partnerType = (args["type"] as any) ?? "vc";
  const expectedChapter = args["chapter"] ?? "chap_keiretsu_canada";

  // Find or create a minimal admin user ID for the review step
  let adminUserId = "u_admin_bootstrap";
  const db = rawDb();
  const adminRow = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get() as any;
  if (adminRow) adminUserId = adminRow.id;

  // Step 1: Submit consortium application
  let app: any;
  try {
    app = submitApplication({
      contactName: `${orgName} Admin`,
      contactEmail,
      contactPhone: null,
      organizationName: orgName,
      website: `https://${orgName.toLowerCase().replace(/\s/g, "")}.example.com`,
      jurisdiction: "US",
      partnerType,
      aumRange: "10m_50m",
      portfolioCompanyCount: 10,
      expectedChapter,
      introMessage: `Fixture bootstrap for automated tests. Org: ${orgName}`,
      referredBy: "test_bootstrap",
      sourceIp: "127.0.0.1",
      sourceUserAgent: "bootstrap_script/1.0",
    });
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: "SUBMIT_FAILED", message: (err as Error).message }));
    process.exit(1);
  }

  // Step 2: Approve via admin direct DB path
  let approved: { partnerId: string; tenantId: string; userId: string };
  try {
    approved = await approveApplicationDirect(app.id, adminUserId);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: "APPROVE_FAILED", message: (err as Error).message, applicationId: app.id }));
    process.exit(1);
  }

  // Step 3: Set password for partner admin via storeCredential
  try {
    storeCredential({
      userId: approved.userId,
      email: contactEmail,
      name: `${orgName} Admin`,
      password,
    });
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      error: "CREDENTIAL_STORE_FAILED",
      message: (err as Error).message,
      userId: approved.userId,
    }));
    process.exit(1);
  }

  // Step 4: Ensure user_prefs row for tenant
  try {
    db.prepare(`
      INSERT OR IGNORE INTO user_prefs (user_id, active_tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(approved.userId, approved.tenantId, new Date().toISOString(), new Date().toISOString());
  } catch { /* best-effort */ }

  // Audit trail
  try {
    appendAdminAudit({
      action: "bootstrap_partner_fixture.created",
      actorId: adminUserId,
      targetId: approved.partnerId,
      targetKind: "partner",
      details: { orgName, contactEmail, applicationId: app.id },
    });
  } catch { /* best-effort */ }

  const result = {
    ok: true,
    partnerAdminEmail: contactEmail,
    partnerAdminPassword: password,
    partnerAdminUserId: approved.userId,
    partnerId: approved.partnerId,
    tenantId: approved.tenantId,
    applicationId: app.id,
    orgName,
    note: "Bootstrap complete. Use partnerAdminEmail + partnerAdminPassword to login at /api/auth/login",
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: "UNHANDLED", message: err.message }));
  process.exit(1);
});

/**
 * WAVE 49 · C-2 — REPRODUCTION DIAGNOSTIC (measures, does not assert the fix).
 *
 * Wave 44 proved its fix by running its test file against the pre-fix store and
 * watching the pole-B tests fail. `wave49_c2_heal_branch_cross_org_seat.test.ts`
 * does exactly that, but its POLE B tests fail on the HTTP status before they
 * reach the seat assertion, so the pre-fix output does not actually SHOW the
 * damage. This file shows it.
 *
 * It prints, rather than asserts, what the heal branch does with a case-differing
 * duplicate contact email. Run against the pre-fix store it prints a
 * `managing_partner` seat on the WRONG organisation and HTTP 200. Run against the
 * fixed store it prints a refusal and no seat.
 *
 * The one assertion here is the invariant itself, stated once so this file is a
 * gate and not just a printout: an applicant to organisation A must never end up
 * holding a seat on organisation B.
 *
 * Recorded runs:
 *   build_log/wave49/W49_C2_repro_BEFORE_fix.txt  (pre-fix — the defect)
 *   build_log/wave49/W49_C2_proof_AFTER_fix.txt   (post-fix — refused)
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import request from "supertest";

import {
  registerConsortiumApplyRoutes,
  _consortiumApplyInternal,
  _resetPublicApplyBucketsForTests,
} from "../consortiumApplyStore";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { rawDb } from "../db/connection";
import { upsertConsortiumPartner } from "../adminContactsStore";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerConsortiumApplyRoutes(app);
  _consortiumApplyInternal.appsCache.clear();
  _resetPublicApplyBucketsForTests();
});

describe("WAVE 49 · C-2 · reproduction diagnostic", () => {
  it("shows what a case-differing duplicate contact email does to the heal branch", async () => {
    const db = rawDb();
    const ts = new Date().toISOString();
    const emailApp = "diag.dana@collide-diag.test";
    const emailContact = "DIAG.DANA@COLLIDE-DIAG.TEST";

    // Beta owns the email address.
    const beta = upsertConsortiumPartner(
      {
        legalName: "Beta Partners LLC (diagnostic)",
        email: emailContact,
        website: null,
        partnerType: "vc" as any,
        regionCode: null,
        hqCountry: "Delaware",
      },
      "u_admin",
    );
    // Alpha is what the application points at.
    const alphaId = "ac_consortium_partner_w49diag_alpha";
    db.prepare(
      `INSERT OR IGNORE INTO partner_organizations (id, tenant_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(alphaId, `tenant_cp_${alphaId}`, "Alpha Holdings Ltd (diagnostic)", ts, ts);

    const appId = "app_w49diag_1";
    db.prepare(
      `INSERT OR REPLACE INTO consortium_applications
         (id, tenant_id, contact_name, contact_email, organization_name, jurisdiction,
          partner_type, aum_range, portfolio_company_count, expected_chapter, intro_message,
          status, reviewed_by_user_id, provisioned_partner_id, curr_hash, created_at,
          reviewed_at, updated_at)
       VALUES (?, ?, 'Dana Diagnostic', ?, 'Alpha Holdings Ltd (diagnostic)', 'Delaware', 'vc',
               '10-50M', 3, 'chap_keiretsu_canada',
               'Wave 49 C-2 diagnostic fixture, long enough to pass validation.',
               'approved', 'u_admin', ?, '', ?, ?, ?)`,
    ).run(appId, `tenant_cp_${alphaId}`, emailApp, alphaId, ts, ts, ts);

    const userId = "u_w49diag_dana";
    db.prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
       VALUES (?, 'tenant_w49diag', ?, 'Dana Diagnostic', 'partner', 0)`,
    ).run(userId, emailApp);
    db.prepare(`DELETE FROM partner_team_members WHERE user_id = ?`).run(userId);

    const seatsBefore = db
      .prepare(`SELECT partner_id, sub_role, status FROM partner_team_members WHERE user_id = ?`)
      .all(userId);

    const res = await request(app)
      .post(`/api/admin/consortium/applications/${appId}/review`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ status: "approved", review_notes: "wave49 c2 diagnostic" });

    const seatsAfter = db
      .prepare(`SELECT partner_id, sub_role, status FROM partner_team_members WHERE user_id = ?`)
      .all(userId) as Array<{ partner_id: string; sub_role: string; status: string }>;

    /* eslint-disable no-console */
    console.log("\n────────── WAVE 49 · C-2 REPRODUCTION ──────────");
    console.log(`application         : ${appId}  org=\"Alpha Holdings Ltd (diagnostic)\"`);
    console.log(`  contact_email     : ${emailApp}`);
    console.log(`  provisioned id    : ${alphaId}`);
    console.log(`OTHER organisation  : \"Beta Partners LLC (diagnostic)\"`);
    console.log(`  contact id        : ${beta.id}`);
    console.log(`  contact email     : ${emailContact}   (same address, different case)`);
    console.log(`applicant user      : ${userId}`);
    console.log(`seats BEFORE        : ${JSON.stringify(seatsBefore)}`);
    console.log(`re-approve HTTP     : ${res.status}`);
    console.log(`response error      : ${JSON.stringify(res.body?.error ?? null)}`);
    console.log(`response reason     : ${JSON.stringify(res.body?.reason ?? null)}`);
    console.log(`seats AFTER         : ${JSON.stringify(seatsAfter)}`);
    const wrong = seatsAfter.filter((s) => s.partner_id === beta.id);
    console.log(
      wrong.length
        ? `>>> DEFECT REPRODUCED: managing_partner seat on ${beta.id} (Beta) ` +
            `for an applicant to ${alphaId} (Alpha), HTTP ${res.status}`
        : `>>> NO CROSS-ORG SEAT GRANTED (HTTP ${res.status})`,
    );
    console.log("───────────────────────────────────────────────\n");
    /* eslint-enable no-console */

    // The invariant, asserted once. Pre-fix this fails; post-fix it passes.
    expect(
      wrong,
      `an applicant to ${alphaId} must never hold a seat on ${beta.id}`,
    ).toEqual([]);
  });
});

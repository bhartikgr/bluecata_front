/**
 * v23.4.7 Phase 1 (A-001) — Partner approval welcome email.
 *
 * Asserts that after admin approves a consortium-partner application:
 *   1. A redemption token row is inserted into auth_redeem_tokens with
 *      intent='partner_invite' for the application's contact email.
 *   2. sendEmail() is invoked with a body containing the redemption URL
 *      pattern `/auth/redeem-partner-invite/<token>`.
 *
 * The email send is best-effort (the function never throws on SMTP failure)
 * — we use a vi.mock spy to verify the call happened and to capture the
 * redemption URL that was embedded in the body.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

// Mock sendEmail BEFORE importing the store so the module-level import
// resolves to the spy. The real implementation is async and returns a
// successful result so the fire-and-forget chain logs an "info" line.
vi.mock("../lib/emailSender", () => ({
  sendEmail: vi.fn(async (msg: any) => ({ delivered: true, mode: "dry_run" })),
}));

import {
  registerConsortiumApplyRoutes,
  _consortiumApplyInternal,
  _resetPublicApplyBucketsForTests,
} from "../consortiumApplyStore";
import { sendEmail } from "../lib/emailSender";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { rawDb } from "../db/connection";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerConsortiumApplyRoutes(app);
});

beforeEach(() => {
  _consortiumApplyInternal.appsCache.clear();
  _resetPublicApplyBucketsForTests();
  (sendEmail as unknown as ReturnType<typeof vi.fn>).mockClear();
});

const validBody = {
  organizationName: "Beta Ventures Ltd",
  contactName: "Bob Approver",
  contactEmail: "bob+approve@beta-ventures.test",
  jurisdiction: "Canada",
  partnerType: "vc",
  aumRange: "10-50M",
  portfolioCompanyCount: 8,
  expectedChapter: "chap_keiretsu_canada",
  introMessage: "Seed-stage Ontario SaaS investor with strong founder network.",
};

describe("v23.4.7 Phase 1 (A-001) — partner approval welcome email", () => {
  it("issues a partner_invite token AND attempts a sendEmail with the redemption URL", async () => {
    // 1) submit the public application (this also fires an acknowledgement
    //    email; we clear the spy after so the assertion below cleanly
    //    targets the approval-time welcome email).
    const submitRes = await request(app)
      .post("/api/public/consortium/apply")
      .set("X-Forwarded-For", "10.0.55.1")
      .send(validBody);
    expect(submitRes.status).toBe(201);
    const applicationId = submitRes.body.applicationId as string;
    // Let the submit-time email microtask settle, then reset the spy.
    await new Promise((resolve) => setImmediate(resolve));
    (sendEmail as unknown as ReturnType<typeof vi.fn>).mockClear();

    // 2) admin approves
    const approveRes = await request(app)
      .post(`/api/admin/consortium/applications/${applicationId}/review`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ status: "approved", review_notes: "Looks good." });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.application.status).toBe("approved");

    // 3) token row should be present in auth_redeem_tokens with intent='partner_invite'
    const tokenRow = rawDb()
      .prepare(
        `SELECT id, email, intent FROM auth_redeem_tokens WHERE email = ? AND intent = 'partner_invite' ORDER BY created_at DESC LIMIT 1`,
      )
      .get(validBody.contactEmail) as { id: string; email: string; intent: string } | undefined;
    expect(tokenRow).toBeTruthy();
    expect(tokenRow!.intent).toBe("partner_invite");
    expect(tokenRow!.email).toBe(validBody.contactEmail);

    // 4) sendEmail must have been called with a body containing the redemption URL pattern
    const spy = sendEmail as unknown as ReturnType<typeof vi.fn>;
    // Give the fire-and-forget Promise.then a microtask to settle.
    await new Promise((resolve) => setImmediate(resolve));
    expect(spy).toHaveBeenCalledTimes(1);
    const callArg = spy.mock.calls[0]![0] as {  // eslint-disable-line @typescript-eslint/no-non-null-assertion
      to: string;
      subject: string;
      text: string;
      html?: string;
      category?: string;
      refId?: string;
    };
    expect(callArg.to).toBe(validBody.contactEmail);
    expect(callArg.category).toBe("partner_welcome");
    expect(callArg.refId).toBe(applicationId);
    expect(callArg.text).toMatch(/\/auth\/redeem-partner-invite\/[a-f0-9]+/);
    expect(callArg.html ?? "").toMatch(/\/auth\/redeem-partner-invite\/[a-f0-9]+/);
  });
});

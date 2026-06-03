/**
 * v23.4.8 Phase 1 — BUG 003 / BUG 023 (Ozan, Critical).
 *
 * Bug: "I created an investor report and the system asked me to use a
 * template. The system automatically created some random investor report
 * that I had no input and/or I could not edit/adjust. During sending, I
 * should know EXACTLY who the email/investor report will be going to."
 *
 * What we verify:
 *   1. POST /api/founder/reports2 creates the report in `status: "draft"`
 *      with EMPTY recipients (no auto-send).
 *   2. PATCH /api/founder/reports2/:id mutates title + a section body and
 *      persists those changes on subsequent GET (founder explicitly edits
 *      before any send happens).
 *   3. PATCH refuses to edit a sent report (409 REPORT_NOT_DRAFT) so the
 *      audit trail stays clean.
 *   4. POST /api/founder/reports2/:id/send writes the EXPLICIT recipient
 *      list passed in the body, flips status to "sent", and returns the
 *      explicit recipientCount + sentCount + failedCount summary that the
 *      v23.4.8 UI toast displays.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { registerReportsRoutes } from "../reportsStore";

const FOUNDER = "u_maya_chen";
const COMPANY = "co_novapay";

let app: Express;
beforeAll(() => {
  app = express();
  app.use(express.json());
  registerReportsRoutes(app);
});

describe("v23.4.8 Phase 1 — BUG 003/023 — investor reports draft + edit + send", () => {
  let reportId = "";

  it("creates a new report in draft state with EMPTY recipients (no auto-send)", async () => {
    const r = await request(app)
      .post("/api/founder/reports2")
      .set("x-user-id", FOUNDER)
      .send({ companyId: COMPANY, template: "monthly_kpi", title: "Brutal QA April 2026", period: "April 2026" });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("draft");
    expect(r.body.recipients).toEqual([]);
    expect(r.body.recipientsCount).toBe(0);
    expect(r.body.sentAt).toBeNull();
    expect(Array.isArray(r.body.sections)).toBe(true);
    expect(r.body.sections.length).toBeGreaterThan(0);
    reportId = String(r.body.id);
    expect(reportId).toMatch(/^rpt_/);
  });

  it("PATCH /reports2/:id updates title + a section body (founder edits before sending)", async () => {
    const get1 = await request(app).get(`/api/founder/reports2/${reportId}`);
    const firstSection = get1.body.sections[0];
    const newBody = "Brutal hand-curated highlights — manual override by founder.";

    const patch = await request(app)
      .patch(`/api/founder/reports2/${reportId}`)
      .set("x-user-id", FOUNDER)
      .send({ title: "Brutal QA April 2026 (edited)", sections: [{ id: firstSection.id, body: newBody }] });
    expect(patch.status).toBe(200);
    expect(patch.body.title).toBe("Brutal QA April 2026 (edited)");
    expect(patch.body.status).toBe("draft");

    const get2 = await request(app).get(`/api/founder/reports2/${reportId}`);
    expect(get2.body.title).toBe("Brutal QA April 2026 (edited)");
    const edited = get2.body.sections.find((s: any) => s.id === firstSection.id);
    expect(edited.body).toBe(newBody);
  });

  // v23.8 W-5/BUG-003 — a report may ONLY be sent to current cap-table
  // holders. Recipients that are not on the cap table are rejected (400)
  // so an update can never be delivered to a non-holder.
  it("POST /send rejects recipients who are not cap-table holders (400 INVALID_RECIPIENTS)", async () => {
    const send = await request(app)
      .post(`/api/founder/reports2/${reportId}/send`)
      .set("x-user-id", FOUNDER)
      .send({ recipients: ["u_aisha_patel", "u_forge_ventures", "u_hydra"] });
    expect(send.status).toBe(400);
    expect(send.body.ok).toBe(false);
    expect(send.body.error).toBe("INVALID_RECIPIENTS");
    expect(send.body.invalid).toEqual(expect.arrayContaining(["u_forge_ventures", "u_hydra"]));
    // Report must remain a draft — a rejected send never mutates state.
    const get = await request(app).get(`/api/founder/reports2/${reportId}`);
    expect(get.body.status).toBe("draft");
  });

  it("POST /send with explicit cap-table recipients flips status to sent and returns delivery summary", async () => {
    // co_novapay cap-table holders (membershipStore seed): u_aisha_patel, u_lapsed_lp.
    const recipients = ["u_aisha_patel", "u_lapsed_lp"];
    const send = await request(app)
      .post(`/api/founder/reports2/${reportId}/send`)
      .set("x-user-id", FOUNDER)
      .send({ recipients });
    expect(send.status).toBe(200);
    expect(send.body.ok).toBe(true);
    expect(send.body.recipientCount).toBe(2);
    expect(typeof send.body.sentCount).toBe("number");
    expect(typeof send.body.failedCount).toBe("number");
    expect(send.body.sentCount + send.body.failedCount).toBe(2);
    expect(Array.isArray(send.body.recipients)).toBe(true);
    expect(send.body.recipients).toHaveLength(2);
    expect(send.body.report.status).toBe("sent");
    expect(send.body.report.recipients).toEqual(recipients);
    expect(send.body.report.sentAt).toBeTruthy();
  });

  it("PATCH on a sent report returns 409 REPORT_NOT_DRAFT (no silent overwrite)", async () => {
    const r = await request(app)
      .patch(`/api/founder/reports2/${reportId}`)
      .set("x-user-id", FOUNDER)
      .send({ title: "Should not be allowed" });
    expect(r.status).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe("REPORT_NOT_DRAFT");
  });
});

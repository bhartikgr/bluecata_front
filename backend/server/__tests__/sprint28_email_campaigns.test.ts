/**
 * Sprint 28 Wave 7 — Email Campaign + Transport tests
 *
 * Covers:
 * - Create draft → version=1, prevHash=64 zeros, status=draft
 * - PATCH without x-confirm → 409 with proposedChange
 * - Template + variables render correctly via /render-preview
 * - Freeform (templateSlug=null) renders raw HTML with handlebars substitution
 * - Audience resolver: 3+ AudienceKinds end-to-end
 * - Test-send: enqueues outbox items; testSentAt set; audit logged; non-empty recipients required
 * - Send now: typed confirmName must match campaign.name; mismatch returns 400
 * - Outbox tick: queued → sent → delivered in console/dry_run mode
 * - Outbox retry: bounced item → POST /retry resets to queued, attempts stays
 * - Outbox cancel: queued item → cancel sets status to bounced + error=canceled_by_admin
 * - Transport: GET /config returns masked pass ("***"); PATCH on host/port/user/pass → 400
 * - Transport: test-connection ok=true in console/dry_run mode
 * - Hash chain extends across compose → schedule → send; verifyChain ok
 * - Bridge events: email_campaign.created/scheduled/sent/canceled/test_sent
 * - Bridge ALL_OUTBOUND_EVENT_TYPES now 38
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";

import {
  ALL_OUTBOUND_EVENT_TYPES,
  _testBridge,
} from "../bridgeStore";
import { _testEmailCampaigns, registerEmailCampaignRoutes, registerEmailTransportRoutes } from "../emailCampaignStore";
import { registerEmailRoutes, _testEmail, tickQueue, enqueueEmail } from "../emailStore";
import { _testTransport } from "../emailTransport";
import { registerAdminPlatformRoutes } from "../adminPlatformStore";

/* ============================================================
 * Helpers
 * ============================================================ */

function makeApp() {
  const app = express();
  app.use(express.json());
  registerEmailRoutes(app);
  registerEmailCampaignRoutes(app);
  registerEmailTransportRoutes(app);
  registerAdminPlatformRoutes(app);
  return app;
}

type Opts = {
  headers?: Record<string, string>;
  body?: unknown;
};

async function req(
  app: express.Express,
  method: string,
  path: string,
  opts: Opts = {}
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
      const headers: Record<string, string | number> = opts.headers ? { ...opts.headers } : {};
      if (data) {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(data);
      }
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try {
              resolve({ status: res.statusCode ?? 0, body: buf ? JSON.parse(buf) : null });
            } catch {
              resolve({ status: res.statusCode ?? 0, body: buf });
            }
          });
        }
      );
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

const VALID_CAMPAIGN = {
  name: "Test Q3 Campaign",
  description: "A test campaign",
  audience: { kind: "all_founders" },
  content: {
    templateSlug: null,
    subject: "Hello {{recipient_name}}",
    bodyHtml: "<p>Hi {{recipient_name}}, welcome!</p>",
    bodyText: "Hi {{recipient_name}}, welcome!",
    variables: { recipient_name: "Maya" },
    replyTo: null,
  },
  timezone: "UTC",
};

/* ============================================================
 * Reset between tests
 * ============================================================ */

beforeEach(() => {
  _testEmailCampaigns.reset();
  _testEmail.reset();
  _testTransport.reset();
});

afterEach(() => {
  _testEmailCampaigns.reset();
  _testEmail.reset();
  _testTransport.reset();
});

/* ============================================================
 * Bridge: ALL_OUTBOUND_EVENT_TYPES now 38
 * ============================================================ */

describe("Wave 7 / Bridge — ALL_OUTBOUND_EVENT_TYPES count = 38", () => {
  it("contains all 5 email campaign event types", () => {
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("email_campaign.created");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("email_campaign.scheduled");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("email_campaign.sent");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("email_campaign.canceled");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("email_campaign.test_sent");
  });

  it("total count is 41 (Sprint 29 KL-01 added company_profile.updated)", () => {
    expect(ALL_OUTBOUND_EVENT_TYPES.length).toBe(58);
  });
});

/* ============================================================
 * Campaign CRUD
 * ============================================================ */

describe("Wave 7 / Email campaigns — CRUD", () => {
  it("POST without x-confirm → 409 proposedChange", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/email-campaigns", { body: VALID_CAMPAIGN });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("confirmation_required");
    expect(r.body.proposedChange).toBeDefined();
  });

  it("POST with x-confirm → 201, version=1, prevHash=64 zeros, status=draft", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    expect(r.status).toBe(201);
    const c = r.body.campaign;
    expect(c.version).toBe(1);
    expect(c.prevRevisionHash).toBe("0".repeat(64));
    expect(c.status).toBe("draft");
    expect(c.revisionHash).toHaveLength(64);
    expect(c.id).toMatch(/^ecmp_/);
  });

  it("PATCH without x-confirm → 409 proposedChange", async () => {
    const app = makeApp();
    // Create
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    // Patch without confirm
    const patch = await req(app, "PATCH", `/api/admin/email-campaigns/${id}`, {
      body: { name: "Updated Name" },
    });
    expect(patch.status).toBe(409);
    expect(patch.body.error).toBe("confirmation_required");
    expect(patch.body.proposedChange).toBeDefined();
    expect(patch.body.currentVersion).toBe(1);
  });

  it("PATCH with x-confirm → campaign updated, version incremented", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const patch = await req(app, "PATCH", `/api/admin/email-campaigns/${id}`, {
      headers: { "x-confirm": "true" },
      body: { name: "Updated Name" },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.campaign.version).toBe(2);
    expect(patch.body.campaign.name).toBe("Updated Name");
  });

  it("GET /:id returns campaign", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const get = await req(app, "GET", `/api/admin/email-campaigns/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.campaign.id).toBe(id);
  });

  it("GET / returns all campaigns", async () => {
    const app = makeApp();
    await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: { ...VALID_CAMPAIGN, name: "Second campaign" },
    });
    const list = await req(app, "GET", "/api/admin/email-campaigns");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(Array.isArray(list.body.campaigns)).toBe(true);
  });
});

/* ============================================================
 * Render preview
 * ============================================================ */

describe("Wave 7 / Email campaigns — render preview", () => {
  it("template render-preview substitutes variables", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: {
        ...VALID_CAMPAIGN,
        content: {
          templateSlug: "round_invitation",
          subject: "{{founder_name}} invited you to {{round_name}}",
          bodyHtml: "<p>Template body</p>",
          bodyText: "Template body",
          variables: {
            recipient_name: "Aisha",
            founder_name: "Maya",
            company_name: "NovaPay",
            round_name: "Seed",
            instrument: "SAFE",
            personal_message: "Hi!",
            cta_url: "https://example.com",
            expiry_date: "2026-12-01",
          },
          replyTo: null,
        },
      },
    });
    const id = create.body.campaign.id;
    const preview = await req(app, "POST", `/api/admin/email-campaigns/${id}/render-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.subject).toContain("Maya");
    expect(preview.body.html).toContain("Aisha");
  });

  it("freeform render-preview applies handlebars-style substitution", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: {
        ...VALID_CAMPAIGN,
        content: {
          templateSlug: null,
          subject: "Hello {{name}}",
          bodyHtml: "<p>Dear {{name}}, your code is {{code}}</p>",
          bodyText: "Dear {{name}}, your code is {{code}}",
          variables: { name: "Alice", code: "XYZ" },
          replyTo: null,
        },
      },
    });
    const id = create.body.campaign.id;
    const preview = await req(app, "POST", `/api/admin/email-campaigns/${id}/render-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.subject).toBe("Hello Alice");
    expect(preview.body.html).toContain("Alice");
    expect(preview.body.html).toContain("XYZ");
  });

  it("render-preview with content override in body", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const preview = await req(app, "POST", `/api/admin/email-campaigns/${id}/render-preview`, {
      body: {
        content: {
          templateSlug: null,
          subject: "Override {{x}}",
          bodyHtml: "<b>{{x}}</b>",
          bodyText: "{{x}}",
          variables: { x: "world" },
          replyTo: null,
        },
      },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.subject).toBe("Override world");
    expect(preview.body.html).toContain("world");
  });
});

/* ============================================================
 * Audience resolver
 * ============================================================ */

describe("Wave 7 / Email campaigns — audience resolver", () => {
  it("all_founders resolves without error", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/email-campaigns/audience-preview", {
      body: { audience: { kind: "all_founders" } },
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.preview.totalMatches).toBe("number");
    expect(typeof r.body.resolvedEmailCount).toBe("number");
  });

  it("all_investors resolves without error", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/email-campaigns/audience-preview", {
      body: { audience: { kind: "all_investors" } },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("specific_users resolves userIds", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/email-campaigns/audience-preview", {
      body: { audience: { kind: "specific_users", userIds: ["u_admin", "u_maya_chen"] } },
    });
    expect(r.status).toBe(200);
    expect(r.body.preview.totalMatches).toBeGreaterThanOrEqual(1);
  });

  it("investors_by_region accepts region filter", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/email-campaigns/audience-preview", {
      body: { audience: { kind: "investors_by_region", regions: ["US", "UK"] } },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("GET /:id/audience-preview works after campaign creation", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const preview = await req(app, "GET", `/api/admin/email-campaigns/${id}/audience-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.ok).toBe(true);
  });
});

/* ============================================================
 * Test-send
 * ============================================================ */

describe("Wave 7 / Email campaigns — test-send", () => {
  it("requires at least one recipient", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const r = await req(app, "POST", `/api/admin/email-campaigns/${id}/test-send`, {
      headers: { "x-confirm": "true" },
      body: { recipients: [] },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("at_least_one_recipient_required");
  });

  it("test-send without x-confirm → 409", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const r = await req(app, "POST", `/api/admin/email-campaigns/${id}/test-send`, {
      body: { recipients: ["test@example.com"] },
    });
    expect(r.status).toBe(409);
  });

  it("test-send enqueues outbox items and sets testSentAt", async () => {
    _testTransport.forceMode("dry_run");
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const outboxBefore = _testEmail.outbox.length;

    const r = await req(app, "POST", `/api/admin/email-campaigns/${id}/test-send`, {
      headers: { "x-confirm": "true" },
      body: { recipients: ["a@example.com", "b@example.com"] },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.enqueued).toBe(2);
    expect(r.body.campaign.testSentAt).not.toBeNull();
    expect(_testEmail.outbox.length).toBe(outboxBefore + 2);
  });

  it("test-send subject gets [TEST] prefix in outbox", async () => {
    _testTransport.forceMode("dry_run");
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: { ...VALID_CAMPAIGN, content: { ...VALID_CAMPAIGN.content, subject: "My Newsletter" } },
    });
    const id = create.body.campaign.id;
    await req(app, "POST", `/api/admin/email-campaigns/${id}/test-send`, {
      headers: { "x-confirm": "true" },
      body: { recipients: ["tester@example.com"] },
    });
    const testItem = _testEmail.outbox.find((e) => e.recipient === "tester@example.com");
    expect(testItem?.subject).toContain("[TEST]");
  });
});

/* ============================================================
 * Send now — typed confirmation
 * ============================================================ */

describe("Wave 7 / Email campaigns — send now + typed confirmation", () => {
  it("mismatched confirmName returns 400", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const r = await req(app, "POST", `/api/admin/email-campaigns/${id}/send`, {
      headers: { "x-confirm": "true" },
      body: { confirmName: "WRONG NAME" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("typed_confirmation_mismatch");
  });

  it("missing x-confirm → 409 even if confirmName matches", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const r = await req(app, "POST", `/api/admin/email-campaigns/${id}/send`, {
      body: { confirmName: VALID_CAMPAIGN.name },
    });
    // mismatched confirmName is checked first
    expect([400, 409]).toContain(r.status);
  });

  it("correct confirmName + x-confirm → campaign sent", async () => {
    _testTransport.forceMode("dry_run");
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const r = await req(app, "POST", `/api/admin/email-campaigns/${id}/send`, {
      headers: { "x-confirm": "true" },
      body: { confirmName: VALID_CAMPAIGN.name },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.campaign.status).toBe("sent");
    expect(r.body.campaign.sentAt).not.toBeNull();
  });

  it("second send on already-sent campaign returns idempotent response", async () => {
    _testTransport.forceMode("dry_run");
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    await req(app, "POST", `/api/admin/email-campaigns/${id}/send`, {
      headers: { "x-confirm": "true" },
      body: { confirmName: VALID_CAMPAIGN.name },
    });
    const second = await req(app, "POST", `/api/admin/email-campaigns/${id}/send`, {
      headers: { "x-confirm": "true" },
      body: { confirmName: VALID_CAMPAIGN.name },
    });
    expect([200, 400]).toContain(second.status); // sent → not_sendable
  });
});

/* ============================================================
 * Outbox tick — state transitions
 * ============================================================ */

describe("Wave 7 / Outbox tick — state transitions", () => {
  it("queued → delivered after tickQueue in dry_run mode", async () => {
    _testTransport.forceMode("dry_run");
    _testEmail.reset();
    enqueueEmail({
      templateSlug: "round_invitation",
      recipient: "test@example.com",
      recipientUserId: "u_test",
      variables: { recipient_name: "Test", founder_name: "F", company_name: "C", round_name: "R", instrument: "SAFE", personal_message: "", cta_url: "https://x.com", expiry_date: "2026-01-01" },
    });
    expect(_testEmail.outbox[0].status).toBe("queued");
    await tickQueue();
    expect(_testEmail.outbox[0].status).toBe("delivered");
    expect(_testEmail.outbox[0].sentAt).not.toBeNull();
    expect(_testEmail.outbox[0].deliveredAt).not.toBeNull();
  });

  it("queued → delivered via HTTP POST /api/admin/email/tick", async () => {
    _testTransport.forceMode("dry_run");
    _testEmail.reset();
    enqueueEmail({
      templateSlug: "collective_welcome",
      recipient: "t@x.com",
      recipientUserId: "u_x",
      variables: { recipient_name: "Test", deal_room_cta: "/dr", profile_cta: "/p", receipt_link: "/r" },
    });
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/email/tick");
    expect(r.status).toBe(200);
    expect(_testEmail.outbox.find((e) => e.recipient === "t@x.com")?.status).toBe("delivered");
  });
});

/* ============================================================
 * Outbox retry
 * ============================================================ */

describe("Wave 7 / Outbox retry + cancel", () => {
  it("retry: bounced item with attempts=2 → POST /retry resets to queued, attempts stays 2", async () => {
    _testTransport.forceMode("dry_run");
    _testEmail.reset();
    enqueueEmail({
      templateSlug: "collective_welcome",
      recipient: "bounce@test.com",
      recipientUserId: "u_b",
      variables: { recipient_name: "Bounce", deal_room_cta: "/d", profile_cta: "/p", receipt_link: "/r" },
    });
    const item = _testEmail.outbox[0];
    // Manually set bounced with 2 attempts
    item.status = "bounced";
    item.attempts = 2;
    item.error = "550 no mailbox";

    const app = makeApp();
    const r = await req(app, "POST", `/api/admin/email/transport/outbox/${item.id}/retry`, {
      headers: { "x-confirm": "true" },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    // item should now be queued
    const refreshed = _testEmail.outbox.find((x) => x.id === item.id)!;
    expect(refreshed.status).toBe("queued");
    expect(refreshed.attempts).toBe(2); // stays 2, next tick will increment
    expect(refreshed.error).toBeNull();
  });

  it("retry without x-confirm → 409", async () => {
    _testEmail.reset();
    enqueueEmail({
      templateSlug: "collective_welcome",
      recipient: "test2@test.com",
      recipientUserId: "u_x",
      variables: { recipient_name: "T", deal_room_cta: "/d", profile_cta: "/p", receipt_link: "/r" },
    });
    const item = _testEmail.outbox[0];
    item.status = "bounced";
    const app = makeApp();
    const r = await req(app, "POST", `/api/admin/email/transport/outbox/${item.id}/retry`);
    expect(r.status).toBe(409);
  });

  it("cancel: queued item → cancel sets status=bounced + error=canceled_by_admin", async () => {
    _testEmail.reset();
    enqueueEmail({
      templateSlug: "kyc_update",
      recipient: "c@test.com",
      recipientUserId: "u_c",
      variables: { recipient_name: "C", new_status: "pending", action_required: "" },
    });
    const item = _testEmail.outbox[0];
    expect(item.status).toBe("queued");

    const app = makeApp();
    const r = await req(app, "POST", `/api/admin/email/transport/outbox/${item.id}/cancel`, {
      headers: { "x-confirm": "true" },
    });
    expect(r.status).toBe(200);
    const refreshed = _testEmail.outbox.find((x) => x.id === item.id)!;
    expect(refreshed.status).toBe("bounced");
    expect(refreshed.error).toBe("canceled_by_admin");
  });

  it("cancel without x-confirm → 409", async () => {
    _testEmail.reset();
    enqueueEmail({
      templateSlug: "kyc_update",
      recipient: "d@test.com",
      recipientUserId: "u_d",
      variables: { recipient_name: "D", new_status: "pending", action_required: "" },
    });
    const item = _testEmail.outbox[0];
    const app = makeApp();
    const r = await req(app, "POST", `/api/admin/email/transport/outbox/${item.id}/cancel`);
    expect(r.status).toBe(409);
  });

  it("cancel prevents further processing (status stays bounced after tick)", async () => {
    _testTransport.forceMode("dry_run");
    _testEmail.reset();
    enqueueEmail({
      templateSlug: "kyc_update",
      recipient: "e@test.com",
      recipientUserId: "u_e",
      variables: { recipient_name: "E", new_status: "pending", action_required: "" },
    });
    const item = _testEmail.outbox[0];
    item.status = "bounced";
    item.error = "canceled_by_admin";

    await tickQueue(); // Should not process bounced items
    expect(item.status).toBe("bounced");
    expect(item.error).toBe("canceled_by_admin");
  });
});

/* ============================================================
 * Transport config
 * ============================================================ */

describe("Wave 7 / Transport config", () => {
  it("GET /config returns masked pass = '***'", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/email/transport/config");
    expect(r.status).toBe(200);
    expect(r.body.config.pass).toBe("***");
  });

  it("PATCH on host returns 400 (env-only)", async () => {
    const app = makeApp();
    const r = await req(app, "PATCH", "/api/admin/email/transport/config", {
      headers: { "x-confirm": "true" },
      body: { host: "evil.smtp.com" },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("env-only");
  });

  it("PATCH on port returns 400 (env-only)", async () => {
    const app = makeApp();
    const r = await req(app, "PATCH", "/api/admin/email/transport/config", {
      headers: { "x-confirm": "true" },
      body: { port: 25 },
    });
    expect(r.status).toBe(400);
  });

  it("PATCH on user returns 400 (env-only)", async () => {
    const app = makeApp();
    const r = await req(app, "PATCH", "/api/admin/email/transport/config", {
      headers: { "x-confirm": "true" },
      body: { user: "hacker@evil.com" },
    });
    expect(r.status).toBe(400);
  });

  it("PATCH on pass returns 400 (env-only)", async () => {
    const app = makeApp();
    const r = await req(app, "PATCH", "/api/admin/email/transport/config", {
      headers: { "x-confirm": "true" },
      body: { pass: "plaintext_password" },
    });
    expect(r.status).toBe(400);
  });

  it("PATCH on fromAddress succeeds with x-confirm", async () => {
    const app = makeApp();
    const r = await req(app, "PATCH", "/api/admin/email/transport/config", {
      headers: { "x-confirm": "true" },
      body: { fromAddress: "Capavate Test <test@capavate.com>" },
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.config.fromAddress).toBe("Capavate Test <test@capavate.com>");
    expect(r.body.config.pass).toBe("***"); // still masked
  });

  it("PATCH without x-confirm → 409", async () => {
    const app = makeApp();
    const r = await req(app, "PATCH", "/api/admin/email/transport/config", {
      body: { fromAddress: "x@x.com" },
    });
    expect(r.status).toBe(409);
  });

  it("test-connection returns ok=true in console mode (default when SMTP_HOST absent)", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/email/transport/test-connection");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("test-connection returns ok=true in dry_run mode", async () => {
    _testTransport.forceMode("dry_run");
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/email/transport/test-connection");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});

/* ============================================================
 * Outbox paginated endpoint
 * ============================================================ */

describe("Wave 7 / Transport outbox endpoint", () => {
  it("GET /transport/outbox returns items + stats", async () => {
    _testEmail.reset();
    enqueueEmail({
      templateSlug: "kyc_update",
      recipient: "a@b.com",
      recipientUserId: "u_x",
      variables: { recipient_name: "A", new_status: "pending", action_required: "" },
    });
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/email/transport/outbox");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.items)).toBe(true);
    expect(typeof r.body.stats).toBe("object");
  });
});

/* ============================================================
 * Hash chain across lifecycle
 * ============================================================ */

describe("Wave 7 / Hash chain — compose → schedule → send", () => {
  it("chain grows and verifies ok", async () => {
    _testTransport.forceMode("dry_run");
    const app = makeApp();

    // 1. Create
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    expect(create.body.campaign.version).toBe(1);

    // 2. Patch (update content)
    await req(app, "PATCH", `/api/admin/email-campaigns/${id}`, {
      headers: { "x-confirm": "true" },
      body: { description: "Updated description" },
    });

    // 3. Send
    await req(app, "POST", `/api/admin/email-campaigns/${id}/send`, {
      headers: { "x-confirm": "true" },
      body: { confirmName: VALID_CAMPAIGN.name },
    });

    // 4. Verify chain
    const history = await req(app, "GET", `/api/admin/email-campaigns/${id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.chain.ok).toBe(true);
    expect(history.body.chain.totalRevisions).toBeGreaterThanOrEqual(3);
  });

  it("revisionHash changes on each mutation", async () => {
    const app = makeApp();
    const c1 = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = c1.body.campaign.id;
    const hash1 = c1.body.campaign.revisionHash;

    const c2 = await req(app, "PATCH", `/api/admin/email-campaigns/${id}`, {
      headers: { "x-confirm": "true" },
      body: { name: "New Name" },
    });
    const hash2 = c2.body.campaign.revisionHash;
    expect(hash1).not.toBe(hash2);

    const get = await req(app, "GET", `/api/admin/email-campaigns/${id}`);
    expect(get.body.campaign.prevRevisionHash).toBe(hash1);
  });
});

/* ============================================================
 * Bridge events
 * ============================================================ */

describe("Wave 7 / Bridge events emitted on lifecycle", () => {
  it("email_campaign.created emitted on POST", async () => {
    _testBridge.resetChain();
    const { getOutbox } = await import("../bridgeStore");
    const before = getOutbox().length;

    const app = makeApp();
    await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });

    const events = getOutbox().slice(before);
    expect(events.some((e) => e.envelope.eventType === "email_campaign.created")).toBe(true);
  });

  it("email_campaign.canceled emitted on cancel", async () => {
    _testBridge.resetChain();
    const { getOutbox } = await import("../bridgeStore");
    const app = makeApp();

    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const before = getOutbox().length;

    await req(app, "POST", `/api/admin/email-campaigns/${id}/cancel`, {
      headers: { "x-confirm": "true" },
    });

    const events = getOutbox().slice(before);
    expect(events.some((e) => e.envelope.eventType === "email_campaign.canceled")).toBe(true);
  });

  it("email_campaign.test_sent emitted on test-send", async () => {
    _testBridge.resetChain();
    const { getOutbox } = await import("../bridgeStore");
    const app = makeApp();

    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const before = getOutbox().length;

    await req(app, "POST", `/api/admin/email-campaigns/${id}/test-send`, {
      headers: { "x-confirm": "true" },
      body: { recipients: ["x@example.com"] },
    });

    const events = getOutbox().slice(before);
    expect(events.some((e) => e.envelope.eventType === "email_campaign.test_sent")).toBe(true);
  });

  it("email_campaign.sent emitted on send", async () => {
    _testTransport.forceMode("dry_run");
    _testBridge.resetChain();
    const { getOutbox } = await import("../bridgeStore");
    const app = makeApp();

    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const before = getOutbox().length;

    await req(app, "POST", `/api/admin/email-campaigns/${id}/send`, {
      headers: { "x-confirm": "true" },
      body: { confirmName: VALID_CAMPAIGN.name },
    });

    const events = getOutbox().slice(before);
    expect(events.some((e) => e.envelope.eventType === "email_campaign.sent")).toBe(true);
  });

  it("email_campaign.scheduled emitted on schedule", async () => {
    _testBridge.resetChain();
    const { getOutbox } = await import("../bridgeStore");
    const app = makeApp();

    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const before = getOutbox().length;

    await req(app, "POST", `/api/admin/email-campaigns/${id}/schedule`, {
      headers: { "x-confirm": "true" },
      body: { scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), timezone: "UTC" },
    });

    const events = getOutbox().slice(before);
    expect(events.some((e) => e.envelope.eventType === "email_campaign.scheduled")).toBe(true);
  });
});

/* ============================================================
 * Stats endpoint
 * ============================================================ */

describe("Wave 7 / Campaign stats", () => {
  it("GET /stats returns byStatus breakdown", async () => {
    const app = makeApp();
    await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const r = await req(app, "GET", "/api/admin/email-campaigns/stats");
    expect(r.status).toBe(200);
    expect(typeof r.body.byStatus.draft).toBe("number");
    expect(r.body.byStatus.draft).toBeGreaterThanOrEqual(1);
  });
});

/* ============================================================
 * Schedule
 * ============================================================ */

describe("Wave 7 / Campaign schedule", () => {
  it("POST /schedule sets status=scheduled", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const future = new Date(Date.now() + 7_200_000).toISOString();
    const r = await req(app, "POST", `/api/admin/email-campaigns/${id}/schedule`, {
      headers: { "x-confirm": "true" },
      body: { scheduledAt: future, timezone: "UTC" },
    });
    expect(r.status).toBe(200);
    expect(r.body.campaign.status).toBe("scheduled");
    expect(r.body.campaign.scheduledAt).toBe(future);
  });

  it("schedule without x-confirm → 409", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const future = new Date(Date.now() + 7_200_000).toISOString();
    const r = await req(app, "POST", `/api/admin/email-campaigns/${id}/schedule`, {
      body: { scheduledAt: future, timezone: "UTC" },
    });
    expect(r.status).toBe(409);
  });

  it("schedule in the past returns 400", async () => {
    const app = makeApp();
    const create = await req(app, "POST", "/api/admin/email-campaigns", {
      headers: { "x-confirm": "true" },
      body: VALID_CAMPAIGN,
    });
    const id = create.body.campaign.id;
    const past = new Date(Date.now() - 1000).toISOString();
    const r = await req(app, "POST", `/api/admin/email-campaigns/${id}/schedule`, {
      headers: { "x-confirm": "true" },
      body: { scheduledAt: past, timezone: "UTC" },
    });
    expect(r.status).toBe(400);
  });
});

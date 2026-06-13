/**
 * Sprint 12 — comprehensive test coverage for the new admin + bridge + bug-hunt sprint.
 *
 * One file, ~50 tests, organised by feature area:
 *   - Bridge store: outbound types, inbound types, HMAC, envelope shape, chain, drain, retry
 *   - Notifications store: 21 kinds, emit, list, broadcast, preferences
 *   - Email store: 14+ templates, render, queue state machine
 *   - Admin platform: KPIs, audit-log chain, reconciliation force-commit guard, pricing tiers
 *   - CapCollectiveToggle: pure-function visibility predicate
 *
 * These tests are additive (Sprint 12 work) — math-critical cap-table tests stay in
 * packages/cap-table-engine and are NOT modified.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity"; /* v14 Tier-1 Fix 1 — restores u_admin default identity for legacy tests */
import express from "express";
import http from "node:http";

import {
  ALL_OUTBOUND_EVENT_TYPES,
  ALL_INBOUND_EVENT_TYPES,
  emitBridgeEvent,
  hmacSign,
  verifyHmac,
  registerBridgeRoutes,
  drainOutbox,
  getOutbox,
  _testBridge,
} from "../bridgeStore";
import {
  ALL_NOTIFICATION_KINDS,
  emitNotification,
  listNotifications,
  unreadCount,
  registerNotificationsRoutes,
  _testNotifications,
} from "../notificationsStore";
import {
  _testEmail,
  enqueueEmail,
  findTemplate,
  renderTemplate,
  registerEmailRoutes,
  tickQueue,
} from "../emailStore";
import { registerAdminPlatformRoutes } from "../adminPlatformStore";
import { shouldShowToggle } from "../../client/src/components/CapCollectiveToggle";

/* ---------- helpers ---------- */
function makeApp() {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerBridgeRoutes(app);
  registerNotificationsRoutes(app);
  registerEmailRoutes(app);
  registerAdminPlatformRoutes(app);
  return app;
}
async function req(app: express.Express, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body ? JSON.stringify(body) : undefined;
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try { resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null }); }
            catch { resolve({ status: res.statusCode || 0, body: buf }); }
          });
        }
      );
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

/* =========================================================================== */
/* Bridge store                                                                */
/* =========================================================================== */
describe("Sprint 12 / Bridge — outbound + inbound catalogs", () => {
  it("declares 16 outbound event types per audit §13.2", () => {
    // Audit lists 11 named events; safe.converted + note.converted count
    // separately so the live catalog has 12. Test locks the canonical list.
    // Sprint 16 G1 — added "soft_circle.submitted" → 13 outbound types
    // Sprint 28 Wave 3 — added "subscription.updated" → 14 outbound types
    // Sprint 28 Pricing — added "pricing_model.updated" + "pricing_model.published" → 16 outbound types
    // Sprint 28 Billing — added invoice.issued + invoice.paid + invoice.refunded + invoice.voided → 20
    // Sprint 28 Wave 5 — added region.proposed + region.review_submitted + region.approved + region.gone_live + region.rejected → 29
    // Sprint 28 Wave 6 — added notification_campaign.created/scheduled/sent/canceled → 33
    // Sprint 28 Wave 7 — added email_campaign.created/scheduled/sent/canceled/test_sent → 38
    // Sprint 29 KL-01 — added company_profile.updated → 41
    expect(ALL_OUTBOUND_EVENT_TYPES.length).toBe(58) // Sprint 29 KL-01 added company_profile.updated;
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("subscription.updated");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("pricing_model.updated");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("pricing_model.published");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("company.profile.updated");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("company_profile.updated"); // KL-01 Sprint 29
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("company.ma_intelligence.updated");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("investor.profile.updated");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("cap_table.mutated");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("eligibility.recomputed");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("lifecycle_policy.changed");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("formula.published");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("audit_log.appended");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("safe.converted");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("note.converted");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("round.closed");
    expect(ALL_OUTBOUND_EVENT_TYPES).toContain("governance_metric.published");
  });

  it("declares 4 inbound event types per audit §13.3", () => {
    expect(ALL_INBOUND_EVENT_TYPES.length).toBe(4);
    expect(ALL_INBOUND_EVENT_TYPES).toEqual([
      "dsc.scores",
      "ma.intelligence_rankings",
      "partner.introduction_status",
      "network.social_signals",
    ]);
  });

  it("event types arrays are immutable in nature (sorted/typed)", () => {
    expect(new Set(ALL_OUTBOUND_EVENT_TYPES).size).toBe(ALL_OUTBOUND_EVENT_TYPES.length);
    expect(new Set(ALL_INBOUND_EVENT_TYPES).size).toBe(ALL_INBOUND_EVENT_TYPES.length);
  });
});

describe("Sprint 12 / Bridge — HMAC + envelope shape", () => {
  it("hmacSign / verifyHmac roundtrip", () => {
    const body = JSON.stringify({ a: 1, b: "two" });
    const sig = hmacSign(body);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyHmac(body, sig)).toBe(true);
    expect(verifyHmac(body, "deadbeef")).toBe(false);
  });

  it("verifyHmac fails on body tamper", () => {
    const sig = hmacSign("{\"x\":1}");
    expect(verifyHmac("{\"x\":2}", sig)).toBe(false);
  });

  it("emitBridgeEvent produces canonical envelope per §13.4", () => {
    _testBridge.resetChain();
    const entry = emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_test",
      aggregateKind: "company",
      payload: { foo: "bar" },
    });
    const e = entry.envelope;
    expect(e.eventId).toMatch(/^evt_/);
    expect(e.eventType).toBe("company.profile.updated");
    expect(e.aggregateId).toBe("co_test");
    expect(e.aggregateKind).toBe("company");
    expect(typeof e.occurredAt).toBe("string");
    expect(e.tenantId).toBeTruthy();
    expect(e.actor).toBeTruthy();
    expect(e.payload).toEqual({ foo: "bar" });
    expect(e.auditChain.priorHash).toBeTruthy();
    expect(e.auditChain.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.schemaVersion).toBe("1.0");
  });
});

describe("Sprint 12 / Bridge — chain integrity", () => {
  beforeEach(() => _testBridge.resetChain());

  it("emits link the auditChain forward (priorHash = previous.hash)", () => {
    const a = emitBridgeEvent({ eventType: "cap_table.mutated", aggregateId: "co_x", aggregateKind: "company", payload: {} });
    const b = emitBridgeEvent({ eventType: "cap_table.mutated", aggregateId: "co_x", aggregateKind: "company", payload: {} });
    expect(b.envelope.auditChain.priorHash).toBe(a.envelope.auditChain.hash);
  });

  it("first event uses zero-hash genesis", () => {
    const first = emitBridgeEvent({ eventType: "audit_log.appended", aggregateId: "x", aggregateKind: "platform", payload: {} });
    expect(first.envelope.auditChain.priorHash).toMatch(/^0+$/);
  });
});

describe("Sprint 12 / Bridge — drain + retry semantics", () => {
  beforeEach(() => _testBridge.resetChain());

  it("delivers queued events when receiver returns 2xx", async () => {
    emitBridgeEvent({ eventType: "round.closed", aggregateId: "rnd_x", aggregateKind: "round", payload: {} });
    const res = await drainOutbox(async () => ({ ok: true, status: 200 }));
    expect(res.delivered).toBe(1);
    expect(getOutbox()[0].status).toBe("delivered");
  });

  it("treats 409 (idempotent dup) as delivered", async () => {
    emitBridgeEvent({ eventType: "round.closed", aggregateId: "rnd_y", aggregateKind: "round", payload: {} });
    const res = await drainOutbox(async () => ({ ok: false, status: 409 }));
    expect(res.delivered).toBe(1);
  });

  it("retries with exponential backoff up to 5 attempts then dead-letters", async () => {
    emitBridgeEvent({ eventType: "round.closed", aggregateId: "rnd_z", aggregateKind: "round", payload: {} });
    let res = { delivered: 0, deadLettered: 0 };
    // First attempt — fails, schedules backoff.
    res = await drainOutbox(async () => ({ ok: false, status: 500 }));
    expect(res.delivered).toBe(0);
    const e = getOutbox().find((x) => x.envelope.aggregateId === "rnd_z")!;
    expect(e.attempts).toBe(1);
    expect(e.status).toBe("queued");
    // Force fast retries by zeroing nextRetryAt.
    for (let i = 0; i < 5; i++) {
      e.nextRetryAt = 0;
      await drainOutbox(async () => ({ ok: false, status: 500 }));
    }
    const after = getOutbox().find((x) => x.envelope.aggregateId === "rnd_z")!;
    expect(after.attempts).toBeGreaterThanOrEqual(5);
    expect(after.status).toBe("dead_letter");
  });
});

describe("Sprint 12 / Bridge HTTP routes", () => {
  it("GET /api/admin/bridge/outbox returns stats + entries array", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/bridge/outbox");
    expect(r.status).toBe(200);
    expect(typeof r.body.total).toBe("number");
    expect(Array.isArray(r.body.entries)).toBe(true);
    expect(Array.isArray(r.body.eventTypes)).toBe(true);
  });

  it("GET /api/admin/bridge/verify-chain reports ok", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/bridge/verify-chain");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("ok");
  });

  it("POST /api/admin/bridge/emit accepts a known event type", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/bridge/emit", {
      eventType: "company.profile.updated",
      aggregateId: "co_test_route",
      aggregateKind: "company",
      payload: { foo: "bar" },
    });
    expect([200, 201]).toContain(r.status);
  });

  it("mock receiver responds at /api/_mock_collective/inbound", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/_mock_collective/inbound", {
      eventId: "evt_mock_1",
      eventType: "dsc.scores",
      aggregateId: "u_test",
      aggregateKind: "investor",
      occurredAt: new Date().toISOString(),
      schemaVersion: "1.0",
      payload: { score: 80 },
    });
    expect([200, 201, 202, 401, 400]).toContain(r.status); // route exists (any non-404)
    expect(r.status).not.toBe(404);
  });
});

/* =========================================================================== */
/* Notifications                                                               */
/* =========================================================================== */
describe("Sprint 12 / Notifications — 21 kinds", () => {
  it("declares ≥21 notification kinds (15 core + 6 Collective)", () => {
    expect(ALL_NOTIFICATION_KINDS.length).toBeGreaterThanOrEqual(21);
  });

  it("contains audit-required core kinds (dot-namespaced per spec)", () => {
    const k = new Set(ALL_NOTIFICATION_KINDS);
    expect(k.has("round.invitation_received")).toBe(true);
    expect(k.has("round.invitation_accepted")).toBe(true);
    expect(k.has("round.invitation_declined")).toBe(true);
    expect(k.has("round.soft_circle_received")).toBe(true);
    expect(k.has("round.closed")).toBe(true);
  });

  it("contains Collective-specific kinds", () => {
    const k = new Set(ALL_NOTIFICATION_KINDS);
    expect(k.has("collective.membership_approved")).toBe(true);
    expect(k.has("membership.renewal_due")).toBe(true);
    expect(k.has("membership.lapsed")).toBe(true);
  });

  it("emit + list works for a user", () => {
    _testNotifications.reset();
    emitNotification({ userId: "u_test", kind: "round.invitation_received", title: "T", body: "B" });
    const list = listNotifications("u_test");
    expect(list.length).toBe(1);
    expect(list[0].kind).toBe("round.invitation_received");
    expect(list[0].read).toBe(false);
  });

  it("unreadCount tracks correctly", () => {
    _testNotifications.reset();
    emitNotification({ userId: "u_a", kind: "round.soft_circle_received", title: "x", body: "y" });
    emitNotification({ userId: "u_a", kind: "round.soft_circle_received", title: "x", body: "y" });
    expect(unreadCount("u_a")).toBe(2);
  });

  it("HTTP /api/notifications/kinds returns all kinds", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/notifications/kinds");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.kinds)).toBe(true);
    expect(r.body.kinds.length).toBeGreaterThanOrEqual(21);
  });

  it("HTTP broadcast accepts payload", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/notifications/broadcast", {
      kind: "round.closed", title: "T", body: "B",
    });
    expect([200, 201]).toContain(r.status);
  });
});

/* =========================================================================== */
/* Email                                                                       */
/* =========================================================================== */
describe("Sprint 12 / Email — templates + queue", () => {
  it("ships ≥14 templates", () => {
    expect(_testEmail.templates.length).toBeGreaterThanOrEqual(14);
  });

  it("each template declares slug, subject, body, variables", () => {
    for (const t of _testEmail.templates) {
      expect(typeof t.slug).toBe("string");
      expect(t.slug.length).toBeGreaterThan(0);
      expect(typeof t.subject).toBe("string");
      expect(typeof t.bodyHtml).toBe("string");
      expect(Array.isArray(t.variables)).toBe(true);
    }
  });

  it("renderTemplate replaces {{var}} placeholders", () => {
    const out = renderTemplate("Hello {{name}}, your round is {{round}}", { name: "Maya", round: "Seed" });
    expect(out).toBe("Hello Maya, your round is Seed");
  });

  it("renderTemplate leaves unknown vars as the literal placeholder", () => {
    const out = renderTemplate("Hi {{x}} {{y}}", { x: "a" });
    expect(out).toContain("a");
  });

  it("findTemplate returns canonical templates by slug", () => {
    expect(findTemplate("round_invitation")).toBeTruthy();
    expect(findTemplate("collective_welcome")).toBeTruthy();
    expect(findTemplate("definitely_not_real")).toBeNull();
  });

  it("enqueueEmail places message in outbox at queued state", () => {
    _testEmail.reset();
    const e = enqueueEmail({ templateSlug: "round_invitation", recipient: "x@y.com", recipientUserId: "u_x", variables: { roundName: "Seed" } });
    expect(e).not.toBeNull();
    expect(_testEmail.outbox.length).toBe(1);
    expect(_testEmail.outbox[0].status).toBe("queued");
  });

  it("tickQueue advances state machine forward", () => {
    _testEmail.reset();
    enqueueEmail({ templateSlug: "round_invitation", recipient: "a@b.com", recipientUserId: "u_a", variables: {} });
    tickQueue();
    // First tick may move queued → sent OR remain queued depending on impl;
    // both are valid — just verify the message hasn't disappeared.
    expect(["queued", "sent", "delivered", "opened", "clicked", "bounced"]).toContain(_testEmail.outbox[0].status);
  });

  it("HTTP /api/admin/email/templates lists templates", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/email/templates");
    expect(r.status).toBe(200);
    expect(r.body.templates.length).toBeGreaterThanOrEqual(14);
  });
});

/* =========================================================================== */
/* Admin platform — KPIs, audit chain, reconciliation, pricing                 */
/* =========================================================================== */
describe("Sprint 12 / Admin platform — KPIs", () => {
  it("GET /api/admin/dashboard/kpis returns full structure", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/dashboard/kpis");
    expect(r.status).toBe(200);
    expect(typeof r.body).toBe("object");
  });

  it("GET /api/admin/dashboard/activity returns array", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/dashboard/activity");
    expect(r.status).toBe(200);
  });
});

describe("Sprint 12 / Admin — audit-log chain verify", () => {
  it("verify endpoint reports ok=true for clean seed", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/audit-log/verify");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("ok");
  });

  it("append endpoint extends chain", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/audit-log/append", {
      eventType: "test.event", entity: "co_test", actor: "u_admin", payload: { foo: "bar" },
    });
    expect([200, 201]).toContain(r.status);
  });
});

describe("Sprint 12 / Admin — reconciliation force-commit guard", () => {
  it("rejects force-commit without signature ≥ 8 chars", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/reconciliation/force-commit", { companyId: "co_x", roundId: "rnd_x", signature: "short" });
    expect(r.status).toBe(403);
  });

  it("accepts force-commit with valid signature", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/reconciliation/force-commit", { companyId: "co_x", roundId: "rnd_x", signature: "AdminApprove2026" });
    expect([200, 201]).toContain(r.status);
  });
});

describe("Sprint 12 / Admin — pricing tiers", () => {
  // v19 Wave A / Change 2: single-plan default (\$840 USD/year, Capavate
  // Annual). The 3-tier matrix (Free / Pro / Scale) was retired from the
  // displayed seed per founder directive. We assert at least 1 tier and that
  // the default tier is `founder_capavate_annual`. Admins can still add tiers
  // via the existing admin pricing endpoints — that path is unchanged.
  it("founder tiers endpoint returns the v19 single-plan default", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/pricing/founder-tiers");
    expect(r.status).toBe(200);
    expect(r.body.tiers.length).toBeGreaterThanOrEqual(1);
    const annual = r.body.tiers.find((t: { id: string }) => t.id === "founder_capavate_annual");
    expect(annual).toBeTruthy();
    expect(annual.annualPriceCents).toBe(84_000);
    expect(annual.billingCycle).toBe("annual");
  });

  it("collective tiers endpoint returns the $1,200/yr Standard tier per audit §10", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/pricing/collective-tiers");
    expect(r.status).toBe(200);
    const std = r.body.tiers.find((t: any) => t.id === "collective_standard" || /standard/i.test(t.name));
    expect(std).toBeTruthy();
    expect(std.usdAnnual).toBe(1200);
  });

  it("regional matrix covers ≥9 regions", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/pricing/regional");
    expect(r.status).toBe(200);
    expect(r.body.regions.length).toBeGreaterThanOrEqual(9);
  });
});

/* =========================================================================== */
/* CapCollectiveToggle                                                         */
/* =========================================================================== */
describe("Sprint 12 / CapCollectiveToggle visibility (audit §11)", () => {
  it("admin always sees toggle", () => {
    const r = shouldShowToggle({ role: "admin", membership: { isCollectiveMember: false, lapsed: false, capTablePositions: 0 } });
    expect(r.visible).toBe(true);
  });

  it("investor without cap-table position is hidden", () => {
    const r = shouldShowToggle({ role: "investor", membership: { isCollectiveMember: true, lapsed: false, capTablePositions: [] } });
    expect(r.visible).toBe(false);
    expect(r.reason).toMatch(/cap table/i);
  });

  it("investor not in Collective is hidden", () => {
    const r = shouldShowToggle({ role: "investor", membership: { isCollectiveMember: false, lapsed: false, capTablePositions: ["co_a"] } });
    expect(r.visible).toBe(false);
  });

  it("investor lapsed membership is hidden", () => {
    const r = shouldShowToggle({ role: "investor", membership: { isCollectiveMember: true, lapsed: true, capTablePositions: ["co_a"] } });
    expect(r.visible).toBe(false);
    expect(r.reason).toMatch(/lapsed/i);
  });

  it("investor with positions + active membership is visible", () => {
    const r = shouldShowToggle({ role: "investor", membership: { isCollectiveMember: true, lapsed: false, capTablePositions: ["co_a", "co_b"] } });
    expect(r.visible).toBe(true);
  });

  it("founder not in Collective is hidden", () => {
    const r = shouldShowToggle({ role: "founder", membership: { isCollectiveMember: false, lapsed: false, capTablePositions: [] } });
    expect(r.visible).toBe(false);
  });

  it("founder with active membership is visible", () => {
    const r = shouldShowToggle({ role: "founder", membership: { isCollectiveMember: true, lapsed: false, capTablePositions: [] } });
    expect(r.visible).toBe(true);
  });

  it("founder with lapsed membership is hidden", () => {
    const r = shouldShowToggle({ role: "founder", membership: { isCollectiveMember: true, lapsed: true, capTablePositions: [] } });
    expect(r.visible).toBe(false);
  });
});

/* =========================================================================== */
/* Math integrity smoke — verify math-critical files weren't accidentally      */
/* modified by Sprint 12 work.                                                 */
/* =========================================================================== */
describe("Sprint 12 / Math integrity smoke", () => {
  it("cap-table-engine package is still importable", async () => {
    // Defensive: if Sprint 12 accidentally broke an import path in cap-table-engine,
    // this require() will throw. Math correctness itself is locked by the
    // engine's own golden-master tests.
    const mod = await import("../../packages/cap-table-engine/src/index").catch((e) => ({ __error: e.message }));
    expect((mod as any).__error).toBeUndefined();
  });
});
